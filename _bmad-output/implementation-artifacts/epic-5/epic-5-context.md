# Epic 5 Context: Aggregated Log Observability

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

A developer can view a live, filterable, aggregated log stream across multiple services, with inline health status, a developer-triggered restart control, and recall of previously used filters — so they stop hopping between terminals and retyping filters to diagnose an issue.

## Stories

- Story 5.1: Aggregated Live Log Stream
- Story 5.2: Filter the Aggregated Stream
- Story 5.3: Inline Service Health & Restart Control
- Story 5.4: Filter History Recall

## Requirements & Constraints

- Provide a live aggregated log stream from all services in the active EDT (or a chosen subset); log lines visible within ~1s of emission, UI interaction under ~150ms (non-negotiable performance floor).
- Filter the stream by service, free-text/regex, and log level, combined with AND, without interrupting the stream; invalid regex is rejected inline, never silently ignored or crashing the view.
- Show each service's health (up/down/restarting) inline with its logs; a restart control is developer-triggered only (replaces the old script's silent auto-restart) and is disabled while a restart is already in progress.
- Filter history recall (Story 5.4) is an elaboration of the filtering requirement, not new filtering mechanics: remember the last N text/regex filters used, N configurable, with independent history per scope (global vs. each service) and per mode (text vs. regex) — four independent lists per service plus two global ones.
- History recall behavior: `↑` from a fresh draft recalls the most recent entry for that exact scope+mode, preserving the draft; further `↑` walks older entries to the oldest (no-op past that); `↓` walks back toward the draft, restoring the original draft exactly once past the most recent entry; any printable character or Backspace while browsing snaps back to the draft with that keystroke applied on top. `↓` from the draft (not browsing) opens a grid browser over the full history.
- Committing a filter (`Enter`, compiles, non-empty) pushes it to the front of its scope+mode's history, move-to-front (not duplicated) if identical to the current top entry, trimmed to the configured max size N.
- Two new per-user settings on the Logs settings tab: filter history size and filter history grid rows (each with its own MIN/MAX clamp, independent of `commandPalette.gridMaxRows`); plus actions to clear history globally or per service, independently.
- The Logs settings tab currently has no row cursor (`Up`/`Down` claimed exclusively by `bufferSize`, `Space` by `startWithHistory`); it must grow a row-cursor navigation model (mirroring the EDTs tab's group-list precedent) so all fields, including the two new ones and the clear actions, stay reachable unambiguously.
- Filter history is the first *persisted* filter-related data. This does not reopen Story 5.2's rule that the live/active filter state itself is ephemeral and never persisted — history is a distinct concept (a record of past commits, not current state) and is explicitly exempted from that rule.
- No CI/CD, deployment, or IaC impact from Story 5.4 — entirely within the TUI adapter and existing settings/state persistence adapters.

## Technical Decisions

- `core/logs` owns a bounded in-memory ring buffer per service, sized for scroll-back plus Epic 6's future fire-correlation window; nothing is written to disk, and it is discarded on tool restart. `adapters/driven/docker` only streams raw lines in — it never buffers.
- Log-stream re-renders must be debounced/batched, never a full redraw per emitted line; this is the surface most exposed to Ink's rendering ceiling (~30 FPS cap, >50MB baseline memory) — a named, monitored risk, with OpenTUI as the pre-identified fallback if the ceiling is ever actually hit.
- The TUI's one central Zustand store holds cross-zone state including `logBuffers`, which is a read view onto `core/logs`' buffer, never a second copy. Zone-local UI state (list cursor, scroll position) stays component-local.
- Filter history is new persisted state that belongs in `StatePort`/`state.json` (alongside `activeEdt` and per-zone splitter ratios) — never `settings.ts`/`settings.yaml`, which holds developer preferences (like the new history-size and grid-rows settings), not history data.
- Story 5.4 reuses `command-bar.tsx`'s existing grid-browser primitives (`groupCommandsByColumn`/`layoutCommandGrid`/grid cursor movement), generalized beyond `Command[]`, as a second independent instance of the `command-grid` component with its own rows-per-column setting.
- Story 5.4 extends the Logs zone's existing `FilterEditorState`/`useInput` with a draft-vs-browsing state machine (mirrors the existing `TabPressState` "stamped state, not a timer" idiom).
- Restart control triggers a Docker restart via the driven docker adapter; health badge follows the existing status-badge component's glyph+color pairing rule.

## UX & Interaction Patterns

- Logs zone follows the standard list/detail split with a splitter (~2:3 ratio); list rows show service identity and inline health badge.
- Health badge and restart control follow the closed status-badge glyph+color vocabulary — never color alone; restart control disables itself while that service is already restarting.
- Logs zone named states include: no-members ("no members to aggregate"), live streaming with debounced/batched re-renders, filter applied without interrupting the stream, invalid-regex inline rejection, service-down/crashed-mid-stream with auto-reconnect, inline health, restart-in-progress control disabling, and (new, Story 5.4) filter-history browsing (arrow-recall and grid-browser).
- The `:settings` Logs tab grows from its current flat/no-row-cursor model (Up/Down claimed by `bufferSize`) to a row-cursor model, mirroring the EDTs tab's group-list drill-down precedent, once it exceeds 4 fields plus history-clear actions.
- The `command-grid` component (built for the `:` command bar: column-major layout, `Left`/`Right` between columns, `Up`/`Down` within a column, truncation with horizontal scroll at extremities, typing exits back to input editing) is the same component reused for the filter-history grid browser — a second, independent instance.

## Cross-Story Dependencies

- Depends on Epic 1 (foundation, manifest, hexagonal core, script/CLI parity) and Epic 2 (EDT workspace management) for the active EDT and its member-service list that the log stream and per-service health scope to.
- Story 5.4 depends on Story 5.2's filter editor (`FilterEditorState`/`useInput`) being in place, and builds on it without changing 5.2's own acceptance criteria or reopening it.
- Story 5.4 depends on the command bar's existing grid primitives (Story 2.17, `command-bar.tsx`) and the EDTs settings tab's group-list/row-cursor precedent (Story 2.19) being available to generalize/mirror.
- Story 5.3 is independent of Story 5.4 (confirmed unaffected) but both depend on Story 5.1's log stream and per-service scoping.
- Epic 6 (Route Explorer) will later depend on Epic 5's log buffer for request-log correlation (FR-22) — the buffer's sizing already anticipates this without requiring changes here.
