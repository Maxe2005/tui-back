---
title: 'Raw Body Mode as a Full Multi-Line Text Editor'
type: 'feature'
created: '2026-11-25'
status: 'in-progress'
baseline_commit: '5be19d4c0a17acfc56c1e410df10a09aebf8ae25'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/sprint-1-delivery-of-tui-back/epic-6-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Raw body mode (`r`, Story 6.8) is a single-offset text input: no Up/Down, no selection, no undo, no indent, and a pasted payload is inserted raw. Fixing a JSON payload means fighting the cursor.

**Approach:** A pure multi-line buffer model (lines, cursor, selection, undo/redo, indent rules, paste) rendered by a rewritten `JsonRawEditor` (numbered lines, windowed, line/column status). The zone only forwards keys.

## Boundaries & Constraints

**Always:**
- Pure model in a new file `shared/components/inputs/multiline-edit.ts` (+ test). `TextInputState`, `nextTextInputValue` and `TextInputLine` stay untouched.
- Render windowed with `BoundedList` (AD-19); long lines scroll horizontally around the caret (`windowAroundCaret`), never silently clipped.
- Keys: arrows, `Home`/`End` (line), `Ctrl+Home`/`Ctrl+End` (document), `PgUp`/`PgDn`, `Ctrl+←/→` (word), `Shift`+movement selects, `Ctrl+A` select all, `Enter` indent-aware (+1 level after `{`/`[`), `Tab` = 2 spaces, `Ctrl+K` kill to end of line, `Ctrl+Z`/`Ctrl+Y` bounded undo/redo, format key **`Ctrl+F`** (pretty-print 2 spaces; invalid JSON refused with parse error). Desired column kept across shorter lines.
- Paste: normalise `\r\n`/`\r` to `\n`, strip other control chars, insert as ONE undoable edit; use bracketed paste if Ink 7 exposes it, else treat a multi-char `input` as paste.
- Leaving (`Esc`) with invalid JSON: stay in the editor, show `(line L, column C) reason`, move cursor to the error position, keep previous valid body. Valid → replaces body as today; empty → current cancel behaviour (6.8).
- Raw editor owns all keys (incl. `Ctrl+←/→`, `Ctrl+N/P`, `Ctrl+R`); tab keys are restored on leave.
- Declare keys in `footer-contexts.ts` (`routes-body-raw`) and `?` help (UX-DR7). Keys the terminal cannot report (verify `Ctrl+Home/End`, `Shift+arrows`, `PgUp/PgDn` under Ink 7) get a documented fallback in the spec's Design Notes.

**Ask First:** New dependency; changing the single-line text-input API.

**Never:** No new logic in `routes-zone.tsx`; no change to the tree editor or scalar editors; no kitty-protocol opt-in.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Indent | `Enter` after `{` at indent 2 | new line at indent 4 | N/A |
| Column memory | `↓` from col 20 onto a 5-char line, then `↓` | col 5, then col 20 again | N/A |
| Select+replace | `Shift+→`×3 then type `x` | selection replaced by `x` | N/A |
| Paste | 200-line payload with `\r\n` | inserted at cursor, one undo step | control chars stripped |
| Undo | `Ctrl+Z` after paste | buffer before paste | empty history → no-op |
| Format | `Ctrl+F` on `{"a":1}` | 3-line, 2-space JSON | invalid → error shown, buffer unchanged |
| Leave invalid | `Esc` on `{"a":` | stays, error with line/col, cursor at error | previous body preserved |
| Long line | 300-char line, caret at end | caret visible via horizontal scroll | N/A |

</frozen-after-approval>

## Code Map

- `src/adapters/driving/tui/shared/components/inputs/text-edit.ts` -- single-line model; read-only reference for key typing (`TextEditKey` lacks pageUp/pageDown/shift handling).
- `src/adapters/driving/tui/shared/components/json-tree/json-tree.tsx` l.134 -- current `JsonRawEditor` (props `input,error,maxVisibleRows`); rewrite to render the new model.
- `src/adapters/driving/tui/shared/components/json-tree/body-edit-path.ts` l.368 -- `parseRawJsonBuffer` (line/column/position) reused for leave + format.
- `src/adapters/driving/tui/zones/routes/hooks/use-routes-body-editor.ts` l.135-188 -- `leaveRawEditor`, `open-raw`; adapt to the new state shape and cursor jump.
- `src/adapters/driving/tui/zones/routes/hooks/use-routes-state.ts` l.98 -- `rawEditor` state type; reset sites `use-routes-effects.ts` l.88, `use-routes-pane-actions.ts` l.71.
- `src/adapters/driving/tui/zones/routes/keys/routes-zone.pane-keys.ts` l.20-40 -- raw branch; delegate to a new `keys/routes-zone.raw-keys.ts` (functional `setRawEditor` updater).
- `src/adapters/driving/tui/zones/routes/panes/routes-zone.nodes.tsx` l.13 -- mounts `JsonRawEditor` with `bodyTotalBudget`.
- `src/adapters/driving/tui/shared/components/lists/bounded-list.tsx` -- windowing; PgUp/PgDn step = line budget.
- `src/adapters/driving/tui/keybindings/footer-contexts.ts` l.301 (`routes-body-raw`), `keybindings/keybindings.ts` ~l.280 -- hints/help.
- Tests: `json-tree.test.tsx` l.277, `scenarios/routes-zone.json-tree.test.tsx` l.444-619 (invalid stays open, valid clears errors, empty cancel) must keep passing.

## Tasks & Acceptance

**Execution:**
- [ ] `shared/components/inputs/multiline-edit.ts` + `.test.ts` -- pure model: movement (char/line/word/page/doc, desired column), selection, edits, indent rules, paste normalisation, undo/redo (bounded), format helper
- [ ] `json-tree/json-tree.tsx` + test -- new `JsonRawEditor`: numbered lines, selection, caret, horizontal scroll, `Ln/Col` status, error line
- [ ] `zones/routes/keys/routes-zone.raw-keys.ts` + test -- key table → model ops, Ctrl+F format, Esc leave
- [ ] `use-routes-state.ts`, `use-routes-body-editor.ts`, `routes-zone.pane-keys.ts`, `routes-zone.nodes.tsx` -- minimal wiring; error → cursor jump
- [ ] `footer-contexts.ts`, `keybindings.ts` (+ tests) -- raw-mode hints and help
- [ ] `scenarios/routes-zone.raw-editor.test.tsx` -- scenario covering the I/O matrix through the zone

**Acceptance Criteria:**
- Given raw mode, when rendered, then lines are numbered, windowed, with a visible caret and `Ln/Col`.
- Given the key table above, when pressed, then the cursor/selection/edits behave as in a standard editor.
- Given invalid JSON, when leaving, then the editor stays at the error position with the previous body intact.
- Given raw mode active, when `Ctrl+←/→` pressed, then they move by word; after leaving, they switch sub-tabs again.
- Given a bracketed or multi-char paste, then it is one edit and never interpreted as key presses.

## Spec Change Log

## Design Notes

Model shape: `{ lines: string[]; cursor: {line,col}; anchor: {line,col}|null; wantCol: number; undo: Snapshot[]; redo: Snapshot[] }`; every op is `(state, …) => state`. Paste/typing bursts are coalesced via a functional updater because several keypresses can arrive before a re-render. `Ctrl+A` is select-all, so there is no readline line-start alias (`Home` covers it). `Ctrl+F` was chosen as format: unused in Routes, not an XOFF key.

## Verification

**Commands:**
- `npx tsc --noEmit` -- expected: no errors
- `npx vitest run` -- expected: all green
- `npm run lint` -- expected: clean
