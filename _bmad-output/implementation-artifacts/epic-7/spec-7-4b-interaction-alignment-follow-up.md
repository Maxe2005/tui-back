---
title: 'Story 7.4b: Interaction alignment follow-up (UX-DR36)'
type: 'refactor'
created: '2026-10-07'
status: 'review'
baseline_commit: 'e91a9755eb2cae82f806cabefa2de3bc89bc3f8f'
review_loop_iteration: 0
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-7/spec-7-4-interaction-consistency-audit-alignment.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 7.4 left the footer zone-keyed, three fixed-menu reducers and three branch autocompletes duplicated, hand-written hints that bypass `formatHints`, and several derived strings (`[R] retry`, resize filter) that can drift from the keybinding declarations.

**Approach:** Finish the validated UX-DR36 table: context-live declaration-driven footer, one menu list, one branch autocomplete, enforced hint format, shared helpers reused everywhere. Behavior stays as the validated table says; only structure and wording consolidate.

## Boundaries & Constraints

**Always:** The validated UX-DR36 table in EXPERIENCE.md is the contract (list of 7.4 deviations stays valid). Tests change only where a binding or wording deliberately changes, each listed in this file. Core never imports TUI; AD-17 comment rule; conventional commits with `(story 7.4b)`, atomic; verify with `npm test && npm run typecheck && npm run depcheck`.

**Ask First:** Any new or changed key binding not in the table; if one of the three branch autocompletes has a purpose that cannot share the implementation, HALT with the reason (it becomes a documented deviation).

**Never:** Add i18n (separate future story); mouse support; change 7.7 focus-navigation semantics; touch the Dashboard (7.5/7.6).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Dialog open | any modal/dialog with a declared context | footer shows that context's hints; returns to zone hints on close | N/A |
| Hint outside helper | a hint string built without `formatHints` | guard test fails | N/A |
| Menus | service-actions, Update service menu, blocker | same keys and rendering from one component | N/A |
| Branch input | same typing/suggest keystrokes in each host | same suggestions, validity marks, loading and error line | `StateLine` error with `[R] retry` where a retry exists |

</frozen-after-approval>

## Code Map

- `src/adapters/driving/tui/shared/components/{footer,hints,state-line,text-input-line,keybinding-help}.tsx`, `keybindings/keybindings.ts` -- footer, hint helper, declarations.
- `src/adapters/driving/tui/shared/components/{branch-autocomplete-input,suggest-field,branch-picker}.tsx` -- the three autocompletes.
- Service-actions, Update service menu and blocker menu reducers (`zones/edts`, `zones/update`, `zones/*/dialogs`) -- find via grep for the menu reducers.
- `src/adapters/driving/tui/shared/{settings-screen,repo-registry-screen}.tsx`, `shared/keys/list-cursor.ts` -- cursor reuse.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- the three 7.4 review entries are resolved by this story; mark them done.

## Tasks & Acceptance

**Execution:**
- [x] Footer context-live from the store (zone + dialog/modal/pane context), generated from declarations; derive resize filter and `[R] retry` from them -- no duplicate constants.
- [x] Guard test that hint strings go through `formatHints`; convert remaining hand-written hints (wizard, Logs, Routes, registry, reset, Settings and EDTs annotations); `TextInputLine` stops printing a duplicate hint under a footer.
- [x] One shared menu list for the three fixed menus.
- [x] One branch autocomplete for the three hosts (or documented deviation after HALT).
- [x] Reuse `list-cursor` in settings and registry; `StateLine` everywhere loading/empty/error appears; fix shared → keybindings → zones import layering.
- [x] Update EXPERIENCE.md deviations and this file's changed-tests list.

**Acceptance Criteria:**
- Given any context, then the footer matches the `?` help declarations for that context.
- Given the codebase, then no hand-rolled menu, autocomplete, hint string or loading/empty/error line remains outside the shared components, except listed deviations.
- Given the existing suite, then only deliberate binding/wording changes alter tests, each listed.

## Spec Change Log

## Verification

**Commands:**
- `npm test` -- expected: all pass
- `npm run typecheck` -- expected: clean
- `npm run depcheck` -- expected: clean

## Implementation Notes (dev run, 2026-10-07)

What changed, in commit order:
- Layering: `NavigationKey` lives in `shared/keys/navigation-key.ts`, `TWO_PANEL_NAV` in `shared/keys/focus-navigation.ts`, selection helpers are imported from `shared/keys/list-cursor.ts` (no more re-export through the EDTs zone logic).
- Footer: contexts are declared in `keybindings/footer-contexts.ts` (id, label, hints) and registered through the store (`footerContexts` stack, `setFooterContext`, `useFooterContext`/`FooterContext`). The footer shows the last registered context, else the zone hints generated from `KEYBINDINGS` footer entries (`zones`, `when: 'resizable'`). The `?` help appends one row per context from the same data. `RETRY_HINT` feeds StateLine.
- Owners: help, command bar, filter stub, registry, reset, settings, Routes, Logs, EDTs (`edts-footer-context.ts`), Update (`updateConfigFooterContext` plus menus and the quit confirm), BranchPicker (`branchPickerFooterContext`).
- `hints.guard.test.ts` fails any `[Key] verb` literal (or `Enter to ...` prose) outside `formatHints`; the Dashboard sentence is the one allowlisted file.
- `MenuList` + `resolveMenuKey` replace the three menu reducers; `SuggestField` is folded into `BranchAutocompleteInput`; BranchPicker's create-new base field uses it; `TextInputLine` is one truncated line with `placeholder`/`labelWidth`.
- `list-cursor` is used by settings and registry; `StateLine` gained a `verb` and now renders every loading/empty/error line.

Decisions:
- No HALT: the three autocompletes share one view and one reducer. The default-on-empty rule stays in `stepSuggestField` (a wrapper over the shared reducer, keyed by the placeholder), because only the Update fields mean "use the default" when empty.
- Update config reclaimed the rows of its two hint lines: `CONFIG_MIN_ROWS` 22 to 20, `CONFIG_SERVICE_MIN_ROWS` 20 to 18, `SERVICE_BOX_ROWS` 10 to 8.
- Behaviour that moved with the unification (all inside the validated table's "Branch input" row): create-new's base field no longer cycles the value with the arrows (they highlight; `Enter` fills in, then advances), matching is substring instead of prefix, and the dropdown cap now counts indicator lines.

### Deliberately changed tests

- Hint/footer assertions replaced by footer-context assertions: `routes-zone*.test.tsx`, `json-tree.test.tsx`, `logs-zone.test.tsx`, `edts-zone.test.tsx`, `edts-zone.interaction.test.tsx`, `update-zone.test.tsx`, `repo-registry-screen.test.tsx`, `reset-screen.test.tsx`, `settings-screen.test.tsx`, `screens.interaction.test.tsx`, `text-input-line.test.tsx`, `filterable-pick-list.test.tsx`, `switch-resolution.logic.test.ts`.
- Wording: `Failed to scan` (was `Scan failed`), `Failed to load the summary.` (reset), `Failed to load branches.` (was `Failed to load.`), settings annotations without key prose, `services above/below` (were French).
- Menus: `update-service-menu-dialog.test.tsx` and `update-zone.test.tsx` call `resolveMenuKey` (reducer tests moved to `menu-list.test.tsx`).
- Autocomplete: `branch-autocomplete-input.test.tsx` (window instead of cap, placeholder, subject), `branch-picker.test.tsx` (base field delegation, no prefix matcher), `suggest-field*.test` merged away, `edts-zone.interaction.test.tsx` (dropdown cap).
- Layout budget: `update-config-panels.logic.test.ts` and `update-config-panels.test.tsx` (18 rows for a one-service screen).
- Removed with their code: `moveHintCursor`, `moveCandidateCursor`, `matchBranchesByPrefix`, `resolveBranchAutocompleteDropdown`, `PANELS_HINTS_*`, the step/box `*_FOOTER` constants.
- Added: `hints.guard.test.ts`, `menu-list.test.tsx`, `edts-footer-context.test.ts`, footer-context cases in `top-bar-footer-split.test.tsx`, `keybindings.test.ts`, and the screen/zone tests; `mount-for-test.ts` keeps a tree mounted to read registered contexts.
