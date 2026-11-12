---
title: 'Pre-Run Configuration Interface'
type: 'feature'
created: '2026-09-23'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'e560a34ba6876d1433069192d027d5358ba2bed6'
context: [_bmad-output/implementation-artifacts/epic-3-context.md]
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Every group update today is fixed all-or-nothing: EDT scope touches all members, all-repos touches everything, with the manifest's `sharedBranch` and no control over migrations or restart depth.

**Approach:** Open one shared configuration screen before any git/docker action runs: service checklist pre-selected per trigger scope, per-service source branch defaulting to the manifest's `sharedBranch`, plus two run-wide toggles (migrate, clean restart); confirm starts the run with exactly that configuration.

## Boundaries & Constraints

**Always:** All core returns are `Result<T>` with kebab-case error codes (AD-3). Core never imports from adapters (AD-1); relative imports end in `.js` with imports-first-in-file. Extend `group-update.ts`, never replace it — merge/conflict-resolution logic and existing tests must not regress. Every targeted service appears in `data.results` as `updated`/`skipped`/`failed`; deselected services are excluded entirely (not reported). Toggles apply uniformly to all selected services, no per-service override in v1. Merge stays `git merge`, never rebase; `assertAllowedBranch` gating unchanged. Second run while one is in progress is rejected (`update-already-running`), per scope and per single service. CLI and TUI call the identical core use-case; the CLI call site follows the new signature with no new flags. Live run state lives in the Zustand store, zone-local UI state in `useState`.

**Ask First:** If resolving a user-typed branch needs anything beyond `git rev-parse --verify` / existing branch-listing adapters; if the migrate toggle default should be anything but ON or clean-restart default anything but OFF; if the config screen needs anything beyond a `ModalDialog`-hosted list reusing `CheckboxListItem` + `TextInputLine`/`BranchPicker` patterns — HALT and ask before proceeding.

**Never:** No `restartCommands` recipe execution (story 3.8 — the clean-restart toggle is accepted and plumbed now but still performs today's plain container restart until 3.8 lands). No live per-step detail pane (story 3.10 — confirm hands off to today's run/summary rendering inside the 3.6 shell). No new commands or keybindings (story 3.11 — the screen is invoked from today's `Enter`/`a` triggers plus a reusable pre-scoped entry point for 3.9). No per-service toggle overrides, no retry-limit logic, no CLI prompting — non-TTY output stays exactly one JSON line.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Open config EDT | `Enter` with active EDT | Modal lists every member service, all `[x]`, branch = manifest `sharedBranch` | No git/docker ran yet |
| Open config all-repos | `a` trigger | Modal lists every managed repo, all `[x]`, branch = manifest `sharedBranch` | Same gate as above |
| Open config single | Pre-scoped to one service (3.9 reuse) | Only that service `[x]`, same fields and toggles | Same gate |
| Edit branch | Selected service, branch field edited | Any resolvable branch accepted as that service's merge source | Unresolvable branch rejected with explicit message, run not started |
| Toggles | Space on migrate / clean-restart rows | Uniform ON/OFF for all selected services | N/A |
| Deselect all | All `[ ]`, confirm pressed | Confirm rejected with explicit message, screen stays open | Same no-op guarantee as FR-10 zero-member EDT |
| Confirm subset | >=1 selected, confirm | Run starts immediately with exactly that config, no further prompt | N/A |
| Second run | Run in progress, trigger again | Rejected `update-already-running` | Per scope and per single service |

</frozen-after-approval>

## Code Map

- `src/core/scripts/group-update.ts:64,120,128,221` — `GroupUpdateParams`/`GroupUpdateScope`/`groupUpdate()`/`groupUpdateAll`/`groupUpdateEdt`; add `selection?: {service, repoPath?, sourceBranch?}[]`, `runMigrations?: boolean` (default true), `cleanRestart?: boolean` (default false, plain restart until 3.8); filter enumeration to selection, use per-service `sourceBranch` instead of enforced `member.branch`.
- `src/core/ports/manifest.ts:6` + `src/adapters/driven/manifest/schema.ts:23` — `sharedBranch` default `development` is the per-row branch default; loader `src/adapters/driven/manifest/index.ts:18`; service enumeration via `src/core/scripts/list-repos.ts:31` joined with active EDT `members[]` (`src/core/ports/edt-registry.ts:14`).
- `src/adapters/driving/tui/zones/update/update-zone.tsx:240,426,440,529` — 3.6 shell (`ListDetailSplit`, `BoundedList`, quit/all/blocker `ModalDialog`s, `Enter`→`runGroupUpdate()` L397, `a`→all-confirm L393); host the config `ModalDialog` here, blocking input like `zoneInputCaptured` L324.
- `src/adapters/driving/tui/zones/update/update-zone.logic.ts:19,43,50` — `deriveUpdateServiceStatus`/`partitionUpdateServiceRows`; reuse partition for config row order (members first).
- `src/adapters/driving/tui/store/slices/update-slice.ts:82,142` — `createUpdateSlice`/`runGroupUpdate(scope)`; add `openUpdateConfig(scope | {service})` + `confirmUpdateConfig(selection, runMigrations, cleanRestart)` threading new params; keep `update-already-running` guard L151.
- `src/adapters/driving/tui/shared/components/checkbox-list-item.tsx:32` + `zones/edts/edts-zone.logic.ts:245` — `CheckboxListItem` (`[x]`/`[ ]`) + `toggleMemberSelection` (Space) reuse; branch fields via `shared/components/text-input-line.tsx:28` + `edts-zone.logic.ts:202 nextTextInputValue`, or `BranchPicker` (`zones/edts/branch-picker.tsx:91`); confirm gate via `shared/components/modal-dialog.tsx:14` following `create-dialog.tsx:84` validation style (zero-selection reject mirrors inverse of its zero-member default).
- `src/adapters/driving/cli/subcommands.ts:132` + `src/bin/main.ts:22` + `src/bin/tui.ts:79` — `update` bare-only entry and both composition roots; update call site to new signature (`runMigrations: true, cleanRestart: false`, full default selection), no new flags.
- Tests: `src/core/scripts/group-update.test.ts:1` fake-port matrix (add selection/toggle cases); TUI Ink smoke-tests only for the screen per epic context.

## Tasks & Acceptance

**Execution:**
- [x] `src/core/scripts/group-update.ts` (+ `group-update.test.ts` vs fake ports) -- accept selection + `runMigrations`/`cleanRestart` params, filter targets, per-service source branch merge, migrate gated by toggle, cleanRestart still plain restart; unit-test every I/O-matrix row without regressing merge/conflict tests.
- [x] `src/adapters/driving/tui/store/slices/update-slice.ts` (+ `zones/update/update-zone.tsx`, new `zones/update/update-config-dialog.tsx` + `.logic.ts` as needed) -- config modal with checklist, branch fields, two toggles, zero-selection reject, confirm → `runGroupUpdate` with exact config; pre-scope entry point for edt/all/single reuse.
- [x] `src/adapters/driving/cli/subcommands.ts` (+ `src/bin/main.ts`, `src/bin/tui.ts` wiring) -- follow new signature with defaults preserving 3.1+3.2 behavior; keep bare-`update` arg rejection; extend `src/bin/tui-back.e2e.test.ts` for the new params path.

**Acceptance Criteria:**
- Given any group-update trigger, when it fires, then the config screen opens before any git/docker action with every targeted service pre-selected and branch pre-filled from `sharedBranch`.
- Given a confirmed run with a service deselected, when the run completes, then that service was never touched and is absent from `data.results`.
- Given zero services selected, when confirm is pressed, then it is rejected with an explicit message and nothing ran.
- Given `runMigrations` off, when the run completes, then no `migration.run` executed even for services declaring `migrationCommand`.
- Given a second trigger while a run is in progress, when it fires, then it is rejected `update-already-running`.

## Verification

**Commands:**
- `npm test && npm run typecheck && npm run depcheck` -- expected: all green (AGENTS.md order).
- `node src/bin/cli-back.mjs update` (pipe) -- expected: single JSON line, exit 0/1 only.

## Suggested Review Order

**Core selection model**

- Start here: the confirmed-configuration contract every layer threads through
  [`group-update.ts:116`](../../../src/core/scripts/group-update.ts#L116)

- Trimmed branch override wins over `sharedBranch`, single normalization point
  [`group-update.ts:63`](../../../src/core/scripts/group-update.ts#L63)

- Pre-lock local branch validation rejects unknown branches before any write
  [`group-update.ts:73`](../../../src/core/scripts/group-update.ts#L73)

- All-repos narrowing drops deselected services entirely, never silently
  [`group-update.ts:327`](../../../src/core/scripts/group-update.ts#L327)

- Per-service merge source flows into the unchanged pull-or-merge flow
  [`group-update.ts:587`](../../../src/core/scripts/group-update.ts#L587)

**Store draft lifecycle**

- One helper opens every pre-scoped draft and clears stale run banners
  [`update-slice.ts:189`](../../../src/adapters/driving/tui/store/slices/update-slice.ts#L189)

- Confirm restores the draft inline on pre-lock rejections, no lost edits
  [`update-slice.ts:521`](../../../src/adapters/driving/tui/store/slices/update-slice.ts#L521)

- Scope resolution propagates failures instead of silently downgrading gates
  [`update-slice.ts:356`](../../../src/adapters/driving/tui/store/slices/update-slice.ts#L356)

**Zone wiring**

- Pure trigger resolver keeps unconfigured runs impossible and tested
  [`update-zone.tsx:146`](../../../src/adapters/driving/tui/zones/update/update-zone.tsx#L146)

- Cursor reset fires on open-transition only, never on draft edits
  [`update-zone.tsx:380`](../../../src/adapters/driving/tui/zones/update/update-zone.tsx#L380)

- Dispatch opens config first, nothing runs before confirm
  [`update-zone.tsx:477`](../../../src/adapters/driving/tui/zones/update/update-zone.tsx#L477)

**Peripherals**

- CLI takes full defaults with no new flags, both scopes
  [`subcommands.ts:153`](../../../src/adapters/driving/cli/subcommands.ts#L153)

- Full selection/toggle matrix against fake ports, strict ordering
  [`group-update.test.ts:1734`](../../../src/core/scripts/group-update.test.ts#L1734)

- Black-box defaults anchors for bare and `--all --yes` invocations
  [`tui-back.e2e.test.ts:1824`](../../../src/bin/tui-back.e2e.test.ts#L1824)
