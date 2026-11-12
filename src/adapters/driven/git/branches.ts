// adapters/driven/git/branches: branch lifecycle and queries (create, delete, rename, track, checkout, list, merged/ahead-behind checks); every ref write goes through the gate.
import { branchOwners } from '../../../core/edt/branch-owners.js';
import { type EdtRegistryPort } from '../../../core/ports/edt-registry.js';
import { type ManifestPort } from '../../../core/ports/manifest.js';
import { type Result, err, ok } from '../../../core/result.js';
import { runProcess } from '../process.js';
import { assertAllowedBranch } from './gate.js';
import { currentBranch, showFullRef, showRef, spawnFailureDetail } from './refs.js';

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

  const target = await showRef(repoPath, branchName);
  if (target.kind === 'exists') {
    return err('branch-exists', `Branch "${branchName}" already exists in ${repoPath}`);
  }
  if (target.kind === 'error') {
    return err('git-create-branch-error', `Cannot verify branch state in ${repoPath}: ${target.detail}`);
  }

  // The base may be a local branch or a remote-tracking ref (`origin/release`). A local
  // branch wins when both exist; the resolved *full* ref is what git receives, so the start
  // point can never be re-interpreted (e.g. as a same-named tag).
  const localBase = await showFullRef(repoPath, `refs/heads/${baseBranch}`);
  if (localBase.kind === 'error') {
    return err('git-create-branch-error', `Cannot verify base branch state in ${repoPath}: ${localBase.detail}`);
  }
  let baseRef = `refs/heads/${baseBranch}`;
  if (localBase.kind === 'missing') {
    const remoteBase = await showFullRef(repoPath, `refs/remotes/${baseBranch}`);
    if (remoteBase.kind === 'missing') {
      return err('base-branch-missing', `Base branch "${baseBranch}" does not exist in ${repoPath}`);
    }
    if (remoteBase.kind === 'error') {
      return err('git-create-branch-error', `Cannot verify base branch state in ${repoPath}: ${remoteBase.detail}`);
    }
    baseRef = `refs/remotes/${baseBranch}`;
  }

  // `--no-track`: a branch cut from `origin/x` must not inherit `origin/x` as its upstream
  // (that would skew ahead/behind); harmless for a local base.
  const created = await runProcess('git', ['branch', '--no-track', '--', branchName, baseRef], {
    cwd: repoPath,
  });
  if (created.status !== 0) {
    return err('git-create-branch-error', `git branch failed in ${repoPath}: ${spawnFailureDetail(created)}`);
  }
  return ok(undefined);
}

// Deletes a branch ref (rollback of a failed EDT creation, or a member branch a developer
// chose to delete on EDT delete). Delegates to assertAllowedBranch first, same as
// createBranch: a protected target is rejected before any `git` invocation, and a repo whose
// manifest cannot load gets no git write at all. A missing branch is a no-op success
// (idempotent rollback). `force` selects `-d` (refuses an unmerged branch) vs. `-D`
// (unconditional) — the caller decides, this method never second-guesses it.
export async function deleteBranch(
  manifest: ManifestPort,
  repoPath: string,
  branchName: string,
  force: boolean,
): Promise<Result<void>> {
  const allowed = await assertAllowedBranch(manifest, repoPath, branchName);
  if (!allowed.ok) {
    return allowed;
  }

  const target = await showRef(repoPath, branchName);
  if (target.kind === 'missing') {
    return ok(undefined);
  }
  if (target.kind === 'error') {
    return err('git-delete-branch-error', `Cannot verify branch state in ${repoPath}: ${target.detail}`);
  }

  const flag = force ? '-D' : '-d';
  const deleted = await runProcess('git', ['branch', flag, '--', branchName], { cwd: repoPath });
  if (deleted.status !== 0) {
    return err('git-delete-branch-error', `git branch ${flag} failed in ${repoPath}: ${spawnFailureDetail(deleted)}`);
  }
  return ok(undefined);
}

// True when branchName is already merged into `into` (`git merge-base --is-ancestor
// branchName into`), local-only, no fetch. Exit-code taxonomy (git-merge-base(1)): 0 =
// branchName is an ancestor of into (merged), 1 = it is not (unmerged) — both are real,
// successful answers, never a Result error; anything else (missing ref, not a git repo, ...)
// is a genuine git error. Never a safety gate itself, unlike assertAllowedBranch.
export async function isBranchMerged(repoPath: string, branchName: string, into: string): Promise<Result<boolean>> {
  const result = await runProcess('git', ['merge-base', '--is-ancestor', branchName, into], { cwd: repoPath });
  if (result.status === 0) {
    return ok(true);
  }
  if (result.status === 1) {
    return ok(false);
  }
  return err('git-merge-base-error', `git merge-base --is-ancestor failed in ${repoPath}: ${spawnFailureDetail(result)}`);
}

// Ahead/behind counts of the current branch relative to its configured upstream (FR-9).
// Deliberately never fetches — refresh happens at the call site's own cadence — so this is
// always a fast, local-only read.
//
// Three-step read, each step distinguishing a real failure mode (never silently folded into
// a fabricated 0/0):
//   1. currentBranch (existing method) — any failure here (detached HEAD, not a git repo,
//      ...) is a git error, not an upstream question.
//   2. Is an upstream *configured* at all for this branch? `git config --get
//      branch.<branch>.remote`/`.merge` are the two config keys `git branch
//      --set-upstream-to`/`git push -u` set — checking config directly (rather than trying
//      to resolve `@{u}` first) is what lets step 3 distinguish "no upstream" from
//      "upstream configured but its ref can't be resolved right now" below.
//   3. Resolve the actual upstream ref (`@{u}`) and count commits each side is unique on via
//      `git rev-list --left-right --count upstream...branch` (prints "<behind>\t<ahead>" —
//      the standard idiom; NOT `git log --count`, which is not a real git-log option and
//      silently no-ops instead of counting).
export async function aheadBehind(repoPath: string): Promise<Result<{ ahead: number; behind: number }>> {
  const branchResult = await currentBranch(repoPath);
  if (!branchResult.ok) {
    return err('git-ahead-behind-error', `Cannot determine current branch in ${repoPath}: ${branchResult.error.message}`);
  }
  const branch = branchResult.data;

  // `git config --get`'s exit-code taxonomy is 0 = found, 1 = key genuinely not set —
  // anything else (including status === null, e.g. the git binary itself missing) is a real
  // spawn/git failure, never evidence of "no upstream configured".
  const remoteConfig = await readBranchConfig(repoPath, branch, 'remote');
  if (remoteConfig.kind === 'error') {
    return err(
      'unknown-offline',
      `Cannot read upstream remote config for branch "${branch}" in ${repoPath}: ${remoteConfig.detail}`,
    );
  }
  const mergeConfig = await readBranchConfig(repoPath, branch, 'merge');
  if (mergeConfig.kind === 'error') {
    return err(
      'unknown-offline',
      `Cannot read upstream merge config for branch "${branch}" in ${repoPath}: ${mergeConfig.detail}`,
    );
  }
  const hasUpstreamConfigured =
    remoteConfig.kind === 'set' && remoteConfig.value !== '' && mergeConfig.kind === 'set' && mergeConfig.value !== '';

  if (!hasUpstreamConfigured) {
    return err('no-upstream', `No upstream configured for branch "${branch}" in ${repoPath}`);
  }

  const upstreamRef = await runProcess('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], {
    cwd: repoPath,
  });
  if (upstreamRef.status !== 0) {
    // Configured (step 2 passed) but the remote-tracking ref itself can't be resolved right
    // now — never fetched yet, or the remote branch was deleted. Surfaced as "unknown
    // (offline)", never as a stale/zero value.
    return err(
      'unknown-offline',
      `Upstream is configured but its ref cannot be resolved for branch "${branch}" in ${repoPath}: ${spawnFailureDetail(upstreamRef)}`,
    );
  }
  const upstream = String(upstreamRef.stdout).trim();

  const counted = await runProcess('git', ['rev-list', '--left-right', '--count', `${upstream}...${branch}`], {
    cwd: repoPath,
  });
  if (counted.status !== 0) {
    return err('unknown-offline', `Cannot count divergence for branch "${branch}" in ${repoPath}: ${spawnFailureDetail(counted)}`);
  }
  const [behindRaw, aheadRaw] = String(counted.stdout).trim().split(/\s+/);
  const behind = Number(behindRaw);
  const ahead = Number(aheadRaw);
  if (!Number.isFinite(behind) || !Number.isFinite(ahead)) {
    return err('unknown-offline', `Unexpected git rev-list output for branch "${branch}" in ${repoPath}: "${counted.stdout}"`);
  }

  return ok({ ahead, behind });
}

// `git config --get branch.<branch>.<key>`'s exit-code taxonomy: 0 = found ('set'), 1 = the
// key genuinely isn't set ('unset' — the normal, expected shape of "no upstream configured"
// for one of the two tracking keys), anything else (including status === null, e.g. the git
// binary itself missing) is a real spawn/git failure ('error') that must never be folded
// into "not configured".
export interface BranchConfigOutcome {
  kind: 'set' | 'unset' | 'error';
  value: string;
  detail: string;
}

export async function readBranchConfig(repoPath: string, branch: string, key: 'remote' | 'merge'): Promise<BranchConfigOutcome> {
  const result = await runProcess('git', ['config', '--get', `branch.${branch}.${key}`], { cwd: repoPath });
  if (result.status === 0) {
    return { kind: 'set', value: String(result.stdout).trim(), detail: '' };
  }
  if (result.status === 1) {
    return { kind: 'unset', value: '', detail: '' };
  }
  return { kind: 'error', value: '', detail: spawnFailureDetail(result) };
}

// Moves the working tree onto branchName. The trailing `--` (git-checkout(1)'s disambiguation
// form, distinct from `git branch --`'s option-terminator form) forces branchName to be read
// as a revision, never a pathspec. Assumes branchName exists locally and the working tree is
// clean (callers stash first) — this method never creates a branch and never gates.
export async function checkoutBranch(repoPath: string, branchName: string): Promise<Result<void>> {
  const result = await runProcess('git', ['checkout', branchName, '--'], { cwd: repoPath });
  if (result.status !== 0) {
    return err('git-checkout-error', `git checkout failed in ${repoPath}: ${spawnFailureDetail(result)}`);
  }
  return ok(undefined);
}

// Reuses showRef's exit-code taxonomy (0 exists / 1 missing / other real error).
export async function branchExistsLocally(repoPath: string, branchName: string): Promise<Result<boolean>> {
  const outcome = await showRef(repoPath, branchName);
  if (outcome.kind === 'error') {
    return err('git-branch-check-error', `Cannot verify branch state in ${repoPath}: ${outcome.detail}`);
  }
  return ok(outcome.kind === 'exists');
}

// The branch-picker's candidate source: `refs/heads/` only (local-only, never
// `refs/remotes/...`), mirroring branchExistsLocally's local-only scope. One branch name per
// line; blank lines (a trailing newline on the last ref) are filtered out.
export async function listBranches(repoPath: string): Promise<Result<string[]>> {
  const result = await runProcess('git', ['for-each-ref', '--format=%(refname:short)', 'refs/heads/'], {
    cwd: repoPath,
  });
  if (result.status !== 0) {
    return err('git-list-branches-error', `git for-each-ref failed in ${repoPath}: ${spawnFailureDetail(result)}`);
  }
  const branches = String(result.stdout)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  return ok(branches);
}

// Renames a local branch ref. Both names pass assertAllowedBranch (no edtId) before any git
// call: the new name like any created branch, and the old name so a protected branch such as
// `development` can never be renamed away. A taken newName reuses createBranch's exact
// 'branch-exists' code so its error mapping applies uniformly; a missing oldName is a
// distinct 'branch-missing', never folded into 'branch-exists' or a generic git error.
export async function renameBranch(
  manifest: ManifestPort,
  repoPath: string,
  oldName: string,
  newName: string,
  edtId?: string,
  edtRegistry?: EdtRegistryPort,
): Promise<Result<void>> {
  const allowedOld = await assertAllowedBranch(manifest, repoPath, oldName);
  if (!allowedOld.ok) {
    return allowedOld;
  }
  const allowed = await assertAllowedBranch(manifest, repoPath, newName);
  if (!allowed.ok) {
    return allowed;
  }

  // Cross-EDT gate — neither the old nor the new name may be another EDT's own branch for
  // this repo (renaming it away, or taking its name, silently breaks that EDT). Without `edtId`
  // any registered owner blocks; with it, the caller's own EDT is excluded. Skipped without a
  // registry, as assertAllowedBranch's own cross-EDT half is.
  if (edtRegistry !== undefined) {
    const listed = await edtRegistry.list();
    if (!listed.ok) {
      return listed;
    }
    for (const name of [oldName, newName]) {
      const owners = branchOwners(listed.data, repoPath, name, edtId);
      if (owners.length > 0) {
        return err(
          'branch-owned-by-other-edt',
          `Branch "${name}" is already registered as a different EDT's own branch (repo ${repoPath}, EDT ${owners.map((t) => `"${t}"`).join(', ')})`,
        );
      }
    }
  }

  const source = await showRef(repoPath, oldName);
  if (source.kind === 'missing') {
    return err('branch-missing', `Branch "${oldName}" does not exist in ${repoPath}`);
  }
  if (source.kind === 'error') {
    return err('git-rename-branch-error', `Cannot verify branch state in ${repoPath}: ${source.detail}`);
  }

  // Renaming a branch to its own current name is a no-op success, not a collision — checked
  // only once oldName is confirmed to actually exist, so a genuinely missing branch still
  // surfaces as branch-missing rather than a false no-op success.
  if (oldName === newName) {
    return ok(undefined);
  }

  const target = await showRef(repoPath, newName);
  if (target.kind === 'exists') {
    return err('branch-exists', `Branch "${newName}" already exists in ${repoPath}`);
  }
  if (target.kind === 'error') {
    return err('git-rename-branch-error', `Cannot verify branch state in ${repoPath}: ${target.detail}`);
  }

  const renamed = await runProcess('git', ['branch', '-m', '--', oldName, newName], { cwd: repoPath });
  if (renamed.status !== 0) {
    return err('git-rename-branch-error', `git branch -m failed in ${repoPath}: ${spawnFailureDetail(renamed)}`);
  }
  return ok(undefined);
}

// The remote-tracking refs already present locally, as `<remote>/<branch>`.
// Uses the full `%(refname)` and strips `refs/remotes/` itself: `%(refname:short)` is unsafe
// here, git shortens `refs/remotes/origin/HEAD` to a bare `origin`. Only *symbolic* refs
// (non-empty `%(symref)`, i.e. `<remote>/HEAD`) are dropped — a real branch whose name ends
// in `/HEAD` (e.g. `origin/release/HEAD`) is kept. Never fetches.
export async function listRemoteBranches(repoPath: string): Promise<Result<string[]>> {
  const result = await runProcess('git', ['for-each-ref', '--format=%(refname)%09%(symref)', 'refs/remotes/'], {
    cwd: repoPath,
  });
  if (result.status !== 0) {
    return err(
      'git-list-remote-branches-error',
      `git for-each-ref failed in ${repoPath}: ${spawnFailureDetail(result)}`,
    );
  }
  const prefix = 'refs/remotes/';
  const branches: string[] = [];
  for (const line of String(result.stdout).split('\n')) {
    const [refname = '', symref = ''] = line.split('\t');
    if (refname.startsWith(prefix) && symref.trim() === '') {
      branches.push(refname.slice(prefix.length));
    }
  }
  return ok(branches);
}

// Creates local branch `localName` tracking the remote-tracking ref `remoteRef`
// (`git branch --track -- <localName> <remoteRef>`): a ref write only, never a checkout,
// never a fetch. `localName` passes the shared-branch gate first (a tracking branch lands a
// branchName exactly like a create does); an existing local `localName` is `branch-exists`
// (createBranch's exact code); a `remoteRef` absent from `refs/remotes/` is
// `remote-branch-missing`.
export async function createTrackingBranch(
  manifest: ManifestPort,
  repoPath: string,
  localName: string,
  remoteRef: string,
): Promise<Result<void>> {
  const allowed = await assertAllowedBranch(manifest, repoPath, localName);
  if (!allowed.ok) {
    return allowed;
  }

  const target = await showRef(repoPath, localName);
  if (target.kind === 'exists') {
    return err('branch-exists', `Branch "${localName}" already exists in ${repoPath}`);
  }
  if (target.kind === 'error') {
    return err('git-create-branch-error', `Cannot verify branch state in ${repoPath}: ${target.detail}`);
  }

  const remote = await showFullRef(repoPath, `refs/remotes/${remoteRef}`);
  if (remote.kind === 'missing') {
    return err('remote-branch-missing', `Remote branch "${remoteRef}" does not exist in ${repoPath}`);
  }
  if (remote.kind === 'error') {
    return err('git-create-branch-error', `Cannot verify remote branch state in ${repoPath}: ${remote.detail}`);
  }

  const created = await runProcess('git', ['branch', '--track', '--', localName, `refs/remotes/${remoteRef}`], {
    cwd: repoPath,
  });
  if (created.status !== 0) {
    return err('git-create-branch-error', `git branch --track failed in ${repoPath}: ${spawnFailureDetail(created)}`);
  }
  return ok(undefined);
}

