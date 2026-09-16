---
title: 'Delete an EDT'
type: 'feature'
created: '2026-09-16'
status: 'in-progress'
review_loop_iteration: 0
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

- `src/core/ports/git.ts` L19-81 -- widen `deleteBranch(repoPath, branchName)` (L29) to `deleteBranch(repoPath, branchName, force: boolean)`; add new `isBranchMerged(repoPath, branch, into): Promise<Result<boolean>>`. Doc-comment precedent: L26-29 (deleteBranch), L76-80 (renameBranch).
- `src/adapters/driven/git/index.ts` L34-51 (factory wiring -- rewire both methods), L60-104 (`assertAllowedBranch` gate, reuse untouched), L145-168 (current `deleteBranch` impl -- parametrize `-d`/`-D` on `force`), L404-443 (`renameBranch`, closest precedent for a gated write + error taxonomy), L466-478 (`showRef` helper), L311-317 (`hasUncommittedChanges` -- reuse directly for per-member "uncommitted" signal). `isBranchMerged` is fully new: implement via `git merge-base --is-ancestor <branch> <into>`, mirroring the exit-code-taxonomy comment style at L280-289.
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
- [ ] `src/core/ports/git.ts` -- widen `deleteBranch` to add `force: boolean`, add `isBranchMerged(repoPath, branch, into)` -- port contract for gated force-aware delete + merge check
- [ ] `src/adapters/driven/git/index.ts` -- implement `isBranchMerged` (`git merge-base --is-ancestor`), parametrize `deleteBranch`'s `-d`/`-D` on `force`, rewire factory -- fulfills the widened port
- [ ] `src/adapters/driven/git/index.test.ts` -- extend for `force` param + `isBranchMerged` -- regression + new coverage
- [ ] `src/core/edt/create.ts` L282 -- pass `force: true` to `git.deleteBranch` -- preserves existing rollback behavior after the signature change
- [ ] `src/core/ports/edt-registry.ts` + `src/adapters/driven/edt-registry/index.ts` -- add `remove(ulid)` (read/find/filter/write, mirrors `updateEdtEntry`) -- registry-side deletion
- [ ] `src/adapters/driven/edt-registry/index.test.ts` -- extend for `remove()` -- regression coverage
- [ ] `src/core/edt/delete.ts` (new) -- reject if target is active; else per-member disposition (leave/delete, gated via `assertAllowedBranch` through `git.deleteBranch(force)`); under lock, remove registry entry + delete `<ulid>.db`/`edtDir` -- the use-case itself
- [ ] `src/core/edt/delete.test.ts` (new) -- active-EDT rejection, merged+clean default, unmerged/dirty force-delete, cross-EDT branch-collision partial failure, leave disposition -- I/O matrix coverage
- [ ] `src/adapters/driving/tui/zones/edts/edts-zone.logic.ts` -- add `DeleteDialogState` to `EdtDialogState`, `initialDeleteDialog` constructor -- TUI state shape
- [ ] `src/adapters/driving/tui/zones/edts/dialogs/delete-dialog.tsx` (new) -- confirm dialog (switch-dialog.tsx precedent) + per-member `CheckboxListItem` disposition list (modify-dialog.tsx precedent) + `FailedResultList` for partial failures -- the dialog UI
- [ ] `src/adapters/driving/tui/zones/edts/edts-zone.tsx` -- reject-if-active check + open delete dialog (mirrors L385-395), input dispatch branch, render dispatch branch -- wires the dialog into the zone
- [ ] `src/adapters/driving/tui/store/slices/edt-slice.ts` -- add `'delete'` to `EdtActionState.type`, add `openEdtDeleteDialog` -- store wiring
- [ ] `src/adapters/driving/tui/commands/commands.ts` -- add `edt-delete` entry -- command-bar registration
- [ ] `src/adapters/driving/tui/commands/commands.test.ts` -- extend for `edt-delete` -- regression
- [ ] `src/adapters/driving/tui/store/app-store.test.ts` -- extend for `openEdtDeleteDialog`/delete flow -- regression
- [ ] `src/adapters/driving/tui/zones/edts/edts-zone.{test,interaction.test,styles.test,layout.test}.tsx` -- extend for the `delete-confirm` dialog kind -- state/interaction/rendering coverage
- [ ] `src/adapters/driving/cli/subcommands.ts` -- add `EDT_DELETE_USAGE`, dispatch `args[0] === 'delete'`, `runEdtDelete` parsing `<topic>` + repeated `--branches <repoPath>=<leave|delete>` (mirrors `--set-branch` parsing) -- CLI surface
- [ ] `src/adapters/driving/cli/dispatch.test.ts` + `src/bin/tui-back.e2e.test.ts` -- extend for `edt delete` -- CLI regression

**Acceptance Criteria:**
- Given the EDT selector, when delete is triggered on a non-active EDT (`edt-delete` command or contextual row action), then a confirmation dialog lists every member with branch, merge status, and uncommitted-work status.
- Given the target EDT is active, when delete is attempted, then it is rejected with a clear message, never auto-switched.
- Given the per-service disposition list, when rendered, defaults follow the merged+clean rule; every row stays independently toggleable.
- Given deletion completes, then the EDT no longer appears in the list and its SQLite file is removed; a per-branch collision with another EDT is reported without blocking the rest.
- `npm test`, `npm run typecheck`, `npm run depcheck` all pass.

## Spec Change Log

## Verification

**Commands:**
- `npm test` -- all suites green, including new `core/edt/delete.test.ts` and extended `git`, `edt-registry`, `edts-zone.*`, `commands`, `app-store`, `cli` suites
- `npm run typecheck` -- clean
- `npm run depcheck` -- no boundary violations

**Manual checks:**
- TUI: `edt-delete <topic>` on a non-active EDT opens the confirmation dialog with correct per-member defaults; toggling and confirming deletes only the selected branches and the EDT disappears from the list; attempting delete on the active EDT is rejected with a clear message.
- CLI: `tui-back edt delete <topic> --branches <repoPath>=delete` deletes the branch and the EDT record; omitting `--branches` for a member leaves its branch untouched.
