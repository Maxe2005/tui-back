---
title: 'Update Zone Shell — Service List & Live Status'
type: 'feature'
created: '2026-09-22'
status: 'in-progress'
review_loop_iteration: 0
baseline_commit: '0a7d48a0e800f1060edad2f62e33db5ae7ce4f93'
context: [_bmad-output/implementation-artifacts/epic-3-context.md]
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Update zone today is a flat run-log view (per-service rows appear only once a run starts, via `formatUpdateRow`/`formatUpdateSummary`) — a developer can't see any service's state before triggering a run, unlike the EDT and Logs zones which always show a persistent service list.

**Approach:** Give the Update zone the same list/detail split shell as the EDT and Logs zones: a left-hand list of every managed service (active EDT members first, others after), each always carrying one status glyph from a closed six-state set, and a right-hand detail pane showing the selected service's last known run outcome (or "idle"). This is a shell only — no new git/migration/restart behavior, and no live per-step tracking (Story 3.10 replaces the detail pane's content once a run targets the selected service).

## Boundaries & Constraints

**Always:**
- Reuse `ListDetailSplit`, `ListRow`, `DetailPane`, `BoundedList` (`shared/components/`) exactly as EDT/Logs zones use them — no new layout primitives.
- Status is always glyph + semantic color, never color alone (repo-wide `StatusBadge` convention).
- The list partitions services the same way `logs-zone.tsx` already does: active-EDT-scoped `edtsBranches` rows (`isMember` true first, then `isMember` false), sourced via `loadEdtsBranches()`/`loadEdts()` on mount — no new registry/enumeration logic.
- Existing 3.1–3.4 run-trigger keybindings, run-log rendering, and conflict-resolution modal keep working unchanged — this story is additive around them, not a replacement of run behavior.
- Zone-local selection/UI state stays component `useState` (repo convention); only cross-visit/cross-run state (health poll results, last-service-outcome map) belongs in `update-slice.ts`.
- New pure status-derivation and list-partition logic is exported as standalone functions (repo test convention: `useInput` is never exercised in tests, so all logic it dispatches to must be independently unit-testable).

**Ask First:** none identified — this is a self-contained UI shell with no ambiguous product decision.

**Never:**
- Do not add live per-step run tracking (pulling/merging/migrating/restarting) — that's Story 3.10; this story's `updating` status is a single generic "a run currently targets this service" signal, and `migrating` is reserved in the type but never produced here.
- Do not touch `group-update.ts`, the CLI `update` subcommand, or the manifest schema.
- Do not change Logs zone's own `healthBadgeState`/`logsPanes` behavior — the new health poll is Update-zone-owned and independent (no shared subscription).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First render, no prior run | `lastServiceOutcomes` empty, health poll not yet resolved | Detail pane shows "idle"; list glyph falls back to `down` until the first health poll resolves | N/A |
| Run in progress targeting selected service | `updateStatus === 'running'`, service in current run's scope | List glyph shows `updating` | N/A |
| Last run failed for this service | `lastServiceOutcomes[service].outcome === 'failed'` | List glyph shows `error`; detail pane shows the failure outcome/detail | N/A |
| Service outside any run's scope so far | no entry in `lastServiceOutcomes` | Detail pane shows "idle"; list glyph reflects raw health (`up`/`down`/`restarting`) | N/A |
| Manifest load fails during health poll for a service | `deps.manifest.load(repoPath)` returns `!ok` | That service's glyph keeps its last-known value (poll is a no-op on failure, same as `pollPaneHealth`) | Silent per-poll no-op, mirrors existing Logs-zone precedent |

</frozen-after-approval>

## Code Map

- `src/adapters/driving/tui/zones/update/update-zone.tsx` — rewrite render body to wrap existing run-log/modal content in `ListDetailSplit` (list: partitioned `edtsBranches` rows as `ListRow`s inside `BoundedList`; detail: `DetailPane` for the selected row). Keep existing trigger/modal logic; mount effect adds `loadEdtsBranches()`/`loadEdts()` (pattern: `logs-zone.tsx:225-230`) plus starting/stopping the new health poll.
- `src/adapters/driving/tui/zones/logs/logs-zone.tsx:234-236` — reference for "partition active-EDT rows by `isMember`, sourced from `edtsBranches` against the active EDT" (do the same, no per-row focus toggle needed).
- `src/adapters/driving/tui/store/slices/update-slice.ts` — add `updateServiceHealth: Record<string, HealthState>` (poll, see below) and `lastServiceOutcomes: Record<string, GroupUpdateRepoResult>` (merged — never wholesale-replaced — inside `runGroupUpdate`'s success branch, alongside the existing `updateResults` set at `:126-133`, so outcomes for services outside a partial-scope run survive).
- `src/adapters/driving/tui/store/slices/logs-slice.ts:204-249,283-293` — pattern to mirror for the new health poll: `pollPaneHealth`-style one-shot fetch (`deps.manifest.load(repoPath)` → `getServiceHealth({ docker: deps.docker, container: manifestResult.data.container })`) plus `startHealthPolling`/`stopHealthPolling` (interval, `LOGS_HEALTH_POLL_INTERVAL_MS`, `.unref()`). Update zone's version polls every service in `edtsBranches` on mount/unmount, independent of Logs zone's pane subscriptions.
- `src/adapters/driving/tui/shared/components/status-badge.tsx:4-26` — extend `StatusBadgeState`/`STATUS_BADGES` with 4 new closed-set members: `restarting`, `updating`, `migrating`, `error` (each its own glyph+color — do not bridge through the existing generic `in-progress` entry, since Update zone must distinguish `restarting`/`updating`/`migrating` from one another, unlike Logs zone's `healthBadgeState` bridge).
- New pure logic (add `src/adapters/driving/tui/zones/update/update-zone.logic.ts`, mirroring `edts-zone.logic.ts`'s pattern): `deriveUpdateServiceStatus(health: HealthState, lastOutcome: GroupUpdateRepoResult['outcome'] | undefined, isTargetedByRunningRun: boolean): UpdateServiceStatus` — `isTargetedByRunningRun` → `'updating'`; else `lastOutcome === 'failed'` → `'error'`; else health passthrough (`up`/`down`/`restarting`). Export `UpdateServiceStatus = HealthState | 'updating' | 'migrating' | 'error'`.
- `src/adapters/driving/tui/zones/update/update-zone.test.tsx` — extend (existing file: pure-function unit tests then `renderToString` smoke tests, per file header convention). Add cases for the new partition/derive functions and a smoke test per new visual state (idle, updating, error).

## Tasks & Acceptance

**Execution:**
- [x] `status-badge.tsx` -- add `restarting`/`updating`/`migrating`/`error` to `StatusBadgeState`/`STATUS_BADGES` with distinct glyphs/colors -- closed six-state set, never ambiguous, no reuse of the generic `in-progress` glyph for these.
- [x] `update-zone.logic.ts` (new) -- `deriveUpdateServiceStatus` + `UpdateServiceStatus` type + a partition helper for EDT-members-first ordering -- pure, independently unit-testable per repo's `useInput`-untested convention.
- [x] `update-slice.ts` -- add `updateServiceHealth`, `lastServiceOutcomes` state + poll start/stop actions mirroring `logs-slice.ts`'s health-poll pattern; merge (not replace) `lastServiceOutcomes` on run completion.
- [x] `update-zone.tsx` -- wrap existing content in `ListDetailSplit`/`ListRow`/`BoundedList`/`DetailPane`; wire mount-effect data loading + health poll start/stop; keep 3.1–3.4 triggers/modal behavior unchanged.
- [x] `update-zone.test.tsx` -- unit-test `deriveUpdateServiceStatus` and the partition helper across the I/O matrix rows; smoke-test idle/updating/error list+detail rendering.

**Acceptance Criteria:**
- Given the developer opens the Update zone, when it renders, then the left pane lists every service (active EDT members first, others after) using the same list/detail split as EDT/Logs zones.
- Given any service row, when rendered at any time (run or no run in progress), then it carries one glyph from `up`/`down`/`restarting`/`updating`/`migrating`/`error` — never blank, never a generic/ambiguous glyph.
- Given a service is selected, when the detail pane renders, then it shows that service's last known outcome, or "idle" if `lastServiceOutcomes` has no entry for it.

## Spec Change Log

## Design Notes

`migrating` is intentionally unreachable from `deriveUpdateServiceStatus` in this story — it exists in the closed type now so `STATUS_BADGES` is total (TypeScript-exhaustive) and Story 3.10 can start emitting it without touching `status-badge.tsx` again. `updating` is deliberately coarse (any run touching this service, regardless of which git/migrate/restart phase it's actually in) because per-step tracking is explicitly out of scope until 3.10 — do not attempt to infer the phase from `group-update.ts` internals here.

`error` is derived from the last completed run's outcome, not from container health — a container can report `up` immediately after a failed migration (the old code is still running), so a raw health-only glyph would hide the failure. `error` deliberately outranks raw health in `deriveUpdateServiceStatus`'s precedence.

## Verification

**Commands:**
- `npm test && npm run typecheck && npm run depcheck` -- expected: all green (AGENTS.md order).

**Manual checks (if no CLI):**
- Launch the TUI, open the Update zone with no run yet started: every manifest service shows a glyph (not blank), EDT members listed first; selecting one shows "idle" in the detail pane.
- Trigger a run; the targeted services' glyphs switch to `updating` for the run's duration, then reflect their outcome (`error` on failure) once it completes.

