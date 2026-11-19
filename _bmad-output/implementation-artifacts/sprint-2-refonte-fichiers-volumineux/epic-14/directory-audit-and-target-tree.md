# Directory audit and target tree (story 14.1)

Status: **approved by user 2026-11-19** (all 7 decisions; two were changed from the first proposal: `shared/settings` and the `tui` root are now split, not kept flat). 14.2 may start. Documentation only: no file under `src/` was touched.

Counts come from `git ls-files src` at baseline `012b9465` (730 tracked files, tests included), after epics 12 and 13. "Files" = direct files of the directory; "Subdirs" = direct subdirectories. Threshold: more than 10 of either.

The counts differ from the sprint-start audit in the epic context (e.g. `slices` 30 -> 50, `shared/components` 66, `zones/logs` 14 -> 40) because epics 12/13 split large files into many smaller ones.

## 1. Inventory and verdicts

| Directory | Files | Subdirs | Verdict | Story |
|---|---|---|---|---|
| `src/adapters/driving/tui/shared/components` | 66 | 1 | **split** by role into 8 folders | 14.2 |
| `src/adapters/driving/tui/shared` | 28 | 10 | **split** (screens group) + fold `poll/` into `hooks/` | 14.2 |
| `src/adapters/driving/tui/shared/settings` | 16 | 0 | **split**: one folder per tab (7) | 14.2 |
| `src/adapters/driving/tui/store/slices` | 50 | 0 | **split** by domain (7 folders, `update/` nested) | 14.3 |
| `src/adapters/driving/tui/zones/update` | 45 | 0 | **split** by concern (6 folders) | 14.3 |
| `src/adapters/driving/tui/zones/logs` | 40 | 0 | **split** by concern (5 folders) | 14.3 |
| `src/adapters/driving/tui/zones/edts` | 37 | 1 | **split** by concern (4 folders + scenarios) | 14.3 |
| `src/adapters/driving/tui/zones/routes` | 35 | 0 | **split** by concern (5 folders) | 14.3 |
| `src/core/edt` | 34 | 1 | **split** by use case | 14.4 |
| `src/core/scripts` | 30 | 1 | **split** by concern | 14.4 |
| `src/core/ports` | 20 | 0 | **split** by concern (Ask First 2, section 5) | 14.4 |
| `src/core/shared-types` | 12 | 0 | **split** in 2 | 14.4 |
| `src/adapters/driving/tui/zones/edts/dialogs` | 12 | 2 | **split** in 3 | 14.5 |
| `src/adapters/driving/tui/zones/edts/dialogs/create-wizard` | 13 | 0 | **split** (steps, override-box) | 14.5 |
| `src/core` | 7 | 13 | **group** 11 of the 13 subdirs into 3 families (13 -> 5: 3 families + `ports/` + `shared/`) | 14.5 |
| `src/adapters/driven` | 3 | 18 | **group** 17 of the 18 subdirs into 3 families (18 -> 4: 3 families + `modules/`) | 14.5 |
| `src/adapters/driven/git` | 21 | 0 | **split** by concern | 14.5 |
| `src/adapters/driving/cli` | 15 | 1 | **split** (dispatch group) | 14.5 |
| `src/adapters/driving/cli/commands` | 15 | 0 | **split** (edt group) | 14.5 |
| `src/bin` | 15 | 0 | **split** (move e2e tests to `e2e/`) | 14.5 |
| `src/adapters/driving/tui` | 15 | 5 | **split**: app-shell tests to `app-shell-tests/` | 14.5 |

Directories left as is: everything not in the table above is at or under 10 files and 10 subdirs. Exactly 10 files before the audit (not over, kept): `shared/components/json-tree`, `zones/shared-types`, `shared/keys`. `core/scripts/group-update` (10 files) is not "kept": it is regrouped (moved down into `group-update/steps/`, see section 4).

After the proposal every directory is at most 10 files and 10 subdirs (checked by the mapping script). Resulting folders at exactly 10 files: `components/lists`, `slices/logs`, `core/edt/lifecycle`, `core/edt/switch` (3 existing + 7 moved), `core/scripts/group-update`, `core/scripts/group-update/steps`, `core/scripts/registry`, `cli/dispatch`, `bin/e2e`, `components/pickers` (8 + 2). `tui` root ends with 3 files (`app-shell.tsx`, `single-instance.ts`, `single-instance.test.ts`) and 6 subdirs; `shared/settings` ends with 2 root files and 7 subdirs of 2 files each. At 9: `components/layout`, `shared/screens`, `zones/edts/logic`, `zones/logs/panes`, `zones/routes/panes`, `zones/update/services`.

`tui/shared` subdirectories, before (10): `bounds, components, hooks, input-history, keys, poll, scrollable-output, settings, test-support, theme`. After (10): the same minus `poll` (folded into `hooks/`) plus `screens` (itself holding `command-bar/`, `terminal-view/`, `dialogs/`).

## 2. Naming and co-location rules applied

- Every move is a pure `git mv` (no rename of any file). Only relative import specifiers change.
- `<name>.logic.ts`, `<name>.test.ts(x)`, `<name>.<topic>.test.ts(x)` always go to the same folder as `<name>.ts(x)`. `<module>.test-support.ts(x)` goes with the tests of its module (zone-level support stays at the zone root; its scenario tests import it with `../` paths).
- Port interface names, exported symbols and every file name are unchanged.
- No barrel or re-export shim is introduced. The only barrels (`shared/components/index.ts` and similar) already exist; they only get their internal paths updated.

## 3. Target tree (summary)

```
tui/shared/
  components/{inputs,pickers,lists,dialogs,layout,chrome,feedback,display,json-tree}/  (+ index.ts, ink-smoke.test.tsx, render-to-string.ts)
  screens/{command-bar,terminal-view,dialogs}/  (+ 9 screen files)
  hooks/ (absorbs poll/)  bounds/  input-history/  keys/  scrollable-output/  test-support/  theme/
  settings/{edts,general,logs,palette,services,shared-types,update}/  (+ footer-context.logic.ts, settings-tabs.logic.ts)
tui/ root: app-shell.tsx, single-instance.*, app-shell-tests/{flows}/
tui/store/slices/{logs,update/{config,health,run},shared-types,terminal,maintenance,workspace,app}/
tui/zones/update/{hooks,config,incidents,services,report,logic}/
tui/zones/logs/{hooks,keys,filters,panes,logic}/
tui/zones/routes/{hooks,keys,panes,logic,scenarios}/
tui/zones/edts/{hooks,views,logic,scenarios/{lifecycle,runtime},dialogs/{edt,actions,switch,switch-resolution,create-wizard/{steps,override-box}}}/
core/{ports/{runtime,vcs,storage,modules}, workspace/{edt,scripts,shared-types,heal,realign}, runtime/{service-actions,service-status,shell}, insight/{dashboard,logs,routes}, shared/}  (+ index.ts, locking.ts, ping.ts, result.ts and tests)
core/edt/{lifecycle,switch/{restart},branches,shared-edt}/
core/scripts/{group-update/steps,registry,reset,update-support}/
core/shared-types/{versioning,consumers}/
adapters/driven/{runtime/{container,docker,editor,health,installer,lock,restart,shell-session}, vcs/{git,manifest,migration}, storage/{edt-registry,registry,saved-requests,settings,state,xdg}, modules/}  (+ index.ts, process.ts, process.test.ts)
adapters/driven/git/{refs,worktree,merge,history}/
adapters/driving/cli/{dispatch,commands/edt}/   bin/e2e/
```

Note on the family names: no new folder is called `adapters` or `tui`, because the dependency-cruiser patterns `adapters(/|$)` and `tui(/|$)` are unanchored (see section 6).

### 3.1 Top-level groupings (14.5, whole directories move with `git mv`)

**`src/core`** (13 subdirs -> 5). Root files stay: `index.ts`, `index.test.ts`, `locking.ts`, `ping.ts`, `ping.test.ts`, `result.ts`, `result.test.ts`. `ports/` and `shared/` (1 file, `core-ports.test-support.ts`) stay as is (ports are internally regrouped by 14.4).

| New folder | Moved directories (all their files, recursively) |
|---|---|
| `core/workspace/` | `edt/` (34 + 3), `scripts/` (30 + 10), `shared-types/` (12), `heal/` (2), `realign/` (2) |
| `core/runtime/` | `service-actions/` (2), `service-status/` (2), `shell/` (6) |
| `core/insight/` | `dashboard/` (4), `logs/` (6), `routes/` (6) |

**`src/adapters/driven`** (18 subdirs -> 4). Root files stay: `index.ts`, `process.ts`, `process.test.ts`.

| New folder | Moved directories |
|---|---|
| `driven/runtime/` | `container/` (2), `docker/` (4), `editor/` (4), `health/` (2), `installer/` (1), `lock/` (3), `restart/` (2), `shell-session/` (4) |
| `driven/vcs/` | `git/` (21, regrouped into `refs|worktree|merge|history` by the git mapping in section 4), `manifest/` (5), `migration/` (2) |
| `driven/storage/` | `edt-registry/` (3), `registry/` (3), `saved-requests/` (3), `settings/` (3), `state/` (3), `xdg/` (2) |
| `driven/modules/` | stays (already holds `module-registry.*` and its sub-folders) |

## 4. File-to-folder mapping

Every direct file of each split directory appears exactly once, with its target folder (relative to that directory) and owning story. Generated from `git ls-files` with a script that fails on any unmatched or duplicated file.

### `src/adapters/driving/tui/shared/components` — 66 files (= `git ls-files` direct-file count, non-code files included) → story 14.2

Role-based. `json-tree/` (10 files) already exists and stays. `index.ts` is an existing barrel: only its internal `./x.js` paths change (not a new shim).

| Target folder (under this directory) | Files | Count |
|---|---|---|
| `.` (stays in place) | `index.ts`, `ink-smoke.test.tsx`, `render-to-string.ts` | 3 |
| `chrome/` | `footer-context.tsx`, `footer.tsx`, `top-bar-footer-split.test.tsx`, `top-bar.tsx`, `zone-tab-bar.bounds.test.tsx`, `zone-tab-bar.styles.test.tsx`, `zone-tab-bar.test.tsx`, `zone-tab-bar.tsx` | 8 |
| `dialogs/` | `hints.guard.test.ts`, `hints.test.ts`, `hints.ts`, `keybinding-help.test.tsx`, `keybinding-help.tsx`, `modal-dialog.bounds.test.tsx`, `modal-dialog.test.tsx`, `modal-dialog.tsx` | 8 |
| `display/` | `scrollable-output.test.tsx`, `scrollable-output.tsx`, `truncated-text.test.tsx`, `truncated-text.tsx` | 4 |
| `feedback/` | `dim-annotation.test.tsx`, `dim-annotation.tsx`, `spinner.test.tsx`, `spinner.tsx`, `state-line.test.tsx`, `state-line.tsx`, `status-badge.test.tsx`, `status-badge.tsx` | 8 |
| `inputs/` | `branch-autocomplete-input.test.tsx`, `branch-autocomplete-input.tsx`, `suggest-field.logic.test.ts`, `suggest-field.logic.ts`, `text-edit.ts`, `text-input-line.styles.test.tsx`, `text-input-line.test.tsx`, `text-input-line.tsx` | 8 |
| `layout/` | `detail-pane.test.tsx`, `detail-pane.tsx`, `fullscreen-frame.tsx`, `splitter.styles.test.tsx`, `splitter.test.tsx`, `splitter.tsx`, `zone-layout.layout.test.tsx`, `zone-layout.tsx`, `zone-placeholder.tsx` | 9 |
| `lists/` | `bounded-list.test.tsx`, `bounded-list.tsx`, `failed-result-list.test.tsx`, `failed-result-list.tsx`, `list-row.test.tsx`, `list-row.tsx`, `menu-list.test.tsx`, `menu-list.tsx`, `service-actions-row.test.tsx`, `service-actions-row.tsx` | 10 |
| `pickers/` | `branch-picker.test.tsx`, `branch-picker.tsx`, `checkbox-list-item.test.tsx`, `checkbox-list-item.tsx`, `filterable-pick-list.test.tsx`, `filterable-pick-list.tsx`, `restart-mode-selector.test.tsx`, `restart-mode-selector.tsx` | 8 |

### `src/adapters/driving/tui/shared` — 28 files (= `git ls-files` direct-file count, non-code files included) → story 14.2

`@components/pickers` = moves to `shared/components/pickers/` (it is imported by `branch-picker.tsx` and by the create-wizard). `poll/` (2 files: `in-flight-guard.ts`, `in-flight-guard.test.ts`) additionally moves into `shared/hooks/` (14.2) so `shared` ends at 10 subdirectories (screens, bounds, components, hooks, input-history, keys, scrollable-output, settings, test-support, theme).

| Target folder (under this directory) | Files | Count |
|---|---|---|
| `.` (stays in place) | `README.md` | 1 |
| `shared/components/pickers/` | `branch-owners-text.test.ts`, `branch-owners-text.ts` | 2 |
| `screens/` | `repo-registry-screen.test.tsx`, `repo-registry-screen.tsx`, `reset-screen.logic.test.ts`, `reset-screen.logic.ts`, `reset-screen.test.tsx`, `reset-screen.tsx`, `screens.interaction.test.tsx`, `settings-screen.test.tsx`, `settings-screen.tsx` | 9 |
| `screens/command-bar/` | `command-bar.history.interaction.test.tsx`, `command-bar.test.tsx`, `command-bar.tsx`, `command-grid.logic.ts` | 4 |
| `screens/dialogs/` | `heal-dialog.interaction.test.tsx`, `heal-dialog.logic.ts`, `heal-dialog.test.tsx`, `heal-dialog.tsx`, `realign-dialog.interaction.test.tsx`, `realign-dialog.logic.ts`, `realign-dialog.test.tsx`, `realign-dialog.tsx` | 8 |
| `screens/terminal-view/` | `terminal-view.interaction.test.tsx`, `terminal-view.logic.test.ts`, `terminal-view.logic.ts`, `terminal-view.tsx` | 4 |

### `src/adapters/driving/tui/shared/settings` — 16 files (= `git ls-files` direct-file count, non-code files included) → story 14.2

One folder per tab (7), each holding the tab view and its logic. No tab has a test file today; any future `<tab>.*.test.ts(x)` goes in the same folder. `settings-screen.tsx` (moved to `shared/screens/` by this story) imports `../settings/<tab>/<file>.js`.

| Target folder (under this directory) | Files | Count |
|---|---|---|
| `.` (stays in place) | `footer-context.logic.ts`, `settings-tabs.logic.ts` | 2 |
| `edts/` | `edts-tab.tsx`, `edts.logic.ts` | 2 |
| `general/` | `general-tab.tsx`, `general.logic.ts` | 2 |
| `logs/` | `logs-tab.tsx`, `logs.logic.ts` | 2 |
| `palette/` | `palette-tab.tsx`, `palette.logic.ts` | 2 |
| `services/` | `services-tab.tsx`, `services.logic.ts` | 2 |
| `shared-types/` | `shared-types-tab.tsx`, `shared-types.logic.ts` | 2 |
| `update/` | `update-tab.tsx`, `update.logic.ts` | 2 |

### `src/adapters/driving/tui` — 15 files (= `git ls-files` direct-file count, non-code files included) → story 14.5

Root keeps `app-shell.tsx` and `single-instance.*` (3 files). Test files go to a dedicated `app-shell-tests/` folder (12 files in total, so split in two to stay at 10 or fewer). `app-shell.tsx` itself does not move, so `bin/tui.ts` and the importers `../../app-shell.js` (`zones/dashboard/dashboard-zone.bounds.test.tsx`, `shared/bounds/bounds-matrix.test.tsx`; `terminal-view.interaction.test.tsx` gains one level in 14.2) keep working.

| Target folder (under this directory) | Files | Count |
|---|---|---|
| `.` (stays in place) | `app-shell.tsx`, `single-instance.test.ts`, `single-instance.ts` | 3 |
| `app-shell-tests/` | `app-shell.alternate-screen.test.tsx`, `app-shell.bounds.test.tsx`, `app-shell.footer.test.tsx`, `app-shell.resize.test.tsx`, `app-shell.test-support.tsx`, `app-shell.test.tsx` | 6 |
| `app-shell-tests/flows/` | `app-shell.command-bar.test.tsx`, `app-shell.load-activation.test.tsx`, `app-shell.navigation.test.tsx`, `app-shell.overlays.test.tsx`, `app-shell.reset.test.tsx`, `app-shell.settings.test.tsx` | 6 |

### `src/adapters/driving/tui/shared/hooks` — 7 files (= `git ls-files` direct-file count, non-code files included) → story 14.2

Not a split: listed to prove the `poll/` fold-in (5 existing + 2 moved = 7 files, no name collision: `in-flight-guard.ts`, `in-flight-guard.test.ts` do not exist in `hooks/`).

| Target folder (under this directory) | Files | Count |
|---|---|---|
| `.` (stays in place) | `use-element-size.ts`, `use-footer-context.ts`, `use-input.tsx`, `use-zone-input-active.test.tsx`, `use-zone-input-active.ts`, `(from poll/) in-flight-guard.test.ts`, `(from poll/) in-flight-guard.ts` | 7 |

### `src/adapters/driving/tui/store/slices` — 50 files (= `git ls-files` direct-file count, non-code files included) → story 14.3

One folder per domain. `update-slice.*` is 13 files, so it is split again by concern.

| Target folder (under this directory) | Files | Count |
|---|---|---|
| `app/` | `command-history-slice.test.ts`, `command-history-slice.ts`, `service-action-ids.ts`, `settings-slice.test.ts`, `settings-slice.ts` | 5 |
| `logs/` | `logs-slice.actions.ts`, `logs-slice.filters.test.ts`, `logs-slice.filters.ts`, `logs-slice.health.test.ts`, `logs-slice.health.ts`, `logs-slice.panes.ts`, `logs-slice.store.test.ts`, `logs-slice.test.ts`, `logs-slice.ts`, `logs-slice.types.ts` | 10 |
| `maintenance/` | `heal-slice.test.ts`, `heal-slice.ts`, `realign-slice.test.ts`, `realign-slice.ts`, `reset-slice.test.ts`, `reset-slice.ts` | 6 |
| `shared-types/` | `shared-types-history.test.ts`, `shared-types-publish.test.ts`, `shared-types-slice.test.ts`, `shared-types-slice.ts` | 4 |
| `terminal/` | `terminal-slice.test.ts`, `terminal-slice.ts`, `terminal-text.test.ts`, `terminal-text.ts` | 4 |
| `update/` | `update-slice.base.test.ts`, `update-slice.dialog.test.ts`, `update-slice.test-support.ts`, `update-slice.ts`, `update-slice.types.ts` | 5 |
| `update/config/` | `update-slice.config.test.ts`, `update-slice.config.ts` | 2 |
| `update/health/` | `update-slice.health.test.ts`, `update-slice.health.ts`, `update-slice.incident.ts` | 3 |
| `update/run/` | `update-slice.run.test.ts`, `update-slice.run.ts`, `update-slice.smart-update.test.ts` | 3 |
| `workspace/` | `dashboard-slice.test.ts`, `dashboard-slice.ts`, `edt-slice.test.ts`, `edt-slice.ts`, `navigation-slice.ts`, `registry-slice.ts`, `routes-slice.test.ts`, `routes-slice.ts` | 8 |

### `src/adapters/driving/tui/zones/update` — 45 files (= `git ls-files` direct-file count, non-code files included) → story 14.3

| Target folder (under this directory) | Files | Count |
|---|---|---|
| `.` (stays in place) | `bounded-rendering.test.tsx`, `update-footer-context.test.ts`, `update-zone-dialogs.tsx`, `update-zone.ctx.ts`, `update-zone.interaction.test.tsx`, `update-zone.rendering.test.tsx`, `update-zone.test-support.ts`, `update-zone.tsx`, `update-zone.wiring.test.tsx` | 9 |
| `config/` | `update-config-dialog.logic.ts`, `update-config-dialog.test.ts`, `update-config-panels.logic.test.ts`, `update-config-panels.logic.ts`, `update-config-panels.test.tsx`, `update-config-panels.tsx` | 6 |
| `hooks/` | `use-update-config-panels.ts`, `use-update-derived.ts`, `use-update-effects.ts`, `use-update-input.ts`, `use-update-state.ts` | 5 |
| `incidents/` | `update-incidents-dialog.tsx`, `update-incidents.logic.test.ts`, `update-incidents.logic.ts` | 3 |
| `logic/` | `update-zone.blockers.logic.ts`, `update-zone.grouping.test.ts`, `update-zone.logic.ts`, `update-zone.resolvers.logic.ts`, `update-zone.resolvers.test.ts`, `update-zone.status.logic.ts`, `update-zone.status.test.ts`, `update-zone.steps.logic.ts` | 8 |
| `report/` | `fullscreen-report.test.tsx`, `fullscreen-report.tsx`, `update-zone.recap.logic.ts`, `update-zone.report.logic.ts`, `update-zone.report.test.ts` | 5 |
| `services/` | `update-detail-column.tsx`, `update-service-box.logic.test.ts`, `update-service-box.logic.ts`, `update-service-box.tsx`, `update-service-detail.tsx`, `update-service-list-column.tsx`, `update-service-menu-dialog.test.tsx`, `update-service-menu-dialog.tsx`, `update-service-pick-dialog.tsx` | 9 |

### `src/adapters/driving/tui/zones/logs` — 40 files (= `git ls-files` direct-file count, non-code files included) → story 14.3

| Target folder (under this directory) | Files | Count |
|---|---|---|
| `.` (stays in place) | `logs-zone.ctx.ts`, `logs-zone.navigation.test.tsx`, `logs-zone.pending-focus.test.tsx`, `logs-zone.service-actions.test.tsx`, `logs-zone.test-support.tsx`, `logs-zone.test.tsx`, `logs-zone.tsx` | 7 |
| `filters/` | `log-filter-editor.tsx`, `logs-zone.filter-editor.logic.ts`, `logs-zone.filter-editor.test.tsx`, `logs-zone.filter-history.test.tsx`, `logs-zone.filter-rules.test.tsx`, `logs-zone.filter.logic.ts` | 6 |
| `hooks/` | `use-logs-derived.ts`, `use-logs-effects.ts`, `use-logs-input.ts`, `use-logs-state.ts`, `use-logs-subscriptions.ts` | 5 |
| `keys/` | `logs-zone.editor-actions.ts`, `logs-zone.keys.logic.ts`, `logs-zone.list-keys.ts`, `logs-zone.overlay-keys.ts`, `logs-zone.pane-actions.ts`, `logs-zone.pane-keys.ts`, `logs-zone.rule-draft-keys.ts`, `logs-zone.rule-list-keys.ts` | 8 |
| `logic/` | `logs-zone.focus.logic.ts`, `logs-zone.health.logic.ts`, `logs-zone.layout.logic.ts`, `logs-zone.logic.test.ts`, `logs-zone.logic.ts` | 5 |
| `panes/` | `fullscreen-pane.tsx`, `logs-actions-menu.test.tsx`, `logs-actions-menu.tsx`, `logs-grid.tsx`, `logs-pane-view.tsx`, `logs-pane-views.test.tsx`, `logs-service-lists.tsx`, `logs-zone.actions-menu.test.tsx`, `logs-zone.history-grid.test.tsx` | 9 |

### `src/adapters/driving/tui/zones/routes` — 35 files (= `git ls-files` direct-file count, non-code files included) → story 14.3

| Target folder (under this directory) | Files | Count |
|---|---|---|
| `.` (stays in place) | `routes-zone.constants.ts`, `routes-zone.ctx.ts`, `routes-zone.test-support.tsx`, `routes-zone.test.tsx`, `routes-zone.tsx` | 5 |
| `hooks/` | `use-routes-body-editor.ts`, `use-routes-derived.ts`, `use-routes-effects.ts`, `use-routes-input.ts`, `use-routes-pane-actions.ts`, `use-routes-response-tree.ts`, `use-routes-state.ts` | 7 |
| `keys/` | `routes-zone.list-keys.ts`, `routes-zone.overlay-keys.ts`, `routes-zone.pane-keys.ts`, `routes-zone.request-keys.ts`, `routes-zone.response-keys.ts`, `routes-zone.saved-tab-keys.ts` | 6 |
| `logic/` | `routes-request.logic.test.ts`, `routes-request.logic.ts`, `routes-zone.logic.test.ts`, `routes-zone.logic.ts` | 4 |
| `panes/` | `routes-detail-pane.tsx`, `routes-list-pane.tsx`, `routes-modals.tsx`, `routes-request-tab.tsx`, `routes-response-tab.tsx`, `routes-saved-tab.test.tsx`, `routes-saved-tab.tsx`, `routes-zone.nodes.tsx`, `routes-zone.states.tsx` | 9 |
| `scenarios/` | `routes-zone.json-tree.test.tsx`, `routes-zone.list.test.tsx`, `routes-zone.request.test.tsx`, `routes-zone.saved.test.tsx` | 4 |

### `src/adapters/driving/tui/zones/edts` — 37 files (= `git ls-files` direct-file count, non-code files included) → story 14.3

`dialogs/` subtree is untouched by 14.3 (owned by 14.5). `scenarios/*` hold multi-component zone tests; they import `../../edts-zone.test-support.js`.

| Target folder (under this directory) | Files | Count |
|---|---|---|
| `.` (stays in place) | `edts-zone.ctx.ts`, `edts-zone.layout.test.tsx`, `edts-zone.styles.test.tsx`, `edts-zone.test-support.tsx`, `edts-zone.test.tsx`, `edts-zone.tsx` | 6 |
| `hooks/` | `use-edts-derived.ts`, `use-edts-dialog-effects.ts`, `use-edts-effects.ts`, `use-edts-handlers.ts`, `use-edts-input.ts`, `use-edts-state.ts` | 6 |
| `logic/` | `edts-footer-context.test.ts`, `edts-footer-context.ts`, `edts-zone.dialog-seed.ts`, `edts-zone.dialogs.logic.ts`, `edts-zone.focus.logic.ts`, `edts-zone.format.logic.ts`, `edts-zone.logic.ts`, `edts-zone.modify.logic.ts`, `edts-zone.wizard.logic.ts` | 9 |
| `scenarios/lifecycle/` | `edts-zone.branch-conflicts.test.tsx`, `edts-zone.create-from.test.tsx`, `edts-zone.create-validation.test.tsx`, `edts-zone.create-wizard.test.tsx`, `edts-zone.delete.test.tsx`, `edts-zone.modify.test.tsx`, `edts-zone.retry-and-branch-usage.test.tsx` | 7 |
| `scenarios/runtime/` | `bounded-rendering.test.tsx`, `edts-zone.activation.test.tsx`, `edts-zone.quick-pick.test.tsx`, `edts-zone.service-actions.test.tsx`, `edts-zone.switch.test.tsx`, `edts-zone.system-edt.test.tsx` | 6 |
| `views/` | `edts-detail-column.tsx`, `edts-dialog-views.tsx`, `edts-list-column.tsx` | 3 |

### `src/core/edt` — 34 files (= `git ls-files` direct-file count, non-code files included) → story 14.4

Existing `switch/` (3 files: `dirty.ts`, `member.ts`, `types.ts`) stays and receives the `switch.*` files (10 in total).

| Target folder (under this directory) | Files | Count |
|---|---|---|
| `branches/` | `branch-owners.test.ts`, `branch-owners.ts`, `checkout-expected.test.ts`, `checkout-expected.ts`, `fast-forward-shared.test.ts`, `fast-forward-shared.ts`, `shared-branches.test.ts`, `shared-branches.ts` | 8 |
| `lifecycle/` | `activate.test.ts`, `activate.ts`, `create.test.ts`, `create.ts`, `delete.test.ts`, `delete.ts`, `list.test.ts`, `list.ts`, `modify.test.ts`, `modify.ts` | 10 |
| `shared-edt/` | `manifest-carry.test.ts`, `manifest-carry.ts`, `resolve-tab-visibility.test.ts`, `resolve-tab-visibility.ts`, `shared-edt-guards.test.ts`, `shared-edt.test.ts`, `shared-edt.ts` | 7 |
| `switch/` | `switch.dirty.test.ts`, `switch.manifest-carry.test.ts`, `switch.orchestration.test.ts`, `switch.resolution.test.ts`, `switch.shared-edt.test.ts`, `switch.test-support.ts`, `switch.ts` | 7 |
| `switch/restart/` | `switch-restart.test.ts`, `switch-restart.ts` | 2 |

### `src/core/scripts` — 30 files (= `git ls-files` direct-file count, non-code files included) → story 14.4

Existing `group-update/` (10 files: `all.ts`, `blockers.ts`, `conflict.ts`, `edt.ts`, `member.ts`, `observers.ts`, `outcome.ts`, `restart.ts`, `selection.ts`, `types.ts`) moves down to `group-update/steps/` so that `group-update/` holds the orchestrator and its tests (10 files).

| Target folder (under this directory) | Files | Count |
|---|---|---|
| `group-update/` | `group-update.all.test.ts`, `group-update.blockers.test.ts`, `group-update.conflicts.test.ts`, `group-update.edt.test.ts`, `group-update.migrate.test.ts`, `group-update.observers.test.ts`, `group-update.pre-run.test.ts`, `group-update.restart.test.ts`, `group-update.test-support.ts`, `group-update.ts` | 10 |
| `registry/` | `clean-registry.test.ts`, `clean-registry.ts`, `list-repos.test.ts`, `list-repos.ts`, `register.test.ts`, `register.ts`, `scan.test.ts`, `scan.ts`, `validate-registry.test.ts`, `validate-registry.ts` | 10 |
| `reset/` | `reset-tool.test.ts`, `reset-tool.ts`, `reset.test.ts`, `reset.ts` | 4 |
| `update-support/` | `resolve-merge-sources.test.ts`, `resolve-merge-sources.ts`, `run-pool.test.ts`, `run-pool.ts`, `service-restart.test.ts`, `service-restart.ts` | 6 |

### `src/core/ports` — 20 files (= `git ls-files` direct-file count, non-code files included) → story 14.4

**Ask First** (see section 5): file paths change, interface names do not.

| Target folder (under this directory) | Files | Count |
|---|---|---|
| `modules/` | `route-scanner.ts`, `shared-types.ts` | 2 |
| `runtime/` | `container.ts`, `dev-auth.ts`, `docker.ts`, `editor.ts`, `health-probe.ts`, `lock.ts`, `restart.ts`, `shell-session.ts` | 8 |
| `storage/` | `edt-registry.ts`, `registry.ts`, `saved-request.ts`, `settings.test.ts`, `settings.ts`, `state.ts` | 6 |
| `vcs/` | `git.ts`, `manifest-carry.ts`, `manifest.ts`, `migration.ts` | 4 |

### `src/core/shared-types` — 12 files (= `git ls-files` direct-file count, non-code files included) → story 14.4

| Target folder (under this directory) | Files | Count |
|---|---|---|
| `consumers/` | `list-consumers.test.ts`, `list-consumers.ts`, `resolve-conflict.test.ts`, `resolve-conflict.ts`, `smart-update.test.ts`, `smart-update.ts` | 6 |
| `versioning/` | `propagate-version.test.ts`, `propagate-version.ts`, `publish-version.test.ts`, `publish-version.ts`, `version-history.test.ts`, `version-history.ts` | 6 |

### `src/adapters/driving/tui/zones/edts/dialogs` — 12 files (= `git ls-files` direct-file count, non-code files included) → story 14.5

Existing `switch-resolution/` (4 files) stays as a sibling.

| Target folder (under this directory) | Files | Count |
|---|---|---|
| `actions/` | `fast-forward-dialog.test.tsx`, `fast-forward-dialog.tsx`, `quick-pick-dialog.tsx`, `service-actions-dialog.tsx` | 4 |
| `edt/` | `add-to-edt-dialog.tsx`, `branch-plan-table.tsx`, `delete-dialog.tsx`, `issues-dialog.tsx`, `modify-dialog.tsx` | 5 |
| `switch/` | `switch-dialog.tsx`, `switch-restart-report.test.tsx`, `switch-restart-report.tsx` | 3 |

### `src/adapters/driving/tui/zones/edts/dialogs/create-wizard` — 13 files (= `git ls-files` direct-file count, non-code files included) → story 14.5

| Target folder (under this directory) | Files | Count |
|---|---|---|
| `.` (stays in place) | `create-wizard.tsx`, `wizard.logic.test.ts`, `wizard.logic.ts` | 3 |
| `override-box/` | `override-box.logic.ts`, `override-box.test.ts`, `override-box.tsx` | 3 |
| `steps/` | `activation.logic.test.ts`, `activation.logic.ts`, `step-activation.tsx`, `step-branches.test.tsx`, `step-branches.tsx`, `step-name.tsx`, `step-services.tsx` | 7 |

### `src/adapters/driven/git` — 21 files (= `git ls-files` direct-file count, non-code files included) → story 14.5

| Target folder (under this directory) | Files | Count |
|---|---|---|
| `.` (stays in place) | `git.port.test.ts`, `git.test-support.ts`, `index.ts` | 3 |
| `history/` | `version-history.test.ts`, `version-history.ts` | 2 |
| `merge/` | `git.merge.test.ts`, `merge.ts`, `switch-manifest-carry.integration.test.ts` | 3 |
| `refs/` | `branches.ts`, `git.branches.test.ts`, `git.remote.test.ts`, `refs.ts`, `remote.ts` | 5 |
| `worktree/` | `commit.ts`, `diff.ts`, `discard.ts`, `gate.ts`, `git.gate.test.ts`, `git.stash.test.ts`, `git.worktree-state.test.ts`, `stash.ts` | 8 |

### `src/adapters/driving/cli` — 15 files (= `git ls-files` direct-file count, non-code files included) → story 14.5

`commands/` stays a sibling.

| Target folder (under this directory) | Files | Count |
|---|---|---|
| `.` (stays in place) | `completion-spec.test.ts`, `completion-spec.ts`, `install.test.ts`, `install.ts`, `subcommands.ts` | 5 |
| `dispatch/` | `dispatch.core.test.ts`, `dispatch.edt.test.ts`, `dispatch.realign-heal.test.ts`, `dispatch.registry.test.ts`, `dispatch.routes-requests.test.ts`, `dispatch.test-support.ts`, `dispatch.ts`, `dispatch.update.test.ts`, `envelope.test.ts`, `envelope.ts` | 10 |

### `src/adapters/driving/cli/commands` — 15 files (= `git ls-files` direct-file count, non-code files included) → story 14.5

| Target folder (under this directory) | Files | Count |
|---|---|---|
| `.` (stays in place) | `basic.ts`, `deps.ts`, `heal.ts`, `realign.ts`, `registry.ts`, `request.ts`, `shared.ts`, `update.ts` | 8 |
| `edt/` | `edt-create.ts`, `edt-delete.ts`, `edt-fast-forward-shared.ts`, `edt-list.ts`, `edt-modify.ts`, `edt-switch.ts`, `edt.ts` | 7 |

### `src/bin` — 15 files (= `git ls-files` direct-file count, non-code files included) → story 14.5

See section 5 for the two non-pure edits needed in the e2e files.

| Target folder (under this directory) | Files | Count |
|---|---|---|
| `.` (stays in place) | `composition.ts`, `main.ts`, `mcp.ts`, `tui-back.mjs`, `tui.ts` | 5 |
| `e2e/` | `e2e.test-support.ts`, `install-sh.e2e.test.ts`, `tui-back.e2e.basics.test.ts`, `tui-back.e2e.edt-create.test.ts`, `tui-back.e2e.edt-switch-delete.test.ts`, `tui-back.e2e.register.test.ts`, `tui-back.e2e.registry.test.ts`, `tui-back.e2e.routes.test.ts`, `tui-back.e2e.tools.test.ts`, `tui-back.e2e.update.test.ts` | 10 |

### Directories moved wholesale (14.5)

`core/*` and `adapters/driven/*` groupings in 3.1 move complete directories; no file is split across targets, so each file maps to exactly one folder (its directory's new parent) and to story 14.5 (except `core/edt`, `core/scripts`, `core/shared-types`, `core/ports`, which 14.4 regroups first; 14.5 then moves the regrouped directory as a whole). Order matters: 14.5 requires 14.4.

## 5. Ask First: decisions needed before 14.2

1. **Keep flat: resolved.** The first proposal kept `shared/settings` and the `tui` root flat; the user rejected both. `shared/settings` is split into one folder per tab (14.2) and the app-shell tests move to `app-shell-tests/` (14.5), both in the mapping.
2. **Port paths change (names do not).** `core/ports/<port>.ts` becomes `core/ports/<group>/<port>.ts` (all ~100 import sites updated in 14.4). Interface and type names stay exported unchanged, as the epic requires. Alternative: keep `core/ports` flat at 20 files. If approved as proposed, say so explicitly because the epic wording "stay importable under their current names" could also be read as a path guarantee.
3. **Non-pure edits** beyond import specifiers: approve the table in "5.1 Non-pure edits" below.
4. **No renaming** of any file or folder already existing is proposed. New folder names are listed above; confirm or amend them before 14.2.
5. **Churn trade-off (checklist item "group core and driven").** The `core` and `adapters/driven` groupings touch most relative imports in the repository (`../result.js` becomes `../../result.js`, etc.). The epic offers the alternative of documenting "keep flat". Proposed: group (13 and 18 subdirs are well above threshold). Confirm.

### 5.1 Non-pure edits (path-depth or hard-coded path changes), per story

Found by grepping `import.meta.url`, `new URL(`, `readFileSync`, `file:`/path allow-lists under `src/`. Each is edited in the same commit as the move that breaks it.

| Story | File | Edit |
|---|---|---|
| 14.2 | `shared/components/hints.guard.test.ts` | `new URL('../../', ...)` (TUI root) becomes `'../../../'` after the file moves to `components/dialogs/`; allow-list entry `shared/components/hints.ts` becomes `shared/components/dialogs/hints.ts` |
| 14.2 | `shared/keys/focus-navigation.guard.test.ts` | `ALLOWED` paths: `shared/command-bar.tsx` -> `shared/screens/command-bar/command-bar.tsx`; `shared/components/text-edit.ts` -> `.../inputs/text-edit.ts`; `shared/components/branch-picker.tsx` -> `.../pickers/branch-picker.tsx` |
| 14.2 | `shared/bounds/bounded-rendering.guard.test.ts` | no edit needed: `isPrimitive` uses prefixes `shared/components/`, `shared/bounds/`, `shared/test-support/`, still valid for sub-folders. Re-check after each story |
| 14.2 | `shared/bounds/bounds-dialogs.test.tsx` | only the `shared/components/modal-dialog.tsx` filter becomes `.../dialogs/modal-dialog.tsx` |
| 14.2 to 14.5 | `shared/test-support/dialog-registry.tsx` | its 40 hard-coded `file: '...'` entries (checked by `bounds-dialogs.test.tsx`, which reads the file and expects `<ModalDialog`) and its imports are updated **in the same story as each dialog move**: `shared/*-dialog|screen|view|command-bar` and `keybinding-help` (14.2), `zones/update/*`, `zones/logs/*`, `zones/routes/routes-modals.tsx` (14.3), `zones/edts/dialogs/*` (14.5) |
| 14.3 | `focus-navigation.guard.test.ts` | `zones/routes/routes-zone.overlay-keys.ts` and `routes-zone.pane-keys.ts` -> `zones/routes/keys/...` |
| 14.5 | `focus-navigation.guard.test.ts` | `.../create-wizard/step-branches.tsx` -> `.../create-wizard/steps/step-branches.tsx` |
| 14.5 | `src/comment-hygiene.test.ts` | none (`new URL('.', ...)` is `src/` itself, which does not move) |
| 14.5 | `adapters/driven/installer/index.ts` | `new URL('../../../../package.json')` gains one `../` per level of depth added (14.5: `driven/runtime/installer/` -> `'../../../../../package.json'`) |
| 14.5 | `adapters/driven/lock/index.test.ts` | `new URL('../../../../', ...)` project root gains one `../` (`driven/runtime/lock/`); `./index.ts` stays |
| 14.5 | `adapters/driven/saved-requests/index.ts` | `schema-001.sql` is read next to the module: the `.sql` file moves with its directory (`driven/storage/saved-requests/`), no edit |
| 14.5 | `bin/e2e/e2e.test-support.ts` | `new URL('./tui-back.mjs', ...)` -> `'../tui-back.mjs'` |
| 14.5 | `bin/e2e/tui-back.e2e.basics.test.ts` | `new URL('../../${pkg.bin}', ...)` -> `'../../../${...}'` (also re-check its `package.json` import) |
| 14.5 | `bin/e2e/install-sh.e2e.test.ts` | `'../../install.sh'`, `'../../package.json'` and the `npm pack` `cwd` `'../../'` each gain one `../` (`'../../../'`) |
| 14.5 | `bin/mcp.ts`, `adapters/driving/mcp/tool-registry.test.ts` | none (do not move); they read `package.json`/`README.md` by fixed depth from directories that stay |
| 14.4 | `core/scripts/group-update/*.ts`, `group-update.ts` | `./group-update/x.js` -> `./steps/x.js`; `steps/*` imports gain one `../` |
| 14.2 | `shared/screens/settings-screen.tsx` (moved from `shared/`) | its `./settings/<x>.js` imports and `export * from './settings/...logic.js'` become `../settings/<tab>/<x>.js` (footer-context stays `../settings/footer-context.logic.js`); the 7 tab files also gain `../` on imports of `shared/` modules. Importers of the re-exports (`settings-screen.js`) are updated for the new `screens/` path. `settings-tabs.logic.ts` and `footer-context.logic.ts` stay in `settings/` |
| 14.5 | `app-shell-tests/*.test.tsx`, `app-shell.test-support.tsx` | `./app-shell.js` -> `../app-shell.js` (`../../app-shell.js` from `flows/`), every `./shared/...`, `./store/...`, `./zones/...` import gains one `../` (two from `flows/`); `flows/*` import the support as `../app-shell.test-support.js` |
| 14.5 | importers of `app-shell.js` | none to change: `bin/tui.ts`, `zones/dashboard/dashboard-zone.bounds.test.tsx`, `shared/bounds/bounds-matrix.test.tsx` keep their paths (`app-shell.tsx` does not move); `shared/terminal-view.interaction.test.tsx` only gains a level in 14.2 |
| 14.2 | `shared/components/index.ts` | re-export paths gain the role folder |

Guard allow-lists checked against the two new splits: `focus-navigation.guard.test.ts`, `hints.guard.test.ts` and `bounded-rendering.guard.test.ts` hold no `shared/settings` or `app-shell` entry (the bounded-rendering allow-list is empty). The only hard-coded path touched is `dialog-registry.tsx`'s `shared/settings-screen.tsx` -> `shared/screens/settings-screen.tsx` (14.2, already in its row).

`src/bin/tui-back.mjs` is not moved. The sibling `tui-back.e2e.*.test.ts` that spawn it do so through `e2e.test-support.ts` `scriptPath`.

### 5.2 Non-code assets, config and aliases

- `driven/saved-requests/schema-001.sql` and `tui/shared/README.md` are tracked non-TS files: the `.sql` moves with its directory (14.5); the README stays at `tui/shared/` (14.2). Mapped counts include them.
- `package.json` `files`: globs (`src`, `!src/**/*.test.ts(x)`, `!src/**/test-support`, `!src/**/*.test-support.ts(x)`) need no change. Baseline `npm pack --dry-run` lists 417 files including `schema-001.sql` and no test files; re-run after 14.5 (and check the new `bin/e2e/` is excluded: `install-sh.e2e.test.ts` itself runs `npm pack --dry-run`).
- `vitest.config.ts`: no `include`; default discovery plus `exclude: .claude/**`. `bin/e2e/` is found automatically. No `setupFiles`/path references.
- `tsconfig.json`: `include: ["src"]`, no `paths`, no `baseUrl`, no `exclude`. `package.json`: no `imports` map. **No path aliases exist**, so only relative specifiers change. Npm scripts (`test`, `typecheck`, `depcheck`) use `src/**` globs or no paths: no change. No CI config exists in the repo (no `.github`, no `.gitlab-ci.yml`).
- `src/bin/tui-back.mjs` is referenced by `package.json` `bin`, `install.sh` and the e2e tests, and stays put.

### 5.3 Process rules for 14.2 to 14.5

- **Drift check**: each story starts by re-running the mapping check (`epic-14/audit-mapping-check.py`, run from the repo root; it rebuilds the mapping from `git ls-files`). It exits non-zero on any unmapped file (so also on a file added or renamed since 14.1) and on the `poll`/`hooks` collision. Update the document, then proceed.
- **Name collisions** for new folders, checked against the tree: `driven/runtime`, `driven/vcs`, `driven/storage` (no existing sibling of those names under `adapters/driven/`; `modules/` remains); `core/workspace`, `core/runtime`, `core/insight` (none exists under `core/`; `core/shared` and `core/ports/*` untouched; `core/ports/runtime|vcs|storage|modules` are separate folders from the `driven/*` ones). `tui/shared/screens`, `components/{inputs,pickers,lists,dialogs,layout,chrome,feedback,display}` and `slices/{logs,...}` do not exist yet. Re-verify with `git ls-files` before each story.
- **Commits**: `typecheck` must pass at every commit, so each `git mv` commit includes the matching import fixes (and the 5.1 edits). "Moves first, edits second" means moves are not mixed with other changes, not that imports are fixed in a later commit.
- **Role-assignment criteria** (ambiguous files): a file goes where its primary role is, judged by (1) what imports it most, (2) what it renders or computes, (3) co-location with its `.logic`/`.test`. `branch-owners-text` -> `pickers/` (helper of `branch-picker`, also used by the wizard). `hints.ts` -> `dialogs/` (static key hints shown by the help dialog and footers, tested next to `keybinding-help`). `text-edit.ts` -> `inputs/` (editing helper of `text-input-line`). `dev-auth` and `health-probe` ports -> `ports/runtime/` (they describe runtime service interaction, not persistence or VCS).

### 5.4 Approval checklist (approved by user 2026-11-19)

- [x] Ask First 1: do NOT keep `shared/settings` flat: split one folder per tab (**changed by user**, 14.2). Approved by user 2026-11-19
- [x] Ask First 1: do NOT keep `tui` root flat: tests to `app-shell-tests/` (**changed by user**, 14.5). Approved by user 2026-11-19
- [x] Ask First 2: regroup `core/ports` (paths change, names do not). Approved by user 2026-11-19
- [x] Ask First 5: group `core` and `adapters/driven` into families. Approved by user 2026-11-19
- [x] New family and folder names (`core/{workspace,runtime,insight}`, `driven/{runtime,vcs,storage}`, `ports/{runtime,vcs,storage,modules}`, `components/{inputs,pickers,lists,dialogs,layout,chrome,feedback,display}`, `shared/screens`, `slices/{logs,update,shared-types,terminal,maintenance,workspace,app}`). Approved by user 2026-11-19
- [x] Fold `shared/poll/` into `shared/hooks/`. Approved by user 2026-11-19
- [x] Non-pure edits listed in 5.1. Approved by user 2026-11-19

### Overlaps between stories (flagged)

- `branch-owners-text.ts` (+ test) leaves `shared/` for `shared/components/pickers/` in 14.2. It is imported by `zones/edts/dialogs/create-wizard/*` (14.5); 14.2 updates those import specifiers only, files are not moved there.
- `shared/poll/` is folded into `shared/hooks/` by 14.2; `zones/*` importers (14.3) are updated by 14.2.
- `zones/edts` root (14.3) and `zones/edts/dialogs` (14.5) are disjoint file sets; `dialogs/` keeps its path during 14.3.
- 14.3 requires 14.2 (shared paths), 14.5 requires 14.4 (core/ports/core paths).

## 6. Layering check against `.dependency-cruiser.cjs`

- `no-core-to-adapters` (`from ^src/core`, `to adapters(/|$)`): all core moves stay under `src/core`. New folders `workspace`, `runtime`, `insight`, `ports/*` contain no segment named `adapters`; core imports only get deeper relative prefixes. No core file gains an import of anything outside `src/core`. The `to.path` is unanchored and matches raw NodeNext specifiers, so a core file importing `../../adapters/...` would be flagged: none exists today and none is introduced.
- `no-tui-leak-outside-driving-tui` (`to tui(/|$)`): every TUI move stays under `src/adapters/driving/tui`. No folder outside it is named `tui`. `src/bin/tui.ts` (sanctioned composition root) keeps its path and keeps importing `app-shell` from the unchanged `tui/` root. The new `bin/e2e/` tests are not inside `tui` and import only `bin` helpers.
- `no-child-process-outside-driven-adapters` (`from ^src/(core|adapters/driving)`): `child_process` remains imported only by `adapters/driven` files (`process.ts`, `git`, `shell-session`, ...). Regrouping under `driven/runtime|vcs|storage` keeps them in `adapters/driven`. The e2e tests under `src/bin/` are not matched by the rule `from` today either (`src/bin` is outside `core|adapters/driving`), so behaviour is unchanged.
- Hexagonal direction is preserved: `driven/*` implement ports from `core/ports/*`, `driving/*` call core, `bin` composes. No move changes which layer a file lives in.
- Co-location: the mapping assigns each `.logic`, `.test`, `.<topic>.test` and `.test-support` file to the same folder as its module (or, for zone test-support/integration scenarios, to the zone root and `scenarios/` which import it by relative path). The few cases where a test targets a module in another folder (e.g. `update-zone.grouping.test.ts` tests `update-zone.logic.ts`, both in `logic/`) are mapped together.
- Verification per story (from the epic): `npm test && npm run typecheck && npm run depcheck`, one `git mv` per commit, files moved first and import edits second.

### Docs and `AGENTS.md` paths to update (14.5 unless noted)

- `AGENTS.md` line 7: `depcheck` description (no change needed to the glob); line 5 example `src/core/result.ts` stays valid (`result.ts` remains at the `core` root); line 18 (`src/core/`, `src/adapters/driven/`, `src/adapters/driving/`, `src/bin/`) stays valid; line 21 `src/adapters/driving/cli/dispatch.ts` becomes `.../cli/dispatch/dispatch.ts`; line 36 `src/bin/tui-back.e2e.test.ts` becomes `src/bin/e2e/tui-back.e2e.*.test.ts`. Also describe the new grouping folders in one sentence.
- `docs/tui-back-manifest.md`: `src/core/ports/manifest.ts` -> `src/core/ports/vcs/manifest.ts`; `src/core/ports/shared-types.ts` -> `src/core/ports/modules/shared-types.ts` (14.4); `src/core/service-status` -> `src/core/runtime/service-status`; `src/core/routes/fire-request.ts` -> `src/core/insight/routes/fire-request.ts`; `src/adapters/driven/manifest/*` -> `src/adapters/driven/vcs/manifest/*`; `src/adapters/driven/modules/*` unchanged.
- `docs/test-splitting-conventions.md`: refer only to `src/` generically; re-read for explicit paths in 14.2.
- Manifest surface is not changed, so no `manifest-generator` skill update is needed.
- `src/adapters/driving/tui/shared/README.md` stays in place (14.2); `src/adapters/driving/tui/shared/theme` unchanged.
- `package.json` `files` patterns are glob-based (`src`, `!src/**/*.test.ts(x)`, `!src/**/test-support`, `!src/**/*.test-support.ts(x)`) and keep working for all new folders (check with `npm pack --dry-run` after 14.5).
- `src/bin/tui-back.mjs` stays at the `bin` root (referenced by `package.json` `bin` and `install.sh`).

## 7. Verification of this story

- `git diff --stat devlopment -- src`: empty.
- `npm run depcheck` baseline: no dependency violations (1642 modules, 4366 dependencies). `npm run typecheck` baseline: passes. `npm test` baseline: **does not start** in this checkout (`vitest.config.ts` fails to load: rolldown `sourcemapPathTransform` error, an environment/dependency problem unrelated to this story). Per CLAUDE.md, try `rm -rf node_modules && npm ci` before 14.2 so the test gate can run. Note `npx depcruise src --config ...` without the package script's extension glob only cruises 3 modules, so `npm run depcheck` is the meaningful baseline.
- Mapping completeness: generated by script from `git ls-files`; every direct file of every split directory is assigned to exactly one folder (script aborts on unmatched files), and no target folder exceeds 10 files.
