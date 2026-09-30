---
title: 'Manifest-Defined Clean-Restart Recipe'
type: 'feature'
created: '2026-09-24'
status: 'done'
baseline_commit: '87f23e8e1f41c3aff1206ef5db0dad7030247e79'
review_loop_iteration: 0
context: [_bmad-output/implementation-artifacts/epic-3-context.md]
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A group update (or any one-off trigger) can only perform a plain container restart, so services that need a fuller clean restart (reinstall, compose up) have no way to declare it — Story 3.7's clean-restart toggle still falls through to a plain restart today.

**Approach:** The manifest gains an optional ordered `restartCommands` recipe; a new `RestartPort` shaped like `MigrationPort` executes it in the repo's working directory, stopping on the first failure; core picks the recipe when the clean-restart toggle calls for it and falls back to the plain container restart otherwise.

## Boundaries & Constraints

**Always:** All core returns are `Result<T>` with kebab-case error codes (AD-3). Core never imports from adapters (AD-1); relative imports end in `.js` with imports-first-in-file. The recipe runs in declared order in the repo's working directory, stopping on the first failing command. A failing command is reported as that service's failure detail (service, which command, error output) — the same per-service failure reporting FR-12 guarantees for migrations. Absent recipe falls back to today's plain container restart without error. Never both `RestartPort` and `ContainerPort.restart` for the same service in the same action. Other services in the same run are never blocked or rolled back by one service's restart failure.

**Ask First:** If blank recipe entries should be handled differently from `migrationCommand`'s present-but-blank rejection; if stopping-on-first-failure needs adapter-side orchestration rather than a core loop over a single-command `RestartPort`; if the CLI wrapper needs anything beyond following the new signature with defaults — HALT and ask before proceeding.

**Never:** No TUI per-service trigger UI (Story 3.9), no live per-step tracking (Story 3.10), no new CLI flags. No change to the pull/merge/migrate phases or their tests. No change to `ContainerPort.restart`'s signature. No change to the Update zone or config screen — the clean-restart toggle already exists from Story 3.7.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Recipe declared | Manifest with valid `restartCommands` list | Loader accepts, recipe exposed to core | N/A |
| No recipe | Manifest without `restartCommands` | Treated as absent (`undefined`), never an error | N/A |
| Blank entry | Recipe containing a blank string | `manifest-validation-failed` naming `restartCommands` (mirrors `migrationCommand`) | Loader rejects before any run |
| Clean restart + recipe | `cleanRestart` on, recipe declared | Each command runs in repo cwd in order; first failure stops the recipe | `failed` row with service, which command, error output; others continue |
| Clean restart, no recipe | `cleanRestart` on, recipe absent | Plain container restart, no error | Container failure reported as today |
| Toggle off | `cleanRestart` off, recipe declared | Plain container restart; recipe untouched | N/A |
| Repeated failure | Same recipe failing across runs | Surfaced identically each time — no retry limit in v1 | N/A |

</frozen-after-approval>

## Code Map

- `src/core/ports/manifest.ts:6-12` — `Manifest` interface; add `restartCommands?: string[]` beside `migrationCommand`.
- `src/adapters/driven/manifest/schema.ts:17-26` — `createManifestSchema`; insert `restartCommands: z.array(z.string().trim().min(1)).optional()` beside `:22`; `.strict()` and `superRefine` need no other change; loader `src/adapters/driven/manifest/index.ts:18-67` unchanged.
- `src/adapters/driven/manifest/index.test.ts:87-119` — absent→`undefined` and blank→`manifest-validation-failed` precedents to mirror for the new field.
- `src/core/ports/migration.ts:8-12` — `MigrationPort.run(repoPath, command)` shape to mirror; new `src/core/ports/restart.ts` with `RestartPort.run(repoPath, command): Promise<Result<{output: string}>>`, non-zero/unspawnable → kebab-case failure, never throws.
- `src/adapters/driven/migration/index.ts:14-50` — `createMigrationPort` (`spawnSync(shell, ['-c', command], {cwd: repoPath})`, output capture, error taxonomy) as the implementation model; new `src/adapters/driven/restart/index.ts` following the same pattern.
- `src/core/scripts/group-update.ts:136-138,582,733-743` — `cleanRestart` param ("still plain restart until 3.8"); `updateWithLoadedManifest` destructures the manifest at `:582` and runs `container.restart` at `:735-736`; branch here on `cleanRestart` + recipe presence, looping the recipe via the new port.
- `src/core/scripts/group-update.test.ts` — fake-port matrix to extend (recipe success, mid-recipe failure stops the loop, absent-recipe fallback, toggle-off ignores recipe).
- `src/bin/main.ts:35-61` + `src/adapters/driving/cli/subcommands.ts:43-55,152-186` + `src/bin/tui.ts:79` — composition roots wiring `container`/`migration` into `groupUpdate`; wire the new port identically at each call site with no new flags.

## Tasks & Acceptance

**Execution:**
- [x] `src/core/ports/manifest.ts` + `src/core/ports/restart.ts` -- add `restartCommands?: string[]` to `Manifest`; new `RestartPort` mirroring `MigrationPort` -- contract both layers build against.
- [x] `src/adapters/driven/manifest/schema.ts` (+ `index.test.ts`) -- zod-validate the optional ordered list; unit-test absent→`undefined` and blank-entry rejection.
- [x] `src/adapters/driven/restart/index.ts` (+ integration test in the existing driven-adapter style) -- `spawnSync` in repo cwd, output capture, kebab-case failure codes, never throws.
- [x] `src/core/scripts/group-update.ts` (+ `group-update.test.ts` vs fake ports) -- accept the new port, branch the restart phase on `cleanRestart` + recipe presence, stop-on-first-failure with per-service failure detail; unit-test every matrix row without regressing merge/conflict/migration tests.
- [x] `src/bin/main.ts` + `src/adapters/driving/cli/subcommands.ts` (+ `src/bin/tui.ts`, `src/bin/tui-back.e2e.test.ts`) -- wire the new port at every `groupUpdate` call site with unchanged defaults; black-box a recipe run and a fallback run.

**Acceptance Criteria:**
- Given a repo manifest declaring `restartCommands`, when loaded, then it validates and the ordered recipe reaches core; when absent, then the manifest still validates and the service is treated as having no recipe.
- Given a clean restart requested for a service with a recipe, when it runs, then each command executes in the repo's working directory in declared order, and a failing command stops the recipe and surfaces service, which command, and error output.
- Given a clean restart requested for a service without a recipe, when it runs, then it falls back to the plain container restart without error.
- Given one service's clean restart fails, when the run continues, then already-succeeded services are neither blocked nor rolled back.

## Spec Change Log

## Design Notes

`RestartPort` takes a single command (`run(repoPath, command)`), exactly like `MigrationPort` — core owns the loop over the declared array and the stop-on-first-failure decision, so the "never both ports for the same service in the same action" rule stays a core-side branch, not an adapter-side guess. Per the spine: core decides — `RestartPort` when `restartCommands` is declared and the run's clean-restart toggle (or Story 3.9's standalone trigger) calls for it, `ContainerPort.restart` otherwise.

## Verification

**Commands:**
- `npm test && npm run typecheck && npm run depcheck` -- expected: all green (AGENTS.md order).
- `node src/bin/tui-back.mjs update` (pipe) -- expected: single JSON line, exit 0/1 only.

## Suggested Review Order

**Restart decision (entry point)**

- Core owns the recipe-vs-plain branch, never both ports per service
  [`group-update.ts:741`](../../../src/core/scripts/group-update.ts#L741)

- Single-command port keeps loop and stop-on-first-failure core-side
  [`restart.ts:10`](../../../src/core/ports/restart.ts#L10)

**Contract and manifest**

- Optional ordered recipe beside migrationCommand, absent stays undefined
  [`manifest.ts:10`](../../../src/core/ports/manifest.ts#L10)

- Zod validation mirrors migrationCommand blank rejection
  [`schema.ts:23`](../../../src/adapters/driven/manifest/schema.ts#L23)

- Injectable shell with repo cwd and kebab-case failures, never throws
  [`index.ts:25`](../../../src/adapters/driven/restart/index.ts#L25)

**Threading**

- Both CLI scopes pass the new port, no new flags
  [`subcommands.ts:159`](../../../src/adapters/driving/cli/subcommands.ts#L159)

- Missing-port guard extended, store degrades explicitly
  [`update-slice.ts:393`](../../../src/adapters/driving/tui/store/slices/update-slice.ts#L393)

**Peripherals**

- Recipe matrix plus all-scope and repeated-failure coverage
  [`group-update.test.ts:1988`](../../../src/core/scripts/group-update.test.ts#L1988)

- Adapter integration against stub and real shell
  [`index.test.ts:48`](../../../src/adapters/driven/restart/index.test.ts#L48)

- Black-box fallback and recipe-untouched runs
  [`tui-back.e2e.test.ts:1909`](../../../src/bin/tui-back.e2e.test.ts#L1909)
