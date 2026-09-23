---
title: 'EDT Quick-Pick — Filterable List for edt-switch / edt-modify / edt-delete'
type: 'feature'
created: '2026-09-23'
status: 'ready-for-dev'
review_loop_iteration: 0
context:
  - `{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md`
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `edt-switch`/`edt-modify` run with no argument today guess a target instead of letting the user pick (jump to "the first non-active EDT" / open whichever row happens to be focused) — a gap story 2.15's own ACs already described but never implemented. `edt-delete` with no argument has the identical gap (falls back to the focused row), so all three commands force the user to already know or be looking at the right EDT before the intended dialog opens.

**Approach:** Add one shared "EDT quick-pick" dialog — a filterable, arrow-navigable list of EDT topics with a `mode: 'switch' | 'modify' | 'delete'` field — and wire it into all three commands' no-argument path in `edts-zone.tsx`'s `currentEdtAction` effect, replacing their current ad hoc fallbacks. Topic-supplied invocations of all three commands are unchanged.

## Boundaries & Constraints

**Always:**
- Filter: case-insensitive prefix match on topic, same convention as `matchCommands`/`matchBranchesByPrefix`; arrow-navigable filtered list rendered below the filter field.
- Switch mode filters out the active EDT (today's "first non-active EDT" invariant, preserved as the candidate pool). Modify and delete modes filter over every EDT, active included.
- Selecting the active EDT under delete mode opens the existing rejection dialog (story 2.29 boundary: reject before any write, never auto-switched) — unchanged, just reached via the picker instead of the focused-row fallback.
- Esc closes the quick-pick from any mode with no dialog opened.
- Zero matches renders an explicit "No matching EDT" state, never a silently-empty list.
- Enter on a highlighted row opens the exact same pre-targeted dialog the topic-supplied path already opens (switch-confirm / modify / delete-confirm) — unchanged.
- `edt-switch <topic>` / `edt-modify <topic>` / `edt-delete <topic>` (topic supplied): behavior stays exactly as today; quick-pick only replaces the no-argument path.

**Ask First:** none — closes an already-identified gap using an existing, approved pattern (`branch-picker.tsx`'s filterable list).

**Never:** a second filterable-list *component* duplicating `FilterableBranchList`'s row-rendering approach — mirror its visual convention, don't import it (it's branch-name-shaped, this is EDT-topic-shaped). Never touch `commands.ts`/`edt-slice.ts` — the no-argument `target: 'select EDT'` sentinel they already produce is sufficient signal; this story's whole surface is the `edts-zone.tsx` effect plus the new dialog.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| `edt-switch` no arg | ≥1 non-active EDT exists | quick-pick(switch) opens, filtered over non-active EDTs | N/A |
| `edt-modify` no arg | any EDT exists | quick-pick(modify) opens, filtered over every EDT | N/A |
| `edt-delete` no arg | any EDT exists | quick-pick(delete) opens, filtered over every EDT | N/A |
| Select the active EDT | Enter on it, delete mode | delete-confirm opens, immediately shows rejection message | existing `edt-delete-active-rejected` message, unchanged |
| Filter matches 0 EDTs | any mode | "No matching EDT" shown | N/A |
| Esc pressed | quick-pick open, any mode | closes to no dialog | N/A |
| Topic supplied | `edt-switch\|modify\|delete <topic>` | pre-targeted dialog opens directly, no quick-pick | unchanged |

</frozen-after-approval>

## Code Map

- `src/adapters/driving/tui/zones/edts/edts-zone.logic.ts` L1089-1097 (`EdtDialogState` union -- add `QuickPickDialogState`), L1134-1154 (`initialSwitchDialog`/`initialModifyDialog` -- template for `initialQuickPickDialog`), L1008-1050 (`DeleteDialogState`/`initialDeleteDialog` -- nearest precedent for a target-selection dialog), L237-333ish (`TextInputState`/`TextEditKey`/`nextTextInputValue`, exported -- reuse directly for the filter field's caret handling, avoids re-deriving `branch-picker.tsx`'s local `applyTextInput`).
- `src/adapters/driving/tui/shared/components/branch-picker.tsx` L39-42 (`matchBranchesByPrefix` -- filtering convention to mirror, not import: string-keyed, this story needs the full `EdtRegistryEntry` back), L445-459 (`FilterableBranchList` -- row-rendering convention to mirror: `colors.accent` + `'› '` prefix on the highlighted row).
- `src/adapters/driving/tui/zones/edts/dialogs/switch-dialog.tsx` (108L, full file) -- closest structural precedent for the new dialog file: thin `createXDialogHandlers` object + `XDialogView` function, `ModalDialog` wrapper, Esc/Enter-only dispatch (no submit network call here, just navigation to another dialog).
- `src/adapters/driving/tui/zones/edts/edts-zone.tsx` L120 (`activeEdtUlid`), L269 (`edtsRows`), L94-104 (`initialDialogKind` prop union -- add `'quick-pick'`), L382-462 (`currentEdtAction` effect -- replace switch's "first non-active EDT" fallback at L401-411, modify's "focused EDT" fallback at L424-432, and delete's "focused EDT" fallback at L448-458, each with `setDialog(initialQuickPickDialog(mode)); setCurrentEdtAction(null);`), L479-558 (sibling `create*DialogHandlers` instantiations -- add `createQuickPickDialogHandlers` alongside), L569-599 (`useInput` dispatcher -- add a `dialog.kind === 'quick-pick'` branch), L856-868 (dialog render dispatch -- add `QuickPickDialogView`).
- Tests to extend: `edts-zone.test.tsx` / `.interaction.test.tsx` / `.styles.test.tsx` / `.layout.test.tsx`. No standalone `quick-pick-dialog.test.tsx` (mirrors story 2.29's own note: switch/modify/delete dialogs have no per-file test, covered via the zone-level suites).

## Tasks & Acceptance

**Execution:**
- [ ] `src/adapters/driving/tui/zones/edts/edts-zone.logic.ts` -- add `QuickPickDialogState` (`kind: 'quick-pick'`, `mode: 'switch' | 'modify' | 'delete'`, `query`, `queryCursor`, `cursor`) to the `EdtDialogState` union, plus `initialQuickPickDialog(mode)` constructor -- TUI state shape
- [ ] `src/adapters/driving/tui/zones/edts/dialogs/quick-pick-dialog.tsx` (new) -- `matchEdtsByPrefix(query, edts)` (case-insensitive topic prefix match, honoring per-mode candidate pool), `createQuickPickDialogHandlers` (Esc cancels; Left/Right/Home/End/Backspace/typed-char edit the filter via `nextTextInputValue`; Up/Down move a row cursor clamped to `[0, matches.length-1]`; Enter opens `initialSwitchDialog`/`initialModifyDialog`/`initialDeleteDialog` on the highlighted match), `QuickPickDialogView` (`TextInputLine` filter field + `FilterableBranchList`-style row list + explicit "No matching EDT" empty state) -- the widget itself
- [ ] `src/adapters/driving/tui/zones/edts/edts-zone.tsx` -- `currentEdtAction` effect: replace the 3 no-topic fallbacks with `setDialog(initialQuickPickDialog(mode))`; instantiate `createQuickPickDialogHandlers`; add `useInput` dispatch branch; add render dispatch branch; add `'quick-pick'` to the `initialDialogKind` prop union -- wires the dialog into the zone
- [ ] `src/adapters/driving/tui/zones/edts/edts-zone.{test,interaction.test}.tsx` -- extend for the quick-pick dialog kind: state/rendering plus real-keypress filter/arrow-nav/select/no-match/Esc coverage across all 3 modes, plus delete-mode selecting the active EDT surfacing the rejection message -- regression + new coverage

**Acceptance Criteria:**
- Given the command bar, `edt-switch` run with no argument, when it executes, then quick-pick(switch) opens filtering every non-active EDT's topic.
- Given quick-pick(switch), when an EDT is selected (Enter), then switch-confirm opens pre-targeted at it, unchanged from today's pre-targeted-by-topic path.
- Given the command bar, `edt-modify` run with no argument, when it executes, then quick-pick(modify) opens filtering every EDT (active included).
- Given quick-pick(modify), when an EDT is selected, then modify opens pre-targeted at it, unchanged from today.
- Given the command bar, `edt-delete` run with no argument, when it executes, then quick-pick(delete) opens filtering every EDT (active included).
- Given quick-pick(delete), when an EDT is selected, then delete-confirm opens pre-targeted at it (showing the existing rejection message if the target is active), unchanged from today's pre-targeted-by-topic path.
- Given quick-pick, any mode, when Esc is pressed, then it closes without opening anything, back to no dialog.
- Given quick-pick's filter matches exactly zero EDTs, when rendered, then it shows an explicit "No matching EDT" state, never a silently-empty list.
- Given `edt-switch <topic>`/`edt-modify <topic>`/`edt-delete <topic>` (topic supplied), when run, then behavior is unchanged.
- `npm test`, `npm run typecheck`, `npm run depcheck` all pass.

## Spec Change Log

## Design Notes

**Scope note:** epics.md's Story 2.30 text and the compiled epic-2 context name only `edt-switch`/`edt-modify`. This spec extends the same quick-pick to `edt-delete`'s no-argument path too, per explicit instruction — `edt-delete` has the identical "guess the target" gap that story 2.15's own ACs originally flagged for all three commands. No `epics.md`/`sprint-status.yaml` edit is made by this spec; flag to the human whether the planning doc should be amended to match once this ships.

**One dialog, one component, three modes** — never three near-duplicate dialogs. `matchEdtsByPrefix`/its row-rendering mirror `branch-picker.tsx`'s `matchBranchesByPrefix`/`FilterableBranchList` convention (same look, same filtering rule) without importing from that file, which has no notion of `EdtRegistryEntry` and would misuse a branch-name-shaped widget for EDT topics.

## Verification

**Commands:**
- `npm test` -- all suites green, including the extended `edts-zone.*` suites
- `npm run typecheck` -- clean
- `npm run depcheck` -- no boundary violations

**Manual checks:**
- TUI: `edt-switch` with no argument shows a filterable list of non-active EDTs; `edt-modify`/`edt-delete` with no argument show the same list including the active EDT; selecting the active EDT under `edt-delete` shows the existing rejection message; Esc closes the list; a filter matching nothing shows "No matching EDT"; `edt-switch <topic>`/`edt-modify <topic>`/`edt-delete <topic>` behave exactly as before.
