---
title: 'Aggregated Live Log Stream'
type: 'feature'
created: '2026-09-17'
status: 'done'
review_loop_iteration: 0
context: []
baseline_commit: '82841f38b6f9010b8f023ab84c02218cf7d2a25f'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Developers debugging across several services have no single place to watch live container logs — they must switch between separate terminals per service, one per container.

**Approach:** Add a core `logs` module with a per-service in-memory ring buffer (Docker-backed streaming plus on-demand older-line reload) and a new TUI Logs zone: two multi-select service lists (active EDT members / other manifest services) driving an auto-resizing grid of scrollable log panes, with a per-pane fullscreen view.

## Boundaries & Constraints

**Always:**
- `core/logs` never imports from any adapter (AD-1); every use-case returns `Result<T>` (`src/core/result.ts`).
- Log lines live only in memory, in a per-service ring buffer sized by `settings.logs.bufferSize` (default 500 lines) — nothing written to disk (AD-11).
- Each buffered line carries a timestamp and stream tag (`stdout`/`stderr`); the zone can toggle timestamp/stdout/stderr visibility independently (`t`/`o`/`e`) without reconnecting the stream.
- Any manifest service can be streamed, not only active-EDT members — both left-panel lists are equally streamable.
- Docker is shelled via `node:child_process` (`spawn`/`spawnSync`), the same convention as `src/adapters/driven/git/index.ts` — no new dependency (no dockerode).
- The pane grid auto-resizes to fill available space on every selection change; no fixed pane-count cap.
- Keys: Tab cycles EDT list → other list → panes; Space toggles a list selection; Ctrl+A / Ctrl+Shift+A select/deselect all EDT-list services (EDT list only); arrows move list cursor or pane sub-focus; Ctrl+Up/Ctrl+Down scroll the sub-focused pane; Enter opens fullscreen (from a list row or a pane) without changing selection; Escape leaves fullscreen back to the grid.

**Ask First:** None outstanding — buffer size, timestamp/stream tagging, and toggle keys were resolved during intent negotiation (see Design Notes).

**Never:**
- Perform a synchronous/blocking Docker call on the Ink render loop.
- Implement text/level filtering, health badges, or a restart control (stories 5.2/5.3).
- Persist any log line to `XDG_STATE_HOME` or anywhere on disk.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| HAPPY_PATH | 2 services selected, containers running | Grid shows 2 auto-sized panes; new lines appear in each within ~1s | N/A |
| SCROLLBACK_RELOAD | User scrolls a pane to its oldest buffered line | Adapter fetches the next `bufferSize` older lines from Docker and prepends them, scroll position preserved | If the fetch fails, pane shows a dim "no more history" annotation and scrolling stops at the edge |
| SELECTION_CHANGE | User deselects a service whose pane held sub-focus | That stream stops, its pane is removed, the grid reflows and sub-focus moves to the nearest remaining pane | N/A |
| FULLSCREEN_PREVIEW | Enter pressed on an unselected list row | Its logs render fullscreen (stream started ad hoc) without adding it to the grid selection; Escape stops that ad hoc stream and returns, selection unchanged | N/A |
| DOCKER_UNAVAILABLE | `docker` binary missing or daemon unreachable when starting a stream | Pane shows a dim-annotation error state, no lines shown | Core returns `Result.error` code `docker-unavailable`; TUI renders the generic error per envelope |

</frozen-after-approval>

## Code Map

- `src/core/ports/docker.ts` -- NEW `DockerPort`: `streamLogs(container, onLine, onError): () => void`, `fetchLogsBefore(container, beforeCursor, count): Promise<Result<LogLine[]>>` (story 5.3 later extends this port with restart)
- `src/core/logs/index.ts` -- NEW `LogsManager`: per-service ring buffer sized from Settings, start/stop subscription via `DockerPort`, exposes buffer + older-lines cursor
- `src/core/logs/use-cases.ts` -- NEW `subscribeLogs`/`unsubscribeLogs`/`loadOlderLogs`, `Result<T>` boundary per `src/core/result.ts`
- `src/adapters/driven/docker/index.ts` -- NEW, fills the currently-empty `src/adapters/driven/docker/` dir; implements `DockerPort` via `child_process.spawn('docker', ['logs', '-f', ...])` for streaming and `spawnSync` for older-line fetch, mirroring `src/adapters/driven/git/index.ts:25` shell-out idiom
- `src/core/ports/settings.ts:12-23,29-32,38-39` -- add `logs: { bufferSize: number }` to `Settings`/`DEFAULT_SETTINGS` (default 500) plus `MIN_LOG_BUFFER_SIZE`/`MAX_LOG_BUFFER_SIZE`
- `src/adapters/driven/settings/schema.ts:17` -- mirror `gridMaxRows`'s `.int().min().max()` pattern for `logs.bufferSize`
- `src/adapters/driving/tui/shared/settings-screen.tsx:87-103,199,224-239,332` -- add a Logs settings group reusing the clamp/adjust/parse-digit/render idiom
- `src/adapters/driving/tui/store/slices/logs-slice.ts` -- NEW Zustand slice (pattern: `src/adapters/driving/tui/store/slices/edt-slice.ts`): per-service buffers/cursors, selection sets, list/pane focus and fullscreen target
- `src/adapters/driving/tui/store/app-store.ts:17-20,39-51,53,55-61` -- wire `LogsSlice` + `DockerPort` into `AppStoreDeps`/`AppState`
- `src/adapters/driving/tui/zones/logs/logs-zone.tsx` -- replace the current 7-line `ZonePlaceholder` with the real zone
- `src/adapters/driving/tui/zones/logs/logs-zone.logic.ts` -- NEW pure functions: reuse `partitionServicesByEdtMembership` shape from `src/adapters/driving/tui/zones/edts/edts-zone.logic.ts:617-628`; new `computeGridLayout(paneCount, width, height)`; arrow/Tab/select-all handlers mirroring `edts-zone.logic.ts:99-159,215-217`

## Tasks & Acceptance

**Execution:**
- [x] `src/core/ports/docker.ts` -- define `DockerPort` -- core needs the driven port before any use-case/adapter exists
- [x] `src/core/logs/index.ts` -- `LogsManager` ring buffer + subscribe/unsubscribe/loadOlder -- central in-memory log state, no adapter import (AD-1)
- [x] `src/core/logs/use-cases.ts` -- `subscribeLogs`/`unsubscribeLogs`/`loadOlderLogs` -- `Result<T>` boundary for the TUI slice
- [x] `src/adapters/driven/docker/index.ts` -- implement `DockerPort` via `node:child_process` -- no new dependency, matches git adapter convention
- [x] `src/core/ports/settings.ts` -- add `logs.bufferSize` + min/max constants -- user-configurable ring buffer size
- [x] `src/adapters/driven/settings/schema.ts` -- validate `logs.bufferSize` -- keeps a corrupt `settings.yaml` non-blocking (existing guarantee)
- [x] `src/adapters/driving/tui/shared/settings-screen.tsx` -- add Logs settings group -- lets the user change `bufferSize` live
- [x] `src/adapters/driving/tui/store/slices/logs-slice.ts` -- new slice -- selection, buffers, focus/fullscreen state
- [x] `src/adapters/driving/tui/store/app-store.ts` -- wire `LogsSlice` + `DockerPort` -- single Zustand store (AD-10)
- [x] `src/adapters/driving/tui/zones/logs/logs-zone.logic.ts` -- pure keybinding/grid-layout functions -- unit-testable without React, mirrors `edts-zone.logic.ts`
- [x] `src/adapters/driving/tui/zones/logs/logs-zone.tsx` -- real zone UI replacing the placeholder -- renders both lists, the grid, and fullscreen mode

**Acceptance Criteria:**
- Given the Logs zone is opened with no service selected, when it renders, then both lists show (EDT members / others, from the active EDT and manifest) and the grid area shows an empty-state message.
- Given a pane has grid sub-focus, when Tab is pressed repeatedly, then focus cycles EDT list → other list → panes → EDT list.
- Given an ad hoc fullscreen preview is open from an unselected list row, when Escape is pressed, then the preview closes and that service's selection state is unchanged.
- Given `settings.logs.bufferSize` is changed in the settings screen, when a new stream starts afterward, then it uses the new buffer size; already-running streams are unaffected until restarted.

## Design Notes

Focus model: one local `useState` enum (`'edt-list' | 'other-list' | 'panes'`) plus a store-level `fullscreenTarget: string | null`, dispatched the same way `edts-zone.tsx`'s `paneFocus`/`dialog.kind` already are (single `useInput`, overlay branch first) — no new focus-manager abstraction needed; no such abstraction exists anywhere in the repo today.

`computeGridLayout(n, width, height)` picks the squarest `rows x cols` grid fitting `n` panes (e.g. `ceil(sqrt(n))` columns) within the terminal's available area — flexbox-based, unlike the command palette's text-column grouping.

Docker streaming: one long-lived `spawn('docker', ['logs', '-f', '--since', cursor, container])` child process per active pane; stdout and stderr are read via separate listeners so each line is tagged before entering the ring buffer. `fetchLogsBefore` shells `docker logs --until <cursor> --tail <bufferSize> <container>` via `spawnSync`.

Buffer growth is intentionally two-speed: the live-tail path (`pushLine`) stays hard-capped at `bufferSize`, since that's the one growth path with no natural rate limit (a noisy container can emit thousands of lines/second). `loadOlder`'s prepend is deliberately *not* re-capped at `bufferSize` — each explicit, user-triggered scrollback reload is meant to extend history further, so a pane's total buffered lines legitimately exceeds `bufferSize` after repeated reloads. This is not a ring-buffer leak; it is the negotiated SCROLLBACK_RELOAD behavior (each reload fetches the next `bufferSize` older lines and keeps them). A reviewer flagging "the buffer isn't capped after loadOlder" should treat this note, not the boundary line above, as authoritative for that path.

## Verification

**Commands:**
- `npm test` -- all unit/interaction tests pass, including new `core/logs`, docker adapter, and logs-zone tests
- `npm run typecheck` -- no TypeScript errors
- `npm run depcheck` -- no AD-1 violation (`core/logs` never imports an adapter)

**Manual checks:**
- Start 2+ containers matching manifest services, open the Logs zone, select both, confirm live interleaved lines in a 2-pane grid within ~1s.
- Scroll a pane to its top; confirm older lines load without losing scroll position.
- Deselect all services; confirm the grid empties and streams stop.

## Suggested Review Order

**Core log engine (contract + ring buffer)**

- Start here — the port every other layer implements or calls against.
  [`docker.ts:33`](../../../src/core/ports/docker.ts#L33)

- Ring buffer + subscribe/unsubscribe/loadOlder; `pushLine` caps the live tail, `loadOlder` intentionally doesn't (see its own Design Notes entry).
  [`logs/index.ts:75`](../../../src/core/logs/index.ts#L75)

- Scrollback dedup fix: fetched lines strictly older than the cursor before prepending.
  [`logs/index.ts:152`](../../../src/core/logs/index.ts#L152)

- Thin `Result<T>` boundary the TUI slice calls through.
  [`logs/use-cases.ts:20`](../../../src/core/logs/use-cases.ts#L20)

**Docker adapter (child_process, no new dependency)**

- Availability probe now reads the actual `{{.State.Running}}` value, not just exit status — a stopped container used to pass silently.
  [`docker/index.ts:43`](../../../src/adapters/driven/docker/index.ts#L43)

- Live tail: `stopped`-guarded data handlers (kills a post-`stop()` data race) and a clean-exit-while-active case now surfaces as a stream-ended error instead of freezing silently.
  [`docker/index.ts:61`](../../../src/adapters/driven/docker/index.ts#L61)

- One-shot older-lines fetch: stdout/stderr merge now trimmed to the requested count (was overshooting up to 2x).
  [`docker/index.ts:135`](../../../src/adapters/driven/docker/index.ts#L135)

- Line-splitting/timestamp-parsing extracted here so it's unit-testable without a live docker daemon.
  [`docker/index.logic.ts:18`](../../../src/adapters/driven/docker/index.logic.ts#L18)

**TUI Logs zone (grid, focus, fullscreen)**

- Zone entry point: two selection lists + auto-resizing pane grid + fullscreen view.
  [`logs-zone.tsx:55`](../../../src/adapters/driving/tui/zones/logs/logs-zone.tsx#L55)

- Single keybinding dispatcher: Tab cycle, Space/Ctrl+A selection, arrow/Ctrl+arrow pane nav vs scroll, Enter/Escape fullscreen.
  [`logs-zone.tsx:186`](../../../src/adapters/driving/tui/zones/logs/logs-zone.tsx#L186)

- Squarest-grid layout math, pure and unit-tested.
  [`logs-zone.logic.ts:39`](../../../src/adapters/driving/tui/zones/logs/logs-zone.logic.ts#L39)

- Scroll offset / "at oldest line" now computed against the filtered (t/o/e) line count, not the raw buffer.
  [`logs-zone.logic.ts:99`](../../../src/adapters/driving/tui/zones/logs/logs-zone.logic.ts#L99)

- Grid rendering; check the incomplete-last-row alignment for non-square pane counts.
  [`logs-zone.tsx:371`](../../../src/adapters/driving/tui/zones/logs/logs-zone.tsx#L371)

- Fullscreen view now takes the service name directly instead of a live list lookup that could miss it.
  [`logs-zone.tsx:462`](../../../src/adapters/driving/tui/zones/logs/logs-zone.tsx#L462)

**Store wiring**

- Selection/subscribe/unsubscribe actions; manifest-load failure now surfaces a `streamError` instead of silently no-opping.
  [`logs-slice.ts:184`](../../../src/adapters/driving/tui/store/slices/logs-slice.ts#L184)

- New teardown action backing the process-exit hook below.
  [`logs-slice.ts:246`](../../../src/adapters/driving/tui/store/slices/logs-slice.ts#L246)

- `DockerPort` + `LogsSlice` wired into the single Zustand store (AD-10).
  [`app-store.ts:56`](../../../src/adapters/driving/tui/store/app-store.ts#L56)

- Process-level exit/SIGINT/SIGTERM hook stops orphaned `docker logs -f` children on abnormal exit.
  [`tui.ts:135`](../../../src/bin/tui.ts#L135)

**Settings extension**

- `logs.bufferSize` + min/max constants (default 500, mirrors `gridMaxRows`'s pattern).
  [`settings.ts:28`](../../../src/core/ports/settings.ts#L28)

- Zod validation; comment corrected to state an invalid value resets the whole settings object, not just `logs`.
  [`schema.ts:49`](../../../src/adapters/driven/settings/schema.ts#L49)

- Clamp/adjust/digit-preset helpers and the Logs tab's key handler.
  [`settings-screen.tsx:118`](../../../src/adapters/driving/tui/shared/settings-screen.tsx#L118)

**Peripherals**

- New/updated tests: `core/logs/index.test.ts`, `core/logs/use-cases.test.ts`, `adapters/driven/docker/index.test.ts` (real disposable containers), `adapters/driven/docker/index.logic.test.ts` (daemon-independent), `zones/logs/logs-zone.logic.test.ts`, `zones/logs/logs-zone.test.tsx`, `zones/logs/logs-zone.interaction.test.tsx`, plus updated fixtures in `app-store.test.ts` and `app-shell.test.tsx`.
