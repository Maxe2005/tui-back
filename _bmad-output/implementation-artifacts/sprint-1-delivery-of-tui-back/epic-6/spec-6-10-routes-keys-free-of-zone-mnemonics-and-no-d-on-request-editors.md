---
title: 'Routes Keys Free of Zone Mnemonics & No d on Request Editors'
type: 'feature'
created: '2026-11-16'
status: 'done'
baseline_commit: '1bb1017dcfddaf6516b6e9a81b998d494b3d08d7'
review_loop_iteration: 0
context:
  - '/home/mchoisel/Documents/IANORD/tui-back-epic-6/_bmad-output/implementation-artifacts/sprint-1-delivery-of-tui-back/epic-6-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** In the Routes zone `s` (open saved-request picker) is dead on the list because `s` is the shared-types zone mnemonic, and `d` can delete a body field, header or query row by accident.

**Approach:** Rebind picker to `p` (list) and save to `w` (Request tab), remove delete from the body tree editor and the Query/Headers rows, and delete the code that becomes unreferenced (AD-17).

## Boundaries & Constraints

**Always:**
- `s` on the Routes list keeps switching zone; `s` is no longer bound inside the pane.
- Footer hints and `?` help show `p picker` / `w save`; no Routes context mentions `s` for saving or picking, and none shows `d delete` for body/Query/Headers (contexts `routes-list`, `routes-list-editable`, `routes-section`, `routes-rows-readonly`, `routes-rows`, `routes-rows-empty`, `routes-body-tree`, `routes-body-tree-add`).
- `a` (add), value edit (including emptying it), `t` (type) and `r` (raw mode) keep working; path params still cannot be removed.
- Unchanged `d`: Saved-tab row (with confirm), stale row of the picker, `d`/`Space` on a JsonTree filter rule.
- Imports first, relative imports end in `.js`; no dead code left behind.

**Never:** No new key besides `p` and `w`; no change to favorites/recents (6.11+), no `core/` change.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Picker | list focused, `p` | picker opens | N/A |
| Zone switch | list focused, `s` | switches to shared-types zone | N/A |
| Save | Request tab, `w` | save-name prompt opens | N/A |
| Old save key | Request tab, `s` | nothing | N/A |
| Body delete | body tree, `d` / `D` | draft unchanged | Inert |
| Row delete | Query/Headers row, `d` / `D` | rows unchanged | Inert |

</frozen-after-approval>

## Code Map

- `src/adapters/driving/tui/zones/routes/routes-zone.tsx:1656` -- list `s` → `openPicker()`: becomes `p`. `:1368` -- Request-tab `s` → `openSavePrompt()`: becomes `w`. `:793` -- `delete-entry` case (drop, with imports `:40` `remapErrorsForDelete`, `:42` `removeEntryAtPath`). `:1547` -- Query/Headers `d` branch (drop, with import `:94` `removeRequestRow`). Leave `:1180`, `:1400`, `:1483`, `:1604` (kept `d` uses).
- `src/adapters/driving/tui/shared/components/json-tree/tree-keys.ts:37,83` -- `delete-entry` action and `d`/`D` mapping: remove.
- `src/adapters/driving/tui/shared/components/json-tree/body-edit-path.ts:256` -- `removeEntryAtPath` (and `removeEntry` if present): delete when unreferenced; `body-draft.ts:79` `remapErrorsForDelete`: delete.
- `src/adapters/driving/tui/zones/routes/routes-request.logic.ts:165` -- `removeRequestRow`: delete.
- `src/adapters/driving/tui/keybindings/footer-contexts.ts:242-335` -- hints to rewrite (`s saved`→`p picker`, `s save`→`w save`, drop `d delete` in `routes-rows`, `routes-body-tree`, `routes-body-tree-add`; keep `routes-saved`).
- Tests: `model.test.ts:348,575,716` (resolver `d`, `removeEntryAtPath`, `remapErrorsForDelete`), `routes-request.logic.test.ts:164`, `routes-zone.test.tsx:367,375` (hint assertions), `routes-zone.interaction.test.tsx` (`s` presses at ~102, 1209–1333, 1711, 1741; `d` presses on body/rows at ~580–613, 758–766, 1024 — check each).

## Tasks & Acceptance

**Execution:**
- [x] `routes-zone.tsx`, `tree-keys.ts` -- rebind `p`/`w`; remove body and row delete -- matrix rows.
- [x] `body-edit-path.ts`, `body-draft.ts`, `routes-request.logic.ts` -- delete now-unreferenced helpers (grep first) -- AD-17.
- [x] `footer-contexts.ts` -- update hints -- AC 3.
- [x] `model.test.ts`, `routes-request.logic.test.ts`, `routes-zone.test.tsx`, `routes-zone.interaction.test.tsx` -- remove deleted-helper tests, switch `s` presses to `p`/`w`, add `d` leaves body/Query/Headers unchanged, `s` on list switches zone.

**Acceptance Criteria:**
- Given the Routes list focused, when `p` is pressed, then the picker opens; when `s` is pressed, then the zone switches.
- Given the Request tab, when `w` is pressed, then the save prompt opens and `s` does nothing.
- Given the footer and `?` help, when rendered in the listed contexts, then they show `p picker` / `w save` and no `d delete` for body/rows.
- Given the body editor or a Query/Headers row, when `d`/`D` is pressed, then nothing changes while `a`, value edit, `t`, `r` still work.
- Given the other `d` uses (Saved tab, picker stale row, filter rule), when `d` is pressed, then they behave as before.

## Spec Change Log

## Verification

**Commands:**
- `npm test` -- expected: Vitest green.
- `npm run typecheck` -- expected: clean.
- `npm run depcheck` -- expected: no violation.

## Suggested Review Order

**Key rebinding (start here)**

- List `p` opens the picker, guarded against Ctrl/Meta; `s` falls through to the zone switch.
  [`routes-zone.tsx:1634`](../../../../../src/adapters/driving/tui/zones/routes/routes-zone.tsx#L1634)

- Request tab `w` opens the save prompt; `s` is no longer bound.
  [`routes-zone.tsx:1350`](../../../../../src/adapters/driving/tui/zones/routes/routes-zone.tsx#L1350)

**Delete removal**

- `d` no longer resolves to an action, so the body editor ignores it.
  [`tree-keys.ts:79`](../../../../../src/adapters/driving/tui/shared/components/json-tree/tree-keys.ts#L79)

- `delete-entry` case gone; `change-type` follows `add-entry` directly.
  [`routes-zone.tsx:790`](../../../../../src/adapters/driving/tui/zones/routes/routes-zone.tsx#L790)

- Unreferenced helpers deleted (AD-17).
  [`body-draft.ts:1`](../../../../../src/adapters/driving/tui/shared/components/json-tree/body-draft.ts#L1)

**Hints**

- Footer contexts show `p picker` / `w save` and no `d delete`.
  [`footer-contexts.ts:242`](../../../../../src/adapters/driving/tui/keybindings/footer-contexts.ts#L242)

**Tests**

- Footer assertions across every affected context.
  [`routes-zone.test.tsx:370`](../../../../../src/adapters/driving/tui/zones/routes/routes-zone.test.tsx#L370)

- `d`/`D` leave the body unchanged.
  [`routes-zone.interaction.test.tsx:603`](../../../../../src/adapters/driving/tui/zones/routes/routes-zone.interaction.test.tsx#L603)

- `s` is inert on the list and in the Request tab.
  [`routes-zone.interaction.test.tsx:1224`](../../../../../src/adapters/driving/tui/zones/routes/routes-zone.interaction.test.tsx#L1224)
