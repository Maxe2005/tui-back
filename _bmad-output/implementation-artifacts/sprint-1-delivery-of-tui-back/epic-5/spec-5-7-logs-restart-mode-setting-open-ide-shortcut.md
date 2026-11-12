---
title: 'Story 5.7 — Logs: Restart Mode Setting & Open-IDE Shortcut'
type: 'feature'
created: '2026-10-14'
status: 'done'
baseline_commit: '6a6bb433f6e317b416e94fa933d6a6ac1189a737'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-7/spec-7-12-shared-service-actions-open-in-ide-simple-clean-restart.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** In Logs, `R` always runs a plain `docker restart` through a Logs-private path, there is no clean-restart option, and no way to open the service's code from the log you are reading. Story 7.12's shared `core/service-actions` registry exists but Logs does not use it.

**Approach:** Route Logs' restart through the registry using a new persisted `logs.restartMode` setting (`simple` default | `clean`), and add an open-in-IDE key on the focused/fullscreen pane that calls the registry's `openInIde`.

## Boundaries & Constraints

**Always:**
- `logs.restartMode` (`simple` | `clean`, default `simple`) lives in `settings.yaml`, on a new `:settings` → Logs group (←/→/Space toggle idiom, UX-DR36), applied live: the next `R` reads the current setting; an invalid value falls back to `simple`.
- `R` (uppercase only) in grid pane focus and in fullscreen calls `serviceActions.restart(repoPath, mode)`; existing guards stay (no-op while restarting, absent for `no-container`); the pane keeps its existing "restarting" state and re-polls health afterwards.
- A registry `notice` (clean mode, no recipe) shows as a dim pane annotation, distinct from errors, with the text `no clean-restart recipe — simple restart` (update the registry constant + its test to this wording).
- Footer/help hint names the active mode: `[R] restart (clean)` / `[R] restart` for simple.
- IDE key is uppercase `O`: lowercase `o` is the fullscreen stdout toggle and `R` already sets the uppercase-action precedent; `O` collides with no Logs/global binding (mnemonics are d/e/u/l/r/s). Active in grid pane focus and fullscreen; calls `serviceActions.openInIde(repoPath, { editorCommand: settings.general.editorCommand })`; works for container-less services; failure → one-line pane notice with the error message. Listed in footer contexts and `?` help.
- Registry owns restart/IDE logic; the Logs slice no longer calls `restartService`/docker restart for `R` (remove the then-dead `restartService` use-case if unreferenced).
- Source comments follow AD-17 (no story/AC references).

**Ask First:** If `O` is rejected during implementation as colliding with something found late, HALT and propose another key.

**Never:** Changing 7.12's registry behaviour beyond the notice wording; adding restart-mode UI outside the Logs settings tab; Dashboard wiring (7.5/7.6); a restart-mode picker in the pane.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Simple restart | mode `simple`, `R` on pane | registry simple restart; pane "restarting" then health re-polled | failure → pane error line |
| Clean + recipe | mode `clean`, manifest has `restartCommands` | recipe runs via registry; no notice | `restart-failed` surfaced inline |
| Clean, no recipe | mode `clean`, none declared | simple restart + dim notice `no clean-restart recipe — simple restart` | N/A |
| Live mode change | toggle in `:settings`, then `R` | uses new mode, no restart of the TUI | N/A |
| Container-less | `R` / `O` on `no-container` pane | `R` unavailable (unchanged); `O` opens the IDE | `O` failure → notice |
| Restart in flight | `R` twice | second is a no-op | N/A |
| IDE failure | editor binary missing | one-line notice `Could not launch "<bin>": …` | no throw |

</frozen-after-approval>

## Code Map

- `src/core/service-actions/index.ts` -- registry: `restart(repoPath, mode)`, `openInIde`, `NO_CLEAN_RECIPE_NOTICE` (:51) (reword + `index.test.ts`)
- `src/adapters/driving/tui/store/slices/logs-slice.ts` -- `restartLogsPane` (:606-696) uses `restartService`/docker today; `LogsPane` (:31-58) gains `notice`; add `openLogsPaneInIde`
- `src/adapters/driving/tui/store/app-store.ts` (:55-90) -- `AppStoreDeps` already has `editor?`, `container?`, `restart?`, `lock`; build the registry once from them (as `update-slice.ts:1327` does for the editor)
- `src/bin/tui.ts` (:104,:181) -- composition root, already wires `editor`
- `src/core/ports/settings.ts` (:46-82), `src/adapters/driven/settings/schema.ts` (:94-118) -- add `logs.restartMode` with default + zod enum fallback
- `src/adapters/driving/tui/shared/settings-screen.tsx` -- Logs groups (:297-314), `GROUP_FOOTER_CONTEXTS` (:329), key handling (:606-700), render (:925+); add `restart-mode` group modelled on `start-with-history`/`filter-history-dedup`
- `src/adapters/driving/tui/zones/logs/logs-zone.tsx` -- `R` in fullscreen (:562) and grid (:759), add `O`; `logs-pane-view.tsx:98`, `fullscreen-pane.tsx:84-87` render the `R` hint, errors and the new notice
- `src/adapters/driving/tui/keybindings/{keybindings,footer-contexts}.ts` -- `R (Logs)` help row (:181), `logs-fullscreen` hints (:162-176); add `O`, mode-aware `R` label (footer contexts are static → mode-aware label needs a dynamic context hint or a lookup)
- Tests to keep green/extend: `logs-slice.test.ts`, `logs-zone.interaction.test.tsx`, `settings-screen.test.tsx`, settings adapter tests, `keybindings.test.ts`, `service-actions/index.test.ts`

## Tasks & Acceptance

**Execution:**
- [x] `core/ports/settings.ts`, `adapters/driven/settings/schema.ts` (+tests) -- `logs.restartMode` default `simple`, invalid → `simple` -- persisted setting
- [x] `core/service-actions/index.ts` (+test) -- notice wording -- matches the story's pane text
- [x] `app-store.ts`, `logs-slice.ts` (+tests) -- build registry; `restartLogsPane` calls `restart(repoPath, settings.logs.restartMode)`, stores `notice`; new `openLogsPaneInIde`; drop dead docker-restart path -- single restart/IDE implementation
- [x] `settings-screen.tsx` (+tests) -- Logs "Restart mode" group, live apply -- AC 1
- [x] `logs-zone.tsx`, `logs-pane-view.tsx`, `fullscreen-pane.tsx` (+interaction tests) -- `O` key, notice line, mode-aware `[R] restart (clean)` hint -- AC 2–5
- [x] `keybindings.ts`, `footer-contexts.ts` (+test) -- `O` and mode-aware `R` in footer and `?` help -- discoverability
- [x] Tests -- full I/O matrix through real keypresses/store

**Acceptance Criteria:**
- Given `:settings` → Logs, when restart mode is changed, then it persists to `settings.yaml` and the next `R` uses it without restarting the TUI.
- Given grid focus or fullscreen with mode `clean`, when `R` is pressed, then the footer showed `[R] restart (clean)` and the registry clean restart ran.
- Given mode `clean` without a recipe, when `R` is pressed, then the pane shows `no clean-restart recipe — simple restart`.
- Given grid focus or fullscreen, when `O` is pressed, then the IDE opens on that service's repo, or a one-line failure notice shows; container-less panes included.
- Given `npm run lint`, then no new boundary violations (no `child_process` outside `adapters/driven`).

## Verification

**Commands:**
- `npm test` -- expected: all green
- `npx tsc --noEmit && npm run lint` -- expected: no errors
- `npm run depcheck` -- expected: no new violations

## Suggested Review Order

**Setting**

- New `logs.restartMode` type and default; invalid yaml falls back to `simple`.
  [`settings.ts:69`](../../src/core/ports/settings.ts#L69)

- Schema fallback isolated so a bad value never resets the rest of `logs`.
  [`schema.ts:116`](../../src/adapters/driven/settings/schema.ts#L116)

**Restart and IDE through the shared registry**

- Registry built once from existing deps; Logs no longer restarts via docker directly.
  [`logs-slice.ts:197`](../../src/adapters/driving/tui/store/slices/logs-slice.ts#L197)

- Restart reads the live mode, clears stale error/notice, stores the registry notice.
  [`logs-slice.ts:622`](../../src/adapters/driving/tui/store/slices/logs-slice.ts#L622)

- Open-in-IDE action; failures become a one-line pane notice.
  [`logs-slice.ts:662`](../../src/adapters/driving/tui/store/slices/logs-slice.ts#L662)

- Notice wording aligned with the story's pane text.
  [`index.ts:49`](../../src/core/service-actions/index.ts#L49)

**Keys, hints and settings UI**

- `O` in fullscreen and in grid focus (lowercase `o` stays the stdout toggle).
  [`logs-zone.tsx:571`](../../src/adapters/driving/tui/zones/logs/logs-zone.tsx#L571)
  [`logs-zone.tsx:773`](../../src/adapters/driving/tui/zones/logs/logs-zone.tsx#L773)

- Footer context chosen by restart mode so the hint names it.
  [`logs-zone.logic.ts:434`](../../src/adapters/driving/tui/zones/logs/logs-zone.logic.ts#L434)

- Clean-mode fullscreen footer with `R restart (clean)` and `O`.
  [`footer-contexts.ts:178`](../../src/adapters/driving/tui/keybindings/footer-contexts.ts#L178)

- "Restart mode" group on the Logs settings tab.
  [`settings-screen.tsx:314`](../../src/adapters/driving/tui/shared/settings-screen.tsx#L314)
