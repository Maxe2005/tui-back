// core/ports/git: the git port contract (AD-8). Every git write goes through an implementation
// of this port; the driven adapter enforces the branch-scope gate centrally, resolving the
// protected set from the repo's own manifest at write time. `assertAllowedBranch` is that gate
// — any call site recording a branch as an EDT's own must call it first. With an `edtId` it
// also rejects a branch registered as a *different* EDT's own branch for that repo.
import type { Result } from '../result.js';

export interface GitPort {
  // Rejects (before any git write) a branchName that is protected for this repo — the
  // protected set (the manifest's protectedBranches ∪ its sharedBranch) is resolved by the
  // adapter itself at check time, never trusted from the caller. When edtId is passed and the
  // adapter has an EdtRegistryPort wired in, it additionally rejects a branchName already
  // registered as a *different* EDT's own branch for this repo.
  assertAllowedBranch(repoPath: string, branchName: string, edtId?: string): Promise<Result<void>>;
  // Creates branchName from baseBranch without checking it out. baseBranch may be a local
  // branch (`refs/heads/`) or a remote-tracking ref (`refs/remotes/`, e.g. `origin/release`);
  // the new branch never inherits an upstream from its base (`--no-track`).
  createBranch(repoPath: string, branchName: string, baseBranch: string): Promise<Result<void>>;
  // Deletes a branch ref that this tool created (rollback of a failed EDT creation) or that a
  // developer explicitly chose to delete. Shares createBranch's shared-branch gate. `force`
  // selects `git branch -d` (false — refuses an unmerged branch) vs. `-D` (true —
  // unconditional); the caller decides which is appropriate (e.g. via isBranchMerged +
  // hasUncommittedChanges), from freshly read state.
  deleteBranch(repoPath: string, branchName: string, force: boolean): Promise<Result<void>>;
  // True when branchName is already merged into `into` (`git merge-base --is-ancestor
  // branchName into`) — local-only, no fetch. Decides `-d` vs `-D` on EDT delete and the
  // delete-by-default disposition in the TUI. Never a safety gate itself — it never rejects
  // anything and takes no edtId, unlike assertAllowedBranch.
  isBranchMerged(repoPath: string, branchName: string, into: string): Promise<Result<boolean>>;
  currentBranch(repoPath: string): Promise<Result<string>>;
  // { ahead, behind } of the current branch relative to its configured upstream (git's own
  // tracking config, never a manifest field). Never fabricates a number — callers distinguish
  // three cases by the Result shape alone:
  //   - ok:true            -> upstream resolved; { ahead, behind } are real counts.
  //   - err code
  //     'no-upstream'      -> no upstream is configured for the current branch at all.
  //     'unknown-offline'  -> an upstream *is* configured but its remote-tracking ref
  //                           cannot currently be resolved (never fetched yet, remote
  //                           branch deleted, or any other git error).
  //     (anything else)    -> an unexpected git failure (e.g. not a git repository); callers
  //                           fold this into the same "unknown (offline)" treatment.
  aheadBehind(repoPath: string): Promise<Result<{ ahead: number; behind: number }>>;
  // Moves the working tree onto branchName (must already exist locally — this method never
  // creates a branch). Never gates by itself: callers (switch.ts) decide when a target is
  // safe to check into, via assertAllowedBranch for a member's own branch, or unconditionally
  // for a non-member's shared branch (FR-8 explicitly allows that checkout).
  checkout(repoPath: string, branchName: string): Promise<Result<void>>;
  // True when the working tree has tracked or untracked changes (`git status --porcelain`
  // is non-empty) — the trigger for stashSave before any checkout touches the repo.
  // `excludePaths` (literal repo-root paths) are ignored when deciding whether the tree is dirty.
  hasUncommittedChanges(repoPath: string, opts?: { excludePaths?: string[] }): Promise<Result<boolean>>;
  // `git stash push -u -m message` — tracked + untracked. Message-tagged (not
  // position-tagged) so restoreStash can find it later regardless of other stashes.
  stashSave(repoPath: string, message: string): Promise<Result<void>>;
  // Pops the stash whose message matches (git-stash-message-tagged, not stack-position —
  // safe even if the developer's own unrelated stashes exist). A no-op success when no
  // matching stash exists: not every switch pops one, only a return into an EDT that owns one.
  restoreStash(repoPath: string, message: string): Promise<Result<void>>;
  // True iff a stash whose message contains `tag` exists in repoPath — the same
  // message-substring match restoreStash uses, but non-destructive (existence only, never
  // pops). EDT delete uses it to detect a member's own `tui-back:<edtUlid>` stash: real
  // uncommitted work on that member's branch, whatever repoPath currently has checked out.
  hasStash(repoPath: string, tag: string): Promise<Result<boolean>>;
  branchExistsLocally(repoPath: string, branchName: string): Promise<Result<boolean>>;
  // Fetches branchName from origin into a same-named local branch (`git fetch origin
  // branch:branch`) — used only when branchExistsLocally reported false for a non-member
  // repo's manifest sharedBranch. Never used for a member's own branch: a missing member
  // branch is reported failed, never auto-fetched.
  fetch(repoPath: string, branchName: string): Promise<Result<void>>;
  // Plain `git fetch origin <branch>`: refreshes `origin/<branch>` only and never touches the
  // local branch, so it cannot be rejected as non-fast-forward. The "simple fetch" an
  // unpushed-commits blocker offers when `fetch` could not update the local branch.
  fetchRemote(repoPath: string, branchName: string): Promise<Result<void>>;
  // `<hash> <subject>` lines of the local commits of branchName that origin/<branchName> does
  // not have (`git log origin/<branch>..<branch>`), oldest first. Reads the remote-tracking
  // ref as it stands — callers refresh it with `fetchRemote` first.
  listUnpushedCommits(repoPath: string, branchName: string): Promise<Result<string[]>>;
  // Plain `git pull` on the current branch — used only when a member already sits on its
  // manifest sharedBranch (the merge path below would be a self-merge). Pulls of the shared
  // branch carry no write-gate.
  pull(repoPath: string): Promise<Result<void>>;
  // True while a conflicting merge *or* pull is still in progress (MERGE_HEAD exists) — lets
  // the group-update use-case abort a conflicting `git pull` back to the pre-run HEAD the same
  // way it aborts a conflicting merge. An unresolvable check (git itself unspawnable) is the
  // only failure mode; anything else reads as "no merge in progress", never a throw.
  isMergeInProgress(repoPath: string): Promise<Result<boolean>>;
  // `git merge <branch>` of the (already fetched) shared branch into the member's own current
  // branch — never a rebase. A conflicting merge surfaces as `merge-conflict` (distinct from
  // any other `git-merge-error`); the caller aborts via abortMerge below so the repo lands
  // back at its pre-run HEAD.
  mergeBranch(repoPath: string, branch: string): Promise<Result<void>>;
  // `git merge --abort` — cancels an in-progress conflicting merge, restoring the pre-run
  // HEAD. Never discards developer work: abort only cancels the attempted merge.
  abortMerge(repoPath: string): Promise<Result<void>>;
  // Porcelain file list backing the lockfile-only classifier — the raw `git status
  // --porcelain` paths (one entry per dirty path; renames surface both sides so the
  // classifier stays conservative). Empty when the tree is clean. The opt-in
  // `expandUntracked` lists every file inside an untracked directory
  // (`--untracked-files=all`) instead of the directory itself — switch.ts uses it to capture
  // exactly what a `discard` resolution removes.
  listDirtyPaths(repoPath: string, opts?: { expandUntracked?: boolean; excludePaths?: string[] }): Promise<Result<string[]>>;
  // Path-scoped discard (`git checkout -- <paths>` equivalent) for the lockfile-only
  // auto-fix. Never touches paths outside the given list.
  discardPaths(repoPath: string, paths: string[]): Promise<Result<void>>;
  // THE one consent-gated destructive primitive — `git reset --hard` then `git clean -fd`
  // (never `-x`: ignored files are never touched; never `-ff`: nested repos are never
  // removed). Its only permitted caller is core/edt/switch.ts, and only under an explicit
  // per-repo `discard` resolution supplied by the developer. Fails `git-discard-error`.
  discardAll(repoPath: string): Promise<Result<void>>;
  // The paths that differ between two revisions (`git diff --name-only -z from to --`),
  // repo-root relative — read-only, gated nowhere. Backs activate.ts's pre-flight: the
  // uncommitted paths a checkout from `from` to `to` would overwrite are the dirty paths that
  // also appear here. Fails `git-diff-error`.
  diffNameOnly(repoPath: string, from: string, to: string): Promise<Result<string[]>>;
  // The commit HEAD currently points at (`git rev-parse HEAD`) — read-only, gated nowhere.
  // Fails `git-rev-parse-error` (e.g. an unborn HEAD).
  headRevision(repoPath: string): Promise<Result<string>>;
  // Line/file totals between two revisions (`git diff --numstat from to`) — read-only, gated
  // nowhere. A binary file counts as one file with 0 lines. Fails `git-diff-error`.
  diffStat(repoPath: string, from: string, to: string): Promise<Result<{ files: number; insertions: number; deletions: number }>>;
  // Consent-gated, path-scoped discard back to HEAD — only core/edt/activate.ts
  // calls it, and only for at-risk paths the developer explicitly confirmed overwriting. Per
  // path, whatever its state: unstaged (`reset -q -- paths`), then restored from HEAD when HEAD
  // has it (`checkout HEAD -- …`), else removed as untracked (`clean -f -- …`). Never touches a
  // path outside the list, never ignored files (no `-x`). Unlike `discardPaths` (index
  // checkout), it handles untracked and staged paths. An empty list is a no-op success.
  // Fails `git-discard-error`.
  discardPathsToHead(repoPath: string, paths: string[]): Promise<Result<void>>;
  // True while a `git rebase` is still in progress (rebase-merge/rebase-apply
  // state dirs exist under the repo's git dir). The tool never touches a rebase — this is
  // only a detector so a pre-existing mid-rebase surfaces as its own distinct state.
  // Mirror of isMergeInProgress's contract: only an unresolvable check fails.
  isRebaseInProgress(repoPath: string): Promise<Result<boolean>>;
  // True while unmerged (conflicted) paths remain (`git diff --name-only
  // --diff-filter=U` is non-empty) — the re-verification gate before finalizing a
  // human-resolved merge.
  hasUnmergedPaths(repoPath: string): Promise<Result<boolean>>;
  // The conflicted paths (`git diff --name-only --diff-filter=U -z`), repo-root relative —
  // read-only, gated nowhere. Backs the auto-resolve seam of a mid-run conflict.
  listUnmergedPaths(repoPath: string): Promise<Result<string[]>>;
  // The worktree content of a repo-relative file as it stands (conflict markers included).
  // Read-only, gated nowhere. Fails `git-read-error`.
  readWorktreeFile(repoPath: string, path: string): Promise<Result<string>>;
  // Overwrites a repo-relative file with `content` and, when `stage` is set, stages exactly
  // that path (`git add -- <path>`). Gated: the current branch must pass assertAllowedBranch
  // before anything is written. Fails `git-write-error` / `git-add-error`.
  writeResolvedFile(repoPath: string, path: string, content: string, opts: { stage: boolean }): Promise<Result<void>>;
  // Takes one conflicted path from the current branch's side (`git checkout --ours -- <path>`)
  // into the worktree without staging it. Same current-branch gate. Fails `git-checkout-error`.
  checkoutSide(repoPath: string, path: string, side: 'ours'): Promise<Result<void>>;
  // `git commit --no-edit` — finalizes a human-resolved merge after
  // hasUnmergedPaths reported clean. Never resolves conflict content itself.
  finalizeMerge(repoPath: string): Promise<Result<void>>;
  // Local branches only — never fetches, never lists remote-tracking refs (see
  // listRemoteBranches for those). The branch-picker's candidate source.
  listBranches(repoPath: string): Promise<Result<string[]>>;
  // Renames a local branch ref (`git branch -m`). Gates *both* names via assertAllowedBranch
  // (no edtId, like createBranch) before touching git, so a rename can neither land on a
  // protected name nor move a protected branch away. Also rejects `branch-owned-by-other-edt`
  // (before any git call) when the old or new name is another registered EDT's own branch for
  // this repo; `edtId` is the caller's own EDT (its branches are exempt) — omitted, any
  // registered owner blocks.
  renameBranch(repoPath: string, oldName: string, newName: string, edtId?: string): Promise<Result<void>>;
  // The remote-tracking refs already known locally (`refs/remotes/`), as `<remote>/<branch>`
  // names (e.g. `origin/feat/x`); the symbolic `<remote>/HEAD` ref is excluded. Never fetches —
  // it lists only what the last fetch left behind.
  listRemoteBranches(repoPath: string): Promise<Result<string[]>>;
  // Creates local branch `localName` tracking the remote-tracking ref `remoteRef`
  // (`git branch --track -- <localName> <remoteRef>`) — a ref write only, never a checkout.
  // Gates `localName` via assertAllowedBranch before any git call; `branch-exists` when
  // `localName` already exists locally; `remote-branch-missing` when `refs/remotes/<remoteRef>`
  // is absent (never fetches to find it).
  createTrackingBranch(repoPath: string, localName: string, remoteRef: string): Promise<Result<void>>;
  // Stages exactly `paths` (`git add -- <paths>`) — never `-A`/`.`, so every other dirty file
  // stays untouched. Gated: the repo's current branch must pass assertAllowedBranch before any
  // git call (a protected/shared branch is refused with `shared-branch-rejected`). An empty list is a
  // no-op success. Fails `git-add-error`.
  stagePaths(repoPath: string, paths: string[]): Promise<Result<void>>;
  // Path-scoped commit (`git commit -m <message> --only -- <paths>`): records only `paths`, so
  // anything else staged or dirty is left out of the commit. Same current-branch gate as
  // stagePaths. Never pushes. Fails `git-commit-error` (e.g. nothing to commit).
  commit(repoPath: string, message: string, paths: string[]): Promise<Result<void>>;

  // Read-only history walk over the commits that touch the repo's root `package.json`, newest
  // first, streamed: `onEntry` is called per commit whose diff adds a `"version": "x.y.z"` line
  // (a version bump). `ref` is a branch/revision (never starting with `-`); with
  // `opts.allRefs` the walk covers every local and remote-tracking branch instead (stash, notes
  // and tags excluded) and `ref` is ignored — pass `pickaxeVersion` then, to only walk commits
  // adding that exact version string. The walk
  // stops after `limit` bumps (`endedBy: 'limit'`), once `maxScanned` package.json-touching
  // commits were looked at (`'scanned'`), when the history runs out (`'exhausted'`), or when
  // `signal` aborts (`'aborted'` — the git child is killed; still an `ok` result). Never fetches
  // or writes. Fails `git-history-error` (unknown ref, shallow clone, git unreachable).
  listVersionBumpCommits(repoPath: string, ref: string, opts: VersionBumpWalkOptions): Promise<Result<VersionBumpWalkSummary>>;
  // Every local and remote-tracking branch containing `commit` (`<remote>/<branch>` names for
  // the latter; symbolic `<remote>/HEAD` excluded). Read-only. Fails `git-history-error`, or
  // `git-history-aborted` when `signal` aborted before the answer was complete.
  listBranchesContaining(repoPath: string, commit: string, signal?: AbortSignal): Promise<Result<string[]>>;
}

export interface VersionBump {
  version: string;
  commit: string;
  // Author date, strict ISO 8601.
  date: string;
}

export type VersionWalkEnd = 'limit' | 'scanned' | 'exhausted' | 'aborted';

export interface VersionBumpWalkOptions {
  limit: number;
  maxScanned: number;
  signal?: AbortSignal;
  onEntry: (bump: VersionBump) => void;
  pickaxeVersion?: string;
  // Walk every local and remote-tracking branch instead of one `ref`.
  allRefs?: boolean;
}

export interface VersionBumpWalkSummary {
  endedBy: VersionWalkEnd;
  scanned: number;
}
