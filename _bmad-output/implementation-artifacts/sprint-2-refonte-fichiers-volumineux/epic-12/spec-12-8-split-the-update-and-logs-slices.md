---
title: 'Split the Update and Logs Slices'
type: 'refactor'
created: '2026-11-16'
status: 'done'
baseline_commit: 'ae841c16678596bafbdf3a53340d369bf109299f'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/sprint-2-refonte-fichiers-volumineux/epic-12-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `update-slice.ts` (1548 lines) and `logs-slice.ts` (1282 lines) each hold one giant `createXSlice` closure mixing unrelated action families and shared closure state.

**Approach:** Split each slice into sub-creators composed by `createUpdateSlice` / `createLogsSlice`. Closure state (maps, timers, guards, counters) moves into one per-store context object passed to every sub-creator. Moved code stays verbatim; the original slice file keeps its path and every exported symbol.

## Boundaries & Constraints

**Always:** Behaviour-preserving. `AppState` composition and public slice types unchanged. Every symbol previously exported by `update-slice.ts` / `logs-slice.ts` stays importable from there. Closure state is created once per `createXSlice(deps)` call (never module-level) and keeps identical lifetime. Object-spread order of the composed slice keeps initial-state keys identical. No import cycle (sub-creators import types from a `*.types.ts` module, never from the slice file). One responsibility + header comment per file, each under ~400 lines (justify exceptions). Gates before every commit: `npm test && npm run typecheck && npm run depcheck`.

**Ask First:** Any need to change a test file, a public type, or a message/key string.

**Never:** Edit any test file, rename actions or state keys, or alter timing/ordering of `set`/`get` calls.

</frozen-after-approval>

## Code Map

Update (`store/slices/`): `update-slice.ts` -- keeps `createUpdateSlice` (context + spread of sub-creators) and re-exports.
- `update-slice.types.ts` -- `parseUpdateServiceArg`, run/blocker/incident types, `UpdateSlice`, constants, pure helpers (`appendLiveIssue`, `mergeLastServiceRuns`...), `UpdateSliceContext`.
- `update-slice.config.ts` -- config-open helpers (`openEdtConfig`, `openAllReposConfig`, `openSingleServiceConfig`, `scopeForRepoPath`, ...) + `openUpdateConfig`..`confirmUpdateConfig`, service pick.
- `update-slice.run.ts` -- `runGroupUpdate`, shared-types hook, auto-resolve, restart/IDE actions, `markUpdateInterrupted`, `clearUpdate`.
- `update-slice.incident.ts` -- `raiseIncident` + incident actions/popup/toast.
- `update-slice.health.ts` -- `pollServiceHealth`, `pollAll`, start/stop polling.

Logs (`store/slices/`): `logs-slice.ts` -- keeps `createLogsSlice` and re-exports.
- `logs-slice.types.ts` -- pane/error types, `LogsSlice`, constants, `unavailableNotice`, pure helpers, `LogsSliceContext`.
- `logs-slice.filters.ts` -- visibility/filters/wrap, filter history, rule sets and rules persistence.
- `logs-slice.panes.ts` -- selection, fullscreen, subscribe/unsubscribe/load-older/clear/scroll/stop-all.
- `logs-slice.health.ts` -- pane health polling, listed-row health + container presence.
- `logs-slice.actions.ts` -- pane notice, list/run actions, restart, shortcuts, IDE.

## Tasks & Acceptance

**Execution:**
- [x] update slice split + context -- commit `refactor(update-slice): ... (story 12.8)`
- [x] logs slice split + context -- commit `refactor(logs-slice): ... (story 12.8)`

**Acceptance Criteria:**
- Given the split, when `app-store.test.ts`, `update-slice.test.ts`, `logs-slice.test.ts` and the full suite run unchanged, then they pass (modulo the known `app-shell` `:reset` failure) and typecheck + depcheck are green.
- Given each slice, then the original path still exports every previous symbol and `AppState` is unchanged.

## Design Notes

Mutable closure `let`s (`incidentSequence`, `healthPollTimer`, `pollingRepoPaths`, `servicePickGeneration`, logs' listed-poll timer/paths) become properties of a context object so sub-creators share them by reference.

## Verification

**Commands:**
- `npx vitest run --configLoader runner && npm run typecheck && npm run depcheck` -- expected: green (modulo the known `:reset` failure)

## Suggested Review Order

**Update slice**

- Composer: builds the shared context once, spreads the sub-creators, re-exports everything.
  [`update-slice.ts:1`](../../../../src/adapters/driving/tui/store/slices/update-slice.ts#L1)

- Context type holding the former closure state.
  [`update-slice.types.ts:1`](../../../../src/adapters/driving/tui/store/slices/update-slice.types.ts#L1)

- Run, shared-types hook, restart (over 400 lines, deferred).
  [`update-slice.run.ts:1`](../../../../src/adapters/driving/tui/store/slices/update-slice.run.ts#L1)

- Config open flows and quick-pick (over 400 lines, deferred).
  [`update-slice.config.ts:1`](../../../../src/adapters/driving/tui/store/slices/update-slice.config.ts#L1)

- Incident queue and health polling.
  [`update-slice.incident.ts:1`](../../../../src/adapters/driving/tui/store/slices/update-slice.incident.ts#L1)
  [`update-slice.health.ts:1`](../../../../src/adapters/driving/tui/store/slices/update-slice.health.ts#L1)

**Logs slice**

- Composer and re-exports.
  [`logs-slice.ts:1`](../../../../src/adapters/driving/tui/store/slices/logs-slice.ts#L1)

- Shared context, types, pure helpers.
  [`logs-slice.types.ts:1`](../../../../src/adapters/driving/tui/store/slices/logs-slice.types.ts#L1)

- Health creator returns helpers used by panes and actions.
  [`logs-slice.health.ts:1`](../../../../src/adapters/driving/tui/store/slices/logs-slice.health.ts#L1)

- Panes, filters/rules, service actions.
  [`logs-slice.panes.ts:1`](../../../../src/adapters/driving/tui/store/slices/logs-slice.panes.ts#L1)
  [`logs-slice.filters.ts:1`](../../../../src/adapters/driving/tui/store/slices/logs-slice.filters.ts#L1)
  [`logs-slice.actions.ts:1`](../../../../src/adapters/driving/tui/store/slices/logs-slice.actions.ts#L1)
