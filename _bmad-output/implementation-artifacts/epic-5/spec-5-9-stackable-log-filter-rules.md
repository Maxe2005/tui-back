---
title: 'Story 5.9 — Stackable Log Filter Rules'
type: 'feature'
created: '2026-11-09'
status: 'ready-for-dev'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5/spec-5-8-hide-show-only-log-filters.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A scope (global, or one service) holds a single filter rule (5.8), so each kind of noise cannot be silenced separately while keeping the rest readable.

**Approach:** A scope holds an ordered list of up to 10 rules (query, mode, action, target, enabled) applied as a top-to-bottom pipeline. The filter editor opens on that list (add / edit / enable / delete / move); editing a rule reuses the 5.8 editor as a rule editor. The scope's level restriction (5.2) stays one per scope, ANDed with the pipeline.

## Boundaries & Constraints

**Always:**
- Pipeline: each enabled rule filters or rewrites the output of the previous one; disabled rules are skipped; global rules (when the pane is engaged) run first, then the pane's own. Two `show` rules = AND; a `hide`+`match` above a `show` rule means the `show` sees the rewritten line. Level is judged on the original text.
- Rewriting stays render-time; ring-buffer originals are never mutated; list changes never interrupt the stream and apply immediately.
- A rule is validated on commit (Enter in the rule editor): invalid regex shows the inline error and the rule never enters the list. A pane/global spec with an uncompilable rule is unreachable.
- 10-rule cap per scope: adding the 11th is refused with a visible message.
- The rule list is a windowed, cursor-driven list (`BoundedList`, more-above/below indicators, AD-19), height budget per Story 5.5; its keys come from the keybinding declarations (footer + `?` help); source comments never reference stories/ACs (AD-17).
- `Esc`: rule editor → back to the list (draft discarded); list → closes the editor, keeping every change already applied. No `Esc` path clears rules; "clear all rules" is a separate declared key with confirmation (UX-DR36).
- Rule history (5.4) is unchanged: Enter in the rule editor records query+action+target in the (scope, mode) history; arrow/grid recall restores all three.
- Rules and live filter state stay ephemeral (empty after restart); only the history persists.

**Ask First:** Changing the on-disk `filterHistory` schema; changing the `Esc` cascade when no editor is open (currently clears the scope's filter — assumed to stay, as an explicit gesture outside the editor).

**Never:** Persisted rules/sets (5.10), per-rule level, changing service/level semantics, mutating stored `LogLine`s.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| AND of shows | `show line "WARN"`, `show line "Affectation"` | only lines containing both | N/A |
| Order matters | `hide match "Aucun service"` above `show line "WARN"` | show sees the rewritten line | moving the rule below changes result |
| Disabled rule | rule toggled off | skipped, result as if absent | N/A |
| Empty list | no rules | all lines shown (level still applies) | N/A |
| Invalid regex | `(` committed | rejected inline, list unchanged | inline error |
| Cap | 10 rules, add | refused with visible message | N/A |
| Scopes | global + pane rules | global first, then pane; pane not engaged → global skipped | N/A |

</frozen-after-approval>

## Code Map

TUI = `src/adapters/driving/tui`.

- `TUI/zones/logs/logs-zone.logic.ts` -- `LogFilterSpec`/`DEFAULT_LOG_FILTER`/`isDefaultLogFilterSpec` (~455-473), `compileLogFilter` (~525, single-rule `apply`), `resolveFilterEditorDraft` (~575, live commit — becomes commit-on-Enter), `applyLogFilters` (~600) → `applyLogRules` over a rule list, `resolveEffectiveLines` (~615), `formatLogFilterSpec` (~690, pane/fullscreen annotation → rule count/summary), `FilterEditorState` (~740, gains list/rule view mode, list cursor, rule index being edited). Reuse `findMatchRanges`/`removeRanges`/`encode/decodeFilterHistoryEntry`.
- `TUI/zones/logs/logs-zone.tsx` -- `useInput` editor (~516-690): add list-mode keys, rule-mode Enter/Esc semantics; `openGlobalFilterEditor` (376)/`openPaneFilterEditor` (392); preOpen revert (525-532) goes away; Esc cascade (789-802) clears the scope's rules; visible-line count (363-365) must use the rule pipeline.
- `TUI/zones/logs/log-filter-editor.tsx` -- renders rule editor today; add rule list view on `BoundedList` (`TUI/shared/components/bounded-list.tsx`).
- `TUI/zones/logs/logs-pane-view.tsx` (99-102), `fullscreen-pane.tsx` (89-92) -- annotations + `resolveEffectiveLines` consumers.
- `TUI/store/slices/logs-slice.ts` -- `logsGlobalFilter` (129/630), `logsPaneFilters` (132/633), setters; reset in `withoutPaneSettings` (67). Types become `{ level, rules }` per scope.
- `TUI/keybindings/footer-contexts.ts` (`logs-filter-edit` ~150, add a `logs-filter-rules` context) + `keybindings.test.ts` + `keybinding-help.test.tsx`.
- Tests: `logs-zone.logic.test.ts`, `logs-zone.interaction.test.tsx` (1987 lines, real keystrokes), `logs-pane-views.test.tsx`, `logs-slice.test.ts`, `app-shell.test.tsx` (reference the filter state).
- Docs: `_bmad-output/planning-artifacts/ux-designs/ux-tui-back-2026-08-10/EXPERIENCE.md` (filter-editor row).

## Tasks & Acceptance

**Execution:**
- [ ] `logs-zone.logic.ts` + `.test.ts` -- `LogFilterRule` (spec + `enabled`), scope type `{level, rules}`, `applyLogRules`, cap constant, list ops (add/replace/toggle/delete/move, pure), summary formatter; Nest `AffectationJoursUseCase` fixtures for ordering, AND, disabled, cap -- core
- [ ] `logs-slice.ts` (+test), `app-shell.test.tsx` -- store shape for global/pane scopes, per-service reset -- state
- [ ] `logs-zone.tsx`, `log-filter-editor.tsx`, `logs-pane-view.tsx`, `fullscreen-pane.tsx` -- list view, rule editor reuse, commit/Esc contract, clear-all with confirmation, annotations -- UI
- [ ] `footer-contexts.ts` + keybinding/help tests, `logs-zone.interaction.test.tsx`, `EXPERIENCE.md` -- keys, real-keystroke coverage, docs

**Acceptance Criteria:**
- Given the editor on a scope, then it lists that scope's rules (query, mode, action, target, enabled) in a bounded cursor list; empty = no filter.
- Given add/edit/toggle/delete/move, then the stream is uninterrupted and output updates immediately.
- Given the 10-rule cap or an invalid regex, then the add/commit is refused visibly and the list is unchanged.
- Given a restart, then rules are empty again while filter history is still recalled.
- `npm test`, typecheck, lint (incl. dependency-cruiser) pass.

## Spec Change Log

## Design Notes

Level stays per scope (not per rule) to honour "level ANDs with the pipeline". Live per-keystroke preview of the editor is replaced by commit-on-Enter, since an uncommitted/invalid draft must never enter the list. Key choices (add, delete, move, toggle, clear-all) are left to the implementer, unused in each view and declared in `footer-contexts.ts`.

## Verification

**Commands:**
- `npm test` -- expected: all pass
- `npm run typecheck` -- expected: no errors
- `npm run lint` -- expected: clean
