// adapters/driven/git: the driven implementation of core's GitPort — every git write flows
// through it (AD-8). `assertAllowedBranch` rejects a protected target (resolved from the
// repo's own manifest, never the caller) before any `git` invocation, and with an `edtId` a
// branch owned by another EDT. Shells git via child_process; `--` terminates options for
// `git branch`/`git stash`, and `git checkout <branch> --` forces a revision, never a pathspec.
import { runProcess } from '../process.js';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { err, ok, type Result } from '../../../core/result.js';
import type { EdtRegistryPort } from '../../../core/ports/edt-registry.js';
import type { GitPort } from '../../../core/ports/git.js';
import type { ManifestPort } from '../../../core/ports/manifest.js';
// The FR-7 protected-branch rule lives in core, shared with the TUI's advisory check.
import { isProtectedBranch } from '../../../core/edt/shared-branches.js';

export function createGitPort(manifest: ManifestPort, edtRegistry?: EdtRegistryPort): GitPort {
  return {
    assertAllowedBranch: (repoPath, branchName, edtId) =>
      assertAllowedBranch(manifest, repoPath, branchName, edtId, edtRegistry),
    createBranch: (repoPath, branchName, baseBranch) => createBranch(manifest, repoPath, branchName, baseBranch),
    deleteBranch: (repoPath, branchName, force) => deleteBranch(manifest, repoPath, branchName, force),
    isBranchMerged: (repoPath, branchName, into) => isBranchMerged(repoPath, branchName, into),
    currentBranch: (repoPath) => currentBranch(repoPath),
    aheadBehind: (repoPath) => aheadBehind(repoPath),
    checkout: (repoPath, branchName) => checkoutBranch(repoPath, branchName),
    hasUncommittedChanges: (repoPath, opts) => hasUncommittedChanges(repoPath, opts),
    stashSave: (repoPath, message) => stashSave(repoPath, message),
    restoreStash: (repoPath, message) => restoreStash(repoPath, message),
    hasStash: (repoPath, tag) => hasStash(repoPath, tag),
    branchExistsLocally: (repoPath, branchName) => branchExistsLocally(repoPath, branchName),
    fetch: (repoPath, branchName) => fetchBranch(repoPath, branchName),
    pull: (repoPath) => pullBranch(repoPath),
    isMergeInProgress: (repoPath) => isMergeInProgress(repoPath),
    mergeBranch: (repoPath, branch) => mergeBranch(repoPath, branch),
    abortMerge: (repoPath) => abortMerge(repoPath),
    listDirtyPaths: (repoPath, opts) => listDirtyPaths(repoPath, opts),
    discardPaths: (repoPath, paths) => discardPaths(repoPath, paths),
    discardAll: (repoPath) => discardAll(repoPath),
    diffNameOnly: (repoPath, from, to) => diffNameOnly(repoPath, from, to),
    headRevision: (repoPath) => headRevision(repoPath),
    diffStat: (repoPath, from, to) => diffStat(repoPath, from, to),
    discardPathsToHead: (repoPath, paths) => discardPathsToHead(repoPath, paths),
    isRebaseInProgress: (repoPath) => isRebaseInProgress(repoPath),
    hasUnmergedPaths: (repoPath) => hasUnmergedPaths(repoPath),
    finalizeMerge: (repoPath) => finalizeMerge(repoPath),
    listBranches: (repoPath) => listBranches(repoPath),
    renameBranch: (repoPath, oldName, newName) => renameBranch(manifest, repoPath, oldName, newName),
    listRemoteBranches: (repoPath) => listRemoteBranches(repoPath),
    createTrackingBranch: (repoPath, localName, remoteRef) =>
      createTrackingBranch(manifest, repoPath, localName, remoteRef),
    stagePaths: (repoPath, paths) => stagePaths(manifest, repoPath, paths),
    commit: (repoPath, message, paths) => commitPaths(manifest, repoPath, message, paths),
  };
}

// The reusable branch-scope safety gate (AD-8): resolves the protected set from the
// repo's own manifest at check time — never trusted from the caller — and rejects
// before any `git` invocation. A repo whose manifest cannot load fails the gate too (it is
// not a managed repo, so no branch of it can be judged safe). When both `edtId` and
// `edtRegistry` are supplied, it also rejects a branchName already registered as a
// *different* EDT's own branch for this repoPath (the cross-EDT half of AD-8).
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

  if (isProtectedBranch(branchName, loaded.data)) {
    return err('shared-branch-rejected', `Branch "${branchName}" is protected by ${loaded.data.service}'s manifest (repo ${repoPath})`);
  }

  if (edtId !== undefined && edtRegistry !== undefined) {
    const listed = await edtRegistry.list();
    if (!listed.ok) {
      return listed;
    }
    // Normalize both sides before comparing — repoPath is whatever shape the registry stored
    // a member's path in, which isn't guaranteed to match the caller's resolve()'d repoPath
    // byte-for-byte (trailing slash, relative segments, ...). Without this, the cross-EDT gate
    // can silently miss a real conflict.
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

export async function currentBranch(repoPath: string): Promise<Result<string>> {
  const result = await runProcess('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoPath });
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
interface BranchConfigOutcome {
  kind: 'set' | 'unset' | 'error';
  value: string;
  detail: string;
}

async function readBranchConfig(repoPath: string, branch: string, key: 'remote' | 'merge'): Promise<BranchConfigOutcome> {
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

// Trailing pathspec args that hide `paths` from a `git status` (`:(exclude,literal)` — no glob).
function excludePathspecs(paths: readonly string[] | undefined): string[] {
  return paths === undefined || paths.length === 0 ? [] : ['--', '.', ...paths.map((path) => `:(exclude,literal)${path}`)];
}

// `git status --porcelain` is non-empty iff the working tree has tracked or untracked
// changes; this is the trigger for stashSave before any checkout touches the repo.
export async function hasUncommittedChanges(
  repoPath: string,
  opts?: { excludePaths?: string[] },
): Promise<Result<boolean>> {
  const result = await runProcess('git', ['status', '--porcelain', ...excludePathspecs(opts?.excludePaths)], {
    cwd: repoPath,
  });
  if (result.status !== 0) {
    return err('git-status-error', `git status failed in ${repoPath}: ${spawnFailureDetail(result)}`);
  }
  return ok(String(result.stdout).trim().length > 0);
}

// `-u` stashes untracked files too (tracked + untracked); `-m` tags the stash with `message`
// so restoreStash can find it later by content, not stack position.
export async function stashSave(repoPath: string, message: string): Promise<Result<void>> {
  const result = await runProcess('git', ['stash', 'push', '-u', '-m', message], { cwd: repoPath });
  if (result.status !== 0) {
    return err('git-stash-error', `git stash push failed in ${repoPath}: ${spawnFailureDetail(result)}`);
  }
  return ok(undefined);
}

// Finds the stash entry whose subject contains `message` (git renders a `-m`-tagged push as
// "On <branch>: <message>", so a substring match is exactly right — not stack position, so
// this is safe even if the developer's own unrelated stashes exist) and pops it. No matching
// stash is a no-op success: not every switch pops one, only a return into an EDT that owns one.
export async function restoreStash(repoPath: string, message: string): Promise<Result<void>> {
  const found = await findStashRef(repoPath, message);
  if (!found.ok) {
    return found;
  }
  if (found.data === null) {
    return ok(undefined);
  }

  const popped = await runProcess('git', ['stash', 'pop', found.data], { cwd: repoPath });
  if (popped.status !== 0) {
    return err('git-stash-pop-error', `git stash pop ${found.data} failed in ${repoPath}: ${spawnFailureDetail(popped)}`);
  }
  return ok(undefined);
}

// The list-and-match-by-message-substring logic shared by restoreStash and hasStash. Returns
// the stash ref (e.g. `stash@{0}`) of the first match, or null when none of repoPath's
// stashes carry `tag` in their subject.
export async function findStashRef(repoPath: string, tag: string): Promise<Result<string | null>> {
  const list = await runProcess('git', ['stash', 'list', '--format=%gd %s'], { cwd: repoPath });
  if (list.status !== 0) {
    return err('git-stash-list-error', `git stash list failed in ${repoPath}: ${spawnFailureDetail(list)}`);
  }

  const lines = String(list.stdout).split('\n').filter((line) => line.trim() !== '');
  const match = lines.find((line) => line.includes(tag));
  if (match === undefined) {
    return ok(null);
  }
  return ok(match.slice(0, match.indexOf(' ')));
}

// Non-destructive existence check: true iff a stash tagged `tag` exists in repoPath. Never
// pops anything, unlike restoreStash — EDT delete reads it to decide a member's
// disposition, not to act on the stash itself.
export async function hasStash(repoPath: string, tag: string): Promise<Result<boolean>> {
  const found = await findStashRef(repoPath, tag);
  if (!found.ok) {
    return found;
  }
  return ok(found.data !== null);
}

// Reuses showRef's exit-code taxonomy (0 exists / 1 missing / other real error).
export async function branchExistsLocally(repoPath: string, branchName: string): Promise<Result<boolean>> {
  const outcome = await showRef(repoPath, branchName);
  if (outcome.kind === 'error') {
    return err('git-branch-check-error', `Cannot verify branch state in ${repoPath}: ${outcome.detail}`);
  }
  return ok(outcome.kind === 'exists');
}

// Fetches branchName from origin straight into a same-named local branch, without checking
// it out. Only ever called for a non-member repo's manifest sharedBranch after
// branchExistsLocally reports false (a member's own branch is never auto-fetched — the
// switch fails for that repo instead).
export async function fetchBranch(repoPath: string, branchName: string): Promise<Result<void>> {
  const result = await runProcess('git', ['fetch', 'origin', `${branchName}:${branchName}`], {
    cwd: repoPath,
  });
  if (result.status !== 0) {
    // `<b>:<b>` is rejected as non-fast-forward whenever the local branch carries commits the
    // remote lacks (e.g. an unpushed tui-back dependency-bump commit). That is not a failure:
    // the local branch already contains everything the remote has, so the merge that follows
    // loses nothing. Only a genuinely diverged branch stays an error.
    const remoteTip = await runProcess('git', ['fetch', 'origin', branchName], { cwd: repoPath });
    if (remoteTip.status === 0) {
      const contained = await runProcess('git', ['merge-base', '--is-ancestor', 'FETCH_HEAD', branchName], {
        cwd: repoPath,
      });
      if (contained.status === 0) {
        return ok(undefined);
      }
    }
    return err('git-fetch-error', `git fetch origin ${branchName} failed in ${repoPath}: ${spawnFailureDetail(result)}`);
  }
  return ok(undefined);
}

// `git pull --ff-only` on the current branch. Only ever called for a member that already sits
// on its manifest sharedBranch (the merge path below would be a self-merge); pulls of the
// shared branch carry no write-gate. `--ff-only` never merges and never rebases (a diverged
// branch is a clean `git-pull-error`, never a surprise merge commit), and
// `GIT_TERMINAL_PROMPT=0` keeps a credential-requiring remote from hanging on an interactive
// prompt. Together with `--no-edit` on the merge path, no git invocation here can open an
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

// Porcelain file list backing the lockfile-only classifier: one entry per dirty path parsed
// from `git status --porcelain` (each line is `XY<space>path`; renames surface as
// `old -> new` and contribute both sides so the classifier stays conservative). Empty output
// means a clean tree. A non-zero exit is a controlled git-status-error. `expandUntracked`
// adds `--untracked-files=all`, so an untracked directory is listed file by file (the
// discard resolution's captured `discardedPaths`); the default is git's collapsed `dir/`.
export async function listDirtyPaths(
  repoPath: string,
  opts?: { expandUntracked?: boolean; excludePaths?: string[] },
): Promise<Result<string[]>> {
  const args = [
    'status',
    '--porcelain',
    ...(opts?.expandUntracked === true ? ['--untracked-files=all'] : []),
    ...excludePathspecs(opts?.excludePaths),
  ];
  const result = await runProcess('git', args, { cwd: repoPath });
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

// Path-scoped discard (`git checkout -- <paths>` equivalent) for the lockfile-only auto-fix.
// The `--` terminates option parsing so a path starting with `-` is never treated as a flag.
// An empty list is a no-op success.
export async function discardPaths(repoPath: string, paths: string[]): Promise<Result<void>> {
  if (paths.length === 0) {
    return ok(undefined);
  }
  const result = await runProcess('git', ['checkout', '--', ...paths], { cwd: repoPath });
  if (result.status !== 0) {
    return err('git-discard-error', `git checkout -- failed in ${repoPath}: ${spawnFailureDetail(result)}`);
  }
  return ok(undefined);
}

// Read-only list of the paths differing between two revisions, used by the
// activation pre-flight. `-z` keeps paths with spaces/quotes/non-ASCII bytes raw (no C-style
// quoting); `--no-renames` lists BOTH sides of a rename (with rename detection only the new
// side shows, so a dirty old-side path would never be flagged at risk); the trailing `--`
// forces both arguments to be read as revisions. A large maxBuffer keeps a big diff from
// failing with ENOBUFS.
export async function diffNameOnly(repoPath: string, from: string, to: string): Promise<Result<string[]>> {
  const result = await runProcess('git', ['diff', '--name-only', '--no-renames', '-z', from, to, '--'], {
    cwd: repoPath,
    maxBuffer: LARGE_OUTPUT_BUFFER,
  });
  if (result.status !== 0) {
    return err('git-diff-error', `git diff --name-only ${from} ${to} failed in ${repoPath}: ${spawnFailureDetail(result)}`);
  }
  return ok(String(result.stdout).split('\0').filter((path) => path !== ''));
}

export async function headRevision(repoPath: string): Promise<Result<string>> {
  const result = await runProcess('git', ['rev-parse', 'HEAD'], { cwd: repoPath });
  if (result.status !== 0) {
    return err('git-rev-parse-error', `git rev-parse HEAD failed in ${repoPath}: ${spawnFailureDetail(result)}`);
  }
  return ok(String(result.stdout).trim());
}

// `--numstat -z` rows are `ins\tdel\tpath\0`; binary files report `-` for both counts and
// count as a file with 0 lines. `--no-renames` keeps one row per path, no extra NUL fields.
export async function diffStat(
  repoPath: string,
  from: string,
  to: string,
): Promise<Result<{ files: number; insertions: number; deletions: number }>> {
  const result = await runProcess('git', ['diff', '--numstat', '--no-renames', '-z', from, to, '--'], {
    cwd: repoPath,
    maxBuffer: LARGE_OUTPUT_BUFFER,
  });
  if (result.status !== 0) {
    return err('git-diff-error', `git diff --numstat ${from} ${to} failed in ${repoPath}: ${spawnFailureDetail(result)}`);
  }
  let files = 0;
  let insertions = 0;
  let deletions = 0;
  for (const row of String(result.stdout).split('\0')) {
    if (row === '') {
      continue;
    }
    const [ins, del] = row.split('\t');
    files += 1;
    insertions += Number(ins) || 0;
    deletions += Number(del) || 0;
  }
  return ok({ files, insertions, deletions });
}

// 64 MiB: the stdout budget of the path-listing calls above/below (spawnSync's default is 1 MiB).
const LARGE_OUTPUT_BUFFER = 64 * 1024 * 1024;

// How many paths one git invocation receives, so a huge confirmed list never hits E2BIG.
const PATHS_PER_CALL = 500;

function chunked(paths: readonly string[]): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < paths.length; index += PATHS_PER_CALL) {
    chunks.push(paths.slice(index, index + PATHS_PER_CALL));
  }
  return chunks;
}

// Consent-gated, path-scoped discard back to HEAD (see the GitPort doc comment).
// Every call runs with the global `--literal-pathspecs`, so a confirmed path such as
// `src/[id].tsx` is never read as a glob that would also match unconfirmed siblings; paths are
// passed in chunks of PATHS_PER_CALL. Three steps, each scoped by `--` to exactly the paths:
//   1. `git reset -q -- paths` drops any staged content (a no-op for a purely untracked path);
//   2. `git checkout HEAD -- <paths HEAD has>` (found with `ls-tree -r`) restores them;
//   3. `git clean -f -- <the rest>` removes the untracked leftovers (never `-x`, never `-d`).
export async function discardPathsToHead(repoPath: string, paths: string[]): Promise<Result<void>> {
  if (paths.length === 0) {
    return ok(undefined);
  }
  const git = (args: string[], maxBuffer?: number) =>
    runProcess('git', ['--literal-pathspecs', ...args], { cwd: repoPath, ...(maxBuffer ? { maxBuffer } : {}) });
  const chunks = chunked(paths);

  for (const chunk of chunks) {
    const reset = await git(['reset', '-q', '--', ...chunk]);
    if (reset.status !== 0) {
      return err('git-discard-error', `git reset -- failed in ${repoPath}; nothing was discarded: ${spawnFailureDetail(reset)}`);
    }
  }

  const inHead = new Set<string>();
  for (const chunk of chunks) {
    const listed = await git(['ls-tree', '-r', '-z', '--name-only', 'HEAD', '--', ...chunk], LARGE_OUTPUT_BUFFER);
    if (listed.status !== 0) {
      return err(
        'git-discard-error',
        `git ls-tree HEAD failed in ${repoPath}; the paths were unstaged but nothing was discarded: ${spawnFailureDetail(listed)}`,
      );
    }
    for (const path of String(listed.stdout).split('\0')) {
      if (path !== '') {
        inHead.add(path);
      }
    }
  }

  for (const chunk of chunked(paths.filter((path) => inHead.has(path)))) {
    const restored = await git(['checkout', 'HEAD', '--', ...chunk]);
    if (restored.status !== 0) {
      return err('git-discard-error', `git checkout HEAD -- failed in ${repoPath}: ${spawnFailureDetail(restored)}`);
    }
  }
  for (const chunk of chunked(paths.filter((path) => !inHead.has(path)))) {
    const cleaned = await git(['clean', '-f', '-q', '--', ...chunk]);
    if (cleaned.status !== 0) {
      return err(
        'git-discard-error',
        `git clean -f -- failed in ${repoPath} after tracked paths were already restored: ${spawnFailureDetail(cleaned)}`,
      );
    }
  }
  return ok(undefined);
}

// The one consent-gated destructive primitive (see the GitPort doc comment):
// `git reset --hard` drops every tracked modification (staged or not), then `git clean -fd`
// removes untracked files and directories. Never `-x` (ignored files — .env, node_modules,
// build output — always survive) and never `-ff` (a nested repository is never removed).
// Only switch.ts calls this, under an explicit per-repo `discard` resolution.
export async function discardAll(repoPath: string): Promise<Result<void>> {
  const reset = await runProcess('git', ['reset', '--hard'], { cwd: repoPath });
  if (reset.status !== 0) {
    return err(
      'git-discard-error',
      `discardAll step 1/2 (git reset --hard) failed in ${repoPath}; untracked files were not cleaned: ${spawnFailureDetail(reset)}`,
    );
  }
  const clean = await runProcess('git', ['clean', '-fd'], { cwd: repoPath });
  if (clean.status !== 0) {
    return err(
      'git-discard-error',
      `discardAll step 2/2 (git clean -fd) failed in ${repoPath} after tracked changes were already reset: ${spawnFailureDetail(clean)}`,
    );
  }
  return ok(undefined);
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
): Promise<Result<void>> {
  const allowedOld = await assertAllowedBranch(manifest, repoPath, oldName);
  if (!allowedOld.ok) {
    return allowedOld;
  }
  const allowed = await assertAllowedBranch(manifest, repoPath, newName);
  if (!allowed.ok) {
    return allowed;
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

async function showRef(repoPath: string, branchName: string): Promise<ShowRefOutcome> {
  return await showFullRef(repoPath, `refs/heads/${branchName}`);
}

async function showFullRef(repoPath: string, fullRef: string): Promise<ShowRefOutcome> {
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

// The branch-scope gate for a write that has no branch argument: judges the repo's current
// branch (a detached HEAD fails as `git-current-branch-error`, never writes).
async function assertCurrentBranchAllowed(manifest: ManifestPort, repoPath: string): Promise<Result<void>> {
  const branch = await currentBranch(repoPath);
  if (!branch.ok) {
    return branch;
  }
  return assertAllowedBranch(manifest, repoPath, branch.data);
}

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
