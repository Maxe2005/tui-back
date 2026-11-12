---
title: 'Story 5.10 — Persisted Filter Rules and Named Rule Sets'
type: 'feature'
created: '2026-11-09'
status: 'done'
baseline_commit: 'a0333790745ff9e88ddaa48ca390741925ddffeb'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5/spec-5-9-stackable-log-filter-rules.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Hide/show rule lists (5.9) vanish on restart, so noise filters are rebuilt daily and cannot be switched between setups.

**Approach:** Persist each scope's active rule list (global, per service) in the state file, and add a library of up to 20 named rule sets (save, overwrite, apply, rename, delete) reachable from the filter editor. The log stream and buffer are still never persisted.

## Boundaries & Constraints

**Always:**
- Persisted: per-scope rule lists (order + enabled state), keyed by repoPath, and the library. Level restriction stays ephemeral.
- Bounds: ≤10 rules per list/set, ≤20 sets; enforced on write and clamped on read.
- Tolerant reader (like filter history, but per element): an uncompilable rule is dropped, a corrupt value is dropped whole, each with a visible warning naming the field; the Logs tab still opens.
- Persisted lists of unregistered/deselected services are kept untouched and ignored; deselecting a service never erases its persisted rules.
- Save: empty name refused; existing name asks confirmation. Apply copies rules (later edits never alter the set); a non-empty target list is replaced only after confirmation. Delete asks confirmation (UX-DR36); rename/delete touch only that set, never an active list.
- `:settings` Logs tab: separate actions "clear persisted rules of one scope" and "delete whole library", each confirmed, each clearing only what it targets.
- Library and rule lists are windowed (`BoundedList`, AD-19); keys come from `footer-contexts.ts` declarations (footer + `?` help); source comments never reference stories/ACs (AD-17).
- `:reset` also clears persisted rules and the library, like the histories.

**Ask First:** Changing existing state-file fields' schema; any change to `Esc` semantics of 5.9.

**Never:** Persisting the stream, buffer, level, or live editor drafts; per-rule level; auto-applying sets; mutating stored sets from the active list.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Restart | scope with rules | list restored, order + enabled kept | N/A |
| Bad regex stored | rule `(` in file | rule dropped, other rules kept | warning naming the field |
| Corrupt value | non-array rules / library | whole value dropped | warning naming the field |
| Unknown service | rules for removed repoPath | kept in file, ignored | N/A |
| Save set | name exists | overwrite confirm | empty name refused |
| Apply set | target non-empty | replaced after confirm | N/A |
| Caps | 20 sets, save new | refused visibly | N/A |

</frozen-after-approval>

## Code Map

TUI = `src/adapters/driving/tui`. No core filter/state use case exists today; history logic lives in the TUI.

- `src/core/ports/state.ts` -- `StatePort`: add read/write for rule lists (record by repoPath/`global`) and library; plain-JSON types (AD-1).
- `src/adapters/driven/state/{schema.ts,index.ts}` -- extend strict zod schema, `StateFileShape`, `mergeWriteStateFile` field list, `readOptionalField` key union; per-field isolation already exists. Tests in `index.test.ts` (copy `filterHistory` describes: round-trip, corrupt value).
- `src/core/logs/rule-sets.ts` (new) -- pure library ops (save/overwrite/apply/rename/delete, caps) over `StatePort` returning `Result`, plus `sanitizeStoredRules` (drops uncompilable via `new RegExp`, returns `{value, warnings}`). Models: `core/scripts/reset-tool.ts` L157-172, `core/routes/saved-requests.ts`. Tested against a fake `StatePort` (no shared fake exists: each test declares `fakeState`; grep `readFilterHistory` to update all).
- `TUI/shared/input-history/persisted-history-store.ts` -- reusable hydrate-once/serialized-save controller for rules and library.
- `TUI/store/slices/logs-slice.ts` -- `logsGlobalFilter` (~129), `logsPaneFilters` (~132), `withoutPaneSettings` (~70, drops pane rules on deselect → persist from a separate record keyed by repoPath); add loaders, library state, `logsRulesWarning`; amend "in memory only" comment (~124).
- `TUI/app-shell.tsx` (~272, ~312), `TUI/store/slices/reset-slice.ts` (~182), `core/scripts/reset-tool.ts` -- hydrate at mount, re-run/clear on `:reset`.
- `TUI/zones/logs/logs-zone.logic.ts` -- `LogFilterRule`/`LogFilterScope`, `addLogRule`, `MAX_LOG_FILTER_RULES`, `FilterEditorState` (~862, add library/save-name/confirm views).
- `TUI/zones/logs/logs-zone.tsx` -- `handleRuleListKey` (~514), `updateScopeOf` (~405, single persist hook), confirm idiom `confirmClear`; routes-zone `overwriteConfirm`/`pickerDeleteConfirm` (L188-203, ~1066) and `setZoneInputCaptured` as save/delete confirm template.
- `TUI/zones/logs/log-filter-editor.tsx` -- library view on `BoundedList`, `TextInputLine` for names.
- `TUI/keybindings/footer-contexts.ts` -- new contexts (library, save-name, overwrite/delete confirm); tests `keybindings.test.ts`, `keybinding-help.test.tsx`.
- `TUI/shared/settings-screen.tsx` -- Logs groups (~479-531), clear rows (~566, key handling ~860-895; existing clears have no confirm — add for new actions); `settings-screen.test.tsx`.
- Warning surface: `logsRulesWarning` shown in the Logs zone (precedent `resetNotice` in app-shell).
- Docs: `EXPERIENCE.md` (Filter rules row L155, UX-DR36 table), `epics.md` (5.2 and 5.4 "ephemeral" amendment notes ~L84, 2813, 2863; 5.9 AC L3021 stays historical).

## Tasks & Acceptance

**Execution:**
- [ ] `core/ports/state.ts`, `adapters/driven/state/*` + tests -- new rule-list and library fields, round-trip, corrupt value, sibling preservation -- adapter
- [ ] `core/logs/rule-sets.ts` + test -- library ops, caps, sanitizer with warnings, fake `StatePort` -- core
- [ ] `logs-slice.ts`, `app-shell.tsx`, `reset-slice.ts`, `reset-tool.ts` + tests -- hydrate, persist on every list change, keep unselected services, warning field, reset -- state
- [ ] `logs-zone.tsx`, `logs-zone.logic.ts`, `log-filter-editor.tsx` -- library view, save/apply/rename/delete flows with confirmations -- UI
- [ ] `settings-screen.tsx` -- confirmed clear-scope-rules and delete-library actions -- UI
- [ ] `footer-contexts.ts`, keybinding/help/interaction tests, `EXPERIENCE.md`, `epics.md` notes -- keys, real-keystroke coverage, docs

**Acceptance Criteria:**
- Given restart, then the Logs tab restores each scope's rules with order and enabled state.
- Given library operations, then they behave per the matrix and confirmations; active lists are never altered by rename/delete/clear-library.
- Given bad stored data, then the Logs tab opens with a visible warning naming the field.
- `npm test`, typecheck, lint (incl. dependency-cruiser) pass.

## Spec Change Log

## Design Notes

The core sanitizer validates the stored shape with its own plain rule type (core cannot import TUI types) and compiles regexes with `new RegExp`. Persisted rules live in a record separate from the live pane filters so deselection keeps them. Key choices are left to the implementer, unused per view and declared in `footer-contexts.ts`.

## Verification

**Commands:**
- `npm test` -- expected: all pass
- `npm run typecheck` -- expected: no errors
- `npm run lint` -- expected: clean

## Suggested Review Order

**Stored data and tolerant reader**

- Sanitizer drops bad rules or values with warnings naming the field.
  [`rule-sets.ts:83`](../../../src/core/logs/rule-sets.ts#L83)

- Library operations with caps, overwrite and name validation.
  [`rule-sets.ts:185`](../../../src/core/logs/rule-sets.ts#L185)

- Port gains rule-list and library read/write.
  [`state.ts:36`](../../../src/core/ports/state.ts#L36)

- State schema fields stay lenient; core does the validation.
  [`schema.ts:17`](../../../src/adapters/driven/state/schema.ts#L17)

**Store and hydration**

- Load, persist-on-change and unreadable-field guard.
  [`logs-slice.ts:1214`](../../../src/adapters/driving/tui/store/slices/logs-slice.ts#L1214)

- Reset also clears persisted rules and the library.
  [`reset-tool.ts:69`](../../../src/core/scripts/reset-tool.ts#L69)

**Editor and settings UI**

- Library view keys: apply, rename, delete with confirmations.
  [`logs-zone.tsx:629`](../../../src/adapters/driving/tui/zones/logs/logs-zone.tsx#L629)

- Set name prompt for save and rename.
  [`logs-zone.tsx:699`](../../../src/adapters/driving/tui/zones/logs/logs-zone.tsx#L699)

- Confirmed clear-scope and delete-library actions.
  [`settings-screen.tsx:501`](../../../src/adapters/driving/tui/shared/settings-screen.tsx#L501)
