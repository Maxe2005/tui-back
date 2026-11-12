---
title: 'Extract Pure Logic from json-tree and the Command Bar'
type: 'refactor'
created: '2026-11-12'
status: 'done'
baseline_commit: 'f4111a059e479ce0ea72bba03e73d1e7ee01f54e'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/sprint-2-refonte-fichiers-volumineux/epic-12-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `json-tree/model.ts` (1153 lines) mixes tree building, filter rules, selection/navigation, key resolution and body editing; `shared/command-bar.tsx` (643 lines) mixes grid/tab-autocomplete logic with the React component.

**Approach:** Move the pure logic into cohesive sibling modules (moves first, edits second). `model.ts` keeps only a header and `export *` re-exports; `command-bar.tsx` keeps the component and re-exports the moved symbols.

## Boundaries & Constraints

**Always:** Behaviour-preserving. Original paths `json-tree/model.js` and `shared/command-bar.js` keep exporting every name they exported before (importers: routes-zone.tsx, routes-zone.logic.ts, routes-request.logic.ts, routes-slice.ts, json-tree.tsx, tests; app-shell, logs-zone, settings-screen, tests). New files carry a header comment, one responsibility, under ~400 lines; the pure modules import no Ink/React (command-grid.logic.ts may use `import type { Key }` only). Green gates before each commit: `npm test && npm run typecheck && npm run depcheck`. One extraction per commit: `refactor(<scope>): ... (story 12.2)` with a body explaining why.

**Ask First:** A module that cannot stay under ~400 lines or needs a circular import between the new modules.

**Never:** Edit `model.test.ts`, `json-tree.test.tsx`, `command-bar.test.tsx`, `command-bar.history.interaction.test.tsx`. Change signatures, behaviour or the hook order/`useInput` wiring in `CommandBar`. Split test files (epic 13).

</frozen-after-approval>

## Code Map

- `src/adapters/driving/tui/shared/components/json-tree/model.ts` -- source (1153 lines). Target modules, same folder:
  - `tree-build.ts` -- constants/types (l.5-47), path utils (51-78), `buildNode`/`flattenJson`/`countJsonNodes`, fold reducers (`listTreeContainers`…`findParentIndex`, l.80-326). Owns `TreeFilterRules`, `JsonTreeRow` types.
  - `tree-filter.ts` -- `ActiveRule` and rule reducers (l.328-377); imports types from tree-build.
  - `tree-selection.ts` -- selection/navigation (l.379-411), body classification, status line, panel/viewport budgets, `pruneJsonTreeStates` (l.534-615).
  - `tree-keys.ts` -- `TreeKeyFlags`, `resolveTreeKeyAction`, `resolveTreePanelKeyAction` (l.413-532).
  - `body-edit-path.ts` -- scalar validation, path parse/get/set/add/remove/change-type, `parseRawJsonBuffer` (l.617-1031).
  - `body-draft.ts` -- `EditableRoute`, drafts, edit-status and error remap helpers (l.1033-1153). (Split of the edit layer is beyond the AC's four modules but required by the ~400-line target.)
- `src/adapters/driving/tui/shared/command-bar.tsx` -- source (643 lines). Move l.32-365 (tab-autocomplete helpers `typeCommandQueryChar`…`resolveTabPress`, grid layout `groupCommandsByColumn`…`commandAtGridCursor`, constants) to `command-grid.logic.ts` in `shared/`; `runCommand` and `CommandBar` stay.
- `model.test.ts`, `command-bar*.test.tsx` -- import from the original paths; unchanged = proof of equivalence.

## Tasks & Acceptance

**Execution:**
- [x] `json-tree/tree-build.ts` -- extract build/flatten/fold + shared types; re-export from `model.ts`
- [x] `json-tree/tree-filter.ts`, `tree-keys.ts`, `tree-selection.ts` -- one per commit
- [x] `json-tree/body-edit-path.ts`, `body-draft.ts` -- one per commit; `model.ts` reduced to header + `export *`
- [x] `shared/command-grid.logic.ts` -- move tab/grid logic out of `command-bar.tsx`; re-export from it

**Acceptance Criteria:**
- Given the split, when `model.test.ts`, `json-tree.test.tsx`, `command-bar.test.tsx` and `command-bar.history.interaction.test.tsx` run unchanged, then they pass.
- Given the split, when listing the folders, then `model.ts` contains only re-exports, `command-bar.tsx` only rendering/input wiring, and no new file exceeds ~400 lines.
- Given `npm test && npm run typecheck && npm run depcheck`, then all are green with no new violation.

## Spec Change Log

## Verification

**Commands:**
- `npm test && npm run typecheck && npm run depcheck` -- expected: all green
- `wc -l src/adapters/driving/tui/shared/components/json-tree/*.ts src/adapters/driving/tui/shared/command-*.ts*` -- expected: ≤ ~400 per source file

## Suggested Review Order

**Public surface kept stable**

- `model.ts` is now only `export *` from six modules; importers are untouched.
  [`model.ts:1`](../../../../src/adapters/driving/tui/shared/components/json-tree/model.ts#L1)

- `command-bar.tsx` re-exports the moved grid logic and keeps rendering and input wiring.
  [`command-bar.tsx:1`](../../../../src/adapters/driving/tui/shared/command-bar.tsx#L1)

**json-tree split**

- Tree building, flattening and fold reducers; owns shared types.
  [`tree-build.ts:1`](../../../../src/adapters/driving/tui/shared/components/json-tree/tree-build.ts#L1)

- Filter rule reducers.
  [`tree-filter.ts:1`](../../../../src/adapters/driving/tui/shared/components/json-tree/tree-filter.ts#L1)

- Key dispatch resolution.
  [`tree-keys.ts:1`](../../../../src/adapters/driving/tui/shared/components/json-tree/tree-keys.ts#L1)

- Selection, body classification and viewport budgets.
  [`tree-selection.ts:1`](../../../../src/adapters/driving/tui/shared/components/json-tree/tree-selection.ts#L1)

- Path-based body edit ops (425 lines, slightly over the ~400 target).
  [`body-edit-path.ts:1`](../../../../src/adapters/driving/tui/shared/components/json-tree/body-edit-path.ts#L1)

- Draft helpers and edit-status formatting.
  [`body-draft.ts:1`](../../../../src/adapters/driving/tui/shared/components/json-tree/body-draft.ts#L1)

**Command bar split**

- Tab-autocomplete and grid layout/cursor logic moved out of the component.
  [`command-grid.logic.ts:1`](../../../../src/adapters/driving/tui/shared/command-grid.logic.ts#L1)
