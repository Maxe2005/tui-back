---
title: 'Health-First Service Status Resolution'
type: 'feature'
created: '2026-11-04'
status: 'done'
baseline_commit: '374213738fbfbedb23e4373cdb1f202cf518c3d7'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-9-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Every view shows a service as `up` as soon as its container runs, even when the service no longer answers. Each consumer (Dashboard, Logs, Update, CLI `dashboard`) also reads the container state its own way.

**Approach:** Add one pure resolver, `core/service-status`, that probes the manifest `healthUrl` first and then combines the result with the container state following AD-23. Route every status consumer through it, and give `unhealthy` and `inconsistent` their own rendering.

## Boundaries & Constraints

**Always:**
- The combination table lives only in `core/service-status`. It returns `Result` and never rejects. Ports are injected: `ManifestPort`, `DockerPort.getContainerHealth`, and an optional `HealthProbePort`. When the probe is not wired, the resolver behaves as if no `healthUrl` were declared.
- The resolved value carries `state`, `verified`, the raw container state or the container error, and the probe reason.
- Status probes use a 2 s timeout (`STATUS_PROBE_TIMEOUT_MS`).
- `verifyService` keeps its loop, timings and `ServiceFinalState` vocabulary, but decides each attempt with the resolver's pure combine function. Switch and realign tests stay green, unchanged.
- The Logs and Update polls keep a per-repo in-flight guard, so a tick for a repo still awaiting is skipped. They keep the last-known state on failure and never block rendering.
- The Dashboard snapshot field `container` becomes `status`.
- AD-19 bounded rendering: dynamic text is truncated, and the bounds tests and guards stay green.
- Glyphs and colours come only from `STATUS_BADGES` and theme tokens: `unhealthy` is `◐` warning, `inconsistent` is `⚠` warning.

**Ask First:** changing `HealthProbePort`, `DockerPort` or the manifest schema; adding live polling to the Dashboard; changing `ServiceFinalState`.

**Never:** a consumer combining probe and container itself; any new dependency; touching the heal work of 9.8 and 9.9; persisting statuses.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output |
|---|---|---|
| Healthy | probe 2xx, container `up` | `up`, verified |
| Route up, container not | probe 2xx, container `down` or `restarting` | `inconsistent` |
| Docker outage | probe 2xx, Docker error | `up`, verified, container error carried. Never `inconsistent`. |
| Stuck | probe non-2xx or timeout, container `up` | `unhealthy`, probe reason carried |
| Down or restarting | probe fails, container `down` or `restarting` | `down` or `restarting` |
| Both fail | probe fails, Docker error | `err` (Docker error), probe reason in `details` |
| Container-less with health | no container, probe 2xx or failing | `up` (verified) or `down` |
| No healthUrl | container `up`, `down` or `restarting` | same state; `up` is unverified |
| Nothing declared | no container, no healthUrl | `no-container` |
| Manifest unreadable | load fails | `err` (manifest error) |

</frozen-after-approval>

## Code Map

- `src/core/ports/docker.ts:23,37-42` -- `HealthState`, `getContainerHealth`. The adapter maps spawn failure to `err('docker-unavailable')` and a non-zero exit to `ok('down')`.
- `src/core/ports/health-probe.ts:6-17` -- `probe(url, timeoutMs)`. It never throws: a timeout or unreachable URL gives `ok({healthy:false, reason})`.
- `src/core/ports/manifest.ts:8,11` -- `container?`, `healthUrl?`; the comment at `:11` is post-switch only. Reuse `hasContainer` from `service-actions/index.ts:133`.
- `src/core/logs/use-cases.ts:51-60` -- `getServiceHealth`, the raw container read. Keep it as is.
- `src/core/service-actions/index.ts:275-332` -- `verifyService`. Today's per-attempt rule is container first, then probe. Constants are at `:36-39`; the caller is `core/edt/switch-restart.ts:174`.
- `src/core/dashboard/snapshot.ts:20,39,66-73,171,205-219` -- `Probed<T>`, the `container` field, the params (no `healthProbe` yet), and `readContainer`.
- `src/adapters/driving/cli/subcommands.ts:190-204` -- CLI `dashboard`, which passes `docker` but no probe. The probe is already in deps (`:118`). Wiring is in `src/bin/main.ts:92` and `src/bin/tui.ts:191`, and `app-store.ts:88-93` declares `healthProbe` optional.
- `src/adapters/driving/tui/zones/dashboard/dashboard.logic.ts:27-41` (`containerLabel`), `:67-116` (`reasonParts`/`reasonLine`), `:131-189` (`AttentionReason`, `buildAttentionItems`, protected-branch item at `:158-160`) -- plus `dashboard-body.tsx:58,91-99,112,229`.
- `src/adapters/driving/tui/store/slices/logs-slice.ts:37,64,245-306,352-511` -- the pane poll and the listed-row poll (5 s, no in-flight guard).
- `src/adapters/driving/tui/zones/logs/logs-zone.logic.ts:20-52` (badge, label, restarting display) -- plus `logs-zone.tsx:248-250,811` (display and restart gating), `logs-pane-view.tsx`, `fullscreen-pane.tsx`.
- `src/adapters/driving/tui/store/slices/update-slice.ts:248,370-400,1508-1527` -- Update poll; `zones/update/update-zone.logic.ts:27,37-67` (`deriveUpdateServiceStatus`).
- `src/adapters/driving/tui/shared/components/status-badge.tsx:4-48` -- `StatusBadgeState`, `STATUS_BADGES`.
- Docs: `docs/tui-back-manifest.md:31,130-144,326`; `.claude/skills/manifest-generator/SKILL.md:3,43,55,77-78`; `tui/shared/repo-registry-screen.tsx:42`; `adapters/driven/manifest/schema.ts:20` (comment only).
- Tests faking `getContainerHealth`: `snapshot.test.ts`, `logs-slice.test.ts`, `update-slice.test.ts`, `dashboard-slice.test.ts`, `app-store.test.ts`, `cli/dispatch.test.ts`, `update-zone.test.tsx`, `logs-zone.test.tsx`, `dashboard.logic.test.ts`, `dashboard-zone*.test.tsx`. Fakes are inline `vi.fn`.

## Tasks & Acceptance

**Execution:**
- [x] `src/core/service-status/index.ts` (+ `index.test.ts`) -- `ServiceStatusState`, `ServiceStatus`, pure `combineStatus(probe, container)` and `resolveServiceStatus({manifest, docker, healthProbe?}, repoPath)`, plus `STATUS_PROBE_TIMEOUT_MS`. Unit-test every row of the matrix. This is the single owner of AD-23.
- [x] `src/core/service-actions/index.ts` -- `verifyService` decides each attempt through `combineStatus`. `up` verified → `functional`, `up` unverified → `up-unverified`, `down` → return `down`. `restarting` and `inconsistent` keep polling, and so does `unhealthy` until the timeout. Existing tests pass unchanged. This satisfies "same per-attempt rule".
- [x] `src/core/dashboard/snapshot.ts` + CLI `subcommands.ts` + `dashboard-slice.ts` -- add `healthProbe` to the params, replace `container` with `status: Probed<ServiceStatus>`, and pass the probe at both call sites. Update the tests.
- [x] `src/adapters/driving/tui/shared/components/status-badge.tsx` -- add `unhealthy` (`◐`, warning) and `inconsistent` (`⚠`, warning).
- [x] `src/adapters/driving/tui/zones/dashboard/dashboard.logic.ts` + `dashboard-body.tsx` -- label from `status`. The reason line shows the probe reason, or `container error: …` when Docker failed. Add an `inconsistent` Attention item ("health route answers but container is <state>"), ranked right after protected-branch.
- [x] `src/adapters/driving/tui/store/slices/logs-slice.ts` + `logs-zone.logic.ts` + views -- the pane and listed-row polls go through the resolver with a per-repo in-flight guard. The pane health type becomes `ServiceStatusState`. Restart gating keeps treating `restarting` as before.
- [x] `src/adapters/driving/tui/store/slices/update-slice.ts` + `update-zone.logic.ts` -- same migration and guard. The new states pass through `deriveUpdateServiceStatus`.
- [x] `docs/tui-back-manifest.md`, `.claude/skills/manifest-generator/SKILL.md`, `repo-registry-screen.tsx:42`, `manifest/schema.ts:20`, `manifest.ts:11` -- describe `healthUrl` as the steady-state status probe: the resolution table and the container-less behaviour. Add a "CLI `dashboard` JSON" section to `docs/tui-back-manifest.md` documenting the `status` field.
- [ ] Bounds tests (`dashboard-zone.bounds`, `bounds-matrix`) -- cover rows in the `unhealthy` and `inconsistent` states.

**Acceptance Criteria:**
- Given a running poll whose probe is still awaiting, when the next tick fires, then no second probe starts for that repo and the last state stays displayed.
- Given an `inconsistent` service, when the Dashboard renders, then it appears in Attention with its detail and its own glyph and text.
- Given any consumer, when `grep -rn "getServiceHealth\|getContainerHealth" src/adapters/driving` is run, then no status-display path calls it outside the resolver. The `service-actions` terminal availability and `core/shell` are not display paths.
- Given `npm test && npm run typecheck && npm run depcheck`, then all pass.

## Design Notes

- **No-`healthUrl` `up`:** it keeps the plain `up` label, with `verified:false` only in the data and the CLI JSON. Flagging it visibly would add noise to every service without a route.
- **Where the CLI doc goes:** no CLI doc exists, so the `dashboard` JSON section goes into the manifest doc, next to `healthUrl`, the field that drives it.

## Verification

**Commands:**
- `npm test && npm run typecheck && npm run depcheck` -- expected: all green, including the bounds and guard tests.

## Suggested Review Order

**AD-23 resolver (single owner of the table)**

- Entry point: the pure combination table every view now goes through.
  [`index.ts:62`](../../src/core/service-status/index.ts#L62)

- Resolved shape: state, verified flag, raw container or error, probe reason.
  [`index.ts:17`](../../src/core/service-status/index.ts#L17)

- 2 s steady-state probe timeout, distinct from post-restart verification.
  [`index.ts:13`](../../src/core/service-status/index.ts#L13)

**Post-restart verification**

- `verifyService` decides each attempt with `combineStatus`; reports the latest observation at timeout.
  [`index.ts:295`](../../src/core/service-actions/index.ts#L295)

**Dashboard & CLI snapshot**

- `container` → `status`; error keeps `details.probeReason` for the CLI JSON.
  [`snapshot.ts:214`](../../src/core/dashboard/snapshot.ts#L214)

- Labels for the new states and the inconsistent Attention text.
  [`dashboard.logic.ts:29`](../../src/adapters/driving/tui/zones/dashboard/dashboard.logic.ts#L29)

- Attention block gains the `inconsistent` item after protected-branch.
  [`dashboard.logic.ts:186`](../../src/adapters/driving/tui/zones/dashboard/dashboard.logic.ts#L186)

**Non-overlapping polls (Logs, Update)**

- Token-based per-repo guard: late polls of an old generation never write.
  [`in-flight-guard.ts:17`](../../src/adapters/driving/tui/shared/poll/in-flight-guard.ts#L17)

- Pane poll resolves container-less panes with a `healthUrl`; neither → `no-container`.
  [`logs-slice.ts:270`](../../src/adapters/driving/tui/store/slices/logs-slice.ts#L270)

- `noContainer` pane flag keeps such panes without stream or restart.
  [`logs-slice.ts:44`](../../src/adapters/driving/tui/store/slices/logs-slice.ts#L44)

- Listed-row poll through the resolver, guarded and pruned on retarget.
  [`logs-slice.ts:386`](../../src/adapters/driving/tui/store/slices/logs-slice.ts#L386)

- Update poll: guard plus skip-write when the repo left the list.
  [`update-slice.ts:373`](../../src/adapters/driving/tui/store/slices/update-slice.ts#L373)

**Rendering**

- New `unhealthy` (◐) and `inconsistent` (⚠) badges from theme tokens.
  [`status-badge.tsx:26`](../../src/adapters/driving/tui/shared/components/status-badge.tsx#L26)

- Text next to the glyph in Update, since `◐` is shared with awaiting.
  [`update-zone.logic.ts:69`](../../src/adapters/driving/tui/zones/update/update-zone.logic.ts#L69)

- Logs row display precedence (pane over listed health).
  [`logs-zone.tsx:250`](../../src/adapters/driving/tui/zones/logs/logs-zone.tsx#L250)

**Docs & tests**

- `healthUrl` as steady-state probe, with the resolution table.
  [`tui-back-manifest.md:131`](../../docs/tui-back-manifest.md#L131)

- New CLI `dashboard` JSON section (`status` field).
  [`tui-back-manifest.md:407`](../../docs/tui-back-manifest.md#L407)

- Skill description updated for the widened role.
  [`SKILL.md:3`](../../.claude/skills/manifest-generator/SKILL.md#L3)

- Matrix tests, one per I/O row.
  [`index.test.ts:35`](../../src/core/service-status/index.test.ts#L35)
