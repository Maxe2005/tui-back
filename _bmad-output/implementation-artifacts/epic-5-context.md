# Epic 5 Context: Aggregated Log Observability

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

A developer can view a live, filterable, aggregated log stream across multiple services, with inline health status, a developer-triggered restart control, recall of previously used filters, and a display that never corrupts the terminal — so they stop hopping between terminals and retyping filters to diagnose an issue. The epic was reopened (2026-11-05) so noisy streams can be tamed: log filters can hide or show-only (whole line or matched text), stack as ordered rules per scope, and persist across restarts as active rule lists and named rule sets.

## Stories

- Story 5.1: Aggregated Live Log Stream
- Story 5.2: Filter the Aggregated Stream
- Story 5.3: Inline Service Health & Restart Control
- Story 5.4: Filter History Recall
- Story 5.5: Bound List & Filter-Editor Height to the Terminal Window
- Story 5.6: Command History Recall & Shared Input-History Primitive
- Story 5.7: Logs — Restart Mode Setting & Open-IDE Shortcut
- Story 5.8: Hide / Show-Only Log Filters (reopened)
- Story 5.9: Stackable Log Filter Rules (reopened)
- Story 5.10: Persisted Filter Rules and Named Rule Sets (reopened)

## Requirements & Constraints

- Live aggregated stream from all services in the active EDT (or a chosen subset); a log line visible within ~1s of emission, UI interaction under ~150ms.
- Filter by free-text/regex and log level, combined with AND, without interrupting the stream; invalid regex rejected inline, never silently ignored or crashing. No separate "filter by service" mechanism — pane-per-service selection covers that.
- Each service's health (up/down/restarting) visible inline with its logs; restart is developer-triggered only (replaces silent auto-restart) and disabled while a restart is already in progress.
- Filter history (5.4) remembers the last N committed text/regex queries per scope (global vs. each service) and per mode (text vs. regex); history is a distinct persisted concept. Amended by 5.10: the stream and buffer are never persisted, but filter rules (active lists and named sets) are.
- Every list or panel whose content can exceed the terminal height (5.5) renders inside a bounded, scrollable window with more-above/below indicators, recalculated live on resize; behavior unchanged when nothing overflows.
- Filter rule (5.8): query + mode (text/regex) + action (`show` keeps matches, default; `hide` removes them) + target (`line` or `match` = only the matched text; `hide`+`match` strips matches, `show`+`match` keeps only matches, a line left empty is dropped). Empty regex matches are ignored. Default `show`+`line` equals the old behaviour; history entries store all three, dedup on all three, legacy entries read as `show`+`line`. Invalid regex always rejected inline. Filtering never alters buffered lines (`Esc` restores all) and still ANDs with service and level filters.
- Rule stack (5.9): each scope (global, per-service) holds an ordered list of rules with an `enabled` flag, max 10, applied as a top-to-bottom pipeline (two `show` rules = AND; a `hide`+`match` rule rewrites input for rules below it); disabled rules skipped; global rules apply first, then the service's. Add/edit/toggle/delete/move apply live without interrupting the stream; invalid regex never enters the list; add beyond the cap is refused with a visible message.
- Persistence (5.10): active rule lists per scope are restored at Logs tab open (enabled state and order kept); a library of named sets (max 20 sets, 10 rules each) supports save (overwrite and non-empty replace ask confirmation, empty name refused), apply (copies; sets are snapshots), rename, delete (destructive confirmation). Uncompilable stored regex or corrupt value is dropped with a visible warning naming the field; lists of unregistered services are kept and ignored. `:settings` Logs tab offers separate clear-one-scope and delete-library actions.

## Technical Decisions

- `core/logs` owns a bounded in-memory ring buffer per service, sized for scroll-back plus Epic 6's future fire-correlation window; nothing written to disk, discarded on restart. `adapters/driven/docker` only streams raw lines in.
- Log re-renders are debounced/batched, never a full redraw per line; Ink's rendering ceiling (~30 FPS cap) is a named monitored risk with OpenTUI as fallback.
- The central Zustand store's `logBuffers` is a read view onto `core/logs`, never a second copy; zone-local UI state (cursor, scroll) stays component-local.
- Filtering is a pure render-time transform over buffered `LogLine[]`; level matching is a text heuristic (no level field on `LogLine`). Restart triggers a Docker restart via the driven docker adapter.
- Filter history is persisted state on `StatePort`/`state.json` (never `settings.yaml`); history-size and grid-rows are per-user preferences on the Logs settings tab with their own MIN/MAX clamps.
- The `command-grid` component (column-major, arrow-navigable, from the `:` command bar) is reused as the history grid browser as a second independent instance.
- The `bounded-list` scrollable-window primitive (5.5) is extracted from `keybinding-help.tsx` (`resolveHelpWindow`/`clampHelpOffset`) into `tui/shared/` and reused by Logs and EDTs zones.

- Input-history mechanics (push/dedup/trim, arrow-browse state machine, snap-back-to-draft, persisted store: hydrate-once, version guard, serialized save chain, await-in-flight-load) live once in `tui/shared/input-history/` and a generic persisted-history store factory (5.6), consumed by both the Logs filter editor and the `:` command bar; `StatePort` gains command-history read/write; shared `MIN/MAX_INPUT_HISTORY_SIZE` (1..200).

- Rule model (5.8) is a named type so 5.9 only wraps a list around it. `applyLogFilter(line, filter)` (pure, returns rendered line or nothing) becomes `applyLogRules(line, rules)` reducing over the list (5.9); rewriting happens at render time, ring buffer unchanged (AD-11). Regexes compile once per rule-list change, not per line.
- `StatePort`/state adapter gain read/write for active rule lists (keyed by scope) and the set library (5.10), using the same tolerant-reader approach as filter history; tested by temp-file integration tests and core tests against a fake `StatePort`.
- Rule list and set library are windowed cursor-driven lists via the bounded-list primitive (AD-19); long indicators are truncated, never wrapped. All keys come from keybinding declarations and appear in the `?` help; Esc steps editor -> list -> close (clearing all rules is an explicit action).

## UX & Interaction Patterns

- Logs zone follows the standard list/detail split with splitter (~2:3); list rows show service identity plus inline health badge using the closed status-badge glyph+color vocabulary, never color alone.
- Named states: no-members, live streaming, filter-applied-without-interruption, invalid-regex rejection, service-down/crashed-mid-stream with auto-reconnect, inline health, restart-in-progress disabling, filter-history browsing (arrow-recall + grid browser), bounded scrolling when content overflows.
- History recall: `↑` from a draft recalls most-recent for that scope+mode with draft preservation; `↑` walks older (no-op at oldest); `↓` walks back, restoring the draft past the most recent; typing while browsing snaps back to the draft with the keystroke applied; `↓` from a fresh draft opens the grid browser.
- Health badge updates on restart completion, glyph+color paired per the status-badge rule.

- Command bar (5.6): same arrow-recall semantics as 5.4, but `↓` from a fresh draft keeps its autocomplete-grid behavior (no history grid); only exact recognized commands are recorded; `:settings` Command Palette tab gains a row cursor, history size/dedup settings and a clear action.

- Filter editor (5.8-5.10): action and target switchable from the keyboard, active combination always visible next to the query; recalling a history entry restores query, action and target; rule list shows query, mode, action, target and enabled state per rule.

## Cross-Story Dependencies

- Depends on Epic 1 (hexagonal core, CLI parity, manifest) and Epic 2 (active EDT + member-service list) for the scope of the stream and per-service health.
- Story 5.2 builds on 5.1's stream and pane scoping; 5.3 is independent of 5.2/5.4 mechanics but shares 5.1's stream and scoping; 5.4 builds on 5.2's editor plus Story 2.17 grid primitives and Story 2.19 settings-tab precedent without reopening 5.2; 5.5 fixes a rendering defect found during 5.4 review and reuses its hint-panel fix; 5.6 extracts 5.4's history logic behavior-preservingly (5.4 tests must pass unchanged) and coordinates with Story 2.32 (TextInputLine in the command bar: cursor at end-of-value on recall).
- Epic 6 will later depend on Epic 5's buffer for request-log correlation; buffer sizing already anticipates this.
- Story 5.7 builds on 5.3 (restart control) and Epic 7's Story 7.12 shared service-actions registry (`core/service-actions`: `openInIde`, simple/clean restart); adds `logs.restartMode` (simple|clean, default simple) on the Logs settings tab, applied live; the IDE key must respect UX-DR36 and not collide with filter/scroll/fullscreen keys.
- Stories 5.8 -> 5.9 -> 5.10 are strictly sequential: 5.8 extends 5.2 (filter), 5.4 (history) and 5.5 (bounded editor) and defines the rule type; 5.9 wraps a list of it (history recall still applies per rule); 5.10 persists the lists and sets via `StatePort`. Epic 9 (shared Logs zone) is already merged; independent of Epics 10 and 11. Epic 5 returns to done when 5.10 merges.
