---
title: 'TextInputLine — Cursor Navigation & App-Wide Adoption'
type: 'feature'
created: '2026-09-17'
status: 'done'
review_loop_iteration: 0
context: []
baseline_commit: '9e9ca44da5eee409e46fbc94f9c0419ff0bc7b0a'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `TextInputLine`/`nextTextInputValue` only support append-at-end/truncate-at-end editing — Left/Right/Home/End are silent no-ops — so fixing a typo mid-string in an EDT topic or branch name means clearing and retyping the whole field.

**Approach:** Extend `nextTextInputValue` and `TextInputLine` to a `{ value, cursor }` shape with real navigation and positional insert/delete; thread a paired cursor field through every EDT-zone dialog field driving a `TextInputLine`; extend `branch-picker.tsx`'s parallel local reimplementation identically (stays un-imported, per its import-cycle constraint). Migrating `command-bar.tsx`/`repo-registry-screen.tsx` is deferred (`deferred-work.md`), per the story's own sequencing note.

## Boundaries & Constraints

**Always:**
- Left/Right/Home/End move `cursor` clamped to `[0, value.length]`; typed input inserts at `cursor`; Backspace/Delete remove before/after `cursor`; all other keys unchanged.
- `TextInputLine` gains `cursor: number` defaulting to `value.length` — callers that omit it render unchanged.
- Every bare-string field driving a `TextInputLine` gains a sibling cursor field, mirroring the existing `branchNamesTouched` paired-map convention.
- `branch-picker.tsx`'s local `applyTextInput`/`TextEditKey` stays non-imported but gains identical cursor behavior in place.
- New cursor names must not collide with existing `cursor` row-selection fields: `ServiceActionsDialogState.cursor`, `BranchPickerState.pickCursor`.
- Programmatic value overwrites (prefill, picker retry/reseed) reset cursor to `value.length`.

**Ask First:** none identified.

**Never:** change Enter/Escape/Tab/vertical-arrow semantics or submit/validation flow; import `branch-picker.tsx` back into `edts-zone.logic.ts`; touch `command-bar.tsx`/`repo-registry-screen.tsx` or `label` (deferred).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output | Error Handling |
|----------|--------------|------------------|----------------|
| Mid-string insert | `{value:"abd",cursor:2}`, type `"c"` | `{value:"abcd",cursor:3}` | N/A |
| Backspace | `{value:"abcd",cursor:2}`, Backspace | `{value:"acd",cursor:1}` | `cursor:0` → no-op |
| Delete | `{value:"abcd",cursor:2}`, Delete | `{value:"abd",cursor:2}` | `cursor:len` → no-op |
| Left/Right clamp | `{value:"ab",cursor:0}`, Left | `cursor:0` | Right at `len` no-op |
| Home/End | `{value:"abcd",cursor:2}` | `cursor:0` / `cursor:4` | N/A |
| No `cursor` prop | `<TextInputLine value="abc" />` | glyph after last char (today's look) | N/A |

</frozen-after-approval>

## Code Map

- `src/adapters/driving/tui/shared/components/text-input-line.tsx` -- `TextInputLineProps`(L4)/`resolveTextInputLineLayout`(L15)/`TextInputLine`(L23): add `cursor?: number` (default `value.length`), split render into pre/cursor-char/post spans, replacing the always-trailing inverse space (L26-36). `label` stays required.
- `src/adapters/driving/tui/zones/edts/edts-zone.logic.ts` -- `TextEditKey`(L173-187) shape unchanged; `nextTextInputValue`(L189-212) retarget to `(current: {value,cursor}, input, key) => {value,cursor}`; `CreateDialogState`(L752-791) add `topicCursor`, `branchNameCursor`, `branchNameCursors: Record<string,number>` (mirrors `branchNamesTouched` L790); `ModifyDialogState`(L818-835) add `topicCursor`; initializers L893-919/L925-940 seed at `value.length`.
- `create-dialog.tsx` -- L284/296/452 `nextTextInputValue` calls (branchName grouped/individual, topic); L513/518-524/530 renders pass matching cursor.
- `modify-dialog.tsx` -- L341 call (topic), L386 render passes `topicCursor`.
- `branch-picker.tsx` -- local `TextEditKey`(L123-137)/`applyTextInput`(L139-162) extended in place, same shape (import-cycle comment L119-122 stays valid, no import of `nextTextInputValue`); `BranchPickerState`(L61-79) add `baseBranchCursor`, `nameValueCursor`, `pickQueryCursor`; `BranchPickerRenameSub`(L55-59) add `cursor`; `createBranchPickerState()`(L81-101)/`applyBranchPickerRetry()`(L105-117) seed/reset at `value.length`; calls L228-279/281-329/331-341; renders L405/414/436/441/450-454 pass matching cursor.
- Tests: `text-input-line.test.tsx`, `text-input-line.styles.test.tsx`, `edts-zone.test.tsx` (L457-490 + dialog dispatch coverage), `branch-picker.test.tsx`.

## Tasks & Acceptance

**Execution:**
- [x] `text-input-line.tsx` -- add `cursor?: number` (default `value.length`), render glyph at position -- closes AC 2
- [x] `edts-zone.logic.ts` -- retarget `nextTextInputValue` to `{value,cursor}`, add cursor fields to `CreateDialogState`/`ModifyDialogState` + initializers -- closes AC 1/3
- [x] `create-dialog.tsx`, `modify-dialog.tsx` -- thread cursor fields through call sites/renders
- [x] `branch-picker.tsx` -- extend local `applyTextInput`/`TextEditKey` and `BranchPickerState`/`BranchPickerRenameSub` with parallel cursor support
- [x] Update the four listed test files for the `{value,cursor}` shape and mid-string placement

**Acceptance Criteria:**
- Given any EDT-zone/branch-picker `TextInputLine` field, when Left/Right/Home/End/Backspace/Delete/typed-char fire, then cursor moves/edits per the I/O matrix, other keys unchanged.
- Given a caller omitting `cursor`, when it renders, then it's identical to today.
- `npm test`, `npm run typecheck`, `npm run depcheck` pass.

## Spec Change Log

## Verification

**Commands:**
- `npm test`, `npm run typecheck`, `npm run depcheck` -- all clean, incl. updated `text-input-line.*`, `edts-zone.test.tsx`, `branch-picker.test.tsx`

**Manual checks:**
- TUI: in Create/Modify EDT's topic/branch-name field and any `BranchPicker` field, type, move Left/Right/Home/End, edit mid-string -- cursor tracks, edits land there.

## Suggested Review Order

**Cursor primitive**

- Entry point: the shared `{value, cursor}` render contract every field below now speaks.
  [`text-input-line.tsx:28`](../../../src/adapters/driving/tui/shared/components/text-input-line.tsx#L28)

- New optional prop, defaults to `value.length` so omitting callers stay visually unchanged.
  [`text-input-line.tsx:12`](../../../src/adapters/driving/tui/shared/components/text-input-line.tsx#L12)

**Cursor-aware key interpreter (EDT-zone)**

- Retargeted from bare-string to `{value, cursor}`; Left/Right/Home/End now move the cursor.
  [`edts-zone.logic.ts:201`](../../../src/adapters/driving/tui/zones/edts/edts-zone.logic.ts#L201)

- Ctrl/Meta checked first so those combos stay fully inert (review fix — was ordered after the arrow/edit branches).
  [`edts-zone.logic.ts:207`](../../../src/adapters/driving/tui/zones/edts/edts-zone.logic.ts#L207)

- New paired-cursor fields on `CreateDialogState`/`ModifyDialogState`, mirroring `branchNamesTouched`'s map convention.
  [`edts-zone.logic.ts:822`](../../../src/adapters/driving/tui/zones/edts/edts-zone.logic.ts#L822)

**Parallel reimplementation (branch-picker, import-cycle constrained)**

- Same retargeting as `nextTextInputValue`, kept local/non-imported by design.
  [`branch-picker.tsx:163`](../../../src/adapters/driving/tui/shared/components/branch-picker.tsx#L163)

- Same Ctrl/Meta-first fix as the EDT-zone copy — both duplicated functions had the identical bug.
  [`branch-picker.tsx:168`](../../../src/adapters/driving/tui/shared/components/branch-picker.tsx#L168)

- Row-selection `pickCursor` no longer resets on a pure text-caret move (review fix).
  [`branch-picker.tsx:394`](../../../src/adapters/driving/tui/shared/components/branch-picker.tsx#L394)

- Three new per-field cursor fields on `BranchPickerState`, named to avoid colliding with the existing row-selection `pickCursor`.
  [`branch-picker.tsx:70`](../../../src/adapters/driving/tui/shared/components/branch-picker.tsx#L70)

**Dialog wiring**

- `withPrefillCursors` keeps a field's cursor at `value.length` after a programmatic topic-driven overwrite, rebuilt fresh each time (no stale per-path entries — review fix).
  [`create-dialog.tsx:66`](../../../src/adapters/driving/tui/zones/edts/dialogs/create-dialog.tsx#L66)

- Grouped branch-name field's key dispatch, now cursor-aware; touched-flag only flips on a real value change, never a cursor-only move.
  [`create-dialog.tsx:314`](../../../src/adapters/driving/tui/zones/edts/dialogs/create-dialog.tsx#L314)

- Individual (per-member) branch-name field's key dispatch, same touched-flag discipline.
  [`create-dialog.tsx:336`](../../../src/adapters/driving/tui/zones/edts/dialogs/create-dialog.tsx#L336)

- Topic field's key dispatch, Create dialog.
  [`create-dialog.tsx:499`](../../../src/adapters/driving/tui/zones/edts/dialogs/create-dialog.tsx#L499)

- Topic field's key dispatch, Modify dialog — structurally identical to Create's.
  [`modify-dialog.tsx:345`](../../../src/adapters/driving/tui/zones/edts/dialogs/modify-dialog.tsx#L345)

**Tests**

- Regression test proving a cursor-only move never marks a branch-name field touched (closes a review-found verification gap).
  [`edts-zone.interaction.test.tsx:711`](../../../src/adapters/driving/tui/zones/edts/edts-zone.interaction.test.tsx#L711)

- `nextTextInputValue`'s full I/O-matrix coverage, `{value, cursor}` shape.
  [`edts-zone.test.tsx:457`](../../../src/adapters/driving/tui/zones/edts/edts-zone.test.tsx#L457)

- Branch-picker cursor navigation + the strengthened Left/Right assertions (review fix).
  [`branch-picker.test.tsx:56`](../../../src/adapters/driving/tui/shared/components/branch-picker.test.tsx#L56)

- `TextInputLine` cursor placement/default-omitted-prop coverage.
  [`text-input-line.test.tsx:61`](../../../src/adapters/driving/tui/shared/components/text-input-line.test.tsx#L61)

- ANSI-precise inverse-glyph-position assertions.
  [`text-input-line.styles.test.tsx:34`](../../../src/adapters/driving/tui/shared/components/text-input-line.styles.test.tsx#L34)
