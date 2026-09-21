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
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
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
    aheadBehind: (repoPath) => aheadBehind(repoPath),
    checkout: (repoPath, branchName) => checkoutBranch(repoPath, branchName),
    hasUncommittedChanges: (repoPath) => hasUncommittedChanges(repoPath),
    stashSave: (repoPath, message) => stashSave(repoPath, message),
    restoreStash: (repoPath, message) => restoreStash(repoPath, message),
    branchExistsLocally: (repoPath, branchName) => branchExistsLocally(repoPath, branchName),
    fetch: (repoPath, branchName) => fetchBranch(repoPath, branchName),
    pull: (repoPath) => pullBranch(repoPath),
    isMergeInProgress: (repoPath) => isMergeInProgress(repoPath),
    mergeBranch: (repoPath, branch) => mergeBranch(repoPath, branch),
    abortMerge: (repoPath) => abortMerge(repoPath),
    listDirtyPaths: (repoPath) => listDirtyPaths(repoPath),
    discardPaths: (repoPath, paths) => discardPaths(repoPath, paths),
    isRebaseInProgress: (repoPath) => isRebaseInProgress(repoPath),
    hasUnmergedPaths: (repoPath) => hasUnmergedPaths(repoPath),
    finalizeMerge: (repoPath) => finalizeMerge(repoPath),
    listBranches: (repoPath) => listBranches(repoPath),
    renameBranch: (repoPath, oldName, newName) => renameBranch(manifest, repoPath, oldName, newName),
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
    // Review patch (story 2.4): normalize both sides before comparing — repoPath is whatever
    // shape the registry stored a member's path in, which isn't guaranteed to match the
    // caller's resolve()'d repoPath byte-for-byte (trailing slash, relative segments, ...).
    // Without this, the cross-EDT gate this story adds can silently fail to detect a real
    // conflict.
    const target = resolve(repoPath);
    const ownedByOther = listed.data.some(
      (candidate) =>
        candidate.ulid !== edtId &&
        candidate.members.some((member) => resolve(member.repoPath) === target && member.branch === branchName),
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

// Story 2.6 (FR-9): ahead/behind counts of the current branch relative to its configured
// upstream. Deliberately never fetches (the "cached values, not a live fetch" half of the
// Ask-First resolved in the spec's Design Notes: refresh happens on-demand at the call
// site's own cadence — zone render / explicit refresh — not by this adapter reaching the
// network on every read) — so this is always a fast, local-only read.
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

  // Review patch: `git config --get`'s documented exit-code taxonomy is 0 = found, 1 = key
  // genuinely not set — anything else (including status === null, e.g. the git binary
  // itself missing) is a real spawn/git failure, not evidence of "no upstream configured".
  // Treating every non-zero status as "not configured" (the pre-patch behavior) silently
  // reported a real environment error as `no-upstream`.
  const remoteConfig = readBranchConfig(repoPath, branch, 'remote');
  if (remoteConfig.kind === 'error') {
    return err(
      'unknown-offline',
      `Cannot read upstream remote config for branch "${branch}" in ${repoPath}: ${remoteConfig.detail}`,
    );
  }
  const mergeConfig = readBranchConfig(repoPath, branch, 'merge');
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

  const upstreamRef = spawnSync('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], {
    cwd: repoPath,
    encoding: 'utf8',
  });
  if (upstreamRef.status !== 0) {
    // Configured (step 2 passed) but the remote-tracking ref itself can't be resolved right
    // now — never fetched yet, or the remote branch was deleted. Surfaced as "unknown
    // (offline)" per the spec, never as a stale/zero value.
    return err(
      'unknown-offline',
      `Upstream is configured but its ref cannot be resolved for branch "${branch}" in ${repoPath}: ${spawnFailureDetail(upstreamRef)}`,
    );
  }
  const upstream = String(upstreamRef.stdout).trim();

  const counted = spawnSync('git', ['rev-list', '--left-right', '--count', `${upstream}...${branch}`], {
    cwd: repoPath,
    encoding: 'utf8',
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
interface BranchConfigOutcome {
  kind: 'set' | 'unset' | 'error';
  value: string;
  detail: string;
}

function readBranchConfig(repoPath: string, branch: string, key: 'remote' | 'merge'): BranchConfigOutcome {
  const result = spawnSync('git', ['config', '--get', `branch.${branch}.${key}`], { cwd: repoPath, encoding: 'utf8' });
  if (result.status === 0) {
    return { kind: 'set', value: String(result.stdout).trim(), detail: '' };
  }
  if (result.status === 1) {
    return { kind: 'unset', value: '', detail: '' };
  }
  return { kind: 'error', value: '', detail: spawnFailureDetail(result) };
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

// Story 3.1 — `git pull --ff-only` on the current branch. Only ever called for a member
// that already sits on its manifest sharedBranch (the merge path below would be a
// self-merge), mirroring the switch.ts precedent that pulls of the shared branch carry no
// write-gate. `--ff-only` never merges and never rebases (a diverged branch is a clean
// `git-pull-error`, never a surprise merge commit), and `GIT_TERMINAL_PROMPT=0` keeps a
// credential-requiring remote from hanging on an interactive prompt. Together with
// `--no-edit` on the merge path, no git invocation here can open an editor or prompt.
export async function pullBranch(repoPath: string): Promise<Result<void>> {
  const result = spawnSync('git', ['pull', '--ff-only'], {
    cwd: repoPath,
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  if (result.status !== 0) {
    return err('git-pull-error', `git pull --ff-only failed in ${repoPath}: ${spawnFailureDetail(result)}`);
  }
  return ok(undefined);
}

// Story 3.1 — `git merge` of the already-fetched shared branch into the member's own
// current branch, never a rebase. `--no-edit` keeps the merge non-interactive (no editor).
// A conflicting merge is distinguished by MERGE_HEAD existing afterwards (the merge is
// still in progress) — locale-independent, unlike matching git's own CONFLICT marker in
// its human-readable output — so the caller can abort and report `merge-conflict` instead
// of a generic merge failure.
export async function mergeBranch(repoPath: string, branch: string): Promise<Result<void>> {
  const result = spawnSync('git', ['merge', '--no-edit', branch], { cwd: repoPath, encoding: 'utf8' });
  if (result.status !== 0) {
    const merging = await isMergeInProgress(repoPath);
    if (merging.ok && merging.data) {
      return err('merge-conflict', `git merge ${branch} conflicts in ${repoPath}: ${spawnFailureDetail(result)}`);
    }
    return err('git-merge-error', `git merge ${branch} failed in ${repoPath}: ${spawnFailureDetail(result)}`);
  }
  return ok(undefined);
}

// Story 3.1 — `git merge --abort` cancels the in-progress merge, restoring the pre-run
// HEAD. Abort cancels only the attempted merge, never developer work.
export async function abortMerge(repoPath: string): Promise<Result<void>> {
  const result = spawnSync('git', ['merge', '--abort'], { cwd: repoPath, encoding: 'utf8' });
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
  const result = spawnSync('git', ['rev-parse', '--verify', '--quiet', 'MERGE_HEAD'], {
    cwd: repoPath,
    encoding: 'utf8',
  });
  if (result.status === null) {
    return err('git-merge-check-error', `Cannot check merge state in ${repoPath}: ${spawnFailureDetail(result)}`);
  }
  return ok(result.status === 0);
}

// Story 3.4 — porcelain file list backing the lockfile-only classifier: one entry per
// dirty path parsed from `git status --porcelain` (each line is `XY<space>path`; renames
// surface as `old -> new` and contribute both sides so the classifier stays conservative).
// Empty output means a clean tree. A non-zero exit is a controlled git-status-error.
export async function listDirtyPaths(repoPath: string): Promise<Result<string[]>> {
  const result = spawnSync('git', ['status', '--porcelain'], { cwd: repoPath, encoding: 'utf8' });
  if (result.status !== 0) {
    return err('git-status-error', `git status failed in ${repoPath}: ${spawnFailureDetail(result)}`);
  }
  const paths: string[] = [];
  for (const line of String(result.stdout).split('\n')) {
    if (line.trim() === '') {
      continue;
    }
    const entry = line.length > 3 ? line.slice(3).trim() : '';
    if (entry === '') {
      continue;
    }
    // Rename/copy entries surface as `old -> new` — keep both sides (conservative: a
    // non-lockfile on either side blocks the lockfile-only auto-fix).
    if (entry.includes(' -> ')) {
      for (const side of entry.split(' -> ')) {
        const trimmed = side.trim().replace(/^"|"$/g, '');
        if (trimmed !== '') {
          paths.push(trimmed);
        }
      }
    } else {
      paths.push(entry.replace(/^"|"$/g, ''));
    }
  }
  return ok(paths);
}

// Story 3.4 — path-scoped discard (`git checkout -- <paths>` equivalent) for the
// lockfile-only auto-fix. The `--` terminates option parsing so a path starting with `-`
// is never treated as a flag (the createBranch/deleteBranch precedent). An empty list is
// a no-op success.
export async function discardPaths(repoPath: string, paths: string[]): Promise<Result<void>> {
  if (paths.length === 0) {
    return ok(undefined);
  }
  const result = spawnSync('git', ['checkout', '--', ...paths], { cwd: repoPath, encoding: 'utf8' });
  if (result.status !== 0) {
    return err('git-discard-error', `git checkout -- failed in ${repoPath}: ${spawnFailureDetail(result)}`);
  }
  return ok(undefined);
}

// Story 3.4 — mid-rebase detector: resolves the repo's git dir (`git rev-parse --git-dir`,
// relative for ordinary repos — resolved against repoPath) and reports true while either
// rebase state dir exists. Mirrors isMergeInProgress's taxonomy: only an unspawnable git
// (status === null) is a real failure; an unresolvable git dir (not a repo, ...) reads as
// "no rebase in progress", never a throw. The tool never touches a rebase — detection only.
export async function isRebaseInProgress(repoPath: string): Promise<Result<boolean>> {
  const result = spawnSync('git', ['rev-parse', '--git-dir'], { cwd: repoPath, encoding: 'utf8' });
  if (result.status === null) {
    return err('git-rebase-check-error', `Cannot check rebase state in ${repoPath}: ${spawnFailureDetail(result)}`);
  }
  if (result.status !== 0) {
    return ok(false);
  }
  const gitDir = resolve(repoPath, String(result.stdout).trim());
  return ok(existsSync(join(gitDir, 'rebase-merge')) || existsSync(join(gitDir, 'rebase-apply')));
}

// Story 3.4 — unmerged-path check (`git diff --name-only --diff-filter=U` non-empty):
// the re-verification gate before finalizeMerge. Any git failure is a controlled error.
export async function hasUnmergedPaths(repoPath: string): Promise<Result<boolean>> {
  const result = spawnSync('git', ['diff', '--name-only', '--diff-filter=U'], { cwd: repoPath, encoding: 'utf8' });
  if (result.status !== 0) {
    return err('git-unmerged-check-error', `Cannot check unmerged paths in ${repoPath}: ${spawnFailureDetail(result)}`);
  }
  return ok(String(result.stdout).trim().length > 0);
}

// Story 3.4 — `git commit --no-edit` finalizes a human-resolved merge after
// hasUnmergedPaths reported clean. `--no-edit` keeps it non-interactive (no editor — the
// pull/merge `--no-edit` precedent). Never resolves conflict content itself.
export async function finalizeMerge(repoPath: string): Promise<Result<void>> {
  const result = spawnSync('git', ['commit', '--no-edit'], { cwd: repoPath, encoding: 'utf8' });
  if (result.status !== 0) {
    return err('git-commit-error', `git commit --no-edit failed in ${repoPath}: ${spawnFailureDetail(result)}`);
  }
  return ok(undefined);
}

// Story 2.26 — the branch-picker's candidate source: `refs/heads/` only (local-only, never
// `refs/remotes/...`), mirroring branchExistsLocally's local-only scope. One branch name per
// line; blank lines (a trailing newline on the last ref) are filtered out.
export async function listBranches(repoPath: string): Promise<Result<string[]>> {
  const result = spawnSync('git', ['for-each-ref', '--format=%(refname:short)', 'refs/heads/'], {
    cwd: repoPath,
    encoding: 'utf8',
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

// Story 2.26 — renames a local branch ref. Gates the *new* name the same way createBranch
// gates its own target (assertAllowedBranch, no edtId — a rename lands a branchName exactly
// like a create does, so it must pass the identical shared-branch check). Reuses createBranch's
// exact 'branch-exists' code when newName is already taken (Boundaries: "reuse createBranch's
// exact code") so FailedResultList's registry entry for it applies uniformly regardless of
// which git write produced the collision. A missing oldName is a distinct, new failure mode
// ('branch-missing') — never silently folded into 'branch-exists' or a generic git error.
export async function renameBranch(
  manifest: ManifestPort,
  repoPath: string,
  oldName: string,
  newName: string,
): Promise<Result<void>> {
  const allowed = await assertAllowedBranch(manifest, repoPath, newName);
  if (!allowed.ok) {
    return allowed;
  }

  const source = showRef(repoPath, oldName);
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

  const target = showRef(repoPath, newName);
  if (target.kind === 'exists') {
    return err('branch-exists', `Branch "${newName}" already exists in ${repoPath}`);
  }
  if (target.kind === 'error') {
    return err('git-rename-branch-error', `Cannot verify branch state in ${repoPath}: ${target.detail}`);
  }

  const renamed = spawnSync('git', ['branch', '-m', '--', oldName, newName], { cwd: repoPath, encoding: 'utf8' });
  if (renamed.status !== 0) {
    return err('git-rename-branch-error', `git branch -m failed in ${repoPath}: ${spawnFailureDetail(renamed)}`);
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
  // Some git failures exit non-zero with blank stderr — fall back to the exit status so
  // the message never ends with a blank cause.
  const stderr = String(result.stderr).trim();
  return stderr !== '' ? stderr : `exit ${String(result.status)}`;
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
