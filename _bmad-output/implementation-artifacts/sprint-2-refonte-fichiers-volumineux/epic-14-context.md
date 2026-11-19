# Epic 14 Context: Directory Reorganization

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Give overcrowded `src/` directories a readable sub-tree by moving files into role- or concern-based sub-folders. This is the last epic of the large-file refactoring sprint: it runs after the source and test splits (epics 12 and 13) because file moves would conflict with in-flight splits. It is a pure-structure change with no functional change and no new requirement.

## Stories

- Story 14.1: Directory Audit and Target Tree
- Story 14.2: Reorganize `shared/components` and `shared`
- Story 14.3: Reorganize Store Slices and Zone Folders
- Story 14.4: Reorganize Core Folders
- Story 14.5: Reorganize Wizard Dialogs and Top-Level Layout

## Requirements & Constraints

- Refactor contract: behaviour-preserving (no change of public behaviour, CLI output, TUI rendering or persisted data); moves first, edits second; no dangling imports.
- Green gates before every commit: `npm test && npm run typecheck && npm run depcheck`.
- Atomic commits, one move per commit, `refactor(<scope>): ... (story N.M)` in English, with a body explaining why. Files move with `git mv` to keep history.
- Overcrowded means more than 10 files or more than 10 subdirectories in a `src/` directory. Audited at sprint start: `tui/shared/components` (66 files), `tui/store/slices` (30), `tui/shared` (27 files + 9 subdirs), `tui/zones/update` (27), `core/edt` (24), `core/scripts` (22), `core/ports` (20), `tui/zones/logs` (14), `create-wizard` (13), `core/shared-types` (12), `tui/zones/routes` (11), `core` (12 subdirs), `adapters/driven` (18 subdirs). 14.1 must refresh these counts against the repo after epics 12 and 13.
- Port interfaces must stay importable under their current names.
- Top-level `core` and `adapters/driven` get either grouping folders or a documented decision to keep them flat; `docs/` and `AGENTS.md` path references must be updated accordingly.

## Technical Decisions

- The architecture is hexagonal (ports and adapters): `core` is the domain and application layer with zero import of Ink/React/dockerode/child_process/better-sqlite3/fs; driven adapters and driving adapters (TUI, CLI) surround it. The new tree must respect these layers and the dependency-cruiser rules, with no new cross-layer import.
- Keep the co-location habit: `<name>.logic.ts` and `<name>.test.ts` stay next to their module (and the test naming convention from epic 13, `<module>.<topic>.test.ts(x)` with `<module>.test-support.ts`).
- Suggested groupings (to be confirmed in 14.1): `shared/components` by role (inputs, lists, dialogs, layout, feedback); slices by domain; zone folders into sub-folders such as view, logic, hooks, panels; core folders by use case or concern; the wizard per step.
- Each crowded directory gets a one-line verdict (split or keep) and, for splits, a file-to-folder mapping in the 14.1 proposal.
- Ink/React tests: keep a single React copy (no stray `node_modules/node_modules`); each worktree needs its own `npm ci`.

## Cross-Story Dependencies

- 14.1 blocks everything else: its target tree must be approved by the user before 14.2 starts.
- 14.2 requires 14.1; 14.3 requires 14.1 and 14.2; 14.4 requires 14.1; 14.5 requires 14.1 and 14.4.
- Requires epics 12 and 13 merged and closed (both are).
