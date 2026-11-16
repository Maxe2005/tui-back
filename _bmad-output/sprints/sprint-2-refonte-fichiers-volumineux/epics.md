---
sprint: sprint-2
sprintName: Refonte des fichiers volumineux
inputDocuments:
  - _bmad-output/planning-artifacts/architecture/architecture-tui-back-2026-08-11/ARCHITECTURE-SPINE.md
---

# tui-back - Sprint 2: Large-File Refactoring

## Overview

Sprint 2 is a pure-structure refactoring sprint: no functional change, no new requirement. It follows the audit of every file over 200 lines (about 190 files: 60 sources, 130 tests). Epic numbers continue from sprint 1 (epics 1-11).

Common rules for every story of this sprint (referred to below as the **refactor contract**):

- **Behaviour-preserving**: no change of public behaviour, CLI output, TUI rendering or persisted data. Extractions are moves first, edits second.
- **Green gates** before every commit: `npm test && npm run typecheck && npm run depcheck`.
- **Public surface preserved**: the original module path keeps re-exporting what it exported (or all importers are updated in the same story). No dangling imports.
- **Size target**: every produced source file is under ~400 lines and has one stated responsibility; a file that must stay larger is justified in the story file.
- **Atomic commits**: one extraction per commit, `refactor(<scope>): ... (story N.M)`, with a body explaining why.
- **Layers respected**: dependency-cruiser rules (hexagonal boundaries) stay green; no new cross-layer import.

## Audit Findings (inputs)

- Sources to split (priority high): `routes-zone.tsx` (1935), `subcommands.ts` (1655), `settings-screen.tsx` (1644), `group-update.ts` (1602), `update-slice.ts` (1548), `logs-zone.tsx` (1404), `logs-slice.ts` (1282), `git/index.ts` (1222), `update-zone.tsx` (1163), `json-tree/model.ts` (1153), `logs-zone.logic.ts` (1054), `edts-zone.tsx` (1043), `edts-zone.logic.ts` (956), `core/edt/switch.ts` (893).
- Monolithic tests (2000-4800 lines): `edts-zone.interaction.test.tsx`, `group-update.test.ts`, `app-shell.interaction.test.tsx`, `app-store.test.ts`, `update-slice.test.ts`, `tui-back.e2e.test.ts`, `logs-zone.interaction.test.tsx`, `dispatch.test.ts`, `git/index.test.ts`.
- Overcrowded directories (more than 10 files or more than 10 subdirectories, `src/` only): `tui/shared/components` (66 files), `tui/store/slices` (30), `tui/shared` (27 files + 9 subdirs), `tui/zones/update` (27), `core/edt` (24), `core/scripts` (22), `core/ports` (20), `tui/zones/logs` (14), `create-wizard` (13), `core/shared-types` (12), `tui/zones/routes` (11), `core` (12 subdirs), `adapters/driven` (18 subdirs).

## Sprint Contents

- Epic 12: Source File Splitting
- Epic 13: Test File Splitting
- Epic 14: Directory Reorganization

## Epic 12: Source File Splitting

Break the oversized source files into cohesive modules, lowest-risk first (pure functions and adapters), React components last.

### Story 12.1: Split the Git Adapter by Operation Family

As a maintainer, I want `adapters/driven/git/index.ts` split into operation families, so that each git concern can be read and changed in isolation.

**Acceptance Criteria:**

**Given** `git/index.ts` (~40 independent operations) **Then** it is split into `branches.ts`, `stash.ts`, `merge.ts`, `diff.ts`, `discard.ts`, `remote.ts` and `commit.ts` (names may be adjusted to the actual clusters), and `index.ts` only composes `createGitPort`.

**Given** the refactor contract **Then** `git/index.test.ts` and `version-history.test.ts` pass unchanged.

### Story 12.2: Extract Pure Logic from json-tree and the Command Bar

As a maintainer, I want the pure tree and grid logic out of their files, so that the React parts stay small.

**Acceptance Criteria:**

**Given** `json-tree/model.ts` (1153 lines, 4 concerns) **Then** it is split into tree building/flattening, filter rules, selection/navigation and key resolution modules, re-exported by `model.ts`.

**Given** `command-bar.tsx` **Then** its grid layout and cursor logic (`layoutCommandGrid`, `moveGridCursor*`, tab-autocomplete helpers) move to `command-grid.logic.ts`, and the component keeps rendering and input wiring only.

**Prerequisites:** none.

### Story 12.3: Split the Settings Screen by Tab

As a maintainer, I want each settings tab to own its logic and view, so that adding a setting touches one file.

**Acceptance Criteria:**

**Given** `shared/settings-screen.tsx` (1644 lines) **Then** the clamp/adjust/parse helpers and row definitions move to per-tab `*.logic.ts` modules (general, update, logs, palette, shared-types, services), each tab view becomes its own component, and `SettingsScreen` is a thin shell with tab navigation.

**Given** `settings-screen.test.tsx` **Then** it passes unchanged.

### Story 12.4: Split the CLI Subcommands by Family

As a maintainer, I want one module per CLI command family, so that a command's flags, usage and runner live together.

**Acceptance Criteria:**

**Given** `cli/subcommands.ts` (1655 lines) **Then** usage strings, flag parsers and `runXxx` functions move to per-family modules (edt create/switch/modify/delete, update, realign, heal, registry, request), and `subcommands.ts` only registers them in `buildSubcommands`.

**Given** `assertUniqueSubcommandNames`, the completion guard and the MCP registry guard **Then** they keep passing without edits.

### Story 12.5: Split the Group Update Core

As a maintainer, I want the group-update flows and blocker handling separated, so that each recovery path is readable.

**Acceptance Criteria:**

**Given** `core/scripts/group-update.ts` (1602 lines) **Then** it is split into types, the all-repos flow, the EDT flow, blocker resolution (dirty, unpushed, mid-state), conflict resolution and the restart step, with `groupUpdate` still exported from the original path.

**Given** `group-update.test.ts` **Then** it passes unchanged.

### Story 12.6: Split EDT Switch

As a maintainer, I want the dirty-work handling of `switch.ts` isolated from the switch orchestration.

**Acceptance Criteria:**

**Given** `core/edt/switch.ts` (893 lines) **Then** dirty-repo resolution/planning/execution/adoption move to `switch/dirty.ts` and member/non-member repo switching to `switch/member.ts`; `switch.ts` keeps `switchActiveEdt` orchestration.

**Given** `switch.test.ts` and `switch-restart.test.ts` **Then** they pass unchanged.

### Story 12.7: Split the Zone Logic Modules

As a maintainer, I want the zone `.logic.ts` files grouped by concern.

**Acceptance Criteria:**

**Given** `logs-zone.logic.ts` **Then** layout, focus, key/visibility and log-filter/ANSI logic live in separate modules; **given** `edts-zone.logic.ts` **Then** formatters, focus navigation, modify operations and wizard state live in separate modules; **given** `update-zone.tsx` **Then** its constants, formatters, trigger/confirm resolvers and blocker menus move into `update-zone.logic.ts` and sibling modules.

**Given** the zone logic tests **Then** they pass unchanged against the original import paths.

### Story 12.8: Split the Update and Logs Slices

As a maintainer, I want the large store slices composed of focused sub-creators.

**Acceptance Criteria:**

**Given** `update-slice.ts` (1548 lines) **Then** its actions are grouped into config, run, incident and health-polling creators composed by `createUpdateSlice`; **given** `logs-slice.ts` (1282 lines) **Then** filters/rules, panes, health and actions are separated the same way.

**Given** the public slice types **Then** `AppState` composition is unchanged and `app-store.test.ts`, `update-slice.test.ts`, `logs-slice.test.ts` pass unchanged.

**Prerequisites:** 12.7.

### Story 12.9: Split RoutesZone into Hooks and Subcomponents

As a maintainer, I want `RoutesZone` decomposed, so that its input handling and panes are separately readable.

**Acceptance Criteria:**

**Given** `routes-zone.tsx` (a single ~1800-line component with 30 hooks) **Then** effects and input handling move to named hooks and the list, request panel and response pane become subcomponents.

**Given** hook ordering and Ink input priority **Then** behaviour is identical, proven by `routes-zone.test.tsx` and `routes-zone.interaction.test.tsx` passing unchanged.

**Prerequisites:** 12.2, 12.7.

### Story 12.10: Split LogsZone into Hooks and Subcomponents

As a maintainer, I want `LogsZone` decomposed the same way.

**Acceptance Criteria:**

**Given** `logs-zone.tsx` (1404 lines, 23 hooks) **Then** it is split into hooks and subcomponents, and `logs-zone.test.tsx` and `logs-zone.interaction.test.tsx` pass unchanged.

**Prerequisites:** 12.7, 12.8.

### Story 12.11: Split EdtsZone into Hooks and Subcomponents

As a maintainer, I want `EdtsZone` decomposed the same way.

**Acceptance Criteria:**

**Given** `edts-zone.tsx` (1043 lines, 15 effects) **Then** data loading, input handling and panels move to hooks and subcomponents, and `edts-zone.test.tsx` and `edts-zone.interaction.test.tsx` pass unchanged.

**Prerequisites:** 12.7.

### Story 12.12: Split UpdateZone into Hooks and Subcomponents

As a maintainer, I want `UpdateZone` decomposed the same way.

**Acceptance Criteria:**

**Given** `update-zone.tsx` (~850-line component, 18 hooks) **Then** it is split into hooks and subcomponents, and `update-zone.test.tsx` and `update-zone.interaction.test.tsx` pass unchanged.

**Prerequisites:** 12.7, 12.8.

## Epic 13: Test File Splitting

Mirror the source split in the test suite and share fixtures, so that a test file matches one module. Split tests only once the matching source split is merged.

### Story 13.1: Test Split Conventions and Shared Fixtures

As a maintainer, I want a convention for splitting tests, so that every split is done the same way.

**Acceptance Criteria:**

**Given** the 9 monolithic test files **Then** a short convention is written (file naming `<module>.<topic>.test.ts`, one `describe` family per file, shared builders in `<module>.test-support.ts`) and the repeated fixtures and helpers of the target files are inventoried.

**Given** the convention **Then** it is added to `docs/` or the architecture notes and referenced by stories 13.2-13.6.

### Story 13.2: Split the EDTs Zone Interaction Tests

As a maintainer, I want the 4828-line `edts-zone.interaction.test.tsx` split by scenario.

**Acceptance Criteria:**

**Given** the file **Then** it is split by scenario (create, switch, modify, delete, navigation, dialogs) with shared render helpers in a test-support module, with the same number of tests passing before and after.

**Prerequisites:** 12.11, 13.1.

### Story 13.3: Split Group Update and Switch Tests

As a maintainer, I want `group-update.test.ts` (3338) and `switch.test.ts` (1705) split like their sources.

**Acceptance Criteria:**

**Given** the files **Then** they are split per extracted source module (all-flow, EDT flow, blockers, conflicts; switch orchestration, dirty handling) with the same test count before and after.

**Prerequisites:** 12.5, 12.6, 13.1.

### Story 13.4: Split App Shell and Store Tests

As a maintainer, I want `app-shell.interaction.test.tsx` (3250), `app-store.test.ts` (2982) and `update-slice.test.ts` (2759) split.

**Acceptance Criteria:**

**Given** the files **Then** the app-shell tests are split by flow, the store tests by slice, and `update-slice.test.ts` by the sub-creators of story 12.8, with the same test count before and after.

**Prerequisites:** 12.8, 13.1.

### Story 13.5: Split Logs Zone and Update Zone Tests

As a maintainer, I want `logs-zone.interaction.test.tsx` (2457), `update-zone.test.tsx` (1466) and `routes-zone.interaction.test.tsx` (1752) split.

**Acceptance Criteria:**

**Given** the files **Then** they are split to mirror the hook/subcomponent split of stories 12.9, 12.10 and 12.12, with the same test count before and after.

**Prerequisites:** 12.9, 12.10, 12.12, 13.1.

### Story 13.6: Split CLI, E2E and Git Tests

As a maintainer, I want `tui-back.e2e.test.ts` (2744), `dispatch.test.ts` (2358) and `git/index.test.ts` (2210) split.

**Acceptance Criteria:**

**Given** the files **Then** the e2e and dispatch tests are split per command family (story 12.4) and the git tests per operation family (story 12.1), with the same test count before and after and unchanged total run time within reason.

**Prerequisites:** 12.1, 12.4, 13.1.

## Epic 14: Directory Reorganization

Give overcrowded directories a readable sub-tree. Run last: file moves conflict with in-flight splits.

### Story 14.1: Directory Audit and Target Tree

As a maintainer, I want an up-to-date inventory of crowded directories and a validated target tree before anything moves.

**Acceptance Criteria:**

**Given** the repository after epics 12 and 13 **Then** every directory under `src/` with more than 10 files or more than 10 subdirectories is listed with its counts, a one-line verdict (split or keep) and, for each split, the target sub-folders and file-to-folder mapping.

**Given** the proposal **Then** it respects the hexagonal layering and dependency-cruiser rules, keeps the `<name>.logic.ts` / `<name>.test.ts` co-location habit, and is approved by the user before 14.2.

### Story 14.2: Reorganize `shared/components` and `shared`

As a maintainer, I want the 66-file `tui/shared/components` and the 27-file `tui/shared` grouped by role.

**Acceptance Criteria:**

**Given** the approved target tree **Then** files move with `git mv` into role-based sub-folders (e.g. inputs, lists, dialogs, layout, feedback), imports are updated, and the refactor contract holds.

**Prerequisites:** 14.1.

### Story 14.3: Reorganize Store Slices and Zone Folders

As a maintainer, I want `store/slices` (30 files) and the `zones/update`, `zones/logs`, `zones/routes` folders grouped.

**Acceptance Criteria:**

**Given** the approved target tree **Then** slices are grouped by domain and each crowded zone folder gets sub-folders (e.g. view, logic, hooks, panels), with imports updated and the refactor contract holding.

**Prerequisites:** 14.1, 14.2.

### Story 14.4: Reorganize Core Folders

As a maintainer, I want `core/edt`, `core/scripts`, `core/ports` and `core/shared-types` grouped.

**Acceptance Criteria:**

**Given** the approved target tree **Then** the core folders get sub-folders by use case or concern, port interfaces stay importable under their current names, and dependency-cruiser stays green.

**Prerequisites:** 14.1.

### Story 14.5: Reorganize Wizard Dialogs and Top-Level Layout

As a maintainer, I want the 13-file `create-wizard` folder and the 12-subdir `core` / 18-subdir `adapters/driven` levels made easier to browse.

**Acceptance Criteria:**

**Given** the approved target tree **Then** the wizard is grouped per step, and top-level `core` and `adapters/driven` get either grouping folders or a documented decision to keep them flat, with `docs/` and `AGENTS.md` path references updated.

**Prerequisites:** 14.1, 14.4.
