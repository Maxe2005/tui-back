---
title: 'Reorganize wizard dialogs and top-level layout'
type: 'refactor'
created: '2026-11-23'
status: 'done'
baseline_commit: '54623dc53d139787a71f2b5c0eca41a0aca9d5ea'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/sprint-2-refonte-fichiers-volumineux/epic-14-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/sprint-2-refonte-fichiers-volumineux/epic-14/directory-audit-and-target-tree.md'
  - '{project-root}/.dependency-cruiser.cjs'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `edts/dialogs` (12 files), `create-wizard` (13), `driven/git` (21), `cli` (15), `cli/commands` (15), `bin` (15) and the `tui` root (15) are too flat, and `src/core` (13 subdirs) and `src/adapters/driven` (18 subdirs) have too many siblings.

**Approach:** Apply the user-approved audit mapping (section 3.1 and section 4 entries tagged story 14.5, plus the 14.5 rows of section 5.1) with pure `git mv` moves, updating relative imports and the listed hard-coded paths in the same commit so every commit stays green. Update `docs/` and `AGENTS.md` path references (audit section 6, last list).

## Boundaries & Constraints

**Always:** Behaviour-preserving refactor. Files keep their names; only paths, relative specifiers and the 5.1 hard-coded paths change. Whole directories move with `git mv` for the `core` and `driven` families. One logical move per commit (one target folder or one family), `refactor(<scope>): ... (story 14.5)` in English with a body explaining why. Gates before every commit: `npx vitest run --configLoader runner && npm run typecheck && npm run depcheck`. Update `shared/test-support/dialog-registry.tsx` `file:` entries and `focus-navigation.guard.test.ts` allow-list in the same commit as the dialog/wizard move. Re-run `npm pack --dry-run` at the end (no test file shipped, `schema-001.sql` present, `bin/e2e/` excluded).

**Ask First:** Any file that fits no mapped folder or collides on name; any edit beyond import specifiers, hard-coded paths and doc path references; any dependency-cruiser failure; any new hard-coded path or `import.meta.url` depth not listed in audit 5.1.

**Never:** Rename files or exported symbols; add barrels or re-export shims; move `src/bin/tui-back.mjs`, `app-shell.tsx`, `bin/mcp.ts` or `core/{ports,shared}` roots; change `.dependency-cruiser.cjs`; give a new folder the name `adapters` or `tui`.

</frozen-after-approval>

## Code Map

- `epic-14/directory-audit-and-target-tree.md` -- section 3.1 (family tables) and section 4 (`tui` root, `edts/dialogs`, `create-wizard`, `driven/git`, `cli`, `cli/commands`, `bin`): authoritative mapping.
- `src/adapters/driving/tui/zones/edts/dialogs/` -> `actions/` (4), `edt/` (5), `switch/` (3); `switch-resolution/` stays.
- `.../dialogs/create-wizard/` -> `steps/` (7), `override-box/` (3); `create-wizard.tsx`, `wizard.logic.*` stay.
- `src/adapters/driving/tui/` -> `app-shell-tests/` (6) and `app-shell-tests/flows/` (6); `app-shell.tsx` and `single-instance.*` stay.
- `src/adapters/driven/git/` -> `refs/`, `worktree/`, `merge/`, `history/`; then `git/`, `manifest/`, `migration/` -> `driven/vcs/`.
- `src/adapters/driving/cli/` -> `dispatch/` (10); `cli/commands/` -> `edt/` (7); `src/bin/` -> `e2e/` (10).
- `src/core/` -> `workspace/{edt,scripts,shared-types,heal,realign}`, `runtime/{service-actions,service-status,shell}`, `insight/{dashboard,logs,routes}`.
- `src/adapters/driven/` -> `runtime/{container,docker,editor,health,installer,lock,restart,shell-session}`, `storage/{edt-registry,registry,saved-requests,settings,state,xdg}`; `modules/` and root files stay.
- Non-pure edits (audit 5.1, 14.5 rows): `installer/index.ts` and `lock/index.test.ts` `new URL` depth; `bin/e2e/*` URL/`cwd` depth; `focus-navigation.guard.test.ts`; `dialog-registry.tsx`.
- Docs: `AGENTS.md` lines 11, 21, 36 and a one-sentence grouping note; `docs/tui-back-manifest.md` path references (audit section 6).

## Tasks & Acceptance

**Execution:**
- [ ] Drift check: `git ls-files` counts match audit for the 14.5 directories; no name collision for new folders
- [ ] `edts/dialogs/{actions,edt,switch}` -- `git mv` + importers + `dialog-registry.tsx`
- [ ] `create-wizard/{steps,override-box}` -- `git mv` + importers + `dialog-registry.tsx` + `focus-navigation.guard.test.ts`
- [ ] `tui/app-shell-tests` (+ `flows/`) -- `git mv` + import depth fixes
- [ ] `driven/git/{refs,worktree,merge,history}` -- `git mv` + importers
- [ ] `cli/dispatch`, `cli/commands/edt`, `bin/e2e` -- `git mv` + importers + `bin/e2e` URL/`cwd` depth edits
- [ ] `core/{workspace,runtime,insight}` families -- one commit per family
- [ ] `driven/{vcs,storage,runtime}` families -- one commit per family, with installer/lock `new URL` depth edits
- [ ] Docs and `AGENTS.md` path updates; `npm pack --dry-run` check; mark story done in sprint-status

**Acceptance Criteria:**
- Given the approved mapping, when the story is done, then every mapped file sits in its target folder, `git log --follow` tracks it and no file was renamed.
- Given the repo, when running the gates, then all pass with the same test count as baseline and dependency-cruiser stays green.
- Given `grep` for old paths (e.g. `core/edt/`, `driven/git/`, `cli/dispatch.ts`, `bin/tui-back.e2e`), then no stale reference remains in `src/`, `docs/` or `AGENTS.md`.
- Given the top-level `core` and `adapters/driven`, then each has at most 10 subdirectories.

## Spec Change Log

## Design Notes

Baseline: 301 test files, 5536 passed + 1 skipped (`npm test` fails at config load here; use `npx vitest run --configLoader runner`). `audit-mapping-check.py` asserts the pre-14.2 state and fails by design; do not use it. Family moves are the widest fan-out (`../result.js` becomes `../../result.js`): script the specifier rewrite, then rely on `typecheck` and tests to catch misses. Verify counts with `git ls-files` before each move.

## Verification

**Commands:**
- `npx vitest run --configLoader runner && npm run typecheck && npm run depcheck` -- expected: all green, test count equal to baseline
- `git diff --stat -M 54623dc53d139787a71f2b5c0eca41a0aca9d5ea..HEAD -- src | grep -v '=>'` -- expected: only import-line/path-string edits outside renames
- `npm pack --dry-run` -- expected: no test files, `schema-001.sql` present
