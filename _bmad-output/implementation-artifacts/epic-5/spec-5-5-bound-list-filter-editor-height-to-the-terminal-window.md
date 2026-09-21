---
title: 'Bound List & Filter-Editor Height to the Terminal Window'
type: 'bugfix'
created: '2026-09-21'
status: 'done'
review_loop_iteration: 0
context: []
baseline_commit: 'f30e6dd7a9fbf20220ba2c34b27b47e25212ee9b'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Logs zone's service lists, always-visible hints panel, and `LogFilterEditor` (including story 5.4's history-grid browser) render with no height cap, so when their combined content exceeds the terminal's actual row count, Ink's diff-render desyncs and corrupts the display (reproduced live); the EDTs zone has the same unbounded-list pattern, confirmed by inspection.

**Approach:** Extract `keybinding-help.tsx`'s `resolveHelpWindow`/`clampHelpOffset` into a new shared `BoundedList` primitive — a live, `useWindowSize()`-driven scrollable window with a more-above/below indicator — and apply it to the Logs zone's two service lists, hints panel, and `LogFilterEditor` (extending `command-bar.tsx`'s grid layout with vertical pagination for the history grid), plus the EDTs zone's two service lists.

## Boundaries & Constraints

**Always:**
- New `BoundedList` component + pure helpers (`resolveBoundedWindow`/`clampBoundedOffset`, generic over `T`) live in `src/adapters/driving/tui/shared/components/bounded-list.tsx`, exported via `components/index.ts`, mirroring `keybinding-help.tsx`'s pure-logic-exported-standalone / generic-over-`T` / thin-component convention.
- `KeybindingHelp` migrates to consume the new shared primitive instead of duplicating window logic — no behavior change for `keybinding-help.tsx` itself.
- Every bounded list/panel recalculates its visible window live from Ink's `useWindowSize()` on every resize — never a value computed once at mount (mirrors existing usage at `logs-zone.tsx:328`, `command-bar.tsx:350`, `app-shell.tsx:209`).
- A subtle more-above/below indicator renders whenever a bounded list is scrolled away from either end; absent when nothing overflows.
- Apply `BoundedList` to: Logs zone's ACTIVE EDT MEMBERS list (`logs-zone.tsx:846-867`), OTHER SERVICES list (`:869-887`), hints panel (`:889-923`, keeping the existing focus-hidden-while-editing fix at `:889-903` intact), and `LogFilterEditor`'s body (`:1208-1271`) including its history-grid browser (`:1235-1261`).
- Apply the same primitive to EDTs zone's EDT SERVICES list (`edts-zone.tsx:591-610`) and OTHER SERVICES list (`:618-631`).
- The filter-history grid (`command-bar.tsx`'s generalized `layoutCommandGrid` etc., lines 190-324) gains vertical pagination when its row count exceeds available height — mirrors its existing horizontal truncation/scroll (UX-DR30) — without changing its column-major layout or existing cursor-move signatures.
- When nothing overflows, every touched surface renders exactly as it did before this story — no visible regression.

**Ask First:** None outstanding — fully specified by `sprint-change-proposal-2026-09-20.md` and `epics.md`'s Story 5.5 acceptance criteria.

**Never:**
- Change `ModalDialog` chrome itself — the fix bounds content rendered inside each panel, not the panel's border/frame.
- Reopen or modify story 5.4's filter-compile/history-push/browse acceptance criteria — only the grid's vertical rendering changes.
- Change the EDTs zone lists' content, selection, or action semantics — only add the scrollable window around existing rows.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| OVERFLOW_LOGS_LISTS | Combined Logs zone content exceeds terminal rows | Lists + hints panel render within a bounded scrollable window with more-above/below indicator | N/A |
| OVERFLOW_EDTS_LISTS | Combined EDT SERVICES/OTHER SERVICES content exceeds terminal rows | Lists render within a bounded scrollable window | N/A |
| OVERFLOW_HISTORY_GRID | Filter-history grid has more rows than fit vertically | Grid paginates/scrolls vertically, same idiom as its existing horizontal truncation | N/A |
| RESIZE_LIVE | Terminal resized while a bounded list is open | Visible window recalculates immediately off `useWindowSize()`, never stale | N/A |
| NO_OVERFLOW | Content fits within terminal rows | Renders exactly as before this story, no scroll indicator | N/A |
| EDITOR_OPEN_BEHIND_CONTENT | `LogFilterEditor` open with service lists/hints panel/pane grid still mounted behind it | Combined rendered content never exceeds terminal rows; hint panel stays hidden per 5.4's existing focus-fix | N/A |

</frozen-after-approval>

## Code Map

- `src/adapters/driving/tui/shared/components/keybinding-help.tsx` -- extract `resolveHelpWindow` (:18-32) / `clampHelpOffset` (:10-16) into the new shared primitive; keep `resolveHelpScroll` (:36-54) and `KeybindingHelp` (:56-99) wired to it, no behavior change
- `src/adapters/driving/tui/shared/components/bounded-list.tsx` (new) -- `BoundedList` component + `resolveBoundedWindow`/`clampBoundedOffset` pure helpers, generic over `T`; owns the `useWindowSize()`-driven live recompute and the more-above/below indicator
- `src/adapters/driving/tui/shared/components/bounded-list.test.tsx` (new) -- unit coverage for the pure helpers + indicator rendering
- `src/adapters/driving/tui/shared/components/index.ts` -- export `BoundedList` + its pure helpers alongside existing `KeybindingHelp` exports
- `src/adapters/driving/tui/zones/logs/logs-zone.tsx` -- wrap ACTIVE EDT MEMBERS (:846-867), OTHER SERVICES (:869-887), hints panel (:889-923), and `LogFilterEditor`'s body (:1208-1271) in `BoundedList`; existing `useWindowSize()` call (:328) reused
- `src/adapters/driving/tui/shared/command-bar.tsx` -- extend `layoutCommandGrid` (:190-254) with vertical pagination (max visible rows + scroll offset) for the history-grid use inside `LogFilterEditor`; verify `moveGridCursorVertical` (:274-285)/`moveGridCursorHorizontal` (:293-317)/`commandAtGridCursor` (:322-324) stay correct against a paginated window
- `src/adapters/driving/tui/zones/edts/edts-zone.tsx` -- wrap EDT SERVICES (:591-610) and OTHER SERVICES (:618-631) lists in `BoundedList`
- `src/adapters/driving/tui/shared/components/keybinding-help.test.tsx`, `command-bar.test.tsx`, `zones/logs/logs-zone.test.tsx`, `logs-zone.interaction.test.tsx`, `zones/edts/edts-zone.test.tsx`, `edts-zone.layout.test.tsx` -- extend/adjust coverage per file above

## Tasks & Acceptance

**Execution:**
- [x] `shared/components/bounded-list.tsx` -- add `BoundedList` + pure window/clamp helpers, `useWindowSize()`-driven live recompute, more-above/below indicator -- single reusable primitive per UX-DR33
- [x] `shared/components/keybinding-help.tsx` -- migrate to the shared primitive, remove duplicated window logic -- no behavior change, proves the extraction
- [x] `shared/components/index.ts` -- export the new primitive -- consistent with existing shared/components exports
- [x] `shared/command-bar.tsx` -- add vertical pagination to `layoutCommandGrid` for the history-grid use -- the grid must scroll vertically the way it already scrolls horizontally
- [x] `zones/logs/logs-zone.tsx` -- wrap the two service lists, hints panel, and `LogFilterEditor` body in `BoundedList` -- fixes the reproduced terminal-corruption defect
- [x] `zones/edts/edts-zone.tsx` -- wrap EDT SERVICES/OTHER SERVICES lists in `BoundedList` -- same defect pattern, confirmed by inspection
- [x] `shared/components/bounded-list.test.tsx`, `keybinding-help.test.tsx`, `command-bar.test.tsx`, `logs-zone.test.tsx`, `logs-zone.interaction.test.tsx`, `edts-zone.test.tsx`, `edts-zone.layout.test.tsx` -- cover new behavior + regression-guard the no-overflow case

**Acceptance Criteria:**
- [x] Given a terminal large enough that nothing overflows, when the Logs or EDTs zone is used, then visible behavior is unchanged from before this story.
- [x] Given `LogFilterEditor` is open with the pane grid still mounted behind it, when rendered, then the Docker log-stream subscription itself is never touched by the bounding change — this is a pure rendering fix.
- [x] Given the hint-panel-hidden-while-editing fix shipped in story 5.4, when this story's changes land, then that fix is retained, not undone.

## Spec Change Log

## Design Notes

`resolveHelpWindow`'s slice-based windowing (`items.slice(offset, offset+visibleLines)`) generalizes directly: `resolveBoundedWindow<T>(items, scrollOffset, visibleLines)` returns the same `{ visible, scrollOffset }` shape, kept `T`-generic exactly like `keybinding-help.tsx`'s existing generic. The more-above/below indicator is new — `keybinding-help.tsx` has none today — render it as a single dim line above/below the sliced content only when `scrollOffset > 0` / `scrollOffset < maxOffset`, following the closed status-badge convention of glyph+text, never color alone.

## Verification

**Commands:**
- `npm test` -- expected: all suites pass, including new/extended cases in the bounded-list, keybinding-help, command-bar, logs-zone, and edts-zone test files
- `npm run typecheck` -- expected: no type errors, including the generic `BoundedList<T>` and the extended grid-layout signature
- `npm run depcheck` -- expected: no new dependency-direction violations

## Suggested Review Order

**Core budget primitive**

- Entry point — the invariant everything else in this story is built on: never render more rows than `maxVisibleRows`, indicators included.
  [`bounded-list.tsx:76`](../../../src/adapters/driving/tui/shared/components/bounded-list.tsx#L76)

- Review fix: a final affordability pass caps indicators to whatever the budget has left after content, closing the maxVisibleRows-1/2 overshoot a reviewer found.
  [`bounded-list.tsx:108`](../../../src/adapters/driving/tui/shared/components/bounded-list.tsx#L108)

- Thin, stateless component wiring the primitive to a renderer + optional cursor-follow.
  [`bounded-list.tsx:151`](../../../src/adapters/driving/tui/shared/components/bounded-list.tsx#L151)

**Grid vertical pagination (reuses the same primitive)**

- `layoutCommandGrid` splits into the pre-5.5 horizontal resolver plus this new vertical pass — single public entry point unchanged.
  [`command-bar.tsx:213`](../../../src/adapters/driving/tui/shared/command-bar.tsx#L213)

- Review fix: now reuses `resolveBoundedVisibility` instead of a second, easy-to-desync budget calculation — closes the same over-budget class of bug at the grid level.
  [`command-bar.tsx:309`](../../../src/adapters/driving/tui/shared/command-bar.tsx#L309)

**Logs zone wiring (the reported defect's origin)**

- Sequential top-down row allocator — EDT list, then OTHER list, then hints, then the filter editor's own reservation; each empty-list case now counts its 1-row placeholder rather than 0 (review fix).
  [`logs-zone.tsx:356`](../../../src/adapters/driving/tui/zones/logs/logs-zone.tsx#L356)

- Review fix: column width for the history grid now reads from the full unsliced column, not the vertically-windowed one, so padding no longer shifts as the user scrolls.
  [`logs-zone.tsx:1317`](../../../src/adapters/driving/tui/zones/logs/logs-zone.tsx#L1317)

- ACTIVE EDT MEMBERS list bounded to its share of the budget.
  [`logs-zone.tsx:903`](../../../src/adapters/driving/tui/zones/logs/logs-zone.tsx#L903)

- OTHER SERVICES list bounded to its share, after subtracting the EDT list's consumption.
  [`logs-zone.tsx:928`](../../../src/adapters/driving/tui/zones/logs/logs-zone.tsx#L928)

- Hints panel bounded last (and still hidden entirely while the filter editor is open — story 5.4's fix, retained).
  [`logs-zone.tsx:970`](../../../src/adapters/driving/tui/zones/logs/logs-zone.tsx#L970)

**EDTs zone (same defect pattern, applied for consistency)**

- Same top-down allocator idiom as the Logs zone, with its own chrome-row constant.
  [`edts-zone.tsx:230`](../../../src/adapters/driving/tui/zones/edts/edts-zone.tsx#L230)

- EDT SERVICES list bounded.
  [`edts-zone.tsx:626`](../../../src/adapters/driving/tui/zones/edts/edts-zone.tsx#L626)

- OTHER SERVICES list bounded.
  [`edts-zone.tsx:657`](../../../src/adapters/driving/tui/zones/edts/edts-zone.tsx#L657)

**Extraction proof (no behavior change)**

- `keybinding-help.tsx`'s old window/clamp functions are now literal aliases for the shared primitive.
  [`keybinding-help.tsx:17`](../../../src/adapters/driving/tui/shared/components/keybinding-help.tsx#L17)

**Tests**

- Budget-invariant unit coverage at the extreme `maxVisibleRows` 1/2 values, plus the cursor-follow regression the review fix targets.
  [`bounded-list.test.tsx`](../../../src/adapters/driving/tui/shared/components/bounded-list.test.tsx)

- Vertical-pagination coverage for the grid, including the same never-over-budget sweep.
  [`command-bar.test.tsx`](../../../src/adapters/driving/tui/shared/command-bar.test.tsx)

- I/O-matrix coverage: OVERFLOW_LOGS_LISTS, NO_OVERFLOW, and the empty-list-placeholder boundary case.
  [`logs-zone.test.tsx`](../../../src/adapters/driving/tui/zones/logs/logs-zone.test.tsx)

- Interaction coverage: OVERFLOW_HISTORY_GRID, RESIZE_LIVE, EDITOR_OPEN_BEHIND_CONTENT, scrolled-cursor Enter-recall correctness, and column-width stability while scrolling.
  [`logs-zone.interaction.test.tsx`](../../../src/adapters/driving/tui/zones/logs/logs-zone.interaction.test.tsx)

- OVERFLOW_EDTS_LISTS and NO_OVERFLOW coverage for the EDTs zone.
  [`edts-zone.test.tsx`](../../../src/adapters/driving/tui/zones/edts/edts-zone.test.tsx)
