// adapters/driven/git: the driven implementation of core's GitPort — the single git
// touchpoint every git write in the tool flows through (AD-8). Branch creation is Story
// 2.2's seed gate: before any `git` invocation, a target branch name in the shared-branch
// set (development / preprod / prod / the repo's own manifest `sharedBranch`) is rejected
// with shared-branch-rejected. The shared-branch set is resolved from the repo's manifest
// at write time (through the ManifestPort), never trusted from the caller's arguments — a
// repo that fails to load a manifest cannot pass the gate. Story 2.3 owns the full per-EDT
// self-resolving gate on top of this seed.
//
// Branch creation only creates a ref (`git branch <name> <base>`), never a checkout:
// moving a working tree onto a branch is Story 2.4's protected-switch, which owns data
// preservation. The git binary is shelled via node:child_process (no new npm dependency);
// `--` terminates option parsing so a branch name like `-foo` is never treated as a flag.
import { spawnSync } from 'node:child_process';
import { err, ok, type Result } from '../../../core/result.js';
import type { GitPort } from '../../../core/ports/git.js';
import type { ManifestPort } from '../../../core/ports/manifest.js';

const SHARED_BRANCHES: readonly string[] = ['development', 'preprod', 'prod'];

export function createGitPort(manifest: ManifestPort): GitPort {
  return {
    createBranch: (repoPath, branchName, baseBranch) => createBranch(manifest, repoPath, branchName, baseBranch),
    currentBranch: (repoPath) => currentBranch(repoPath),
  };
}

export async function createBranch(
  manifest: ManifestPort,
  repoPath: string,
  branchName: string,
  baseBranch: string,
): Promise<Result<void>> {
  // Resolve the shared-branch set from the repo's own manifest at write time (AD-8): a
  // repo whose manifest cannot load is not a managed repo, so no branch write is allowed.
  const loaded = await manifest.load(repoPath);
  if (!loaded.ok) {
    return loaded;
  }

  if (isSharedBranch(branchName, loaded.data.sharedBranch)) {
    return err(
      'shared-branch-rejected',
      `Branch "${branchName}" is a shared/protected branch and cannot be an EDT's own branch (repo ${repoPath})`,
    );
  }

  const target = showRef(repoPath, branchName);
  if (target.kind === 'exists') {
    return err('branch-exists', `Branch "${branchName}" already exists in ${repoPath}`);
  }
  if (target.kind === 'error') {
    return err('git-create-branch-error', `Cannot verify branch state in ${repoPath}: ${target.stderr}`);
  }

  const base = showRef(repoPath, baseBranch);
  if (base.kind === 'missing') {
    return err('base-branch-missing', `Base branch "${baseBranch}" does not exist in ${repoPath}`);
  }
  if (base.kind === 'error') {
    return err('git-create-branch-error', `Cannot verify base branch state in ${repoPath}: ${base.stderr}`);
  }

  const created = spawnSync('git', ['branch', '--', branchName, baseBranch], { cwd: repoPath, encoding: 'utf8' });
  if (created.status !== 0) {
    return err('git-create-branch-error', `git branch failed in ${repoPath}: ${String(created.stderr).trim()}`);
  }
  return ok(undefined);
}

export async function currentBranch(repoPath: string): Promise<Result<string>> {
  const result = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoPath, encoding: 'utf8' });
  if (result.status !== 0) {
    return err('git-current-branch-error', `git rev-parse failed in ${repoPath}: ${String(result.stderr).trim()}`);
  }
  return ok(String(result.stdout).trim());
}

function isSharedBranch(branchName: string, manifestSharedBranch: string): boolean {
  return SHARED_BRANCHES.includes(branchName) || branchName === manifestSharedBranch;
}

// git show-ref --verify --quiet exit-code taxonomy: 0 = the ref exists, 1 = the ref is
// missing (quiet), anything else (e.g. 128 on a non-git directory) is a real git error.
interface ShowRefOutcome {
  kind: 'exists' | 'missing' | 'error';
  stderr: string;
}

function showRef(repoPath: string, branchName: string): ShowRefOutcome {
  const result = spawnSync('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`], {
    cwd: repoPath,
    encoding: 'utf8',
  });
  if (result.status === 0) {
    return { kind: 'exists', stderr: '' };
  }
  if (result.status === 1) {
    return { kind: 'missing', stderr: '' };
  }
  return { kind: 'error', stderr: String(result.stderr).trim() };
}
