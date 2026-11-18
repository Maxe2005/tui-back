# Epic 13 Context: Test File Splitting

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Mirror the epic 12 source split in the test suite so that each test file matches one module, and share fixtures and render helpers instead of repeating them. This is a pure-structure refactor of tests: no production code change and no new requirement. A split is done only once the matching source split is merged.

## Stories

- Story 13.1: Test Split Conventions and Shared Fixtures
- Story 13.2: Split the EDTs Zone Interaction Tests
- Story 13.3: Split Group Update and Switch Tests
- Story 13.4: Split App Shell and Store Tests
- Story 13.5: Split Logs Zone and Update Zone Tests
- Story 13.6: Split CLI, E2E and Git Tests

## Requirements & Constraints

- Test count must be identical before and after each split (same tests passing, none dropped, renamed away or skipped); this is the proof of equivalence.
- Test bodies and assertions move unchanged; moves first, edits second.
- Green gates before every commit: `npm test && npm run typecheck && npm run depcheck`.
- Atomic commits, one extracted test file per commit, Conventional Commits in English with the story number in the subject and a body explaining why.
- Total run time should stay unchanged within reason (notably for the e2e, dispatch and git splits).
- Target monolithic files (9): edts-zone interaction, group-update, switch, app-shell interaction, app-store, update-slice, logs-zone interaction, update-zone, routes-zone interaction, plus the e2e, dispatch and git index tests (roughly 1400 to 4800 lines each).

## Technical Decisions

- Convention (set in 13.1): files named `<module>.<topic>.test.ts(x)`, one `describe` family per file, shared builders and render helpers in `<module>.test-support.ts`. It is documented in `docs/` or the architecture notes and referenced by 13.2 to 13.6.
- Split axes follow the source splits: EDTs zone by scenario (create, switch, modify, delete, navigation, dialogs); group update by flow (all, EDT, blockers, conflicts) and switch by orchestration vs dirty handling; app shell by flow, store tests by slice, update-slice tests by the 12.8 sub-creators; logs/update/routes zone tests by hook and subcomponent; e2e and dispatch by CLI command family (12.4); git tests by operation family (12.1).
- Repeated fixtures and helpers are inventoried in 13.1 and extracted to test-support modules rather than duplicated per split file.
- Hexagonal boundaries and dependency-cruiser rules still apply to test-support modules; do not introduce new cross-layer imports.
- Ink/React tests: keep a single React copy (no stray `node_modules/node_modules`); each worktree needs its own `npm ci`.

## Cross-Story Dependencies

- 13.1 blocks all of 13.2 to 13.6 (convention and shared fixtures).
- 13.2 requires 12.11.
- 13.3 requires 12.5 and 12.6.
- 13.4 requires 12.8.
- 13.5 requires 12.9, 12.10 and 12.12.
- 13.6 relies on the 12.4 and 12.1 splits.
- Epic 12 is merged and closed; Epic 14 (directory reorganization) follows, so keep file paths and naming conventions stable.
