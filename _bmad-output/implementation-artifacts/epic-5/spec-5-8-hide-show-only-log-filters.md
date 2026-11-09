---
title: 'Story 5.8 — Hide / Show-Only Log Filters'
type: 'feature'
created: '2026-11-09'
baseline_commit: 'f3f95b86b692beb15991d8e704dd7f9022e2a47d'
status: 'done'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5/epic-5-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5/spec-5-4-filter-history-recall.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The log filter can only keep lines matching a pattern. Repeated noise (e.g. Nest `WARN [AffectationJoursUseCase] Aucun service de restauration trouvé …`) cannot be hidden, nor reduced to the matched text.

**Approach:** Add an **action** (`show`|`hide`) and a **target** (`line`|`match`) to `LogFilterSpec`, switchable by declared keys in the filter editor, always visible beside the query, stored in and restored from filter history. Default `show`+`line` equals today's behaviour.

## Boundaries & Constraints

**Always:**
- Rewriting happens at render/derivation time; ring-buffer originals are never altered (`Esc` restores everything).
- Filter still combines by AND with service and level filters; applying/clearing never interrupts the stream.
- Empty regex matches are ignored (no endless loop). Invalid regex is rejected inline for every action/target.
- Keys come from the keybinding declarations (help + footer generated from them); bounded rendering (AD-19) holds — the indicator is truncated, not wrapped; editor height budget (Story 5.5) accounts for any added row.
- History duplicates require query + action + target equal; recall (arrow browse and grid) restores all three. Entries written before this story read as `show`+`line`.
- Source comments must not reference stories/ACs (AD-17).

**Ask First:** Any change to the on-disk `filterHistory` schema that would make a state file written by this version unreadable by the previous one.

**Never:** Stackable rules (5.9), persisted rule sets (5.10), changes to service/level filter semantics, mutating stored `LogLine`s.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| show+line | query `WARN`, line matches | line shown unchanged; non-matching hidden | N/A |
| hide+line | query `Aucun service`, line matches | line not displayed | N/A |
| hide+match | matches removed, rest kept | `[Nest] … WARN [X] ` minus match; empty-after-removal line not displayed | N/A |
| show+match | matches in line | only matched text(s) displayed; non-matching lines not displayed | N/A |
| Empty-match regex | `a*` | empty matches ignored | N/A |
| Invalid regex | `(` with any action/target | rejected inline, nothing committed | inline error |
| Legacy history | plain-string entry | reads as `show`+`line` | corrupt entry → dropped like today |
| Duplicate | same query, different action | two distinct entries | N/A |

</frozen-after-approval>

## Code Map

TUI = `src/adapters/driving/tui`.

- `TUI/zones/logs/logs-zone.logic.ts` -- `LogFilterSpec`/`DEFAULT_LOG_FILTER`/`isDefaultLogFilterSpec` (~458-473, must include action/target or default-spec detection breaks); `compileLogFilter` (493, boolean only → needs match ranges); `resolveFilterEditorDraft` (529); `applyLogFilters` (559, filter → map+filter); `resolveEffectiveLines` (576); `toggleFilterMode` (641); `formatLogFilterSpec` (648, annotations); `filterHistoryKeyString` (688); history re-exports (694-700); `FilterEditorState` (706).
- `TUI/zones/logs/logs-zone.tsx` -- editor `useInput` (~490-630): Enter commit (551, `commitFilterHistoryEntry`), Tab mode toggle (574), history recall (508-523 grid, 600-630 arrows) must set action/target; visible-line count (~356) must match rendered lines.
- `TUI/zones/logs/log-filter-editor.tsx` -- indicator next to query (label line 61), grid labels (identity today).
- `TUI/zones/logs/logs-pane-view.tsx`, `fullscreen-pane.tsx` -- consume `resolveEffectiveLines`.
- `TUI/shared/input-history/input-history.logic.ts` -- string-only push/browse/dedup; needs equality/key notion for composite entries.
- `TUI/store/slices/logs-slice.ts` (~1020-1055) -- `filterHistory`, `commitFilterHistoryEntry`, clear actions.
- `src/core/ports/state.ts` (16-17), `src/adapters/driven/state/schema.ts:13`, `state/index.ts` (~246) + `index.test.ts` (366-435) -- persisted `Record<string,string[]>`; accept legacy strings and normalise on read.
- `TUI/keybindings/footer-contexts.ts` (`logs-filter-edit`, 150) + `keybindings.test.ts` (`EXPECTED`, CONTEXT_ROWS) + `keybinding-help.test.tsx:151`.
- Tests: `logs-zone.logic.test.ts` (inline `line()` builders, no fixture files), `logs-zone.interaction.test.tsx`, `logs-zone.test.tsx`.
- Docs: `_bmad-output/planning-artifacts/ux-designs/ux-tui-back-2026-08-10/EXPERIENCE.md` (filter-editor row, history sentence). No root README.
- Editor keys already taken: Tab, Shift+Tab, Ctrl+←/→, ↑/↓, ←/→, Home/End, Enter, Esc; printable chars go to the query.

## Tasks & Acceptance

**Execution:**
- [ ] `logs-zone.logic.ts` -- add action/target to spec, default, compile (match ranges, empty matches ignored), pure `applyLogFilter` transform, `formatLogFilterSpec`; toggles for action/target -- core behaviour
- [ ] `logs-zone.logic.test.ts` -- four combos with the Nest WARN fixtures, empty-match, invalid regex, default-spec detection -- I/O matrix
- [ ] `input-history.logic.ts` + `logs-slice.ts` + `state` port/schema/adapter -- composite history entries, equality on all three, legacy-string read -- history
- [ ] `logs-zone.tsx`, `log-filter-editor.tsx`, `footer-contexts.ts` -- keys, indicator, recall restore, grid labels, layout budget -- UI
- [ ] keybinding/help/interaction/render/state tests + EXPERIENCE.md -- coverage and docs

**Acceptance Criteria:**
- Given the editor, when the declared action/target keys are pressed, then the combination is shown beside the query and applied immediately without interrupting the stream.
- Given a committed non-default filter, when recalled by arrow or grid, then query, action and target are restored.
- Given a state file with plain-string history, when loaded, then entries behave as `show`+`line`.
- Given a small terminal or long line, then rendering stays bounded and the indicator is truncated.
- `npm test` and typecheck/lint/dependency-cruiser pass.

## Spec Change Log

## Design Notes

Key choice and history encoding are left to the implementer within constraints: keys must be unused in the editor and declared in `footer-contexts.ts`; persisted entries may be a string-or-object union (legacy string = `show`+`line`) so older files load unchanged.

## Verification

**Commands:**
- `npm test` -- expected: all pass
- `npm run typecheck` -- expected: no errors (use the script names in package.json)
- `npm run lint` -- expected: clean (includes comment hygiene and dependency-cruiser tests)

## Suggested Review Order

**Filter model and matching**

- Spec gains action/target; default detection must include both.
  [`logs-zone.logic.ts:466`](../../../src/adapters/driving/tui/zones/logs/logs-zone.logic.ts#L466)

- Compile returns `apply`: line, rewritten copy, or null; empty matches skipped.
  [`logs-zone.logic.ts:543`](../../../src/adapters/driving/tui/zones/logs/logs-zone.logic.ts#L543)

- Global then pane filter chained; originals never mutated.
  [`logs-zone.logic.ts:625`](../../../src/adapters/driving/tui/zones/logs/logs-zone.logic.ts#L625)

**History encoding**

- Non-default entries carry a header; bare strings stay show+line.
  [`logs-zone.logic.ts:790`](../../../src/adapters/driving/tui/zones/logs/logs-zone.logic.ts#L790)

**Editor and keys**

- Ctrl+X / Ctrl+T toggles; close grid, end browse.
  [`logs-zone.tsx:620`](../../../src/adapters/driving/tui/zones/logs/logs-zone.tsx#L620)

- Snap-back restores the draft's action/target too.
  [`logs-zone.tsx:473`](../../../src/adapters/driving/tui/zones/logs/logs-zone.tsx#L473)

- Indicator shares the Level row, truncated, no extra height.
  [`log-filter-editor.tsx:68`](../../../src/adapters/driving/tui/zones/logs/log-filter-editor.tsx#L68)

- Keys declared once for footer and help.
  [`footer-contexts.ts:152`](../../../src/adapters/driving/tui/keybindings/footer-contexts.ts#L152)

**Tests**

- Four combos, empty match, Unicode, encoding round-trip.
  [`logs-zone.logic.test.ts`](../../../src/adapters/driving/tui/zones/logs/logs-zone.logic.test.ts)

- Real-keystroke recall, snap-back, grid, pane editor, Esc.
  [`logs-zone.interaction.test.tsx`](../../../src/adapters/driving/tui/zones/logs/logs-zone.interaction.test.tsx)
