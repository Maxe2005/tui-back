---
title: 'Story 3.19: Full-Screen Service Report (Success / Error Logs)'
type: 'feature'
created: '2026-10-12'
status: 'in-progress'
baseline_commit: 'a2c1c0b3c1fe0d4d504a632344e4cac62227c48b'
review_loop_iteration: 0
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Update zone's inline detail pane caps steps (3), step detail (4 lines) and issues, and flattens error output to one line, so a long merge or migration error cannot be read in full.

**Approach:** Add a purely presentational `FullscreenReport` under `zones/update/`, opened with `f` on a service (or Enter on a failed recap row). It shows the complete, unflattened report, scrollable, live-updating, with failed-step navigation. The inline pane keeps its caps.

## Boundaries & Constraints

**Always:** Report shows context line (from → to), every step (merge, migration, restart) with full detail and error output, and each issue's full text. Scroll with ↑/↓, PgUp/PgDn, Home/End plus a position indicator; `w` toggles wrap/truncate (default wrap); `Esc` closes and leaves the zone unchanged. Failed steps use error colour + glyph (never colour alone); `n`/`p` jump between failed steps. Live: reads `lastServiceRuns` / `liveServiceSteps` / `liveServiceIssues` from the store, so it updates in place and switches to the final report when the run ends. Footer advertises `[f] full report` when a report is available. Complies with the bounded-rendering guard (empty allow-list: windowed `visibleLines`, `wrap` attribute containing `truncate`).

**Ask First:** Any change to core use-cases or the `ServiceRunSnapshot` shape (e.g. if core's `outputExcerpt` must carry more output).

**Never:** Lift caps on the inline pane; use Enter on the detail pane (it opens the service menu); add a bounded-rendering exemption; add global shortcuts.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Last run | Focused service with `lastServiceRuns`, press `f` | Fullscreen report, final steps, complete error text | N/A |
| Live run | `f` during run, then new steps/issues arrive | Report updates live; on finish shows final report | N/A |
| Nothing to show | Service with no run and no issues, `f` | No-op; no hint advertised | N/A |
| Recap | Recap view, cursor on failed row, Enter | Same report for that service | Non-failed row: no-op |
| Failed nav | `n`/`p` | Scroll to next/previous failed step, wrapping around | No failed step: no-op |
| Huge content | 300 issues, 5000-line error, 60x25 | Frame ≤ rows and ≤ width | N/A |

</frozen-after-approval>

## Code Map

All under `src/adapters/driving/tui/`.
- `zones/update/update-zone.tsx` -- single `useInput` (~L522-690): add report overlay branch BEFORE `resolveRecapToggle`/triggers (so `p`=config, Esc=recap don't fire); `f` trigger; `setZoneInputCaptured` list (L470-475) must include the report; footer via `useFooterContext` (L395); detail pane L788-805; recap L825-895 (`recapCursor` pages only; map to `updateResults[i]`, index-for-index with `resultLines`).
- `zones/update/update-zone.logic.ts` -- `buildServiceStepViews` (L408) flattens detail (`↵` join, `\s+`→space): add a full-fidelity variant/option keeping newlines; `updateFooterContext`/`UpdateFooterInput`: add `fullscreen` flag; pure key resolvers; `ServiceIssue` (L153).
- `zones/update/update-service-detail.tsx` -- inline pane, caps `MAX_STEP_VIEWS=3`, `MAX_STEP_DETAIL_LINES=4`; untouched.
- `zones/logs/fullscreen-pane.tsx`, `logs-zone.logic.ts` (`sliceVisibleWindow` L706, `computeLineRowCount` L737) -- mirror/reuse for windowing and wrap; Logs has no position indicator or PgUp/Home/End (add here).
- `keybindings/keybindings.ts` + `keybindings.test.ts` (`EXPECTED`) -- add `f (Update)` row with `footer:{key:'f',verb:'full report',zones:['update']}`; adjust the PgUp/PgDn wording if needed.
- `keybindings/footer-contexts.ts` -- add `'update-report'` context (hints via `formatHints`, unique label).
- `store/slices/update-slice.ts` -- `lastServiceRuns` (L281), `liveServiceSteps`, `liveServiceIssues` (L103): read-only.
- `shared/bounds/bounded-rendering.guard.test.ts`; `zones/update/bounded-rendering.test.tsx` -- model for the new dynamic test.

## Tasks & Acceptance

**Execution:**
- [ ] `zones/update/update-zone.logic.ts` -- full-fidelity report-line builder (unflattened steps, issues, failed-step line indices), report key resolver, footer input; unit tests in `update-zone.logic.test.ts` covering the matrix -- pure and testable
- [ ] `zones/update/fullscreen-report.tsx` -- presentational windowed view, position indicator, wrap/truncate, failed glyph+colour -- UX-DR/AD-19
- [ ] `zones/update/update-zone.tsx` -- open (`f`, recap Enter on failed row), input capture, live data wiring, Esc close -- integration
- [ ] `keybindings/keybindings.ts`, `footer-contexts.ts` (+ tests) -- `[f] full report` and report footer context
- [ ] Tests: `fullscreen-report` Ink smoke + interaction (open/scroll/`w`/`n`/`p`/Esc/live update/recap Enter), bounded-rendering dynamic test

**Acceptance Criteria:**
- Given a focused service with a last run or live issues, when `f` is pressed, then a full-screen report shows complete steps and issues with nothing capped or flattened.
- Given content longer than the screen, when scrolling, then the position indicator tracks and long lines wrap; `w` toggles; `Esc` returns to the zone unchanged.
- Given the report is open during a run, when steps/issues arrive or the run ends, then it updates in place.
- Given a failed step, then it is rendered with glyph + error colour and `n`/`p` jump between failures.
- Given the recap, when Enter on a failed row, then the same report opens; footer shows `[f] full report` when available.

## Spec Change Log

## Design Notes

Report lines are built as a flat `string`-like line model (with a kind tag for failed styling) so windowing, wrap row counts and failed-step jumps share one structure. The offset counts from the top (unlike Logs' tail offset).

## Verification

**Commands:**
- `npm test` -- expected: all green, including bounded-rendering guard and keybindings tests
- `npx tsc --noEmit` -- expected: no errors
- `npm run lint` -- expected: no errors (if the script exists)
