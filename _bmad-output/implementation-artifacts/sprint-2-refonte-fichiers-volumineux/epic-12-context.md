# Epic 12 Context: Source File Splitting

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Break the 14 oversized source files (about 900 to 1900 lines each) into cohesive modules of one responsibility each, so every concern can be read and changed in isolation. This is a pure-structure refactor: no functional change, no new requirement. Order is lowest-risk first (pure functions and adapters), React components last.

## Stories

- Story 12.1: Split the Git Adapter by Operation Family
- Story 12.2: Extract Pure Logic from json-tree and the Command Bar
- Story 12.3: Split the Settings Screen by Tab
- Story 12.4: Split the CLI Subcommands by Family
- Story 12.5: Split the Group Update Core
- Story 12.6: Split EDT Switch
- Story 12.7: Split the Zone Logic Modules
- Story 12.8: Split the Update and Logs Slices
- Story 12.9: Split RoutesZone into Hooks and Subcomponents
- Story 12.10: Split LogsZone into Hooks and Subcomponents
- Story 12.11: Split EdtsZone into Hooks and Subcomponents
- Story 12.12: Split UpdateZone into Hooks and Subcomponents

## Requirements & Constraints

Refactor contract, applying to every story:

- Behaviour-preserving: no change to public behaviour, CLI output, TUI rendering or persisted data. Moves first, edits second.
- Green gates before every commit: `npm test && npm run typecheck && npm run depcheck`.
- Public surface preserved: the original module path keeps re-exporting what it exported, or all importers are updated in the same story. No dangling imports.
- Size target: each produced source file under ~400 lines with one stated responsibility; a file that must stay larger is justified in the story file.
- Atomic commits: one extraction per commit, `refactor(<scope>): ... (story N.M)`, body explaining why.
- Existing tests named in each story must pass unchanged (that is the proof of equivalence). Test files are split separately in Epic 13, not here.
- Component splits (12.9 to 12.12) must keep hook ordering and Ink input priority identical.
- Guards that must keep passing without edits: unique subcommand names, completion guard, MCP registry guard.

## Technical Decisions

- Architecture is hexagonal (ports and adapters): `core/` has zero import of Ink, React, fs, child_process or similar; driven adapters (git, docker, persistence...) and driving adapters (TUI, CLI) sit around it. Dependency-cruiser rules enforce this; no new cross-layer import.
- All git writes go through the git adapter's branch-scope gate; splitting the adapter by family must keep every write behind that gate, with `index.ts` only composing `createGitPort`.
- Cross-zone state lives in one Zustand store; the `AppState` composition and public slice types stay unchanged when slices are split into sub-creators composed by `createUpdateSlice` / the logs slice.
- Group update keeps its bounded worker pool and the `onUpdatePhase` / `onServiceResult` / `onUpdateBlocker` seams; `groupUpdate` stays exported from `core/scripts/group-update.ts`. `switchActiveEdt` stays the orchestrator in `switch.ts`.
- Target module layouts: git (`branches`, `stash`, `merge`, `diff`, `discard`, `remote`, `commit`, names adjustable); switch (`switch/dirty.ts`, `switch/member.ts`); settings per-tab `*.logic.ts` plus per-tab view components; CLI per-family modules with `subcommands.ts` only registering in `buildSubcommands`; json-tree split into build/flatten, filter, selection/navigation, key resolution re-exported by `model.ts`; command-bar grid logic to `command-grid.logic.ts`.
- Zone `.logic.ts` files are grouped by concern (layout, focus, keys/visibility, filters/ANSI for logs; formatters, focus nav, modify ops, wizard state for edts; constants, formatters, resolvers, blocker menus for update), keeping original import paths valid.

## Cross-Story Dependencies

- 12.8 requires 12.7.
- 12.9 requires 12.2 and 12.7.
- 12.10 requires 12.7 and 12.8.
- 12.11 requires 12.7.
- 12.12 requires 12.7 and 12.8.
- 12.1 to 12.6 are otherwise independent.
- Epic 13 (test splitting) and Epic 14 (directory reorganization) follow; keep original paths stable so they are not disrupted.
