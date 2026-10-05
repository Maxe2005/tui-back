---
title: 'Update — Merge Source from Another EDT'
type: 'feature'
created: '2026-10-01'
status: 'done'
review_loop_iteration: 0
baseline_commit: '701ae10f5035f88442a2e5bc6eae2d8fffb84885'
context: [_bmad-output/implementation-artifacts/epic-3-context.md]
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** An EDT update merges each service from its manifest `sharedBranch`; bringing a sibling EDT's work in means retyping every branch. The first cut bolted a strategy panel onto the 3.7 checklist; the screen must instead mirror edt-create's Step 3 (global parameters above a per-service table with per-row exceptions).

**Approach:** Rebuild the EDT-scoped and all-repos update configuration as two panels — `PARAMÈTRES GLOBAUX` (EDT scope: merge source `Shared branches` | `From EDT`, migrations, clean restart; all-repos: migrations and clean restart only) and `RÉSUMÉ ET EXCEPTIONS PAR SERVICE` (table, `[x]` first column, `Enter` opens `Configurer <service>`). Each service can override branch, migrations and clean restart. A shared `SuggestField` (filterable list + placeholder) serves the EDT pick and the per-service branch field. The single-service config stays the simple 3.7 list.

## Boundaries & Constraints

**Always:**
- Navigation and look identical to Step 3: `PanelTitle` `▶`, `BranchPlanTable` (`› `, ` │ `, dim header, `BoundedList` + `↑/↓ N de plus`), `Tab` switches panels, `Esc` closes the innermost element first, `Ctrl+R` returns a row to `global`, `Entrée` opens the box. UI strings in French (Step 3 convention).
- Rows show the **effective** value: migrations `✔ migrate` | `off` | `— aucune commande`; restart `✔ clean` | `basic` | `basic (no recipe)`. Never `migrate` without `migrationCommand`, never `clean` without `restartCommands`.
- Per-service overrides are `suivre global` | `non` | `oui`; `oui` is offered only when the manifest declares the action. Core: `GroupUpdateSelectionItem` gains `runMigrations?`/`cleanRestart?` overriding the run-wide values.
- Mode column: `global` | `perso`. An empty branch commit follows the global source: row returns to `global` iff the global source is Shared; under From EDT it becomes `perso` on `sharedBranch`.
- `SuggestField`: empty value shows a dim placeholder (`<shared-branch>`, `<aucun>`) and the default applies; the placeholder disappears once text is typed. `↑/↓` only move the list highlight — text and placeholder are untouched; `Entrée` inserts the highlighted item into the text, the next `Entrée` commits. Free text must exactly match an existing branch / EDT topic or is refused with a message.
- `EDT source` line (a `SuggestField` over EDT topics, active EDT excluded) is visible only under From EDT. From EDT with no EDT chosen: every row blocks with `✖ aucun EDT choisi`.
- Starting (`y`) is rejected naming unresolved services only for **selected** rows. Two panels appear for EDT and all-repos scopes; the merge-source line and the `EDT source` line exist only in EDT scope (all-repos: always shared branches). Single-service is unchanged.
- **Height budget:** every dialog, panel and sub-component declares a max line count; table `maxVisibleRows` = terminal rows − fixed chrome; dropdown cap = `min(branchDropdownMaxRows, room left)`; cells truncated, help/error lines `truncate-end` on one line; below a minimum height show a "agrandir le terminal" message instead of overflowing.
- AD-17 comments (no story/AC references); resolver and CLI `--from-edt` behavior from the first cut stay.

**Ask First:** If extending `BranchPlanTable` (leading checkbox column) changes the wizard's or switch dialog's rendered output — HALT.

**Never:** Do not modify `create-wizard/*` behavior (no `SuggestField` adoption there); no per-service CLI flags; no change to merge/conflict/migration/restart logic beyond honoring per-service toggles.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Member of source EDT | From EDT, branch exists locally | source = member branch, `← <topic>`, `global` | N/A |
| Not a member / branch gone | From EDT | red `✖ not in <topic>` / `✖ branch not found` | blocks if selected |
| No EDT chosen | From EDT, field empty | all rows `✖ aucun EDT choisi` | blocks if selected |
| Undeclared action | global on, no `migrationCommand` / `restartCommands` | `— aucune commande` / `basic (no recipe)`; run skips migrate / plain restarts | N/A |
| Row override | box: migrations `non`, or `oui` (declared, global off) | row `perso`; run honors it for that service only | `oui` hidden if undeclared |
| Empty branch commit | Shared / From EDT | row `global` / `perso` on `sharedBranch` | N/A |
| Typed non-existent branch or EDT | free text, `Entrée` | refused with message, field stays | N/A |
| Strategy change | any, with `perso` rows | `perso` rows keep their overrides; `Ctrl+R` resets one | N/A |
| Scope | all-repos / single-service | panels without merge-source line / simple 3.7 list | N/A |

</frozen-after-approval>

## Code Map

- `src/core/scripts/group-update.ts:120-141,334,503` -- `GroupUpdateSelectionItem` + the two per-service call sites that read the run-wide `runMigrations`/`cleanRestart`; add per-item overrides.
- `src/core/scripts/resolve-merge-sources.ts` -- resolver + `selectionFromEdt` (keep).
- `src/adapters/driving/tui/shared/components/branch-autocomplete-input.tsx` -- source of the filter/dropdown reducer; new `suggest-field.tsx` (+ `.logic.ts`, tests) generalizes it with placeholder and a generic suggestion list.
- `src/adapters/driving/tui/zones/edts/dialogs/branch-plan-table.tsx` -- reuse `PanelTitle`/`BranchPlanTable`; additive optional leading-cell support only.
- `create-wizard/step-branches.tsx`, `override-box.tsx` -- reference for layout, keys, box pattern (read-only).
- `src/adapters/driving/tui/zones/update/update-config-dialog.logic.ts|.tsx`, `update-zone.tsx:420-700`, `store/slices/update-slice.ts` -- rework to two panels; effective-value derivation needs per-row `migrationDeclared`/`recipeDeclared` from the manifest (loaded in `resolveBranchDefault`).
- New `update-service-box.logic.ts|.tsx` -- `Configurer <service>` box. `merge-edt-pick-dialog.tsx` is replaced by `SuggestField` and removed.

## Tasks & Acceptance

**Execution:**
- [x] `group-update.ts` (+ test) -- per-service `runMigrations`/`cleanRestart` overrides in selection.
- [x] `shared/components/suggest-field*` (+ tests) -- placeholder, highlight-only arrows, two-stage `Entrée`, exact-match validation, height cap.
- [x] `branch-plan-table.tsx` -- no change needed: the `[x]` box is part of the Service cell, so the wizard output is untouched.
- [x] `update-config-dialog.*`, `update-service-box.*`, `update-zone.tsx`, `update-slice.ts` (+ tests) -- two panels, effective values, overrides, `Mode`, `Ctrl+R`, blocking rules, height budget; panels for EDT + all-repos, merge-source only in EDT.
- [x] Remove `merge-edt-pick-dialog.tsx`; update `update-config-merge-strategy.test.ts` and render tests.

**Acceptance Criteria:**
- Given an EDT or all-repos update config, then `PARAMÈTRES GLOBAUX` and the per-service table render as in Step 3, within the terminal height at 24 rows; all-repos has no merge-source line.
- Given a service without `migrationCommand`, then its row never shows `migrate`, even with migrations globally on.
- Given From EDT with nothing chosen and a selected row, when `y` is pressed, then start is rejected.
- Given a single-service config, then the 3.7 list is unchanged.

## Spec Change Log

- 2026-10-05 -- course correction (user review of the first cut): UX rebuilt after edt-create Step 3; per-service overrides for branch/migrations/clean restart folded into this story; shared `SuggestField` introduced; panels extended to all-repos (migrations + clean restart only). KEEP: resolver, `selectionFromEdt`, CLI `--from-edt`, `[Manual]`/`Ctrl+R` semantics, slice actions `listMergeSourceEdts`/`chooseMergeSourceEdt`.

## Verification

**Commands:**
- `npm test && npm run typecheck && npm run depcheck` -- expected: all pass
- `git grep -nE "\b[Ss]tory [0-9]+\.[0-9]+|\bAC[0-9]+\b|review patch" -- <files touched>` -- expected: no new matches

## Suggested Review Order

**Core contract**

- Selection items may override migrations / clean restart per service.
  [`group-update.ts:121`](../../../src/core/scripts/group-update.ts#L121)

- Resolver and CLI selection from another EDT (unchanged from the first cut).
  [`resolve-merge-sources.ts:62`](../../../src/core/scripts/resolve-merge-sources.ts#L62)

**Shared field**

- Placeholder, highlight-only arrows, two-stage Enter, empty-commit rule.
  [`suggest-field.logic.ts:32`](../../../src/adapters/driving/tui/shared/components/suggest-field.logic.ts#L32)

**Screen model**

- Effective values: an undeclared action never reads as enabled.
  [`update-config-panels.logic.ts:27`](../../../src/adapters/driving/tui/zones/update/update-config-panels.logic.ts#L27)

- Key routing per focus, line and field.
  [`update-config-panels.logic.ts:157`](../../../src/adapters/driving/tui/zones/update/update-config-panels.logic.ts#L157)

- Height budget: table shrinks before anything can overflow.
  [`update-config-panels.logic.ts:260`](../../../src/adapters/driving/tui/zones/update/update-config-panels.logic.ts#L260)

- Service box apply: empty branch follows global; unknown branch refused.
  [`update-service-box.logic.ts:140`](../../../src/adapters/driving/tui/zones/update/update-service-box.logic.ts#L140)

**Wiring and views**

- Manifest declarations feed each row at open time.
  [`update-slice.ts:292`](../../../src/adapters/driving/tui/store/slices/update-slice.ts#L292)

- Controller hook: view state, loaders, step-to-draft mapping.
  [`use-update-config-panels.ts:57`](../../../src/adapters/driving/tui/zones/update/use-update-config-panels.ts#L57)

- Two-panel view mirroring edt-create's Step 3.
  [`update-config-panels.tsx:148`](../../../src/adapters/driving/tui/zones/update/update-config-panels.tsx#L148)
