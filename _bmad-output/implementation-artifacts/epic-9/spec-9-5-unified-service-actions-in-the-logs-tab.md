---
title: 'Unified Service Actions in the Logs Tab'
type: 'feature'
created: '2026-11-05'
status: 'done'
baseline_commit: 'aa26fbfba8d3f10336e12b2548084c4f5407dae7'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-9-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Logs tab only offers hard-wired `R` (restart per `logs.restartMode`) and `O` (open in IDE), with their own availability checks in `logs-zone.tsx`. The terminals and the explicit simple/clean restarts are reachable only from the Dashboard (FR-40).

**Approach:** Lowercase `a` on the focused Logs pane (sub-focused grid pane or fullscreen) opens a `MenuList` modal of the registry's actions for that service, with disabled reasons; Enter runs the chosen one. `R` and `O` become shortcuts resolved through the same registry.

## Boundaries & Constraints

**Always:**
- Key `a` (decided by the user 2026-11-05) opens the menu; panes only, never from the service lists. `↑/↓`/Home/End move, Enter runs an enabled row, Esc closes. The menu captures every key while open (same `dialogOpen` path as the filter editor).
- Rows come from `ServiceActions.list(repoPath, { blockingLocks: restartBlockingLocks(activeEdt) })`, in registry order, label + key as note, disabled rows show the reason. A loading state while listing; a list failure shows one error line.
- Running re-lists right before executing and fails closed (Dashboard `runDashboardServiceAction` precedent): a now-disabled action does not run.
- `R`: maps `logs.restartMode` to `restart-simple`/`restart-clean`. Decided by the user 2026-11-05: when `restart-clean` is disabled **only** with reason `no clean recipe`, `R` uses the `restart-simple` entry and the pane shows the existing `NO_CLEAN_RECIPE_NOTICE`. `O` maps to `open-in-ide`.
- A shortcut or menu choice on a disabled action shows its reason as the pane notice (no silent no-op).
- Terminal choices call the existing `openTerminal(repoPath, kind, service)`; the overlay then owns the keys over Logs (grid or fullscreen).
- Footer and `?` rows come from `FOOTER_CONTEXTS`/`KEYBINDINGS`; AD-19 bounded rendering.

**Ask First:** changing registry ids/keys/availability rules, `MenuList`/`ModalDialog` props, or the terminal slice contract.

**Never:** availability rules in `logs-zone.tsx` (no `health`/`noContainer` checks for actions there); a second restart mechanism; Dashboard behaviour changes; the `Ctrl+O/R/L/T/X` combos in Logs.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Menu | `a` on a pane with a running container | 5 rows: Open in IDE, Restart, Clean restart, Terminal, Container terminal | N/A |
| Container-less | `a` on a no-container pane | Restart, Clean restart, Container terminal disabled, note `no container` | Enter on them: ignored |
| Run restart | Enter on Clean restart | menu closes, pane shows restarting, then health re-polled | failure → pane `streamError` (today's path) |
| Terminal | Enter on Terminal | menu closes, terminal overlay opens on the repo | unwired shell → overlay error line |
| `R` clean, no recipe | `restartMode=clean`, empty recipe | simple restart + `no clean-restart recipe — simple restart` notice | N/A |
| `R` blocked | group update lock held | no restart; pane notice `group update` | N/A |
| `R` no container | container-less pane | no restart; pane notice `no container` | N/A |
| List fails | `list` errors/rejects | menu shows one error line, Esc closes | never throws |
| No ports | restart ports unwired | menu shows an error line; `O` still opens via editor port | existing `openInIde` fallback |

</frozen-after-approval>

## Code Map

- `src/core/service-actions/index.ts:186` -- `list()`: the 5 entries and reasons; `NO_CLEAN_RECIPE_NOTICE` L118; `restartBlockingLocks` L107. Read-only.
- `src/adapters/driving/tui/store/slices/logs-slice.ts:202` -- slice's `serviceActions` (already has `docker`); `restartLogsPane` L676 (mode read from settings at L695, slice-side concurrency guard L686 — keep), `openLogsPaneInIde` L716; interface L143-150.
- `src/adapters/driving/tui/store/slices/dashboard-slice.ts:52-64,108-133,216-245` -- `RESTART_MODES`/`TERMINAL_KINDS`/`RESTART_LABELS` maps, `fetchActions`, fresh re-list + fail-closed precedent. Move the two id maps to a shared module rather than copy.
- `src/adapters/driving/tui/zones/logs/logs-zone.tsx:602-622` (fullscreen) and `804-825` (grid) -- `R`/`O` handlers with duplicated availability checks to replace; `dialogOpen` L270 (add menu); footer context L276; filter-editor mount L982 (mount menu likewise).
- `src/adapters/driving/tui/zones/logs/logs-zone.logic.ts:389` -- `logsFooterContext` (menu context first); `logsLegendHints` L413 (add `a`).
- `src/adapters/driving/tui/zones/update/update-service-menu-dialog.tsx` -- `ModalDialog` + service name + `MenuList` view precedent; `shared/components/menu-list.tsx` `resolveMenuKey`.
- `src/adapters/driving/tui/keybindings/footer-contexts.ts:141-190` -- logs contexts; `keybindings.ts:246-253` `R`/`O (Logs)` rows.
- `src/adapters/driving/tui/shared/test-support/dialog-registry.tsx` -- every `ModalDialog` source must be registered (coverage test).
- `_bmad-output/planning-artifacts/ux-designs/ux-tui-back-2026-08-10/EXPERIENCE.md:30` -- Logs row.

## Tasks & Acceptance

**Execution:**
- [x] `src/adapters/driving/tui/store/slices/service-action-ids.ts` (+ dashboard-slice import) -- export `RESTART_MODES`, `TERMINAL_KINDS` -- one id→behaviour map for both consumers.
- [x] `src/adapters/driving/tui/store/slices/logs-slice.ts` (+ test) -- `listLogsPaneActions(repoPath)` → `ServiceAction[] | null`; `runLogsPaneAction(repoPath, actionId, service)` (fresh list, fail closed, disabled → pane notice reason, dispatch to IDE / `restartLogsPane(repoPath, mode)` / `openTerminal`); `runLogsPaneShortcut(repoPath, 'restart' | 'ide', service)` with the clean→simple fallback; `restartLogsPane` takes an optional mode -- registry-driven actions in one place.
- [x] `src/adapters/driving/tui/zones/logs/logs-actions-menu.tsx` (+ test) -- pure `toMenuItems(actions)` and the modal view (title `SERVICE ACTIONS`, service name, loading/error line) -- testable mapping.
- [x] `src/adapters/driving/tui/zones/logs/logs-zone.tsx` (+ interaction test) -- local menu state `{repoPath, service, cursor, actions|null, error}`; `a` opens it in grid and fullscreen; key routing via `resolveMenuKey`; `R`/`O` call `runLogsPaneShortcut`; remove the zone-side availability checks.
- [x] `src/adapters/driving/tui/zones/logs/logs-zone.logic.ts`, `keybindings/footer-contexts.ts`, `keybindings/keybindings.ts` (+ tests) -- context `logs-actions-menu` (move/run/close); `a` in fullscreen contexts and the legend; `a (Logs)` help row.
- [x] `src/adapters/driving/tui/shared/test-support/dialog-registry.tsx` -- fixtures: loading, five rows with long `LONG_TEXT` reasons, error.
- [x] `EXPERIENCE.md` -- Logs row: `a` actions menu, `R`/`O` shortcuts through the registry.
- [x] Unit-test every I/O matrix row (slice tests for `R`/run paths, zone tests for the menu).

**Acceptance Criteria:**
- Given an open actions menu, when `q`, `:` or a zone mnemonic is typed, then nothing global fires.
- Given `logs-zone.tsx` after the change, then it contains no `noContainer`/`health` condition guarding `R`/`O`.
- Given `npm test && npm run typecheck && npm run depcheck`, then all pass, bounded-rendering and dialog-registry guards included.

## Spec Change Log

## Design Notes

`R` fallback, in the slice:

```ts
const wanted = mode === 'clean' ? 'restart-clean' : 'restart-simple';
let entry = fresh.find((a) => a.id === wanted);
if (entry && !entry.availability.available && entry.availability.reason === 'no clean recipe') {
  entry = fresh.find((a) => a.id === 'restart-simple'); // restart(simple) + NO_CLEAN_RECIPE_NOTICE
}
```

## Verification

**Commands:**
- `npm test` -- expected: all green
- `npm run typecheck && npm run depcheck` -- expected: no errors

**Manual checks:**
- `node src/bin/tui-back.mjs`: Logs, open a pane, `a` → menu; run Terminal, Restart; `R`/`O` in grid and fullscreen; a container-less pane.

## Suggested Review Order

**Registry-driven pane actions (entry point)**

- The `R`/`O` shortcut: mode → registry entry, clean→simple fallback on the named reason.
  [`logs-slice.ts:858`](../../../src/adapters/driving/tui/store/slices/logs-slice.ts#L858)

- Menu choice: fresh re-list, fail closed, disabled → named notice; IDE skips the re-list.
  [`logs-slice.ts:841`](../../../src/adapters/driving/tui/store/slices/logs-slice.ts#L841)

- One dispatcher from a registry entry to IDE / restart / terminal.
  [`logs-slice.ts:507`](../../../src/adapters/driving/tui/store/slices/logs-slice.ts#L507)

- Re-list helper: missing id or closed pane ends with a notice, never silently.
  [`logs-slice.ts:532`](../../../src/adapters/driving/tui/store/slices/logs-slice.ts#L532)

- Slice-side restart guard keeps the Docker-`restarting` rule the zone used to own.
  [`logs-slice.ts:561`](../../../src/adapters/driving/tui/store/slices/logs-slice.ts#L561)

- The no-recipe reason is a named core constant, not a string the slice guesses.
  [`index.ts:122`](../../../src/core/service-actions/index.ts#L122)

**Actions menu in the zone**

- `a` opens the menu on the fullscreen pane / the sub-focused grid pane.
  [`logs-zone.tsx:701`](../../../src/adapters/driving/tui/zones/logs/logs-zone.tsx#L701)

- Sequenced listing: a stale result from an earlier open is dropped.
  [`logs-zone.tsx:403`](../../../src/adapters/driving/tui/zones/logs/logs-zone.tsx#L403)

- Menu keys via the shared `resolveMenuKey`; functional cursor updates.
  [`logs-zone.tsx:470`](../../../src/adapters/driving/tui/zones/logs/logs-zone.tsx#L470)

- Registry entries → menu rows; Logs keys (`O`, `R`) as notes, reasons on disabled rows.
  [`logs-actions-menu.tsx:50`](../../../src/adapters/driving/tui/zones/logs/logs-actions-menu.tsx#L50)

- Reserved rows follow the rendered content, not a fixed height.
  [`logs-actions-menu.tsx:34`](../../../src/adapters/driving/tui/zones/logs/logs-actions-menu.tsx#L34)

**Shared ids & key declarations**

- Id → behaviour maps shared by the Dashboard and Logs.
  [`service-action-ids.ts:7`](../../../src/adapters/driving/tui/store/slices/service-action-ids.ts#L7)

- Menu footer context, chosen ahead of the fullscreen/filter ones.
  [`footer-contexts.ts:149`](../../../src/adapters/driving/tui/keybindings/footer-contexts.ts#L149)

- `a (Logs)` help and footer row.
  [`keybindings.ts:254`](../../../src/adapters/driving/tui/keybindings/keybindings.ts#L254)

**Peripherals**

- Slice tests: Docker-`restarting` pane is never restarted.
  [`app-store.test.ts:2587`](../../../src/adapters/driving/tui/store/app-store.test.ts#L2587)

- Stale-listing guard test.
  [`logs-zone.interaction.test.tsx:1812`](../../../src/adapters/driving/tui/zones/logs/logs-zone.interaction.test.tsx#L1812)

- Menu fixtures for the size matrix.
  [`dialog-registry.tsx:275`](../../../src/adapters/driving/tui/shared/test-support/dialog-registry.tsx#L275)

- UX doc: Logs row amended.
  [`EXPERIENCE.md:30`](../../planning-artifacts/ux-designs/ux-tui-back-2026-08-10/EXPERIENCE.md#L30)
