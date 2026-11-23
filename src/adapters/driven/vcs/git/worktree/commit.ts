// adapters/driven/vcs/git/commit: gated staging and committing of explicit path lists (never pushes).
import { type ManifestPort } from '../../../../../core/ports/vcs/manifest.js';
import { type Result, err, ok } from '../../../../../core/result.js';
import { runProcess } from '../../../process.js';
import { assertCurrentBranchAllowed } from './gate.js';
import { spawnFailureDetail } from '../refs/refs.js';

// `git add -- <paths>`: stages exactly the listed paths, nothing else. Gated on the current
// branch before any git call.
export async function stagePaths(manifest: ManifestPort, repoPath: string, paths: string[]): Promise<Result<void>> {
  const allowed = await assertCurrentBranchAllowed(manifest, repoPath);
  if (!allowed.ok) {
    return allowed;
  }
  if (paths.length === 0) {
    return ok(undefined);
  }
  const result = await runProcess('git', ['add', '--', ...paths], { cwd: repoPath });
  if (result.status !== 0) {
    return err('git-add-error', `git add failed in ${repoPath}: ${spawnFailureDetail(result)}`);
  }
  return ok(undefined);
}

// `git commit -m <message> --only -- <paths>`: `--only` records exactly the listed paths even
// when other files are staged. Gated on the current branch. Never pushes.
export async function commitPaths(
  manifest: ManifestPort,
  repoPath: string,
  message: string,
  paths: string[],
): Promise<Result<void>> {
  const allowed = await assertCurrentBranchAllowed(manifest, repoPath);
  if (!allowed.ok) {
    return allowed;
  }
  if (paths.length === 0) {
    return err('git-commit-error', `Nothing to commit in ${repoPath}: no paths given`);
  }
  const result = await runProcess('git', ['commit', '-m', message, '--only', '--', ...paths], { cwd: repoPath });
  if (result.status !== 0) {
    return err('git-commit-error', `git commit failed in ${repoPath}: ${spawnFailureDetail(result)}`);
  }
  return ok(undefined);
}
