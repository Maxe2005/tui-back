---
title: 'EDT Creation — Mandatory Branch Creation UI'
type: 'feature'
created: '2026-08-28'
status: 'done'
review_loop_iteration: 0
context: []
baseline_commit: '551b32b0b46a70b0c0b85ecc5ef1cbec5cb967a4'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `core/edt/create.ts` has supported mandatory `CreateBranchOptions` (base branch, grouped/individual naming) since Story 2.2/2.3, but the TUI's create-EDT dialog never surfaces it — `app-store.ts`'s `createEdt` action hardcodes `NO_BRANCH_CREATION`.

**Approach:** Add a mandatory branch-setup step to the create-EDT dialog, shown once ≥1 member is selected: base-branch input (default `development`) + grouped/individual naming toggle, branch-name field(s) pre-filled by a new `suggestBranchNameFromTopic` slugifier. Wire the result through `app-store.ts` into `createEdtAction`'s existing `CreateBranchOptions` param.

## Boundaries & Constraints

**Always:**
- Branch-setup step appears only when `selectedMembers.length >= 1`; no enable/disable choice.
- Branch-name field(s) pre-fill via `suggestBranchNameFromTopic(topic)`, always editable, never forced.
- Empty required branch-name field blocks confirm via `validateBranchEditValue` (reused as-is), dialog stays open.
- `submitCreate` always builds a real `CreateBranchOptions` when ≥1 member selected (grouped: same name for every member; individual: per-repoPath map); zero members still pass `NO_BRANCH_CREATION` (core's param is mandatory).
- Per-member branch-creation failures stay isolated/non-fatal (core's `resolveMemberBranch`), surfaced via the existing `summarizeFailedResults` convention already wired into `submitCreate` — no new failure-display code.
- New state lives inside `CreateDialogState`/`initialCreateDialog`; `submitCreate` stays the single call site.
- Branch-name field(s) render with today's plain `<Text color={focused ? accent : text}>Label: {value}</Text>` convention (same as topic/branch-edit fields) — `shared/components/text-input-line.tsx` (Story 2.23) doesn't exist yet.
- No `core/`, port, or `create.ts` changes — TUI-layer-only.

**Ask First:** If Ink's focus model can't cleanly extend `formFocus` to a variable number of per-member fields in individual mode, halt and confirm before diverging from the `cycleFormFocus` idiom.

**Never:** Building `text-input-line.tsx` itself (2.23's scope); branch-picker modes (2.26); Modify/Add-to-EDT dialogs (2.24); a new failure-display format.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| ≥1 member selected | Tab past checklist | Branch-setup step: base-branch input + naming-mode toggle; mode choice fills field(s) via `suggestBranchNameFromTopic(topic)` (1 field grouped, 1/member individual) | N/A |
| Grouped/individual submit | Name(s) accepted/edited, confirm | `createEdtAction` gets `CreateBranchOptions` — same name for every member (grouped) or per-member map (individual); a per-member failure reported via `summarizeFailedResults`, others unaffected | Existing isolation (`resolveMemberBranch`) |
| Required field empty | Confirm attempted | Blocked via `validateBranchEditValue`, dialog stays open, no core call | Same convention as `branchEdit` |
| Zero members selected | EDT created | No branch step; `createEdtAction` called with `NO_BRANCH_CREATION` | N/A |

</frozen-after-approval>

## Code Map

- `src/adapters/driving/tui/zones/edts/edts-zone.tsx` -- `CreateDialogState`/`initialCreateDialog` (L478-486/560-562) gain `baseBranch`, `namingMode`, `branchName`/`branchNames`, branch-step focus; `submitCreate` (L850-893, call L863) builds real `CreateBranchOptions`; new `suggestBranchNameFromTopic(topic)` near `validateBranchEditValue` (L240-242, reused verbatim); step renders inside `dialog.kind === 'create'` (L1577+), mirroring Modify's `branchEdit` sub-view (L1626 vs L1631); fields mirror `nextTextInputValue` (L208-231) usage at L1044.
- `src/adapters/driving/tui/store/app-store.ts` -- `CreateEdtParams` (L82-85) gains `branchOptions`; `createEdt` action (L557-572) passes it through instead of hardcoded `NO_BRANCH_CREATION` (L102-108).
- `src/core/edt/create.ts` -- no changes; `CreateBranchOptions` (L61-69), `CreateEdtParams` (L83-94, `branchOptions` already mandatory), `resolveMemberBranch` (L299-342) reused as-is.
- `src/core/ports/git.ts` -- no changes; existing methods (L19-30) sufficient.
- Tests: extend `edts-zone.test.tsx`, `edts-zone.interaction.test.tsx`, `app-store.test.ts`. `core/edt/create.test.ts` needs no new coverage.

## Tasks & Acceptance

**Execution:**
- [x] `edts-zone.tsx` -- add `suggestBranchNameFromTopic(topic)` -- slugifies topic (lowercase, non-alphanumerics → `-`) for pre-fill
- [x] `edts-zone.tsx` -- extend `CreateDialogState`/`initialCreateDialog` with base-branch, naming-mode, branch-name(s), branch-step focus -- state for the mandatory step
- [x] `edts-zone.tsx` -- render the branch-setup step gated on `selectedMembers.length >= 1`, current `<Text>` field convention + `nextTextInputValue` per field -- no `text-input-line.tsx` dependency (2.23 not built yet)
- [x] `edts-zone.tsx` -- `submitCreate` builds `CreateBranchOptions` (or `NO_BRANCH_CREATION` when zero members), blocks confirm via `validateBranchEditValue` -- wires the step end to end
- [x] `app-store.ts` -- `CreateEdtParams` gains `branchOptions`; `createEdt` action passes it through instead of hardcoded `NO_BRANCH_CREATION`
- [x] Extend `edts-zone.test.tsx`, `edts-zone.interaction.test.tsx`, `app-store.test.ts` for the new step, the I/O matrix, and the pass-through

**Acceptance Criteria:**
- Given the create-EDT dialog with ≥1 member selected, when the branch-setup step renders, then it offers a base-branch input (default `development`) and a naming-mode choice, with no enable/disable option.
- Given the branch-setup step, when a naming mode is chosen, then the branch-name field(s) pre-fill with `suggestBranchNameFromTopic(topic)`, always editable.
- Given grouped mode, when confirmed, then `createEdtAction` receives `CreateBranchOptions` with the identical name for every selected member.
- Given individual mode, when confirmed, then `createEdtAction` receives per-service names; a per-service failure is reported via `summarizeFailedResults` without aborting the others.
- Given any required branch-name field is empty, when confirm is attempted, then it's blocked via `validateBranchEditValue` and no core call is made.
- Given zero members selected, when the EDT is created, then no branch step applies and `createEdtAction` is called with `NO_BRANCH_CREATION`.
- `npm test`, `npm run typecheck`, `npm run depcheck` all pass.

## Spec Change Log

## Design Notes

`suggestBranchNameFromTopic` slugifies: lowercase, then any run of non-alphanumeric characters → a single `-`, trimmed of leading/trailing `-` (e.g. `"Fix Auth Bug!!"` → `"fix-auth-bug"`).

This story ships ahead of Story 2.23 (visible text-input cursor), per epics.md's "sequenced after 2.23" note — 2.23 is still `backlog`. Branch-name fields render with today's plain `<Text>` convention now; 2.23 only restyles existing fields, it doesn't change their state shape, so no rework is expected here.

## Verification

**Commands:**
- `npm test` -- all suites green, including new/updated `edts-zone`, `app-store` tests
- `npm run typecheck` -- clean
- `npm run depcheck` -- no boundary violations

**Manual checks:**
- TUI: select ≥1 member in the create dialog → branch-setup step appears with base-branch input + naming toggle; switch grouped/individual; edit/accept name(s); confirm creates the EDT with real branches (verify via `git branch` in test repos); an empty name is blocked; zero-member creation is unaffected.

## Suggested Review Order

- The new state shape the whole branch-setup step hangs off — start here to see everything it adds.
  [`edts-zone.tsx:639`](../../../src/adapters/driving/tui/zones/edts/edts-zone.tsx#L639)

**Store contract (TUI ↔ store wiring)**

- `branchOptions` becomes mandatory on `CreateEdtParams` — the seam the whole story exists to fill in.
  [`app-store.ts:82`](../../../src/adapters/driving/tui/store/app-store.ts#L82)

- One shared `DEFAULT_BASE_BRANCH` constant backs `NO_BRANCH_CREATION`, replacing a literal duplicated in the zone.
  [`app-store.ts:111`](../../../src/adapters/driving/tui/store/app-store.ts#L111)

- `createEdt` forwards the caller's `branchOptions` verbatim instead of hardcoding `NO_BRANCH_CREATION`.
  [`app-store.ts:582`](../../../src/adapters/driving/tui/store/app-store.ts#L582)

**Branch-setup step: focus model**

- `CreateFormFocus` widens the shared `FormFocus` with the step's own three fields, Create-dialog only.
  [`edts-zone.tsx:273`](../../../src/adapters/driving/tui/zones/edts/edts-zone.tsx#L273)

- `advanceCreateFormFocus` drives Tab through base → mode → name field(s), incl. individual mode's variable per-member count.
  [`edts-zone.tsx:287`](../../../src/adapters/driving/tui/zones/edts/edts-zone.tsx#L287)

- `initialCreateDialog` seeds the new fields, including the two touched flags below.
  [`edts-zone.tsx:733`](../../../src/adapters/driving/tui/zones/edts/edts-zone.tsx#L733)

**Pre-fill and the touched-flag review fix**

- `suggestBranchNameFromTopic` slugifies the topic into the pre-fill suggestion.
  [`edts-zone.tsx:257`](../../../src/adapters/driving/tui/zones/edts/edts-zone.tsx#L257)

- `prefillBranchNames` gates on an explicit touched flag, not on emptiness — the fix for the resurrected-cleared-field bug caught in review.
  [`edts-zone.tsx:327`](../../../src/adapters/driving/tui/zones/edts/edts-zone.tsx#L327)

- Touched flips true only on an actual value change, so a no-op keypress never freezes a field out of future pre-fill.
  [`edts-zone.tsx:1196`](../../../src/adapters/driving/tui/zones/edts/edts-zone.tsx#L1196)

**Submit and validation**

- `validateCreateBranchFields` blocks confirm on any empty required field, reusing `validateBranchEditValue` as-is.
  [`edts-zone.tsx:384`](../../../src/adapters/driving/tui/zones/edts/edts-zone.tsx#L384)

- `buildCreateBranchOptions` shapes the grouped (same name for all) vs. individual (per-repoPath map) `CreateBranchOptions`.
  [`edts-zone.tsx:354`](../../../src/adapters/driving/tui/zones/edts/edts-zone.tsx#L354)

- `submitCreate` wires validation + build into the existing single call site, unchanged for the zero-member path.
  [`edts-zone.tsx:1038`](../../../src/adapters/driving/tui/zones/edts/edts-zone.tsx#L1038)

**Rendering**

- The branch-setup step renders in place of the checklist once `isBranchStepFocus` is true — today's plain `<Text>` convention, no `text-input-line.tsx` dependency.
  [`edts-zone.tsx:1897`](../../../src/adapters/driving/tui/zones/edts/edts-zone.tsx#L1897)

**Tests**

- Store-level pass-through and `NO_BRANCH_CREATION` fallback, exercised against a real `git.createBranch` fake.
  [`app-store.test.ts:591`](../../../src/adapters/driving/tui/store/app-store.test.ts#L591)

- Pure-function coverage for the slugifier, pre-fill, option-building, and validation — including the fixed touched-flag regression case.
  [`edts-zone.test.tsx:596`](../../../src/adapters/driving/tui/zones/edts/edts-zone.test.tsx#L596)

- Real-keypress coverage of the full I/O matrix, plus the review-fix regression: clearing a field then toggling an unrelated member.
  [`edts-zone.interaction.test.tsx:716`](../../../src/adapters/driving/tui/zones/edts/edts-zone.interaction.test.tsx#L716)
