// adapters/driven/git/remote: operations that talk to origin (fetch, pull, unpushed-commit listing).
import { type Result, err, ok } from '../../../../../core/result.js';
import { runProcess } from '../../../process.js';
import { spawnFailureDetail } from './refs.js';

// Fetches branchName from origin straight into a same-named local branch, without checking
// it out. Only ever called for a non-member repo's manifest sharedBranch after
// branchExistsLocally reports false (a member's own branch is never auto-fetched — the
// switch fails for that repo instead).
//
// AD-8 carve-out #2 ("fast-forward the shared branches"): this call, like
// `pullBranch` below, is also how `fastForwardShared` moves a *shared* branch. It carries no
// gate call on purpose: `git fetch origin b:b` only ever fast-forwards (a diverged local branch
// is refused by git), and the sole ref it writes is the branch's own `origin` counterpart. Every
// other write on a shared branch (commit, delete, rename, create, stage) stays gated.
export async function fetchBranch(repoPath: string, branchName: string): Promise<Result<void>> {
  const result = await runProcess('git', ['fetch', 'origin', `${branchName}:${branchName}`], {
    cwd: repoPath,
  });
  if (result.status !== 0) {
    return err('git-fetch-error', `git fetch origin ${branchName} failed in ${repoPath}: ${spawnFailureDetail(result)}`);
  }
  return ok(undefined);
}

// Plain `git fetch origin <branch>`: only refreshes the remote-tracking ref (and FETCH_HEAD),
// never the local branch — so a local branch ahead of origin cannot make it fail.
export async function fetchRemoteBranch(repoPath: string, branchName: string): Promise<Result<void>> {
  const result = await runProcess('git', ['fetch', 'origin', branchName], { cwd: repoPath });
  if (result.status !== 0) {
    return err('git-fetch-error', `git fetch origin ${branchName} failed in ${repoPath}: ${spawnFailureDetail(result)}`);
  }
  return ok(undefined);
}

// Local commits of branchName absent from origin/<branchName>, as `<short hash> <subject>`
// lines, oldest first. An unknown remote-tracking ref is a controlled error, not an empty list.
export async function listUnpushedCommits(repoPath: string, branchName: string): Promise<Result<string[]>> {
  const result = await runProcess(
    'git',
    ['log', '--reverse', '--format=%h %s', `refs/remotes/origin/${branchName}..refs/heads/${branchName}`],
    { cwd: repoPath },
  );
  if (result.status !== 0) {
    return err(
      'git-unpushed-commits-error',
      `Cannot list unpushed commits of ${branchName} in ${repoPath}: ${spawnFailureDetail(result)}`,
    );
  }
  return ok(
    String(result.stdout)
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== ''),
  );
}

// `git pull --ff-only` on the current branch. Only ever called for a member that already sits
// on its manifest sharedBranch (the merge path would be a self-merge); pulls of the
// shared branch carry no write-gate. `--ff-only` never merges and never rebases (a diverged
// branch is a clean `git-pull-error`, never a surprise merge commit), and
// `GIT_TERMINAL_PROMPT=0` keeps a credential-requiring remote from hanging on an interactive
// prompt. Together with `--no-edit` on the merge path (merge.ts), no git invocation here can open an
// editor or prompt.
export async function pullBranch(repoPath: string): Promise<Result<void>> {
  const result = await runProcess('git', ['pull', '--ff-only'], {
    cwd: repoPath,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  if (result.status !== 0) {
    return err('git-pull-error', `git pull --ff-only failed in ${repoPath}: ${spawnFailureDetail(result)}`);
  }
  return ok(undefined);
}
