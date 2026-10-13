---
title: 'Publish a New shared-types Version'
type: 'feature'
created: '2026-10-08'
status: 'done'
baseline_commit: 'aeadad76bd09b40de2ed1732f930c74f7c8def55'
review_loop_iteration: 1
context: [_bmad-output/implementation-artifacts/epic-4-context.md]
---

<frozen-after-approval reason="human-owned intent — renegotiated 2026-10-08 after review loop 1 (single coarse run, no resume, ambiguous-source blocks)">

## Intent

**Problem:** Publishing `shared-types` still means running the release script by hand outside the tool, with no visibility and no safe retry after a partial failure.

**Approach:** Add a publish flow to the `shared-types` zone: run the source repo's configured publish command exactly once per attempt with a coarse running state (spinner, no per-step attribution), verify the new version on the registry before marking success, then offer to chain into propagation with the published version pre-filled. No auto-resume: a re-trigger re-verifies state first and either detects an already-published version or relaunches the whole command.

## Boundaries & Constraints

**Always:** Publish is only offered when the active EDT includes the `shared-types-source` repo (existing tab-gating, unchanged). Exactly one `RestartPort.run` execution (`sh -c`, `cwd` = source repo) per attempt — never once per step — and no new process primitive. A failure is reported as `publish-failed` with the command output; no exact sub-step is named. A re-trigger after failure first re-reads the source version and checks the registry: already published → success path (chain offer); otherwise a full relaunch of the command. More than one source repo in the active EDT blocks with `ambiguous-source`. The `runInProgress` guard and retry guards surface a visible notice, never a silent no-op. State transitions clear stale errors. Source-resolution failures surface their distinct cause, never a generic `no-source-in-edt`. On completion read the new version from the source `package.json` and require `verifyPublished(packageName, version)` before reporting published. Git writes go through the safety gate (AD-8). All returns are `Result<T>` with kebab-case codes. Core never names `shared-types`. Bounded rendering applies (AD-19). `q` mid-run requires confirmation.

**Ask First:** If running the release script needs anything beyond `sh -c` with `cwd` set (extra env, args, login shell), HALT and ask.

**Never:** No per-step output parsing, no resume-from-step, no splitting of the publish command. No propagation changes (4.2 stays as-is, only chained into), no group-update integration (4.4), no conflict resolution (4.5), no drift view (4.6). No push of consumer repos here. No JSON re-serialisation of `package.json`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy path | Source in active EDT, command succeeds | Single run with spinner, version read + registry-verified, success offers chain-or-stop | N/A |
| No source in EDT | Active EDT has no source repo | Publish not offered (existing disabled/omitted tab state) | N/A |
| Ambiguous sources | 2+ source repos in active EDT | Publish blocked with explicit message | `ambiguous-source` |
| Failure | Command exits non-zero | Run stops, output shown, full relaunch offered (no step named) | `publish-failed` |
| Already published | Re-trigger, version on registry | Reported published, chain offered, command not re-run | N/A |
| Registry mismatch | Command ok but version absent on registry | Not marked published, explicit message, relaunch offered | `version-not-published` |
| Registry down | Runner fails on verify | Distinct unreachable message, relaunch offered | `registry-unreachable` |
| Quit mid-run | `q` while publishing | Confirmation modal | N/A |
| Chain | Publish done, developer accepts | Propagate flow starts with published version pre-filled | N/A |

</frozen-after-approval>

## Code Map

- `src/core/ports/shared-types.ts` -- add `readOwnVersion(path)` (source's own `version`; existing `readVersion` reads a dependency line); trim the returned version.
- `src/adapters/driven/modules/shared-types/npm-package.ts` -- implement `readOwnVersion` (targeted read, no re-serialisation); `verifyPublished` already exists.
- `src/core/shared-types/publish-version.ts` (new) -- `runPublish({restart, shared, sourceRepoPath, publishCommand, packageName, onProgress?})`: one `restart.run` per attempt, no step loop, no `resumeFrom`; re-trigger is a new call after the caller re-verified.
- `src/core/shared-types/list-consumers.ts:45` -- reuse `listConsumers` with the source module id; >1 active-EDT source → `ambiguous-source`.
- `src/bin/tui.ts:132`, `store/app-store.ts:90` -- today only the consumer id is resolved; add `sourceModuleId` + `parseSourceConfig` via the registry `configSchema`.
- `src/adapters/driving/tui/store/slices/shared-types-slice.ts` -- add `sharedTypesPublish` state plus `runSharedTypesPublish` / `retrySharedTypesPublish` / `resetSharedTypesPublish` beside `execute`, sharing the `runInProgress` guard with a notice on refusal and distinct source-error mapping.
- `zones/shared-types/shared-types-zone.tsx`, `shared-types-zone.logic.ts` -- publish entry (source-gated), single running view with `Spinner`, failure + full-relaunch retry, success chain-or-stop, `q` confirm; reuse existing components.

## Tasks & Acceptance

**Execution:**
- [x] `src/core/ports/shared-types.ts`, `npm-package.ts` -- add trimmed `readOwnVersion` with tests (own `version` field, missing/unparseable file)
- [x] `src/core/shared-types/publish-version.ts` -- exactly one `restart.run` per attempt (assert call count), `invalid-publish-command` on empty, gate via `GitPort`, read + registry-verify before success
- [x] `src/bin/tui.ts`, `app-store.ts`, `shared-types-slice.ts` -- wire source module id + parser; `ambiguous-source` on several sources; notices on guard refusals; stale errors cleared; distinct source errors
- [x] `zones/shared-types/` -- publish entry (source-gated), coarse running state with spinner, failure + relaunch, success chain-or-stop, `q` confirm
- [x] Tests: use-case against fakes (every matrix row, single-execution assertion, already-published re-trigger without re-run, `readOwnVersion`/`currentBranch` failures mapped, verify-before-mark); adapter `readOwnVersion`; slice error mappings; zone interaction (source gating, spinner, relaunch, chain pre-fill, quit confirm)

**Acceptance Criteria:**
- Given the active EDT includes exactly one source repo, when the zone opens, then publish is offered; with none it is not offered, with several it blocks as ambiguous.
- Given a publish attempt, when it runs, then the command executes exactly once and no sub-step is named.
- Given a failure, when re-triggered, then an already-published version is detected without re-running; otherwise the whole command relaunches.
- Given publish completes, when the version is not on the registry, then it is not marked published.
- Given publish succeeds, when acknowledged, then the tool offers chaining into propagation with the version pre-filled or stopping.
- Given a publish run in progress, when `q` is pressed, then confirmation is required.

## Spec Change Log

- Review loop 1 (intent_gap): the first implementation ran the opaque command once per tracked step (4 executions, 4 bumps) and claimed a resume guard the tests could not observe; the frozen intent defined no command-to-steps contract. Human renegotiated 2026-10-08: single coarse run with no step attribution, no auto-resume (re-verify then full relaunch or already-published), several sources block. Spec re-derived for the narrowed scope. KEEP: `readOwnVersion`, verify-before-mark, source wiring via `listConsumers`, chain-into-propagate offer, `q` confirm, existing zone component patterns.

## Design Notes

The release script is opaque to the tool (no step protocol, no markers), so steps are not tracked and failures carry the command output instead of a step name. Re-running the whole command is the only retry; the already-published check keeps a duplicate publish from re-running silently.

## Verification

**Commands:**
- `npm test` -- expected: all pass
- `npm run typecheck` -- expected: no errors
- `npm run depcheck` -- expected: no errors

## Suggested Review Order

**Single-execution publish**

- Core use-case: exactly one command run, then read plus registry-verify before success
  [`publish-version.ts:24`](../../../src/core/shared-types/publish-version.ts#L24)

- Port addition: source's own version, trimmed, never a dependency line
  [`shared-types.ts:14`](../../../src/core/ports/shared-types.ts#L14)

- Adapter: targeted read without re-serialisation
  [`npm-package.ts:109`](../../../src/adapters/driven/modules/shared-types/npm-package.ts#L109)

**Source resolution and wiring**

- Active-EDT source listing shared with consumers; several sources stay ambiguous
  [`list-consumers.ts:51`](../../../src/core/shared-types/list-consumers.ts#L51)

- Composition root wires source independently of consumer presence
  [`tui.ts:138`](../../../src/bin/tui.ts#L138)

**Store and zone**

- Single-source resolution, guarded run plus re-verifying retry
  [`shared-types-slice.ts:159`](../../../src/adapters/driving/tui/store/slices/shared-types-slice.ts#L159)

- Coarse running view, failure plus relaunch, success plus chain offer
  [`shared-types-zone.tsx:245`](../../../src/adapters/driving/tui/zones/shared-types/shared-types-zone.tsx#L245)

- Pure key decisions for publish entry, blocked and done states
  [`shared-types-zone.logic.ts:121`](../../../src/adapters/driving/tui/zones/shared-types/shared-types-zone.logic.ts#L121)

**Tests**

- Use-case: single execution, gates, verify-before-mark, failure mappings
  [`publish-version.test.ts:1`](../../../src/core/shared-types/publish-version.test.ts#L1)

- Slice: ambiguous source, already-published retry, guard notices, error mappings
  [`shared-types-publish.test.ts:1`](../../../src/adapters/driving/tui/store/slices/shared-types-publish.test.ts#L1)

- Zone: gating, spinner, relaunch, chain pre-fill, quit confirm
  [`shared-types-publish.interaction.test.tsx:1`](../../../src/adapters/driving/tui/zones/shared-types/shared-types-publish.interaction.test.tsx#L1)
