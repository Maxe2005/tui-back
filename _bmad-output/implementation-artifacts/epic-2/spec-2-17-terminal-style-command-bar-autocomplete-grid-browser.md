---
title: 'Terminal-Style Command Bar Autocomplete & Grid Browser'
type: 'feature'
created: '2026-08-26'
status: 'done'
baseline_commit: '6b7730e3176444b3a12a395c2d58357e2eeb2784'
review_loop_iteration: 0
context:
  - '_bmad-output/planning-artifacts/epics.md'
  - '_bmad-output/implementation-artifacts/epic-2/spec-2-14-command-entry-bar-registered-commands.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The `:` command bar (Story 2.14) shows every registered command the moment it opens, which won't scale as the registry grows and doesn't match the Tab-completion behavior the rest of the tool's terminal-like interactions already promise.

**Approach:** Rework the bar to shell-style Tab-completion — nothing shown on open, common-prefix completion on Tab, a double-Tab-triggered arrow-navigable multi-column grid for browsing all matches — superseding Story 2.14's "full list shown on open" behavior.

## Boundaries & Constraints

**Always:**
- Command bar opens with an empty, focused input and renders no list/grid until `Tab` is pressed (removes the current unconditional `matches.map(...)` render in `command-bar.tsx`).
- `Tab` on empty input shows the full grid immediately (no double-press needed, nothing to complete).
- `Tab` on non-empty input: 1 match completes to full name (existing `resolveTabAutocomplete`, unchanged); 2+ matches with a longer shared prefix complete to that `longestCommonPrefix`; 2+ matches already sitting at that prefix set a pending `TabPressState { query, at }` (no visible change) that a second `Tab` within `TAB_DOUBLE_PRESS_WINDOW_MS` (500ms, named constant) — same query, no intervening key — resolves into showing the grid; any other key, an elapsed window, or a changed query discards the pending state.
- Grid layout is column-major, ≤`COMMAND_GRID_MAX_ROWS` rows/column (named constant), column width = its longest label; when total width exceeds available width (`useWindowSize().columns`), only whole columns that fit render, with a `…` marker on whichever edge(s) hide columns.
- Grid keyboard model: `Down` from input → grid, top of first column (no-op if grid hidden); `Up`/`Down` moves within a column, clamped to its row count; `Left`/`Right` moves to the adjacent column, same row index clamped to that column's length, scrolling the visible window by one column at a hidden-column edge; `Up` at row 0 → back to input; `Enter` on a cell completes to that name and returns to input; any printable character returns to input, appends it, and resets grid state; `Esc` closes the whole bar from either focus state.
- Input changes (typed or deleted) while the grid is visible re-filter it live from the current match set, hiding it again once only one match remains.
- New pure functions (`longestCommonPrefix`, `TabPressState` resolution, `layoutCommandGrid(matches, maxRows, availableWidth) → { columns, truncated, scrollOffset }`) live in `command-bar.tsx` and are unit-tested directly in `command-bar.test.tsx`, mirroring `resolveTabAutocomplete`'s existing convention — no Ink mounting.
- Grid focus (`focus: 'input' | 'grid'`, `gridCursor: { column, row }`) is local `CommandBar` state (`useState`), never the Zustand store — mirrors `edts-zone.tsx`'s local `paneFocus`/`dialog` pattern; `commandBarOpen` stays the only store-visible bit, so `app-shell.tsx`'s gating is untouched.
- Grid cells render as plain `<Text>` — accent + `›` on the highlighted cell, text-dim otherwise (`colors.accent`/`colors['text-dim']` from `theme.ts`) — not `ListRow` (full-row background fill, built for a single vertical list, not a compact cell).

**Ask First:**
- Backspace while grid focus is active isn't covered by the ACs (only "any printable character" is specified to return focus to input). Recommendation: treat it the same as typing — return focus to input, then apply the backspace — since that reading fits the live-refilter AC's "typing or backspacing" phrasing and keeps a single exit path from the grid instead of two inconsistent ones.

**Never:**
- Don't touch `commands.ts`'s registry shape or `app-shell.tsx`'s `commandBarOpen`/`zoneInputCaptured` wiring — this story is internal to `CommandBar`.
- Don't wire `COMMAND_GRID_MAX_ROWS` to a settings value — it stays a plain top-level constant (mirrors `ORPHAN_STALE_AGE_MS`'s colocated-constant pattern); Story 2.19 is what later makes it settings-overridable.
- Don't add a description field to `Command` — grid cells show only the registered `name`.
- Don't add scrolling/virtualization beyond the grid's own column-window scroll — no vertical scroll within a column.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Tab, empty input | `query=''` | grid shown immediately, all commands | N/A |
| Tab, 1 match | `query='reg'`, 1 match | completes to full name (unchanged) | N/A |
| Tab, 2+ matches, longer common prefix | `query='e'`, matches `edt-create/edt-switch/edt-modify` | completes to `'edt-'` | N/A |
| Tab at maximal prefix (1st press) | `query='edt-'`, 3 matches | no visible change; `TabPressState` set | N/A |
| Tab at maximal prefix (2nd press, same query, within window) | pending state present | grid shown with the 3 matches | N/A |
| 2nd Tab after window elapses / other key first / query changed | pending state present | pending state discarded, sequence restarts | N/A |
| Grid wider than terminal | matches exceed `availableWidth` | only whole fitting columns render + `…` on hidden edge(s) | N/A |
| `Right` at rightmost visible, truncated column | grid visible, cursor at edge | window scrolls right one column, `…` re-evaluated per edge | N/A |
| Typing while grid visible | any printable key | focus → input, char appended, grid state reset | N/A |
| Input change while grid visible, now 1 match | backspace/type narrows to 1 match | grid hides (falls back to no-list state) | N/A |
| `Esc` from grid focus | grid focused | bar closes entirely, no command run | N/A |

</frozen-after-approval>

## Code Map

- `src/adapters/driving/tui/shared/command-bar.tsx` -- remove unconditional `matches.map(...)` list render (~L96-119); add `longestCommonPrefix`, `TabPressState` handling, `layoutCommandGrid`, grid render, `focus`/`gridCursor` local state, extend the single `useInput` block (L57-94) with grid-mode branches; call `useWindowSize()` for `availableWidth`
- `src/adapters/driving/tui/shared/command-bar.test.tsx` -- extend with unit tests for the new pure functions, following the existing "I/O matrix" `describe` naming convention (no Ink mounting here; keypress integration goes in `app-shell.interaction.test.tsx`)
- `src/adapters/driving/tui/commands/commands.ts` -- read-only; `matchCommands('', COMMANDS)` already returns the full list for the empty-input grid case, no change needed
- `src/adapters/driving/tui/shared/theme/theme.ts` -- read-only; reuse `colors.accent`/`colors['text-dim']` for grid cell styling
- `src/adapters/driving/tui/shared/components/list-row.tsx` -- read-only, not reused (full-width row shape unsuited to compact grid cells)
- `src/adapters/driving/tui/zones/edts/edts-zone.tsx` -- read-only reference for the local-state focus pattern (`paneFocus`/`dialog`, ~L534/536/163/165/437)
- `src/adapters/driven/lock/index.ts` -- read-only reference for the `<PURPOSE>_MS` colocated-constant naming convention (`ORPHAN_STALE_AGE_MS`, ~L32)

## Tasks & Acceptance

**Execution:**
- [x] `command-bar.tsx` -- add `TAB_DOUBLE_PRESS_WINDOW_MS`/`COMMAND_GRID_MAX_ROWS` constants, `longestCommonPrefix(matches)`, `TabPressState` type + resolution logic -- extends `resolveTabAutocomplete`'s existing common-prefix gap
- [x] `command-bar.tsx` -- add `layoutCommandGrid(matches, maxRows, availableWidth)` pure function (column-major, `…` truncation, `scrollOffset`) -- isolates layout math from rendering per file convention
- [x] `command-bar.tsx` -- add `focus`/`gridCursor` local state, grid render (`<Text>` cells), extend `useInput` for grid navigation (`Up`/`Down`/`Left`/`Right`/`Enter`/typing/`Esc`) -- wires the new pure functions into the component
- [x] `command-bar.tsx` -- gate the existing list render behind grid visibility instead of unconditional `matches` -- removes Story 2.14's "always shown" behavior
- [x] `command-bar.test.tsx` -- unit tests for `longestCommonPrefix`, `TabPressState` transitions (incl. window elapse / key-interrupt / query-change discard), `layoutCommandGrid` (fits, truncated-right, truncated-left after scroll, exact-fit boundary) -- covers the I/O matrix above

**Acceptance Criteria:**
- Given the bar just opened, when no key has been pressed, then no list/grid is shown, only the empty focused input.
- Given the grid is visible via either the empty-Tab path or the double-Tab path, when it renders, matches lay out column-major at ≤`COMMAND_GRID_MAX_ROWS` rows/column, columns sized to their longest label.
- Given focus is in the grid, when `Up`/`Down`/`Left`/`Right`/`Enter`/`Esc`/a printable key is pressed, then focus and the input update exactly as specified in Boundaries → grid keyboard model, with no case left unhandled.
- Given the input changes while the grid is visible, when re-filtered, then it never shows a stale match set and hides itself once only one match remains.

## Spec Change Log

<!-- Append-only. Populated by step-04 during review loops. -->

## Design Notes

`TabPressState` mirrors a debounce window but isn't a timer — it's a stamped-then-checked value (`{ query, at }`), read and compared against `Date.now()` on the *next* `Tab` press rather than firing on its own; no `setTimeout` needed, matching this file's existing no-side-effect style. `layoutCommandGrid`'s `scrollOffset` is state the component owns (starts at 0, moves ±1 on an edge `Left`/`Right`), passed into the pure function each render alongside `matches`/`maxRows`/`availableWidth` — the function stays a stateless projection, the component owns which slice of the projection is currently scrolled into view.

## Verification

**Commands:**
- `npm test` -- expected: all suites green, including new `command-bar.test.tsx` cases
- `npm run typecheck` -- expected: `tsc --noEmit` clean
- `npm run depcheck` -- expected: no boundary violations (touches `src/adapters/driving/tui/shared/**` only)

**Manual checks:**
- `node src/bin/tui-back.mjs` (TUI): press `:` → nothing shown → `Tab` → full grid appears → arrow around, `Enter` a cell → input completes, focus back on input
- Type a partial multi-match prefix (e.g. `e`) → `Tab` → completes to longest common prefix → `Tab` again quickly → grid of matches appears; wait >500ms, `Tab` again → nothing (sequence restarted, no stale grid)
- Resize the terminal narrow enough that the grid can't fit all columns → confirm the `…` marker and `Left`/`Right` scroll at the truncated edge

## Suggested Review Order

**Tab-completion state machine**

- Entry point: resolves a single `Tab` press into complete/show-grid/pending/noop, including the double-press-within-window detection a review fix hardened against clock skew.
  [`command-bar.tsx:112`](../../../src/adapters/driving/tui/shared/command-bar.tsx#L112)

- Longest-shared-prefix helper `resolveTabPress` delegates to.
  [`command-bar.tsx:78`](../../../src/adapters/driving/tui/shared/command-bar.tsx#L78)

**Grid layout & cursor math (pure functions)**

- Column-major layout + horizontal-scroll truncation.
  [`command-bar.tsx:180`](../../../src/adapters/driving/tui/shared/command-bar.tsx#L180)

- Vertical cursor movement, clamped within a column; `null` signals "leave to input".
  [`command-bar.tsx:263`](../../../src/adapters/driving/tui/shared/command-bar.tsx#L263)

- Horizontal cursor movement + one-column scroll at a hidden edge.
  [`command-bar.tsx:282`](../../../src/adapters/driving/tui/shared/command-bar.tsx#L282)

- Key→direction mapping, extracted during review so a swapped up/down or left/right ternary is directly unit-testable (the real 4-command registry can never span 2+ columns, so this was otherwise unreachable by any real-keypress test).
  [`command-bar.tsx:252`](../../../src/adapters/driving/tui/shared/command-bar.tsx#L252)

- Resolves the command under an absolute grid cursor.
  [`command-bar.tsx:311`](../../../src/adapters/driving/tui/shared/command-bar.tsx#L311)

**`useInput` keyboard state machine**

- Grid-visibility derivation (`gridShown && matches.length > 1`) driving the whole render.
  [`command-bar.tsx:337`](../../../src/adapters/driving/tui/shared/command-bar.tsx#L337)

- Grid-focus branch: `Up`/`Down`/`Left`/`Right`/`Enter`/backspace/`Esc`, plus a review-fix no-op guard for `Tab` (Boundaries define no case for it there).
  [`command-bar.tsx:413`](../../../src/adapters/driving/tui/shared/command-bar.tsx#L413)

- Input-focus branch: `Tab` (empty-input grid reveal / autocomplete / double-press arm), pending-state discard on any other key.
  [`command-bar.tsx:442`](../../../src/adapters/driving/tui/shared/command-bar.tsx#L442)

**Render**

- Grid cells (`…` truncation markers, no-list-on-open gating via `gridVisible`).
  [`command-bar.tsx:502`](../../../src/adapters/driving/tui/shared/command-bar.tsx#L502)

**Tests**

- Pure-function unit coverage for the full I/O matrix, plus the review-fix direction-mapping and clock-skew cases.
  [`command-bar.test.tsx:88`](../../../src/adapters/driving/tui/shared/command-bar.test.tsx#L88)
  [`command-bar.test.tsx:148`](../../../src/adapters/driving/tui/shared/command-bar.test.tsx#L148)
  [`command-bar.test.tsx:188`](../../../src/adapters/driving/tui/shared/command-bar.test.tsx#L188)

- Real-keypress end-to-end coverage: open → `Tab` → grid → arrow around → `Enter`/typing/`Esc` exits, plus the two review-fix regression tests (`Tab` no-op in grid, intervening key discards pending).
  [`app-shell.interaction.test.tsx:846`](../../../src/adapters/driving/tui/app-shell.interaction.test.tsx#L846)
  [`app-shell.interaction.test.tsx:966`](../../../src/adapters/driving/tui/app-shell.interaction.test.tsx#L966)
  [`app-shell.interaction.test.tsx:994`](../../../src/adapters/driving/tui/app-shell.interaction.test.tsx#L994)

**Out-of-scope, incidental (pre-existing, not this story's intent)**

- `footer.tsx`/`top-bar-footer-split.test.tsx`: an already-committed story 2.20 follow-up (commit `eb04578`, confirmed intentional) removing the redundant `[d/e/u/l/r/s] zone` mnemonic — bundled into this branch's history, unrelated to command-bar work.
  [`footer.tsx:4`](../../../src/adapters/driving/tui/shared/components/footer.tsx#L4)

- `tui-back.e2e.test.ts`: retargets the e2e script path from `tui-back.mjs` to `cli-back.mjs` — confirmed by the verification-gap reviewer (mutation-tested) to be a real fix for a pre-existing stale reference, not a story 2.17 concern.
  [`tui-back.e2e.test.ts:29`](../../../src/bin/tui-back.e2e.test.ts#L29)
