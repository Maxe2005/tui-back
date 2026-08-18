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
    deleteBranch: (repoPath, branchName) => deleteBranch(manifest, repoPath, branchName),
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
    return err('git-create-branch-error', `Cannot verify branch state in ${repoPath}: ${target.detail}`);
  }

  const base = showRef(repoPath, baseBranch);
  if (base.kind === 'missing') {
    return err('base-branch-missing', `Base branch "${baseBranch}" does not exist in ${repoPath}`);
  }
  if (base.kind === 'error') {
    return err('git-create-branch-error', `Cannot verify base branch state in ${repoPath}: ${base.detail}`);
  }

  const created = spawnSync('git', ['branch', '--', branchName, baseBranch], { cwd: repoPath, encoding: 'utf8' });
  if (created.status !== 0) {
    return err('git-create-branch-error', `git branch failed in ${repoPath}: ${spawnFailureDetail(created)}`);
  }
  return ok(undefined);
}

// Deletes a branch ref (rollback path — story 2.2 review: a failed EDT creation must not
// leave orphaned branch refs in member repos). Same shared-branch gate as createBranch:
// a shared/protected target is rejected before any `git` invocation, and a repo whose
// manifest cannot load gets no git write at all. A missing branch is a no-op success
// (idempotent rollback).
export async function deleteBranch(
  manifest: ManifestPort,
  repoPath: string,
  branchName: string,
): Promise<Result<void>> {
  const loaded = await manifest.load(repoPath);
  if (!loaded.ok) {
    return loaded;
  }

  if (isSharedBranch(branchName, loaded.data.sharedBranch)) {
    return err(
      'shared-branch-rejected',
      `Branch "${branchName}" is a shared/protected branch and cannot be deleted (repo ${repoPath})`,
    );
  }

  const target = showRef(repoPath, branchName);
  if (target.kind === 'missing') {
    return ok(undefined);
  }
  if (target.kind === 'error') {
    return err('git-delete-branch-error', `Cannot verify branch state in ${repoPath}: ${target.detail}`);
  }

  const deleted = spawnSync('git', ['branch', '-D', '--', branchName], { cwd: repoPath, encoding: 'utf8' });
  if (deleted.status !== 0) {
    return err('git-delete-branch-error', `git branch -D failed in ${repoPath}: ${spawnFailureDetail(deleted)}`);
  }
  return ok(undefined);
}

export async function currentBranch(repoPath: string): Promise<Result<string>> {
  const result = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoPath, encoding: 'utf8' });
  if (result.status !== 0) {
    return err('git-current-branch-error', `git rev-parse failed in ${repoPath}: ${spawnFailureDetail(result)}`);
  }
  const branch = String(result.stdout).trim();
  // On a detached HEAD, `git rev-parse --abbrev-ref HEAD` exits 0 and prints the literal
  // "HEAD" — that is not a branch name and must never be recorded as one (unborn repos
  // already error via exit 128).
  if (branch === 'HEAD') {
    return err('git-current-branch-error', `Cannot determine a named branch in ${repoPath}: HEAD is detached or unborn`);
  }
  return ok(branch);
}

function isSharedBranch(branchName: string, manifestSharedBranch: string): boolean {
  return SHARED_BRANCHES.includes(branchName) || branchName === manifestSharedBranch;
}

// git show-ref --verify --quiet exit-code taxonomy: 0 = the ref exists, 1 = the ref is
// missing (quiet), anything else (e.g. 128 on a non-git directory) is a real git error.
interface ShowRefOutcome {
  kind: 'exists' | 'missing' | 'error';
  detail: string;
}

// Builds a human-readable cause from a spawnSync result. When the binary itself cannot be
// spawned (status === null — e.g. git is missing from PATH), stderr is undefined, so the
// message must come from the spawn error's own fields; surfacing String(undefined) would
// read like "...: undefined" and hide the real cause (ENOENT etc.).
function spawnFailureDetail(result: { status: number | null; stderr: string; error?: Error }): string {
  if (result.status === null) {
    const spawnError = result.error as (NodeJS.ErrnoException & Error) | undefined;
    const message = spawnError?.message;
    const code = spawnError?.code;
    return typeof message === 'string' && message !== '' ? message : (typeof code === 'string' ? code : 'unknown error');
  }
  return String(result.stderr).trim();
}

function showRef(repoPath: string, branchName: string): ShowRefOutcome {
  const result = spawnSync('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`], {
    cwd: repoPath,
    encoding: 'utf8',
  });
  if (result.status === 0) {
    return { kind: 'exists', detail: '' };
  }
  if (result.status === 1) {
    return { kind: 'missing', detail: '' };
  }
  return { kind: 'error', detail: spawnFailureDetail(result) };
}
