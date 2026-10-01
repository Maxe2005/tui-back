# Epic 3 Context: Group Update & Migrations

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

A developer can run a group update (pull, migrate, restart) scoped to the active EDT, to all managed repos, or to a single service — configured beforehand (service selection, per-service branch, migrate/clean-restart toggles) and followed live per-service — with assisted resolution of conflicts and migration failures. This absorbs and hardens the legacy `update_repo.sh` / `update-services.sh` / `run_migrations.sh` scripts into one reliable, observable, TUI-native flow.

**Note:** a 2026-09-22 correct-course reworked this epic's UX after 3.1–3.4 had already reached `done`/`review`: 3.1–3.3 amended in place; 3.5 superseded and split into 3.9/3.10; 3.6–3.11 new. `epics.md` is authoritative for current acceptance criteria.

## Stories

- Story 3.1: Group Update — Pull & Restart (EDT-scoped) — amended
- Story 3.2: Run Migrations as Part of the Group Update — amended
- Story 3.3: All-Repos Maintenance Mode — amended
- Story 3.4: Assisted Resolution of Merge Conflicts / Dirty State
- Story 3.5: Per-Service Migration Failure Handling & Re-Trigger — **Superseded** by 3.9 + 3.10
- Story 3.6: Update Zone Shell — Service List & Live Status
- Story 3.7: Pre-Run Configuration Interface
- Story 3.8: Manifest-Defined Clean-Restart Recipe
- Story 3.9: Per-Service Actions — Clean Restart & Single-Service Update
- Story 3.10: Live Per-Service Run Tracking — Current Step & Issue Log
- Story 3.11: Update Commands — Main, All-Repos, Single-Service

## Requirements & Constraints

- Every run (EDT-scoped default, explicit all-repos, or single-service) opens one shared pre-run config screen first: service checklist (pre-selected per scope), per-service source branch (defaults to manifest `sharedBranch`, overridable), and two run-wide toggles — migrate, clean restart — applied uniformly to all selected services (no per-service override in v1). Deselecting a service excludes it entirely; zero-selection confirm is rejected with an explicit message.
- End-of-run summary accounts for every targeted service by outcome (updated / skipped / failed), never silently absent. A second run is rejected while one is in progress, per scope and also per single service.
- Dirty/conflicted repo handling: lockfile-only dirt auto-resolves silently; anything else opens a guided menu (stash / open in editor / cancel this repo / cancel the whole run) and blocks until acted on; state is always re-verified after, never assumed; a repo already mid-merge/mid-rebase from a prior interrupted run is surfaced as its own distinct case first.
- A migration failure on one service never blocks/rolls back others already succeeded in the same run; re-trigger after a fix re-verifies before marking caught up; repeated failures surface the same way each time (no retry limit in v1).
- Clean restart: manifest may declare an ordered `restartCommands` recipe; absent falls back to a plain container restart without error; a failing command stops the recipe and reports as that service's failure detail. Independently triggerable per service outside any run.
- The Update zone's service list (EDT members first, then others) is always visible with a status from the closed set up / down / restarting / updating / migrating / error — never blank or generic. During a run the selected service's detail pane shows its live step and any problem (resolved/unresolved); after, it reverts to a last-outcome view.
- Quitting (`q`) mid-run requires explicit confirmation; confirming surfaces the run as interrupted on next launch with a resume offer.
- Three distinct commands (main, all-repos, single-service), each with its own keybinding, all open the same config screen pre-scoped to their target.

## Technical Decisions

- Git writes stay behind the existing branch-scope-safety git adapter; merge (never rebase) into the service's own branch, for safety and idempotency.
- Clean restart is a new `RestartPort`, shaped like `MigrationPort` (repoPath + one command in, output/failure out), run once per declared command in order, stopping on first failure — never layered onto `ContainerPort.restart` or reused as a mismatched `MigrationPort`.
- Manifest schema gains optional `restartCommands: string[]`, zod-validated, non-blocking when absent (same posture as `migrationCommand`).
- `group-update.ts` (existing, heavily-tested) is extended, not replaced, with per-service selection, branch override, and the two toggles; its merge/conflict-resolution logic and tests must not regress. Build order: shell → config screen → manifest/port → per-service actions → live tracking → commands, before touching this use-case again.
- Per-service outcomes report through the shared `data.results: {service, outcome, detail?}[]` shape, closed `outcome` set (`updated`/`skipped`/`failed`).
- CLI and TUI call the identical core use-case in-process; the CLI wrapper's call site must follow the new signature even with no new CLI flags requested.
- Live run state lives in the central Zustand store; zone-local UI state stays component `useState`. Testing: core/new port unit-tested against fake ports; TUI screens get Ink smoke-tests only.

## UX & Interaction Patterns

- Same list/detail split as the EDT and Logs zones, with the standard resizable splitter.
- Status is always glyph + semantic color, never color alone; the new `updating`/`migrating`/`error` states extend the closed-set status pattern Epic 5 Story 5.3 introduced for `up`/`down`/`restarting` — keep vocabulary consistent, don't invent a parallel one.
- The config screen reuses the existing multi-select checkbox row pattern (`[ ]`/`[x]`) with inline per-service branch fields and the two toggles.
- The guided conflict-resolution menu is a blocking `modal-dialog`, now rendering in front of the live per-service detail pane instead of a blank backdrop.
- After a run, the Update zone stays on the run summary rather than auto-returning to Dashboard (default, configurable).
- `key-update-run.html` predates this rework and is stale (no config screen, no service list); a replacement is a pending UX-designer follow-up, not yet available.

## Cross-Story Dependencies

- Build order: 3.6 → 3.7 → 3.8 → 3.9 → 3.10 → 3.11, then re-verify 3.1–3.3 against amended ACs, then confirm 3.4 still passes behind the new shell/pane.
- 3.1–3.3 depend on 3.7's config screen existing first.
- 3.9's single-service update reuses 3.7 pre-scoped to one service; its clean-restart depends on 3.8's `RestartPort`/fallback.
- 3.10's live pane is what 3.4's guided menu now renders in front of, and where 3.5's superseded issue-surfacing guarantee now lives.
- 3.11's commands depend on 3.7, plus respectively 3.1 (main), 3.3 (all-repos), or 3.9 (single-service).
