---
title: 'Heal Use-Case & CLI — Restart Services That Are Not Up'
type: 'feature'
created: '2026-11-05'
status: 'done'
baseline_commit: '2fa5781b2748fa9f05ffaafc553ec6fd3bb261ff'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-9-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** When several active-EDT services crash or get stuck, the developer has to find and restart them one by one. Scripts cannot do it either: no use-case restarts "everything that is not up".

**Approach:** Add a pure `core/heal` use-case. It plans targets from the Story 9.7 resolver: `down` or `unhealthy` services that declare a container. It runs them through a target-list entry point extracted from `restartAfterSwitch`'s pool. Expose it as `tui-back heal [--restart simple|clean]`, with a new `dashboard.restartMode` setting (default `simple`).

## Boundaries & Constraints

**Always:**
- Statuses come only from `resolveServiceStatus`. Heal never combines the probe and the container itself.
- Planning and running are two separate exports, so Story 9.9 can show the plan before running it.
- Restart and verify go through `ServiceActions.restart` and `verifyService`, at `update.concurrency`. Rows, phases, ordering and summary reuse the switch-restart types and helpers: shared code, not a copy.
- Before a row restarts, the run checks the service's own restart lock and `restartBlockingLocks(activeUlid)`. If one is held, the row fails with detail `<lock name> in progress`.
- Core returns `Result` and never rejects. A throwing `onPhase` never breaks the run.
- CLI: standard AD-3 envelope. `--restart` falls back to `dashboard.restartMode`. A bad flag value is `invalid-argument` and nothing is restarted.
- The new setting covers the port type, `DEFAULT_SETTINGS`, the zod schema (per-field `.catch` fallback, optional-with-default group) and the `:settings` screen.

**Ask First:** changing `ServiceActions`, `ServiceFinalState` or the resolver; making heal hold the group-update or EDT locks; adding a TUI heal action (that is Story 9.9).

**Never:** changing the behaviour or tests of switch or realign (existing tests stay green, unchanged); a CLI confirmation prompt; persisting statuses; any new dependency.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Down service | member `down`, has container | target, restarted then verified | — |
| Stuck service | member `unhealthy`, has container | target | — |
| Healthy | `up` | skipped `up` | — |
| Restarting | `restarting` | skipped `already restarting` | — |
| Route/container mismatch | `inconsistent` | skipped `inconsistent` | — |
| Container-less | `no-container`, or `down` without a container | skipped `no container` | — |
| Unresolvable | resolver `err` (unreadable manifest, Docker + probe fail) | skipped `status unknown` | — |
| Nothing to heal | zero targets | `ok`, every member skipped, message `every service is up` | exit 0 |
| Lock held | group update / EDT switch / service restart lock held | that row `failed`, detail `<name> in progress`; others still run | exit 1 |
| Restart fails | `restart` returns `err` | row `failed` with the message | exit 1 |
| Verify ends badly | final `down` / `unhealthy` | row in that state | exit 1 |
| No active EDT | `readActiveEdt` null or unknown ulid | `err('no-active-edt', …)` | exit 1 |
| Bad flag | `--restart none`, unknown flag, missing value, repeated flag | `invalid-argument` with usage | exit 1 |

</frozen-after-approval>

## Code Map

- `src/core/edt/switch-restart.ts:22,101-190` -- `RestartSkipReason`, `restartAfterSwitch`. Lines 147-182 are the pool body to extract into an exported `runRestartRows({rows, mode, concurrency, serviceActions, onPhase?, beforeRestart?})`. `restartAfterSwitch` keeps building its rows and delegates. `orderRestartRows`, `summarizeRestartRows` and `restartNeedsAttention` are reused as-is.
- `src/core/realign/index.ts:270-307` -- the second consumer of `restartAfterSwitch`. Read-only, must keep working.
- `src/core/service-status/index.ts:17-28,48,102` -- `ServiceStatus` (`container` field), `hasContainer`, `resolveServiceStatus`.
- `src/core/service-actions/index.ts:56-68,80-121` -- deps, `restartBlockingLocks`, `heldLockName`, `NamedLock`. `restart` already holds `serviceRestartLockKey` (`core/scripts/service-restart.ts:27`) through `withActionLock`.
- `src/core/dashboard/snapshot.ts:87-104` -- the pattern for resolving the active EDT and its members (`state.readActiveEdt` + `edtRegistry.list`).
- `src/adapters/driving/cli/subcommands.ts:86-92,329-334,1006-1149` -- `REALIGN_USAGE`, registration, `runRealign`. Template for flag parsing, lazy settings, `createServiceActions` and the envelope mapping of report rows. `docker` is always in deps (`:109`) and `healthProbe` is optional (`:118`).
- `src/core/ports/settings.ts:35-140` -- `Settings` and `DEFAULT_SETTINGS`; `logs.restartMode` is the `'simple' | 'clean'` precedent.
- `src/adapters/driven/settings/schema.ts:122-141` -- `switch:`/`realign:` group schema pattern.
- `src/adapters/driving/tui/shared/settings-screen.tsx:396-413,463-480,957-978,1329-1355` -- EDTs-tab groups (`SETTINGS_GROUPS`, footer contexts, key handling, rendering). Add a group there.
- Tests: `switch-restart.test.ts`, `realign/index.test.ts`, `cli/dispatch.test.ts`, `adapters/driven/settings/index.test.ts`, `shared/settings-screen.test.tsx`. Fakes are inline `vi.fn`.
- Docs: `docs/tui-back-manifest.md:338-353,412-440` (French). Settings section and CLI `dashboard` JSON section.

## Tasks & Acceptance

**Execution:**
- [x] `src/core/edt/switch-restart.ts` (+ test) -- extract `runRestartRows` with an optional `beforeRestart(row) => Promise<string | null>` (non-null fails the row with that detail). Widen `RestartSkipReason` with `up | already restarting | inconsistent | status unknown`. Add new tests for `runRestartRows`; existing tests stay unchanged.
- [x] `src/core/heal/index.ts` (+ `index.test.ts`) -- `planHeal({state, edtRegistry, manifest, docker, healthProbe?})` returns `Result<HealPlan>`, where `HealPlan = {edt:{ulid,topic}, rows: RestartRow[]}` with targets `pending` and the rest `skipped` with their reason. `runHeal({plan, mode, concurrency, serviceActions, lock, onPhase?})` returns `Result<HealReport>`, where `HealReport = RestartReport & {edt, message?}` and `message` is `every service is up` when there are no targets. Unit-test every matrix row.
- [x] `src/core/ports/settings.ts`, `src/adapters/driven/settings/schema.ts` (+ tests) -- `dashboard: { restartMode: 'simple' | 'clean' }`, default `simple`.
- [x] `src/adapters/driving/tui/shared/settings-screen.tsx` (+ test) -- EDTs-tab group `heal-restart` ("Heal restart mode"): Left/Right/Space toggle, `settings-toggle` footer, a dim annotation naming the Dashboard heal and `heal --restart`.
- [x] `src/adapters/driving/cli/subcommands.ts` (+ `dispatch.test.ts`) -- `HEAL_USAGE` and the `heal` subcommand. Data: `{edt, mode, targets: string[], skipped: [{service, reason}], restart: [{service, state, detail?}], summary, message?}`. Return `err('heal-needs-attention', …, data)` when `restartNeedsAttention`. Return `err('restart-unavailable')` when `healthProbe` is not wired.
- [x] `docs/tui-back-manifest.md` -- in French: a "CLI `heal` — JSON" section (targets, skip reasons, states, exit code) and `dashboard.restartMode` in the settings section.

**Acceptance Criteria:**
- Given two `down` targets and `update.concurrency` 1, when heal runs, then they restart sequentially and `onPhase` streams `pending → restarting → verifying → final` per target.
- Given `tui-back heal` with no flag and `dashboard.restartMode: clean`, when it runs, then every target restarts in `clean` mode.
- Given every target ends `functional` or `up-unverified`, then the CLI exits 0. Given any `failed`, `down` or `unhealthy`, it exits 1 with the full data.
- Given `npm test && npm run typecheck && npm run depcheck`, then all pass, and the switch and realign test files have no diff.

## Design Notes

- Heal holds no group-level lock: it only checks locks per row. Holding the group-update lock would block concurrent single restarts for no gain. The per-row check is also where "a held lock fails that row with its name" naturally lives.
- Members are resolved in parallel, and rows keep member order. `orderRestartRows` then puts non-green rows first, as in switch.
- The settings control goes on the EDTs tab, next to the realign and switch restart modes, rather than on a new tab. That keeps it clear of Story 9.11's Services tab.

## Verification

**Commands:**
- `npm test && npm run typecheck && npm run depcheck` -- expected: all green.
- `git diff --stat epic-9-service-terminals-unified-service-actions -- src/core/edt/switch-restart.test.ts src/core/realign/index.test.ts` -- expected: switch-restart test has only additions; realign test untouched.

## Suggested Review Order

**Heal use-case (entry point)**

- The plan: one resolver status per member, targets `pending`, the rest skipped with a reason.
  [`index.ts:92`](../../src/core/heal/index.ts#L92)

- Target rule in one exhaustive switch: only `down`/`unhealthy` with a container.
  [`index.ts:67`](../../src/core/heal/index.ts#L67)

- Blank path and resolver errors become `status unknown` with their cause as detail.
  [`index.ts:120`](../../src/core/heal/index.ts#L120)

- The run: shared pool, per-row lock peek failing only that row.
  [`index.ts:145`](../../src/core/heal/index.ts#L145)

- Lock names reported as `<name> in progress`; heal itself holds no group lock.
  [`index.ts:148`](../../src/core/heal/index.ts#L148)

**Shared restart machinery**

- Pool extracted as a target-list entry point; switch and realign delegate unchanged.
  [`switch-restart.ts:163`](../../src/core/edt/switch-restart.ts#L163)

- The `beforeRestart` hook, the only new behaviour in the shared pool.
  [`switch-restart.ts:199`](../../src/core/edt/switch-restart.ts#L199)

- Skip vocabulary widened for heal's reasons.
  [`switch-restart.ts:24`](../../src/core/edt/switch-restart.ts#L24)

- `restartAfterSwitch` now only builds its rows and hands them over.
  [`switch-restart.ts:118`](../../src/core/edt/switch-restart.ts#L118)

**CLI `heal`**

- Flag parsing before any read, settings fallback, probe-wiring guard.
  [`subcommands.ts:1167`](../../src/adapters/driving/cli/subcommands.ts#L1167)

- Exit 1 exactly when `restartNeedsAttention`, full data in the error details.
  [`subcommands.ts:1260`](../../src/adapters/driving/cli/subcommands.ts#L1260)

- Usage text and registration after `realign`.
  [`subcommands.ts:95`](../../src/adapters/driving/cli/subcommands.ts#L95)

**Setting `dashboard.restartMode`**

- Port type and default `simple`.
  [`settings.ts:105`](../../src/core/ports/settings.ts#L105)

- Optional group, per-field silent fallback on an unknown value.
  [`schema.ts:143`](../../src/adapters/driven/settings/schema.ts#L143)

- Store merge for partial updates.
  [`settings-slice.ts:83`](../../src/adapters/driving/tui/store/slices/settings-slice.ts#L83)

- EDTs-tab "Heal restart mode" toggle, next to switch/realign restart modes.
  [`settings-screen.tsx:970`](../../src/adapters/driving/tui/shared/settings-screen.tsx#L970)

**Docs & tests**

- CLI `heal` JSON: targets, skip reasons, exit code, errors.
  [`tui-back-manifest.md:459`](../../docs/tui-back-manifest.md#L459)

- `dashboard.restartMode` settings subsection.
  [`tui-back-manifest.md:354`](../../docs/tui-back-manifest.md#L354)

- Core matrix tests for planning and running.
  [`index.test.ts:94`](../../src/core/heal/index.test.ts#L94)

- New `runRestartRows` tests (existing switch tests untouched).
  [`switch-restart.test.ts:196`](../../src/core/edt/switch-restart.test.ts#L196)

- CLI heal block: modes, locks, concurrency wiring, settings fallback, bad flags.
  [`dispatch.test.ts:1201`](../../src/adapters/driving/cli/dispatch.test.ts#L1201)
