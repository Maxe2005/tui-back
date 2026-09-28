---
title: 'EDT Switch Resolution Dialog — Global Strategy, Per-Service Overrides & Discard Confirmation'
type: 'feature'
created: '2026-09-28'
status: 'in-review'
review_loop_iteration: 0
context: []
baseline_commit: '588856b1cdda5421bd18befad43e666bec699161'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Since 2.39, a TUI switch that has a dirty state-2/3 service can only be cancelled: the interim preview never proceeds. The core already accepts per-repo `adopt`/`discard` resolutions, but the TUI cannot collect them.

**Approach:** Replace the interim preview with a two-panel resolution view that mirrors wizard Step 3:
- Panel A holds a global action and a global branch name.
- Panel B is a per-service table, with a "Configurer" box for each row.
- Any `[Écraser]` row goes through a second, file-listing confirmation.

The Step 3 table is first extracted into a shared `branch-plan-table` component (human decision, 2026-09-28), and both dialogs use it.

## Boundaries & Constraints

**Always:**
- All ACs of Story 2.41 in `epics.md` (L1936-1962) are normative, including the French labels and the footer, verbatim.
- The draft state lives in the TUI (dialog state), never in core. Pure helpers live in `switch-resolution.logic.ts`: `buildRows`, `validateRow`, `buildResolutions`.
- A row's adopt target is:
  - the global name when the repo is on a shared branch;
  - otherwise its current branch.
- Adopt-name validation, in this order:
  - empty → rejected;
  - protected → rejected, via `isProtectedTarget(name, sharedBranch)`, the core helper, so the check follows 2.42 later;
  - already exists locally and differs from the current branch → rejected.
- A repo on a detached HEAD (`currentBranch === 'HEAD'`) cannot be adopted; only `[Écraser]` is valid for it.
- With no outgoing EDT, only Écraser is offered, globally and per row.
- The discard confirmation lists each service's `dirtyPaths` and defaults to *Retour*. Only an explicit key confirms it.
- The Step 3 extraction is behavior-neutral: the existing `step-branches` tests must pass unchanged.
- On an ok result, the action log goes to `result.data.ulid`, the new active EDT. The entry records the adopted branches and the discarded paths.

**Ask First:** any change to `switchActiveEdt`'s control flow beyond the two additive row fields below; any change to the CLI path.

**Never:** re-implementing `BranchAutocompleteInput` or copying Step 3's table; a `listDirtyPaths` call from the TUI layer; an Écraser that runs without the second confirmation; touching the quick-pick or the auto-switch-tab command paths (both already route through the seam).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Global adopt | 2 rows, one on `development`, one on `feat/x`; outgoing `Mon Topic` | targets `mon-topic` and `feat/x`; Ctrl+N proceeds with 2 `adopt` resolutions | — |
| Global name edited | name → `wip` | shared rows retarget live; touched flag stops the slug tracking | — |
| Perso override | box: adopt `feat/y` | row `[Adopter (Perso)]`; no longer follows Panel A | — |
| Ctrl+R in box | Perso/Écraser row | row back to Global | — |
| Invalid name | `prod`, empty, or an existing local branch ≠ current | inline error; Apply refused; Ctrl+N blocked | — |
| Any Écraser | ≥1 discard row | second view lists files per service; Esc/Retour → table; confirm key → proceed | — |
| No outgoing | first switch | Panel A offers only Écraser, with an explanation; rows default to Écraser | — |
| Detached HEAD | `currentBranch: 'HEAD'` | adopt invalid; row must be Écraser | inline error |
| Esc on main view | — | resolves `cancel` → `switch-cancelled-by-user`; message shown | nothing touched |
| Results | adopted/discarded/failed rows | dialog stays open with a summary + `FailedResultList`; Enter/Esc closes | — |
| All clean switched | only `switched` rows | closes as today | — |

</frozen-after-approval>

## Code Map

- `src/core/edt/switch.ts`:
  - `SwitchDirtyRepo` (L80) gains `sharedBranch: string | null`, taken from the manifest already loaded in `describeDirtyRepo` (L402), and `dirtyPaths?: string[]` (state-2/3 only, read-only `listDirtyPaths(..., {expandUntracked:true})`; a failed read leaves the field unset).
  - `succeeded()` (L685): an `adopted` row gets `detail {code:'adopted', message, adoptedBranch}`, and `SwitchEdtRepoResult.detail` gains `adoptedBranch?`.
- `src/core/edt/switch.test.ts` -- assert both new row fields and the adopted detail.
- `zones/edts/dialogs/create-wizard/step-branches.tsx` -- move `PanelTitle`, the column header and the `BoundedList` row rendering (L170-297) into the new shared component. `BranchStepView` then composes it.
- NEW `zones/edts/dialogs/branch-plan-table.tsx` -- `PanelTitle` plus a generic `BranchPlanTable<Row>({headers, rows, cells(row)→[{text,color}], cursor, focused, maxVisibleRows, labels})`. Every cell is truncated with `truncateBranchLabel`.
- NEW `zones/edts/dialogs/switch-resolution/switch-resolution.logic.ts` (+ `.test.ts`):
  - the state type: panel, globalAction, globalName+touched, rowCursor, overrides, box, confirm;
  - the key reducer `reduceSwitchResolutionKey`;
  - `buildRows`, `validateRow(row, localBranchesByPath)`, `buildResolutions`.
  - The box's own reducer is modeled on `override-box.logic.ts`, but it is a separate implementation (its fields differ).
- NEW `zones/edts/dialogs/switch-resolution/switch-resolution-view.tsx` -- Panel A, Panel B (via `BranchPlanTable`), the dim state-1 rows, the box, and the discard confirmation.
- `zones/edts/dialogs/switch-dialog.tsx`:
  - The input handler delegates to the reducer while `switchDirtyRepos` is set, then calls `resolveSwitchDirtyRepos(proceed|cancel)`.
  - The result handling logs to `result.data.ulid` and keeps the dialog open on adopted/discarded/failed rows.
  - Delete the interim `DirtyReposPreview`.
- `zones/edts/edts-zone.logic.ts` L655 `SwitchDialogState` -- add `resolution: SwitchResolutionState | null` and `results?`.
- `zones/edts/edts-zone.tsx`:
  - An effect initializes `resolution` when `switchDirtyRepos` turns non-null. It uses the outgoing topic (`edts` + `activeEdt`) and fetches the local branch lists through the store's `listBranches` (L178 of edt-slice).
  - Pass `maxVisibleRows`, derived like `createWizardTableMaxRows` (L320).
- `store/slices/edt-slice.ts` L153-161 -- comment only: the interim note is gone.
- `keybindings/keybindings.ts` L82-106 -- add rows for the switch dialog's Tab / Enter / Ctrl+N / Ctrl+R / Esc.
- Tests:
  - `edt-slice.test.ts` (seam proceed payload);
  - `edts-zone.interaction.test.tsx` L188-261: replace the interim cancel-only cases with global adopt → proceed, Écraser → confirm → proceed, Esc → cancel, and invalid → blocked.

## Tasks & Acceptance

**Execution:**
- [x] `sprint-status.yaml` -- 2-39 → done, 2-41 → in-progress -- prerequisite, human-approved.
- [x] `branch-plan-table.tsx`, `step-branches.tsx` -- behavior-neutral extraction -- 2.37 reuse prerequisite.
- [x] `core/edt/switch.ts` (+ test) -- `sharedBranch`, `dirtyPaths`, adopted detail -- the facts the dialog and the log need.
- [x] `switch-resolution.logic.ts` (+ test) -- state, reducer, rows, validation, resolutions -- covers every matrix row.
- [x] `switch-resolution-view.tsx`, `switch-dialog.tsx`, `edts-zone.logic.ts`, `edts-zone.tsx` -- UI wiring, results and logging.
- [x] `keybindings.ts`, `edt-slice.ts` comment, interaction/slice tests.

**Acceptance Criteria:**
- Given a dirty state-2/3 service, when the seam fires, then the resolution view shows the intro naming the outgoing EDT, both panels and the exact footer.
- Given every row is valid and none is Écraser, when Ctrl+N is pressed, then `switchActiveEdt` receives exactly `buildResolutions(rows)` and the repos are adopted.
- `npm run typecheck && npm test && npm run depcheck` pass.

## Design Notes

A row's effective plan is `override ?? global`:

```ts
type RowPlan = { kind: 'adopt'; branch: string; source: 'global' | 'perso' } | { kind: 'discard'; source: 'global' | 'perso' };
// global adopt: branch = repo.currentBranchShared ? globalName.trim() : repo.currentBranch
```

The box's branch field is pre-filled with that computed target. Validation runs against the local branch list loaded when the view opens. While that list is loading, or if it failed to load, the "exists locally" check is skipped with a dim note. The git gate stays authoritative (`branch-exists` fails that row).

## Verification

**Commands:**
- `npm run typecheck && npm test && npm run depcheck` -- expected: all green.

**Manual checks:**
- TUI: switch with a dirty non-member → adopt globally → the repo lands in the outgoing EDT. Switch again → Écraser → the confirmation lists the files → confirm → the files are gone and ignored files are kept.
