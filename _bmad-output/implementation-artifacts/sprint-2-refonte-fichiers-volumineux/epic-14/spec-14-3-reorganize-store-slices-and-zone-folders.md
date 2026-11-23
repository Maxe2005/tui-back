---
title: 'Reorganize store slices and zone folders'
type: 'refactor'
created: '2026-11-23'
status: 'done'
baseline_commit: '0b36c9d262db6ed794b88ef8dedb727a84c14a43'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/sprint-2-refonte-fichiers-volumineux/epic-14-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/sprint-2-refonte-fichiers-volumineux/epic-14/directory-audit-and-target-tree.md'
  - '{project-root}/.dependency-cruiser.cjs'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `tui/store/slices` holds 50 direct files and `tui/zones/{update,logs,routes,edts}` hold 45, 40, 35 and 37, which makes them hard to browse.

**Approach:** Apply the user-approved mapping of the audit (section 4 entries `store/slices`, `zones/update`, `zones/logs`, `zones/routes`, `zones/edts`) with pure `git mv` moves, updating relative imports in the same commit so every commit stays green.

## Boundaries & Constraints

**Always:** Behaviour-preserving refactor. Files keep their names; only paths and relative specifiers change. `.logic`, `.test`, `.<topic>.test` files move with their module as mapped. One logical move per commit (one target folder or one family), `refactor(tui-store|tui-zones): ... (story 14.3)` in English with a body explaining why. Gates before every commit: `npx vitest run --configLoader runner && npm run typecheck && npm run depcheck`. Apply the 14.3 rows of audit 5.1: `dialog-registry.tsx` `file:` entries and imports for `zones/update/*`, `zones/logs/*`, `zones/routes/routes-modals.tsx`; `focus-navigation.guard.test.ts` entries `zones/routes/routes-zone.{overlay,pane}-keys.ts` -> `zones/routes/keys/...`. Update importers across `tui/` (specifiers only), including `app-shell*`, `shared/*`, `bin/`.

**Ask First:** Any file that fits no mapped folder or collides on name; any edit beyond import specifiers/hard-coded paths of audit 5.1; any dependency-cruiser failure; any new hard-coded path or `import.meta.url` depth found while moving.

**Never:** Rename files or exported symbols; add barrels or re-export shims; touch `zones/edts/dialogs/**` (14.5) or other zones (`dashboard`, `shared-types`, ...); move files of core/adapters/driven; change `.dependency-cruiser.cjs`.

</frozen-after-approval>

## Code Map

- `_bmad-output/…/epic-14/directory-audit-and-target-tree.md` -- section 4 tables for the five directories: authoritative file-to-folder mapping.
- `tui/store/slices/` (50) -> `app, logs, maintenance, shared-types, terminal, workspace, update` (+ `update/{config,health,run}`).
- `tui/zones/update/` (45) -> `config, hooks, incidents, logic, report, services`; 9 files stay.
- `tui/zones/logs/` (40) -> `filters, hooks, keys, logic, panes`; 7 stay.
- `tui/zones/routes/` (35) -> `hooks, keys, logic, panes, scenarios`; 5 stay.
- `tui/zones/edts/` (37) -> `hooks, logic, views, scenarios/{lifecycle,runtime}`; 6 stay; `dialogs/` untouched.
- `tui/shared/test-support/dialog-registry.tsx` -- 26 `file: 'zones/...'` entries checked by `bounds-dialogs.test.tsx`.
- `tui/shared/keys/focus-navigation.guard.test.ts:16-17` -- routes allow-list.
- `*.test-support.ts(x)` stay at zone root; scenario tests import them with `../` paths (`../../` from `scenarios/lifecycle|runtime`).

## Tasks & Acceptance

**Execution:**
- [ ] `store/slices/{app,logs,maintenance,shared-types,terminal,workspace}` -- `git mv` per domain (one commit each) + fix importers
- [ ] `store/slices/update/{.,config,health,run}` -- `git mv` the update family + fix importers
- [ ] `zones/update/{config,hooks,incidents,logic,report,services}` -- `git mv` per folder + fix imports, `dialog-registry.tsx`
- [ ] `zones/logs/{filters,hooks,keys,logic,panes}` -- same, incl. `dialog-registry.tsx`
- [ ] `zones/routes/{hooks,keys,logic,panes,scenarios}` -- same, incl. `dialog-registry.tsx` (`routes-modals.tsx`) and `focus-navigation.guard.test.ts`
- [ ] `zones/edts/{hooks,logic,views,scenarios/*}` -- same; fix `dialogs/**` import specifiers that point at moved files (specifiers only)
- [ ] Final: every moved file is at its mapped path, direct-file counts of the five directories are <=10 (documented: none expected above), no stale old-path reference in `src/`, `docs/`, `AGENTS.md`; mark story done in sprint-status

**Acceptance Criteria:**
- Given the approved mapping, when the story is done, then every mapped file sits in its target folder, `git log --follow` still tracks them and no file was renamed.
- Given the repo, when running the gates, then all pass with the same test count as baseline.
- Given `grep` for old paths (e.g. `slices/update-slice`, `zones/routes/routes-zone.pane-keys`), then no stale reference remains.

## Design Notes

Baseline: 301 test files, 5536 passed + 1 skipped (see 14.2). `npm test` fails at config load in this environment (vite/rolldown); `npx vitest run --configLoader runner` is the test gate. Direct-file counts at baseline match the audit exactly (50/45/40/35/37). `audit-mapping-check.py` asserts the 14.2 pre-move state and now fails by design; do not use it.

## Verification

**Commands:**
- `npx vitest run --configLoader runner && npm run typecheck && npm run depcheck` -- expected: all green, test count equal to baseline
- `git diff --stat -M 0b36c9d2..HEAD -- src | grep -v '=>'` -- expected: only import-line/path-string edits outside renames
