---
title: 'Story 7.4b: Interaction alignment follow-up (UX-DR36)'
type: 'refactor'
created: '2026-10-07'
status: 'in-progress'
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
- [ ] Footer context-live from the store (zone + dialog/modal/pane context), generated from declarations; derive resize filter and `[R] retry` from them -- no duplicate constants.
- [ ] Guard test that hint strings go through `formatHints`; convert remaining hand-written hints (wizard, Logs, Routes, registry, reset, Settings and EDTs annotations); `TextInputLine` stops printing a duplicate hint under a footer.
- [ ] One shared menu list for the three fixed menus.
- [ ] One branch autocomplete for the three hosts (or documented deviation after HALT).
- [ ] Reuse `list-cursor` in settings and registry; `StateLine` everywhere loading/empty/error appears; fix shared → keybindings → zones import layering.
- [ ] Update EXPERIENCE.md deviations and this file's changed-tests list.

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
