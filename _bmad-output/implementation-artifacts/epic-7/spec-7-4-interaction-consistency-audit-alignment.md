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
- [x] `epic-7/interaction-inventory-7-4.md` -- commit the audit -- AC1.
- [x] `EXPERIENCE.md` -- UX-DR36 canonical table + deviations -- **HALT: developer validates** -- AC2.
- [x] shared helpers (hint format, `StateLine`, list-cursor with Home/End) + tests -- replace ad-hoc versions.
- [~] zones/dialogs (partial, rest in 7.4b below) -- Enter-only confirm, Space toggle, `g` collision, Logs filter cancel, raw Tab sites, modal titles, ModalDialog callbacks, destructive-confirm guideline -- conform to table.
- [x] story file -- list every deliberately changed test; only if mid-story the list proves too large, split the remainder into 7.4b+.

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

## Implementation Notes (dev run, 2026-10-07)

Commits on this branch after the validated table: list-cursor/box-line helpers, Enter-only confirm + `g` freed + Tab via the focus primitive, `formatHints` + Update config screens in English, one hint format (footer, Routes, registry, reset), `StateLine` + `R` retry, Home/End in settings/registry/reset, `ModalDialog` callbacks dropped + quick-pick titles, French to English translation + Ctrl+T rename, help rows sync, footer generated from the keybinding list.

Decisions taken while implementing (all recorded as deviations in EXPERIENCE.md where they depart from the table):
- Update config, plain list: `Enter` starts the run, `e` edits the branch (Enter no longer edits or toggles). Two-panel screen: `Ctrl+N` starts from either panel (Enter opens/edits the focused row there), like wizard step 3 and switch resolution.
- Update: group trigger `g` is now `m`; Logs global-filter engagement `g` is now `i`. `g`/`G` are bound to nothing.
- `F2` cannot be bound: Ink 7.1.1 `useInput` yields empty input and no flag for function keys. BranchPicker rename is `Ctrl+T` (needs your confirmation). `Ctrl+R` is back-to-global everywhere it applies, Routes keeps `Ctrl+R` fire.
- Quit-mid-run confirm: Enter/Esc only. Settings clear-history actions: Enter only.
- Logs filter editor already restored the previous filter on Esc (code and a test existed); only its hint said "done" and now reads `[Enter] apply  [Esc] cancel`.
- Modal titles: wizard `CREATE EDT`; quick-pick titles `SELECT EDT TO SWITCH/MODIFY/DELETE/COPY`. `ModalDialog` lost its unused `onConfirm`/`onCancel` props (removed, not wired).

### Deliberately changed tests

Tests changed only for a deliberate binding or wording change:
- `update-config-dialog.test.ts`: Enter no longer begins an edit or toggles (confirms); `e` edits; `y`/`Y` ignored.
- `update-config-panels.logic.test.ts`: `y` ignored, `Ctrl+N` confirms from both panels, Enter on a panel line ignored, Home/End jumps added; mode column value `custom`.
- `update-config-panels.test.tsx`, `update-service-box.logic.test.ts`: English strings (`GLOBAL SETTINGS`, `no EDT chosen`, `Configure svc-1`, `Merge source`, `<none>`, `no command declared`, `custom`).
- `update-zone.test.tsx`: group trigger `m`/`M` instead of `g`/`G`; `resolveQuitConfirm` ignores `y`/`n`.
- `update-zone.interaction.test.tsx`: `m` instead of `g`; branch edit opened with `e`; start refused through `Ctrl+N`; new test for `R` retry.
- `update-slice.test.ts`: English error strings.
- `logs-zone.interaction.test.tsx`: `i` instead of `g` (global filter engagement).
- `override-box.test.ts`, `edts-zone.interaction.test.tsx`: Mode line flips with Space/Left/Right, Tab moves to the next line.
- `focus-navigation.guard.test.ts`: allowlist entries removed for files that no longer read `key.tab`.
- `branch-picker.test.tsx`: rename on `Ctrl+T`.
- `keybindings.test.ts`, `keybinding-help.test.tsx`: help rows (Ctrl+R merged, new rows, last row).
- `top-bar-footer-split.test.tsx`, `app-shell.test.tsx`, `app-shell.interaction.test.tsx`: `[Ctrl+W] resize`, `[↑/↓]`, `[←/→]`.
- `routes-zone*.test.tsx`, `json-tree.test.tsx`: hint format (`[Enter] request`, `[Esc]`, `[←/→] fold`, ...).
- `repo-registry-screen.test.tsx`, `reset-screen.test.tsx`: hint wording (`[Space] toggle  [Enter] register selection`, ...).
- `edts-zone.test.tsx`, `edts-zone.interaction.test.tsx`, `wizard.logic.test.ts`, `step-branches.test.tsx`, `activation.logic.test.ts`, `switch-resolution.logic.test.ts`, `suggest-field*.test.*`: French strings replaced by their English translation, quick-pick titles, `CREATE EDT`.
- `modal-dialog.test.tsx`: props removed.
- Added: `list-cursor.test.ts`, `box-line-nav.test.ts`, `hints.test.ts`, `state-line.test.tsx`, Home/End cases in `reset-screen.logic.test.ts` and `settings-screen.test.tsx`.

### Not done here (follow-up 7.4b, from the validated table)

- Footer context-live for dialogs, modals and panes (footer is declaration-generated but still zone-keyed).
- Unify the three fixed-menu reducers (service-actions, update service menu, blocker) into one `MenuList`.
- Unify the three branch autocompletes (`BranchAutocompleteInput`, `SuggestField`, `BranchPicker`'s own).
- `TextInputLine` still prints its own `[Enter] confirm  [Esc] cancel` under dialogs that also show a footer.
- Settings annotations still use prose ("Space to toggle ...") instead of the hint format; `DimAnnotation` zone hints in EDTs (`[Enter] switch/modify  [Tab] focus`) are not yet routed through `formatHints`.
- Update config dialog merge (below): waiting for approval.

## Proposed key path for the merged Update config dialog (AWAITING HUMAN APPROVAL, not implemented)

Goal: one dialog for global parameters plus per-service parameters, replacing the plain list (`update-config-dialog.*`, used for `p` single-service) and the two-panel screen. Every scope (EDT members, all repos, one service) opens the two-panel screen; the single-service case simply has a one-row table.

Layout: `GLOBAL SETTINGS` panel on top (merge source, EDT source, migrations, clean restart), per-service table below, one-line status/error, two hint lines.

Key path:
1. Opens with focus on the table, cursor on the first selected row (single service: that row).
2. `Tab` / `Shift+Tab`: toggle focus between the table and the global panel (shared focus-navigation primitive, `tab` mode, two stops).
3. Table: `↑`/`↓`/`Home`/`End` move; `Space` selects or deselects the row; `Enter` opens the per-service box for that row; `Ctrl+R` returns the row to the global parameters.
4. Per-service box: `↑`/`↓`/`Home`/`End`/`Tab`/`Shift+Tab` move between lines; `Space`/`←`/`→` flip migrations and clean restart (follow global / no / yes); `Enter` on the branch line edits it (autocomplete, `Enter` commits, `Esc` cancels), `Enter` on `[ Apply ]` applies; `Ctrl+R` back to global; `Esc` closes.
5. Global panel: `↑`/`↓`/`Home`/`End` move; `Space` (or `←`/`→` on the merge source) changes the value; `Enter` on the EDT source line edits it; typing on it starts the edit.
6. Start: `Ctrl+N` from anywhere, plus a `[ Start run ]` line as the last stop of the global panel (`Enter` on it starts), so the action is also discoverable from the keyboard path. The table's `Enter` keeps opening the box, hence the extra stop.
7. `Esc` closes the innermost layer first (box field, box, EDT edit), then cancels the dialog.
8. Hints (formatHints): table `[Tab] settings  [↑/↓] move  [Space] select  [Enter] configure` / `[Ctrl+R] back to global  [Ctrl+N] start run  [Esc] cancel`; panel `[Tab] table  [↑/↓] move  [Space] change` / `[Ctrl+N] start run  [Esc] cancel`.

Open questions for you: (a) keep `Ctrl+N` as the global start chord or drop it in favour of the `[ Start run ]` stop only; (b) one-service scope: skip the global panel's `Merge source` line (a single service has no EDT strategy) or keep it; (c) delete `UpdateConfigDialog`, `resolveUpdateConfigKey` and their tests once merged (about 600 lines).
