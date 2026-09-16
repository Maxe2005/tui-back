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
import type { Result } from '../result.js';

export interface GitPort {
  // Rejects (before any git write) a branchName that is shared/protected for this repo — the
  // shared-branch set (development/preprod/prod ∪ the repo's manifest sharedBranch) is
  // resolved by the adapter itself at check time, never trusted from the caller. When edtId
  // is passed (story 2.4) and the adapter has an EdtRegistryPort wired in, it additionally
  // rejects a branchName already registered as a *different* EDT's own branch for this repo.
  assertAllowedBranch(repoPath: string, branchName: string, edtId?: string): Promise<Result<void>>;
  createBranch(repoPath: string, branchName: string, baseBranch: string): Promise<Result<void>>;
  // Deletes a branch ref that this tool created (rollback path: a failed EDT creation must
  // not leave orphaned branch refs behind). Shares createBranch's shared-branch gate.
  deleteBranch(repoPath: string, branchName: string): Promise<Result<void>>;
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
  branchExistsLocally(repoPath: string, branchName: string): Promise<Result<boolean>>;
  // Fetches branchName from origin into a same-named local branch (`git fetch origin
  // branch:branch`) — used only when branchExistsLocally reported false for a non-member
  // repo's manifest sharedBranch. Never used for a member's own branch (spec: a missing
  // member branch is reported failed, never auto-fetched).
  fetch(repoPath: string, branchName: string): Promise<Result<void>>;
  // Story 2.26: the branch-picker's candidate source for both its filterable-list widget's
  // uses (base-branch candidates for Create new, target-branch candidates for Pick existing).
  // Local-only, mirroring branchExistsLocally's scope (Boundaries: "Remote-branch listing —
  // listBranches stays local-only") — never fetches, never lists remote-tracking refs.
  listBranches(repoPath: string): Promise<Result<string[]>>;
  // Story 2.26: renames a local branch ref (`git branch -m`) — backs both Pick existing's
  // per-row inline-rename action and Rename current. Internally gates the *new* name via
  // assertAllowedBranch (no edtId, mirroring createBranch's own gate) before touching git, so
  // a rename can never land on a shared/protected branch name any more than a create can.
  renameBranch(repoPath: string, oldName: string, newName: string): Promise<Result<void>>;
}
