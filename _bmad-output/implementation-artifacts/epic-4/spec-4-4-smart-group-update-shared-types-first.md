---
title: 'Smart Group Update — shared-types First'
type: 'feature'
created: '2026-10-12'
status: 'done'
baseline_commit: '1ccb95929f40caccdcfaccdf3e28aaad4fc7827d'
review_loop_iteration: 0
context: [_bmad-output/implementation-artifacts/epic-4-context.md]
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Bumping `shared-types` around a group update is three manual steps (publish, propagate, commit) done before consumers merge, so consumers conflict on a stale dependency line.

**Approach:** Add a run-wide `shared-types` setting to the Update configuration (off / publish if the merge changed something / always publish). When on, the source repo is updated alone first (stage 0), then published (4.3) and propagated to every consumer of the EDT with commit on (4.2), and only then the remaining services update. A failure of that phase pauses the run with retry / skip `shared-types` handling / abort.

## Boundaries & Constraints

**Always:** Row shown only when the EDT contains exactly one `shared-types-source` repo (else hidden; several sources: row hidden, no phase). Default `off`; the choice is per run (draft state), not persisted. Core stays generic: it gains only a between-stage hook and never names `shared-types`; the phase itself lives in `core/shared-types/` and receives the existing ports. Reuse `runPublish` and `propagateVersion` unchanged. Propagation options: install off, clean restart off, commit on; nothing is ever pushed. "If changed" means the source row is `updated` with merge `advanced`; a `skipped`/`failed` source row never publishes. Publish/propagate failures never throw: they become a phase failure routed to the pause seam. The same behaviour applies to a single-service update of the source. Live tracking shows the phase (publishing / propagating) on the source service. Bounded rendering (AD-19); every git write passes the safety gate (AD-8).

**Ask First:** If the pause cannot reuse the 3.18 incident queue without changing existing blocker kinds/choices, HALT and ask. If propagation needs `install` or `cleanRestart` on to be correct, HALT and ask.

**Never:** No CLI flag or script change. No conflict auto-resolution (4.5), no drift view (4.6). No change to 4.2/4.3 behaviour or to `runPool` stage semantics beyond the hook. No silent continuation of consumers after a phase failure.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Always, merge advanced | Source in run, `always` | Source merged alone, published, propagated + committed, then others update | N/A |
| If-changed, up to date | Source merge `up-to-date` | Phase skipped, others update | N/A |
| Off / no source in run | `off`, or source deselected | Today's behaviour, nothing extra | N/A |
| Source alone | Single-service update of source | Same phase runs, consumers propagated but not updated | N/A |
| Source merge failed | Source row `failed`/`skipped` | No publish; remaining services still update (existing per-service rule) | N/A |
| Phase failure | Publish or propagation fails | Run pauses; retry re-runs the phase, skip continues without it, abort cancels remaining services | `shared-types-phase-failed` |
| Partial propagation | Some consumers fail | Treated as a phase failure listing failed services | `shared-types-phase-failed` |

</frozen-after-approval>

## Code Map

- `src/core/scripts/run-pool.ts` -- add optional `afterStage(stage, rows)` awaited between stages; may call `control`-style cancel so later stages use `onCancelled`.
- `src/core/scripts/group-update.ts:154,366,591` -- `ordering` already exists; add generic `afterStage` param threaded to both `runPool` calls (EDT + all scope).
- `src/core/shared-types/smart-update.ts` (new) -- `runSharedTypesPhase`: decides publish per mode, calls `runPublish` then `propagateVersion` (commit on), returns `Result` with failed-service detail; no I/O of its own.
- `src/core/shared-types/list-consumers.ts` -- `listConsumers`/`listSources` give consumers and the single source of the active EDT.
- `src/adapters/driving/tui/zones/update/update-config-dialog.logic.ts`, `update-config-panels.logic.ts`, `update-config-panels.tsx` -- add `sharedTypes` mode to `UpdateConfigDraft` as a `GlobalLine` (hidden without a single source), cycle with the existing toggle key.
- `src/adapters/driving/tui/store/slices/update-slice.ts:60,690,720` -- `UpdateRunOptions.sharedTypes`; build `ordering` (source = stage 0, others 1) and `afterStage`; pause through the incident queue; set live phase on the source service.
- `src/adapters/driving/tui/store/slices/shared-types-slice.ts` -- `sourceRegistries`/source resolution helpers to reuse from the update slice.
- `src/adapters/driving/tui/zones/update/update-incidents-dialog.tsx`, `update-incidents.logic.ts` -- add a phase-failure incident variant (retry / skip / abort).

## Tasks & Acceptance

**Execution:**
- [x] `src/core/scripts/run-pool.ts`, `group-update.ts` -- `afterStage` hook with cancel-on-abort -- generic seam for 4.4 without naming `shared-types`; tests: stage order, abort cancels later stages, hook throw becomes a cancel-safe failure
- [x] `src/core/shared-types/smart-update.ts` -- phase use-case (mode, publish, propagate, failure mapping) -- tests against fakes for every matrix row
- [x] `zones/update/update-config-*` -- run-wide `shared-types` row (off / if-changed / always), hidden unless exactly one source -- pure-logic and panel tests
- [x] `update-slice.ts`, incident files -- wire ordering, hook, live phase, pause choices -- slice and interaction tests (retry, skip, abort)
- [x] Docs: note the new run-wide setting in the Update-zone docs if one lists the config toggles

**Acceptance Criteria:**
- Given the EDT contains the source repo, when the config opens, then a `shared-types` row offers off / publish if the merge changed something / always publish; otherwise no row.
- Given the row is not off, when the update runs, then the source is merged first and alone, then published, propagated and committed, then the remaining services update.
- Given a single-service update of the source, when it runs, then the same phase applies.
- Given a phase failure, when it occurs, then no other service starts until the developer picks retry, skip or abort, and the live tracking shows the phase.

## Spec Change Log

## Design Notes

The between-stage hook keeps the pool pure and the module out of core: the store passes a closure that closes over the source row and the chosen mode. `ordering` puts only the source repo in stage 0; all others share stage 1, so the existing pool concurrency still applies within stage 1.

## Verification

**Commands:**
- `npm test` -- expected: all pass
- `npm run typecheck` -- expected: no errors
- `npm run depcheck` -- expected: no errors

## Suggested Review Order

**Phase use-case**

- Decides publish per mode, then runs publish and propagate unchanged; failures become one code
  [`smart-update.ts:71`](../../../src/core/shared-types/smart-update.ts#L71)

- "If changed" rule: only an advanced merge on an updated source row publishes
  [`smart-update.ts:60`](../../../src/core/shared-types/smart-update.ts#L60)

**Generic core seam**

- Between-stage hook; skipped once cancelled, a throwing hook cancels the run
  [`run-pool.ts:37`](../../../src/core/scripts/run-pool.ts#L37)

- Threaded to both the EDT and all-repos pools without naming shared-types
  [`group-update.ts:196`](../../../src/core/scripts/group-update.ts#L196)

**Store wiring**

- Stage ordering, hook, live phase and incident pause on failure
  [`update-slice.ts:694`](../../../src/adapters/driving/tui/store/slices/update-slice.ts#L694)

- Phase-failed incident variant reusing the 3.18 queue
  [`update-incidents.logic.ts:12`](../../../src/adapters/driving/tui/zones/update/update-incidents.logic.ts#L12)

**Configuration row and live view**

- Mode only forwarded when the source row is still selected
  [`update-config-dialog.logic.ts:171`](../../../src/adapters/driving/tui/zones/update/update-config-dialog.logic.ts#L171)

- Space cycles off / if-changed / always
  [`update-config-panels.logic.ts:65`](../../../src/adapters/driving/tui/zones/update/update-config-panels.logic.ts#L65)

- Detail pane shows the publishing / propagating step
  [`update-service-detail.tsx:63`](../../../src/adapters/driving/tui/zones/update/update-service-detail.tsx#L63)

**Tests**

- Use-case against fakes, one case per matrix row
  [`smart-update.test.ts:1`](../../../src/core/shared-types/smart-update.test.ts#L1)

- Pool hook: order, cancel, throwing hook
  [`run-pool.test.ts:165`](../../../src/core/scripts/run-pool.test.ts#L165)

- Slice: ordering, pause with retry/skip/abort, confirm path
  [`update-slice.test.ts:362`](../../../src/adapters/driving/tui/store/slices/update-slice.test.ts#L362)
