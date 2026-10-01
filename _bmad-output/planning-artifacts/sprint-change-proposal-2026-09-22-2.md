# Sprint Change Proposal — 2026-09-22

**Project:** tui-back
**Trigger:** Design revision of the Update zone's TUI surface, raised by Max while mentally walking through using it.
**Mode:** Incremental (each edit proposal below was reviewed and approved individually with Max)

---

## 1. Issue Summary

The Update zone (Epic 3: Group Update & Migrations) already has a working implementation — Stories 3.1 and 3.2 are `done`, 3.3 and 3.4 are in `review`, 3.5 is in `backlog`. The underlying core use-case (`src/core/scripts/group-update.ts`) is a mature, heavily-tested ~860-line state machine covering pull/merge, migration, container restart, and assisted conflict resolution.

However, when Max projected himself into actually using this zone day-to-day, several gaps became apparent against what the tool's other zones (EDT, Logs) already establish as the baseline UX:

- No permanent left-hand list of services with a live status indicator — unlike the EDT and Logs zones.
- The main update always targets a fixed, non-adjustable scope: every EDT member, merging in the manifest's `sharedBranch`, always migrating, always doing a plain container restart. There is no interface to review or adjust this before a run starts.
- No way to run an update, or a clean restart, scoped to exactly one service.
- No manifest-level concept of a "clean restart" recipe (e.g. `npm i` then `npm run d:up`) — only a plain `docker restart` exists today.
- No live, per-service view of the current step and of problems encountered (resolved vs. unresolved) during a run — only an end-of-run summary.

This is not a bug found while implementing a story — it is a new requirement, uncovered by product-level review of the zone's UX, that expands the scope of Epic 3 beyond its original FR-10/FR-11/FR-12 design.

## 2. Impact Analysis

### Epic Impact

- **Epic 3 (Group Update & Migrations)** cannot be completed as originally scoped. Stories 3.1 and 3.2 — already `done` — encode a fixed-behavior update (no service/branch selection, no toggles) that must be amended in place. Story 3.3 (all-repos, in `review`) needs a small amendment to reuse the new configuration screen. Story 3.4 (assisted resolution, in `review`) needs no functional change, only a compatibility note (it now renders in front of the new live per-service detail pane instead of a blank backdrop). Story 3.5 (per-service migration re-trigger, `backlog`, never started) is superseded and folded into two new stories rather than implemented standalone.
- Six new stories (3.6–3.11) are added to Epic 3 to cover: the service-list/live-status shell, the shared pre-run configuration screen, the manifest-defined clean-restart recipe (schema + new port), per-service quick actions, live per-service run tracking, and the three dedicated update commands.
- No other epic is invalidated or needs resequencing. Epic 5's Story 5.3 (`inline-service-health-restart-control`, in `review`) already introduced the `up`/`down`/`restarting` `HealthState` in the Logs zone — the new Update-zone states (`updating`/`migrating`/`error`) extend this same closed-set pattern rather than inventing a parallel one. This is a coordination point, not a conflict.

### Story Impact

See Section 4 for the full before/after text of every amended and new story (3.1, 3.2, 3.3, 3.4, 3.5, and new 3.6–3.11).

### Artifact Conflicts

- **PRD:** FR-10 amended (service/branch selection, migrate/restart toggles, single-service scope); FR-12 amended (cross-reference to the new single-service re-trigger action); three new FRs added — FR-25 (pre-run configuration), FR-26 (manifest-defined clean restart), FR-27 (live per-service status and detail). FR numbering follows the existing project convention of appending new FRs at the next free number (the PRD already does this for FR-24) rather than renumbering the sequential block.
- **Architecture:** AD-4 (manifest schema) amended to add an optional `restartCommands` field. A new AD-16 introduces a dedicated `RestartPort`, mirroring `MigrationPort`'s shape, rather than overloading `ContainerPort` or reusing `MigrationPort` under a mismatched name. The ports list and driven-adapter directory listing in the source-tree diagram are updated accordingly. `group-update.ts` will need a substantial refactor to accept per-service selection, per-service branch override, and the two run-wide toggles — flagged for the developer agent, not designed line-by-line here.
- **UX:** `EXPERIENCE.md`'s Information Architecture row and the full "Update" state table are rewritten to reflect the service list, configuration screen, clean-restart step, and per-service quick actions. The `key-update-run.html` mockup is now stale (no config screen, no service list) — flagged as a follow-up task for the UX designer agent rather than redrawn here without visual iteration.

### Technical Impact

- Core: new `RestartPort` + driven `restart/` adapter; `Manifest`/`ManifestPort` gains `restartCommands`; `group-update.ts` gains parameters for service selection, per-service branch override, migrate toggle, and restart-kind toggle; a new lightweight use-case (or an extension of the existing one) for a standalone single-service clean restart / update.
- TUI: `update-zone.tsx` is largely rebuilt — a list/detail shell (mirroring `edts-zone.tsx`/`logs-zone.tsx`), a new configuration screen component (reusable across the three trigger commands), and an extended store slice for live per-service run tracking.
- CLI: the `tui-back update` wrapper's call site must follow the core use-case's new signature even though no new CLI flags were requested — it cannot silently keep calling the old shape.
- Secondary: the `manifest-generator` skill should learn about `restartCommands` so it keeps proposing complete manifests; test coverage grows across core (manifest loader, new port, refactored use-case) and TUI (new screens) per the project's existing AD-13 testing conventions.

## 3. Recommended Approach

**Direct Adjustment (Option 1)**, approved by Max.

- Stories 3.1/3.2, though `done`, are cheap to amend: their branch has not yet been merged into `devlopment` (only into the epic branch, per the project's git workflow), and the core merge/conflict-resolution logic they built is retained and extended, not discarded.
- Rollback (Option 2) was rejected: the ~860-line merge/conflict state machine is well-tested and directly reusable — the new requirement layers configuration on top of it, it does not replace it.
- An MVP/scope review (Option 3) was rejected: no PRD core goal or MVP boundary changes — this is a scope expansion within Epic 3's existing FR family (FR-10–FR-12, extended by FR-25–FR-27), not a strategic pivot.

Effort: **High** (core refactor + new port/manifest field + multiple new TUI screens + new tests). Risk: **Medium** — the main risk is regressing Story 3.4's assisted-resolution state machine (still in `review`) while threading the new per-service selection/branch/toggle parameters through `group-update.ts`; sequencing the new stories so the shell/config work (3.6–3.7) lands before the `group-update.ts` refactor is touched again reduces that risk.

## 4. Detailed Change Proposals

All of the following were presented and approved individually with Max during this session.

### 4.1 PRD (`_bmad-output/planning-artifacts/prds/prd-tui-back-2026-08-10/prd.md`)

**FR-10 — amended:**

OLD:
> A developer can run a group update — pull `development`, run migrations, restart containers — against either the active EDT's member services (default) or explicitly against all managed repos regardless of EDT (maintenance mode, preserving today's `update-services.sh` usage pattern, roughly every 2–3 days).
>
> Consequences: all-repos always explicit + confirmed; end-of-run summary accounts for every targeted service; zero-member EDT is a no-op; second run rejected in either scope.

NEW:
> A developer can run a group update — pull/merge the update, run migrations, restart containers — against the active EDT's member services (default), explicitly against all managed repos regardless of EDT (maintenance mode), or against exactly one service.
>
> Consequences: all-repos always explicit + confirmed; **before any of the three run kinds starts, the developer reviews and can adjust its scope and settings through one shared configuration interface (FR-25)** — which services are included, which branch each brings in, whether migrations run, and whether a clean restart (FR-26) replaces the plain container restart; end-of-run summary accounts for every targeted service; zero-member EDT is a no-op; second run rejected in any scope.

**FR-12 — amended (added consequence):**
> The re-trigger action is available directly from the affected service's own row/detail view in the Update zone, using the same single-service configuration interface as a full single-service update (FR-25) — no separate flow to remember.

**FR-25 — new: Configure a group update before it runs** (service selection, per-service source branch defaulting to `sharedBranch`, migrate toggle, clean-restart toggle — shared by the EDT-scoped, all-repos, and single-service triggers).

**FR-26 — new: Manifest-defined clean restart** (an ordered command recipe per repo, falls back to a plain container restart when absent, failing command reported as that service's failure detail, independently triggerable standalone).

**FR-27 — new: Live per-service status and detail in the Update zone** (always-visible status list — up/down/restarting/updating/migrating/error — current step and resolved/unresolved problems shown per service).

*(Full text of each amended/new FR as drafted and approved appears in the session transcript; reproduced in full in the PRD file itself once applied.)*

### 4.2 Epics (`_bmad-output/planning-artifacts/epics.md`, Epic 3)

- **Story 3.1** amended: the configuration interface (3.7) opens before the run; the merge source is the configured per-service branch, not a fixed `sharedBranch`; restart honors the clean-restart toggle; a deselected service is never targeted.
- **Story 3.2** amended: migration only runs when the run's migrate toggle is on, overriding manifest declaration rather than just defaulting it.
- **Story 3.3** amended: the configuration screen (3.7) opens first, pre-selecting every managed repo, followed by all-repos' own blast-radius confirmation.
- **Story 3.4**: no AC change — a compatibility note added (renders in front of the new live per-service detail pane).
- **Story 3.5**: marked **Superseded** — its guarantees are split into Story 3.10 (issue surfacing) and Story 3.9 (re-trigger action).
- **Story 3.6 (new):** Update Zone Shell — Service List & Live Status.
- **Story 3.7 (new):** Pre-Run Configuration Interface.
- **Story 3.8 (new):** Manifest-Defined Clean-Restart Recipe.
- **Story 3.9 (new):** Per-Service Actions — Clean Restart & Single-Service Update.
- **Story 3.10 (new):** Live Per-Service Run Tracking — Current Step & Issue Log.
- **Story 3.11 (new):** Update Commands — Main, All-Repos, Single-Service.

*(Full Given/When/Then text for every amended and new story as drafted and approved appears in the session transcript; reproduced in full in `epics.md` once applied.)*

### 4.3 Architecture (`_bmad-output/planning-artifacts/architecture/architecture-tui-back-2026-08-11/ARCHITECTURE-SPINE.md`)

- Source-tree diagram: `ports/` gains `RestartPort`; `adapters/driven/` gains a `restart/` directory.
- **AD-4** amended: manifest gains optional `restartCommands` (ordered shell-command list), falling back to plain container restart when absent.
- **AD-16 (new):** clean restart is a dedicated `RestartPort` (shaped like `MigrationPort`, run once per declared command, stop on first failure), never overloading `ContainerPort` or reusing `MigrationPort` under a mismatched name.

### 4.4 UX Design (`_bmad-output/planning-artifacts/ux-designs/ux-tui-back-2026-08-10/EXPERIENCE.md`)

- Information Architecture row for "Update" rewritten to describe the service list, configuration screen, and per-service quick actions.
- The full "Update" state table rewritten: new rows for the always-visible service list, the configuration screen, the clean-restart step, and per-service quick actions; existing rows (no-op, all-repos gate, second-run-blocked, assisted-resolution menu, mid-merge/mid-rebase, migration failure) amended in place to reference the new mechanics without losing any existing guarantee.
- `DESIGN.md`'s `key-update-run.html` mockup flagged as stale — a follow-up task for the UX designer agent, not redrawn in this proposal.

## 5. Implementation Handoff

**Scope classification: Moderate** — this stays within Epic 3's existing structure (no new epic, no PRD MVP change) but requires backlog reorganization (new stories, amended acceptance criteria on stories already `done`/in `review`) before implementation resumes.

**Routed to:**

- **Product Owner / Developer (bmad-agent-dev, via `bmad-build`):** implement Stories 3.6→3.11 in that dependency order (shell → configuration screen → manifest/port → per-service actions → live tracking → commands), then re-verify Stories 3.1/3.2/3.3 against their amended acceptance criteria, then confirm Story 3.4 still passes unchanged behind the new shell.
- **UX Designer (bmad-agent-ux-designer / Sally):** produce a new mockup for the configuration screen and the service-list shell, replacing the stale `key-update-run.html`, before or alongside Story 3.6/3.7 implementation.

**Success criteria:**
- Every amended/new FR (FR-10, FR-12, FR-25, FR-26, FR-27) and story (3.1–3.11) acceptance criteria pass.
- No regression in the existing merge/conflict-resolution test suite for `group-update.ts`.
- The manifest loader accepts `restartCommands` and falls back correctly when absent.
- `sprint-status.yaml` updated to reflect the new/amended story set (Section 6.4 of the correct-course checklist).

---

*Generated via the `bmad-correct-course` workflow, incremental mode — every change above was reviewed and individually approved with Max before being compiled into this proposal.*
