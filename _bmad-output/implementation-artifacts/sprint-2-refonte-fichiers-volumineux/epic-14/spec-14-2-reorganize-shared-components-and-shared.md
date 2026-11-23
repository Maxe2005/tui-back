---
title: 'Reorganize shared/components and shared'
type: 'refactor'
created: '2026-11-19'
status: 'in-progress'
baseline_commit: '08d7905627196ded865d5f6b82c67b1754f039da'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/sprint-2-refonte-fichiers-volumineux/epic-14-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/sprint-2-refonte-fichiers-volumineux/epic-14/directory-audit-and-target-tree.md'
  - '{project-root}/.dependency-cruiser.cjs'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `tui/shared/components` holds 66 direct files, `tui/shared` 28 files and `shared/settings` 16, which makes them hard to browse.

**Approach:** Apply the user-approved mapping of the audit (section 4: `shared/components`, `shared`, `shared/settings`, `shared/hooks` entries) with pure `git mv` moves, updating relative imports in the same commit so every commit stays green.

## Boundaries & Constraints

**Always:** Behaviour-preserving refactor. Files keep their names; only paths and relative specifiers change. `.logic`, `.test`, `.<topic>.test` files move with their module. One logical move per commit (one role folder or one family), `refactor(tui-shared): ... (story 14.2)` in English with a body explaining why. Gates before every commit: `npm test && npm run typecheck && npm run depcheck`. Start with `python3 _bmad-output/implementation-artifacts/sprint-2-refonte-fichiers-volumineux/epic-14/audit-mapping-check.py` (already OK at baseline). Apply the 14.2 rows of audit section 5.1 (guard allow-lists, `dialog-registry.tsx` entries and imports for `shared/*` dialogs/screens/command-bar/keybinding-help, `components/index.ts` re-exports, `hints.guard.test.ts` URL depth, `settings-screen.tsx` imports). Update importers in `zones/*`, `store/*`, `tui/*` (specifiers only).

**Ask First:** Any file that fits no mapped folder or collides on name; any edit beyond import specifiers/hard-coded paths of audit 5.1; any dependency-cruiser failure.

**Never:** Rename files or exported symbols; add barrels or re-export shims; move files of other stories' scope (zones, store, core, `tui` root, wizard); change `.dependency-cruiser.cjs`.

</frozen-after-approval>

## Code Map

- `_bmad-output/…/epic-14/directory-audit-and-target-tree.md` -- sections 3-5: authoritative file-to-folder mapping and non-pure edits.
- `src/adapters/driving/tui/shared/components/` -- 66 files -> `chrome|dialogs|display|feedback|inputs|layout|lists|pickers`; `index.ts`, `ink-smoke.test.tsx`, `render-to-string.ts` and `json-tree/` stay.
- `src/adapters/driving/tui/shared/*.ts(x)` -- -> `screens/`, `screens/{command-bar,terminal-view,dialogs}/`; `branch-owners-text*` -> `components/pickers/`; `README.md` stays.
- `src/adapters/driving/tui/shared/settings/` -- one folder per tab (`edts, general, logs, palette, services, shared-types, update`); `footer-context.logic.ts`, `settings-tabs.logic.ts` stay.
- `src/adapters/driving/tui/shared/poll/` -- 2 files folded into `shared/hooks/`.
- `src/adapters/driving/tui/shared/test-support/dialog-registry.tsx` -- hard-coded `file:` paths checked by `bounds-dialogs.test.tsx`.
- `shared/keys/focus-navigation.guard.test.ts`, `shared/components/hints.guard.test.ts`, `shared/bounds/bounds-dialogs.test.tsx` -- path allow-lists to update.

## Tasks & Acceptance

**Execution:**
- [ ] `shared/components/{chrome,dialogs,display,feedback,inputs,layout,lists,pickers}` -- `git mv` each role group (one commit each) + fix imports, `index.ts`, guard/registry paths -- split the 66-file folder
- [ ] `shared/poll/*` -- `git mv` to `shared/hooks/` + fix importers (zones included)
- [ ] `shared/branch-owners-text*` -- `git mv` to `components/pickers/` + fix importers (create-wizard included)
- [ ] `shared/screens/{command-bar,terminal-view,dialogs}` and `shared/screens` -- `git mv` per group + fix imports, `dialog-registry.tsx`, `focus-navigation.guard.test.ts`
- [ ] `shared/settings/<tab>/` -- `git mv` the 7 tab pairs + fix `settings-screen.tsx` imports/re-exports and importers
- [ ] Final: re-run `audit-mapping-check.py`, confirm direct-file counts of `components`, `shared`, `settings` are <=10 (documented exceptions: `components` root has 3)

**Acceptance Criteria:**
- Given the approved mapping, when the story is done, then every mapped file sits in its target folder, `git log --follow` still tracks them, and no file was renamed.
- Given the repo, when running `npm test && npm run typecheck && npm run depcheck`, then all pass with the same test count as baseline.
- Given `grep` for old paths (`shared/components/<moved>`, `shared/settings/<tab>-tab`, `shared/poll`), then no stale reference remains in `src/`, `docs/` or `AGENTS.md`.

## Design Notes

Baseline at `08d79056`: 301 test files, 5536 passed + 1 skipped; typecheck and depcheck green. In this environment `npm test` fails at config load (vite 8.3.8 / rolldown 1.2.19: `sourcemapPathTransform ... returned object`, also after `npm ci`); `npx vitest run --configLoader runner` works and is used for the test gate. No repo file is changed for this.

## Verification

**Commands:**
- `npx vitest run --configLoader runner && npm run typecheck && npm run depcheck` (`npm test` stand-in, see Design Notes) -- expected: all green, test count equal to baseline
- `git diff --stat -M baseline_commit..HEAD -- src | grep -v '=>'` -- expected: only import-line edits outside renames
