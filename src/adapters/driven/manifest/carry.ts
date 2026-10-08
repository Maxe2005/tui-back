// adapters/driven/manifest/carry: filesystem implementation of ManifestCarryPort. The safety
// copy lives in the repo's .git directory (skipped when .git is a file, e.g. a worktree).
import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { err, ok, type Result } from '../../../core/result.js';
import type { ManifestCarryPort, ManifestSnapshot } from '../../../core/ports/manifest-carry.js';

const MANIFEST_FILE = '.tui-back.yaml';
const SAFETY_COPY = 'tui-back-manifest-carry';

export function createManifestCarryPort(): ManifestCarryPort {
  return { capture, restore };
}

async function safetyCopyPath(repoPath: string): Promise<string | null> {
  const gitDir = join(repoPath, '.git');
  try {
    return (await stat(gitDir)).isDirectory() ? join(gitDir, SAFETY_COPY) : null;
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
    return err('manifest-carry-read-error', `Failed to read ${join(repoPath, MANIFEST_FILE)}: ${describe(error)}`);
  }
  const copy = await safetyCopyPath(repoPath);
  if (copy !== null) {
    try {
      await writeFile(copy, content);
    } catch (error) {
      return err('manifest-carry-backup-error', `Failed to keep a safety copy of the manifest in ${repoPath}: ${describe(error)}`);
    }
  }
  return ok({ kind: 'present', content });
}

async function restore(repoPath: string, snapshot: ManifestSnapshot): Promise<Result<void>> {
  const copy = await safetyCopyPath(repoPath);
  const target = join(repoPath, MANIFEST_FILE);
  try {
    if (snapshot.kind === 'present') {
      await writeFile(target, snapshot.content);
    } else {
      await rm(target, { force: true });
    }
  } catch (error) {
    const where = copy !== null && snapshot.kind === 'present' ? ` The captured manifest is kept in ${copy}.` : '';
    return err('manifest-carry-restore-error', `Failed to restore ${target}: ${describe(error)}.${where}`);
  }
  if (copy !== null) {
    await rm(copy, { force: true });
  }
  return ok(undefined);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
