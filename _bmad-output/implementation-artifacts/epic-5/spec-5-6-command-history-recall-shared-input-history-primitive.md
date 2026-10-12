---
title: 'Command History Recall & Shared Input-History Primitive'
type: 'feature'
created: '2026-10-12'
status: 'in-progress'
baseline_commit: 'a2c1c0b3c1fe0d4d504a632344e4cac62227c48b'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5/spec-5-4-filter-history-recall.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The `:` command bar forgets every command; the Logs filter editor (5.4) has arrow-recall history, but its logic (push/dedup/trim, browse state machine, snap-back, persisted-store mechanics) is Logs-specific, so reusing it would mean copying it.

**Approach:** Extract that logic once into a shared, generic input-history primitive (pure `tui/shared/input-history/` module + generic persisted-store factory), re-point the Logs filter editor at it behavior-preservingly, then add a persisted command history to the command bar with ↑/↓ recall and matching `:settings` controls.

## Boundaries & Constraints

**Always:**
- Each of these exists exactly once, consumed by both features: push/dedup/trim; browse state machine (up/down, skip entries equal to the draft); snap-back-to-draft; persisted store mechanics (hydrate-once, version guard vs stale reads, serialized save chain, await-in-flight-load before mutate).
- Story 5.4's existing tests pass unchanged. The shared primitive gets its own tests.
- `logs-zone.logic.ts` keeps only `FilterHistoryKey`/`filterHistoryKeyString`.
- Only an Enter on an exact, recognized command records history (`runCommand` returned true) — never an unknown command.
- Dedup per `settings.commandPalette.historyDedup` (on: move-to-front anywhere; off: top-only), trimmed to `commandPalette.historySize` (default 20, dedup default true). Size bounds become shared `MIN/MAX_INPUT_HISTORY_SIZE` (1..200), used by both history settings.
- ↑ on a draft recalls most recent (draft preserved); ↑ older (no-op at oldest); ↓ walks back; ↓ past most recent restores the draft exactly. Not browsing, ↓ keeps today's behavior (enter the autocomplete grid if visible, else no-op) — no history grid.
- While browsing: printable/Backspace → snap back, draft restored, keystroke applied on top; Enter runs the displayed command; Tab adopts the recalled text as the new draft (browsing ends), then behaves as usual on it.
- Persisted in `state.json` as `commandHistory` (single list) via `StatePort.readCommandHistory/writeCommandHistory`, sharing the state adapter's read-merge-write helper (siblings never clobbered; corrupt field isolated).
- `:settings` Command Palette tab: size and dedup apply and persist immediately; a "clear command history" action empties it; the tab gains a row cursor (Up/Down between rows), mirroring the Logs tab's 5.4 rework.
- `reset` (core `reset-tool.ts`, `reset-slice.ts`, reset screen text) also clears `commandHistory`, exactly as it clears `filterHistory` (human-confirmed).

**Ask First:** None outstanding.

**Never:**
- A command-history grid browser.
- Changing 5.4's user-visible behavior or its test expectations.
- Storing history in `settings.yaml`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| RECORD | Enter on `update-service foo` (recognized) | Pushed to front, deduped, trimmed | N/A |
| UNKNOWN | Enter on `zzz` | "Unknown command.", history unchanged | N/A |
| RECALL_UP | Draft `up`, history `[a,b]` | Shows `a`; ↑ → `b`; ↑ → no-op | N/A |
| RESTORE | Browsing at most recent, ↓ | Draft `up` restored exactly | N/A |
| SKIP_DRAFT | History `[x,up,y]`, draft `up` | ↑ shows `x`, next ↑ skips `up` → `y` | N/A |
| SNAP_BACK | Browsing, type `s` | Draft restored + `s` appended | N/A |
| TAB_ADOPT | Browsing `edt-switch`, Tab | Recalled text becomes draft, normal Tab completion | N/A |
| DOWN_DRAFT | Not browsing, grid visible, ↓ | Focus enters the grid (unchanged) | N/A |
| RESTART | App restarted, `:` opened | Previous history recallable | Missing/corrupt field → empty list |

</frozen-after-approval>

## Code Map

- `src/adapters/driving/tui/zones/logs/logs-zone.logic.ts` -- `pushFilterHistoryEntry` (:768), `FilterHistoryBrowseState`, `resolveHistoryBrowseUp/Down` (:781-857) to extract; `FilterEditorState.browsing` (:806)
- `src/adapters/driving/tui/zones/logs/logs-zone.tsx` -- filter editor arrow/snap-back/Tab wiring (:458-511, :431-443) to route through the shared snap-back helper
- `src/adapters/driving/tui/store/slices/logs-slice.ts` -- `filterHistory` machinery (:114-171, :743-842: version, save chain, load promise, `clearFilterHistoryAndDrainSaves`) to extract into a generic store factory
- `src/adapters/driving/tui/shared/command-bar.tsx` -- `CommandBar` `useInput` (:440-560): Enter→`runCommand`, ↓ at :539, Tab :517; add `browsing` state + recall
- `src/core/ports/state.ts`, `src/adapters/driven/state/{index,schema}.ts` -- `StatePort` (:16-17), `extractFilterHistory` (:160), `writeFilterHistory` (:271): add `commandHistory` twin
- `src/core/ports/settings.ts` (:19, :65, :93-99), `src/adapters/driven/settings/schema.ts` (:34-40, :74-88), `store/slices/settings-slice.ts` (:13, :71) -- new `commandPalette.historySize/historyDedup`; generalize `MIN/MAX_FILTER_HISTORY_SIZE`
- `src/adapters/driving/tui/shared/settings-screen.tsx` -- Command Palette tab (:472, :738) gains row cursor; model on the Logs group list (:259-293, :493-600, :747-848)
- `src/adapters/driving/tui/app-shell.tsx` (:203, :242) -- hydrate command history once at mount
- Existing tests to keep green: `logs-zone.logic.test.ts`, `logs-zone.interaction.test.tsx`, `logs-slice.test.ts`, `app-store.test.ts`, `settings-screen.test.tsx`, `state/index.test.ts`

## Tasks & Acceptance

**Execution:**
- [ ] `tui/shared/input-history/` -- pure generic `pushHistoryEntry`, `HistoryBrowseState`, `resolveHistoryBrowseUp/Down`, snap-back helper + own tests -- single source of recall logic
- [ ] `tui/shared/input-history/` (store factory) -- generic persisted-history store (hydrate-once, version guard, save chain, await-in-flight) + own tests -- single source of persistence mechanics
- [ ] `logs-zone.logic.ts`, `logs-zone.tsx`, `logs-slice.ts` -- consume the primitives, drop duplicated code; 5.4 tests unchanged
- [ ] `core/ports/state.ts` + state adapter + schema + tests -- `commandHistory` read/write
- [ ] `core/ports/settings.ts` + schema + `settings-slice.ts` -- new settings, shared `MIN/MAX_INPUT_HISTORY_SIZE`
- [ ] `command-bar.tsx` + `app-shell.tsx` + store -- record on recognized Enter, ↑/↓ recall, snap-back, Tab adopt, hydrate; cursor at end-of-value (coordinate with 2.32)
- [ ] `settings-screen.tsx` -- Command Palette row cursor, size/dedup/clear controls
- [ ] `reset-tool.ts`, `reset-slice.ts`, `reset-screen.logic.ts` + tests -- clear `commandHistory` on reset
- [ ] Tests -- full I/O matrix through real keypresses for the command bar; settings tab; state adapter

**Acceptance Criteria:**
- Given the refactor, when the code is searched, then each listed mechanic is defined in exactly one module.
- Given a restart, when `:` opens, then prior commands recall; missing/corrupt `commandHistory` yields an empty list, never a crash.
- Given history size lowered in `:settings`, when the next command is recorded, then the list is trimmed to the new size.

## Spec Change Log

## Verification

**Commands:**
- `npm test` -- expected: all suites pass, 5.4 suites unmodified
- `npm run typecheck` -- expected: no errors
- `npm run depcheck` -- expected: no new violations
