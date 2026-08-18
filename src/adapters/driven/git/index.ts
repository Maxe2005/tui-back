// adapters/driven/git: the driven implementation of core's GitPort — the single git
// touchpoint every git write in the tool flows through (AD-8). `assertAllowedBranch` is the
// reusable gate: before any `git` invocation, it rejects a target branch name in the
// shared-branch set (development / preprod / prod / the repo's own manifest `sharedBranch`)
// with shared-branch-rejected. The shared-branch set is resolved from the repo's manifest at
// check time (through the ManifestPort), never trusted from the caller's arguments — a repo
// that fails to load a manifest cannot pass the gate. `createBranch`/`deleteBranch` delegate
// to this gate first (story 2.2's seed extracted into story 2.3's reusable form); `core/edt`
// also calls it directly for the branch-creation-disabled path, where a member's *existing*
// current branch — never checked by createBranch — must still pass the gate before it's
// recorded as that member's own EDT branch.
//
// Story 2.4 closes AD-8's cross-EDT half: when `assertAllowedBranch` is called with an
// `edtId` and the port was constructed with an `EdtRegistryPort`, it additionally rejects a
// branchName already registered as a *different* EDT's own branch for that repo — the
// switch use-case's re-verification before checking a target member into its own branch.
//
// Branch creation only creates a ref (`git branch <name> <base>`), never a checkout: moving
// a working tree onto a branch — with uncommitted work auto-preserved via stash — is story
// 2.4's `checkout`/`stashSave`/`restoreStash`. The git binary is shelled via
// node:child_process (no new npm dependency); `--` terminates option parsing for `git
// branch`/`git stash` so a branch/message value starting with `-` is never treated as a
// flag. `git checkout <branch> --` uses the (different) trailing-`--` form git-checkout(1)
// documents to force <branch> to be read as a revision, never a pathspec.
import { spawnSync } from 'node:child_process';
import { err, ok, type Result } from '../../../core/result.js';
import type { EdtRegistryPort } from '../../../core/ports/edt-registry.js';
import type { GitPort } from '../../../core/ports/git.js';
import type { ManifestPort } from '../../../core/ports/manifest.js';

const SHARED_BRANCHES: readonly string[] = ['development', 'preprod', 'prod'];

export function createGitPort(manifest: ManifestPort, edtRegistry?: EdtRegistryPort): GitPort {
  return {
    assertAllowedBranch: (repoPath, branchName, edtId) =>
      assertAllowedBranch(manifest, repoPath, branchName, edtId, edtRegistry),
    createBranch: (repoPath, branchName, baseBranch) => createBranch(manifest, repoPath, branchName, baseBranch),
    deleteBranch: (repoPath, branchName) => deleteBranch(manifest, repoPath, branchName),
    currentBranch: (repoPath) => currentBranch(repoPath),
    checkout: (repoPath, branchName) => checkoutBranch(repoPath, branchName),
    hasUncommittedChanges: (repoPath) => hasUncommittedChanges(repoPath),
    stashSave: (repoPath, message) => stashSave(repoPath, message),
    restoreStash: (repoPath, message) => restoreStash(repoPath, message),
    branchExistsLocally: (repoPath, branchName) => branchExistsLocally(repoPath, branchName),
    fetch: (repoPath, branchName) => fetchBranch(repoPath, branchName),
  };
}

// The reusable branch-scope safety gate (AD-8): resolves the shared-branch set from the
// repo's own manifest at check time — never trusted from the caller — and rejects
// before any `git` invocation. A repo whose manifest cannot load fails the gate too (it is
// not a managed repo, so no branch of it can be judged safe). Story 2.4: when both `edtId`
// and `edtRegistry` are supplied, also rejects a branchName already registered as a
// *different* EDT's own branch for this repoPath (the cross-EDT half of AD-8) — omitting
// either parameter preserves the pre-2.4 shared-branch-only behavior exactly.
export async function assertAllowedBranch(
  manifest: ManifestPort,
  repoPath: string,
  branchName: string,
  edtId?: string,
  edtRegistry?: EdtRegistryPort,
): Promise<Result<void>> {
  const loaded = await manifest.load(repoPath);
  if (!loaded.ok) {
    return loaded;
  }

  if (isSharedBranch(branchName, loaded.data.sharedBranch)) {
    return err(
      'shared-branch-rejected',
      `Branch "${branchName}" is a shared/protected branch (repo ${repoPath})`,
    );
  }

  if (edtId !== undefined && edtRegistry !== undefined) {
    const listed = await edtRegistry.list();
    if (!listed.ok) {
      return listed;
    }
    const ownedByOther = listed.data.some(
      (candidate) =>
        candidate.ulid !== edtId &&
        candidate.members.some((member) => member.repoPath === repoPath && member.branch === branchName),
    );
    if (ownedByOther) {
      return err(
        'branch-owned-by-other-edt',
        `Branch "${branchName}" is already registered as a different EDT's own branch (repo ${repoPath})`,
      );
    }
  }

  return ok(undefined);
}

export async function createBranch(
  manifest: ManifestPort,
  repoPath: string,
  branchName: string,
  baseBranch: string,
): Promise<Result<void>> {
  const allowed = await assertAllowedBranch(manifest, repoPath, branchName);
  if (!allowed.ok) {
    return allowed;
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
// leave orphaned branch refs in member repos). Delegates to assertAllowedBranch first, same
// as createBranch: a shared/protected target is rejected before any `git` invocation, and a
// repo whose manifest cannot load gets no git write at all. A missing branch is a no-op
// success (idempotent rollback).
export async function deleteBranch(
  manifest: ManifestPort,
  repoPath: string,
  branchName: string,
): Promise<Result<void>> {
  const allowed = await assertAllowedBranch(manifest, repoPath, branchName);
  if (!allowed.ok) {
    return allowed;
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

// Story 2.4 — Moves the working tree onto branchName. The trailing `--` (git-checkout(1)'s
// disambiguation form, distinct from `git branch --`'s option-terminator form) forces
// branchName to be read as a revision, never a pathspec, closing the same "value starting
// with -" class of ambiguity createBranch/deleteBranch already close for `git branch`.
// Assumes branchName already exists locally and the working tree is already clean (callers
// stash first) — this method itself never creates a branch and never gates.
export async function checkoutBranch(repoPath: string, branchName: string): Promise<Result<void>> {
  const result = spawnSync('git', ['checkout', branchName, '--'], { cwd: repoPath, encoding: 'utf8' });
  if (result.status !== 0) {
    return err('git-checkout-error', `git checkout failed in ${repoPath}: ${spawnFailureDetail(result)}`);
  }
  return ok(undefined);
}

// Story 2.4 — `git status --porcelain` is non-empty iff the working tree has tracked or
// untracked changes; this is the trigger for stashSave before any checkout touches the repo.
export async function hasUncommittedChanges(repoPath: string): Promise<Result<boolean>> {
  const result = spawnSync('git', ['status', '--porcelain'], { cwd: repoPath, encoding: 'utf8' });
  if (result.status !== 0) {
    return err('git-status-error', `git status failed in ${repoPath}: ${spawnFailureDetail(result)}`);
  }
  return ok(String(result.stdout).trim().length > 0);
}

// Story 2.4 — `-u` stashes untracked files too (tracked + untracked, per the spec); `-m`
// tags the stash with `message` so restoreStash can find it later by content, not stack
// position.
export async function stashSave(repoPath: string, message: string): Promise<Result<void>> {
  const result = spawnSync('git', ['stash', 'push', '-u', '-m', message], { cwd: repoPath, encoding: 'utf8' });
  if (result.status !== 0) {
    return err('git-stash-error', `git stash push failed in ${repoPath}: ${spawnFailureDetail(result)}`);
  }
  return ok(undefined);
}

// Story 2.4 — Finds the stash entry whose subject contains `message` (git renders a
// `-m`-tagged push as "On <branch>: <message>", so a substring match is exactly right — not
// stack position, so this is safe even if the developer's own unrelated stashes exist) and
// pops it. No matching stash is a no-op success: not every switch pops one, only a return
// into an EDT that owns one.
export async function restoreStash(repoPath: string, message: string): Promise<Result<void>> {
  const list = spawnSync('git', ['stash', 'list', '--format=%gd %s'], { cwd: repoPath, encoding: 'utf8' });
  if (list.status !== 0) {
    return err('git-stash-list-error', `git stash list failed in ${repoPath}: ${spawnFailureDetail(list)}`);
  }

  const lines = String(list.stdout).split('\n').filter((line) => line.trim() !== '');
  const match = lines.find((line) => line.includes(message));
  if (match === undefined) {
    return ok(undefined);
  }

  const ref = match.slice(0, match.indexOf(' '));
  const popped = spawnSync('git', ['stash', 'pop', ref], { cwd: repoPath, encoding: 'utf8' });
  if (popped.status !== 0) {
    return err('git-stash-pop-error', `git stash pop ${ref} failed in ${repoPath}: ${spawnFailureDetail(popped)}`);
  }
  return ok(undefined);
}

// Story 2.4 — reuses showRef's exit-code taxonomy (0 exists / 1 missing / other real error).
export async function branchExistsLocally(repoPath: string, branchName: string): Promise<Result<boolean>> {
  const outcome = showRef(repoPath, branchName);
  if (outcome.kind === 'error') {
    return err('git-branch-check-error', `Cannot verify branch state in ${repoPath}: ${outcome.detail}`);
  }
  return ok(outcome.kind === 'exists');
}

// Story 2.4 — Fetches branchName from origin straight into a same-named local branch,
// without checking it out. Only ever called for a non-member repo's manifest sharedBranch
// after branchExistsLocally reports false (a member's own branch is never auto-fetched, per
// the spec — it fails the switch for that repo instead).
export async function fetchBranch(repoPath: string, branchName: string): Promise<Result<void>> {
  const result = spawnSync('git', ['fetch', 'origin', `${branchName}:${branchName}`], {
    cwd: repoPath,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    return err('git-fetch-error', `git fetch origin ${branchName} failed in ${repoPath}: ${spawnFailureDetail(result)}`);
  }
  return ok(undefined);
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
