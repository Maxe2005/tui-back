---
title: 'Filter History Recall'
type: 'feature'
created: '2026-09-19'
status: 'done'
review_loop_iteration: 0
context: []
baseline_commit: '0f8e1679b27c6ac8368887d6fff9aebb6dec33c0'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Logs zone's filter editor (story 5.2) has no memory — a developer who filtered on the same text/regex query yesterday, or on a different service five minutes ago, must retype it from scratch every time.

**Approach:** Give each scope+mode combination (global text, global regex, and per-service text/regex) its own persisted history of committed filters, recalled via `↑`/`↓` arrow-browsing from the editor's draft or via a grid browser — reusing `command-bar.tsx`'s generalized grid primitives — plus new Logs settings for history size/grid rows and per-scope clear actions on a reworked, row-cursor Logs settings tab.

## Boundaries & Constraints

**Always:**
- History entries are plain query strings (no level), one independent list per exact `(scope, mode)` key: global-text, global-regex, and per-service-text/per-service-regex for every manifest service path.
- History is new persisted state on `StatePort`/`state.json` (a new optional top-level key), never `settings.ts`/`settings.yaml` — mirrors `splitterRatios`' read-merge-write-under-lock shape in `adapters/driven/state/index.ts` so a write to one field never clobbers siblings.
- On commit (`Enter`, compiles, non-empty), push the query to the front of its exact scope+mode list; move-to-front instead of duplicating if identical to the current top entry; trim to `settings.logs.filterHistorySize`.
- `↑` on an untouched draft recalls the most-recent entry of that scope+mode, preserving the draft; further `↑` walks older entries, no-op past the oldest.
- `↓` while browsing walks back toward the draft; one more `↓` past the most-recent entry restores the original draft exactly as it stood before browsing began.
- Any printable character or Backspace while browsing snaps back to the draft with that keystroke applied on top — same one-key-resume idiom already used elsewhere in this editor.
- `↓` on an untouched draft (not browsing) opens a column-major grid browser over that scope+mode's full history, reusing `groupCommandsByColumn`/`layoutCommandGrid`/`GridCursor`/`moveGridCursorVertical`/`moveGridCursorHorizontal`/`commandAtGridCursor` generalized beyond `Command[]`; `Enter` recalls the highlighted entry, `Esc` closes the whole filter-editor bar (not just the grid).
- Two new settings, `settings.logs.filterHistorySize` and `settings.logs.filterHistoryGridMaxRows`, each with its own `MIN_`/`MAX_` constants mirroring `MIN_LOG_BUFFER_SIZE`/`MAX_LOG_BUFFER_SIZE` and `MIN_GRID_MAX_ROWS`/`MAX_GRID_MAX_ROWS` — independent of `commandPalette.gridMaxRows`.
- The Logs settings tab gains a row-cursor model (mirrors the EDTs tab's `groupCursor`/`moveHintCursor` precedent) covering all of: `bufferSize`, `startWithHistory`, the two new fields, and the two clear actions (global; per-service, drilled into a list of manifest services) — every field stays reachable unambiguously.
- History-clear actions never clear more than targeted: "clear global" only touches the two global lists; "clear this service" only touches that one service's two lists.
- History survives an app restart (loaded from `state.json` on the next filter-editor open).

**Ask First:** None outstanding — fully specified by `sprint-change-proposal-2026-09-18.md` and `epics.md`'s Story 5.4 acceptance criteria.

**Never:**
- Persist the live/active filter state itself — `globalFilter`/`paneFilters` stay exactly as ephemeral `useState` per story 5.2's boundary; history is a distinct, exempted concept.
- Store history data in `settings.ts`/`settings.yaml` (preferences only, not history).
- Reopen or modify story 5.2's own filter-compile/apply/engagement acceptance criteria.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| HISTORY_PUSH | Commit compiles, non-empty, new query | Pushed to front of its scope+mode list, trimmed to N | N/A |
| DEDUP_TOP | Commit identical to current top entry | Moved to front, not duplicated | N/A |
| ARROW_UP_OLDEST | `↑` already at the oldest entry | No-op | N/A |
| ARROW_DOWN_PAST_RECENT | `↓` from the most-recent entry while browsing | Original draft restored exactly | N/A |
| SNAP_BACK_TYPE | Printable char or Backspace while browsing | Browsing stops, draft restored, keystroke applied on top | N/A |
| GRID_OPEN_ESC | `↓` from an untouched draft, then `Esc` | Grid opens listing full history, then whole editor closes | N/A |
| CLEAR_SERVICE | Clear one service's history from the Logs tab | Only that service's two lists (text/regex) clear | N/A |
| RESTART_PERSIST | App restarted, filter editor reopened | Previously recorded history still available | N/A |

</frozen-after-approval>

## Code Map

- `src/core/ports/settings.ts` -- add `logs.filterHistorySize`/`filterHistoryGridMaxRows` + `MIN_/MAX_FILTER_HISTORY_SIZE`/`MIN_/MAX_FILTER_HISTORY_GRID_MAX_ROWS` (mirror `MIN_LOG_BUFFER_SIZE` :67-74 and `MIN_GRID_MAX_ROWS` :64-65); extend `DEFAULT_SETTINGS.logs` (:57)
- `src/core/ports/state.ts` -- add `readFilterHistory`/`writeFilterHistory` to `StatePort` (:14-19), mirroring `readSplitterRatios`/`writeSplitterRatios`
- `src/adapters/driven/state/index.ts` (251 lines) + `schema.ts` -- add `filterHistory` to `StateFileShape` (:33-36) and `stateSchema` (schema.ts:15-20); add `extractFilterHistory` (mirrors `extractActiveEdt`/`extractSplitterRatios` :146-174); implement the two new port methods as read-merge-write under `withWriteLock` (mirrors `writeSplitterRatios` :238-249)
- `src/adapters/driven/state/index.test.ts` -- add cases for the new methods mirroring existing splitterRatios coverage (serialization, I/O-error propagation, per-field isolation on sibling corruption)
- `src/adapters/driving/tui/shared/command-bar.tsx` -- generalize `groupCommandsByColumn`/`layoutCommandGrid`/`CommandGridLayout`/`commandAtGridCursor` (:147-243, :311-315) with a generic `T` + `getLabel: (item: T) => string` accessor, replacing `columnDisplayWidth`'s hardcoded `.name.length` (:170-172) — the only real `Command`-specific access; existing call sites pass `getLabel = (c) => c.name`. `GridCursor`/`moveGridCursorVertical`/`moveGridCursorHorizontal` (:245-306) already generic, no change
- `src/adapters/driving/tui/zones/logs/logs-zone.logic.ts` -- add `FilterHistoryKey` (`{ scope: 'global'|'pane'; repoPath: string|null; mode: LogFilterMode }`), `pushFilterHistoryEntry` (front-push + move-to-front dedup + trim, pure), `resolveHistoryBrowseUp`/`resolveHistoryBrowseDown` (pure draft<->browsing transitions, mirrors `resolveFilterClearTarget`'s pure-resolver shape :434-439)
- `src/adapters/driving/tui/zones/logs/logs-zone.tsx` -- extend `FilterEditorState` (:100-112) with a `browsing: { index: number; savedDraft: string } | null` field; extend `applyFilterEditorDraft` (:326-355) to call `pushFilterHistoryEntry` on a successful commit; add `key.upArrow`/`key.downArrow` branches inside the filter-editor `useInput` block (:372-404, ahead of the printable-capture at :400-402, which already excludes arrows — no collision) for arrow-recall and grid-open; render the grid browser inside `LogFilterEditor` (:931-941, mounted :709-711) using the generalized command-bar.tsx functions, with its own small JSX loop (not a shared visual component — `CommandBar`'s own render block at :505-528 stays as-is)
- `src/adapters/driving/tui/store/slices/logs-slice.ts` -- add `filterHistory` state plus versioned load / serialized save-chain actions wired to `deps.state.readFilterHistory()`/`writeFilterHistory()`, mirroring `navigation-slice.ts`'s `splitterRatios` pattern — needed because the Settings screen (a separate component tree) must also read/clear this data
- `src/adapters/driving/tui/shared/settings-screen.tsx` -- rework the Logs tab (:281-303, :404-420) to a row-cursor model mirroring the EDTs tab's `groupCursor`/`moveHintCursor` (:133-250, :305-365, :422-437): rows become `bufferSize`, `startWithHistory`, `filterHistorySize`, `filterHistoryGridMaxRows`, "Clear global history", "Clear a service's history" (drill-down over `useStore((s) => s.edtsBranches)`, not currently read in this file)
- `src/adapters/driving/tui/zones/logs/logs-zone.logic.test.ts`, `logs-zone.interaction.test.tsx`, `settings-screen.test.tsx`, `command-bar.test.tsx`, `src/adapters/driven/state/index.test.ts` -- new coverage per file above

## Tasks & Acceptance

**Execution:**
- [x] `core/ports/settings.ts` -- add the two new Logs settings + their MIN/MAX constants and defaults -- single source of truth for the zod schema and the settings screen's clamps
- [x] `core/ports/state.ts` + `adapters/driven/state/index.ts` + `schema.ts` -- add `filterHistory` read/write, schema field, per-field extraction -- durable storage for history, isolated from sibling-field corruption
- [x] `adapters/driven/state/index.test.ts` -- cover the new methods -- parity with existing state-port field coverage
- [x] `shared/command-bar.tsx` -- generalize the grid primitives with a `getLabel` accessor -- one reusable grid implementation for both the command bar and filter history
- [x] `zones/logs/logs-zone.logic.ts` -- add history push/dedup/trim and browse-transition pure functions -- unit-testable core, same shape as 5.2's filter helpers
- [x] `store/slices/logs-slice.ts` -- wire persisted `filterHistory` load/save -- makes history readable/clearable from both the Logs zone and the Settings screen
- [x] `zones/logs/logs-zone.tsx` -- extend `FilterEditorState`, wire arrow-recall + grid-open/select/close, call the push helper on commit -- delivers the recall UX on top of 5.2's editor
- [x] `shared/settings-screen.tsx` -- row-cursor rework of the Logs tab, add the two new fields and clear actions -- keeps every field reachable per the epic's amended UX-DR31
- [x] `zones/logs/logs-zone.logic.test.ts`, `logs-zone.interaction.test.tsx`, `settings-screen.test.tsx`, `command-bar.test.tsx` -- cover the new behavior in each file above

**Acceptance Criteria:**
- Given a live stream and a developer browsing filter history, when arrow-recall or the grid browser is used, then the underlying Docker subscription is never touched — history browsing is a pure editor-draft transform, same as 5.2's filtering.
- Given the Logs settings tab's new row cursor, when navigating to the pre-existing `bufferSize`/`startWithHistory` fields, then they remain reachable and behave exactly as before (no regression from the rework).
- Given `state.json` is missing or has a corrupt `filterHistory` field, when the app starts, then every service simply starts with empty history — never a crash, same per-field isolation convention as `activeEdt`/`splitterRatios`.

## Design Notes

Command-bar.tsx's grid functions need only a generic type parameter and a `getLabel` accessor threaded through `layoutCommandGrid`/`columnDisplayWidth` — `moveGridCursorVertical`/`moveGridCursorHorizontal`/`GridCursor` are already fully generic today. For filter-history entries (plain strings), `getLabel = (s) => s`.

History entries store the query text only, never the level — level stays a live-only field on `FilterEditorState`, untouched by push/recall, since the epic's acceptance criteria describe recall purely in terms of "text/regex filters," not level restrictions.

`logs-slice.ts` (not zone-local state) owns the persisted history so the Settings screen's clear actions and the Logs zone's recall both read/mutate one source of truth — mirrors why `splitterRatios` lives in `navigation-slice.ts` rather than being zone-local.

## Verification

**Commands:**
- `npm test` -- expected: all suites pass, including new cases in the five files listed under Code Map
- `npm run typecheck` -- expected: no type errors, including the generalized grid function signatures
- `npm run depcheck` -- expected: no new dependency-direction violations (core ports still import nothing from adapters)

## Suggested Review Order

**History core (pure logic)**

- Entry point — the scope+mode key shape and the push/dedup/trim rule everything above builds on.
  [`logs-zone.logic.ts:519`](../../../src/adapters/driving/tui/zones/logs/logs-zone.logic.ts#L519)

- Front-push + top-only dedup + trim-to-N, the exact rule the I/O matrix's HISTORY_PUSH/DEDUP_TOP rows describe.
  [`logs-zone.logic.ts:534`](../../../src/adapters/driving/tui/zones/logs/logs-zone.logic.ts#L534)

- Pure draft↔browsing transitions for `↑`/`↓` — the state machine the editor's arrow keys just drive.
  [`logs-zone.logic.ts:549`](../../../src/adapters/driving/tui/zones/logs/logs-zone.logic.ts#L549)

**Filter editor wiring (arrow-recall, grid, Tab fix)**

- `browsing` added to the editor's draft state — non-null exactly while `↑`/`↓` are recalling.
  [`logs-zone.tsx:142`](../../../src/adapters/driving/tui/zones/logs/logs-zone.tsx#L142)

- Review-fix: Tab's mode toggle now resets `browsing` and restores the pre-browse draft, closing the stale-index-across-modes gap a reviewer found.
  [`logs-zone.tsx:512`](../../../src/adapters/driving/tui/zones/logs/logs-zone.tsx#L512)

- `↑`/`↓` dispatch into the pure resolvers above; `↓` on an untouched draft opens the grid instead.
  [`logs-zone.tsx:528`](../../../src/adapters/driving/tui/zones/logs/logs-zone.tsx#L528)

- Commit path — pushes into history only on a successful `Enter`, never on every keystroke.
  [`logs-zone.tsx:501`](../../../src/adapters/driving/tui/zones/logs/logs-zone.tsx#L501)

- Grid-browser render — reuses the generalized command-bar layout instead of a second bespoke grid.
  [`logs-zone.tsx:1122`](../../../src/adapters/driving/tui/zones/logs/logs-zone.tsx#L1122)

**Generalized grid primitive**

- `columnDisplayWidth` takes a `getLabel` accessor instead of `Command.name` — the one real behavioral dependency that made the grid `Command`-specific.
  [`command-bar.tsx:175`](../../../src/adapters/driving/tui/shared/command-bar.tsx#L175)

- `layoutCommandGrid`/`groupCommandsByColumn`/`commandAtGridCursor` generalized to `<T>`, now shared by the command bar and the filter-history grid.
  [`command-bar.tsx:190`](../../../src/adapters/driving/tui/shared/command-bar.tsx#L190)

**Persistence (StatePort + race-condition fix)**

- `filterHistory` added to `StatePort` alongside `splitterRatios` — same shape, same contract.
  [`state.ts:27`](../../../src/core/ports/state.ts#L27)

- Read-merge-write under lock so a `filterHistory` write never clobbers `activeEdt`/`splitterRatios` (or vice versa).
  [`index.ts:229`](../../../src/adapters/driven/state/index.ts#L229)

- Review-fix: a commit/clear now awaits any in-flight initial load before touching `filterHistory`, closing a silent-data-loss race a reviewer found.
  [`logs-slice.ts:390`](../../../src/adapters/driving/tui/store/slices/logs-slice.ts#L390)

- The guard itself — a load-in-progress promise, published synchronously so a same-tick commit can await it.
  [`logs-slice.ts:356`](../../../src/adapters/driving/tui/store/slices/logs-slice.ts#L356)

**Settings (new fields + Logs tab rework)**

- Two new settings, `MIN`/`MAX` constants and defaults, single source of truth for the schema and the tab's clamps.
  [`settings.ts:92`](../../../src/core/ports/settings.ts#L92)

- The Logs tab's new row-cursor model — mirrors the EDTs tab's group-list precedent so 6 fields/actions stay reachable.
  [`settings-screen.tsx:243`](../../../src/adapters/driving/tui/shared/settings-screen.tsx#L243)

- Per-service clear drill-down — the one row that mutates a different key (`repoPath`) than the rest of the tab.
  [`settings-screen.tsx:387`](../../../src/adapters/driving/tui/shared/settings-screen.tsx#L387)

**Store wiring**

- History hydrated once at mount, same idiom as `loadSplitterRatios`.
  [`app-shell.tsx:253`](../../../src/adapters/driving/tui/app-shell.tsx#L253)

**Tests**

- Race-condition regression — proves a commit/clear during the initial load no longer loses on-disk history.
  [`app-store.test.ts`](../../../src/adapters/driving/tui/store/app-store.test.ts)

- Full I/O-matrix + Tab-reset + grid-no-op + subscription-untouched coverage, real-keypress driven.
  [`logs-zone.interaction.test.tsx`](../../../src/adapters/driving/tui/zones/logs/logs-zone.interaction.test.tsx)

- Pure-function coverage for the history core and the new settings rows.
  [`logs-zone.logic.test.ts`](../../../src/adapters/driving/tui/zones/logs/logs-zone.logic.test.ts), [`settings-screen.test.tsx`](../../../src/adapters/driving/tui/shared/settings-screen.test.tsx)
