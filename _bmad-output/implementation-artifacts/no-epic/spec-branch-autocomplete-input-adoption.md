---
title: 'Adopt branch autocomplete in BranchPicker and update-config'
type: 'feature'
created: '2026-09-23'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'c9c47aeca1a955bde327a627cbf0d0890ec8f92a'
context: [_bmad-output/implementation-artifacts/epic-2/epic-2-context.md, _bmad-output/implementation-artifacts/epic-3/spec-3-7-pre-run-configuration-interface.md]
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The shared `BranchAutocompleteInput` (foundation spec) helps nothing until the two existing-branch entry points use it: BranchPicker's pick-existing filter and the update-config "Merge from" editor are still blind text fields.

**Approach:** Host the shared component in both places, threading each row's own `listBranches` result and the live `branchDropdownMaxRows` value through. Depends on the foundation spec — starts only once its component and setting exist.

## Boundaries & Constraints

**Always:** Same invariants as the foundation spec (AD-1, `.js` imports-first, pure reducers + thin dispatchers, glyph-paired validity, `nextTextInputValue` for text); `commit-through` maps onto each host's existing commit path unchanged; create-new/rename-current outcomes and validation stay byte-identical.

**Ask First:** If either host needs anything beyond the shared component's step vocabulary (`update | insert | commit-through`); if update-config's per-row branch fetch needs anything beyond the EDT zone's fetch-once-per-session effect.

**Never:** No change to create-new/rename-current modes or their git writes; no change to `assertAllowedBranch` gating or `validateBranchEditValue` blank-reject; no remote-branch listing; no new setting of its own (reuses `edts.branchDropdownMaxRows`).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Pick-existing host | Filter typed in any of the 4 BranchPicker sessions (Modify, service-actions, add-to-EDT, create base-branch) | Shared dropdown + validity render inside the mode; `insert` fills the filter, `commit-through` runs the mode's existing submit | `branchesStatus=error` keeps today's `Failed to load branches.` line, field stays usable |
| Update-config host | `e`/`Enter` opens a row's branch editor | Editor shows the autocomplete fed by that row's repo `listBranches`; `insert` fills text, second `Enter` commits via `commitUpdateConfigBranchEdit` | Blank commit still rejected inline by `validateBranchEditValue` |
| Shared-branch text | Typed text equals a shared/protected name that exists locally | Validity may show `✔` (it exists) — the safety gate still rejects it at submit time, unchanged | Gate message unchanged |
| Untouched modes | Create-new / rename-current exercised | Behavior byte-identical to before (no dropdown, no validity) | N/A |

</frozen-after-approval>

## Code Map

- `src/adapters/driving/tui/shared/components/branch-picker.tsx:215,336,445,461` -- `handleBranchPickerKey` dispatch, `handlePickExistingKey` (filter/`pickCursor`/`Ctrl+R` logic the shared component absorbs), `FilterableBranchList` (replaced in pick-existing only), `BranchPicker` render.
- `src/adapters/driving/tui/zones/edts/edts-zone.logic.ts:845,1107` -- `BranchPickerSession` (`repoPath/state/branches/branchesStatus`) and `createPickerSession` (session factory, unchanged shape).
- `src/adapters/driving/tui/zones/edts/dialogs/modify-dialog.tsx:220`, `service-actions-dialog.tsx:139`, `add-to-edt-dialog.tsx:78`, `create-dialog.tsx:252` -- the four `handleBranchPickerKey` call sites whose pick-existing path delegates to the shared reducer.
- `src/adapters/driving/tui/zones/update/update-config-dialog.logic.ts:110,121,128,228` -- branch-edit begin/step/commit helpers and `resolveUpdateConfigKey` reducer hosting the autocomplete state per edited row.
- `src/adapters/driving/tui/zones/update/update-config-dialog.tsx:68` -- `TextInputLine label="Merge from"` site becoming the autocomplete host; needs `branches` + `branchesStatus` + `maxRows` props.
- `src/adapters/driving/tui/store/slices/edt-slice.ts:155,362` + `zones/edts/edts-zone.tsx:333` -- existing `listBranches` action + fetch-once-per-session effect precedent the update-config host mirrors for its edited row's repo.

## Tasks & Acceptance

**Execution:**
- [x] `src/adapters/driving/tui/shared/components/branch-picker.tsx` (+ `branch-picker.test.tsx`) -- pick-existing filter field delegates to the shared reducer/component with `maxRows` from settings; create-new/rename-current untouched -- one widget, now shared.
- [x] `src/adapters/driving/tui/zones/update/update-config-dialog.logic.ts` + `update-config-dialog.tsx` (+ tests) -- branch editor hosts the autocomplete with a per-row `listBranches` fetch-once-per-edit effect -- same effect shape as the EDT zone.
- [x] Host regression tests -- the four BranchPicker sessions plus update-config commit paths (insert-then-commit, empty-list fallthrough, error-status field, unchanged create-new/rename-current) -- prove no submit-path drift without mounting Ink.

**Acceptance Criteria:**
- Given any of the four BranchPicker sessions in pick-existing mode, when typing, then the shared dropdown and `✔`/`✖` validity render; `Enter` inserts first and the mode's existing submit runs only on the next confirm.
- Given an update-config row's branch editor, when opened, then it autocompletes from that row's repo branches capped at `branchDropdownMaxRows`; confirming a blank still rejects inline.
- Given create-new/rename-current flows, when exercised, then their behavior is unchanged (no new git-write path, gate messages identical).

## Spec Change Log

## Design Notes

Idempotent-submit: both hosts treat an `insert` whose branch already equals the filter text as the host's existing commit (pick-existing `set` submit / `commitUpdateConfigBranchEdit`) instead of a no-op fill — typing an exact name + `Enter` submits immediately. Any navigated highlight (filter differs) always inserts first and commits only on the next confirm.

## Verification

**Commands:**
- `npm test && npm run typecheck && npm run depcheck` -- expected: all green (AGENTS.md order).

## Suggested Review Order

**Pick-existing host (start here)**

- Filter delegates to shared reducer with idempotent-submit on exact match
  [`branch-picker.tsx:337`](../../src/adapters/driving/tui/shared/components/branch-picker.tsx#L337)

- Pick-existing renders the shared input with the live row cap
  [`branch-picker.tsx:548`](../../src/adapters/driving/tui/shared/components/branch-picker.tsx#L548)

**Update-config host**

- Branch editor hosts autocomplete state with per-edit fetch contract
  [`update-config-dialog.logic.ts:257`](../../src/adapters/driving/tui/zones/update/update-config-dialog.logic.ts#L257)

- Fetch-once-per-edit effect mirroring the EDT zone precedent
  [`update-zone.tsx:404`](../../src/adapters/driving/tui/zones/update/update-zone.tsx#L404)

- Row cap and branch source threaded from the live store
  [`edts-zone.tsx:1116`](../../src/adapters/driving/tui/zones/edts/edts-zone.tsx#L1116)

**Peripherals**

- Boundary substring pin plus two-step and exact-wins coverage
  [`branch-picker.test.tsx:235`](../../src/adapters/driving/tui/shared/components/branch-picker.test.tsx#L235)

- Real-keypress threading proofs for both zones
  [`update-zone.interaction.test.tsx:1`](../../src/adapters/driving/tui/zones/update/update-zone.interaction.test.tsx#L1)
