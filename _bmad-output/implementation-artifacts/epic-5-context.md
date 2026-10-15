# Epic 5 Context: Aggregated Log Observability

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

A developer can view a live, filterable, aggregated log stream across multiple services, with inline health status, a developer-triggered restart control, recall of previously used filters, and a display that never corrupts the terminal — so they stop hopping between terminals and retyping filters to diagnose an issue.

## Stories

- Story 5.1: Aggregated Live Log Stream
- Story 5.2: Filter the Aggregated Stream
- Story 5.3: Inline Service Health & Restart Control
- Story 5.4: Filter History Recall
- Story 5.5: Bound List & Filter-Editor Height to the Terminal Window
- Story 5.6: Command History Recall & Shared Input-History Primitive
- Story 5.7: Logs — Restart Mode Setting & Open-IDE Shortcut

## Requirements & Constraints

- Live aggregated stream from all services in the active EDT (or a chosen subset); a log line visible within ~1s of emission, UI interaction under ~150ms.
- Filter by free-text/regex and log level, combined with AND, without interrupting the stream; invalid regex rejected inline, never silently ignored or crashing. No separate "filter by service" mechanism — pane-per-service selection covers that.
- Each service's health (up/down/restarting) visible inline with its logs; restart is developer-triggered only (replaces silent auto-restart) and disabled while a restart is already in progress.
- Filter history (5.4) remembers the last N committed text/regex queries per scope (global vs. each service) and per mode (text vs. regex); live/active filter state itself stays ephemeral and is never persisted — history is a distinct exempted concept.
- Every list or panel whose content can exceed the terminal height (5.5) renders inside a bounded, scrollable window with more-above/below indicators, recalculated live on resize; behavior unchanged when nothing overflows.

## Technical Decisions

- `core/logs` owns a bounded in-memory ring buffer per service, sized for scroll-back plus Epic 6's future fire-correlation window; nothing written to disk, discarded on restart. `adapters/driven/docker` only streams raw lines in.
- Log re-renders are debounced/batched, never a full redraw per line; Ink's rendering ceiling (~30 FPS cap) is a named monitored risk with OpenTUI as fallback.
- The central Zustand store's `logBuffers` is a read view onto `core/logs`, never a second copy; zone-local UI state (cursor, scroll) stays component-local.
- Filtering is a pure render-time transform over buffered `LogLine[]`; level matching is a text heuristic (no level field on `LogLine`). Restart triggers a Docker restart via the driven docker adapter.
- Filter history is persisted state on `StatePort`/`state.json` (never `settings.yaml`); history-size and grid-rows are per-user preferences on the Logs settings tab with their own MIN/MAX clamps.
- The `command-grid` component (column-major, arrow-navigable, from the `:` command bar) is reused as the history grid browser as a second independent instance.
- The `bounded-list` scrollable-window primitive (5.5) is extracted from `keybinding-help.tsx` (`resolveHelpWindow`/`clampHelpOffset`) into `tui/shared/` and reused by Logs and EDTs zones.

- Input-history mechanics (push/dedup/trim, arrow-browse state machine, snap-back-to-draft, persisted store: hydrate-once, version guard, serialized save chain, await-in-flight-load) live once in `tui/shared/input-history/` and a generic persisted-history store factory (5.6), consumed by both the Logs filter editor and the `:` command bar; `StatePort` gains command-history read/write; shared `MIN/MAX_INPUT_HISTORY_SIZE` (1..200).

## UX & Interaction Patterns

- Logs zone follows the standard list/detail split with splitter (~2:3); list rows show service identity plus inline health badge using the closed status-badge glyph+color vocabulary, never color alone.
- Named states: no-members, live streaming, filter-applied-without-interruption, invalid-regex rejection, service-down/crashed-mid-stream with auto-reconnect, inline health, restart-in-progress disabling, filter-history browsing (arrow-recall + grid browser), bounded scrolling when content overflows.
- History recall: `↑` from a draft recalls most-recent for that scope+mode with draft preservation; `↑` walks older (no-op at oldest); `↓` walks back, restoring the draft past the most recent; typing while browsing snaps back to the draft with the keystroke applied; `↓` from a fresh draft opens the grid browser.
- Health badge updates on restart completion, glyph+color paired per the status-badge rule.

- Command bar (5.6): same arrow-recall semantics as 5.4, but `↓` from a fresh draft keeps its autocomplete-grid behavior (no history grid); only exact recognized commands are recorded; `:settings` Command Palette tab gains a row cursor, history size/dedup settings and a clear action.

## Cross-Story Dependencies

- Depends on Epic 1 (hexagonal core, CLI parity, manifest) and Epic 2 (active EDT + member-service list) for the scope of the stream and per-service health.
- Story 5.2 builds on 5.1's stream and pane scoping; 5.3 is independent of 5.2/5.4 mechanics but shares 5.1's stream and scoping; 5.4 builds on 5.2's editor plus Story 2.17 grid primitives and Story 2.19 settings-tab precedent without reopening 5.2; 5.5 fixes a rendering defect found during 5.4 review and reuses its hint-panel fix; 5.6 extracts 5.4's history logic behavior-preservingly (5.4 tests must pass unchanged) and coordinates with Story 2.32 (TextInputLine in the command bar: cursor at end-of-value on recall).
- Epic 6 will later depend on Epic 5's buffer for request-log correlation; buffer sizing already anticipates this.
- Story 5.7 builds on 5.3 (restart control) and Epic 7's Story 7.12 shared service-actions registry (`core/service-actions`: `openInIde`, simple/clean restart); adds `logs.restartMode` (simple|clean, default simple) on the Logs settings tab, applied live; the IDE key must respect UX-DR36 and not collide with filter/scroll/fullscreen keys.
