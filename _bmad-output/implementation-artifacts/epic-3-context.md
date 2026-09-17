# Epic 3 Context: Group Update & Migrations

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

This epic lets a developer bring a whole set of services up to date in one guided action — pull latest shared-branch code, run migrations, restart containers — scoped by default to the active EDT's members, with an explicit all-repos maintenance mode, so no service is ever silently left behind and conflicts or migration failures are resolved inside the tool rather than in a separate terminal.

## Stories

- Story 3.1: Group Update — Pull & Restart (EDT-scoped)
- Story 3.2: Run Migrations as Part of the Group Update
- Story 3.3: All-Repos Maintenance Mode
- Story 3.4: Assisted Resolution of Merge Conflicts / Dirty State
- Story 3.5: Per-Service Migration Failure Handling & Re-Trigger

## Requirements & Constraints

- Group update sequence per service is pull → migrate → restart; services without a declared migration command skip the migration step without error.
- Member services on their own branch catch up via merge of the shared branch, never rebase, so a second run with no intervening change is a safe no-op (idempotency).
- End-of-run summary names every targeted service with an outcome from a closed set (updated / skipped / failed); no service may be silently absent.
- Zero-member scope is an explicit no-op message, never silent success. A second run while one is already in progress (either scope) is rejected, never queued or raced.
- All-repos mode is always an explicit, separate action from the default EDT-scoped run and requires a confirmation step given its wider blast radius.
- Failure isolation: one service's conflict or migration failure never blocks or rolls back services that already succeeded; each failure surfaces service, migration/step, and error output, and re-triggering a fixed migration re-verifies before marking the service caught up. No retry limit in v1.
- Assisted resolution loop everywhere: auto-fix known-safe states silently, guide everything else through a bounded menu, always re-verify before resuming. Real conflict content is never auto-resolved; developer changes are never committed or discarded without explicit in-the-moment action.
- Every action is equally runnable from the TUI and as a standalone CLI subcommand with identical effect, using the single-JSON-line output envelope and exit code 0/1 only.

## Technical Decisions

- Capability home is the scripts area in core, rendered by the Update zone; git and process/docker execution live behind driven adapters, with all git writes passing through the central branch-scope safety gate (rejects writes to shared branches or branches outside the active EDT's registration).
- Per-service outcomes share one record shape (`service`, `outcome`, optional `detail`) inside the standard result envelope, so Update and Dashboard render one uniform row type.
- Concurrency is guarded by the per-EDT/repo advisory action lock plus run-in-flight rejection; the TUI calls the same core use-case in-process while the CLI wraps it thinly — the TUI never spawns the CLI.
- Dirty-state detection distinguishes lockfile/package.json-only dirt (auto-resolved per legacy script convention) from any other dirty/conflicted state (guided menu), with an already-mid-merge/mid-rebase repo surfaced as its own distinct state before the menu applies.

## UX & Interaction Patterns

- Update zone states: idle showing last outcome, in-progress per-service spinner, per-service outcome summary, all-repos confirmation gate, second-run-blocked message, zero-member no-op message, quit-mid-run confirmation with interrupted-run resume offer on next launch.
- Conflict guidance is a modal menu (stash / open in editor / cancel this repo / cancel the whole run); cancel-this-repo continues with the rest, cancel-whole-run stops everything.
- Migration failure shows per-service detail with an independent re-trigger action; outcome line stays on the Update zone summary rather than auto-returning elsewhere.
- All messages follow the two-layer voice (dry factual primary line plus optional dim wink line) with glyph always paired with color, and raw error output stays one action away, never hidden.

## Cross-Story Dependencies

- Builds on the manifest-declared identity/migration command, the explicit repo registry, and the git branch-scope gate from earlier epics; 3.1 (pull/restart) precedes 3.2 (migrations in the pipeline), 3.4 and 3.5 add the failure-handling layers on top, and 3.3 reuses the same run mechanic in the wider scope.
- Interacts with EDT switching: a switch is blocked while a group update runs on the outgoing EDT (prompt offers to stop the run; returning later offers to re-run).
