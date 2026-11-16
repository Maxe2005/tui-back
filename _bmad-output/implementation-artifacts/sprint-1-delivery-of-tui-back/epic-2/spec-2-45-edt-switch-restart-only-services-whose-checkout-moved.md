---
title: 'Story 2.45: EDT Switch — Restart Only the Services Whose Checkout Actually Moved'
type: 'feature'
created: '2026-11-16'
status: 'done'
baseline_commit: 'a1cf5e76b6d7f846bbf01cd4b2238f05fe1ea0a7'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/sprint-1-delivery-of-tui-back/epic-2-context.md'
  - '{project-root}/_bmad-output/sprints/sprint-1-delivery-of-tui-back/epics.md#Story 2.45'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 2.44 restarts every service of a switch whose row is `switched`, including repos that were already on the target branch with nothing stashed/restored — their containers restart for nothing (FR-37 says only services whose branch changed).

**Approach:** Add an additive `unchanged` row outcome, produced when a repo already sits on the branch the switch would check out and the switch touched nothing in its working tree; `unchanged` is not a restart target (`skipped (unchanged)`), is rendered dim, and never counts as needing attention.

## Boundaries & Constraints

**Always:** `unchanged` only when: current branch == resolved target, dirty plan is `none`, and no target-tagged stash exists (`hasStash`). Stash-on-dirty, target-stash restore, discard or adopt on an already-on-target repo keep `switched`/`adopted`/`discarded` and stay restart targets. A repo on a different branch behaves exactly as today. Resolve/gate (`resolveTargetBranch`) still runs before `unchanged` is returned. Existing outcome values and `CHANGED_OUTCOMES` (`switched|adopted|discarded`) are unchanged; `unchanged` is additive in the CLI/MCP envelope.

**Ask First:** Any change to the `GitPort` surface (the plan is none: `currentBranch` + `hasStash` suffice).

**Never:** No checkout is run for an `unchanged` repo. No change to restart semantics beyond target selection. If `currentBranch` fails or HEAD is detached, fall back to today's behaviour (`switched`), never `unchanged`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Already there, clean | on target, clean, no target stash | row `unchanged`, detail "already on `<branch>`", no checkout, restart `skipped (unchanged)` | N/A |
| Already there, dirty | on target, dirty → stashed | `switched`, restart target | as today |
| Already there, stash restore | on target, clean, target-tagged stash exists | `switched` (stash popped), restart target | pop failure → existing `failAfterCheckout` |
| Already there, discard/adopt | on target, dirty, discard/adopt | `discarded` / `adopted`, restart target | as today |
| Moved | on other branch | `switched`, restart target (`no container` skipped as today) | as today |
| Mixed | 3 repos: moved / already there / no container | 1 restarted, 1 `skipped (unchanged)`, 1 `skipped (no container)` | N/A |
| Unreadable branch | `currentBranch` fails / detached | `switched` path | none surfaced |

</frozen-after-approval>

## Code Map

- `src/core/edt/switch.ts` -- `SwitchEdtRepoResult.outcome` (l.24-32) gains `'unchanged'`; `Prepared`(l.537) + `executeDirtyPlan` `none` case (l.611); `succeeded` (l.790); `switchMemberRepo` (l.821, pops stash l.847) and `switchNonMemberRepo` (l.858). Both need a pre-checkout `git.currentBranch` read.
- `src/core/edt/checkout-expected.ts` -- `checkoutExpectedBranch`: runs `git.checkout` unconditionally (l.~50); add an optional skip hook (e.g. `skipCheckoutIf`/already-on-target short-circuit) after `prepare`, or compare before calling it.
- `src/core/ports/git.ts` -- `currentBranch`, `hasStash` (l.66, non-destructive), `restoreStash` (`Result<void>`, no-match = no-op; read-only here).
- `src/core/edt/switch-restart.ts` -- `CHANGED_OUTCOMES` (l.95) stays; `unchanged` skip reason already supported (l.24, l.132); verify only.
- `src/adapters/driving/tui/zones/edts/dialogs/switch-resolution/switch-resolution.logic.ts` -- `needsResultsView` (~l.544, `!== 'switched'`) must exclude `unchanged`; `describeSwitchForLog` (l.549) optionally counts it.
- `src/adapters/driving/tui/zones/edts/dialogs/switch-dialog.tsx` -- `resultLabel` (l.214, exhaustive switch) + dim style like `switched`; `switch-restart-report.tsx` same dir.
- `src/adapters/driving/tui/zones/edts/dialogs/create-wizard/wizard.logic.ts` -- `summarizeActivationResults` (l.621): `unchanged` is not attention-worthy.
- `src/adapters/driving/tui/zones/edts/edts-zone.logic.ts` -- l.603 comment on `SwitchDialogState.results`.
- `src/adapters/driving/tui/shared/test-support/dialog-registry.tsx` -- l.196 outcome cycle fixture.
- `src/adapters/driving/cli/commands/edt-switch.ts` -- `results` passes through raw (l.199); no code expected, document additive value; MCP tools wrap the CLI (`tool-registry.ts` l.165/298), no schema there.
- Tests: `src/core/edt/switch.test.ts`, `switch-restart.test.ts`, `checkout-expected.test.ts`, `switch-resolution.logic.test.ts`, `edts-zone.interaction.test.tsx`, `src/adapters/driving/cli/dispatch.test.ts`, `src/bin/tui-back.e2e.test.ts`.

## Tasks & Acceptance

**Execution:**
- [ ] `src/core/edt/switch.ts`, `checkout-expected.ts` -- add `unchanged` outcome and detection (branch equal + plan `none` + no target stash), skip checkout, detail "already on `<branch>`" -- core rule
- [ ] `src/core/edt/switch.test.ts`, `switch-restart.test.ts`, `checkout-expected.test.ts` -- cover every I/O matrix row incl. mixed 3-repo switch -- edge cases
- [ ] TUI files above -- render `unchanged` dim, never attention, fix `needsResultsView` and wizard summary; extend logic/interaction tests
- [ ] CLI/MCP -- envelope test showing `unchanged` row + `skipped (unchanged)` restart row; mention the additive value in the CLI help/docs if outcomes are listed

**Acceptance Criteria:**
- Given a switch where every repo is already on target and clean, when it runs, then all rows are `unchanged`, no checkout nor restart occurs, and the dialog shows no attention state.
- Given a switch mixing moved and already-there repos, when restart is enabled, then only moved services declaring a container restart.
- Given the CLI `edt switch` / MCP tool, when rows are emitted, then `unchanged` appears as an additive outcome and existing values are unchanged.

## Spec Change Log

## Design Notes

Detection uses only existing reads: capture `currentBranch` inside `prepare` (before the dirty plan, which never changes the branch), then after `prepare` decide `unchanged` iff `plan.kind==='none'` and (member only) `hasStash(repoPath, stashMessage(target.ulid))` is `false`. Non-members never pop a stash, so only the plan matters.

## Verification

**Commands:**
- `npx tsc --noEmit` -- expected: no errors
- `npx vitest run` -- expected: all green
- `npm run lint` -- expected: clean (if the script exists)

## Suggested Review Order

**Detection rule (entry point)**

- Member repo: `unchanged` only if already on target, plan `none`, and no target stash.
  [`switch.ts:853`](../../../../../src/core/edt/switch.ts#L853)

- Non-member repo: only the untouched plan and the shared branch matter.
  [`switch.ts:917`](../../../../../src/core/edt/switch.ts#L917)

- Detached or unreadable HEAD never counts as already-on.
  [`switch.ts:742`](../../../../../src/core/edt/switch.ts#L742)

- `untouched` is explicit per dirty-plan kind, so new plans cannot be skipped by accident.
  [`switch.ts:540`](../../../../../src/core/edt/switch.ts#L540)

**Checkout skip seam**

- Optional hook skips the checkout after resolve and prepare; realign unaffected.
  [`checkout-expected.ts:65`](../../../../../src/core/edt/checkout-expected.ts#L65)

**Presentation**

- Results view is not forced open for `unchanged` rows.
  [`switch-resolution.logic.ts:546`](../../../../../src/adapters/driving/tui/zones/edts/dialogs/switch-resolution/switch-resolution.logic.ts#L546)

- Wizard Step 4 summary words `unchanged` as non-attention.
  [`wizard.logic.ts:630`](../../../../../src/adapters/driving/tui/zones/edts/dialogs/create-wizard/wizard.logic.ts#L630)

**Tests**

- Matrix coverage for the core rule.
  [`switch.test.ts`](../../../../../src/core/edt/switch.test.ts)

- Mixed moved / unchanged / no-container restart report.
  [`switch-restart.test.ts`](../../../../../src/core/edt/switch-restart.test.ts)
