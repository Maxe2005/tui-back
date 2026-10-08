// adapters/driven/manifest/carry: filesystem implementation of ManifestCarryPort. The safety
// copy lives in the repo's git directory (resolved through the `gitdir:` pointer in a worktree).
import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { err, ok, type Result } from '../../../core/result.js';
import { MANIFEST_FILE } from '../../../core/edt/manifest-carry.js';
import type { ManifestCarryPort, ManifestSnapshot } from '../../../core/ports/manifest-carry.js';

const SAFETY_COPY = 'tui-back-manifest-carry';

export function createManifestCarryPort(): ManifestCarryPort {
  return { capture, restore };
}

async function safetyCopyPath(repoPath: string): Promise<string | null> {
  const dotGit = join(repoPath, '.git');
  try {
    if ((await stat(dotGit)).isDirectory()) {
      return join(dotGit, SAFETY_COPY);
    }
    // A worktree: `.git` is a file reading `gitdir: <path>`.
    const pointer = /^gitdir:\s*(.+)$/m.exec(await readFile(dotGit, 'utf8'));
    if (pointer?.[1] === undefined) {
      return null;
    }
    const gitDir = pointer[1].trim();
    return join(isAbsolute(gitDir) ? gitDir : resolve(repoPath, gitDir), SAFETY_COPY);
  } catch {
    return null;
  }
}

async function capture(repoPath: string): Promise<Result<ManifestSnapshot>> {
  let content: Uint8Array;
  try {
    content = await readFile(join(repoPath, MANIFEST_FILE));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return ok({ kind: 'absent' });
    }
    return err('manifest-carry-read-error', `Failed to read ${join(repoPath, MANIFEST_FILE)}: ${describeError(error)}`);
  }
  const copy = await safetyCopyPath(repoPath);
  if (copy !== null) {
    // A copy left by an earlier failed restore may hold the only version of someone's edits.
    if (await exists(copy)) {
      return err(
        'manifest-carry-stale-copy',
        `An earlier switch left a manifest safety copy in ${copy}. Recover it by hand (or delete it), then switch again — nothing was touched`,
      );
    }
    try {
      await writeFile(copy, content);
    } catch (error) {
      return err('manifest-carry-backup-error', `Failed to keep a safety copy of the manifest in ${repoPath}: ${describeError(error)}`);
    }
  }
  return ok({ kind: 'present', content });
}

async function restore(repoPath: string, snapshot: ManifestSnapshot): Promise<Result<void>> {
  const copy = await safetyCopyPath(repoPath);
  const target = join(repoPath, MANIFEST_FILE);
  try {
    if (snapshot.kind === 'present') {
      // Written beside the target then renamed, so a crash never leaves a truncated manifest.
      const staging = `${target}.carry-tmp`;
      await writeFile(staging, snapshot.content);
      await rename(staging, target);
    } else {
      await rm(target, { force: true });
    }
  } catch (error) {
    const where = copy !== null && snapshot.kind === 'present' ? ` The captured manifest is kept in ${copy}.` : '';
    return err('manifest-carry-restore-error', `Failed to restore ${target}: ${describeError(error)}.${where}`);
  }
  if (copy !== null) {
    await rm(copy, { force: true });
  }
  return ok(undefined);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
