# Sprint Change Proposal — 2026-11-04 (2): Health-first service status & "Heal" (restart services that are not up)

Mode: Batch. Scope: **Moderate** (3 new stories in Epic 9, one new architecture decision, manifest semantics widened; no schema break, no rollback).

## 1. Issue Summary

Two requests raised during Epic 9:

1. **A more reliable "is this service down?" signal than the container state.** Today every steady-state status (Dashboard services table, Logs badges and panes, Update service list) comes only from `docker inspect` through `getServiceHealth` (`core/logs/use-cases.ts`). A container can be `up` while the service inside has crashed, is stuck at boot, or fails its dependencies. Wanted: probe a declared health route first, then fall back to the container state, and combine both into the service's real state.
2. **A Dashboard function that restarts every service that is not up**, judged by that new status.

Evidence from the code:
- The manifest **already** has an optional `healthUrl` (`adapters/driven/manifest/schema.ts`, `docs/tui-back-manifest.md` § `healthUrl`), validated as an `http(s)://` URL, probed by `HealthProbePort` / `createHttpHealthProbe` (one `GET`, 2xx = healthy, no redirect following). It is used **only** by `ServiceActions.verifyService` after a restart (switch/realign, FR-37). No steady-state view reads it.
- `getServiceHealth` has 4 callers: `core/dashboard/snapshot.ts` (`readContainer`), `logs-slice.ts` (pane poll + listed-row poll), `update-slice.ts` (service list poll).
- `core/edt/switch-restart.ts` (`restartAfterSwitch`) already restarts a set of services through `runPool` at `update.concurrency`, verifies each with `verifyService`, and reports ordered rows with a summary. That is what "restart everything that is not up" needs.

## 2. Impact Analysis

**Epics**
- Epic 9 (in progress) gets 3 new stories: **9.7** (health-first status resolution), **9.8** (`heal` use-case + CLI), **9.9** (Dashboard Heal action). No existing story changes its acceptance criteria. Epic 8 (done) is not reopened: its consumers are migrated by 9.7.
- The unscheduled PTY backlog item, previously called "9.7" in Story 9.6's notes, loses its number to avoid a clash ("unscheduled PTY item").

**PRD**: new **FR-42** (health-first service status with an explicit inconsistency state) and **FR-43** (heal: restart the services that are not up). FR-29 (container-less services) is extended: a container-less service that declares `healthUrl` now has a real state. No NFR change.

**Architecture**: new **AD-23 — Service status resolution** (one resolver, a fixed order, a closed set of states). AD-21 is unchanged. `HealthProbePort` is reused as is.

**UX**: two new status values in the service glyph/text vocabulary (`unhealthy`, `inconsistent`), a new Attention line for `inconsistent`, a new Dashboard key + confirm/progress screen for Heal (same pattern as the realign dialog's restart report).

**Manifest**: no schema change. The *role* of `healthUrl` widens (steady-state status, not only post-restart verification) → `docs/tui-back-manifest.md` and the `manifest-generator` skill must be updated (standing rule: manifest surface changes update both).

**Code impact (indicative)**
- New `core/service-status/` (`resolveServiceStatus`) over `ManifestPort` + `DockerPort` + `HealthProbePort`. `getServiceHealth` stays as the raw container read used by the resolver.
- `core/dashboard/snapshot.ts`: `container` field replaced by `status: Probed<ServiceStatus>` (+ the raw container state kept for the reason line). CLI `dashboard` JSON changes shape → envelope consumers and its doc updated.
- `logs-slice.ts`, `update-slice.ts`: poll through the resolver. The probe timeout for polling is short (2 s), and a poll never overlaps the previous one for the same repo.
- `core/heal/` (or `core/service-actions/heal.ts`): target selection + restart run. It reuses `restartAfterSwitch`'s pool/report machinery, generalised with an explicit target list and new skip reasons.
- New CLI subcommand `heal`, new setting `dashboard.restartMode` (`simple` | `clean`, default `simple`).
- TUI: theme tokens for the two new states, Dashboard key + Heal screen, keybinding declarations, `?` help, bounded-rendering tests and the dialog/zone registries (AGENTS.md).

## 3. Recommended Approach

**Direct Adjustment.** The three stories are added to Epic 9 on branch `epic-9-service-terminals-unified-service-actions`, one branch per story (CLAUDE.md). All three plug into existing seams: `healthUrl` + `HealthProbePort`, `getServiceHealth`'s 4 callers, and the `restartAfterSwitch` pool/report. Effort: medium. The resolver and its migration are the bulk; the Dashboard screen copies the realign report. Risk: low to medium (HTTP probes inside periodic polls: cost and timeouts; the shape change of the `dashboard` CLI JSON). Timeline: Epic 9 grows by 3 stories. The order is independent of 9.2–9.5.

### Decisions recorded

1. **Genericity:** keep the existing flat `healthUrl` field, with no new schema. Every consumer goes through one resolver (AD-23), so a future probe kind (`healthCommand`, TCP…) is added in one place.
2. **Resolution order (health first, then container):**

   | `healthUrl` | probe | container | → status |
   |---|---|---|---|
   | declared | 2xx | `up` or no container | `up` (verified) |
   | declared | 2xx | `down` / `restarting` | **`inconsistent`** (detail: "health route answers but container is <state>") |
   | declared | 2xx | Docker error | `up` (verified), container error carried separately |
   | declared | not 2xx / timeout | `up` | `unhealthy` (detail: probe reason) |
   | declared | not 2xx / timeout | `restarting` | `restarting` |
   | declared | not 2xx / timeout | `down` | `down` |
   | declared | not 2xx / timeout | no container | `down` (detail: probe reason) |
   | declared | not 2xx / timeout | Docker error | probe error state (explicit error, as today) |
   | absent | — | `up` / `restarting` / `down` | same as the container, `up` marked unverified |
   | absent | — | no container | `no-container` (as today, FR-29) |

   A Docker failure while the route answers is **not** an inconsistency: it is a Docker-wide problem, and flagging it would mark every service inconsistent.
3. **Heal targets:** services of the active EDT whose status is `down` or `unhealthy` and that declare a container. Skipped, each with its reason: `up`, `restarting` (already restarting), `inconsistent` (needs a human look), `no container` (nothing to restart), status error (cannot judge).
4. **Heal UX:** a confirm screen lists targets and skipped rows. Simple/clean mode, pre-selected from the new `dashboard.restartMode` setting. Then a live per-row progress report (`restarting → verifying → final state`), then a Dashboard refresh.
5. **CLI parity:** `tui-back heal [--restart simple|clean]` emits the standard envelope with the report; exit 1 when a targeted service ends failed, down or unhealthy.

## 4. Detailed Change Proposals

### 4.1 PRD (`prds/prd-tui-back-2026-08-10/prd.md`, after FR-41)

```
NEW #### FR-42: Health-first service status (added 2026-11-04, Sprint Change Proposal 2)
Every view that shows a service's state (Dashboard, Logs, Update, CLI `dashboard`) derives it
from one rule: when the manifest declares `healthUrl`, its answer is checked first and combined
with the container state; otherwise the container state alone is used. The closed set of states is
up, unhealthy, inconsistent, restarting, down, no-container (plus an explicit probe-error state).
`inconsistent` (the health route answers while the container is down or restarting) is surfaced
as an attention item. A container-less service declaring `healthUrl` gets a real up/down state.

NEW #### FR-43: Heal — restart the services that are not up (added 2026-11-04, Sprint Change Proposal 2)
From the Dashboard (and the `heal` CLI), a developer restarts in one action every active-EDT
service whose FR-42 status is down or unhealthy and that declares a container, after a
confirmation listing targets and skipped services with reasons, in simple or clean mode; each
restarted service is then verified and the run reports per-service final states.
```

FR-29 gets one appended sentence: "A container-less service that declares `healthUrl` is reported up or down from its health route (FR-42)."

### 4.2 Epics (`epics.md`)

FR inventory (after line 54) and the coverage map (after line 173):
```
FR-42 (added 2026-11-04, SCP 2): Service status is health-first (manifest `healthUrl`, then container), with an explicit `inconsistent` state, across every view and the CLI.
FR-43 (added 2026-11-04, SCP 2): Heal — restart every active-EDT service that is not up, from the Dashboard and the `heal` CLI.

FR-42: Epic 9 - Health-first service status (added 2026-11-04 — Story 9.7)
FR-43: Epic 9 - Heal action on the Dashboard + CLI (added 2026-11-04 — Stories 9.8, 9.9)
```

Epic 9 header: `**FRs covered:** FR-39, FR-40, FR-41; draws on FR-35` → `**FRs covered:** FR-39, FR-40, FR-41, FR-42, FR-43; draws on FR-35, FR-29, FR-37`. Implementation-notes line, appended: `9.7 → 9.8 → 9.9, independent of 9.1–9.6 (AD-23).`

Story 9.6, implementation notes: `Optional unscheduled backlog 9.7: PTY adapter behind the AD-22 port.` → `Optional unscheduled backlog item (unnumbered): PTY adapter behind the AD-22 port.`

New stories appended after Story 9.6:

```markdown
### Story 9.7: Health-First Service Status Resolution

As a developer, I want a service's displayed state to reflect whether the service actually answers, not only whether its container runs, so that I spot a crashed or stuck service immediately.

**Acceptance Criteria:**

**Given** a manifest declaring `healthUrl` **When** the status is resolved **Then** the route is probed first (one `GET` through `HealthProbePort`, short timeout) and combined with the container state following AD-23's table: 2xx + container up → `up`; 2xx + container down/restarting → `inconsistent`; non-2xx/timeout + container up → `unhealthy`; non-2xx/timeout + container restarting/down → `restarting`/`down`.

**Given** a container-less manifest declaring `healthUrl` **When** resolved **Then** the status is `up` or `down` from the probe alone (FR-29 extended).

**Given** no `healthUrl` **When** resolved **Then** the status equals today's container state, `up` flagged as unverified; a container-less service stays `no-container`.

**Given** the probe answers 2xx but Docker errors **When** resolved **Then** the status is `up` and the container error is carried separately, never `inconsistent`.

**Given** the Dashboard snapshot, the Logs panes and list badges, the Update service list and the CLI `dashboard` **When** they read a service state **Then** they all go through the resolver; no consumer combines probe and container itself.

**Given** periodic polls (Logs, Update) **When** a probe is slow **Then** a poll never overlaps the previous one for the same repo and never blocks rendering; the last-known state is kept on failure.

**Given** the `unhealthy` and `inconsistent` states **When** rendered **Then** they have their own glyph + text from theme tokens; `inconsistent` appears in the Dashboard Attention block with its detail; the focused-row reason line shows the probe reason.

**Given** the manifest doc and the `manifest-generator` skill **Then** both describe `healthUrl`'s widened role (steady-state status, not only post-restart verification).

**Implementation notes:** `core/service-status/` (pure, ports injected, returns `Result`, never rejects). `verifyService` keeps its polling loop but uses the same per-attempt rule. Dashboard snapshot field `container` → `status` (+ raw container state); update the CLI `dashboard` envelope doc. AD-23.

### Story 9.8: `heal` Use-Case & CLI — Restart Services That Are Not Up

As a developer, I want one use-case that restarts every service that is not up and reports the result, so that the TUI and scripts share it.

**Acceptance Criteria:**

**Given** an active EDT **When** heal targets are computed **Then** members whose Story 9.7 status is `down` or `unhealthy` and that declare a container are targets; every other member is listed as skipped with its reason (`up`, `already restarting`, `inconsistent`, `no container`, `status unknown`).

**Given** targets and a mode (`simple` | `clean`) **When** heal runs **Then** targets are restarted through `ServiceActions.restart` at `update.concurrency`, then verified through `verifyService`; the report rows and summary use the switch-restart vocabulary (shared machinery, not a copy); a held operation lock fails that row with the lock's name.

**Given** no target **When** heal runs **Then** it succeeds with an empty run and says "every service is up".

**Given** no active EDT **Then** it fails with an explicit error.

**Given** the CLI **When** `tui-back heal [--restart simple|clean]` runs **Then** it emits the standard envelope (AD-3) with targets, skipped rows and the report; `--restart` defaults to `dashboard.restartMode`; exit 1 when a targeted service ends failed, down or unhealthy.

**Implementation notes:** generalise `restartAfterSwitch`'s pool/report into a target-list entry point (switch/realign behaviour and tests unchanged). New setting `dashboard.restartMode` (`simple` | `clean`, default `simple`) in the settings port, schema and settings screen.

**Prerequisites:** 9.7.

### Story 9.9: Dashboard — Heal Action

As a developer, I want to restart every service that is not up from the Dashboard in one action, so that I recover my workspace without restarting services one by one.

**Acceptance Criteria:**

**Given** the Dashboard with a loaded snapshot **When** the Heal key is pressed **Then** a confirm screen (overlay owning the keys, Story 7.11) lists targets and skipped services with reasons, the mode pre-selected from `dashboard.restartMode` and switchable; Enter starts, Esc cancels.

**Given** no target **When** the key is pressed **Then** a notice says every service is up; no screen opens.

**Given** a run **When** in progress **Then** each row shows `restarting → verifying → final state` live; the screen cannot be closed mid-run without confirmation; at the end the summary shows and the Dashboard refreshes.

**Given** the proposed key `H` **When** it collides with a UX-DR36 canonical key or an existing Dashboard/shell binding **Then** HALT and ask.

**Given** the footer and `?` help **Then** they list the key from the keybinding declarations; the screen is bounded (AD-19) and registered in the dialog registry.

**Implementation notes:** reuse the realign dialog's restart-report rendering. The Dashboard's no-live-poll rule (Story 8.3) still holds outside the Heal screen.

**Prerequisites:** 9.8.
```

### 4.3 Architecture (`ARCHITECTURE-SPINE.md`, after AD-22)

```markdown
### AD-23 — Service status resolution (added 2026-11-04, SCP 2)

- **Binds:** FR-42, FR-43, FR-29, Stories 9.7, 9.8, 9.9
- **Prevents:** each view combining health probe and container state its own way; a service shown `up` while it does not answer; a Docker outage marking every service inconsistent.
- **Rule:** `core/service-status/resolveServiceStatus(repoPath)` is the only producer of a service's displayed state. Order: manifest `healthUrl` probe first (`HealthProbePort`), then container (`DockerPort.getContainerHealth`). Closed set: `up | unhealthy | inconsistent | restarting | down | no-container`, plus `Probed` error. The combination table lives in the resolver and nowhere else. `healthUrl` stays the only probe kind; a new kind (command, TCP) is added inside the resolver, not in consumers. Returns `Result`, never rejects.
```

### 4.4 UX

- Status vocabulary: add `unhealthy` (warning token, e.g. `◐ unhealthy`) and `inconsistent` (warning token, e.g. `⚠ inconsistent`). The final glyphs are picked in 9.7 from the existing theme tokens.
- Dashboard Attention block: a new item kind `inconsistent` ("health route answers but container is down"), ordered after protected-branch items.
- Heal screen: same layout as the realign restart report (rows + summary + key hints).

### 4.5 Docs & tooling

- `docs/tui-back-manifest.md` § `healthUrl`: the role covers steady-state status (Dashboard, Logs, Update, CLI) in addition to post-restart verification; add the resolution table; container-less + `healthUrl` behaviour.
- `manifest-generator` skill: recommend `healthUrl` whenever a health route is discoverable (it now drives everyday status, not only switch verification).
- CLI docs: `heal` subcommand; the shape change of the `dashboard` envelope.

### 4.6 Sprint status (`sprint-status.yaml`)

```yaml
  9-7-health-first-service-status-resolution: backlog
  9-8-heal-use-case-and-cli: backlog
  9-9-dashboard-heal-action: backlog
```
Epic comment appended: `+ health-first status & heal (2026-11-04, sprint-change-proposal-2026-11-04-2.md): 9-7 -> 9-8 -> 9-9.`

## 5. Implementation Handoff

**Scope: Moderate.** Backlog reorganisation within Epic 9 (PO/DEV); no PM/architect replan.

- **Developer (bmad-build):** implement 9.7 → 9.8 → 9.9 in order, each on its own `story-9-x-…` branch from `epic-9-service-terminals-unified-service-actions`, merged back with `--no-ff`.
- **Docs/skill:** done inside 9.7 (manifest doc + `manifest-generator`) and 9.8 (CLI doc).

**Success criteria**
- With a service whose container is up but whose `healthUrl` returns 500: Dashboard, Logs and Update all show `unhealthy`, and `tui-back dashboard` reports it.
- With a stopped container whose port is still answered by another process: `inconsistent`, listed in Attention, not targeted by heal.
- `tui-back heal` restarts exactly the down/unhealthy services with a container, and the report matches the switch-restart vocabulary.
- Dashboard `H` (or the agreed key): confirm screen → live progress → refreshed Dashboard.
- Existing switch/realign restart tests pass unchanged; bounded-rendering guard green.
