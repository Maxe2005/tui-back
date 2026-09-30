---
title: 'Per-Service Actions — Clean Restart & Single-Service Update'
type: 'feature'
created: '2026-09-24'
status: 'done'
baseline_commit: '6a8c0d7ed2dc60d2aeab48ec37c7332715db2a15'
review_loop_iteration: 0
context: [_bmad-output/implementation-artifacts/epic-3-context.md]
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Update zone rows are read-only — catching up or cleanly restarting one sick service today requires running (or deselecting through) the whole group update, so a single-service fix pays the blast radius of a full run.

**Approach:** Each service row gains a row-local action menu (Update this service / Clean restart), reusing the EDTs zone's per-service menu pattern: update reuses Story 3.7's pre-scoped config screen plus the unchanged one-selection group-update path, while clean restart runs Story 3.8's recipe-or-fallback through a new standalone single-service use-case guarded by a per-service lock.

## Boundaries & Constraints

**Always:** All core returns are `Result<T>` with kebab-case error codes (AD-3). Core never imports from adapters (AD-1); relative imports end in `.js` with imports-first-in-file. Merge stays `git merge`, never rebase; `assertAllowedBranch` gating unchanged. Restart decision stays core-side: never both `RestartPort` and `ContainerPort.restart` for the same service in the same action (Story 3.8 rule). Per-service failures reuse the `{service, outcome, detail?}` row shape with service + which-command + error output. One service's failure never blocks or rolls back others. TUI calls core use-cases in-process, never spawns the CLI. Live run state lives in the Zustand store, zone-local UI state in `useState`.

**Ask First:** If `Enter` opening a menu (instead of today's direct config open) breaks muscle memory badly enough to need a different trigger key; if the standalone restart needs anything beyond extracting `group-update.ts:741-768` into a shared helper; if per-service guard naming should be anything but `update-already-running` — HALT and ask before proceeding.

**Never:** No live per-step detail pane (Story 3.10 — only the coarse `restarting` in-flight flag, no step tracking). No `commands.ts`/`keybindings.ts` entries and no new global single-letter keys (Story 3.11 owns commands; zone mnemonics `d/e/u/l/r/s` stay untouched — hence a menu, not hotkeys). No new CLI flags (CLI call sites keep today's defaults). No change to pull/merge/migrate phases, their tests, or `ContainerPort.restart`'s signature. No per-service toggle overrides.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Open row menu | `Enter` on a service row, nothing running | Modal menu: Update this service / Clean restart / Cancel, EDTs service-menu pattern | N/A |
| Update this service | Menu choice confirmed | 3.7 config screen opens pre-scoped (`Single service: X`), same fields and confirm gate; confirm runs the unchanged one-selection group-update path | Zero-selection/unknown-branch rejections as today |
| Clean restart, recipe | Menu choice, manifest declares `restartCommands` | Recipe runs for that service alone in repo cwd, in order, stop on first failure; row derives `restarting` for the duration | `failed` row with service, which command, error output; outcome merged into last-outcome view |
| Clean restart, no recipe | Menu choice, no recipe declared | Plain container restart fallback, no error | Container failure reported as today |
| Busy same service | Standalone restart running on S, second trigger on S | Rejected with `update-already-running` (store map first, core `service:<repoPath>` lock as backstop) | Same code, explicit message, nothing started |
| Busy group run | Group run in progress, row action fired (or standalone in flight, group trigger fired) | Rejected `update-already-running` — global guard extended to the standalone map in both directions | Same code, nothing started |
| Idle other service | Standalone restart running on S, trigger on T ≠ S | Allowed — serialization is per service, not globally (group-update path still globally exclusive) | N/A |

</frozen-after-approval>

## Code Map

- `src/adapters/driving/tui/zones/update/update-zone.tsx:146-161,429-533` — `resolveUpdateTrigger` + `useInput`; `Enter` opens the row menu; rows via `BoundedList` + `StatusBadge` + `ListRow` (`571-590`); modal blocking via `setZoneInputCaptured` (`374-376`).
- `src/adapters/driving/tui/zones/edts/dialogs/service-actions-dialog.tsx:198-248` — per-service menu pattern to mirror (`ListRow` + `ModalDialog`, arrows/Home/End + `Enter`, `Esc` cancels, disabled-row annotation).
- `src/adapters/driving/tui/store/slices/update-slice.ts:47,295-349,392-408,486-565` — `OpenUpdateConfigTarget` already accepts `{service, repoPath?}` and `openSingleServiceConfig` pre-scopes the 3.7 draft; add a per-service in-flight map (`Record<repoPath, 'restart'>`) checked alongside the global `updateStatus==='running'` guard in both directions; merge standalone outcomes via `mergeLastServiceOutcomes` (`update-zone.logic.ts:80-89`).
- `src/adapters/driving/tui/zones/update/update-zone.logic.ts:19-38` — `deriveUpdateServiceStatus` returns `updating`/`error`/health passthrough today; derive `restarting` (badge already defined in `shared/components/status-badge.tsx:17-33`) while the in-flight map holds that service — coarse flag only, no step detail.
- `src/core/scripts/group-update.ts:741-768` — the 3.8 recipe-vs-plain branch to extract into a shared core helper (recipe loop + stop-on-first-failure + `restart-failed` detail at `752-755`, fallback at `758-766`); `updateWithLoadedManifest` and the new use-case both call it.
- `src/core/scripts/service-restart.ts` (new) — standalone use-case: load manifest (recipe + container identity), acquire `service:<resolved-repoPath>` via `withActionLock` (`src/core/locking.ts:17-21`, key scheme beside `GROUP_UPDATE_LOCK_KEY:42`), run the shared helper, return the `{service, outcome, detail?}` row (`GroupUpdateRepoResult:97-101`); contention maps to `update-already-running`.
- `src/bin/main.ts:36-64` + `src/bin/tui.ts:95-129` — composition roots wiring `container`/`migration`/`restart` today; wire the new use-case's ports identically; `src/adapters/driving/cli/subcommands.ts:142-200` unchanged (defaults, no new flags — commands arrive in 3.11).
- Tests: fake matrix (`fakeRestart`, clean-restart describe `1988-2230`) covers the extracted helper via the new use-case (order, mid-recipe stop + detail, fallback, lock contention); slice guard tests beside `update-slice.test.ts:302-324`; zone menu resolver + Ink smoke in the 3.7 pattern (no pty e2e — non-TTY branch unaffected).

## Tasks & Acceptance

**Execution:**
- [x] `src/core/scripts/service-restart.ts` (+ shared helper from `group-update.ts:741-768`) -- standalone single-service clean restart with per-service lock; unit-test every matrix row without regressing merge/conflict/migration tests.
- [x] `src/adapters/driving/tui/store/slices/update-slice.ts` (+ `update-zone.logic.ts`) -- per-service in-flight map, bidirectional `update-already-running` guards, `restarting` derivation, outcome merging; unit-test guards and derivation.
- [x] `src/adapters/driving/tui/zones/update/update-zone.tsx` (+ row menu dialog beside `update-config-dialog.tsx`) -- `Enter` opens the row menu, choices route to `openSingleServiceConfig` or the new standalone action; pure trigger resolver with unit tests + Ink smoke.
- [x] `src/bin/main.ts` + `src/bin/tui.ts` -- wire the new use-case's ports; CLI `update` entry untouched.

**Acceptance Criteria:**
- Given a service row, when clean restart is triggered, then only that service restarts (recipe or fallback), its row shows `restarting` meanwhile, and the final outcome lands in its last-outcome view.
- Given a service row, when update-this-service is chosen, then the 3.7 config screen opens pre-scoped to that service with identical fields and gate, and confirm runs the standard pipeline for exactly that service.
- Given a running standalone action on one service, when the same service is triggered again (or a group run is fired, or vice versa), then it is rejected `update-already-running`; a different idle service stays triggerable.

## Spec Change Log

## Design Notes

`Enter`-menu over hotkeys is forced by the keybinding contract: every free-looking letter (`r`/`u`/`s`/`l`) is a zone mnemonic and 3.11 owns new bindings — the EDTs zone already proved the menu pattern. Update-this-service needs zero core changes (one-selection group update already filters and gates); only the standalone restart needs core surface, and extracting (not duplicating) the 3.8 branch keeps "never both ports" in one place. Locks key on resolved `repoPath`, matching `matchSelectionItem`'s path-first identity.

## Verification

**Commands:**
- `npm test && npm run typecheck && npm run depcheck` -- expected: all green (AGENTS.md order).
- `node src/bin/cli-back.mjs update` (pipe) -- expected: single JSON line, exit 0/1 only.

## Suggested Review Order

**Standalone restart use-case (entry point)**

- New single-service use-case: per-service lock, manifest load, shared restart step
  [`service-restart.ts:42`](../../../src/core/scripts/service-restart.ts#L42)

- Path-first lock identity shared with the store map and row derivation
  [`service-restart.ts:30`](../../../src/core/scripts/service-restart.ts#L30)

- Extracted 3.8 branch both callers share — never both ports per action
  [`group-update.ts:517`](../../../src/core/scripts/group-update.ts#L517)

**Store guards and status**

- In-flight map, bidirectional guards, outcome merge into last-outcome view only
  [`update-slice.ts:606`](../../../src/adapters/driving/tui/store/slices/update-slice.ts#L606)

- Same-service contention slot preserved while a restart holds it
  [`update-slice.ts:624`](../../../src/adapters/driving/tui/store/slices/update-slice.ts#L624)

- Coarse `restarting` flag slotted below `updating`, above stale errors
  [`update-zone.logic.ts:32`](../../../src/adapters/driving/tui/zones/update/update-zone.logic.ts#L32)

**Zone menu wiring**

- Pure choice routing: update opens pre-scoped config, restart runs standalone, cancel dismisses
  [`update-service-menu-dialog.tsx:67`](../../../src/adapters/driving/tui/zones/update/update-service-menu-dialog.tsx#L67)

- `Enter` opens the row menu; choices dispatch through the pure router
  [`update-zone.tsx:528`](../../../src/adapters/driving/tui/zones/update/update-zone.tsx#L528)

- Rows derive `restarting` from the resolved-path in-flight map
  [`update-zone.tsx:624`](../../../src/adapters/driving/tui/zones/update/update-zone.tsx#L624)

**Tests**

- Core matrix: order, stop-on-failure detail, fallback, contention, blank-path guard
  [`service-restart.test.ts:65`](../../../src/core/scripts/service-restart.test.ts#L65)

- Router matrix, render smoke, restarting glyph and failed-outcome rows
  [`update-service-menu-dialog.test.tsx:14`](../../../src/adapters/driving/tui/zones/update/update-service-menu-dialog.test.tsx#L14)

- Slice guards both directions, per-service concurrency, pinned-shape and confirm-while-restart cases
  [`update-slice.test.ts:1153`](../../../src/adapters/driving/tui/store/slices/update-slice.test.ts#L1153)
