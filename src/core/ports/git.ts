// core/ports/git: the git port contract (AD-8). Every git write in the tool passes through
// an implementation of this port — the driven git adapter enforces the branch-scope safety
// gate centrally (it resolves the shared-branch set from the repo's own manifest at write
// time and rejects a shared target before any `git` invocation). `assertAllowedBranch` is the
// reusable gate itself (adapter-resolved, never caller-trusted); `createBranch`/`deleteBranch`
// delegate to it, and any call site recording a branch as an EDT's own (e.g. the
// branch-creation-disabled path at EDT creation) must call it first too. Core consumes the
// contract without ever importing the adapter (AD-1).
//
// Story 2.4 extends the port for the EDT-switch use-case: `checkout`/`hasUncommittedChanges`/
// `stashSave`/`restoreStash` implement auto-preserved, lossless branch switching per repo;
// `branchExistsLocally`/`fetch` resolve a non-member repo's shared branch when it isn't
// present locally yet. `assertAllowedBranch` gains an optional `edtId` param closing AD-8's
// cross-EDT half: when passed (with an EdtRegistryPort wired into the adapter), it also
// rejects a branch already registered as a *different* EDT's own branch for that repo —
// existing (no-`edtId`) call sites (createBranch/deleteBranch, create.ts) are unaffected.
//
// Story 2.29 (delete an EDT): `deleteBranch` widens with a required `force` flag — the
// delete use-case always decides `-d` (merged+clean) vs. `-D` (force) itself from real,
// freshly-read git state, never trusting a caller's stale/optimistic guess. Every existing
// call site (create.ts's rollback path) now passes `force: true` explicitly, preserving its
// pre-2.29 `-D` rollback behavior exactly. `isBranchMerged` is new: an ordinary (non-gated)
// local read used only to decide *how* to delete a branch that was already independently
// authorized for deletion — never itself a safety gate, so it takes no edtId/manifest args.
import type { Result } from '../result.js';

export interface GitPort {
  // Rejects (before any git write) a branchName that is shared/protected for this repo — the
  // shared-branch set (development/preprod/prod ∪ the repo's manifest sharedBranch) is
  // resolved by the adapter itself at check time, never trusted from the caller. When edtId
  // is passed (story 2.4) and the adapter has an EdtRegistryPort wired in, it additionally
  // rejects a branchName already registered as a *different* EDT's own branch for this repo.
  assertAllowedBranch(repoPath: string, branchName: string, edtId?: string): Promise<Result<void>>;
  // Creates branchName from baseBranch without checking it out. Story 2.35: baseBranch may be
  // a local branch (`refs/heads/`) or a remote-tracking ref (`refs/remotes/`, e.g.
  // `origin/release`); the new branch never inherits an upstream from its base (`--no-track`).
  createBranch(repoPath: string, branchName: string, baseBranch: string): Promise<Result<void>>;
  // Deletes a branch ref that this tool created (rollback path: a failed EDT creation must
  // not leave orphaned branch refs behind) or that a developer explicitly chose to delete
  // (story 2.29's EDT-delete flow). Shares createBranch's shared-branch gate. `force` selects
  // `git branch -d` (false — refuses an unmerged branch) vs. `-D` (true — unconditional) at
  // the git-invocation level; the caller (not this method) is responsible for having already
  // decided which is appropriate (e.g. via isBranchMerged + hasUncommittedChanges).
  deleteBranch(repoPath: string, branchName: string, force: boolean): Promise<Result<void>>;
  // Story 2.29: true when branchName is already merged into `into` (`git merge-base
  // --is-ancestor branchName into`) — local-only, no fetch. Used by the EDT-delete use-case
  // to decide `-d` vs `-D`, and by its caller (the TUI) to compute a member row's
  // delete-by-default disposition. Never a safety gate itself — it never rejects anything and
  // takes no edtId, unlike assertAllowedBranch.
  isBranchMerged(repoPath: string, branchName: string, into: string): Promise<Result<boolean>>;
  currentBranch(repoPath: string): Promise<Result<string>>;
  // Story 2.6 (FR-9): { ahead, behind } counts of the current branch relative to its
  // configured upstream (git's own branch.<name>.remote/merge tracking config — never a
  // manifest field, so this always reflects the repo's real, live git state). Never
  // fabricates a numeric value when there is nothing to compute from — the caller
  // distinguishes three cases by the Result shape alone:
  //   - ok:true            -> upstream resolved; { ahead, behind } are real counts.
  //   - err code
  //     'no-upstream'      -> no upstream is configured for the current branch at all
  //                           (core/edt/list.ts renders this as the explicit "no upstream"
  //                           state, never a numeric value).
  //     'unknown-offline'  -> an upstream *is* configured but its remote-tracking ref
  //                           cannot currently be resolved (never fetched yet, remote
  //                           branch deleted, or any other git error) — rendered as the
  //                           explicit "unknown (offline)" state, never stale/zero values.
  //     (anything else)    -> an unexpected git failure (e.g. not a git repository); callers
  //                           fold this into the same "unknown (offline)" treatment per the
  //                           spec's I/O matrix ("git error -> show unknown (offline) or
  //                           detail in dim-annotation").
  aheadBehind(repoPath: string): Promise<Result<{ ahead: number; behind: number }>>;
  // Moves the working tree onto branchName (must already exist locally — this method never
  // creates a branch). Never gates by itself: callers (switch.ts) decide when a target is
  // safe to check into, via assertAllowedBranch for a member's own branch, or unconditionally
  // for a non-member's shared branch (FR-8 explicitly allows that checkout).
  checkout(repoPath: string, branchName: string): Promise<Result<void>>;
  // True when the working tree has tracked or untracked changes (`git status --porcelain`
  // is non-empty) — the trigger for stashSave before any checkout touches the repo.
  hasUncommittedChanges(repoPath: string): Promise<Result<boolean>>;
  // `git stash push -u -m message` — tracked + untracked. Message-tagged (not
  // position-tagged) so restoreStash can find it later regardless of other stashes.
  stashSave(repoPath: string, message: string): Promise<Result<void>>;
  // Pops the stash whose message matches (git-stash-message-tagged, not stack-position —
  // safe even if the developer's own unrelated stashes exist). A no-op success when no
  // matching stash exists: not every switch pops one, only a return into an EDT that owns one.
  restoreStash(repoPath: string, message: string): Promise<Result<void>>;
  // Story 2.29: true iff a stash whose message contains `tag` exists in repoPath — the same
  // message-substring match restoreStash uses, but non-destructive (existence only, never
  // pops). Backs the EDT-delete use-case's corrected clean-detection: a member's own
  // `tui-back:<edtUlid>` stash (the tag switch.ts writes when switching *away* from that EDT)
  // signals real, still-uncommitted work belonging to that member's own branch, independent
  // of whatever repoPath's working tree currently happens to have checked out.
  hasStash(repoPath: string, tag: string): Promise<Result<boolean>>;
  branchExistsLocally(repoPath: string, branchName: string): Promise<Result<boolean>>;
  // Fetches branchName from origin into a same-named local branch (`git fetch origin
  // branch:branch`) — used only when branchExistsLocally reported false for a non-member
  // repo's manifest sharedBranch. Never used for a member's own branch (spec: a missing
  // member branch is reported failed, never auto-fetched).
  fetch(repoPath: string, branchName: string): Promise<Result<void>>;
  // Story 3.1: plain `git pull` on the current branch — used only when a member already sits
  // on its manifest sharedBranch (the merge path below would be a self-merge). Follows the
  // switch.ts precedent: pulls of the shared branch carry no write-gate.
  pull(repoPath: string): Promise<Result<void>>;
  // Story 3.1 (review): true while a conflicting merge *or* pull is still in progress
  // (MERGE_HEAD exists) — lets the group-update use-case abort a conflicting `git pull`
  // back to the pre-run HEAD the same way it aborts a conflicting merge. An unresolvable
  // check (git itself unspawnable) is the only failure mode; anything else reads as
  // "no merge in progress", never a throw.
  isMergeInProgress(repoPath: string): Promise<Result<boolean>>;
  // Story 3.1: `git merge <branch>` of the (already fetched) shared branch into the member's
  // own current branch — never a rebase. A conflicting merge surfaces as `merge-conflict`
  // (distinct from any other `git-merge-error`); the caller aborts via abortMerge below so
  // the repo lands back at its pre-run HEAD.
  mergeBranch(repoPath: string, branch: string): Promise<Result<void>>;
  // Story 3.1: `git merge --abort` — cancels an in-progress conflicting merge, restoring the
  // pre-run HEAD. Never discards developer work: abort only cancels the attempted merge.
  abortMerge(repoPath: string): Promise<Result<void>>;
  // Story 3.4: porcelain file list backing the lockfile-only classifier — the raw
  // `git status --porcelain` paths (one entry per dirty path; renames surface both sides so
  // the classifier stays conservative). Empty when the tree is clean.
  listDirtyPaths(repoPath: string): Promise<Result<string[]>>;
  // Story 3.4: path-scoped discard (`git checkout -- <paths>` equivalent) for the
  // lockfile-only auto-fix. Never touches paths outside the given list.
  discardPaths(repoPath: string, paths: string[]): Promise<Result<void>>;
  // Story 3.4: true while a `git rebase` is still in progress (rebase-merge/rebase-apply
  // state dirs exist under the repo's git dir). The tool never touches a rebase — this is
  // only a detector so a pre-existing mid-rebase surfaces as its own distinct state.
  // Mirror of isMergeInProgress's contract: only an unresolvable check fails.
  isRebaseInProgress(repoPath: string): Promise<Result<boolean>>;
  // Story 3.4: true while unmerged (conflicted) paths remain (`git diff --name-only
  // --diff-filter=U` is non-empty) — the re-verification gate before finalizing a
  // human-resolved merge.
  hasUnmergedPaths(repoPath: string): Promise<Result<boolean>>;
  // Story 3.4: `git commit --no-edit` — finalizes a human-resolved merge after
  // hasUnmergedPaths reported clean. Never resolves conflict content itself.
  finalizeMerge(repoPath: string): Promise<Result<void>>;
  // Story 2.26: the branch-picker's candidate source for both its filterable-list widget's
  // uses (base-branch candidates for Create new, target-branch candidates for Pick existing).
  // Local-only, mirroring branchExistsLocally's scope (Boundaries: "Remote-branch listing —
  // listBranches stays local-only") — never fetches, never lists remote-tracking refs.
  listBranches(repoPath: string): Promise<Result<string[]>>;
  // Story 2.26: renames a local branch ref (`git branch -m`) — backs both Pick existing's
  // per-row inline-rename action and Rename current. Story 2.35: gates *both* names via
  // assertAllowedBranch (no edtId, mirroring createBranch's own gate) before touching git, so
  // a rename can never land on a shared/protected branch name any more than a create can, nor
  // rename a shared/protected branch (e.g. `development`) away.
  renameBranch(repoPath: string, oldName: string, newName: string): Promise<Result<void>>;
  // Story 2.35: the remote-tracking refs already known locally (`refs/remotes/`), as
  // `<remote>/<branch>` names (e.g. `origin/feat/x`); the symbolic `<remote>/HEAD` ref is
  // excluded. Never fetches — it lists only what the last fetch left behind. listBranches
  // stays local-only; this is its remote-side sibling.
  listRemoteBranches(repoPath: string): Promise<Result<string[]>>;
  // Story 2.35: creates local branch `localName` tracking the remote-tracking ref `remoteRef`
  // (`git branch --track -- <localName> <remoteRef>`) — a ref write only, never a checkout.
  // Gates `localName` via assertAllowedBranch before any git call; `branch-exists` when
  // `localName` already exists locally; `remote-branch-missing` when `refs/remotes/<remoteRef>`
  // is absent (never fetches to find it).
  createTrackingBranch(repoPath: string, localName: string, remoteRef: string): Promise<Result<void>>;
}
