---
title: 'Reorganize core folders'
type: 'refactor'
created: '2026-11-23'
status: 'in-progress'
baseline_commit: 'e32bc0ec7291251361220b56ffd20faa65bd8f4f'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/sprint-2-refonte-fichiers-volumineux/epic-14-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/sprint-2-refonte-fichiers-volumineux/epic-14/directory-audit-and-target-tree.md'
  - '{project-root}/.dependency-cruiser.cjs'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `core/edt` (34 direct files), `core/scripts` (30), `core/ports` (20) and `core/shared-types` (12) are hard to browse.

**Approach:** Apply the user-approved mapping of the audit (section 4 entries `core/edt`, `core/scripts`, `core/ports`, `core/shared-types`) with pure `git mv` moves, updating relative imports in the same commit so every commit stays green.

## Boundaries & Constraints

**Always:** Behaviour-preserving refactor. Files keep their names; only paths and relative specifiers change; interface and type names of ports stay exported unchanged. `.test`, `.<topic>.test`, `.test-support` files move with their module as mapped. One logical move per commit (one target folder or one family), `refactor(core): ... (story 14.4)` in English with a body explaining why. Gates before every commit: `npx vitest run --configLoader runner && npm run typecheck && npm run depcheck`. Apply the 14.4 row of audit 5.1: `core/scripts/group-update/*.ts` move to `group-update/steps/` (`./group-update/x.js` -> `./steps/x.js`; steps gain one `../`). Update importers across `src/` (core, adapters, bin; specifiers only). Update path references to moved files in `docs/` and `AGENTS.md` (e.g. `docs/tui-back-manifest.md` lines citing `core/ports/*`, `core/scripts/*`).

**Ask First:** Any file that fits no mapped folder or collides on name; any edit beyond import specifiers, hard-coded paths and doc path references; any dependency-cruiser failure; any new hard-coded path or `import.meta.url` depth found while moving.

**Never:** Rename files or exported symbols; add barrels or re-export shims; move other `core/*` directories or `adapters/**` files (14.5); change `.dependency-cruiser.cjs`.

</frozen-after-approval>

## Code Map

- `epic-14/directory-audit-and-target-tree.md` -- section 4 tables for the four directories: authoritative file-to-folder mapping.
- `src/core/edt/` (34) -> `branches/` (8), `lifecycle/` (10), `shared-edt/` (7), `switch/` (existing 3 + 7 `switch.*`), `switch/restart/` (2).
- `src/core/scripts/` (30) -> `registry/` (10), `reset/` (4), `update-support/` (6); `group-update/` keeps orchestrator + tests (10) and receives its 10 existing step files under `group-update/steps/`.
- `src/core/ports/` (20) -> `modules/` (2), `runtime/` (8), `storage/` (6), `vcs/` (4). Ports are imported from core, adapters/driven, adapters/driving and bin (~100 sites).
- `src/core/shared-types/` (12) -> `consumers/` (6), `versioning/` (6).
- `docs/tui-back-manifest.md:9,322,538-545` -- stale-able path references to `core/ports/*`, `core/scripts/*`.
- No `import.meta.url` / `new URL(` under `src/core` (verified): no hard-coded depth edit expected.

## Tasks & Acceptance

**Execution:**
- [ ] `core/shared-types/{consumers,versioning}` -- `git mv` per folder + fix importers
- [ ] `core/edt/{branches,lifecycle,shared-edt}` -- `git mv` per folder + fix importers
- [ ] `core/edt/switch` (+ `switch/restart`) -- `git mv` the `switch.*` and `switch-restart.*` files + fix importers
- [ ] `core/scripts/{registry,reset,update-support}` -- `git mv` per folder + fix importers
- [ ] `core/scripts/group-update/steps` -- `git mv` the 10 step files, fix `./steps/` and `../` specifiers
- [ ] `core/ports/{modules,runtime,storage,vcs}` -- `git mv` per folder + fix all importers (core, adapters, bin)
- [ ] Final: every moved file at its mapped path, direct-file counts of the four directories <=10 (`core/scripts` and `core/edt` documented if a mapped folder exceeds it), no stale old-path reference in `src/`, `docs/`, `AGENTS.md`; mark story done in sprint-status

**Acceptance Criteria:**
- Given the approved mapping, when the story is done, then every mapped file sits in its target folder, `git log --follow` still tracks them and no file was renamed.
- Given the repo, when running the gates, then all pass with the same test count as baseline and dependency-cruiser stays green.
- Given `grep` for old paths (e.g. `ports/git.js`, `scripts/register.js`, `edt/create.js`), then no stale reference remains.

## Design Notes

Baseline: 301 test files, 5536 passed + 1 skipped. `npm test` fails at config load here; `npx vitest run --configLoader runner` is the test gate. `audit-mapping-check.py` asserts the pre-14.2 state and fails by design; do not use it. Verify counts with `git ls-files` before each move.

## Verification

**Commands:**
- `npx vitest run --configLoader runner && npm run typecheck && npm run depcheck` -- expected: all green, test count equal to baseline
- `git diff --stat -M e32bc0ec7291251361220b56ffd20faa65bd8f4f..HEAD -- src | grep -v '=>'` -- expected: only import-line/path-string edits outside renames
