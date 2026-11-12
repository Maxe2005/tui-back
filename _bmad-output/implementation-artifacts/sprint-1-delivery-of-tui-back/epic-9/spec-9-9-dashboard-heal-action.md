---
title: 'Dashboard — Heal Action'
type: 'feature'
created: '2026-11-05'
status: 'done'
baseline_commit: '4854d5ed675475087d204831623d10f8f6ba967b'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-9-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 9.8 lets scripts heal through `tui-back heal`. In the TUI, though, the developer still has to restart every down or unhealthy service by hand from the Dashboard.

**Approach:** Bind `H` on the Dashboard. It plans with `planHeal`. With no target it shows a notice. Otherwise it opens a Heal overlay with the targets, the skipped services and a switchable mode. Enter runs `runHeal` and streams the rows live through the shared `SwitchRestartReport`. The run ends with the summary and a Dashboard refresh.

## Boundaries & Constraints

**Always:**
- Plan and run go only through `planHeal` and `runHeal`. They get the realign-style deps: `healthProbe`, `isHealthCheckEnabled: healthCheckEnabledFrom(() => get().settings)` and `concurrency: settings.update.concurrency`. Opening the overlay pre-selects `settings.dashboard.restartMode`. Toggling the mode in the overlay never writes it back to settings.
- Rows render through `SwitchRestartReport`, reused as-is, with no copy.
- The overlay owns the keyboard. It uses the realign pattern: a store flag in `isZoneInputActive`, app-shell global-key gating and mount, a `FooterOwner`, and `DIALOG_REGISTRY` entries for the confirm, running, done, confirm-close and error states. It is bounded (AD-19).
- `H` is declared in `keybindings.ts` as `H (Dashboard)`, so the footer and the `?` help come from the declaration.
- The run marks `serviceRestartInFlight` the same way realign does. `H` is refused with a notice while a switch, realign or heal restart is running.

**Ask First:** changing `core/heal`, `ServiceActions`, the resolver or `SwitchRestartReport`'s rendering; adding a live poll to the Dashboard outside the Heal overlay.

**Never:** a copy of the restart-row rendering; persisting the overlay's mode; new dependencies; changing the realign or switch behaviour or their tests.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Targets exist | `H`, plan has ≥1 `pending` | overlay: targets, then skipped rows with reasons, plus the mode selector (`simple`/`clean`) | — |
| No target | plan has 0 `pending` | auto-dismissed notice `every service is up`, no overlay | — |
| Plan fails | `planHeal` err (e.g. `no-active-edt`) | auto-dismissed notice with the error message, no overlay | — |
| Toggle mode | ←/→/Space in confirm | the mode switches between simple and clean | — |
| Cancel | Esc in confirm | the overlay closes and nothing restarts | — |
| Run | Enter in confirm | the rows go live `restarting → verifying → final` | — |
| Close mid-run | Esc while running | a confirm-close prompt appears. Enter closes and the run continues in the background. Esc keeps the overlay open | — |
| Done | run finished | summary plus rows (non-green first). The Dashboard refreshes (`loadDashboard({queueIfBusy:true})`). Esc/Enter closes | — |
| Run error | `runHeal` err | error state; Esc closes | — |
| Busy | `H` while a switch, realign or heal restart runs, or during planning | notice saying a restart is in progress, or ignored while planning | — |

</frozen-after-approval>

## Code Map

- `src/core/heal/index.ts:32,39,96,150` -- `HealPlan`, `HealReport`, `planHeal`, `runHeal` (read-only). Message `HEAL_NOTHING_TO_DO_MESSAGE` (L22).
- `src/adapters/driving/cli/subcommands.ts:1171-1245` -- `runHealCommand`, the deps-wiring template.
- `src/adapters/driving/tui/store/slices/realign-slice.ts:107-122,163,174,215-314` -- template: service actions with healthProbe, onPhase streaming into a `Map` (only while `running`), `serviceRestartInFlight`, the final `loadDashboard`.
- `src/adapters/driving/tui/store/slices/reset-slice.ts:102-118` + `app-shell.tsx:492` -- auto-dismissed notice pattern (token + `unref` timer) and how it renders.
- `src/adapters/driving/tui/store/app-store.ts:62,124-141` -- `AppStoreDeps`, slice registration.
- `src/adapters/driving/tui/zones/edts/dialogs/switch-restart-report.tsx:15,43` -- `SwitchRestartReport` (+ `SwitchRestartState` in `edt-slice.ts:76`), to reuse.
- `src/adapters/driving/tui/shared/realign-dialog.tsx:50,70,177` + `realign-dialog.logic.ts:63,102` -- the dialog and logic shapes to mirror (`ModalDialog`, run budget, key resolver, footer context).
- `src/adapters/driving/tui/shared/terminal-view.logic.ts:58-66` + `footer-contexts.ts:360` -- confirm-close pattern.
- `src/adapters/driving/tui/shared/components/restart-mode-selector.tsx` -- hard-codes `none/simple/clean`. Add an optional `modes` prop (default `RESTART_MODE_ORDER`).
- `src/adapters/driving/tui/zones/dashboard/dashboard-zone.tsx:105-176` -- `useInput`. `A` opens realign. `H` is not bound and does not collide with UX-DR36 or the shell keys (it is only zone-scoped in Shared Types and Routes).
- `src/adapters/driving/tui/keybindings/keybindings.ts:180-234` -- Dashboard declarations; `keybindings.test.ts` pins the rows.
- `src/adapters/driving/tui/shared/hooks/use-zone-input-active.ts:7-22`, `app-shell.tsx:363,397,404-411,490`, `footer-contexts.ts:340-346,402-404` -- overlay ownership wiring.
- `src/adapters/driving/tui/shared/test-support/dialog-registry.tsx:81,304-307,361-405` -- registry entries and fixture stores. Enforced by `bounds/bounds-dialogs.test.tsx`.
- Tests: `realign-slice.test.ts:20` (`fakeDeps`), `realign-dialog.test.tsx` (renderToString), `realign-dialog.interaction.test.tsx` and `dashboard-zone.interaction.test.tsx:125` (fake TTY, `press`).

## Tasks & Acceptance

**Execution:**
- [x] `src/adapters/driving/tui/store/slices/heal-slice.ts` (+ test) -- `healScreenOpen`, `healRun {status: planning|confirm|running|done|error, plan, mode, rows, report, error}` and `healNotice`. Actions: `openHeal()`, `toggleHealMode()`, `startHeal()`, `closeHeal()`. Register it in `app-store.ts`. Test every matrix row against fake ports, running the real core.
- [x] `src/adapters/driving/tui/shared/components/restart-mode-selector.tsx` -- optional `modes` prop. Existing callers stay unchanged.
- [x] `src/adapters/driving/tui/shared/heal-dialog.logic.ts` + `heal-dialog.tsx` (+ render and interaction tests) -- `ModalDialog title="HEAL"`. Confirm: EDT topic, mode selector, `SwitchRestartReport` of the plan rows. Running and done: `SwitchRestartReport`. Confirm-close sub-state. Key resolver and footer contexts `heal-confirm`, `heal-busy`, `heal-confirm-close` and `heal-close`.
- [x] `src/adapters/driving/tui/keybindings/keybindings.ts`, `footer-contexts.ts` (+ tests) -- `H (Dashboard)` "Heal: restart services that are not up", plus the heal footer contexts and the overlay owner.
- [x] `src/adapters/driving/tui/zones/dashboard/dashboard-zone.tsx` (+ interaction test) -- `H` → `openHeal()`.
- [x] `src/adapters/driving/tui/shared/hooks/use-zone-input-active.ts`, `app-shell.tsx` -- gate on `healScreenOpen`, mount `HealDialog`, render `healNotice`.
- [x] `src/adapters/driving/tui/shared/test-support/dialog-registry.tsx` -- entries for confirm, running, done, confirm-close and error.

**Acceptance Criteria:**
- Given an active EDT with one `down` and one `up` service, when `H` is pressed, then the overlay lists the down one as a target and the up one as skipped `(up)`, with the mode set to `settings.dashboard.restartMode`.
- Given the overlay is running, when `runHeal`'s `onPhase` streams, then the rendered rows reflect each phase. When the run ends, `loadDashboard` is called once.
- Given the `?` help on the Dashboard, then it lists `H` with its description.
- Given `npm test && npm run typecheck && npm run depcheck`, then all pass. The realign and switch test files have no diff.

## Design Notes

- Closing mid-run hides the overlay and lets the run finish. The slice stays the owner, and `serviceRestartInFlight` keeps other restarts blocked until the run ends. It does not cancel, because `runHeal` has no cancellation.
- The notice uses the reset-slice auto-dismiss pattern rather than "next key clears", for the same reason: the `H` press itself must not erase it.

## Verification

**Commands:**
- `npm test && npm run typecheck && npm run depcheck` -- expected: all green.
- `git diff --stat epic-9-service-terminals-unified-service-actions -- src/adapters/driving/tui/shared/realign-dialog*.test.tsx src/adapters/driving/tui/store/slices/realign-slice.test.ts src/core/edt/switch-restart.test.ts` -- expected: empty.

## Suggested Review Order

**Heal slice (entry point)**

- Press `H`: plan via core, notice on zero targets or errors, overlay otherwise.
  [`heal-slice.ts:104`](../../src/adapters/driving/tui/store/slices/heal-slice.ts#L104)

- Run: one `set` claims running + in-flight, rows stream through `onPhase`.
  [`heal-slice.ts:159`](../../src/adapters/driving/tui/store/slices/heal-slice.ts#L159)

- `finally` always releases targets, sets the end state and refreshes once.
  [`heal-slice.ts:201`](../../src/adapters/driving/tui/store/slices/heal-slice.ts#L201)

- Hidden run end surfaces as a success/warning/error notice.
  [`heal-slice.ts:220`](../../src/adapters/driving/tui/store/slices/heal-slice.ts#L220)

- Realign-style deps: health probe and the live health-check toggle.
  [`heal-slice.ts:128`](../../src/adapters/driving/tui/store/slices/heal-slice.ts#L128)

- Mode stepping over `HEAL_MODES`, never written back to settings.
  [`heal-slice.ts:24`](../../src/adapters/driving/tui/store/slices/heal-slice.ts#L24)

**Heal overlay**

- View picked from the run plus the confirm-close sub-state.
  [`heal-dialog.logic.ts:16`](../../src/adapters/driving/tui/shared/heal-dialog.logic.ts#L16)

- Key resolver: toggle, run, cancel, confirm-before-hiding.
  [`heal-dialog.logic.ts:44`](../../src/adapters/driving/tui/shared/heal-dialog.logic.ts#L44)

- Rows rendered by the shared report, not a copy.
  [`heal-dialog.tsx:128`](../../src/adapters/driving/tui/shared/heal-dialog.tsx#L128)

- Optional heading so the confirm view does not claim a running restart.
  [`switch-restart-report.tsx:64`](../../src/adapters/driving/tui/zones/edts/dialogs/switch-restart-report.tsx#L64)

- Selector restricted to simple/clean through a new optional `modes` prop.
  [`restart-mode-selector.tsx:23`](../../src/adapters/driving/tui/shared/components/restart-mode-selector.tsx#L23)

**Shell wiring & keys**

- `H` declared once; footer and `?` help derive from it.
  [`keybindings.ts:206`](../../src/adapters/driving/tui/keybindings/keybindings.ts#L206)

- Dashboard binds `H` to `openHeal`.
  [`dashboard-zone.tsx:149`](../../src/adapters/driving/tui/zones/dashboard/dashboard-zone.tsx#L149)

- Overlay owns the keyboard: zones inert, global keys and Ctrl+W gated.
  [`app-shell.tsx:372`](../../src/adapters/driving/tui/app-shell.tsx#L372)

- Mount and notice line.
  [`app-shell.tsx:501`](../../src/adapters/driving/tui/app-shell.tsx#L501)

- Heal footer contexts.
  [`footer-contexts.ts:348`](../../src/adapters/driving/tui/keybindings/footer-contexts.ts#L348)

**Tests**

- Health-check toggle: disabled service skipped, never probed.
  [`heal-slice.test.ts:188`](../../src/adapters/driving/tui/store/slices/heal-slice.test.ts#L188)

- Closed mid-run outcome notice and single refresh.
  [`heal-slice.test.ts:261`](../../src/adapters/driving/tui/store/slices/heal-slice.test.ts#L261)

- Bounds-matrix registry entries for every heal view.
  [`dialog-registry.tsx:309`](../../src/adapters/driving/tui/shared/test-support/dialog-registry.tsx#L309)

- Overlay key ownership incl. Ctrl+W.
  [`app-shell.interaction.test.tsx:3170`](../../src/adapters/driving/tui/app-shell.interaction.test.tsx#L3170)
