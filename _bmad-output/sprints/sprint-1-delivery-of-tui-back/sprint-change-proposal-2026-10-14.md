# Sprint Change Proposal — 2026-10-14

**Trigger:** after an EDT switch the running containers still hold the *previous* EDT's code. The developer wants to chain a service restart onto the switch, without a second manual step, and to see whether each service really came back.
**Requested by:** Max · **Mode:** Batch · **Scope:** Minor-to-Moderate (1 story added, 1 optional manifest field, no completed story reverted)

---

## 1. Issue Summary

Requested behaviour: when switching the active EDT, the developer can choose to restart the services in the same gesture, with three choices:

| Choice | Effect |
|--------|--------|
| **None** (default) | No restart — today's behaviour |
| **Simple restart** | `docker restart` of each concerned service that has a container |
| **Clean restart** | The manifest clean-restart recipe of each concerned service that has one |

It must **work like the Update**: services restart **in parallel** (bounded pool), progress is followed live per service, and the **state after restart is reported** per service: *up? down? functional (`/health` answers)?*

### Evidence (checked in the code)

- **Parallel pool exists.** `core/scripts/run-pool.ts` (Story 3.18, `update.concurrency`, default 3) is pure and reusable (`keyOf` serialisation per repo, cooperative cancel, never rejects).
- **Restart actions exist.** `core/service-actions/index.ts` (Story 7.12, in review) exposes `restart(repoPath, 'simple' | 'clean')`, falls back to a simple restart with `NO_CLEAN_RECIPE_NOTICE` when there is no recipe, reports `no container` for container-less services and holds a per-service restart lock.
- **Container state exists.** `DockerPort.getContainerHealth` → `up | down | restarting` (`docker inspect`). The Update zone already maps it to its status set (`group-update.ts:27`).
- **Switch has a single seam.** `switchActiveEdt` (`core/edt/switch.ts`) returns per-repo `SwitchEdtRepoResult` rows; the TUI side is `edt-slice.ts:310` + `switch-dialog.tsx`, and the CLI side is `edt switch` (Story 2.40, still backlog).
- **Gap — no HTTP health probe.** Nothing in `src/` or `docs/` knows a `/health` endpoint, and the manifest has no field for it. "Functional" therefore **cannot** be derived today; it needs a declared endpoint (decision taken with Max: optional manifest field).
- **Guard to respect.** Switch is rejected while an update runs (`edt-slice.ts:314`); the post-switch restart run must hold the same exclusion in the other direction (no update/switch/second restart run while it is in flight).

---

## 2. Impact Analysis

| Item | Status | Notes |
|------|--------|-------|
| Epic 2 | [!] | + **Story 2.44**. Stories 2.38–2.43 untouched. 2.40 (CLI switch, backlog) gets the `--restart` flag via 2.44, not by rewriting 2.40 |
| Epic 3 / 7 | [x] | No change. 2.44 *consumes* Story 3.18's `runPool` and Story 7.12's `ServiceActions.restart` — hard prerequisites |
| PRD | [!] | **FR-6** amended (optional post-switch restart); new **FR-37** (post-switch restart & verified state); FR-18 amended (health = up / down / restarting, plus *functional* when the manifest declares `healthUrl`) |
| Architecture | [!] | **AD-21** extended: `ServiceActions` gains a post-action *verification* step (`verifyService`), reusable by 5.7/7.5. New small port `HealthProbePort` (HTTP GET, timeout) — driven adapter, `core/` imports no `fetch`/`http` |
| UX | [!] | Switch confirm dialog gains a 3-way "Redémarrer les services" selector; new post-switch **restart report** view (same visual language as the Update status set); UX-DR36: selector keys follow the shared toggle idiom (`←→`/`Space`) |
| Manifest / docs | [!] | New optional `healthUrl` field → `src/core/ports/manifest.ts` schema, **`docs/tui-back-manifest.md`**, **`manifest-generator` skill** (project rule: manifest surface changes update both) |
| Settings | [!] | New `switch.restartMode` (`none` \| `simple` \| `clean`, default `none`) in `:settings`; pre-selects the dialog and is the CLI default. Reuses `update.concurrency`. FR-36 amended |
| Sprint status | [!] | + 1 key (`2-44-…`, backlog) |

### Risks worth naming

- **Which services restart?** Restarting every service on every switch is wasteful and slow. Rule chosen: *only services whose checked-out branch changed during this switch* (`switched` / `adopted` / `discarded` rows) **and** that have a container. Unchanged and container-less services are listed as `skipped` with the reason, never `failed`.
- **"Functional" needs waiting.** A container reports `up` seconds before the app listens. The verification polls `healthUrl` (interval 1 s, overall timeout 30 s, both constants in `core/`, no setting) and reports `functional` on the first 2xx, `unhealthy` on timeout/non-2xx. Without `healthUrl` the best outcome is `up (not verified)` — honest, never a fake "functional".
- **Restart failure must not undo the switch.** The switch is already committed when the restart phase starts; a restart failure is a per-service `failed` row and nothing is rolled back.
- **Hexagonal rule.** HTTP goes through `HealthProbePort`; `core/` stays free of `node:http`/`fetch`.
- **Dependencies are in review.** 3.18 and 7.12 are in `review`; 2.44 must not start before both are merged into their epic branches (otherwise it would re-implement the pool or the restart).

---

## 3. Recommended Approach

**Direct Adjustment** — one new story, in Epic 2 (it extends the switch capability FR-6 and is triggered from the switch dialog), built on two existing foundations. Nothing rolled back.

Effort: **M** (core orchestration S, health probe port + manifest field S, TUI selector + report M, CLI flag S). Risk: **Low–Medium** (the only genuinely new surface is the HTTP probe and the report view).

Suggested order: merge 7.12 and 3.18 → **2.44** → (independent of 5.7, 7.5, 7.6; 7.5's Dashboard can later show the same `functional / unhealthy` badge from `verifyService`).

---

## 4. Detailed Change Proposals

### 4.1 Epics — new Story 2.44 (Epic 2)

**Insert after Story 2.43 in `epics.md`:**

### Story 2.44: EDT Switch — Optional Parallel Service Restart & Verified State

> Added 2026-10-14 (Sprint Change Proposal `sprint-change-proposal-2026-10-14.md`). Amends FR-6, FR-18; adds FR-37. Builds on Stories 2.39/2.41 (switch core and dialog), 2.40 (CLI), 3.18 (`runPool`) and 7.12 (`ServiceActions`). **Prerequisite (blocking):** 3.18 and 7.12 are `done` and merged; otherwise HALT — never re-implement the pool or the restart here.

As a developer, I want to restart my services as part of an EDT switch and see whether each one came back up and answers, so that my containers run the new EDT's code without a second manual step and I immediately know which service needs attention.

**Acceptance Criteria:**

**Given** the switch confirm dialog (TUI) **When** it renders **Then** it shows a selector "Redémarrer les services après le switch" with three values — `(•) Aucun  ( ) Redémarrage simple  ( ) Clean restart` — pre-selected from the setting `switch.restartMode` (default `none`); `←/→`/`Space` change it for this switch only, never written back; the hint names that clean restart falls back to a simple restart where no recipe exists.

**Given** `:settings` **When** the developer picks the post-switch restart choice **Then** `switch.restartMode` is `none` (default), `simple` or `clean`, persisted and applied live; untouched, behaviour is unchanged (FR-36).

**Given** *Aucun* **When** the switch completes **Then** behaviour is exactly today's: no restart, no verification, no new UI.

**Given** *Redémarrage simple* or *Clean restart* **When** the switch itself succeeded **Then** a restart phase starts automatically: the targeted services are those whose branch changed in this switch (`switched` / `adopted` / `discarded` rows) and that declare a container. Every other managed service appears in the report as `skipped` with its reason (`unchanged` / `no container`) — never `failed`.

**Given** the restart phase **When** it runs **Then** targets are processed by `runPool` with `update.concurrency` in flight, each calling `ServiceActions.restart(repoPath, mode)`; two targets on the same repoPath are never concurrent; a worker that throws becomes that service's `failed` row; the run never rejects.

**Given** *Clean restart* and a service **without** a recipe **When** it runs **Then** it restarts simply and its row carries `NO_CLEAN_RECIPE_NOTICE`.

**Given** a restart that returned **When** the service is verified **Then** `ServiceActions.verifyService(repoPath)` reports exactly one closed final state: `functional` (container `up` **and** `healthUrl` answered 2xx), `up-unverified` (container `up`, no `healthUrl` declared), `unhealthy` (container `up`, `healthUrl` timed out or non-2xx), `restarting` (still restarting at timeout), `down`, or `failed` (the restart itself errored, with the error). Verification polls (1 s interval, 30 s overall timeout, constants in `core/`) and settles on the first definitive state.

**Given** the restart phase is running **When** the developer looks at the switch result **Then** per-service rows update live (`pending → restarting → verifying → final state`) with glyph **and** colour (never colour alone), consistent with the Update zone's status set; the TUI stays responsive and the developer may navigate to other zones; the run state is intact on return.

**Given** a restart run in flight **When** the developer starts an update, another switch, or another restart run **Then** it is rejected with a clear message through the existing action lock (same exclusion as Story 3.16, in both directions).

**Given** a restart failure or an `unhealthy` / `down` outcome **When** the run ends **Then** the switch is **not** rolled back; the summary counts functional / up-unverified / unhealthy / down / failed / skipped and lists the non-green services first, each with its detail; the action-log entry (written to the new active EDT) records the mode and every service's final state.

**Given** the CLI `tui-back edt switch <topic> --restart none|simple|clean` (default `none`) **When** run **Then** the same core orchestration runs, rows are emitted in the script output envelope (`restart: [{service, mode, state, detail?}]`), concurrency follows `update.concurrency`, and the exit code is non-zero if any targeted service ended `failed`, `down` or `unhealthy`. An unknown value is rejected before anything is touched.

**Given** the EDT-creation wizard Step 4 (Story 2.38) and the quick-pick switch (Story 2.30) **When** they trigger a switch **Then** they go through the same seam; the story verifies they expose the same selector (or explicitly pass *Aucun*) and documents which.

**Given** a manifest that declares `healthUrl` **When** it is loaded **Then** the value must be a non-blank `http://` or `https://` URL, otherwise validation fails with a precise message; absent = `undefined` (no probe). The probe is a single `GET` with a per-request timeout, issued through `HealthProbePort`.

**Given** the docs **When** updated **Then** `docs/tui-back-manifest.md` documents `healthUrl` (semantics, absent behaviour, example) **and** the `manifest-generator` skill is updated to detect/offer it.

**Implementation notes:**
- Core: new `core/edt/switch-restart.ts` — `restartAfterSwitch({ results, mode, concurrency, serviceActions, onPhase })` (pure orchestration over `runPool`, ports injected, returns `Result<RestartReport>`); `ServiceActions.verifyService` added to `core/service-actions` (uses `DockerPort.getContainerHealth` + `HealthProbePort`). Keep `switchActiveEdt` unchanged: the restart phase is a *second* call made after a successful switch, so the switch's atomicity and its tests are untouched.
- Ports/adapters: `core/ports/health-probe.ts` + `adapters/driven/health/http-probe.ts` (Node `fetch` with `AbortSignal.timeout`).
- Store: a `switchRestart` state (rows + status) in `edt-slice.ts`, set by the switch action and consumed by `switch-dialog.tsx` (results view); live updates via an `onPhase` callback, as `update-slice` does.
- Settings: `switch: { restartMode: 'none' }` group in `core/ports/settings.ts` + a `:settings` control (Story 2.19).
- Manifest: optional `healthUrl` in the zod schema (`core/ports/manifest.ts`).
- Build in this order, one commit each: `HealthProbePort` + adapter → manifest `healthUrl` (+ docs + skill) → `verifyService` → `switch.restartMode` setting → `restartAfterSwitch` over the pool → store + dialog selector → report view → CLI flag.
- Bounded rendering (AD-19): the report goes through `BoundedList`; register any new dialog in `dialog-registry.tsx`.

### 4.2 PRD

- **FR-6** — OLD: "…the tool auto-preserves any uncommitted work in every affected repo of the outgoing EDT before switching." NEW: same, **plus** "The developer may chain a restart of the affected services (none / simple / clean), run in parallel, whose per-service final state (functional, up-unverified, unhealthy, down, failed) is reported (FR-37)."
- **FR-37 (added 2026-10-14)** — Post-switch service restart: optional simple or clean restart of the services whose branch changed, bounded-parallel like the group update, verified per service, never rolling the switch back; default in `switch.restartMode`.
- **FR-36** — add `switch.restartMode` to the list of configurable defaults.
- **FR-18** — OLD: "Service health (up / down / restarting) is visible inline with the log view." NEW: unchanged for Logs; add "a service whose manifest declares `healthUrl` additionally has a *functional / unhealthy* verification available where a restart is reported (FR-37)."

### 4.3 Architecture

- **AD-21** (service action registry) — append: *"`ServiceActions.verifyService(repoPath)` settles a service's post-action state (container health + optional `healthUrl` probe through `HealthProbePort`); the probe is a driven port, never inline HTTP in `core/`."* Binds FR-37, Story 2.44.
- No new AD: the pool is AD-20, the seam pattern is unchanged.

### 4.4 UX

- Switch confirm dialog: new 3-way selector row (UX-DR36 toggle idiom, same as the resolution dialog's "Action par défaut").
- New "restart report" results view in the switch dialog: row = `Service | Mode | État | Détail`, live state glyphs shared with the Update status set (add `functional` / `up-unverified` / `unhealthy` to the closed set, glyph + colour); non-green rows sorted first once the run ends.

### 4.5 Sprint status (`sprint-status.yaml`)

```yaml
  # 2-44 added by sprint-change-proposal-2026-10-14.md. Needs 3-18 and 7-12 merged.
  2-44-edt-switch-optional-parallel-service-restart-verified-state: backlog
```
(inserted after `2-43-…`, before `epic-2-retrospective`).

### 4.6 Manifest surface (project rule)

`healthUrl` is a manifest surface change → `src/core/ports/manifest.ts`, `docs/tui-back-manifest.md` and `.claude/skills/manifest-generator` are all in Story 2.44's scope (listed in its ACs).

---

## 5. Out of scope / decisions deferred

> Scope amendment (approved 2026-10-14): the persisted default `switch.restartMode` is **in** Story 2.44 (it is no longer deferred).

- **Restarting services whose branch did not change** (e.g. to pick up `.env` changes): not offered.
- **Dashboard badge** for the verified state: 7.5 can reuse `verifyService` later; not part of this story.

---

## 6. Implementation Handoff

**Scope: Minor–Moderate** → Product Owner / Developer.

- **Applied on approval (2026-10-14):** story 2.44 in `epics.md`, key in `sprint-status.yaml`, PRD FR-6/FR-18/FR-36/FR-37, AD-21.
- **Developer:** `bmad-build` / create-story for 2.44 once 3.18 and 7.12 are merged; branch `story-2-44-edt-switch-optional-parallel-service-restart-verified-state` from `epic-2-edt-workspace-management`.
- **Success criteria:** switching with *Aucun* is byte-for-byte today's behaviour; with *simple*/*clean* every changed container-bearing service ends in exactly one reported final state; a restart failure never undoes a switch; no `node:http`/`fetch` in `core/`; manifest docs and skill updated; full suite, depcruise and bounded-rendering guard green.
