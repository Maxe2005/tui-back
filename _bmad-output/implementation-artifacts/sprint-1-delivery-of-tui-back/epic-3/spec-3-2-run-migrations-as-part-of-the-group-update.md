---
title: 'Run Migrations as Part of the Group Update'
type: 'feature'
created: '2026-09-17'
status: 'done'
baseline_commit: '9ad60aef0f1557446cae7be54a6b4af1352f5ecc'
review_loop_iteration: 0
context: [_bmad-output/implementation-artifacts/epic-3-context.md]
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 3.1 brings member services up to date on code and restarts containers, but migrations never run, so services are not fully caught up.

**Approach:** Extend the existing group-update use-case so each targeted service runs its manifest-declared `migrationCommand` after the pull/merge step and before the container restart, skipping cleanly when no command is declared.

## Boundaries & Constraints

**Always:** All core returns are `Result<T>` with kebab-case error codes (AD-3). Core never imports from adapters (AD-1); relative imports end in `.js` with imports-first-in-file. Per-service order is strictly pull/merge → migrate → restart; every targeted service appears in `data.results` as `updated`/`skipped`/`failed` — none silently absent. One service's migration failure never blocks or rolls back the others. Merge stays `git merge`, never rebase; `assertAllowedBranch` gating is unchanged.

**Ask First:** If executing `migrationCommand` needs anything beyond a non-interactive child-process spawn with captured stdout/stderr (e.g. TTY passthrough, interactive stdin, shell-specific syntax beyond `sh -c`), HALT and ask before proceeding.

**Never:** No all-repos mode or `--all` flag (story 3.3 — bare `update` still rejects flags). No change to dirty/conflict detect-and-report behavior (story 3.4). No standalone per-service migration re-trigger command and no retry-limit/escalation logic (story 3.5 — a failed migration here is a `failed` row plus detail only). No AI-copilot behavior.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Migration runs | Member clean, pull/merge ok, manifest declares `migrationCommand` | Command runs after pull/merge, before restart; success → `updated` | N/A |
| No migrations | Member has no `migrationCommand` | Migration step skipped without error; success → `updated` | N/A |
| Migration fails | Command exits non-zero | Repo stays on merged code, restart skipped → `failed` with `migration-failed` detail (service, command, error output) | Others continue |
| Pull/merge failed or dirty | `skipped`/`failed` before migrate phase | Migration never runs for that service | Row keeps its earlier code |
| Restart fails | Migrate ok, `container.restart` fails | → `failed` with restart detail | Others unaffected |
| Zero members / no active EDT / second run | Same as 3.1 | Same no-op / `no-active-edt` / `update-already-running` behavior | N/A |

</frozen-after-approval>

## Code Map

- `src/core/scripts/group-update.ts:62` — the 3.1 use-case to extend; entry `groupUpdate()`, zero-member no-op `84-91`, lock nesting global-then-`edt:<ulid>` `93-94`, per-member `updateMember() 150-238` (manifest load `159`, branch-mismatch guard `174-182`, dirty gate `189-193`, pull `197` vs fetch `209` + `assertAllowedBranch 214` + `mergeBranch 218`, conflict abort `243-256`, restart `227`); insert migrate phase between merge and restart.
- `src/core/ports/manifest.ts:6-15` — `Manifest.migrationCommand?: string`; schema `src/adapters/driven/manifest/schema.ts:22` (`min(1).optional()`), loader `src/adapters/driven/manifest/index.ts:18-67`; `group-update.ts:159-163` currently ignores the field — read it here.
- `src/core/ports/container.ts:7-10` — template for the new port (`Result<void>`, kebab-case); new `src/core/ports/migration.ts` (e.g. `run(repoPath, command): Promise<Result<{output}>>`) implemented by new `src/adapters/driven/migration/index.ts` via `spawnSync` in the style of `src/adapters/driven/git/index.ts:25,137-538` and `src/adapters/driven/container/index.ts:7,28-46` (exit-code taxonomy, `spawnFailureDetail`, flag-injection guard).
- `src/adapters/driving/cli/subcommands.ts:132-147` — `update` bare-only entry (`invalid-argument` on any flag); extend the `groupUpdate({...})` call `139-146` with the migration port; no new flags.
- `src/bin/main.ts:22-58` + `src/bin/tui.ts:79-118` — composition roots instantiating `git 33/91`, `container 34/92`; add the migration port beside them and thread through `buildSubcommands` and `createAppStore 106-118`.
- `src/adapters/driving/tui/store/slices/update-slice.ts:51-111` — in-process `runGroupUpdate` calling the use-case `82-89` (AD-2); thread the migration port through deps; zone `src/adapters/driving/tui/zones/update/update-zone.tsx:148-203` renders per-service rows via `formatUpdateRow 37-52` — extend row/summary wording for the migrate phase without new UI patterns.
- Tests: `src/core/scripts/group-update.test.ts:1-713` fake-port matrix pattern (`fakeManifest 35`, `fakeGit 42`, `fakeContainer 67` — add `fakeMigration` the same way); `src/adapters/driven/container/index.test.ts:24-34` stub-executable pattern for the new adapter; `src/bin/tui-back.e2e.test.ts:1330-1522` black-box `update` fixtures (`makeBehindMember`, `makeDockerStub`) — add migration stub + failing-migration case.

## Tasks & Acceptance

**Execution:**
- [x] `src/core/ports/migration.ts` (new) + `src/adapters/driven/migration/index.ts` (new) -- `run` port + `spawnSync` implementation with kebab-case error taxonomy; adapter integration test with a stubbed executable.
- [x] `src/core/scripts/group-update.ts` (+ `group-update.test.ts` vs fake ports) -- pull/merge → migrate → restart per member; skip when no `migrationCommand`; migration failure → `failed` with `migration-failed` detail, restart skipped, others continue; unit-test every I/O-matrix row.
- [x] `src/adapters/driving/cli/subcommands.ts` (+ `src/bin/main.ts`, `src/bin/tui.ts` wiring) -- thread the migration port into the `update` path; keep bare-`update`-only arg rejection; extend `src/bin/tui-back.e2e.test.ts` (migration success, skip, failure isolation).
- [x] `src/adapters/driving/tui/store/slices/update-slice.ts` (+ `update-zone.tsx`) -- thread the migration port through the in-process call; surface the migrate phase in per-service progress/rows and the outcome summary; no new zone patterns.

**Acceptance Criteria:**
- Given a member with `migrationCommand` declared and clean pull/merge, when `tui-back update` runs non-TTY, then the command ran before restart and the service is `updated` with exit code 0.
- Given a member without `migrationCommand`, when the update runs, then the migration step is skipped without error and the service still reports `updated`.
- Given a failing migration on one member, when the run completes, then that service is `failed` with migration detail (service, command, error output), its restart was skipped, and every other service still reports its own outcome.
- Given a dirty or conflicted member, when the run completes, then its migration never ran and its row keeps the earlier `skipped`/`failed` code.

## Spec Change Log

## Design Notes

Phase ordering inside `updateMember`: `currentBranch` → pull-or-merge (3.1, unchanged) → if `migrationCommand` present then `migration.run(repoPath, command)` → only on migrate success then `container.restart`. Any failure short-circuits the remaining phases for that service only. The `failed` detail for migrations carries `{service, command, output}` so story 3.5 can later add the standalone re-trigger on top of the same shape.

## Verification

**Commands:**
- `npm test && npm run typecheck && npm run depcheck` -- expected: all green (AGENTS.md order).
- `node src/bin/cli-back.mjs update` (pipe) -- expected: single JSON line, exit 0/1 only.

## Suggested Review Order

**Core use-case**

- Entry point: migrate-phase params threading and per-member loop
  [`group-update.ts:62`](../../../src/core/scripts/group-update.ts#L62)

- Per-member flow: migrate between pull/merge and restart, failure short-circuits
  [`group-update.ts:238`](../../../src/core/scripts/group-update.ts#L238)

- New port surface: single `run` contract returning trimmed output
  [`migration.ts:8`](../../../src/core/ports/migration.ts#L8)

**Driven adapter**

- Non-interactive `sh -c` spawn with never-throw guard and exit taxonomy
  [`index.ts:25`](../../../src/adapters/driven/migration/index.ts#L25)

**Driving adapters and wiring**

- Bare `update` subcommand passes the migration port, still rejects flags
  [`subcommands.ts:134`](../../../src/adapters/driving/cli/subcommands.ts#L134)

- Migration port instantiated in both composition roots
  [`main.ts:36`](../../../src/bin/main.ts#L36)

- In-process run requires the migration port before starting
  [`update-slice.ts:52`](../../../src/adapters/driving/tui/store/slices/update-slice.ts#L52)

**Tests**

- Full migrate-phase matrix against fake ports with strict ordering
  [`group-update.test.ts:573`](../../../src/core/scripts/group-update.test.ts#L573)

- Black-box failing-migration isolation with command and output in detail
  [`tui-back.e2e.test.ts:1524`](../../../src/bin/tui-back.e2e.test.ts#L1524)
