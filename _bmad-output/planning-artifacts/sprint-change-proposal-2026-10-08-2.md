# Sprint Change Proposal — 2026-10-08 (2)

**Trigger:** a multi-service update runs strictly one service after the other, and any conflict blocks everything behind it; the per-service "last update" detail truncates the very errors the developer needs to read.
**Requested by:** Max · **Mode:** Batch · **Scope:** Moderate (two stories added to Epic 3, one core engine change, no replan)

---

## 1. Issue Summary

Two problems surfaced while using the Update zone (Stories 3.10, 3.13–3.17).

**A. The run is sequential and a blocker freezes it.**
`groupUpdate` (`src/core/scripts/group-update.ts`) walks the targeted services with a `for` loop (EDT scope ~l.556, all-repos scope ~l.356). A service that hits a dirty worktree or a merge conflict awaits `onUpdateBlocker` before the loop can reach the next one. On the TUI side `update-slice.ts` keeps a **single** `updateBlocker` slot and a single `pendingBlockerResolve`, and the guided menu is a blocking modal. Consequences:

- A clean run is as slow as the sum of its services, although they are independent (different repos, different containers).
- With several problems, the developer must solve them in the order the loop hits them, while healthy services behind the blocked one sit idle.
- A migration or restart failure ends the service as `failed` (`migration-failed`, restart skipped). **This stays as is** (Max's correction): such failures never enter the incident queue. The developer fixes the cause and relaunches that service with the single-service update (Story 3.9); Story 3.16's lock rejects that relaunch while the run is still going and **stays unchanged**: a failed service can only be relaunched once the whole run has ended.

**B. Failure details are unreadable.**
`update-service-detail.tsx` renders every step detail with `wrap="truncate-end"` and caps it at `MAX_STEP_DETAIL_LINES = 4`; issue log lines are flattened to one line (`detail.replace(/\s+/g, ' ')`). A merge or migration error (multi-line command output) is therefore cut off in the "last update" view, and there is no way to see the rest. The Logs zone already solves this class of problem with its fullscreen pane.

**Decision (Max), as the target behaviour:**

> Services update in parallel. Anything that needs the developer goes into a **queue of incidents** that fills as the run progresses. The developer picks any incident, in any order, and resolves it while healthy services keep going in the background; a resolved service resumes its own pipeline (merge → migration → restart) by itself, a new incident can appear at any time, and the developer can re-prioritise. Only merge/dirty-state blockers (Story 3.4) are incidents; migration and restart failures simply fail the service, as today, and the developer relaunches it with the single-service update once the whole run has ended.
> Plus: a way to focus a service's success/failure report and read it in full, like the Logs fullscreen.

Confirmed choices: **bounded parallelism, default 3, configurable** · **two stories in Epic 3**.

---

## 2. Impact Analysis

| Item | Status | Notes |
|------|--------|-------|
| Epic 3 | [x] | Two stories added: **3.18** (parallel engine + incident queue), **3.19** (full-screen service report). Epic 3 stays open; no completed story is reverted |
| Story 3.4 (assisted resolution, done) | [!] | Mechanic unchanged (detect → auto-fix-or-menu → re-verify). What changes: it is no longer a single blocking modal but one incident among several |
| Story 3.10 / 3.13 / 3.15 / 3.16 (done / review) | [!] | Live per-service tracking and non-blocking subprocesses are the prerequisites that make this possible; 3.15 is still in `review`, merge it first. 3.16's global lock is unchanged: no second update, single-service included, until the whole run has ended |
| Story 3.1 / 3.2 / 3.3 ACs | [!] | "Run does not proceed on that repo until the developer acts" stays true **per repo**; add that other repos proceed meanwhile |
| Epic 4 (Stories 4.4, 4.5, backlog) | [!] | 4.4 requires `shared-types` merged **first**: the engine needs an ordering stage ("stage 0" runs alone, then the rest in parallel). 4.4 only needs a pointer; no rewrite. 4.5 (auto-resolve) plugs in before an incident is raised |
| PRD | [!] | Amend FR-10, FR-11; add FR-34 (full-screen report). No MVP scope change |
| Architecture | [!] | New **AD-20** (bounded parallel run & incident queue). Hexagonal rules intact: the pool lives in `core/`, the queue is a driving-side adapter of the existing seam |
| UX | [!] | New components "incident-queue" and "full-screen report"; `modal-dialog` guided-menu row updated. `key-update-run.html` stays stale (already flagged), a refresh is a UX follow-up |
| Code | [!] | `group-update.ts` (worker pool, per-repo serialisation, new blocker kinds), `update-slice.ts` (incident queue), `update-zone.tsx` + new queue/report components, `update-service-detail.tsx`, settings (concurrency). See §4 |
| Sprint status | [!] | + `3-18-…: backlog`, `3-19-…: backlog` |

### Risks worth naming

- **Docker/CPU contention.** Clean-restart recipes (`npm i`, `npm run d:up`) are heavy. Hence the cap (default 3, `1` = today's sequential behaviour) instead of "all at once".
- **Same repo twice.** Two services in one EDT can share a `repoPath` (the engine already de-duplicates by resolved path). The pool serialises work **per resolved repoPath**.
- **Cancel semantics.** "Cancel the whole run" must now stop work that is already in flight (see AC below).
- **Interleaved output.** Per-service state is keyed by service, so live tracking already isolates streams; the end-of-run summary stays in configuration order, not completion order, so results are deterministic.

---

## 3. Recommended Approach

**Direct Adjustment.** Two stories on separate branches from `epic-3-group-update-migrations`.

- **Story 3.18** — Medium-Large, risk Medium: touches the heart of `groupUpdate`. Mitigation: the pool is introduced with `concurrency = 1` equal to the legacy behaviour, so the existing, heavily-tested `group-update.test.ts` suites must pass unchanged before parallelism is enabled; the seam `OnUpdateBlocker` keeps its type (it was already `Promise<choice>`, so core can call it concurrently).
- **Story 3.19** — Small, risk Low, independent, can ship first or alone.

Suggested order: merge 3.15 → **3.19** (quick win, immediately useful) → **3.18**. Epic 4's 4.4 is built after 3.18.

---

## 4. Detailed Change Proposals

### 4.1 `epics.md` — Epic 3 list: new Story 3.18

**Section:** after Story 3.17 (Epic List block and detailed Epic 3 section)

NEW:

### Story 3.18: Parallel Update Run & Incident Queue

> Added 2026-10-08 (Sprint Change Proposal). Amends FR-10, FR-11. Builds on Stories 3.4, 3.10, 3.13.

As a developer,
I want the services of a run to update in parallel and every problem to wait in a queue I can work through in the order I choose,
So that a clean run finishes as fast as possible and a run with errors never stops healthy services while I fix the others.

**Acceptance Criteria:**

**Given** a confirmed run (any scope) **When** it starts **Then** the targeted services are processed by a bounded pool: at most `N` services are in flight at once (`N` = setting `update.concurrency`, default 3, minimum 1; `1` behaves exactly like today's sequential run). Each service runs its own pipeline (merge → migration → restart) independently of the others.

**Given** two targeted services that resolve to the same repoPath **When** the run executes **Then** they are never processed concurrently.

**Given** a service hits something needing the developer (dirty worktree, merge conflict, pre-existing mid-merge/mid-rebase — Story 3.4) **When** it is raised **Then** that service **pauses** and an **incident** is appended to the run's incident queue; the pool slot it held is released to the next waiting service; every other service keeps going.

**Given** a service's migration or restart fails **When** it occurs **Then** nothing changes from today: the service ends `failed` with its `migration-failed` / restart detail, no incident is raised, and the other services are neither blocked nor rolled back.

**Given** a run in progress **When** the developer launches any other update, including a single-service update of a service that already failed **Then** it is rejected as today (Story 3.16); relaunching is possible only once the whole run has ended.

**Given** the incident queue **When** the first incident arrives and the developer is in the Update zone **Then** the incident popup opens on it. Later incidents are appended **without stealing focus or input** from whatever the developer is doing (popup open or closed): the Update tab and the zone header show a count of pending incidents, and a transient toast names the new one.

**Given** the incident popup **When** it is open **Then** it lists every pending incident (service, kind, age) next to the guided menu of the selected one. `↑/↓` select an incident, `Enter` opens its guided menu, the developer may resolve them in any order. `Esc` closes the popup **without resolving anything**: incidents stay queued, their services stay paused, a key reopens the popup (also reachable from the command bar).

**Given** the developer resolves an incident (stash / edited / cancel-repo / cancel-run) **When** the tool re-verifies it (Story 3.4's re-check, never assumed) **Then** the service resumes on its own in the background: a service that regains its slot continues its pipeline without further input. If re-verification fails, the incident stays in the queue marked "still blocked" with the reason, as Story 3.4 does today.

**Given** a pending incident **When** the developer looks at that service in the list or its detail pane **Then** the service shows an "awaiting you" state (glyph + colour, never colour alone), consistent with the closed status set of Story 3.6.

**Given** the developer chooses "cancel the whole run" **When** selected **Then** no service that has not started is started; services in flight finish their **current step** (no subprocess is killed mid-step) and stop before the next one; pending incidents are closed as cancelled; the summary lists them as skipped/cancelled. The summary still accounts for every targeted service, in configuration order.

**Given** the developer presses `q` during a run **When** incidents are pending or services are in flight **Then** the existing quit confirmation names how many are pending and in flight (Story 3.1 rule extended).

**Given** the run ends **When** the summary shows **Then** the incident queue is empty (every incident resolved, skipped or cancelled), and the recap (Story 3.14) lists the services in configuration order.

**Implementation notes:**
- Core: replace the two sequential loops with one `runPool(targets, concurrency, worker)` helper (pure, unit-tested with fake ports). Keep the `Promise<UpdateBlockerChoice>` seam and its blocker kinds/choices unchanged. Lock keys: keep `GROUP_UPDATE_LOCK_KEY`; add a per-repoPath serialisation (key by resolved path). Provide an `ordering` hook (stages) so Story 4.4 can run `shared-types` alone first.
- A worker throwing is converted into that service's `failed` row (never-throw invariant, AD-3); the pool never rejects.
- Store: `updateBlocker` / `pendingBlockerResolve` become `incidents: UpdateIncident[]` plus a `Map<incidentId, resolver>`; `resolveUpdateIncident(id, choice)`. Existing `liveServiceIssues` keep working per service.
- Settings: `update.concurrency` in the global settings screen (Story 2.19), General tab or an Update tab.
- Build in this order, one commit each: pool at `concurrency=1` (suite green) → per-repoPath serialisation → incident store → queue popup → concurrency setting → enable default 3.
- Bounded rendering (AD-19): the queue list goes through `BoundedList`; register the popup in `dialog-registry.tsx`.

### 4.2 `epics.md` — Story 3.19

NEW:

### Story 3.19: Full-Screen Service Report (Success / Error Logs)

> Added 2026-10-08 (Sprint Change Proposal). Adds FR-34. Mirrors the Logs zone's fullscreen pane (Epic 5).

As a developer,
I want to open a service's last-update report (or its live issue log) full screen,
So that I can read an entire merge or migration error that the detail pane has to truncate.

**Acceptance Criteria:**

**Given** a focused service in the Update zone with a last update or a live issue log **When** the developer presses `f` (Enter on the detail pane is not used: it opens the service menu) **Then** a full-screen report opens for that service: context line (from → to), then every step (merge, migration, restart) with its **complete** detail and error output, the issue log with each issue's full text, nothing capped at 4 lines or flattened to one line.

**Given** the full-screen report **When** content exceeds the screen **Then** it scrolls (`↑/↓`, `PgUp/PgDn`, `Home/End`), shows a position indicator, and long lines wrap (not truncate); `w` toggles wrap/truncate like the Logs fullscreen; `Esc` closes and returns to the zone unchanged.

**Given** the report is opened during a live run **When** new steps/issues arrive **Then** it updates live; if the service finishes, it switches to its final report in place.

**Given** the report content **When** a step failed **Then** failed steps are visually first-class (error colour + glyph, never colour alone) and a key (`n`/`p`) jumps between failed steps.

**Given** the recap view (no service focused) **When** a service row of the recap has a failure **Then** the same report opens for it (`Enter` on the row).

**Given** the pane footer **When** a report is available **Then** the footer hint advertises `[f] full report`.

**Implementation notes:** a `FullscreenReport` component under `zones/update/`, purely presentational like `logs/fullscreen-pane.tsx`; data comes from the existing `buildServiceStepViews` and `liveServiceIssues` with the caps lifted (the caps stay on the inline pane). Bounded-rendering exemption justified: scrolling window over the full text, tested in `bounded-rendering.guard`.

### 4.3 `epics.md` — Stories 3.1, 3.4: one-line pointers

**Story 3.4, Compatibility note (append):**

OLD: *"…no change to the detect → auto-fix-known-safe-or-guided-menu → re-verify mechanic itself."*

NEW: *"…no change to the detect → auto-fix-known-safe-or-guided-menu → re-verify mechanic itself. (Amended 2026-10-08: the menu is no longer a single blocking modal; each blocked repo becomes one incident in the run's incident queue, Story 3.18, and only that repo waits.)"*

**Story 3.1, ACs (append):**

NEW: *"**Given** several member services **When** the run executes **Then** they are processed in parallel up to the configured concurrency (Story 3.18); a service waiting on the developer never delays the others."*

### 4.4 `prd.md` — FR-10, FR-11, new FR-34

**FR-10 Consequences (append):**
NEW: *"The targeted services are updated in parallel, bounded by a configurable concurrency (default 3; 1 = sequential). The end-of-run summary lists services in configuration order."*

**FR-11 (replace the blocking sentence):**

OLD: *"…presents a menu (stash / open in editor / cancel this repo / cancel the whole run) and does not proceed on that repo until the developer acts — …"*

NEW: *"…raises an incident in a queue that fills as the run progresses; the developer chooses which incident to resolve first (stash / open in editor / cancel this repo / cancel the whole run). Only the blocked repo waits; the others keep updating, and a resolved repo resumes by itself after the tool re-verifies its state. Cancelling the whole run stops un-started services and lets in-flight services finish their current step."*

**FR-12 Consequences (append, clarification only):**
NEW: *"A failed migration or restart is not an incident: the service ends failed as before. It can be relaunched through the single-service update once the whole run has ended."*

**FR-34 (new):** *"A developer can open a service's update report full screen — the complete detail and error output of each step and every logged issue — scrollable, wrapping, and live while the run is in progress."* Epic 3 mapping line added to the FR coverage map.

### 4.5 `ARCHITECTURE-SPINE.md` — new AD-20

NEW: **AD-20 — Bounded parallel run & incident queue.**
- **Binds:** FR-10, FR-11, Stories 3.18, 4.4
- **Prevents:** one slow or blocked service holding the rest of a run; unbounded Docker/CPU fan-out; two workers touching one working tree; a single global blocker slot hiding concurrent problems.
- **Rule:** `core/scripts/group-update.ts` drives targets through a bounded worker pool (`update.concurrency`, default 3). Workers are isolated (a throw becomes that service's `failed` row), serialised per resolved repoPath, and report through the existing `onUpdatePhase` / `onServiceResult` / `onUpdateBlocker` seams. `onUpdateBlocker` may be invoked concurrently: the driving adapter owns the queue (one pending promise per incident). Core never knows about the queue, popups or ordering of resolution. An optional stage list lets a caller run a first stage alone (Story 4.4's `shared-types`) before the parallel stage. Cancel-run is cooperative: checked between steps, never by killing a subprocess.

### 4.6 `EXPERIENCE.md` / `DESIGN.md` — UX

- **Component table, new `incident-queue`:** two-column `modal-dialog` (left: bounded list of pending incidents with service, kind, age, "still blocked" marker; right: the selected incident's guided menu). `↑/↓` select, `Enter` act, `Esc` close without resolving, reopen via footer-hinted key. Auto-opens only for the first incident of a quiet moment; later incidents notify via tab badge + toast.
- **Component table, new `fullscreen-report`:** same chrome as the Logs fullscreen (title bar, scroll indicator, footer hints), wrap toggle, failed-step jump.
- **`modal-dialog` row:** the FR-11 guided-menu instance is now hosted by `incident-queue`.
- **Status vocabulary:** add `awaiting you` (glyph + colour) to the closed service-status set of Story 3.6.
- Refresh of `key-update-run.html` stays a pending UX follow-up (already recorded).

### 4.7 `docs/` and skills

- `docs/tui-back-manifest.md` and the `manifest-generator` skill: **no change** (manifest schema untouched; `update.concurrency` is a user setting, not a manifest field).
- User-facing docs for the Update zone (if present under `docs/`): add "parallel run", the incident queue and the `f` full report.

### 4.8 `sprint-status.yaml`

```
  3-18-parallel-update-run-incident-queue: backlog
  3-19-full-screen-service-report: backlog
```
(after `3-17-…`, `last_updated: 2026-10-08`)

---

## 5. Implementation Handoff

**Scope: Moderate.** Backlog reorganisation (two stories added, order 3.15 → 3.19 → 3.18, Epic 4's 4.4 then builds on 3.18) with direct implementation by the Developer agent.

| Recipient | Responsibility |
|-----------|----------------|
| PO / SM | Apply the `epics.md`, PRD, architecture, UX and sprint-status edits above; create story specs 3.18 and 3.19 |
| Developer | Story 3.19 first (own branch `story-3-19-…`), then 3.18 (`story-3-18-…`), each from `epic-3-group-update-migrations`, atomic commits with the story number in the subject; merge with `--no-ff` |
| UX designer | Refresh the Update-run mockup with the queue and the fullscreen report (non-blocking) |

**Success criteria:**
1. `groupUpdate` with `concurrency = 1` passes every existing `group-update.test.ts` case unchanged; with `concurrency = 3`, a run of independent clean services finishes in roughly the time of its slowest batch (fake-port timing test).
2. Max's scenario holds in a test: 3 services, 2 conflicts + 1 clean → the clean one reaches `updated` while both incidents are pending; resolving one lets it continue in the background; a migration failure on the third service ends it `failed` without any incident; a single-service update attempted while the run is still going is rejected, and accepted once the run has ended; the summary lists all three in configuration order.
3. Cancel-run leaves no subprocess killed mid-step and no service silently absent.
4. A multi-line migration error is fully readable in the full-screen report, scrollable, and live while a run is in progress.
5. `npm test && npm run typecheck && npm run depcheck` green; new dialogs registered (`dialog-registry.tsx`, bounds and bounded-rendering guards).

**Open points (none blocking):** default key for reopening the incident popup (proposal: `i`). Decide at story creation.
