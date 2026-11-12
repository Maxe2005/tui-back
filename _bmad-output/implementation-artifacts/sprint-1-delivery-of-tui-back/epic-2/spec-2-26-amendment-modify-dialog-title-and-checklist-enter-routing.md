---
title: 'Story 2.26 Amendment — Modify Dialog Branch-Picker Title & Checklist Enter Routing'
type: 'bugfix'
created: '2026-09-16'
status: 'done'
baseline_commit: '7c73150f4e597c2940422cdbf62acf9fcf5e1501'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** In the Modify-EDT dialog, opening a branch-picker session never says which service it's for, and pressing `Enter` on the members checklist opens the branch-picker for *any* currently-checked row — including rows that were already members before the dialog opened — instead of only newly-checked ones. Since existing members start checked, the checklist's cursor almost never lands on a row where `Enter` submits, making `submitModify` practically unreachable without the undocumented "Tab to Topic, then Enter" escape hatch.

**Approach:** Make `ModalDialog`'s title dynamic while a branch-picker session is open (`MODIFY EDT — branch for <service>`), and thread the dialog's original membership set into `canEditMemberBranch`/`resolveModifyEnterAction` so `Enter` only opens the branch-picker for rows newly checked this session — an already-a-member row submits the form instead.

## Boundaries & Constraints

**Always:**
- `canEditMemberBranch(repoPath, selectedMembers, originalMemberPaths)` gains a third parameter, a `ReadonlySet<string>` of `target.members[].repoPath` captured at dialog-open time; a row stays branch-editable via `Enter` only when it's checked AND `!originalMemberPaths.has(repoPath)`.
- `resolveModifyEnterAction` threads the same set through to `canEditMemberBranch`; topic-focus and any non-branch-editable members-focus row still resolve to `{ type: 'submit' }`, unchanged.
- The sole call site (`modify-dialog.tsx`'s `Enter` handler) supplies `new Set(current.target.members.map(m => m.repoPath))` — data already in scope via `current.target`.
- `ModifyDialogView`'s `ModalDialog` title reads `MODIFY EDT — branch for ${service}` for the entire duration `dialog.branchPicker !== null`, reverting to plain `MODIFY EDT` the instant it becomes `null` (confirm, cancel, or auto-submit — no new state needed, this is a pure render derivation from existing state).
- `${service}` is resolved from `dialog.branchPicker.repoPath` by matching against `candidates` (covers not-yet-member rows) then `dialog.target.members` (covers existing members) — same lookup order as the existing retry-resolution precedent at `modify-dialog.tsx:243-245`.

**Ask First:** None — every open question is resolved by the notes above.

**Never:** Touch `service-actions-dialog.tsx`, `create-dialog.tsx`, `add-to-edt-dialog.tsx`, or `switch-dialog.tsx` — every other `ModalDialog` title stays a static literal; this amendment is scoped to the Modify dialog only. Never change `Enter`'s behavior from the Topic field (always submits, unaffected by this change).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| `Enter` on an existing-member row | Cursor on a `repoPath` present in `target.members`, still checked | `submitModify` runs — whole form submits | N/A |
| `Enter` on a newly-checked row | Cursor on a `repoPath` not in `target.members`, checked this session | Branch-picker opens for it (unchanged, mandatory per Story 2.24) | N/A |
| `Enter` on an unchecked row | Cursor on any unchecked `repoPath` | Form submits (unchanged pre-existing behavior) | N/A |
| Branch-picker opens for an existing member | `dialog.branchPicker.repoPath` matches `target.members` | Title shows `MODIFY EDT — branch for <service>` | N/A |
| Branch-picker opens for a newly-checked candidate | `dialog.branchPicker.repoPath` matches `candidates`, not yet a member | Title shows `MODIFY EDT — branch for <service>` | N/A |
| Branch-picker session closes | `dialog.branchPicker` becomes `null` (confirm/cancel/auto-submit) | Title reverts to `MODIFY EDT` | N/A |

</frozen-after-approval>

## Code Map

- `src/adapters/driving/tui/zones/edts/edts-zone.logic.ts:587-613` -- `canEditMemberBranch`/`resolveModifyEnterAction`, currently 2-arg/3-arg (no membership awareness since Story 2.24 deliberately dropped it) -- gains the `originalMemberPaths` parameter.
- `src/adapters/driving/tui/zones/edts/dialogs/modify-dialog.tsx:315-323` -- sole call site of `resolveModifyEnterAction`, inside the members-focus `Enter` handler; `current: ModifyDialogState` already carries `current.target.members` in scope.
- `src/adapters/driving/tui/zones/edts/dialogs/modify-dialog.tsx:243-245` -- existing repoPath↔service lookup precedent (`candidates.find(...).path ?? target.members.find(...).repoPath`, reverse direction for this change) to mirror rather than reinvent.
- `src/adapters/driving/tui/zones/edts/dialogs/modify-dialog.tsx:348` -- `<ModalDialog title="MODIFY EDT" ...>`, currently a static literal; becomes a computed expression.
- `src/adapters/driving/tui/zones/edts/edts-zone.logic.ts:716-749` -- `BranchPickerSession`/`ModifyDialogState` types; `branchPicker.repoPath` is the only identifier on the session, no service name stored.
- `src/core/edt/list.ts:28-38` -- `ServiceBranchDivergence` shape (`service`, `path`, ...) -- the `candidates` prop's element type, field is `path` not `repoPath`.
- `src/adapters/driving/tui/zones/edts/edts-zone.test.tsx:745-799` -- `canEditMemberBranch` (4 cases) and `resolveModifyEnterAction` (5 cases) unit tests, all calling the current signatures.
- `src/adapters/driving/tui/zones/edts/edts-zone.interaction.test.tsx` -- has a static "MODIFY EDT" title assertion (~L1683-1689); no existing coverage of a dynamic title.

## Tasks & Acceptance

**Execution:**
- [x] `edts-zone.logic.ts` -- add `originalMemberPaths: ReadonlySet<string>` param to `canEditMemberBranch`, thread it through `resolveModifyEnterAction`'s call -- closes the Enter-routing gap
- [x] `modify-dialog.tsx:315-323` -- pass `new Set(current.target.members.map(m => m.repoPath))` into `resolveModifyEnterAction` -- supplies the missing "original membership" signal at the only call site
- [x] `modify-dialog.tsx:348` -- add a small repoPath→service resolver (mirrors L243-245's lookup order: `candidates` then `target.members`) and compute the title from `dialog.branchPicker` -- closes the dynamic-title AC
- [x] `edts-zone.test.tsx:745-799` -- update all 9 existing `canEditMemberBranch`/`resolveModifyEnterAction` calls for the new param; add cases for existing-member-checked (→ submit) vs. newly-checked (→ edit-branch)
- [x] `edts-zone.interaction.test.tsx` -- add coverage: title reads `MODIFY EDT — branch for <service>` when the picker opens (both for an existing member via the SERVICES-pane rename-current entry, and for a newly-checked row), reverts to `MODIFY EDT` on close; `Enter` on an existing-member checklist row submits the form instead of opening the picker

**Acceptance Criteria:**
- Given a branch-picker session is open in the Modify dialog, when rendered, then the title reads `MODIFY EDT — branch for <service>` for the session's duration, reverting once it closes.
- Given the members-list cursor is on a row already a member of this EDT, when `Enter` is pressed, then the whole form submits.
- Given the cursor is on a row newly checked this session, when `Enter` is pressed, then the branch-picker opens for it, unchanged.
- `npm test`, `npm run typecheck`, `npm run depcheck` all pass.

## Spec Change Log

## Design Notes

The candidates-then-members lookup order is inherited from the existing retry-resolution precedent (`modify-dialog.tsx:243-245`) purely for consistency — functionally, an existing member resolves to the same `service` value from either source, so order has no behavioral effect here. Do not invent a second lookup convention.

## Verification

**Commands:**
- `npm test` -- `edts-zone.test.tsx` and `edts-zone.interaction.test.tsx` green, including the new/updated cases above
- `npm run typecheck` -- clean
- `npm run depcheck` -- no boundary violations

**Manual checks:**
- Open Modify on an EDT with existing members (checklist cursor defaults onto an already-checked row); press `Enter` → form submits (previously opened the branch-picker). Check a not-yet-member row, press `Enter` → branch-picker opens, title shows `MODIFY EDT — branch for <service>`. Close the picker (confirm or cancel) → title reverts to `MODIFY EDT`.

## Suggested Review Order

**Checklist Enter routing (the blocking-bug fix)**

- Entry point: the new membership-awareness rule — an already-a-member row is never branch-editable via checklist `Enter` any more.
  [`edts-zone.logic.ts:598`](../../../src/adapters/driving/tui/zones/edts/edts-zone.logic.ts#L598)

- `resolveModifyEnterAction` threads `originalMemberPaths` through to the rule above.
  [`edts-zone.logic.ts:609`](../../../src/adapters/driving/tui/zones/edts/edts-zone.logic.ts#L609)

- Sole call site: builds the dialog-open-time membership snapshot and passes it in.
  [`modify-dialog.tsx:317`](../../../src/adapters/driving/tui/zones/edts/dialogs/modify-dialog.tsx#L317)

**Dynamic branch-picker title**

- `resolveModifyDialogTitle` — resolves the session's service (candidates, then `target.members` fallback) and computes the title string.
  [`modify-dialog.tsx:345`](../../../src/adapters/driving/tui/zones/edts/dialogs/modify-dialog.tsx#L345)

- `ModifyDialogView` consumes it as a plain computed string — no new state.
  [`modify-dialog.tsx:365`](../../../src/adapters/driving/tui/zones/edts/dialogs/modify-dialog.tsx#L365)

**Peripherals**

- Unit coverage for both functions, including the empty-`originalMemberPaths` (brand-new EDT) case added during review.
  [`edts-zone.test.tsx:745`](../../../src/adapters/driving/tui/zones/edts/edts-zone.test.tsx#L745)

- Interaction coverage: existing-member Enter now submits instead of opening the picker.
  [`edts-zone.interaction.test.tsx:274`](../../../src/adapters/driving/tui/zones/edts/edts-zone.interaction.test.tsx#L274)

- Interaction coverage: dynamic title for a freshly-checked candidate, reverting on close.
  [`edts-zone.interaction.test.tsx:326`](../../../src/adapters/driving/tui/zones/edts/edts-zone.interaction.test.tsx#L326)

- Interaction coverage: dynamic title for an existing member reopened via the retry escape hatch.
  [`edts-zone.interaction.test.tsx:370`](../../../src/adapters/driving/tui/zones/edts/edts-zone.interaction.test.tsx#L370)

- Review-fix: the `target.members` title fallback, exercised when the existing member is absent from `candidates`.
  [`edts-zone.interaction.test.tsx:446`](../../../src/adapters/driving/tui/zones/edts/edts-zone.interaction.test.tsx#L446)
