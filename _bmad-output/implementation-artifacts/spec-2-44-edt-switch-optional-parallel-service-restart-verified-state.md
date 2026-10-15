---
title: 'Story 2.44: EDT Switch — Optional Parallel Service Restart & Verified State'
type: 'feature'
created: '2026-10-15'
status: 'in-progress'
baseline_commit: '6666e5124a5163d583a6024a06d174d31778610d'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/epics.md#Story 2.44'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** After an EDT switch the developer must restart containers by hand and has no way to see which service came back up and answers; FR-37 adds an optional post-switch restart with verified per-service state.

**Approach:** Keep `switchActiveEdt` untouched and add a second, post-success use-case `restartAfterSwitch` (pure orchestration over `runPool` + `ServiceActions.restart` + new `ServiceActions.verifyService`), driven by a `switch.restartMode` setting (`none` default), a dialog selector, a live report view and a CLI `--restart` flag. Normative acceptance criteria: `epics.md` Story 2.44 (authoritative; not duplicated here).

## Boundaries & Constraints

**Always:** Build in this order, one atomic commit each (subject carries `(story 2.44)`): `HealthProbePort` + adapter → manifest `healthUrl` (+ `docs/tui-back-manifest.md` + `manifest-generator` skill) → `verifyService` → `switch.restartMode` setting + `:settings` control → `restartAfterSwitch` → store + dialog selector → report view → CLI flag. Reuse `runPool` (`keyOf` = resolved repoPath, `onError` → `failed` row) and `ServiceActions.restart`; core never does inline HTTP; ports injected; never-throw `Result`; kebab-case error codes. Verify: poll 1 s, 30 s timeout, constants in `core/`, settle on first definitive state; final states closed set `functional | up-unverified | unhealthy | restarting | down | failed`; skipped rows (`unchanged` / `no container`) are never `failed`. Glyph + colour, `BoundedList` (AD-19), dialog registered in `dialog-registry.tsx`. Restart runs under the existing action lock, exclusive with update / switch / another restart run, both directions. Action-log entry (new active EDT) records mode + every final state. Default `none` leaves behaviour byte-identical.

**Ask First:** HALT if Stories 3.18 (`runPool`) or 7.12 (`ServiceActions`) are not in the epic branch (verified at planning: both present). HALT if the action-lock exclusion needs a new lock key shape that changes Story 3.16 behaviour.

**Never:** No rollback of the switch on restart failure; no write-back of the dialog selector to settings; no change to `switchActiveEdt` signature or its tests; no new pool or restart implementation; no `spawnSync`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Mode none | `switch.restartMode=none`, no flag | no restart/verify/UI | N/A |
| Targets | rows `switched`/`adopted`/`discarded` with container | restarted; others `skipped` (unchanged / no container) | N/A |
| Clean, no recipe | mode clean, service lacks recipe | simple restart, row has `NO_CLEAN_RECIPE_NOTICE` | N/A |
| Verify | up + `healthUrl` 2xx / no `healthUrl` / non-2xx or timeout / restarting / down | `functional` / `up-unverified` / `unhealthy` / `restarting` / `down` | restart error → `failed` + detail |
| Worker throws | any target | that service `failed`, run resolves | never rejects |
| Concurrent run | update/switch/restart in flight | rejected via action lock | clear message |
| CLI flag | `--restart bogus` | rejected before anything is touched | `invalid-argument` |
| CLI exit | any target `failed`/`down`/`unhealthy` | non-zero exit, `restart: [{service,mode,state,detail?}]` | N/A |
| Manifest | `healthUrl: ''` or non-http(s) | validation fails with precise message | schema error |

</frozen-after-approval>

## Code Map

- `src/core/scripts/run-pool.ts` -- `runPool(items, {concurrency,keyOf,onCancelled,onError}, worker)`; reuse as is.
- `src/core/service-actions/index.ts` -- `createServiceActions`, `restart(repoPath, mode)`, `NO_CLEAN_RECIPE_NOTICE`; add `verifyService(repoPath)` + deps (`DockerPort`, `HealthProbePort`).
- `src/core/ports/docker.ts` -- `getContainerHealth` → `up|down|restarting`; consumed by verify.
- `src/core/ports/manifest.ts`, `src/adapters/driven/manifest/schema.ts` -- add optional `healthUrl` (http/https, non-blank).
- `src/core/edt/switch.ts` -- `SwitchEdtRepoResult` (`outcome`) is the target source; read-only.
- `src/core/edt/switch-restart.ts` (new) -- `restartAfterSwitch({results, mode, concurrency, serviceActions, onPhase})`.
- `src/core/ports/health-probe.ts` (new), `src/adapters/driven/health/http-probe.ts` (new) -- single `GET`, `AbortSignal.timeout`.
- `src/core/ports/settings.ts`, `src/adapters/driven/settings/schema.ts`, `src/adapters/driving/tui/shared/settings-screen.tsx` -- `switch.restartMode` (model mirrors `logs.restartMode`).
- `src/adapters/driving/tui/store/slices/edt-slice.ts` -- `switchEdt` (l.310); add `switchRestart` state, `onPhase` live rows (pattern: `update-slice.ts`), lock exclusion (l.48-53 message).
- `src/adapters/driving/tui/zones/edts/dialogs/switch-dialog.tsx`, `dialog-registry.tsx` -- selector + report view; wizard Step 4 (`create-wizard/`) and quick-pick (`quick-pick-dialog.tsx`) share the seam.
- `src/adapters/driving/cli/subcommands.ts` -- `runEdtSwitch` / `EDT_SWITCH_USAGE`; add `--restart`.
- `docs/tui-back-manifest.md`, `.claude/skills/manifest-generator` -- `healthUrl` docs/detection (project memory rule).

## Tasks & Acceptance

**Execution:**
- [ ] `core/ports/health-probe.ts` + `adapters/driven/health/http-probe.ts` + tests -- port and fetch adapter
- [ ] manifest `healthUrl` (port, schema, tests) + `docs/tui-back-manifest.md` + manifest-generator skill
- [ ] `core/service-actions` `verifyService` + constants + tests -- all six states
- [ ] `switch.restartMode` in settings port/schema/screen + tests
- [ ] `core/edt/switch-restart.ts` + tests -- targets, skips, pool, clean fallback, throw, summary ordering
- [ ] `edt-slice.ts` + `switch-dialog.tsx` selector, lock exclusion, action log, wizard/quick-pick seam documented + tests
- [ ] report view (`BoundedList`, live rows, summary non-green first) + tests
- [ ] CLI `--restart` flag, envelope rows, exit code + tests; update `EDT_SWITCH_USAGE`

**Acceptance Criteria:**
- Given the epics.md Story 2.44 criteria, when each is exercised, then all hold with `npm test`, typecheck and lint green.
- Given `restartMode=none`, when switching, then existing switch tests pass unmodified.

## Design Notes

`restartAfterSwitch` is a second call after a successful switch so switch atomicity is untouched. `onPhase(service, phase)` drives `pending → restarting → verifying → final`; the store maps it to rows like `update-slice`. Settings/dialog default flows: setting → dialog preselect → per-switch override (never persisted).

## Verification

**Commands:**
- `npm test` -- expected: all green
- `npx tsc --noEmit` -- expected: no errors
- `npm run lint` -- expected: clean (incl. dependency-cruiser)
