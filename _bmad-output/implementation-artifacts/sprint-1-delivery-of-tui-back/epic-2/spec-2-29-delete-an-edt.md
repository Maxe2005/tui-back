---
title: 'Delete an EDT'
type: 'feature'
created: '2026-09-16'
status: 'done'
review_loop_iteration: 1
baseline_commit: '9e9ca44da5eee409e46fbc94f9c0419ff0bc7b0a'
context:
  - `{project-root}/_bmad-output/implementation-artifacts/epic-2/epic-2-context.md`
  - `{project-root}/_bmad-output/implementation-artifacts/epic-2/spec-2-25-edt-zone-structured-per-repo-failure-display-branch-collision-state.md`
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** There is no way to remove an EDT once it's no longer needed — finished/abandoned EDTs and their per-member branches accumulate with no cleanup path.

**Approach:** Add a core `delete.ts` use-case (reject outright if the target is the active EDT; otherwise, per member, leave the branch or delete it — `git branch -d` when merged+clean, `-D` when not, always gated through the existing branch-scope-safety adapter — then remove the registry entry and the EDT's SQLite file), plus a TUI `edt-delete` command/dialog and a `tui-back edt delete` CLI subcommand, following `modify.ts`/`switch.ts`'s precedents.

## Boundaries & Constraints

**Always:**
- The active EDT can never be deleted: reject before any git/file write, clear message to switch away first, never auto-switched.
- Per-member disposition defaults to "Leave branch as-is", except a branch both merged into its `sharedBranch` and clean, which defaults to "Delete branch"; every row stays independently toggleable.
- A branch chosen for deletion: `git branch -d` if merged+clean, `git branch -D` (force) otherwise — never silently downgraded to "leave" because it looked risky.
- Every branch deletion is gated through the existing `assertAllowedBranch` safety adapter, unchanged — a branch also owned by another EDT is refused per-branch (`branch-owned-by-other-edt`) without blocking the rest of the deletion or the registry-entry removal.
- Git branch deletions run per-repo isolated, outside the lock (mirrors `modify.ts`); only the final registry-entry removal + SQLite-file deletion is lock-held.
- Completion always removes the registry entry and the `<ulid>.db` file — no soft-delete, no undo.

**Ask First:** none identified — full precedent chain exists in the codebase (see Code Map).

**Never:** soft-delete/undo; auto-switching away from the active EDT; bypassing `assertAllowedBranch`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Delete non-active EDT, member merged+clean | disposition left at default | row defaults "Delete branch"; confirm → `git branch -d` | N/A |
| Delete non-active EDT, member unmerged/dirty | disposition set to "Delete" | `git branch -D` (force) | N/A |
| Delete the active EDT | target ulid === active ulid | rejected before any write | `edt-delete-active-rejected`, clear message |
| Branch chosen for deletion owned by another EDT | disposition = "Delete" | that branch deletion rejected; EDT record still deleted; other members' deletions proceed | structured row (`branch-owned-by-other-edt`), non-blocking |
| Member disposition left "Leave" | default or manually set | branch untouched | N/A |

</frozen-after-approval>

## Code Map

**(review_loop_iteration 1 note, resolved):** an earlier implementation attempt used `git.hasUncommittedChanges` alone for member-branch "clean" detection, which was wrong (see `## Design Notes` and `## Spec Change Log`) and has since been corrected in the implementation on `story-2-29-delete-an-edt` via `GitPort.hasStash` + the `isMemberBranchDirty` algorithm below. The temporary reference diff used to re-derive that fix has been removed now that it's no longer needed.

- `src/core/ports/git.ts` L19-81 -- widen `deleteBranch(repoPath, branchName)` (L29) to `deleteBranch(repoPath, branchName, force: boolean)`; add new `isBranchMerged(repoPath, branch, into): Promise<Result<boolean>>`; add new `hasStash(repoPath, tag): Promise<Result<boolean>>` (see Design Notes). Doc-comment precedent: L26-29 (deleteBranch), L76-80 (renameBranch).
- `src/adapters/driven/git/index.ts` L34-51 (factory wiring -- rewire all three methods), L60-104 (`assertAllowedBranch` gate, reuse untouched), L145-168 (current `deleteBranch` impl -- parametrize `-d`/`-D` on `force`), L192 (`currentBranch` -- needed to know whether a member's branch is the one actually checked out), L404-443 (`renameBranch`, closest precedent for a gated write + error taxonomy), L466-478 (`showRef` helper), L333-341 (`hasUncommittedChanges`), L357-372 (`restoreStash` -- extract its stash-list-and-match-by-message-substring logic (L358-364) into a shared `findStashRef(repoPath, tag): Promise<Result<string | null>>` helper; `restoreStash` pops the ref it returns, the new `hasStash` just reports whether it's non-null). `isBranchMerged` is fully new: implement via `git merge-base --is-ancestor <branch> <into>`, mirroring the exit-code-taxonomy comment style at L280-289.
- `src/core/edt/create.ts` L168-179 (`rollback()` -- template for deleting `edtDir`/`dbPath` via direct `node:fs`, no port method, per AD-1), L155-156 (`edtDir`/`dbPath` derivation), L282 (existing `git.deleteBranch` call site -- update to pass `force: true` to preserve current rollback behavior after the signature change), L77-81 (`CreateEdtMemberResult` shape family to mirror for `DeleteEdtMemberResult`).
- `src/core/edt/modify.ts` L30-64 (result/param shape family to mirror), L262-373 (pre-lock per-repo step pattern, never aborts the batch), L460-532 (lock usage -- only the final registry write is lock-held).
- `src/core/edt/switch.ts` L104-124 (reject-before-any-write pattern -- mirror for "cannot delete active EDT"), L200-202 (`failed()` row helper).
- `src/core/ports/edt-registry.ts` L40-57 (`EdtRegistryPort` -- add `remove(ulid)`); `src/adapters/driven/edt-registry/index.ts` L109-171 (`updateEdtEntry`/`setEdtStatus` -- template for new `removeEdtRegistryEntry`: read → find by ulid → `edt-not-found` if missing → filter out → write).
- `src/adapters/driving/tui/shared/components/failed-result-list.tsx` L17-49 (`FailedResultRow`/props), L32-35 (`ASSISTED_ACTIONS` -- `branch-owned-by-other-edt` fires here; strip its retry action for the delete context via `stripAssistedActionCodes`, used at `switch-dialog.tsx` L11).
- `src/adapters/driving/tui/zones/edts/dialogs/switch-dialog.tsx` (108L, full file) -- best structural precedent, confirm dialog not form: `createSwitchDialogHandlers`/`handleSwitchConfirm` L23-69, `SwitchDialogView` L87-107.
- `src/adapters/driving/tui/zones/edts/dialogs/modify-dialog.tsx` L389-406 -- per-member `CheckboxListItem` row rendering to reuse for the per-service disposition list.
- `src/adapters/driving/tui/zones/edts/edts-zone.logic.ts` L885-891 (`EdtDialogState` union -- add `DeleteDialogState`), L921-940 (dialog constructors -- template for `initialDeleteDialog`).
- `src/adapters/driving/tui/zones/edts/edts-zone.tsx` L97 (`activeEdtUlid`, source of truth for the reject-if-active check), L294-346 & L385-395 (dialog-opening effect + active/non-active branch -- add a `delete` branch, enforcing reject-if-active at open time), L429-446 (input dispatch), L674-682 (dialog render dispatch).
- `src/adapters/driving/tui/store/slices/edt-slice.ts` L145-146 & L368-381 -- add `openEdtDeleteDialog` mirroring `openEdtSwitchDialog`/`openEdtModifyDialog`; `EdtActionState.type` union gains `'delete'`.
- `src/adapters/driving/tui/commands/commands.ts` L20-43 -- add `edt-delete` entry mirroring `edt-switch`/`edt-modify` (L29-36).
- `src/adapters/driving/cli/subcommands.ts` L26-33 (usage constants), L114-122 (dispatch on `args[0]`), L396-411 (`--set-branch <path>=<branch>` parsing -- template for `--branches <repoPath>=<leave|delete>`), L46-64 (positional-arg precedent for `<topic>`).
- `src/adapters/driving/tui/shared/components/checkbox-list-item.tsx` L4-10, L19-41 -- reuse as-is (`state: 'checked'` means "Delete branch"); compose merge/clean status text alongside or into `meta`.
- Tests to extend: `git/index.test.ts`, `edt-registry/index.test.ts`, `edts-zone.test.tsx`/`.interaction.test.tsx`/`.styles.test.tsx`/`.layout.test.tsx`, `commands/commands.test.ts`, `store/app-store.test.ts`, `cli/dispatch.test.ts`, `bin/tui-back.e2e.test.ts`. New: `core/edt/delete.test.ts`. No standalone per-dialog test file exists for switch/modify — `delete-dialog.tsx` follows the same convention (covered via the zone-level suites).

## Tasks & Acceptance

**Execution:**
- [x] `src/core/ports/git.ts` -- widen `deleteBranch` to add `force: boolean`, add `isBranchMerged(repoPath, branch, into)`, add `hasStash(repoPath, tag)` -- port contract for gated force-aware delete + merge check + non-destructive stash-existence check
- [x] `src/adapters/driven/git/index.ts` -- implement `isBranchMerged` (`git merge-base --is-ancestor`), parametrize `deleteBranch`'s `-d`/`-D` on `force`, extract `findStashRef(repoPath, tag)` out of `restoreStash`'s existing list-and-match logic and implement `hasStash` on top of it, rewire factory -- fulfills the widened port
- [x] `src/adapters/driven/git/index.test.ts` -- extend for `force` param + `isBranchMerged` + `hasStash` (present/absent-tag cases) -- regression + new coverage
- [x] `src/core/edt/create.ts` L282 -- pass `force: true` to `git.deleteBranch` -- preserves existing rollback behavior after the signature change
- [x] `src/core/ports/edt-registry.ts` + `src/adapters/driven/edt-registry/index.ts` -- add `remove(ulid)` (read/find/filter/write, mirrors `updateEdtEntry`) -- registry-side deletion
- [x] `src/adapters/driven/edt-registry/index.test.ts` -- extend for `remove()` -- regression coverage
- [x] `src/core/edt/delete.ts` (new) -- reject if target is active; else per-member disposition (leave/delete, gated via `assertAllowedBranch` through `git.deleteBranch(force)`, clean-detection per Design Notes: tagged-stash check + checked-out-branch check, never `hasUncommittedChanges` alone); under lock, remove registry entry + delete `<ulid>.db`/`edtDir` -- the use-case itself
- [x] `src/core/edt/delete.test.ts` (new) -- active-EDT rejection, merged+clean default, unmerged/dirty force-delete, cross-EDT branch-collision partial failure, leave disposition, **member has a `tui-back:<ulid>`-tagged stash and nothing checked out -> treated as dirty**, **member not checked out and no matching stash -> treated as clean**, **member's branch happens to be currently checked out and dirty -> treated as dirty** -- I/O matrix + clean-detection coverage
- [x] `src/adapters/driving/tui/zones/edts/edts-zone.logic.ts` -- add `DeleteDialogState` to `EdtDialogState`, `initialDeleteDialog` constructor -- TUI state shape
- [x] `src/adapters/driving/tui/zones/edts/dialogs/delete-dialog.tsx` (new) -- confirm dialog (switch-dialog.tsx precedent) + per-member `CheckboxListItem` disposition list (modify-dialog.tsx precedent) + `FailedResultList` for partial failures -- the dialog UI
- [x] `src/adapters/driving/tui/zones/edts/edts-zone.tsx` -- reject-if-active check + open delete dialog (mirrors L385-395), input dispatch branch, render dispatch branch -- wires the dialog into the zone
- [x] `src/adapters/driving/tui/store/slices/edt-slice.ts` -- add `'delete'` to `EdtActionState.type`, add `openEdtDeleteDialog` -- store wiring
- [x] `src/adapters/driving/tui/commands/commands.ts` -- add `edt-delete` entry -- command-bar registration
- [x] `src/adapters/driving/tui/commands/commands.test.ts` -- extend for `edt-delete` -- regression
- [x] `src/adapters/driving/tui/store/app-store.test.ts` -- extend for `openEdtDeleteDialog`/delete flow -- regression
- [x] `src/adapters/driving/tui/zones/edts/edts-zone.{test,interaction.test}.tsx` -- extend for the `delete-confirm` dialog kind (state/rendering + real-keypress toggle/confirm/cancel/active-rejection coverage)
- [x] `src/adapters/driving/cli/subcommands.ts` -- add `EDT_DELETE_USAGE`, dispatch `args[0] === 'delete'`, `runEdtDelete` parsing `<topic>` + repeated `--branches <repoPath>=<leave|delete>` (mirrors `--set-branch` parsing) -- CLI surface
- [x] `src/adapters/driving/cli/dispatch.test.ts` + `src/bin/tui-back.e2e.test.ts` -- extend for `edt delete` -- CLI regression

**Acceptance Criteria:**
- Given the EDT selector, when delete is triggered on a non-active EDT (`edt-delete` command or contextual row action), then a confirmation dialog lists every member with branch, merge status, and uncommitted-work status.
- Given the target EDT is active, when delete is attempted, then it is rejected with a clear message, never auto-switched.
- Given the per-service disposition list, when rendered, defaults follow the merged+clean rule; every row stays independently toggleable.
- Given deletion completes, then the EDT no longer appears in the list and its SQLite file is removed; a per-branch collision with another EDT is reported without blocking the rest.
- `npm test`, `npm run typecheck`, `npm run depcheck` all pass.

## Spec Change Log

- **Finding (review_loop_iteration 1, verification-gap):** attempt 1's `resolveMemberDeleteStatuses`/`deleteMemberBranch` computed a member's "uncommitted-work"/clean signal via `git.hasUncommittedChanges(repoPath)` alone. That reads `git status --porcelain` against whatever branch is *currently checked out* in `repoPath` — but `deleteEdt` only ever runs against a *non-active* EDT, and per `switch.ts`'s design (message-tagged `tui-back:<ulid>` stash on switch-away), a non-active member's branch is essentially never the branch actually checked out there. The old code's "clean" signal therefore reflected whichever other EDT/branch currently occupies that repo, not the target member's own state — risking a false "clean" (defaulting to `git branch -d` while a real, tagged stash for that branch's uncommitted work is left behind orphaned) or a false "dirty" (an unrelated EDT's local changes wrongly suppressing the "Delete branch" default).
- **What was amended:** added `GitPort.hasStash(repoPath, tag)` (Code Map) and the corrected clean-detection algorithm (this Design Notes section) so "clean" is evaluated against the *member's own branch*, not the working tree's current occupant.
- **Known-bad state avoided:** a merged member branch silently deleted (`-d`) while its own tagged stash survives orphaned with no branch left to restore it into; or a genuinely clean/mergeable branch wrongly defaulting to "Leave" because some unrelated EDT's dirt was misread as this member's own.
- **KEEP:** everything else in attempt 1's diff (`{project-root}/_bmad-output/implementation-artifacts/epic-2/spec-2-29-attempt-1-diff.txt`) worked correctly and passed full verification (`npm test`/`typecheck`/`depcheck`, all I/O-matrix rows covered) -- preserve its file layout, the `deleteEdt`/CLI/TUI structure, and its test style exactly; only the clean-detection mechanism changes.
- **Patch round (review_loop_iteration 1, blind-hunter/edge-case-hunter, applied without a further loopback):** fixed the CLI `missing-argument` usage message (was referencing a nonexistent `--topic` flag), added `--branches` validation (empty/unmatched/duplicate repoPath all now `invalid-argument` instead of silently mis-defaulting), made `deleteMemberBranch` short-circuit to `outcome: 'deleted'` when the branch is already gone instead of erroring on `isBranchMerged`, attached partial `results` to the error `details` when `edtRegistry.remove()` fails after some branches were already deleted, surfaced `statusError` in the delete-confirm dialog's per-row meta text, normalized the `dispositions` lookup via `resolve()`, and added coverage for previously-untested error branches (`edtRegistry.list()`/`state.readActiveEdt()`/`manifest.load()` failures in `deleteMemberBranch`). Four lower-severity/ambiguous-intent findings (no `logEdtAction` on active-rejection; silent no-op on an unmatched `edt-delete <topic>`; a pre-existing double-Enter re-entrancy pattern shared by every confirm dialog; no `--` escape hatch for a topic starting with `--`) were deferred to `deferred-work.md` rather than blocking this story.

## Design Notes

**Corrected "clean" detection for a member's own branch (fixes the bug above):** a member's branch is dirty, for delete-disposition purposes, when EITHER of these holds:
1. A stash tagged `tui-back:<edtUlid>` (this EDT's own ulid -- the same tag `switch.ts` writes when switching *away* from this EDT, see `switch.ts` L15-18) exists in `repoPath` -- checked via the new `git.hasStash(repoPath, `tui-back:${edtUlid}`)`, non-destructive (existence only, never pops).
2. `repoPath`'s *currently checked-out* branch (`git.currentBranch(repoPath)`) equals `member.branch` AND `git.hasUncommittedChanges(repoPath)` is true -- the one case where the working tree's state genuinely *is* this member's own (e.g. a single-repo setup, or this member's branch happens to be shared with whatever is active elsewhere).
If neither holds, the member's branch is clean -- covers the common case (member not checked out, no stash) without ever calling `hasUncommittedChanges` blind. Apply this in both `resolveMemberDeleteStatuses` (TUI status/default-disposition display) and `deleteMemberBranch` (the actual `-d`/`-D` decision at delete time) -- same logic, not two implementations.

## Verification

**Commands:**
- `npm test` -- all suites green, including new `core/edt/delete.test.ts` and extended `git`, `edt-registry`, `edts-zone.*`, `commands`, `app-store`, `cli` suites
- `npm run typecheck` -- clean
- `npm run depcheck` -- no boundary violations

**Manual checks:**
- TUI: `edt-delete <topic>` on a non-active EDT opens the confirmation dialog with correct per-member defaults; toggling and confirming deletes only the selected branches and the EDT disappears from the list; attempting delete on the active EDT is rejected with a clear message.
- CLI: `tui-back edt delete <topic> --branches <repoPath>=delete` deletes the branch and the EDT record; omitting `--branches` for a member leaves its branch untouched.

## Suggested Review Order

**Core use-case: `deleteEdt`**

- Entry point — active-EDT rejection, per-member disposition loop (outside the lock), lock-held registry/file removal.
  [`delete.ts:68`](../../../src/core/edt/delete.ts#L68)

- Per-member branch deletion: `assertAllowedBranch` gate, corrected clean-detection, already-deleted-branch short-circuit, `-d`/`-D` choice.
  [`delete.ts:139`](../../../src/core/edt/delete.ts#L139)

- The bug-fix itself: dirty iff a `tui-back:<edtUlid>`-tagged stash exists OR the checked-out branch is this member's own and dirty.
  [`delete.ts:205`](../../../src/core/edt/delete.ts#L205)

**Git/registry port widening**

- `isBranchMerged` — `git merge-base --is-ancestor`, independent of what's checked out.
  [`git/index.ts:182`](../../../src/adapters/driven/git/index.ts#L182)

- `hasStash` — non-destructive existence check, built on `restoreStash`'s extracted `findStashRef`.
  [`git/index.ts:396`](../../../src/adapters/driven/git/index.ts#L396)

- `GitPort` contract additions (`isBranchMerged`, `hasStash`, widened `deleteBranch`).
  [`git.ts:47`](../../../src/core/ports/git.ts#L47)

- `EdtRegistryPort.remove` contract.
  [`edt-registry.ts:54`](../../../src/core/ports/edt-registry.ts#L54)

- `removeEdtRegistryEntry` — read/find/filter/write, mirrors `updateEdtEntry`.
  [`edt-registry/index.ts:147`](../../../src/adapters/driven/edt-registry/index.ts#L147)

**TUI: dialog and wiring**

- `DeleteDialogView`/`createDeleteDialogHandlers` — confirm dialog, per-member checklist, `statusError` annotation, submit/cancel.
  [`delete-dialog.tsx:43`](../../../src/adapters/driving/tui/zones/edts/dialogs/delete-dialog.tsx#L43)

- `DeleteDialogState`/`initialDeleteDialog` — active-EDT `rejected` state vs. normal confirm state.
  [`edts-zone.logic.ts:905`](../../../src/adapters/driving/tui/zones/edts/edts-zone.logic.ts#L905)

- Dialog-opening effect and input/render dispatch wiring.
  [`edts-zone.tsx:528`](../../../src/adapters/driving/tui/zones/edts/edts-zone.tsx#L528)

- `deleteEdt`/`openEdtDeleteDialog` store actions.
  [`edt-slice.ts:340`](../../../src/adapters/driving/tui/store/slices/edt-slice.ts#L340)

- `edt-delete` command-bar registration.
  [`commands.ts:38`](../../../src/adapters/driving/tui/commands/commands.ts#L38)

**CLI**

- `runEdtDelete` — positional `<topic>`, `--branches <repoPath>=<leave|delete>` parsing and validation.
  [`subcommands.ts:461`](../../../src/adapters/driving/cli/subcommands.ts#L461)

- `EDT_DELETE_USAGE` and dispatch wiring.
  [`subcommands.ts:34`](../../../src/adapters/driving/cli/subcommands.ts#L34)

**Peripherals**

- `create.ts`'s rollback call site updated for `deleteBranch`'s new `force` parameter.
  [`create.ts`](../../../src/core/edt/create.ts)

- Full I/O-matrix + clean-detection + patch-round coverage.
  [`delete.test.ts`](../../../src/core/edt/delete.test.ts)
