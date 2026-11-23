// adapters/driven/vcs/git/refs: shared low-level ref helpers (spawn-failure detail, show-ref taxonomy, current branch) used by every other family module.
import { GIT_DETACHED_HEAD } from '../../../../../core/ports/vcs/git.js';
import { type Result, err, ok } from '../../../../../core/result.js';
import { runProcess } from '../../../process.js';

// Builds a human-readable cause from a spawnSync result. When the binary itself cannot be
// spawned (status === null — e.g. git is missing from PATH), stderr is undefined, so the
// message must come from the spawn error's own fields; surfacing String(undefined) would
// read like "...: undefined" and hide the real cause (ENOENT etc.).
export function spawnFailureDetail(result: { status: number | null; stderr: string; error?: Error }): string {
  if (result.status === null) {
    const spawnError = result.error as (NodeJS.ErrnoException & Error) | undefined;
    const message = spawnError?.message;
    const code = spawnError?.code;
    return typeof message === 'string' && message !== '' ? message : (typeof code === 'string' ? code : 'unknown error');
  }
  // Some git failures exit non-zero with blank stderr — fall back to the exit status so
  // the message never ends with a blank cause.
  const stderr = String(result.stderr).trim();
  return stderr !== '' ? stderr : `exit ${String(result.status)}`;
}

// git show-ref --verify --quiet exit-code taxonomy: 0 = the ref exists, 1 = the ref is
// missing (quiet), anything else (e.g. 128 on a non-git directory) is a real git error.
export interface ShowRefOutcome {
  kind: 'exists' | 'missing' | 'error';
  detail: string;
}

export async function showRef(repoPath: string, branchName: string): Promise<ShowRefOutcome> {
  return await showFullRef(repoPath, `refs/heads/${branchName}`);
}

export async function showFullRef(repoPath: string, fullRef: string): Promise<ShowRefOutcome> {
  const result = await runProcess('git', ['show-ref', '--verify', '--quiet', fullRef], {
    cwd: repoPath,
  });
  if (result.status === 0) {
    return { kind: 'exists', detail: '' };
  }
  if (result.status === 1) {
    return { kind: 'missing', detail: '' };
  }
  return { kind: 'error', detail: spawnFailureDetail(result) };
}

export async function currentBranch(repoPath: string): Promise<Result<string>> {
  const result = await runProcess('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoPath });
  if (result.status !== 0) {
    return err('git-current-branch-error', `git rev-parse failed in ${repoPath}: ${spawnFailureDetail(result)}`);
  }
  const branch = String(result.stdout).trim();
  // On a detached HEAD, `git rev-parse --abbrev-ref HEAD` exits 0 and prints the literal
  // "HEAD" — that is not a branch name and must never be recorded as one. It gets its own
  // code so callers can tell it from a probe failure (unborn repos already error via exit 128).
  if (branch === 'HEAD') {
    return err(GIT_DETACHED_HEAD, `Cannot determine a named branch in ${repoPath}: HEAD is detached`);
  }
  return ok(branch);
}
