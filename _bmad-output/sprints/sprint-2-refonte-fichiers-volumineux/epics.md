---
sprint: sprint-2
sprintName: Refonte des fichiers volumineux
inputDocuments:
  - _bmad-output/planning-artifacts/prds/prd-tui-back-2026-08-10/prd.md
  - _bmad-output/planning-artifacts/architecture/architecture-tui-back-2026-08-11/ARCHITECTURE-SPINE.md
---

# tui-back - Sprint 2: Large-File Refactoring

## Overview

Sprint 2 started as a pure-structure refactoring sprint (Epics 12-14: no functional change, no new requirement), following the audit of every file over 200 lines (about 190 files: 60 sources, 130 tests). Epic 15 (added 2026-11-26, Sprint Change Proposal `sprint-change-proposal-2026-11-26.md`) follows the tool audit of 2026-11-25 and does change behaviour: reliability, performance, UX and a few features. Epic numbers continue from sprint 1 (epics 1-11).

Common rules for every story of Epics 12-14 (referred to below as the **refactor contract**; it does not apply to Epic 15):

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
- Epic 15: Reliability, Performance and UX Hardening (added 2026-11-26)

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

## Epic 15: Reliability, Performance and UX Hardening

> Added 2026-11-26 (Sprint Change Proposal `sprint-change-proposal-2026-11-26.md`), from the tool audit of 2026-11-25. Unlike Epics 12-14 this epic changes behaviour: the refactor contract does **not** apply; the usual gates (`npm test && npm run typecheck && npm run depcheck`, atomic commits, story number in the subject) do. Adds FR-54 to FR-58 and NFR-8; amends AD-3 and AD-7; brings the code back in line with AD-10 (state re-sync) and AD-12 (batched log rendering). Stories 4.8 and 4.9 move here from sprint 1 as 15.17 and 15.18.

Make the tool trustworthy under crashes, slow networks and concurrent CLI/MCP use, keep it fast under chatty log streams, and smooth the CLI and TUI rough edges. Stories are ordered by priority in four waves: quick wins (15.1-15.4), robustness (15.5-15.9), structure (15.10-15.15), features (15.16-15.21).

### Story 15.1: Restore the Test Gate

As a maintainer, I want `npm test` to start again, so that the green-gate rule protects every commit.

**Acceptance Criteria:**

**Given** the locked vite 8.3.8 / rolldown 1.2.19 pair **When** `npm test` runs **Then** it no longer fails with `sourcemapPathTransform option: The function returned object` (fix: `vitest run --configLoader runner` in the `test` script, or a vite version known to bundle the config; the choice and its reason are in the commit body).

**Given** the fixed script **Then** the full suite passes (5717 tests at audit time) and `AGENTS.md` mentions the flag if the script changes.

**Given** the `MaxListenersExceededWarning: 11 resize listeners added to [FakeTtyStdout]` printed by the suite **Then** its source is identified: if it comes from the test harness (several renders on one fake stdout), the harness raises the limit or disposes the renders; if a production component leaks `resize` listeners, it is fixed and a test locks it.

**Prerequisites:** none. Do first: every later story depends on a working gate.

### Story 15.2: Non-Interactive, Time-Bounded Git

As a developer, I want every git call to be non-interactive and bounded in time, so that a credential prompt or a stalled remote never freezes the TUI or an update.

**Acceptance Criteria:**

**Given** the git adapter **Then** every git invocation goes through one helper that sets `GIT_TERMINAL_PROMPT=0` and `GIT_SSH_COMMAND` with `-o BatchMode=yes` (keeping a user-set `GIT_SSH_COMMAND` and only appending the option), including `fetchBranch` and `fetchRemoteBranch`, which set neither today (`refs/remote.ts`).

**Given** a git call **Then** it carries a timeout: a local-operation default (about 15 s) and a network-operation default (about 60 s, `fetch`, `pull`, `ls-remote`); on expiry the child is killed and the use-case returns `git-timeout` with the command and the repo path, never a hang.

**Given** the restart and migration adapters (`runRestart`, migration runner) **Then** they also get a timeout (manifest commands: generous default, documented), closing the matching deferred-work entry.

**Given** tests **Then** an integration test proves a fetch against an unresponsive remote (e.g. a local fake that never answers) ends with `git-timeout`, and a unit test proves the env is applied to every git call.

### Story 15.3: CLI Help, Version and Typo Suggestions

As a developer, I want `--help`, `--version` and suggestions on typos, so that the CLI answers the first things I try.

**Acceptance Criteria:**

**Given** `tui-back --help`, `tui-back help` or `tui-back <command> --help` (e.g. `edt switch --help`) **Then** it exits 0 with that command's usage, a one-line description per flag and at least one example, in the AD-3 envelope (human text on a TTY, `data.usage` piped); today these fail with `unknown-subcommand` / `invalid-argument`.

**Given** `tui-back --version` or `-V` **Then** it prints the `package.json` version (and the git commit when installed from GitHub, if cheaply available) and exits 0.

**Given** an unknown command or action (e.g. `edt swich`) **Then** the error names the closest valid one (`Did you mean "switch"?`, edit distance ≤ 2) and no longer dumps every usage line; `details.suggestion` carries it piped.

**Given** the usage strings **Then** the long explanations in parentheses move to the per-command help; `tui-back --help` stays one line per command.

**Given** bash completion **Then** it offers `--help` and stays generated from the registry.

### Story 15.4: Triage the Deferred-Work Ledger

As a maintainer, I want `deferred-work.md` triaged against today's code, so that Epic 15 does not redo resolved work and nothing important is lost.

**Acceptance Criteria:**

**Given** the 1046-line ledger **When** triaged (with `bmad-loop-sweep` or by hand) **Then** every open entry is classified as resolved (with the commit or story that fixed it), covered by an Epic 15 story (its key noted), still open, or won't fix (with a reason).

**Given** the entries covered by Epic 15 (non-atomic writes, switch crash atomicity, pre-lock modify checkout, sequential reads, overlay key leaks, `submitting` guards, restart timeout, stash accumulation) **Then** they point to their story and are closed when the story is done.

**Given** a still-open entry with real user impact not covered here **Then** it is listed in the story's completion note as a candidate for a later story; no new story is added without the user's approval.

**Prerequisites:** none. Can run in parallel with 15.1-15.3.

### Story 15.5: Atomic Persistence Writes

As a developer, I want state and registry files written atomically, so that a crash or Ctrl+C mid-write never leaves the tool unusable.

**Acceptance Criteria:**

**Given** `state.json`, `registry.yaml`, `edts.yaml` and `settings.yaml` (today plain `writeFile` in `storage/{state,registry,edt-registry,settings}`) **Then** each write goes through one shared `atomicWriteFile` helper: write to a temp file in the same directory, `fsync`, `rename` over the target, then a best-effort `fsync` of the directory.

**Given** a temp file left by a crash **Then** it is ignored on read and cleaned up on the next write.

**Given** a target that cannot be parsed on read (corrupt from an older version) **Then** the error code stays the current one and its message names the file and the repair command from Story 15.19 (`tui-back doctor`).

**Given** tests **Then** an integration test simulates a failure between write and rename and proves the previous content is intact; the existing `manifest/carry.ts` staging-and-rename code is checked and reuses the helper if it fits.

### Story 15.6: Re-Sync the TUI With External Changes

As a developer driving tui-back from the CLI or an MCP agent while the TUI is open, I want the TUI to pick up those changes, so that it never shows or acts on a stale active EDT.

**Acceptance Criteria:**

**Given** the TUI running **When** `state.json` or `edts.yaml` changes on disk (CLI `edt switch`, MCP `edt-create`, …) **Then** the store re-reads them within about 1 s (`fs.watch` on the directory, debounced about 200 ms, with a periodic poll fallback where `fs.watch` is unreliable), as AD-10 requires; today it only refreshes after its own `switchEdt`.

**Given** a re-sync while a TUI action holds the lock on that EDT **Then** it is deferred until the action ends; the TUI's own writes never trigger a redundant reload loop.

**Given** an external active-EDT change **Then** a short notice tells the user (`Active EDT changed outside the TUI: <topic>`), and zones scoped to the old EDT (dashboard, update, logs) reload.

**Given** tests **Then** the store is tested directly with a fake watcher (change, burst, own write, deferred-while-locked).

### Story 15.7: Dashboard Auto-Refresh

As a developer, I want the dashboard to refresh itself, so that I do not act on a branch or health state that is minutes old.

**Acceptance Criteria:**

**Given** the dashboard zone is visible **Then** it reloads every `dashboard.autoRefreshSeconds` (new setting, default 30, `0` = off, editable in the settings screen), reusing `loadDashboard({ queueIfBusy: true })`; it never stacks two loads.

**Given** the dashboard is not the active zone or an overlay is open **Then** no automatic reload runs; it runs once when the dashboard becomes active again if the data is older than the interval.

**Given** a reload in progress **Then** the current data stays on screen (no flash back to the loading line); the "updated Ns ago" line shows the refresh.

### Story 15.8: Batched Log Rendering and Ring Buffer

As a developer watching chatty services, I want log panes to stay smooth, so that the TUI keeps its ~150 ms response budget (AD-12).

**Acceptance Criteria:**

**Given** a log stream **Then** store updates are batched: lines are appended in `core/logs` as they arrive, but the store mirror runs at most every about 50-100 ms per pane (like `TERMINAL_FLUSH_MS`), never once per line as today (`logs-slice.panes.ts` mirror, `getEntry` copying the whole buffer per line).

**Given** the per-service buffer **Then** it is a ring buffer (no `splice(0, …)` per line) and the view reads a bounded window without copying the full buffer on every update.

**Given** a line emitted by a container **Then** it is still visible within about 1 s (PRD performance target).

**Given** tests **Then** a store test pushes 10 000 lines in one tick and asserts a bounded number of store updates; a core test covers wrap-around, `loadOlder` prepends and the scroll offset after eviction.

### Story 15.9: Log Stream Auto-Reconnect

As a developer, I want a log pane to reconnect by itself after the container restarts, so that I do not have to re-open it after every `heal` or `update`.

**Acceptance Criteria:**

**Given** a `docker logs -f` stream that ends or fails (`log stream ended for …`, unexpected exit) **When** the pane is still subscribed **Then** it retries with backoff (1 s, 2 s, 5 s, then every 10 s), resuming with `--since` at the last received timestamp so no line is duplicated or lost.

**Given** a retry pending **Then** the pane shows a dim `reconnecting…` line, not a frozen error; a manual retry key reconnects at once.

**Given** a container that comes back after a restart triggered by tui-back itself **Then** the stream reconnects as soon as the restart completes, without waiting for the backoff.

**Given** unsubscribe or zone exit **Then** pending retries are cancelled (no orphan `docker` child, no timer leak).

### Story 15.10: Crash-Safe EDT Switch

As a developer, I want an EDT switch interrupted by a crash to be detected and repaired, so that `state.json` and `edts.yaml` never stay inconsistent (PRD Reliability NFR).

**Acceptance Criteria:**

**Given** a switch **Then** before its first write it records an intent journal (`switch-journal.json` in the state dir: from, to, start time, steps planned) and timestamped backups of `state.json` and `edts.yaml`, and it removes the journal once every write has succeeded.

**Given** a journal found at startup (TUI or any mutating CLI/MCP command) **Then** the tool reports the interrupted switch and offers to finish it (re-run the switch to the target) or roll back the state files (restore the backups); git working trees are never touched by the rollback, only reported.

**Given** backups **Then** only the last 5 are kept.

**Given** tests **Then** core tests with fake ports simulate a crash after each write step and prove both repair paths leave a consistent state.

**Prerequisites:** 15.5.

### Story 15.11: Lock Before Checkout in EDT Modify

As a developer, I want concurrent `edt modify` calls to be serialized, so that the reported result always matches what was persisted.

**Acceptance Criteria:**

**Given** `modifyEdt` **Then** the action lock (AD-9) is acquired before step 3 (protected switch: stash, checkout, restore), not only around the final registry write (`lifecycle/modify.ts`).

**Given** two concurrent modifies adding the same repo with different branches **Then** one waits or fails `action-in-progress`; the repo's branch and the registry agree with the winner's reported `results`.

**Given** `setBranches` with an empty branch **Then** core rejects it (`invalid-argument`) instead of relying on the TUI check only (deferred-work entry).

**Given** tests **Then** a core test with a fake lock and an interleaving proves the result matches what was persisted.

### Story 15.12: Bounded-Concurrency Repo Reads and Switch

As a developer with many repos, I want EDT listing and switching to process repos in parallel, so that one slow repo does not hold up the others.

**Acceptance Criteria:**

**Given** `listEdtBranchesDivergence` / `edt list` (`lifecycle/list.ts`, sequential `for…await`) **Then** repos are read with a bounded concurrency (one shared `mapWithConcurrency` helper, limit 6), and `aheadBehind` takes the already-resolved branch instead of calling `currentBranch` a second time.

**Given** an EDT switch **Then** the per-repo steps that do not depend on each other (fetch, stash, checkout of different repos) run with the same bounded concurrency; anything that must stay ordered (the final state writes) stays sequential, and per-repo outcomes keep their current order in the output.

**Given** tests **Then** existing outputs are unchanged and a core test with a slow fake repo proves the others are not blocked.

### Story 15.13: File-System Port for the EDT Lifecycle

As a maintainer, I want core to stop calling `node:fs` directly, so that AD-1 holds and create/delete are testable with fake ports (AD-13).

**Acceptance Criteria:**

**Given** `core/workspace/edt/lifecycle/create.ts` (`existsSync`, `mkdirSync`, `rmSync`, `writeFileSync`) and `delete.ts` (`rmSync`) **Then** these go through a port (an `EdtStoragePort` or an extension of an existing storage port) implemented in `adapters/driven/storage`, async, using Story 15.5's atomic write.

**Given** depcheck **Then** a new rule forbids `node:fs` imports under `src/core/` (except type-only imports), and it passes.

**Given** tests **Then** create/delete core tests use the fake port; an adapter integration test covers the real directory layout.

### Story 15.14: TUI Input Guards

As a developer, I want keys to reach only the layer I am looking at, so that typing in an overlay or a busy form never triggers something underneath.

**Acceptance Criteria:**

**Given** any shell overlay (`registryScreenOpen`, `filterOpen`, `helpOpen`, settings, command bar) **Then** no zone `useInput` under it receives keys: the gate is one shared selector (`isZoneInputActive`) used by every zone, instead of each zone listing the flags it knows about.

**Given** a create or modify dialog showing `Creating…` / `Saving…` **Then** every key except Escape (when cancellation is supported) is ignored until the submit settles (`handleCreateInput` / `handleModifyDialogInput` check `submitting`).

**Given** tests **Then** a registry-driven test opens each overlay over each zone and asserts the zone handler receives nothing; a dialog test types during submit and asserts the draft is unchanged.

### Story 15.15: Consistent CLI Command Names

As a developer and as an MCP agent, I want command names grouped by noun, so that the CLI is guessable.

**Acceptance Criteria:**

**Given** the current flat names **Then** the canonical commands become `repo list` (was `list-repos`), `repo register`, `repo scan`, `edt list` (`edts` becomes its alias), `route list` (was `list-routes`), `route favorites …` (was `routes favorites …`), `route smoke`, `request fire <repoPath> <METHOD> <path>` (was `fire-request`), `request replay <name>` (was `request-fire`), `request list`, `request delete`.

**Given** an old name **Then** it still works as a deprecated alias: same behaviour and envelope, plus a one-line `deprecated: use "<new>"` notice on stderr (TTY only, so piped JSON stays one line); completion lists only canonical names.

**Given** the MCP tools **Then** they get the matching canonical names (`request-replay` instead of `request-fire`, …), with the old names still registered as aliases with the same safety class; the README tool table and `docs/` are updated.

**Given** the subcommand registry guards (`assertUniqueSubcommandNames`, completion, MCP registry) **Then** they cover aliases.

**Prerequisites:** 15.3.

### Story 15.16: Stash Inventory and Prune

As a developer, I want to see and clean the stashes tui-back created, so that `tui-back:<ulid>` stashes of repos never revisited do not pile up.

**Acceptance Criteria:**

**Given** `tui-back stash list` (and an MCP read tool `stash-list`) **Then** it lists every `tui-back:<ulid>` stash across registered repos with repo, EDT topic (or `deleted EDT`), age and file count.

**Given** `tui-back stash prune [--older-than <days>] [--orphans-only] --yes` (MCP destructive tool `stash-prune`) **Then** it drops the selected stashes and reports each; without `--yes` on a non-TTY it refuses (`confirmation-required`); on a TTY it asks.

**Given** an orphan (its EDT no longer exists, or the repo is no longer a member of it) **Then** it is flagged in `list` and the dashboard shows a dim attention line when orphans exist.

**Given** the git gate (AD-8) **Then** `stash drop` goes through the git adapter; no stash that tui-back did not create is ever touched.

### Story 15.17: Manifest-Declared Generated Files, Regenerated on Update Conflict

> Moved from sprint 1 (was Story 4.8, `backlog`) on 2026-11-26. Content unchanged; FR-52 and AD-26 still apply.

As a developer, I want conflicts on files that a command regenerates to be settled by running that command, so that a barrel (`index.ts`) conflict never interrupts an update.

**Acceptance Criteria:**

- **Given** a manifest declaring `generatedFiles: [{ glob: "**/index.ts", command: "npm run barrels" }]` **When** it is loaded **Then** it validates; an entry with a blank `glob` or `command`, an absolute or `..` glob, or an unknown key fails validation with a precise message (`manifest-validation-failed`); an absent key means no generated files and changes nothing for existing manifests.
- **Given** a merge or pull conflict in a repo declaring `generatedFiles` **When** the conflicted paths all match a declared glob **Then** the declared command runs once in the repo directory, no conflict marker remains in the matched files afterwards, the matched files that differ are staged (`GitPort.stagePaths`, AD-8), and the merge completes through the existing flow; the row's conflict outcome is `auto-resolved`.
- **Given** conflicted paths that match no declared glob **When** the resolver runs **Then** it does not touch them: they stay conflicted and the existing assisted-resolution flow (Story 3.4) presents them; the generated files are regenerated **only once every other conflicted path is settled** (the resolver is idempotent and is re-run after the developer's edits and before each menu presentation); until then the row's outcome is `partial`.
- **Given** the declared command fails (non-zero exit, unspawnable shell, or a conflict marker still present in a matched file) **When** it ran **Then** nothing is staged, the conflict stays open, and the run tracking shows the issue (command, exit status, first lines of output); the developer can fix and retry through the same menu.
- **Given** the command modified files that match no declared glob **When** it finished **Then** those files are neither staged nor reverted, and the issue line lists them.
- **Given** two declared entries with the same `command` **When** both match **Then** the command runs once.
- **Given** a repo that also has the `shared-types-consumer` module **When** its merge conflicts on `package.json` and on `index.ts` **Then** both resolvers run through one composed seam (each settles only its own files); the outcome is `auto-resolved` only if together they settled every conflicted path, otherwise `partial`.
- **Given** the docs **When** updated **Then** `docs/tui-back-manifest.md` documents `generatedFiles` (semantics, glob rules, ordering, failure behaviour, the trust note, an example for the `shared-types` source repo, the error row) **and** the `manifest-generator` skill detects likely candidates (a `barrels`/`generate`-style script, generated-file headers) and offers the entry.

**Implementation notes:** the resolver returns the existing `AutoResolveResult`; a `compose-auto-resolvers` helper folds N resolvers into one `AutoResolveConflict` (results merged: `touched` OR-ed, issues joined) so `groupUpdate`'s signature is unchanged. No git write beyond `stagePaths`. The command runs with Story 15.2's timeout. Paths: since sprint 2 the group update lives under `core/workspace/scripts/group-update/`; place the new modules there. Tests: pure resolver with a fake git and command port (all-generated, mixed, command failure, marker left, extra files touched, duplicate commands, idempotent rerun); schema tests; composition tests; manifest docs and skill updated in the same commits as the schema (one commit each: schema → resolver → composition + TUI wiring → docs + skill).

### Story 15.18: Update Conflict Auto-Resolution in the CLI and MCP

> Moved from sprint 1 (was Story 4.9, `backlog`) on 2026-11-26. Content unchanged.

As a developer or an agent running `tui-back update`, I want the same automatic conflict resolution the TUI has, so that a script or an MCP session does not stop on a conflict the tool can settle.

**Acceptance Criteria:**

- **Given** the CLI `tui-back update …` (main, all-repos, single-service) **When** a service's merge conflicts **Then** the composed auto-resolvers of Story 15.17 (the `shared-types` consumer resolver when its module is declared, the generated-files resolver when `generatedFiles` is declared) run exactly as in the TUI.
- **Given** the resolvers settle every conflicted path **When** the run continues **Then** the service completes (migrate → restart) and the envelope row carries `conflict: "auto-resolved"`.
- **Given** a conflict the resolvers cannot fully settle **When** run non-interactively **Then** behaviour is exactly today's for the CLI (the service is skipped or paused as it is now, repo left mid-merge with the issue named); the envelope row carries `conflict: "partial"` or `"left-to-user"` and the resolver's `issue` text.
- **Given** the MCP `update` tool **When** invoked **Then** it behaves as the CLI (same use-case and wiring); no new tool and no change to the authorization policy (AD-25: it was already a write tool).
- **Given** the existing TUI behaviour **When** this story lands **Then** it is unchanged (one shared builder of the composed resolver replaces the TUI-local one; no duplicated wiring).

**Implementation notes:** extract `buildAutoResolveConflict` from the update slice (now under `store/slices/update/`) into a driving-neutral factory, used by both the slice and `cli/commands/update.ts`. Tests: CLI e2e with a conflicting fixture repo for each resolver and for a mixed conflict.

**Prerequisites:** 15.17.

### Story 15.19: `tui-back doctor`

As a developer, I want one command that checks my whole setup, so that I can tell in seconds why something does not work.

**Acceptance Criteria:**

**Given** `tui-back doctor` (CLI, MCP read tool `doctor`, and a `:doctor` TUI command) **Then** it checks and reports, each as `ok` / `warn` / `fail` with a fix hint: Node version, `git` and `docker` on `PATH` and reachable, data/state dirs writable, `state.json` / `edts.yaml` / `registry.yaml` / `settings.yaml` parseable, every registered repo reachable with a valid manifest, stale locks (dead pid), leftover temp files (15.5), an interrupted switch journal (15.10), orphan stashes (15.16).

**Given** `tui-back doctor --fix --yes` (MCP: write tool) **Then** it repairs only safe items: removes stale locks and temp files, and offers the 15.10 repair; it never edits git working trees or manifests.

**Given** any `fail` **Then** the exit code is 1 and `data.checks` lists every check (AD-3).

**Prerequisites:** 15.5, 15.10 (for their checks; the command can land earlier with those checks added when they exist).

### Story 15.20: Operation History

As a developer, I want a history of what tui-back did, so that I can see who switched, updated or realigned what, when, and how it ended.

**Acceptance Criteria:**

**Given** a mutating use-case (switch, create, modify, delete, update, realign, heal, stash prune, doctor --fix) **When** it ends **Then** one entry is appended to an operation log (`<state dir>/history.jsonl`): time, origin (`tui` / `cli` / `mcp`), command, EDT, per-service outcomes, duration, error code; never secrets or request bodies.

**Given** `tui-back history [--limit N] [--edt <topic>]` (MCP read tool `history`) **Then** it lists the latest entries, newest first; the TUI shows the last entries in a `:history` overlay, bounded (AD-19).

**Given** the log **Then** it is capped (e.g. last 1000 entries or 1 MiB, older ones trimmed) and appended atomically line by line; a corrupt line is skipped, not fatal.

**Out of scope:** undoing an operation (a later story, if the history shows a need).

### Story 15.21: Close the Audit

As a maintainer, I want the audit's findings checked off against the code, so that Epic 15 can be closed with evidence.

**Acceptance Criteria:**

**Given** the audit findings listed in `sprint-change-proposal-2026-11-26.md` §1 **Then** each is marked done (story and commit), deferred (with a reason), or dropped, in the proposal's appendix.

**Given** the PRD performance target **Then** it is measured once by hand on the real workspace: CLI `dashboard` and `edt list` times, TUI log pane under a burst of lines, before and after Epic 15, recorded in the completion note.

**Prerequisites:** all other Epic 15 stories done or explicitly deferred.
