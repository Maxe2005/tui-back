---
title: 'Inline Service Health & Restart Control'
type: 'feature'
created: '2026-09-20'
status: 'done'
review_loop_iteration: 0
context: []
baseline_commit: '086f650dd54c39c6352420170c09cbc649453169'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Logs zone streams lines but shows no health — a crashed service looks identical to a quiet one, and a developer must leave the tool to restart a container, while the legacy `check_health.sh` silently auto-restarted services behind their back.

**Approach:** Poll each subscribed service's container health through the driven Docker adapter, render it inline as a `StatusBadge` next to the service's logs, and offer a developer-triggered restart control that disables itself while a restart is already in progress.

## Boundaries & Constraints

**Always:**
- Health and restart are new `DockerPort` methods (`getContainerHealth`, `restartContainer`) plus thin core use-cases returning `Result<T>` with kebab-case error codes — same shell-out idiom as the existing adapter (`spawnSync docker inspect` / `docker restart`, mirroring `checkContainerAvailable` and `fetchLogsBefore`).
- `HealthState` is exactly `'up' | 'down' | 'restarting'`, mapped from `docker inspect`: container missing/inspect fails → `down`; `State.Restarting` true → `restarting`; `State.Running` true → `up`; otherwise → `down`.
- Polling lives in the Zustand `logs-slice` (per subscribed pane, on subscribe plus a ~5s interval, cleared on unsubscribe); a failed poll keeps the last-known health and never crashes the view — only a successful inspect updates the badge.
- Restart is a new slice action keyed by `repoPath`: a call while that pane is already restarting is a no-op, never a second concurrent restart; after the restart call resolves, health is re-polled immediately so the badge reflects the new state.
- The restart control is developer-triggered only: `R` on a sub-focused grid pane or a fullscreen pane triggers it for that one pane's service; while restarting, the control shows disabled state.
- Health badges use the existing `StatusBadge` component (`up` → `●`/success, `down` → `○`/error, `restarting` → `⣾`/info), glyph+color always paired, never color alone; accent is never a health color.
- Badges render in both service lists (ACTIVE EDT MEMBERS / OTHER SERVICES rows) and the pane headers (grid + fullscreen), and extend the hints `DimAnnotation`s with the `R` binding.
- A restart composes with the existing crashed-mid-stream/auto-reconnect display — the stream is never resubscribed by health polling itself.

**Ask First:** None outstanding — scope, the DockerPort extension, and the no-auto-restart rule are settled by the epic plan and Story 5.3 acceptance criteria.

**Never:**
- Silently auto-restart any service — this story replaces `check_health.sh`'s auto-restart, it never reintroduces it.
- Trigger a second concurrent restart for a service already restarting.
- Persist health anywhere (`settings.yaml`, `state.json`, or the ring buffer) — health is live Docker state, read on poll only.
- Add a health/level field to `LogLine`, the ring buffer, or the Docker line parser — health stays at poll/store time, mirroring Story 5.2's render-time-only precedent.
- Add CLI subcommands for health/restart — Epic 5's log surface ships TUI-only via `logs-slice` (Stories 5.1/5.2/5.4 precedent); script parity for this surface is deferred, not reopened here.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| HEALTH_UP | Inspect reports `Running=true` | Badge `●` up next to that service's logs | N/A |
| HEALTH_DOWN | Inspect fails or container missing | Badge `○` down; restart control available | Never thrown into render tree |
| HEALTH_RESTARTING | Inspect reports `Restarting=true` | Badge `⣾` restarting; restart control disabled | N/A |
| RESTART_NOOP | `R` pressed while pane already restarting | No-op — no second `docker restart` issued | N/A |
| RESTART_COMPLETES | `docker restart` resolves | Health re-polled immediately; badge updates to new state | Failure surfaces inline on the pane, badge keeps last-known |
| POLL_ERROR | Scheduled poll's inspect fails | Last-known badge kept; polling continues on schedule | Never crashes or clears the badge |

</frozen-after-approval>

## Code Map

- `src/core/ports/docker.ts:42-48` -- extend `DockerPort` with `getContainerHealth(container): Promise<Result<HealthState>>` and `restartContainer(container): Promise<Result<void>>`, next to `streamLogs`/`fetchLogsBefore`
- `src/adapters/driven/docker/index.ts:36-135` -- implement both methods via `spawnSync docker inspect --format ...` (extend the private `checkContainerAvailable` probe at :43) and `spawnSync docker restart`; add `HealthState` mapping helper
- `src/core/logs/use-cases.ts:20-49` -- add `getServiceHealth`/`restartService` thin `Result<T>` wrappers, mirroring `subscribeLogs`/`clearLogs` shape
- `src/adapters/driving/tui/store/slices/logs-slice.ts:27-73` -- extend `LogsPaneData` (`:27`) with `health: HealthState` + `restarting: boolean`; add poll timer management around `subscribeLogsPane` (`:206`) / `unsubscribeLogsPane` (`:276`) plus a `restartLogsPane(repoPath)` action with the restarting-flag no-op guard
- `src/adapters/driving/tui/zones/logs/logs-zone.tsx` -- render `StatusBadge` in both service lists and grid/fullscreen pane headers; extend `useInput` (grid `:422-783` + fullscreen branches) with the `R` binding gated on pane focus; extend `dialogOpen`-adjacent disabled rendering while restarting; extend hint `DimAnnotation`s
- `src/adapters/driving/tui/shared/components/status-badge.tsx:4-26` -- reuse `StatusBadge` + `STATUS_BADGES` as-is (no change expected; listed as a read-only reuse point)
- Tests: `src/adapters/driven/docker/index.logic.test.ts` (health mapping), `src/core/logs/*.test.ts` (use-cases), `src/adapters/driving/tui/store/app-store.test.ts` (poll/no-op-guard, mirroring the existing `subscribeLogsPane` cases at :1261+), `logs-zone.interaction.test.tsx` (`R` binding + disabled-while-restarting)

## Tasks & Acceptance

**Execution:**
- [x] `core/ports/docker.ts` -- add `HealthState`, `getContainerHealth`, `restartContainer` to `DockerPort` -- the contract every layer above builds on
- [x] `adapters/driven/docker/index.ts` -- implement both methods via `spawnSync` inspect/restart -- the only Docker-touching code in the story
- [x] `core/logs/use-cases.ts` -- add `getServiceHealth`/`restartService` `Result<T>` wrappers -- keeps the TUI off the raw port, same as existing log use-cases
- [x] `store/slices/logs-slice.ts` -- add per-pane `health`/`restarting`, poll lifecycle, `restartLogsPane` with no-op guard -- the single state owner for health
- [x] `zones/logs/logs-zone.tsx` -- render badges, wire `R`, disable-while-restarting, extend hints -- the user-visible half of the story
- [x] Tests -- cover the health mapping, the no-op guard, poll-error-keeps-last-known, and the `R` binding/disabled rendering

**Acceptance Criteria:**
- Given a service up, down, or restarting, when the Logs zone is viewed, then its health is visible inline with its logs — no separate health check step.
- Given a down service, when the developer presses `R` on its pane, then exactly one `docker restart` is issued for that service and nothing auto-restarts otherwise.
- Given a service already restarting, when the developer invokes restart again, then it is a no-op and the control renders disabled.
- Given a restart completes, when the service comes back up, then its badge updates to the new state with glyph+color paired.

## Verification

**Commands:**
- `npx vitest run src/adapters/driven/docker src/core/logs src/adapters/driving/tui/store/app-store.test.ts` -- expected: all pass
- `npm test` -- expected: full suite green (no regressions in 5.1/5.2/5.4 coverage)
- `npm run typecheck && npm run depcheck` -- expected: clean, `core/` still imports nothing from `adapters/`

## Suggested Review Order

**Health contract and Docker mapping**

- Three-state contract every layer builds on
  [`docker.ts:33`](../../../src/core/ports/docker.ts#L33)

- Inspect-to-health mapping, pure and unit-tested
  [`index.logic.ts:70`](../../../src/adapters/driven/docker/index.logic.ts#L70)

- Raw inspect-string parsing with never-throw fallback
  [`index.logic.ts:83`](../../../src/adapters/driven/docker/index.logic.ts#L83)

- `docker inspect`/`restart` shell-outs plus the 30s restart timeout
  [`index.ts:151`](../../../src/adapters/driven/docker/index.ts#L151)

**State ownership (polling and restart guard)**

- Single state owner: per-pane health, timers, no-op restart
  [`logs-slice.ts:357`](../../../src/adapters/driving/tui/store/slices/logs-slice.ts#L357)

- Poll updates badge on success only, keeps last-known otherwise
  [`logs-slice.ts:204`](../../../src/adapters/driving/tui/store/slices/logs-slice.ts#L204)

**User-visible wiring**

- Uppercase-`R`-only binding avoids the Routes-mnemonic double-dispatch
  [`logs-zone.tsx:806`](../../../src/adapters/driving/tui/zones/logs/logs-zone.tsx#L806)

- Same binding in fullscreen, where zone input is captured
  [`logs-zone.tsx:624`](../../../src/adapters/driving/tui/zones/logs/logs-zone.tsx#L624)

- Badge plus disabled-state rendering in pane headers
  [`logs-zone.tsx:1089`](../../../src/adapters/driving/tui/zones/logs/logs-zone.tsx#L1089)

**Tests**

- Mutant-proof poll, no-op guard, manifest-failure restart cases
  [`app-store.test.ts:1568`](../../../src/adapters/driving/tui/store/app-store.test.ts#L1568)

- Rendered `●`/`○`/`⣾` glyph assertions per health state
  [`logs-zone.test.tsx:248`](../../../src/adapters/driving/tui/zones/logs/logs-zone.test.tsx#L248)

- Live plus PATH-missing CLI-contract coverage for both methods
  [`index.test.ts:131`](../../../src/adapters/driven/docker/index.test.ts#L131)
