// adapters/driven/git/merge: merge lifecycle and conflict resolution (merge, abort, state detectors, conflicted-file read/write, side checkout); resolution writes are gated.
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { type ManifestPort } from '../../../../../core/ports/vcs/manifest.js';
import { type Result, err, ok } from '../../../../../core/result.js';
import { runProcess } from '../../../process.js';
import { assertCurrentBranchAllowed } from '../worktree/gate.js';
import { spawnFailureDetail } from '../refs/refs.js';

// `git merge` of the already-fetched shared branch into the member's own
// current branch, never a rebase. `--no-edit` keeps the merge non-interactive (no editor).
// A conflicting merge is distinguished by MERGE_HEAD existing afterwards (the merge is
// still in progress) — locale-independent, unlike matching git's own CONFLICT marker in
// its human-readable output — so the caller can abort and report `merge-conflict` instead
// of a generic merge failure.
export async function mergeBranch(repoPath: string, branch: string): Promise<Result<void>> {
  const result = await runProcess('git', ['merge', '--no-edit', branch], { cwd: repoPath });
  if (result.status !== 0) {
    const merging = await isMergeInProgress(repoPath);
    if (merging.ok && merging.data) {
      return err('merge-conflict', `git merge ${branch} conflicts in ${repoPath}: ${spawnFailureDetail(result)}`);
    }
    return err('git-merge-error', `git merge ${branch} failed in ${repoPath}: ${spawnFailureDetail(result)}`);
  }
  return ok(undefined);
}

// `git merge --abort` cancels the in-progress merge, restoring the pre-run
// HEAD. Abort cancels only the attempted merge, never developer work.
export async function abortMerge(repoPath: string): Promise<Result<void>> {
  const result = await runProcess('git', ['merge', '--abort'], { cwd: repoPath });
  if (result.status !== 0) {
    return err('git-merge-abort-error', `git merge --abort failed in ${repoPath}: ${spawnFailureDetail(result)}`);
  }
  return ok(undefined);
}

// A failed `git merge` (or `git pull`) that leaves MERGE_HEAD behind is a conflicting
// merge still in progress (the caller's abortMerge target); any other failure (unknown
// branch, not a git repo, ...) leaves no MERGE_HEAD. `git rev-parse --verify --quiet`
// exit-code taxonomy: 0 exists, 1 missing, anything else (except an unspawnable git,
// status === null, which is a real environment failure) reads as missing — the merge
// already failed, so this is only a classifier, never the reported error.
export async function isMergeInProgress(repoPath: string): Promise<Result<boolean>> {
  const result = await runProcess('git', ['rev-parse', '--verify', '--quiet', 'MERGE_HEAD'], {
    cwd: repoPath,
  });
  if (result.status === null) {
    return err('git-merge-check-error', `Cannot check merge state in ${repoPath}: ${spawnFailureDetail(result)}`);
  }
  return ok(result.status === 0);
}

// Mid-rebase detector: resolves the repo's git dir (`git rev-parse --git-dir`,
// relative for ordinary repos — resolved against repoPath) and reports true while either
// rebase state dir exists. Mirrors isMergeInProgress's taxonomy: only an unspawnable git
// (status === null) is a real failure; an unresolvable git dir (not a repo, ...) reads as
// "no rebase in progress", never a throw. The tool never touches a rebase — detection only.
export async function isRebaseInProgress(repoPath: string): Promise<Result<boolean>> {
  const result = await runProcess('git', ['rev-parse', '--git-dir'], { cwd: repoPath });
  if (result.status === null) {
    return err('git-rebase-check-error', `Cannot check rebase state in ${repoPath}: ${spawnFailureDetail(result)}`);
  }
  if (result.status !== 0) {
    return ok(false);
  }
  const gitDir = resolve(repoPath, String(result.stdout).trim());
  return ok(existsSync(join(gitDir, 'rebase-merge')) || existsSync(join(gitDir, 'rebase-apply')));
}

// Unmerged-path check (`git diff --name-only --diff-filter=U` non-empty):
// the re-verification gate before finalizeMerge. Any git failure is a controlled error.
export async function hasUnmergedPaths(repoPath: string): Promise<Result<boolean>> {
  const result = await runProcess('git', ['diff', '--name-only', '--diff-filter=U'], { cwd: repoPath });
  if (result.status !== 0) {
    return err('git-unmerged-check-error', `Cannot check unmerged paths in ${repoPath}: ${spawnFailureDetail(result)}`);
  }
  return ok(String(result.stdout).trim().length > 0);
}

// `git commit --no-edit` finalizes a human-resolved merge after hasUnmergedPaths reported
// clean. `--no-edit` keeps it non-interactive (no editor). Never resolves conflict content
// itself.
export async function finalizeMerge(repoPath: string): Promise<Result<void>> {
  const result = await runProcess('git', ['commit', '--no-edit'], { cwd: repoPath });
  if (result.status !== 0) {
    return err('git-commit-error', `git commit --no-edit failed in ${repoPath}: ${spawnFailureDetail(result)}`);
  }
  return ok(undefined);
}

// `git diff --name-only --diff-filter=U -z`: the conflicted paths, NUL-separated so unusual
// file names survive. Read-only.
export async function listUnmergedPaths(repoPath: string): Promise<Result<string[]>> {
  const result = await runProcess('git', ['diff', '--name-only', '--diff-filter=U', '-z'], { cwd: repoPath });
  if (result.status !== 0) {
    return err('git-unmerged-check-error', `Cannot list unmerged paths in ${repoPath}: ${spawnFailureDetail(result)}`);
  }
  return ok(String(result.stdout).split('\0').filter((entry) => entry !== ''));
}

// Reads a repo-relative worktree file; the path may never leave the repo.
export async function readWorktreeFile(repoPath: string, path: string): Promise<Result<string>> {
  const target = resolve(repoPath, path);
  if (!isInside(repoPath, target)) {
    return err('git-read-error', `Path ${path} is outside ${repoPath}`);
  }
  try {
    return ok(await readFile(target, 'utf8'));
  } catch (error) {
    return err('git-read-error', `Cannot read ${path} in ${repoPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function isInside(repoPath: string, target: string): boolean {
  const root = resolve(repoPath);
  return target === root || target.startsWith(root.endsWith('/') ? root : `${root}/`);
}

// Writes a resolved file (and optionally stages exactly it). Gated on the current branch
// before any write.
export async function writeResolvedFile(
  manifest: ManifestPort,
  repoPath: string,
  path: string,
  content: string,
  opts: { stage: boolean },
): Promise<Result<void>> {
  const allowed = await assertCurrentBranchAllowed(manifest, repoPath);
  if (!allowed.ok) {
    return allowed;
  }
  const target = resolve(repoPath, path);
  if (!isInside(repoPath, target)) {
    return err('git-write-error', `Path ${path} is outside ${repoPath}`);
  }
  try {
    await writeFile(target, content, 'utf8');
  } catch (error) {
    return err('git-write-error', `Cannot write ${path} in ${repoPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!opts.stage) {
    return ok(undefined);
  }
  const result = await runProcess('git', ['--literal-pathspecs', 'add', '--', path], { cwd: repoPath });
  if (result.status !== 0) {
    return err('git-add-error', `git add failed in ${repoPath}: ${spawnFailureDetail(result)}`);
  }
  return ok(undefined);
}

// `git checkout --ours -- <path>`: takes the current branch's side of one conflicted path into
// the worktree (not staged). Gated on the current branch.
export async function checkoutSide(
  manifest: ManifestPort,
  repoPath: string,
  path: string,
  side: 'ours',
): Promise<Result<void>> {
  const allowed = await assertCurrentBranchAllowed(manifest, repoPath);
  if (!allowed.ok) {
    return allowed;
  }
  const result = await runProcess('git', ['--literal-pathspecs', 'checkout', `--${side}`, '--', path], { cwd: repoPath });
  if (result.status !== 0) {
    return err('git-checkout-error', `git checkout --${side} failed for ${path} in ${repoPath}: ${spawnFailureDetail(result)}`);
  }
  return ok(undefined);
}
