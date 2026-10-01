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

**Problem:** An EDT update merges each service from its manifest `sharedBranch`; bringing a sibling EDT's work in means retyping every source branch by hand, row by row.

**Approach:** Add a global merge-source strategy to the EDT-scoped update configuration (`Shared branches` | `From EDT`), resolved by one pure core helper shared by the TUI panel and a new CLI flag `update --from-edt <topic>`. Unresolved rows block the run until fixed by hand (`[Manual]`) or deselected.

## Boundaries & Constraints

**Always:** Resolution lives in core (`resolveMergeSourcesFromEdt`), no adapter imports (AD-1); `Result<T>` with kebab-case codes (AD-3). Rows keep the existing `GroupUpdateSelectionItem.sourceBranch` hand-off — `groupUpdate` itself is unchanged. Strategy panel only for EDT scope; all-repos and single-service configs stay exactly as in 3.7. Panel/table navigation (`Tab`, `Ctrl+R` reset) mirrors the edt-create wizard Step 3. Comments follow AD-17: no story/AC/review references, only non-obvious reasons; test names carry no story suffix. Never lose a `[Manual]` row on strategy change.

**Ask First:** If a branch present only on `origin` (no local ref) cannot be merged by the existing `groupUpdate` source check without a core change beyond the resolver — HALT.

**Never:** No change to merge/conflict/migration/restart logic; no new git adapter methods; no fetch during resolution; no `--from-edt` combined with `--all` (invalid-argument).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Member of source EDT | repoPath in chosen EDT, branch exists | row source = member branch, origin `edt`, shown `← <topic>` | N/A |
| Not a member | repoPath absent from chosen EDT | empty source, red `✖ not in <topic>` | blocks run if selected |
| Branch gone | member branch missing locally and on `origin` | `✖ branch not found`, empty source | blocks run if selected |
| Manual row | `Enter` on unresolved row | `BranchAutocompleteInput` pre-filled with `sharedBranch`; commit → `[Manual]`, error cleared | blank commit rejected |
| Strategy change | any change with `[Manual]` rows | manual rows kept; `Ctrl+R` resets one to the strategy | N/A |
| Back to Shared | strategy → Shared | non-manual rows → `sharedBranch`, from-EDT errors cleared | N/A |
| Start with errors | selected row has error, `y` | rejected, message names unresolved services | deselected rows never block |
| CLI | `update --from-edt <topic>` | same resolution, run proceeds | unresolved members → `update-source-unresolved` listing them, no git write; unknown topic or active EDT's own → `invalid-argument` |

</frozen-after-approval>

## Code Map

- `src/core/scripts/group-update.ts:120-141` -- `GroupUpdateSelectionItem`/`selection` already carries per-service `sourceBranch`; `effectiveSourceBranch`/`validateSelectionBranches` (L61-90) are the consumers. Reuse, do not alter.
- `src/core/ports/edt-registry.ts` -- `EdtRegistryEntry.members[{service,repoPath,branch}]` is the source of truth for the chosen EDT's branches.
- `src/core/ports/git.ts:161,172` -- `listBranches` (local) and `listRemoteBranches` (`origin/x`) feed the existence check.
- `src/adapters/driving/tui/zones/update/update-config-dialog.logic.ts` -- draft/rows/reducer; gains `strategy`, per-row `origin` + `error`, `Ctrl+R`, `Tab` panel focus, confirm gate on selected-row errors.
- `src/adapters/driving/tui/zones/update/update-config-dialog.tsx` -- renders the panel above the rows; row meta shows `← topic` / `[Manual]` / red error; reuse `ConfigRow`.
- `src/adapters/driving/tui/store/slices/update-slice.ts:292-347` -- `openEdtConfig` builds rows; keeps `edtRegistry.list()` result and per-row branch lists for re-resolution.
- `src/adapters/driving/tui/zones/update/update-zone.tsx:420-630` -- zone-local cursor/edit state and `useInput` dispatcher; add panel focus and the EDT quick-pick (`zones/edts/dialogs/quick-pick-dialog.tsx`, `shared/components/filterable-pick-list.tsx`), excluding the active EDT.
- `src/adapters/driving/tui/zones/edts/dialogs/create-wizard/step-branches.tsx` -- Step 3 panel/table pattern to mirror; `branch-plan-table.tsx` row rendering where it fits.
- `src/adapters/driving/cli/subcommands.ts:48,160-230` -- `UPDATE_USAGE` and the `update` runner; add `--from-edt <topic>`.
- New: `src/core/scripts/resolve-merge-sources.ts` (+ test) -- the pure resolver.

## Tasks & Acceptance

**Execution:**
- [x] `src/core/scripts/resolve-merge-sources.ts` + `.test.ts` -- `resolveMergeSourcesFromEdt(targetMembers, sourceEdt, branchesByRepo) → rows {service, repoPath, source, origin:'shared'|'edt'|'manual', error?:'not-in-edt'|'branch-not-found'}`; unit-test every matrix row against fakes.
- [x] `update-config-dialog.logic.ts` (+ tests) -- strategy state, re-resolution on strategy change preserving manual rows, `Ctrl+R`, `Tab` focus, confirm rejection naming unresolved selected services.
- [x] `update-config-dialog.tsx`, `update-zone.tsx`, `update-slice.ts` (+ Ink tests) -- panel, EDT quick-pick (active EDT excluded), manual editor pre-filled with `sharedBranch`; panel hidden for all-repos/single scope.
- [x] `subcommands.ts` (+ `tui-back.e2e.test.ts`) -- `--from-edt <topic>`, `update-source-unresolved`, `invalid-argument` cases, `UPDATE_USAGE` updated.

**Acceptance Criteria:**
- Given an EDT update config, when it opens, then the merge-source panel shows `(•) Shared branches` and `( ) From EDT: <none>`, and `Tab` moves focus panel ↔ table.
- Given From EDT chosen, then members get `← <topic>`, non-members `✖ not in <topic>`, missing branches `✖ branch not found`; `Enter` on one opens the editor pre-filled with `sharedBranch` and commit marks `[Manual]`.
- Given a selected unresolved row, when `y` is pressed, then start is rejected naming the services; deselected rows never block.
- Given an all-repos or single-service config, then no panel is shown and 3.7 behavior is unchanged.
- Given `update --from-edt` with unresolved members, then it fails `update-source-unresolved` with no git write.

## Design Notes

A branch found only as `origin/<b>` counts as present; the row's source is then `origin/<b>` only if `groupUpdate`'s local check accepts it — otherwise the Ask-First gate above applies.

## Verification

**Commands:**
- `npm test && npm run typecheck && npm run depcheck` -- expected: all pass
- `git grep -nE "\b[Ss]tory [0-9]+\.[0-9]+|\bAC[0-9]+\b|review patch" -- <files touched>` -- expected: no new matches

## Suggested Review Order

**Resolution (shared by TUI and CLI)**

- Pure resolver: member branch, `not-in-edt`, `branch-not-found`; local refs only.
  [`resolve-merge-sources.ts:23`](../../../src/core/scripts/resolve-merge-sources.ts#L23)

- CLI-side full selection with the `update-source-unresolved` / `invalid-argument` gates.
  [`resolve-merge-sources.ts:62`](../../../src/core/scripts/resolve-merge-sources.ts#L62)

**Configuration draft**

- Strategy re-resolution keeps manual rows untouched.
  [`update-config-dialog.logic.ts:98`](../../../src/adapters/driving/tui/zones/update/update-config-dialog.logic.ts#L98)

- Confirm blocks only on selected unresolved rows.
  [`update-config-dialog.logic.ts:251`](../../../src/adapters/driving/tui/zones/update/update-config-dialog.logic.ts#L251)

- Store action resolving rows from the chosen EDT.
  [`update-slice.ts:837`](../../../src/adapters/driving/tui/store/slices/update-slice.ts#L837)

**UI and CLI wiring**

- Panel rendering above the service rows.
  [`update-config-dialog.tsx:50`](../../../src/adapters/driving/tui/zones/update/update-config-dialog.tsx#L50)

- Quick-pick owns keys until it closes; panel steps dispatched here.
  [`update-zone.tsx:620`](../../../src/adapters/driving/tui/zones/update/update-zone.tsx#L620)

- `--from-edt <topic>` entry in the update runner.
  [`subcommands.ts:215`](../../../src/adapters/driving/cli/subcommands.ts#L215)
