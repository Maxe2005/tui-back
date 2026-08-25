# Epic 3 Context: Group Update & Migrations

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

A developer can run a group update — pull `development`, run migrations, restart containers — scoped by default to the active EDT's member services, or explicitly against every managed repo regardless of EDT (maintenance mode). When a repo isn't cleanly updatable, the tool auto-resolves already-known-safe cases and otherwise guides the developer through a bounded menu, then re-verifies before continuing; a migration failure is reported per-service (service, migration, error output) and independently re-triggerable without blocking or rolling back services that already succeeded. This epic absorbs and hardens the team's existing `update_repo.sh` / `update-services.sh` / `run_migrations.sh` scripts, whose current three-way stash/editor/cancel prompt is the whole of their error handling today — this epic goes further with an auto-fix-known-safe-cases-first step ahead of that menu, plus a re-verify pass before resuming. The goal is to make "start coding" a single guided action with a structural guarantee that no affected service is silently left out of date.

## Stories

- Story 3.1: Group Update — Pull & Restart (EDT-scoped)
- Story 3.2: Run Migrations as Part of the Group Update
- Story 3.3: All-Repos Maintenance Mode
- Story 3.4: Assisted Resolution of Merge Conflicts / Dirty State
- Story 3.5: Per-Service Migration Failure Handling & Re-Trigger

## Requirements & Constraints

- Default scope is the active EDT's member services; all-repos ("maintenance") mode is always an explicit, separate action — never the default — and requires an explicit confirmation gate before running, since its blast radius extends beyond the active EDT (mirrors today's `update-services.sh` cadence, run by hand roughly every 2–3 days).
- A group update on a non-member repo already on `development` does a plain pull; on a member service on its own feature branch it merges `development` into that branch (`git merge development`, never a rebase — safety-by-default: no rewriting of pushed commits, and an already-applied merge is a no-op on rerun, satisfying script/CLI idempotency).
- A group update triggered on an EDT with zero member services is a no-op with an explicit message — never a silent success.
- Only one group update may run at a time (either scope); a second trigger while one is in progress is rejected.
- Quitting (`q`) while a group update is in progress requires explicit confirmation first; if confirmed, the next launch surfaces that run as interrupted and offers to resume it (same rule applies later to shared-types publish/propagation in Epic 4).
- Every targeted service must appear in the run's outcome summary as updated / skipped / failed — none silently absent. Outcomes are reported per-service, never batched into one pass/fail for the whole run.
- Assisted resolution is a detect → (auto-fix known-safe, else bounded guided menu) → re-verify loop, never a fully automated fixer: if only `package.json`/lockfile is dirty, it resolves silently the same way `update_repo.sh` does today; any other dirty/conflicted state presents a guided menu (stash / open in editor / cancel this repo / cancel the whole run) and blocks that repo until the developer acts. A repo already mid-merge/mid-rebase from a prior interrupted/crashed run is detected and surfaced as its own distinct state before the guided menu applies.
- The tool never resolves real merge-conflict content automatically and never commits, discards, or pushes a developer's changes without that developer's explicit in-the-moment action.
- Migrations run after the pull step and before the restart step, per the manifest's declared `migrationCommand`; a service without one skips this step without error. A migration failure on one service never blocks or rolls back services that already succeeded in the same run. Re-triggering a fixed migration re-verifies success before marking the service caught up. Repeated failures on the same migration surface identically each time — no retry limit or escalation path in v1.
- Success signal to preserve: zero forgotten-service incidents (no service silently left out of date after a group update), and every merge/migration failure resolved through the tool's guided flow without dropping to a separate terminal. Auto-resolution of "known-safe" cases must never trade safety for speed — zero tolerance for silently discarded developer work, even for a case that looks safe. Session-start speed must never be achieved by skipping a migration or health check.
- Explicitly out of scope: no AI-copilot layer that anticipates/auto-fixes errors or automates the git workflow beyond the known-safe-cases-only resolution described above.

## Technical Decisions

- Layering: this epic's logic lives in `core/scripts` (group-update, migrations use-cases), driven by `adapters/driven/process` (spawning `git`/migration commands) and `adapters/driven/git` (branch-scope-safe writes), surfaced through the `tui/update/` zone — one core use-case shared identically by the TUI (in-process call) and the CLI subcommand (script/CLI parity).
- Every git write in this epic's flows passes through the centralized git-adapter from Epic 2 (AD-8), which resolves the allowed-branch context itself and rejects any write not targeting the current EDT's own registered branch for that service — this epic does not re-implement branch-scope safety, it relies on it.
- Any use-case reporting a per-service outcome (the group update itself, and migrations) puts it in `data.results: {service, outcome, detail?}[]`, with `outcome` drawn from the shared closed set `"updated"` / `"skipped"` / `"failed"` (or an equivalent) — one shape every zone/dashboard consumer renders uniformly, per the script output envelope (`{ok,data}` / `{ok,error}`, human text on TTY, single JSON line otherwise).
- If switching the active EDT is attempted while a group update is running on the outgoing EDT, Epic 2's switch flow blocks by default and offers to stop the run so the switch can proceed; returning later to that EDT shows the update as interrupted with an offer to re-run it. This epic's runs must support being flagged/resumed this way.
- Performance: per-service progress spinners running during a group update, potentially alongside a live log stream (Epic 5), fall under the same Ink FPS/memory ceiling risk — debounce/batch mitigation applies; no in-process CPU-heavy work should run synchronously on the TUI event loop, it goes through the CLI's subprocess boundary.

## UX & Interaction Patterns

- Update zone states to implement: idle (last outcome visible), no-op-on-zero-member message, all-repos confirmation gate, second-run-blocked message, in-progress per-service spinner, per-service outcome summary line (updated/skipped/failed, none silently absent), assisted-resolution guided menu (stash / open-in-editor / cancel-repo / cancel-run), mid-merge/mid-rebase as a distinct state (surfaced before the guided menu), migration-failure detail (service, migration, error output) with re-trigger-and-re-verify, and quit-mid-run confirmation with a next-launch interrupted-run resume offer.
- Layout: the zone follows the standard resizable list/detail split (~2:3) — the list pane shows every targeted service with branch + divergence; the detail pane streams per-service progress and settles into the run's outcome summary. Post-group-update, the Update zone stays on the run summary rather than auto-returning to Dashboard (default, but configurable).
- Voice pattern for outcome lines: a dry/factual primary line that stands alone (e.g. "micro-users — migrations ok, container restarted" / "micro-users: migration 0042_add_refund_table failed"), with an optional dim-italic wink annotation beneath it that is never the sole carrier of required information and never folds into the primary line; raw stderr/stack traces stay one action away, never fully hidden by the wink or the summary line.
- The `detail-pane`'s outcome summary uses a `summary-line` divider colored to the run's outcome: success green for a clean run, warning amber for a partial failure, error red for a hard stop.
- The assisted-resolution guided menu and the mid-merge/mid-rebase notice render as `modal-dialog` instances: square-cornered, bold-bordered, `Escape` cancels / `Enter` confirms identically regardless of trigger method.

## Cross-Story Dependencies

- Depends on Epic 1's script output envelope/CLI-TUI parity mechanism and Epic 1's core scaffolding (`core/scripts`).
- Depends on Epic 2's git branch-scope safety gate (AD-8) for every write this epic performs, on Epic 2's active-EDT/member-service model for default scoping, and on Epic 2's switch-blocked/interrupted-run precedent (Story 2.4) which this epic's runs must be compatible with.
- Story 3.1 is a prerequisite for 3.2 (migrations step) and 3.4 (conflict handling plugs into the pull step); 3.5 extends 3.2's migration step with failure handling and re-trigger.
- Story 3.3 (all-repos mode) reuses 3.1's per-service outcome mechanic and 3.1's second-run-blocked rule across both scopes.
- Sets a direct precedent later reused by Epic 4 (`shared-types` publish/propagation): quit-mid-run confirmation plus next-launch resume-offer, and the assisted-resolution detect → auto-fix-or-guided-menu → re-verify mechanic.
