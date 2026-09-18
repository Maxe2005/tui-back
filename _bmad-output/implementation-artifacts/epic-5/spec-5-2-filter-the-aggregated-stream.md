---
title: 'Filter the Aggregated Stream'
type: 'feature'
created: '2026-09-18'
status: 'in-progress'
review_loop_iteration: 0
context: []
baseline_commit: 'aa40c8edaec61b934399526f05acf2515be54b47'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Logs zone (story 5.1) streams every selected service's full unfiltered output; a developer debugging a specific issue must scan every line in every pane to find what matters.

**Approach:** Add a two-tier text/regex/level filter over already-buffered lines: one **global** filter engaged by every pane by default, and a **per-pane** filter that stacks on top of it — each pane can also individually disengage from the global filter. No "filter by service" is added — pane-per-service selection (5.1) already covers that.

## Boundaries & Constraints

**Always:**
- Filtering is a pure render-time transform over already-buffered `LogLine[]` (same layer as 5.1's `filterVisibleLines` stdout/stderr toggle) — it never resubscribes or touches the Docker stream.
- Two independent, composable scopes: a global `LogFilterSpec` (text/regex + level) every pane is engaged with by default, and an optional per-pane `LogFilterSpec` that always applies on top of whichever global state that pane is engaged with. A pane's effective filter is `(engaged ? global : pass) AND (own ?? pass)`.
- `g` (bare, sub-focused grid pane or fullscreen pane) toggles that one pane's engagement with the global filter — mirrors the existing bare-key-scopes-to-one-pane idiom (`c`/`w`).
- `f` (bare, same scope as `g`) opens a filter-editor modal for that pane's own filter; `/` (any Logs-zone focus) opens the editor for the global filter. Both editors share one component and validation.
- An invalid regex (when regex mode is on) shows an inline error in the editor and is never applied — the previously-active filter (if any) stays in effect; it never throws into the render tree.
- Level filtering has no source field (`LogLine` has no level) — matched via a text heuristic (`ERROR|WARN|INFO|DEBUG`, case-insensitive) against `line.text`; a line with no detectable level is excluded whenever any level restriction is active.
- Escape, when no editor is open: if a pane is sub-focused in the grid (not fullscreen), clears that pane's own filter if set, else disengages it from the global filter; if no pane is sub-focused (list-focus), clears the global filter entirely. Fullscreen's Escape keeps its existing 5.1 meaning (leave fullscreen) unchanged — clearing there requires leaving fullscreen first.
- `app-shell.tsx`'s global `/`-opens-filter-stub must not also fire while the Logs zone owns `/` itself (same double-dispatch hazard already solved for arrow keys via `logsPaneGridArrowsActive`).

**Ask First:** None outstanding — scope, the two-tier design, and the "no service filter" decision were resolved during intent negotiation.

**Never:**
- Add a third, distinct "filter by service" mechanism — selection (5.1) already scopes panes to services.
- Persist any filter to `settings.ts` or disk — ephemeral UI state only, like 5.1's visibility/wrap flags.
- Add a level field to `LogLine`, the ring buffer, or the Docker adapter — the heuristic stays purely at render time.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| COMBINED_AND | Global text filter + a pane's own level filter both active | Pane shows only lines matching both | N/A |
| INVALID_REGEX | Regex mode on, malformed pattern typed | Inline error in editor; prior filter (if any) stays applied | Never thrown/crashed |
| PANE_OPT_OUT | Pane disengaged (`g`) while global filter active | That pane ignores the global filter; its own filter (if any) still applies | N/A |
| ESCAPE_PANE | Esc, pane sub-focused, own filter set | That pane's own filter clears; engagement/global unaffected | N/A |
| ESCAPE_LIST | Esc, list-focused, global filter active | Global filter clears; disengaged panes stay disengaged (unaffected) | N/A |

</frozen-after-approval>

## Code Map

- `src/adapters/driving/tui/zones/logs/logs-zone.logic.ts` -- add `LogLevel`/`LogFilterSpec` types, `DEFAULT_LOG_FILTER`, `detectLogLevel`, `compileLogFilter` (regex/level compile + error), `applyLogFilters` (composes with existing `filterVisibleLines`), `isPaneEngagedInGlobalFilter`/`toggleGlobalFilterEngagement` (mirror `isPaneWrapped`/`togglePaneWrapFlag` at :259-268), `setPaneLogFilter`, `resolveFilterClearTarget` (pure Escape-scope resolver)
- `src/adapters/driving/tui/zones/logs/logs-zone.tsx` -- new local state (`globalFilter`, `paneFilterEngaged`, `paneFilters`, `filterEditor`), extend `useInput` in both the grid (:290-393) and fullscreen (:241-268) branches for `/`/`f`/`g`/Escape-clear + editor text capture, extend `dialogOpen` (:199-203) to cover `filterEditor !== null`, compose `applyLogFilters` into `LogsPaneView`/`FullscreenPane`'s existing `filterVisibleLines` call sites (:231, :545-546, :606-607), render new `LogFilterEditor` (via `ModalDialog` + `TextInputLine`, mirroring `branch-picker.tsx`'s `FilterableBranchList` query-field idiom), extend hint `DimAnnotation`s (:438-450, :631)
- `src/adapters/driving/tui/app-shell.tsx:352` -- guard `shouldOpenFilter` dispatch with `activeZone !== 'logs'`, same precedent as `logsPaneGridArrowsActive` (:346)
- `src/adapters/driving/tui/zones/logs/logs-zone.logic.test.ts` -- unit tests for `compileLogFilter`, `applyLogFilters`, `resolveFilterClearTarget`
- `src/adapters/driving/tui/zones/logs/logs-zone.test.tsx` / `logs-zone.interaction.test.tsx` -- render/keypress coverage for the editor, engagement toggle, and Escape rule

## Tasks & Acceptance

**Execution:**
- [ ] `logs-zone.logic.ts` -- add filter types, `compileLogFilter`, `applyLogFilters`, engagement helpers, `resolveFilterClearTarget` -- pure, unit-testable core mirroring 5.1's wrap/visibility helper shape
- [ ] `logs-zone.tsx` -- wire local filter state, extend `useInput` (grid + fullscreen), extend `dialogOpen`, compose filtering into both pane renderers, render `LogFilterEditor`, extend hints -- delivers the two-tier filter UI on 5.1's existing display-filter plumbing
- [ ] `app-shell.tsx` -- guard `shouldOpenFilter` with `activeZone !== 'logs'` -- prevents the app-wide filter stub firing on the same `/` keystroke
- [ ] `logs-zone.logic.test.ts` -- cover valid/invalid regex, level heuristic, AND-combination, engagement bypass, all three Escape targets
- [ ] `logs-zone.test.tsx` / `logs-zone.interaction.test.tsx` -- `/`, `f`, `g` scoping and inline-error rendering

**Acceptance Criteria:**
- Given a live stream and an active filter (either scope), when new lines arrive, then the underlying subscription is untouched — filtering never resubscribes.
- Given a pane disengaged from the global filter with no own filter set, when rendered, then it shows every buffered line unaffected by the global filter's state.
- Given both scopes are active for a pane at once, when rendered, then a line must satisfy both to show (AND, never override).

## Design Notes

Level heuristic excludes lines with no detected level once any level restriction is active — a deliberate trade-off (many container logs carry no level tag) accepted because the alternative (showing untagged lines regardless) would make an "errors only" filter silently leak unrelated noise back in.

`compileLogFilter` recomputes on every editor keystroke (not just submit) so the inline regex error appears/clears live, matching `branch-picker.tsx`'s live-query-match feel rather than a submit-then-validate cycle.

