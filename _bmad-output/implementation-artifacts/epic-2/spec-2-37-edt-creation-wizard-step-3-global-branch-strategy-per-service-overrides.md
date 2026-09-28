---
title: 'EDT Creation Wizard — Step 3: Global Branch Strategy & Per-Service Overrides'
type: 'feature'
created: '2026-09-28'
status: 'in-review'
review_loop_iteration: 0
context: []
baseline_commit: '1cd597a4f69fe35379599293db16e0de4d28c147'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Wizard Step 3 still hosts the pre-wizard branch fields: one base picker, a grouped/individual toggle and name fields. There is no way to attach an existing or remote branch, and exceptions are buried in a per-member form.

**Approach:** Replace Step 3 with two panels. Panel A "STRATÉGIE GLOBALE" holds a global base and a global name. Panel B "RÉSUMÉ ET EXCEPTIONS PAR SERVICE" is a per-service table whose rows follow the global rule unless overridden through a "Configurer <service>" box. On Step 4 confirm, the rows become Story 2.35's `memberPlans`.

## Boundaries & Constraints

**Always:**
- All ACs of Story 2.37 in `epics.md` (L1816-1850) are normative: panel layout, footer text, keys, placeholder, live resolution, touched-flag name tracking, table columns and modes, override box lines and keys, and the `Ctrl+R` revert.
- Base resolution for a `[Créer (Global)]` row:
  - an empty global base means the row uses the service's manifest `sharedBranch`;
  - otherwise the exact local match wins, then `origin/<x>` in the remote list, else `✖ branche introuvable` (red + glyph).
- Branch lists (`listBranches` + `listRemoteBranches`) are loaded through a new store action wrapping a core export. Each service is loaded once on Step 3 entry; a service whose load failed is retried on the next entry. The wizard never fetches.
- Step 3 can advance only if every row has a resolved base (not loading, not introuvable), a non-empty target, and no protected target.
- Protected means `development`/`preprod`/`prod` or that service's manifest `sharedBranch` (FR-7). The UI check is inline and advisory; the git gate stays authoritative.
- Esc closes the innermost element first: a field in edit, then the override box, then Panel A edit mode, then the wizard.
- Every Step 3 label is in French. Wizard navigation keys, Step 1/2 behavior and Step 4's submit flow (logging, `FailedResultList`, store's active write) are unchanged, except that `createEdt` receives `memberPlans`.
- `BranchAutocompleteInput` and `handleBranchAutocompleteKey` are reused, never copied. `TextInputLine` and `BoundedList` are reused as well.

**Ask First:** changing core `createEdt`/`MemberBranchPlan` semantics; touching the CLI `edt create` path; changing Step 4 beyond the recap and the memberPlans submit.

**Never:** Step 4's activation choice (Story 2.38); Story 2.31's `edt-create-from`; reimplementing `BranchAutocompleteInput`; fetching remotes; keeping dead branch-step helpers once they have no caller.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Default | base empty, topic `Auth Flow`, svc a (sharedBranch `main`) | row `[Créer (Global)] main → auth-flow`; plan `{create, main, auth-flow}` | — |
| Local preferred | base `rel`, a has local `rel` + `origin/rel` | base `rel` | — |
| Remote only | base `rel`, b has only `origin/rel` | base `origin/rel` | — |
| Not found | base `nope` | row `✖ branche introuvable` | Ctrl+N blocked, inline error |
| Name tracking | name untouched, back to Step 1 → topic `X Y` | name `x-y` | — |
| Name touched | edited to `feat/q`, topic changed | stays `feat/q` | — |
| Perso | box: base `origin/dev`, name `q` | `[Créer (Perso)]`, ignores Panel A | — |
| Existing | box: existing `feat/z` | `[Existante]`, target `feat/z`; plan `{existing, feat/z}` | — |
| Rename | existing `origin/w` + rename `w2` | `[Renommer]`, target `-> w2` | — |
| Protected | name `development`, or existing `prod` without rename | rejected inline | Apply refused |
| Remote shadowed | existing `origin/x`, local `x` exists, no rename | rejected inline | message: pick local `x` or rename |
| Revert | Ctrl+R in box | row back to `[Créer (Global)]`, box closed | — |
| List load fails | `listBranches` error | row shows load error | blocks advance; retried on re-entry |

</frozen-after-approval>

## Code Map

- `src/adapters/driving/tui/zones/edts/dialogs/create-wizard/step-branches.tsx` -- interim Step 3 (moved from create-dialog). **Rewrite fully**: Panel A/B views, Panel A input handling, and the row cursor.
- `.../create-wizard/wizard.logic.ts` -- `canAdvance(3)` (L57) and `stepSummary(3)` (L85) read the old fields; `withPrefillCursors` (L136) is retired. Add the pure helpers `resolveGlobalBase(input, lists)`, `buildRowView(row, global, lists, sharedBranch)`, `buildMemberPlans(...)` and `isProtectedTarget`.
- `.../create-wizard/create-wizard.tsx` -- dispatcher (L183):
  - the Step 3 branch at L212/L240 reroutes to the new handlers, and Step 3 Enter now stops advancing (L224);
  - `enterStep(3)` (L124) seeds the Step 3 state and triggers the list loads;
  - `submitCreate` (L47) builds `memberPlans` instead of `branchOptions`;
  - the view takes `maxVisibleRows`.
- New `.../create-wizard/override-box.tsx` -- the "Configurer <service>" box: state, a pure key reducer and the view. For autocomplete fields, follow `branch-picker.tsx` L384-411: exact match → commit, otherwise delegate to `handleBranchAutocompleteKey`.
- `.../create-wizard/step-activation.tsx` -- rebuild the recap from `buildRowView`.
- `.../create-wizard/step-services.tsx` -- stop calling `prefillBranchNames`/`prefillBaseBranches` on toggle (L45-60).
- `src/adapters/driving/tui/zones/edts/edts-zone.logic.ts`:
  - in `CreateDialogState` (L779), replace the branch fields (L805-831) with one `branches: BranchStepState`, and add `step3Focus`;
  - `CreateFormFocus` loses its branch values;
  - delete `NamingMode`, `advanceCreateFormFocus`, `prefillBranchNames`, `prefillBaseBranches`, `resolveBaseBranchMode`, `validateCreateBranchFields` and `buildCreateBranchOptions`, plus `suggestBaseBranchFor` if no caller remains;
  - keep `suggestBranchNameFromTopic` (L274);
  - update `initialCreateDialog` (L1073).
- `src/adapters/driving/tui/zones/edts/edts-zone.tsx`:
  - drop `'create'` from the picker `listBranches` effect (L360-397);
  - pass `listCreateBranches` to the wizard deps;
  - pass `maxVisibleRows = max(windowSize.rows - chrome, 3)`, same pattern as L311.
- `src/adapters/driving/tui/store/slices/edt-slice.ts`:
  - `CreateEdtParams` (L50) gains `memberPlans?` and `branchOptions` becomes optional; forward both in `createEdt` (L263);
  - add `listCreateBranches(repoPath)`, following the `listBranches` wrapper at L403.
- `src/core/edt/create.ts` -- export `listCreateCandidateBranches(git, repoPath)` → `{local, remote}`. `MemberBranchPlan` (L98) stays read-only.
- New `src/core/edt/shared-branches.ts` -- `SHARED_BRANCHES` + `isSharedBranch(name, manifestSharedBranch)`, moved from `src/adapters/driven/git/index.ts` (L33, L343), which imports them back. Same rule, one source.
- `ServiceBranchDivergence.sharedBranch` (core/edt/list.ts) -- the per-service manifest shared branch, already in `candidates`.
- Tests:
  - `wizard.logic.test.ts`;
  - new `override-box.test.ts`;
  - `edts-zone.interaction.test.tsx`: Step 3 create flows L1480-1560, plus any test typing through old Step 3 fields; KEYS in `fake-tty.ts`, add `ctrlR` = `\x12`;
  - `edts-zone.test.tsx`: tests of the retired helpers are deleted;
  - `edt-slice.test.ts`, `create.test.ts`, `git/index.test.ts`.
- `src/adapters/driving/tui/keybindings/keybindings.ts` + `EXPERIENCE.md` Component Patterns -- document the Step 3 keys and `Ctrl+R`, which is wizard-box scoped. Check that `Ctrl+R` has no collision.

## Tasks & Acceptance

**Execution:**
- [x] `src/core/edt/shared-branches.ts` (+ test), `src/adapters/driven/git/index.ts` -- move the shared-branch rule into core -- a single FR-7 definition for the gate and the UI.
- [x] `src/core/edt/create.ts` (+ test), `store/slices/edt-slice.ts` (+ test) -- `listCreateCandidateBranches`, `listCreateBranches`, and `memberPlans` passthrough -- the store boundary.
- [x] `edts-zone.logic.ts` -- new `BranchStepState` and `RowOverride` types; retire the old fields and helpers -- a single source of truth for Step 3.
- [x] `create-wizard/wizard.logic.ts` (+ test) -- the pure resolution, row-view, validation and plan helpers -- covers every matrix row at logic level.
- [x] `create-wizard/override-box.tsx` (+ test) -- the box reducer and view.
- [x] `create-wizard/step-branches.tsx`, `create-wizard.tsx`, `step-activation.tsx`, `step-services.tsx`, `edts-zone.tsx` -- Panel A/B, dispatch, list loading, recap and submit.
- [x] Interaction tests -- rewrite the Step 3 flows. Cover: default submit to `memberPlans`; not-found blocked; perso/existing/rename via the box; Ctrl+R; Esc layering; Tab panels.
- [x] `keybindings.ts` (+ test), `EXPERIENCE.md` -- key docs.

**Acceptance Criteria:**
- Given Steps 1–2 done, when Step 3 opens, then Panel A is focused, the base shows `<shared-branch>`, the name shows the topic slug, and every row reads `[Créer (Global)]`.
- Given valid rows, when Step 4 is confirmed, then `createEdt` receives `memberPlans` with one plan per member and no `branchOptions`.
- `npm test`, `npm run typecheck` and `npm run depcheck` pass.

## Design Notes

- `BranchStepState`: `globalBase`/`globalName` (`{value, cursor}`), `globalNameTouched`, `panel: 'global'|'rows'`, `globalLine: 'base'|'name'`, `editing`, `rowCursor`, `overrides: Record<path, RowOverride>` (absent = Global), `lists: Record<path, {status, local, remote}>`, `box: OverrideBoxState | null`.
- `RowOverride` = `MemberBranchPlan`: `create` → Perso; `existing` → Existante, or Renommer when `renameTo` is set. `buildMemberPlans` passes overrides through as-is.
- An `existing` target displays its local name, with the remote segment stripped as core does (`origin/x` → `x`).

## Verification

**Commands:**
- `npm run typecheck && npm test && npm run depcheck` -- expected: all green

**Manual checks:**
- In a real terminal: Step 3 panels, the box, and Ctrl+R.
