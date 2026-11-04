---
title: 'Story 8.8: Realign Dialog, Shortcut & Settings Defaults'
type: 'feature'
created: '2026-11-02'
status: 'done'
baseline_commit: '59d1a5b478022e7d9298a7ef6e824950df681819'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-8/epic-8-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 8.7 realigns drifted repos only from the CLI with hard-coded defaults; in the TUI the developer sees drift in the Attention block but cannot fix it.

**Approach:** A global realign overlay (`:realign` or `A` on the Dashboard) lists drifted services in an Update-style checkbox table with presets and a restart selector, runs 8.7's `realignServices` with live rows, then summarises; two persisted settings `realign.defaultScope` / `realign.restartMode` seed the dialog and the CLI's absent flags.

## Boundaries & Constraints

**Always:** Rows = drifted candidates only (`listDriftCandidates`, `drift === 'drifted'`), members first then others; columns checkbox (`[x]`/`[ ]` text), service, current branch (`detached` for null), expected branch, `member`/`other` text marker. Presets `Aucun` / `Services de l'EDT` / `Tous` act on listed rows only; initial preset = `settings.realign.defaultScope`; `Space` toggles the cursor row. Restart selector reuses Story 2.44's control, labels and hint (extracted to `tui/shared/`, switch dialog unchanged in behaviour), seeded from `settings.realign.restartMode`, changed for this run only. Confirm runs `realignServices({scope:'none', services:[selected names]})` with `onRow`/`restart.onPhase`; live rows `pending → realigning → [restarting → verifying →] final` with glyph+colour; summary lists non-green first; Dashboard `loadDashboard({queueIfBusy:true})` after the run. Empty selection → confirm disabled with "no service selected". No drift → single "all services are aligned" line, no confirm. Settings group `realign: {defaultScope: none|edt|all = edt, restartMode: none|simple|clean = none}` in `DEFAULT_SETTINGS` + zod schema (invalid → `.catch` default), editable in `:settings`, persisted, read at action start (live). CLI `realign` uses them when `--scope`/`--restart` are absent (settings load moved before defaults; unreadable → existing stderr warning + built-in defaults). Overlay registered in `use-zone-input-active.ts`, app-shell gates, `dialog-registry.tsx`; bounded primitives only. `A` declared in `KEYBINDINGS` (footer + `?` help), active only on the Dashboard; Attention header shows the `[A] realign` hint when ≥1 drift line. Lock/busy errors from the use-case shown as the run's error, TUI stays responsive. French UI labels as in existing dialogs; English code; no story refs in `src/`.

**Ask First:** Changing `realignServices`' signature or row semantics; changing switch dialog behaviour beyond extracting the selector.

**Never:** User-doc changes (`docs/tui-back-manifest.md` is manifest-only; the epic's docs AC is dropped by human decision — `REALIGN_USAGE` / `--help` is the reference); stashing/discarding dirty work from the dialog; writing the dialog's restart choice back to settings; live polling; re-implementing restart phase or drift detection.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Open with drift | 2 drifted members, 1 drifted other, 1 unknown | 3 rows, members first; preset `edt` → 2 members checked | candidates load error → error line + Esc |
| Presets | `Tous` then `Aucun` then Space | all checked → none → cursor row checked | N/A |
| Confirm + clean restart | 2 selected, 1 without container | live rows; restart on the realigned one, other `skipped`; summary non-green first; dashboard refreshed | restart `down` → shown non-green |
| Busy | update/switch holds the lock | run error `realign-blocked-action-in-progress` shown, nothing touched | dialog closable |
| Settings | `realign.restartMode: clean` in file | dialog and CLI default to clean; `--restart none` overrides CLI | bad value → that field defaults silently, rest kept; unreadable file → default + stderr warning |
| `A` without drift / overlay open | no drift, or command bar open | dialog shows aligned line / key ignored | N/A |

</frozen-after-approval>

## Code Map

All TUI paths under `src/adapters/driving/tui/`.

- `src/core/ports/settings.ts:12-20,80-82,114-126` -- `SWITCH_RESTART_MODES`, `cycleSwitchRestartMode`, `Settings.switch`, `DEFAULT_SETTINGS`: add `realign` group; scopes from `REALIGN_SCOPES` (`src/core/realign/index.ts:22-24`) — keep the dependency direction legal (define scope list in ports if core→ports import is required).
- `src/adapters/driven/settings/schema.ts:123-131` -- `switch:` zod block to mirror.
- `store/slices/settings-slice.ts:11-20,~77` -- `SettingsUpdate`, `updateSettings` merge line.
- `shared/settings-screen.tsx:394-462,942-949,1299-1306` -- EDTs-tab `SETTINGS_GROUPS`, footer contexts, cycle keys, render; add two groups (scope, restart).
- `src/adapters/driving/cli/subcommands.ts:88-91,1006-1137` -- `REALIGN_USAGE`, `runRealign`; L1068-1069 hard-coded defaults, L1075-1082 settings load (only when restart ≠ none) to hoist.
- `src/core/realign/index.ts:42-188` -- `RealignServicesParams` (`onRow` per finished row, no start event → mark next selected row `realigning`), `RealignServicesData`; `src/core/dashboard/drift.ts:14-36,100` -- `DriftCandidate`, `listDriftCandidates`.
- `src/core/edt/switch-restart.ts:20-90` -- `RestartRow`, `orderRestartRows`, `summarizeRestartRows`, `restartNeedsAttention`.
- `zones/edts/dialogs/switch-dialog.tsx:51-57,183-186,268-284` -- `RestartModeSelector`, `RESTART_MODE_LABELS/ORDER`, hint: extract to `shared/components/restart-mode-selector.tsx`.
- `zones/edts/dialogs/switch-restart-report.tsx` -- `RESTART_PHASE_BADGES`, `describeRestartRow`, `describeRestartSummary` reuse for restart part.
- `zones/edts/dialogs/branch-plan-table.tsx:20-43` -- `BranchPlanTable` (checkbox table); `zones/update/update-config-panels.tsx:58-76` `tableCells`; `update-config-panels.logic.ts:99-109,194-260` toggle/key resolution patterns.
- `store/slices/reset-slice.ts` + `shared/reset-screen.tsx` -- overlay open flag, busy guard, run, footer context model; `store/slices/edt-slice.ts:365-432` `runSwitchRestart` live-row pattern (claim state before first await, `serviceRestartInFlight`).
- `store/app-store.ts:59-129` -- `AppStoreDeps` (already has every port), slice composition; `store-not-wired` fallback.
- `app-shell.tsx:298-351,421-423` -- overlay gates and render; `shared/hooks/use-zone-input-active.ts` -- overlay list (+ its test).
- `commands/commands.ts:19-117` -- `COMMANDS`, add `realign`.
- `keybindings/keybindings.ts:170-208` + `keybindings/footer-contexts.ts` -- Dashboard declarations, dialog footer context.
- `zones/dashboard/dashboard-zone.tsx:98-162` -- input handler (add `A`); `dashboard-body.tsx:212-237` + `dashboard.logic.ts:145-190` -- Attention header / drift items.
- `shared/test-support/dialog-registry.tsx:69-77` + `shared/bounds/bounds-dialogs.test.tsx` -- register the dialog.
- Tests to mirror: `zones/dashboard/dashboard-zone.interaction.test.tsx`, `shared/reset-screen.test.tsx`, `store/slices/edt-slice.test.ts:440-500`, `shared/settings-screen.test.tsx`, `src/adapters/driven/settings/index.test.ts`, `cli/dispatch.test.ts` (realign).

## Tasks & Acceptance

**Execution:**
- [x] `core/ports/settings.ts`, `driven/settings/schema.ts`, `settings-slice.ts`, `settings-screen.tsx` (+ tests) -- `realign` group, parsing, live update, `:settings` rows -- settings
- [x] `cli/subcommands.ts` (+ `dispatch.test.ts`) -- absent flags fall back to `realign.*`; usage text updated -- FR-36
- [x] `store/slices/realign-slice.ts` (+ test), `app-store.ts` -- open/close, candidates load, selection/preset/restart draft, `runRealign` with live rows, busy guard, dashboard refresh -- state
- [x] `shared/components/restart-mode-selector.tsx`, `switch-dialog.tsx` -- extract selector, switch tests green -- reuse
- [x] `shared/realign-dialog.tsx` (+ `.logic.ts`, tests), `dialog-registry.tsx`, `use-zone-input-active.ts`, `app-shell.tsx`, `footer-contexts.ts` -- selection table, presets, Space, restart selector, confirm/disabled reason, results view, empty state -- dialog
- [x] `commands/commands.ts`, `keybindings.ts`, `dashboard-zone.tsx`, `dashboard-body.tsx` (+ tests) -- `:realign`, `A` shortcut, Attention hint -- entry points
- [x] `sprint-status.yaml` -- 8-8 `in-progress` → `review` at the end -- tracking

**Acceptance Criteria:**
- Given `?` help or the Dashboard footer, when drift exists, then `[A] realign` is listed, with no collision with `R`, `Ctrl+O/R/L`, `e`, `a`.
- Given every new component, when the bounds dialog matrix runs, then rendering stays within the terminal at every size.
- Given `npm test`, `npm run typecheck`, `npm run depcheck`, then all pass.

## Design Notes

`realignServices` re-reads drift under the lock, so the dialog passes only names with `scope:'none'`; a row that became aligned comes back `unchanged`. Live phase: on open of the run, all selected rows `pending`, first `realigning`; each `onRow` finalises its row and promotes the next. Restart rows are appended under the realign rows via `onPhase`.

## Verification

**Commands:**
- `npm test` -- expected: all green
- `npm run typecheck` -- expected: no errors
- `npm run depcheck` -- expected: no violations

**Manual checks:**
- `node src/bin/tui-back.mjs` → `:realign` and `A` on the Dashboard open the dialog; `:settings` shows the two realign settings.

## Suggested Review Order

**Realign run (store slice)**

- Entry point: claim the run before any await, guard restart ports and in-flight restarts, stream rows.
  [`realign-slice.ts:212`](../../src/adapters/driving/tui/store/slices/realign-slice.ts#L212)

- Open re-reads drifted candidates and captures both settings defaults at the same moment.
  [`realign-slice.ts:156`](../../src/adapters/driving/tui/store/slices/realign-slice.ts#L156)

- Finalises a row by service and promotes the next pending one; unmatched rows are dropped.
  [`realign-slice.ts:83`](../../src/adapters/driving/tui/store/slices/realign-slice.ts#L83)

- Presets act on listed rows only; the matching preset is derived back from the selection.
  [`realign-slice.ts:64`](../../src/adapters/driving/tui/store/slices/realign-slice.ts#L64)

**Dialog**

- Overlay input: toggle, preset cycle, restart cycle, confirm; inert while a run is in flight.
  [`realign-dialog.tsx:79`](../../src/adapters/driving/tui/shared/realign-dialog.tsx#L79)

- One row budget split between realign and restart lists so the run view stays bounded.
  [`realign-dialog.tsx:50`](../../src/adapters/driving/tui/shared/realign-dialog.tsx#L50)

- Pure key resolution and disabled-confirm reason on an empty selection.
  [`realign-dialog.logic.ts:63`](../../src/adapters/driving/tui/shared/realign-dialog.logic.ts#L63)

- Summary ordering: non-green rows first.
  [`realign-dialog.logic.ts:146`](../../src/adapters/driving/tui/shared/realign-dialog.logic.ts#L146)

- Restart selector extracted from the switch dialog, wording passed by each caller.
  [`restart-mode-selector.tsx:19`](../../src/adapters/driving/tui/shared/components/restart-mode-selector.tsx#L19)

**Settings & CLI defaults**

- New `realign` group, scope list and cycle helper live in the settings port.
  [`settings.ts:22`](../../src/core/ports/settings.ts#L22)

- Per-field `.catch` fallback keeps the rest of the file on a bad value.
  [`schema.ts:134`](../../src/adapters/driven/settings/schema.ts#L134)

- CLI loads settings lazily, only when a flag is absent or a restart needs concurrency.
  [`subcommands.ts:1085`](../../src/adapters/driving/cli/subcommands.ts#L1085)

- `:settings` EDTs tab cycles both realign values and persists them.
  [`settings-screen.tsx:973`](../../src/adapters/driving/tui/shared/settings-screen.tsx#L973)

**Entry points & overlay ownership**

- `A` on the Dashboard opens the dialog; `a`, `R`, `E/e` keep their actions.
  [`dashboard-zone.tsx:142`](../../src/adapters/driving/tui/zones/dashboard/dashboard-zone.tsx#L142)

- Declared keybinding with a `drift` footer condition, feeding footer and `?` help.
  [`keybindings.ts:192`](../../src/adapters/driving/tui/keybindings/keybindings.ts#L192)

- Attention header offers `[A] realign` only with a drift line.
  [`dashboard-body.tsx:222`](../../src/adapters/driving/tui/zones/dashboard/dashboard-body.tsx#L222)

- Overlay registered as a keyboard owner, and gated/rendered in the shell.
  [`use-zone-input-active.ts:18`](../../src/adapters/driving/tui/shared/hooks/use-zone-input-active.ts#L18)
  [`app-shell.tsx:429`](../../src/adapters/driving/tui/app-shell.tsx#L429)

- `:realign` command.
  [`commands.ts:64`](../../src/adapters/driving/tui/commands/commands.ts#L64)

**Tests**

- Slice: selection, presets, live rows, restart, refusals, partial rows.
  [`realign-slice.test.ts:1`](../../src/adapters/driving/tui/store/slices/realign-slice.test.ts#L1)

- Real keypresses in the dialog.
  [`realign-dialog.interaction.test.tsx:1`](../../src/adapters/driving/tui/shared/realign-dialog.interaction.test.tsx#L1)

- Render states, empty selection, aligned view, summary.
  [`realign-dialog.test.tsx:1`](../../src/adapters/driving/tui/shared/realign-dialog.test.tsx#L1)
