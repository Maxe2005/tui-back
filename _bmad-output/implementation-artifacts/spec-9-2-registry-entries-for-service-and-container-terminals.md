---
title: 'Registry Entries for Service & Container Terminals'
type: 'feature'
created: '2026-11-04'
status: 'done'
baseline_commit: '198de46454313e23c7ada7f5c70466e329e3e147'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-9-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The shared service-action registry (`core/service-actions`, Story 7.12) lists only Open in IDE / Restart / Clean restart, so the terminals from Story 9.1 cannot be offered by any consumer without hard-wiring them per zone.

**Approach:** Add `terminal-service` (`Ctrl+T`) and `terminal-container` (`Ctrl+X`) to `list()`, after the three existing entries, with availability computed in the registry (container reasons `no container` / `container not running`); wire the Docker port into the Dashboard's registry so the row shows them with no component change.

## Boundaries & Constraints

**Always:** `list()` never fails because of a terminal entry — every probe failure becomes an unavailable entry with a reason; order is `open-in-ide, restart-simple, restart-clean, terminal-service, terminal-container`; keys are `Ctrl+T` (service terminal) and `Ctrl+X` (container terminal) — chosen by the user 2026-11-04 over the proposed `Ctrl+E`, which stays the canonical irreversible-file-loss confirm key; `Ctrl+T` is a documented UX-DR36 deviation (BranchPicker's rename only lives in overlays, zones are inert behind them).

**Ask First:** changing `ServiceActionsRow`, `ServiceAction` shape, or the existing three entries' ids/keys/availability rules.

**Never:** opening a terminal or any terminal view/keybinding/footer hint (Story 9.4); touching Logs `R`/`O` (Story 9.5); importing `core/shell` into the registry; a new dependency.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Container running | manifest `container: api`, health `up` | both terminals `{available:true}` | N/A |
| No container | manifest without `container` (or blank) | service terminal available; container terminal `no container`; health never queried | N/A |
| Container stopped | health `down` or `restarting` | container terminal `container not running` | N/A |
| Docker unreachable | `getContainerHealth` → `err(...)` | container terminal `container state unknown` | swallowed into the reason |
| No Docker port wired | `deps.docker` undefined | container terminal `container state unknown` | N/A |
| Manifest unreadable | `manifest.load` → err | service terminal available; container terminal `manifest unreadable` | N/A |
| Locks held | restart / group-update lock held | terminals unaffected (locks only gate restarts) | N/A |

</frozen-after-approval>

## Code Map

- `src/core/service-actions/index.ts` -- registry. `list()` (L170) builds the array; `restartAvailability` (L144) calls `manifest.load` per mode; `hasContainer` (L127); `ServiceActionsDeps.docker?` already optional (L56). `DockerPort.getContainerHealth` returns `ok('up'|'down'|'restarting')`, `err('docker-unavailable')` on spawn failure (`src/core/ports/docker.ts:39-42`).
- `src/core/service-actions/index.test.ts` -- `setup()` (L6) builds fakes with no docker; L25-82 assert exactly three entries / index positions — extend, keep the existing assertions meaningful.
- `src/adapters/driving/tui/store/slices/dashboard-slice.ts:84` -- the only `list()` consumer; its `createServiceActions` omits `docker` (`AppStoreDeps.docker` is required, `app-store.ts:90`). `runAction` (L136) ignores unknown ids → `Ctrl+T`/`Ctrl+X` are a silent no-op until 9.4.
- `src/adapters/driving/tui/zones/dashboard/dashboard-zone.tsx:101` -- `Ctrl+<letter>` dispatch via `actionForKey` (`dashboard.logic.ts:127`); no change needed.
- `src/adapters/driving/tui/shared/components/service-actions-row.tsx` -- read-only: renders any list, single truncated line.
- `src/adapters/driving/tui/zones/dashboard/dashboard-zone.test.tsx:244` -- fixture idiom for a focused row's action list.
- `_bmad-output/planning-artifacts/ux-designs/ux-tui-back-2026-08-10/EXPERIENCE.md` -- L27 and L100 list the Dashboard actions; deviation table at L245.

## Tasks & Acceptance

**Execution:**
- [x] `src/core/service-actions/index.ts` -- load the manifest once per `list()` and derive restart and terminal availabilities from it; append `{id:'terminal-service', label:'Terminal', key:'Ctrl+T'}` (always available) and `{id:'terminal-container', label:'Container terminal', key:'Ctrl+X'}` (availability per matrix); update the header comment -- one registry, consumers render what it lists.
- [x] `src/core/service-actions/index.test.ts` -- add an optional docker fake to `setup()`; update the full-list assertions to five entries; cover every matrix row, including that health is not queried for a container-less service -- pins the contract.
- [x] `src/adapters/driving/tui/store/slices/dashboard-slice.ts` -- pass `docker: deps.docker` to `createServiceActions` -- the container check needs it.
- [x] `src/adapters/driving/tui/zones/dashboard/dashboard-zone.test.tsx` -- a focused row whose five actions render in registry order on one line, the container terminal greyed with its reason -- proves "no component change".
- [x] `src/adapters/driving/tui/zones/dashboard/dashboard.logic.test.ts` -- `actionForKey` resolves `t` and `x` to the terminal ids.
- [x] `EXPERIENCE.md` -- add `Ctrl+T` terminal / `Ctrl+X` container terminal to L27 and L100; add a deviation row for `Ctrl+T` (rename branch in BranchPicker overlays vs. service terminal on the Dashboard) noting `Ctrl+E` was rejected to keep the destructive-confirm meaning.

**Acceptance Criteria:**
- Given any registered service, when `list` is called, then it returns five entries ending with `terminal-service` and `terminal-container`, each with availability and reason per the matrix.
- Given the Dashboard focused row, when rendered, then `ServiceActionsRow` shows the terminals after Open in IDE / Restart / Clean restart, with `service-actions-row.tsx` unchanged (`git diff` empty for it).
- Given `npm test && npm run typecheck && npm run depcheck`, then all pass, bounded-rendering and dialog-registry guards included.

## Spec Change Log

## Design Notes

Reasons are short lowercase phrases like the existing ones (`no container`, `no clean recipe`). Docker-unreachable stays distinct from `container not running` so the user is not told a running container is down. Pressing `Ctrl+T`/`Ctrl+X` before 9.4 hits `runAction`'s unknown-id return — intended; 9.4 adds the handler, keybinding declarations and footer hints.

## Verification

**Commands:**
- `npm test` -- expected: all green
- `npm run typecheck` -- expected: no errors
- `npm run depcheck` -- expected: no violations
- `git diff --stat 198de46454313e23c7ada7f5c70466e329e3e147 -- src/adapters/driving/tui/shared/components/service-actions-row.tsx` -- expected: empty

## Suggested Review Order

**Registry contract**

- Entry point: five entries, terminals appended after the restarts, one manifest load.
  [`index.ts:202`](../../src/core/service-actions/index.ts#L202)

- Service terminal always available — it only needs the repo directory.
  [`index.ts:220`](../../src/core/service-actions/index.ts#L220)

- Container terminal reasons; probe failures never fail the list.
  [`index.ts:191`](../../src/core/service-actions/index.ts#L191)

- Probe bounded at 1.5 s: the Dashboard re-lists before every action.
  [`index.ts:43`](../../src/core/service-actions/index.ts#L43)

- Docker probe runs alongside the lock peeks.
  [`index.ts:210`](../../src/core/service-actions/index.ts#L210)

**Dashboard wiring**

- Docker port now reaches the registry so live health drives the reason.
  [`dashboard-slice.ts:91`](../../src/adapters/driving/tui/store/slices/dashboard-slice.ts#L91)

**Keys & UX doc**

- `Ctrl+T` deviation recorded; `Ctrl+E` rejected for `Ctrl+X`.
  [`EXPERIENCE.md:256`](../planning-artifacts/ux-designs/ux-tui-back-2026-08-10/EXPERIENCE.md#L256)

**Tests**

- Matrix coverage incl. hung probe and container-less service.
  [`index.test.ts:40`](../../src/core/service-actions/index.test.ts#L40)

- Hung Docker probe settles on the timeout, list not stalled.
  [`index.test.ts:106`](../../src/core/service-actions/index.test.ts#L106)

- Slice wires Docker: every availability pinned.
  [`dashboard-slice.test.ts:117`](../../src/adapters/driving/tui/store/slices/dashboard-slice.test.ts#L117)

- Row renders the five actions in registry order, no component change.
  [`dashboard-zone.test.tsx:265`](../../src/adapters/driving/tui/zones/dashboard/dashboard-zone.test.tsx#L265)
