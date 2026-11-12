---
title: 'Live Per-Service Run Tracking — Current Step & Issue Log'
type: 'feature'
created: '2026-09-28'
status: 'done'
baseline_commit: '2f7ab70085a5f35f5a4ae5a4f9fba93897cc1aac'
review_loop_iteration: 0
context: [_bmad-output/implementation-artifacts/epic-3-context.md]
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** During a group update the Update zone shows only a coarse `updating` flag — a developer cannot tell whether a service is pulling, merging, migrating, or restarting, nor which problem still needs attention without waiting for the end-of-run summary.

**Approach:** Add a live per-service tracking layer: core emits the current phase per service through an optional callback, the store keeps a live phase map plus a per-service issue log (unresolved → resolved on re-verify), and the detail pane renders that live view while a run targets the selected service, falling back to the last-outcome view afterwards.

## Boundaries & Constraints

**Always:** All core returns are `Result<T>` with kebab-case error codes (AD-3). Core never imports from adapters (AD-1); relative imports end in `.js` with imports-first-in-file. Merge stays `git merge`, never rebase; existing detect → act → re-verify mechanics (3.4) unchanged. Live run state lives in the Zustand store, zone-local UI state in `useState`. TUI calls core use-cases in-process, never spawns the CLI. Status glyphs reuse the closed `StatusBadge` set (`updating`/`migrating`/`error` already defined).

**Ask First:** If the live phase vocabulary should differ from `pulling` / `merging` / `migrating` / `restarting`; if the issue log must persist beyond the run (vs cleared per run); if the standalone single-service restart (3.9) must also emit live phases through the same channel — HALT and ask before proceeding.

**Never:** No `commands.ts`/`keybindings.ts` entries and no new global keys (Story 3.11 owns commands). No change to the 3.7 config screen, the manifest schema, pull/merge/migrate/restart behavior, or `ContainerPort.restart`'s signature. No per-service toggle overrides. No new CLI flags (CLI call sites pass no-op callbacks). No auto-return change after a run (3.6 rule stays).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Live step, selected service | Run in progress, service S targeted, phase = pulling | Detail pane shows current step `pulling` live for S, replacing last-outcome view | N/A |
| Phase transitions | S moves pulling → merging → migrating → restarting | Detail pane follows each transition live; list glyph shows `updating`, or `migrating` while in migrate phase | N/A |
| Blocker raised | S hits dirty/conflict, `onUpdateBlocker` fires | Issue log appends entry `{kind, detail, resolved:false}` marked unresolved; guided menu still renders in front of detail pane | N/A |
| Blocker resolved in-run | Developer acts, tool re-verifies success | Same entry flips to `resolved:true`; live step resumes | Failed re-verify keeps `resolved:false` |
| Migration failure | `migration.run` fails for S | Issue entry `{kind:migration-failed, detail, resolved:false}`; service ends `failed`, entry stays unresolved (re-trigger via 3.9) | Same per-service failure reporting as today |
| Run completes | Run done, revisit S | Detail pane reverts to final per-service outcome (3.6 idle view); live phase cleared | N/A |
| Unselected service | Run in progress, service T not selected | T's live state still tracked in store; rendered when selected | N/A |

</frozen-after-approval>

## Code Map

- `src/core/scripts/group-update.ts:123-150,190-196` — `GroupUpdateParams` (`onUpdateBlocker:149`) + `groupUpdate()` entry; add optional `onPhase` beside the blocker seam, thread through EDT/all-repos loops (`266-298`, `447-466`) into `updateWithLoadedManifest:617-631` phase boundaries (pull `705-731` / fetch+merge `733-762` / migrate `773-781` / restart `785-788`).
- `src/core/scripts/group-update.ts:517-541` — `runRestartStep` shared helper (recipe vs fallback); emit `restarting` phase from here so both group and standalone paths share it.
- `src/core/scripts/service-restart.ts:22-28,42-79` — standalone restart; accept and forward the same optional phase callback (or document why out of scope per Ask First).
- `src/adapters/driving/tui/store/slices/update-slice.ts:55-65,110,126-130,406-506,606-670` — add `liveServicePhase: Record<service, LivePhase>` + `liveServiceIssues: Record<service, ServiceIssue[]>`; set/clear in `runGroupUpdate` (set `running:431-441`, wire callbacks `467-472`, merge outcomes `484`, clear live maps on `done/error:475-492`); mirror for `runServiceRestart:637,661-668`.
- `src/adapters/driving/tui/zones/update/update-zone.logic.ts:28-44,70-80` — extend derivation: targeted + live phase present → return phase glyph (`migrating` now produced for the first time); add `formatLiveServiceDetail(phase, issues)` beside `formatServiceOutcomeDetail:70-80`.
- `src/adapters/driving/tui/zones/update/update-zone.tsx:619-658` — detail pane currently `formatServiceOutcomeDetail:641` + running spinner `643-658`; prefer live view when `updateStatus==='running'` and the selected service is targeted; keep blocker `ModalDialog:719-728` rendering in front.
- `src/adapters/driving/tui/shared/components/status-badge.tsx:4-41` — closed set already contains `updating ⇄` / `migrating ⇒` / `error ✖`; no badge change expected.
- Tests: core fake matrix beside `group-update.test.ts` + `service-restart.test.ts:65`; slice guards beside `update-slice.test.ts:302-324,1153`; zone pure logic + Ink smoke in the 3.6/3.7 pattern (no pty e2e).

## Tasks & Acceptance

**Execution:**
- [x] `src/core/scripts/group-update.ts` (+ `service-restart.ts`) -- optional `onPhase(service, phase)` callback (`pulling`/`merging`/`migrating`/`restarting`), emitted at phase boundaries, never throwing into the pipeline; unit-test order, mid-recipe stop, and no-callback default without regressing merge/conflict/migration tests.
- [x] `src/adapters/driving/tui/store/slices/update-slice.ts` -- live phase map + per-service issue log (unresolved on blocker/migration-failure, resolved on in-run re-verify success, cleared per run); wire both callbacks in `runGroupUpdate` and the standalone path; unit-test guards and transitions.
- [x] `src/adapters/driving/tui/zones/update/update-zone.logic.ts` + `update-zone.tsx` -- live detail view (current step + issue log with resolved/unresolved marking) replacing last-outcome view while targeted; `migrating` glyph derivation; pure formatter with unit tests + Ink smoke.
- [x] `src/bin/main.ts` + `src/bin/tui.ts` -- wire new callbacks (CLI passes no-ops); CLI `update` output unchanged.

**Acceptance Criteria:**
- Given a run in progress, when a targeted service is selected, then its detail pane shows the current step (pulling / merging / migrating / restarting) live.
- Given a service hits a problem, when shown in its detail pane, then it is marked unresolved until acted on and resolved once re-verified.
- Given a run completes, when revisiting a covered service, then its detail pane shows the final per-service outcome matching the idle-state view.

## Spec Change Log

## Design Notes

`onPhase` mirrors the existing `onUpdateBlocker` seam rather than inventing an event bus: one optional callback, set by the store, no-op by default, never allowed to throw into the pipeline. The issue log is store-side derivation (blocker fired → unresolved entry; re-verify success → resolved), not core state — core keeps emitting today's `Result` rows unchanged, so the end-of-run summary cannot regress. `migrating` finally gets produced here by design (3.6 reserved it in the type but never emitted it).

## Verification

**Commands:**
- `npm test && npm run typecheck && npm run depcheck` -- expected: all green (AGENTS.md order).

## Suggested Review Order

**Live-phase seam (core entry point)**

- One optional callback mirroring onUpdateBlocker — start here for design intent
  [`group-update.ts:175`](../../../src/core/scripts/group-update.ts#L175)

- Throw- and rejection-proof emission keeps driving bugs out of pipeline
  [`group-update.ts:184`](../../../src/core/scripts/group-update.ts#L184)

- Pulling versus merging signals around the pull / fetch-merge fork
  [`group-update.ts:757`](../../../src/core/scripts/group-update.ts#L757)

- Migrating signal plus the shared failure code both layers use
  [`group-update.ts:830`](../../../src/core/scripts/group-update.ts#L830)

- Restarting emitted once inside the shared helper both paths call
  [`group-update.ts:565`](../../../src/core/scripts/group-update.ts#L565)

- Standalone restart forwards the identical channel, no second mechanism
  [`service-restart.ts:47`](../../../src/core/scripts/service-restart.ts#L47)

**Store live maps**

- Unresolved-on-blocker, resolved-on-next-phase derivation helpers
  [`update-slice.ts:157`](../../../src/adapters/driving/tui/store/slices/update-slice.ts#L157)

- Group-run wiring: blocker appends entries, each phase resolves them
  [`update-slice.ts:532`](../../../src/adapters/driving/tui/store/slices/update-slice.ts#L532)

- Migration failures derived at completion; phase map clears with run
  [`update-slice.ts:549`](../../../src/adapters/driving/tui/store/slices/update-slice.ts#L549)

- Standalone restart opens with a fresh log, clears only its key
  [`update-slice.ts:744`](../../../src/adapters/driving/tui/store/slices/update-slice.ts#L744)

**Zone rendering**

- Live detail replaces last-outcome view while service is targeted
  [`update-zone.tsx:604`](../../../src/adapters/driving/tui/zones/update/update-zone.tsx#L604)

- Migrate phase finally produces the long-reserved migrating glyph
  [`update-zone.logic.ts:39`](../../../src/adapters/driving/tui/zones/update/update-zone.logic.ts#L39)

- Live formatter with starting fallback and one-row-per-issue sanitizing
  [`update-zone.logic.ts:107`](../../../src/adapters/driving/tui/zones/update/update-zone.logic.ts#L107)

**Peripherals**

- CLI passes no observer — output envelope unchanged, no new flags
  [`subcommands.ts:173`](../../../src/adapters/driving/cli/subcommands.ts#L173)

- Core matrix: phase order, throwing/async observers, early-exit silence
  [`group-update.test.ts:2233`](../../../src/core/scripts/group-update.test.ts#L2233)

- Slice guards: visibility, resolve, dedupe, migration entries, clearing
  [`update-slice.test.ts:1430`](../../../src/adapters/driving/tui/store/slices/update-slice.test.ts#L1430)

- Zone smoke: live detail, starting fallback, standalone restart rendering
  [`update-zone.test.tsx:899`](../../../src/adapters/driving/tui/zones/update/update-zone.test.tsx#L899)
