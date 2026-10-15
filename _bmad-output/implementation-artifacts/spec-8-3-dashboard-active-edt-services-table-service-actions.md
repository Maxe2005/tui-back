---
title: 'Story 8.3: Dashboard — Active-EDT Services Table & Per-Service Actions'
type: 'feature'
created: '2026-10-15'
status: 'in-progress'
baseline_commit: '4b7167788fb5c712f8eed29c2f0d9deef40486b3'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-8-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Dashboard lists services as flat one-line rows: no focus, no anomaly explanation, and no way to open, restart or clean-restart a service from the first screen.

**Approach:** Render the active EDT line plus a services table (state glyph+text, issue marker, branch, ahead/behind) with an Up/Down cursor. The focused row shows a reason line and the registry's `ServiceActionsRow`; `Ctrl+O/R/L` run the actions with inline progress/result, and `Enter` opens the service in its zone. Rows change only on `R` — no live poll.

## Boundaries & Constraints

**Always:** Actions come exclusively from `createServiceActions` (`list` → `ServiceActionsRow`); a new registered action appears without layout change. Cursor via `shared/keys/list-cursor.ts` + `BoundedList` `cursorIndex`; keys gated by `useZoneInputActive`. Unavailable actions show their reason (no container, no clean recipe, `operation in progress`, or the held lock's name). While a row's action runs, its other actions are disabled with "operation in progress". `Ctrl+R` (restart) and `R` (refresh) never collide; `Ctrl`/`Meta` letters must not trigger zone mnemonics (`shouldSwitchZone` and siblings). Footer and `?` help come from `KEYBINDINGS` (`zones: ['dashboard']`). Keep the declared list/detail boundary (table = list pane, reason + actions = detail pane) so Ctrl+W keeps working. Core stays TUI-free; English; header comments ≤ 5 lines; no story/AC references in `src/`.

**Ask First:** Changing `ServiceActions` port signatures (needed for no-recipe availability and progress callback); choosing the target zone of `Enter`.

**Never:** Attention block, registry health changes, EDT actions (8.4/8.5); live polling or auto-reload after an action; a second action registry; reading `key.tab`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Navigate | `↓`/`↑` on populated table | cursor moves (clamped); reason line + actions follow | N/A |
| Anomaly | dirty / merge / rebase / probe error / no-upstream / offline | focused row's reason line names it; issue marker on row | probe error shows its message |
| Unavailable | no container / no clean recipe | action dim with `(reason)` | key press ignored |
| Run | `Ctrl+R`/`Ctrl+L` on available action | row shows "Clean restart — recipe step 2/3", then result; sibling actions disabled "operation in progress" | failure shown inline on the row |
| Lock held | update / migration / switch lock held | restart/clean disabled with lock name | N/A |
| Open | `Ctrl+O` / `Enter` | IDE opens / service opened in its zone | IDE error shown inline |
| Elsewhere | restart done in Logs/Update | row unchanged until `R` | N/A |
| Overlay open | help/settings/command bar | all keys inert | N/A |

</frozen-after-approval>

## Code Map

- `src/adapters/driving/tui/zones/dashboard/dashboard-body.tsx` -- replace `ServiceRow` one-liner (l.21) with table + `ZoneLayout` detail pane; `BoundedList` currently has no `cursorIndex`.
- `.../dashboard/dashboard.logic.ts` -- add pure `issueMarker`, `aheadBehindLabel`, `reasonLine` (reuse `containerLabel`, `workingTreeLabel`, `branchLabel`), row action-state labels.
- `.../dashboard/dashboard-zone.tsx:49` -- key handler (`R` only today); add cursor, `Ctrl+O/R/L`, `Enter`, `!key.ctrl` on `R`.
- `.../store/slices/dashboard-slice.ts` -- per-service action state (running/progress/result), `runServiceAction`, build `serviceActions` from deps (pattern `logs-slice.ts:195`, `update-slice.ts:1353`), `pendingServiceFocus` for `Enter`.
- `src/core/service-actions/index.ts` -- availability lacks "no clean recipe" (l.74-87) and has no progress callback; `restart('clean')` falls back with `NO_CLEAN_RECIPE_NOTICE`.
- `src/core/ports/lock.ts`, `core/scripts/group-update.ts:23,25`, `service-restart.ts:27` -- `peek` only, no holder name: new core helper maps keys (`group-update`, `edt:<ulid>`, service) to a label.
- `shared/components/service-actions-row.tsx` -- presentational, unused by any zone yet.
- `src/adapters/driving/tui/app-shell.tsx:59,325` -- `shouldSwitchZone` ignores `key.ctrl`: `Ctrl+R`→Routes, `Ctrl+L`→Logs today.
- `keybindings/keybindings.ts:170` -- add dashboard rows for `Ctrl+O/R/L`, `Enter`, `↑/↓`.
- `zones/zone-layouts.ts:20` -- boundary kept; tests pinning it: `app-shell.interaction.test.tsx:2078`, `app-shell.test.tsx:625`, `app-store.test.ts`.

## Tasks & Acceptance

**Execution:**
- [ ] `src/core/service-actions/index.ts` (+ test) -- clean-restart availability "no clean recipe", optional progress callback, lock-name helper -- reasons and progress
- [ ] `src/adapters/driving/tui/app-shell.tsx` (+ tests) -- ignore Ctrl/Meta for zone switching -- no key collision
- [ ] `store/slices/dashboard-slice.ts` (+ test) -- action state, run, `pendingServiceFocus`, unwired degradation -- state
- [ ] `zones/dashboard/dashboard.logic.ts` (+ test) -- marker, ahead/behind, reason line -- pure logic
- [ ] `zones/dashboard/dashboard-body.tsx`, `dashboard-zone.tsx` (+ unit/interaction tests) -- table, cursor, detail pane, keys -- UI
- [ ] `keybindings/keybindings.ts`, target zone (+ tests) -- hints, `Enter` consumption -- discoverability

**Acceptance Criteria:**
- Given the active EDT, when rendered, then the EDT line and one bounded row per service show state, marker, branch, ahead/behind.
- Given a focused row, when `Ctrl+R` runs, then progress/result appear inline and `R` stays refresh.
- Given an overlay or a held lock, when keys are pressed, then nothing runs and the lock name shows.
- Given `npm test`, `typecheck`, `depcheck`, then all pass (incl. bounded-rendering and comment-hygiene guards).

## Spec Change Log

## Design Notes

Story 7.7 shipped only the Tab/arrow stop primitive, not a list component; row focus here uses `list-cursor.ts`. Lock names are derived by the caller from the keys it can `peek`; cross-process holders appear only through `peek`.

## Verification

**Commands:**
- `npm test` -- expected: all green
- `npm run typecheck` -- expected: no errors
- `npm run depcheck` -- expected: no violations
