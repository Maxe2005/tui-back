# Epic 5 Context: Aggregated Log Observability

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal
A developer can view a live, filterable, aggregated log stream across multiple services, with inline health status and a developer-triggered restart control.

## Stories
- Story 5.1: Aggregated Live Log Stream
- Story 5.2: Filter the Aggregated Stream
- Story 5.3: Inline Service Health & Restart Control

## Requirements & Constraints
- Provide a live aggregated log stream from all services in the active EDT (or a chosen subset) (FR-16).
- Allow filtering the stream by service, free-text/regex, and log level without interrupting the stream (FR-17).
- Show each service's health (up/down/restarting) inline with its logs and enable a developer-triggered restart control (FR-18).
- Ensure UI interaction response under ~150ms and log lines visible within ~1s of emission (NFR-1).
- Use a bounded in-memory ring buffer per service, owned by core/logs, discarded on tool restart; nothing written to disk (AD-11).
- Debounce/batch log-stream re-renders to avoid full redraw per line, respecting Ink's rendering ceiling (AD-12, NFR-1).
- Scope log stream to active EDT's member services, relying on EDT membership from Epic 2.
- Integrate with Docker adapter to stream raw container logs via dockerode.
- Use Zustand store for cross-zone state (active EDT, log buffers) and splitter component for list/detail layout.
- Display service health using status-badge component (glyph+color) and provide restart control that is disabled when a restart is already in progress.

## Technical Decisions
- Core logs module (`src/core/logs`) manages the ring buffer and provides subscription interface.
- Docker adapter (`src/adapters/driven/docker`) streams logs from containers; implementation will be created for this epic.
- TUI Logs zone (`src/adapters/driving/tui/zones/logs`) renders the list/detail split, list of services with health badges, and detail pane showing filtered logs.
- Health badge uses the existing status-badge component; restart control is a button/icon that triggers a Docker restart via the adapter.
- Log filtering is applied in the TUI zone before updating the detail pane; filter changes do not disconnect the stream.
- The log buffer size is sufficient for several minutes of scroll-back and can be reused by later request-log correlation (Epic 6) without modification.

## UX & Interaction Patterns
- Logs zone follows the standard list/detail pattern with a splitter (2:3 ratio).
- List rows show service name, branch/divergence, and health badge; selected row displays logs in detail pane.
- Filter UI (service multi-select, free-text/regex input, level select) updates the stream without restarting.
- Health badge colors: green for up, red for down, yellow for restarting (per status-badge conventions).
- Restart control is visible only when a service is down; disabled while restarting; triggers a Docker restart and updates health on success.
- Empty state shows "no members to aggregate" when the active EDT has zero member services.

## Cross-Story Dependencies
- Depends on Epic 1: foundation (manifest, script/CLI parity, hexagonal core) provides the overall tool structure and core use‑case pattern.
- Depends on Epic 2: EDT workspace management supplies the active EDT, member service list, and branch‑scope safety gating needed to scope the log stream to the correct services.
- No dependencies on Epic 3, 4, or 6 within this epic; Epic 6 (Route Explorer) will later depend on Epic 5’s log stream for request‑log correlation (FR-22).

