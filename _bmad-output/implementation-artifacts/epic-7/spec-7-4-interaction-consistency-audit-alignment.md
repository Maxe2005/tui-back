---
title: 'Story 7.4: Interaction consistency audit & alignment (UX-DR36)'
type: 'refactor'
created: '2026-10-07'
status: 'in-progress'
baseline_commit: '94d7ee8b9969e883059b51793119b5115dbce3d5'
review_loop_iteration: 0
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-7/interaction-inventory-7-4.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The same intent uses different keys, wording and components across zones (about 60 divergences inventoried): four hint styles, Enter that sometimes toggles, `y` as a start key, `g` colliding with the reserved jump key, missing Home/End, five destructive-confirm patterns, hand-written loading/empty/error lines, ModalDialog ignoring its callbacks, French/English mixed.

**Approach:** Commit the inventory, record one canonical choice per intent as the UX-DR36 table in EXPERIENCE.md (Interaction Primitives), **halt for the developer to validate that table**, then align the core S/M items through shared helpers/components. The full alignment list stays in this story (human chose Keep over Split); if it proves too large mid-way, remaining items go to 7.4b+ from the validated table.

## Boundaries & Constraints

**Always:** Inventory lives in `epic-7/interaction-inventory-7-4.md`. Canonical table = single source for alignment; every intentional deviation listed with its reason. Tests change only where a binding/wording deliberately changed, each listed in the story file. Core never imports TUI; AD-17 comment rule; conventional commits with `(story 7.4)`, atomic, on this story branch; verify with `npm test && npm run typecheck && npm run depcheck`.

**Ask First:** Validation of the canonical table (hard gate before any alignment code). Any state-port or persisted-shape change.

**Never:** Start alignment before the table is validated; add mouse support; change 7.7 focus-navigation semantics.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Cursor | Up/Down at list ends; Home/End | clamp; Home/End jump in every list | N/A |
| Confirm | Enter on a confirm/start dialog | confirms; `y` no longer starts a run; Esc cancels (inner first) | N/A |
| Toggle | Space vs Enter in settings/panels | Space toggles, Enter confirms/opens | N/A |
| Logs filter | Esc in filter editor | cancels edit and restores previous value; Enter commits | N/A |
| Load state | loading / empty / error | one shared state line; error shows `[R] retry` where a retry exists | N/A |
| `g` key | Update and Logs | no longer bound to unrelated actions (`g` stays reserved) | N/A |

</frozen-after-approval>

## Code Map

- `epic-7/interaction-inventory-7-4.md` -- audit output (15 sections, divergences, proposed canonical table, work list); first commit.
- `_bmad-output/planning-artifacts/ux-designs/ux-tui-back-2026-08-10/EXPERIENCE.md` -- add the UX-DR36 table under Interaction Primitives.
- `src/adapters/driving/tui/shared/components/{modal-dialog,footer,keybinding-help,bounded-list,filterable-pick-list,checkbox-list-item,spinner}.tsx` -- shared components to align / add `StateLine`, hint-format helper, list-cursor module.
- `src/adapters/driving/tui/keybindings/keybindings.ts` -- help rows; hint style `Ctrl+W`, `↑/↓`.
- `zones/{update,logs,edts,routes}/…`, `update-config-dialog*`, settings/registry/reset dialogs -- alignment sites (Enter-only confirm, `y`, `g`, Home/End, raw `key.tab` sites, Logs filter cancel, modal titles).

## Tasks & Acceptance

**Execution:**
- [ ] `epic-7/interaction-inventory-7-4.md` -- commit the audit -- AC1.
- [ ] `EXPERIENCE.md` -- UX-DR36 canonical table + deviations -- **HALT: developer validates** -- AC2.
- [ ] shared helpers (hint format, `StateLine`, list-cursor with Home/End) + tests -- replace ad-hoc versions.
- [ ] zones/dialogs -- Enter-only confirm, Space toggle, `g` collision, Logs filter cancel, raw Tab sites, modal titles, ModalDialog callbacks, destructive-confirm guideline -- conform to table.
- [ ] story file -- list every deliberately changed test; only if mid-story the list proves too large, split the remainder into 7.4b+.

**Acceptance Criteria:**
- Given the story starts, then the inventory is committed under `epic-7/`.
- Given divergences, then the validated UX-DR36 table exists in EXPERIENCE.md before alignment starts.
- Given the table, then every zone/dialog conforms or is listed as a deviation with reason, including: FR clusters translated to English, footer and `?` help generated from one declaration list (footer context-live), the two update-config dialogs merged, the three branch autocompletes unified.
- Given tests, then only deliberate binding/wording changes alter them, each listed.

## Spec Change Log

## Design Notes

Proposed canonical choices (to validate): Up/Down clamp + Home/End, no vim keys, `g/G` reserved; Enter confirms/opens, Space toggles, Esc cancels; edit: Enter commits, Esc cancels; destructive: Enter modal (reversible), Ctrl+E (irreversible file loss), typed word (data reset); `/` filter; `R` retry; hints `[Key] verb` joined by two spaces; titles UPPERCASE; UI language English.

## Verification

**Commands:**
- `npm test` -- expected: all pass
- `npm run typecheck` -- expected: clean
- `npm run depcheck` -- expected: clean
