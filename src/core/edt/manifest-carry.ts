// core/edt/manifest-carry: the one exception to the switch's stash/adopt/discard rules — a dirty
// .tui-back.yaml is captured, cleared to HEAD so nothing else touches it, and written back last.
import type { GitPort } from '../ports/git.js';
import type { ManifestCarryPort } from '../ports/manifest-carry.js';
import type { SwitchEdtRepoResult } from './switch.js';

export const MANIFEST_FILE = '.tui-back.yaml';

function failedRow(service: string, code: string, message: string): SwitchEdtRepoResult {
  return { service, outcome: 'failed', detail: { code, message } };
}

// Runs `run` (the repo's normal switch) on a tree that no longer holds the dirty manifest, then
// puts the manifest back exactly as captured — also when `run` failed. A repo whose manifest is
// clean (or whose dirtiness cannot be read) runs untouched.
export async function withCarriedManifest(
  deps: { git: GitPort; carry: ManifestCarryPort },
  repoPath: string,
  service: string,
  run: () => Promise<SwitchEdtRepoResult>,
): Promise<SwitchEdtRepoResult> {
  const { git, carry } = deps;
  const dirty = await git.listDirtyPaths(repoPath);
  if (!dirty.ok) {
    // Not knowing whether the manifest is dirty means a checkout could overwrite it: stop here.
    return failedRow(service, dirty.error.code, `${dirty.error.message} — left untouched`);
  }
  if (!dirty.data.includes(MANIFEST_FILE)) {
    return run();
  }

  const captured = await carry.capture(repoPath);
  if (!captured.ok) {
    return failedRow(service, captured.error.code, `${captured.error.message} — left untouched`);
  }

  const cleared = await git.discardPathsToHead(repoPath, [MANIFEST_FILE]);
  if (!cleared.ok) {
    const back = await carry.restore(repoPath, captured.data);
    const note = back.ok ? ' — left untouched' : ` — and restoring it failed: ${back.error.message}`;
    return failedRow(service, cleared.error.code, `${cleared.error.message}${note}`);
  }

  let row: SwitchEdtRepoResult;
  try {
    row = await run();
  } catch (error) {
    await carry.restore(repoPath, captured.data);
    throw error;
  }

  const restored = await carry.restore(repoPath, captured.data);
  if (restored.ok) {
    return row;
  }
  const earlier = row.outcome === 'failed' && row.detail !== undefined ? `${row.detail.message} ` : '';
  return { ...row, outcome: 'failed', detail: { ...row.detail, code: restored.error.code, message: `${earlier}${restored.error.message}` } };
}
