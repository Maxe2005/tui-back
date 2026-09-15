---
title: 'EDT Zone — Structured Per-Repo Failure Display & Branch-Collision State'
type: 'feature'
created: '2026-09-14'
status: 'done'
review_loop_iteration: 0
context: []
baseline_commit: 'cc753180eb34bf2c6af0b14a0eb4d80899911197'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `summarizeFailedResults()` (`edts-zone.tsx`) flattens every failed repo's error into one `'; '`-joined string across all 6 partial-failure call sites (create, switch, modify, remove-from-edt, service-actions branch-change, add-to-edt) — no per-repo breakdown, no distinction between failure kinds, and no remediation for the one kind that actually has an obvious fix: a branch already claimed by another EDT (`branch-owned-by-other-edt`, from `assertAllowedBranch`).

**Approach:** Replace `summarizeFailedResults`'s string output with a structured `FailedResultRow[]`, rendered by one new shared list component used at all 6 call sites; each row's `code` is looked up in a small extensible registry (`resolveAssistedAction`) for an optional resolution action — this story registers exactly one (`branch-owned-by-other-edt` → "try a different branch").

## Boundaries & Constraints

**Always:**
- `summarizeFailedResults` returns `FailedResultRow[]` (`{ service, code?, message }`, never joined text); all 6 call sites switch their `!== null` check to `.length > 0` and store the array (new `failedRows` field alongside each dialog's existing `error: string | null`, which keeps its current validation/full-failure use unchanged).
- New shared component `shared/components/failed-result-list.tsx` renders one line per row (`service: message`) and, when `resolveAssistedAction(row.code)` returns non-null, an inline `[Enter] <label>` affordance — same file hosts the registry (`Record<string, AssistedAction>`, one entry today).
- The real rejection code is `branch-owned-by-other-edt` (from `adapters/driven/git/index.ts`'s `assertAllowedBranch`) — not `branch-already-claimed`; register the actual code.
- The "try a different branch" action is wired only where a per-repo branch-edit path already exists today: Modify's member `branchEdit` (reopen via `openBranchEdit`, re-run `submitModify`), Service-actions "Change branch" (`submitServiceActionsBranchChange`), Add-to-EDT (`submitAddToEdt`) — reopen pre-filled with the failed value, re-run the same submit function on confirm.
- EXPERIENCE.md's EDTs State Patterns table already has the "Branch already claimed by another EDT" row (added with this story's Sprint Change Proposal) — no doc edit needed.
- `logEdtAction`'s failure `detail` stays a plain joined string (`rows.map(r => r.message).join('; ')`) — action history formatting is out of scope.

**Ask First:** None expected — narrowing below is code-evidenced, not a product call.

**Never:** Wiring the action on Create or Switch — `core/edt/create.ts`'s `resolveMemberBranch` never passes `edtId` to `assertAllowedBranch` (line 325), so this code cannot occur at create time; `switchEdtAction` carries no per-member branch override, so there is no submit path to retry into. Both still get the plain structured line (AC2's "no registered action" treatment, same as a genuinely unregistered code). Remove-from-edt never touches a branch, so its rows never carry this code in practice. Building `text-input-line.tsx` (2.23, may already exist by implementation time — prefer it) or branch-picker modes (2.26).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Any partial failure | `results` has ≥1 `outcome: 'failed'` row | One line per repo, no `; `-joined string | N/A |
| Collision, actionable dialog | `code: 'branch-owned-by-other-edt'` in Modify/service-actions/add-to-edt | Row shows `[Enter] try a different branch`; confirms via existing branch-edit + same submit fn | Re-verified by `assertAllowedBranch` again on retry |
| Collision, Create/Switch | same code, but in create/switch result | Plain per-repo line, no action | N/A (matches unregistered-code default) |
| Unregistered code | e.g. `no .tui-back.yaml found`, fetch failure | Plain per-repo line, no action | N/A |
| No failures | `results` all succeeded | `failedRows` empty, nothing rendered | N/A |

</frozen-after-approval>

## Code Map

- `src/adapters/driving/tui/zones/edts/edts-zone.tsx` -- `FailableResultRow`/`summarizeFailedResults` (L256-264) become `FailedResultRow`/return `FailedResultRow[]`; 6 call sites at L870, L905, L949, L1162, L1191, L1298 (`submitCreate`, `handleSwitchConfirm`, `submitModify`, `submitRemoveFromEdt`, `submitServiceActionsBranchChange`, `submitAddToEdt`) switch to the array + set new `failedRows` field; dialog state types `CreateDialogState`/`SwitchDialogState`/`ModifyDialogState`/`ServiceActionsDialogState`/`AddToEdtDialogState` (L478-550) each gain `failedRows: FailedResultRow[] | null`; render sites at L1595, L1617, L1652, L1680, L1693 swap `dialog.error ? <DimAnnotation .../>` for `<FailedResultList rows={dialog.failedRows} onAction={...} />` when non-empty, `DimAnnotation` for plain `error` stays for validation/full-failure text.
- `src/adapters/driving/tui/zones/edts/edts-zone.tsx` -- `openBranchEdit` (L980-984) reused as-is for Modify's retry; new thin wrapper to re-run `submitServiceActionsBranchChange`/`submitAddToEdt`/`submitModify` from a row action, colocated near each.
- `src/core/edt/create.ts` -- `resolveMemberBranch` (L299-342), `assertAllowedBranch` call (L325) — confirms `edtId` is never passed here (why Create is excluded above); read-only, no change.
- `src/adapters/driven/git/index.ts` -- `assertAllowedBranch` (L58-99), `branch-owned-by-other-edt` (L95) is the real error code; read-only.
- `src/adapters/driving/tui/shared/components/failed-result-list.tsx` -- new. Exports `FailedResultRow`, `AssistedAction`, `resolveAssistedAction(code)`, `FailedResultList` component. Follows `dim-annotation.tsx`'s colocated-test precedent.
- `_bmad-output/planning-artifacts/ux-designs/ux-tui-back-2026-08-10/EXPERIENCE.md` -- L107, "Branch already claimed by another EDT" row already present; verify only, no edit.
- Tests: `edts-zone.test.tsx`/`.interaction.test.tsx` (structured rows, retry re-run per call site); new `failed-result-list.test.tsx` (registry lookup, render, action callback).

## Tasks & Acceptance

**Execution:**
- [x] `failed-result-list.tsx` -- new `FailedResultRow`/`AssistedAction`/`resolveAssistedAction`/`FailedResultList` -- the extensible registry + shared renderer
- [x] `edts-zone.tsx` -- `summarizeFailedResults` → returns `FailedResultRow[]` -- structured data, no joined string
- [x] `edts-zone.tsx` -- all 6 call sites + 5 dialog state types gain `failedRows` -- consistent shape everywhere
- [x] `edts-zone.tsx` -- wire retry-on-action for Modify/service-actions-branch-change/add-to-edt only -- matches the Never boundary
- [x] `edts-zone.tsx` render -- swap `DimAnnotation` for `FailedResultList` at the 5 dialog render sites when `failedRows` non-empty
- [x] Extend `edts-zone.test.tsx`/`.interaction.test.tsx`; new `failed-result-list.test.tsx` for the I/O matrix

**Acceptance Criteria:**
- Given any of the 6 partial-failure call sites, when it completes with failed rows, then each renders its own `service: message` line, never a `; `-joined string.
- Given a failed row's `code`, when rendered, then `resolveAssistedAction` decides the action shown — unregistered codes (including `branch-owned-by-other-edt` inside Create/Switch results) render with no action.
- Given a `branch-owned-by-other-edt` row inside Modify, service-actions branch-change, or Add-to-EDT, when `[Enter] try a different branch` is chosen, then the existing branch-edit affordance reopens pre-filled and confirming re-runs the same submit function — not a full-dialog restart.
- Given a future failure code gains its own action later, then only `resolveAssistedAction`'s registry needs a new entry — no change to `FailedResultList`.
- `npm test`, `npm run typecheck`, `npm run depcheck` all pass.

## Spec Change Log

## Design Notes

Write order note: this story is sequenced to land before 2.22/2.24's own branch-collision failures start flowing through it — if those land first with `summarizeFailedResults`, migrate their call sites in the same pass rather than leaving mixed string/array error handling. `text-input-line.tsx` (2.23) doesn't exist in the codebase yet; if it lands first, prefer it for the retry re-open over today's plain `<Text>` convention — no functional difference either way.

## Verification

**Commands:**
- `npm test` -- all suites green, including `failed-result-list.test.tsx` and updated `edts-zone.*.test.tsx`
- `npm run typecheck` -- clean
- `npm run depcheck` -- no boundary violations

**Manual checks:**
- Force a switch/modify/add-to-edt collision (register the same branch under two EDTs) → per-repo lines, "try a different branch" on the collision row for modify/add-to-edt/service-actions paths, plain line for switch. Trigger an unrelated failure (e.g. missing manifest) → plain line, no action, on every call site including the 3 wired ones.

## Suggested Review Order

**The extensible registry + shared renderer**

- Entry point: the registry mapping a failure `code` to an optional guided action, plus the row list it decides.
  [`failed-result-list.tsx:28`](../../../src/adapters/driving/tui/shared/components/failed-result-list.tsx#L28)

- `hasOwnProperty` guard (review patch) — a plain lookup would resolve an inherited `Object.prototype` key as a false-positive action.
  [`failed-result-list.tsx:32`](../../../src/adapters/driving/tui/shared/components/failed-result-list.tsx#L32)

- Renders one line per row, growing an inline `[Enter] <label>` hint only when the code resolves.
  [`failed-result-list.tsx:54`](../../../src/adapters/driving/tui/shared/components/failed-result-list.tsx#L54)

**Structured data, never a joined string**

- `summarizeFailedResults` now returns `FailedResultRow[]` instead of a `; `-joined string.
  [`edts-zone.tsx:440`](../../../src/adapters/driving/tui/zones/edts/edts-zone.tsx#L440)

- `stripAssistedActionCodes` enforces the Never boundary: Create/Switch rows never resolve to an action, even for the collision code.
  [`edts-zone.tsx:457`](../../../src/adapters/driving/tui/zones/edts/edts-zone.tsx#L457)

- `findRetryableFailedRow` (review patch) — the "first row with a registered action" lookup shared by both retry handlers below.
  [`edts-zone.tsx:463`](../../../src/adapters/driving/tui/zones/edts/edts-zone.tsx#L463)

**"Try a different branch" retry wiring**

- `autoSubmitOnConfirm` distinguishes a retry-opened branch edit (auto-resubmits) from a normal member-row edit (stages only).
  [`edts-zone.tsx:734`](../../../src/adapters/driving/tui/zones/edts/edts-zone.tsx#L734)

- Modify's Enter dispatcher: reopens the branch-edit sub-view pre-filled with the rejected value, takes priority whenever a retryable row exists.
  [`edts-zone.tsx:1554`](../../../src/adapters/driving/tui/zones/edts/edts-zone.tsx#L1554)

- Confirming a retry-opened branch edit re-runs `submitModify` immediately instead of just staging the value.
  [`edts-zone.tsx:1527`](../../../src/adapters/driving/tui/zones/edts/edts-zone.tsx#L1527)

- Service-actions' Enter dispatcher: same retry pattern, pre-filled from `lastAttemptedBranch` since this dialog's own sub-state clears on submit.
  [`edts-zone.tsx:1752`](../../../src/adapters/driving/tui/zones/edts/edts-zone.tsx#L1752)

**Dialog state and render-site wiring (repetitive across 5 dialogs)**

- `failedRows` added alongside each dialog's existing `error` field, which keeps its validation/full-failure role unchanged.
  [`edts-zone.tsx:699`](../../../src/adapters/driving/tui/zones/edts/edts-zone.tsx#L699)

- Render sites swap `DimAnnotation` for `FailedResultList` whenever `failedRows` is non-empty.
  [`edts-zone.tsx:2135`](../../../src/adapters/driving/tui/zones/edts/edts-zone.tsx#L2135)

- Barrel export for the new shared component.
  [`components/index.ts:31`](../../../src/adapters/driving/tui/shared/components/index.ts#L31)

**Tests**

- Registry/render coverage for the new component: empty list, multi-row, and the inline-hint gating.
  [`failed-result-list.test.tsx:20`](../../../src/adapters/driving/tui/shared/components/failed-result-list.test.tsx#L20)

- Unit coverage for `summarizeFailedResults`'s new structured return type.
  [`edts-zone.test.tsx:714`](../../../src/adapters/driving/tui/zones/edts/edts-zone.test.tsx#L714)

- Real-keypress matrix coverage: retry flows for Modify/service-actions/Add-to-EDT, plus the Create/Switch "no action" cases.
  [`edts-zone.interaction.test.tsx:1448`](../../../src/adapters/driving/tui/zones/edts/edts-zone.interaction.test.tsx#L1448)
