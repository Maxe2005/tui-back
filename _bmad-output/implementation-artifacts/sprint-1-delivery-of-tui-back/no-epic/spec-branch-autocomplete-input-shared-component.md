---
title: 'Branch autocomplete input component plus row-count setting'
type: 'feature'
created: '2026-09-23'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'c9c47aeca1a955bde327a627cbf0d0890ec8f92a'
context: [_bmad-output/implementation-artifacts/epic-2/epic-2-context.md]
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** No shared input exists for choosing an existing git branch: every branch field is blind free text with no filtered proposal and no live validity signal.

**Approach:** Add one shared `BranchAutocompleteInput` (text field + bounded substring-filtered dropdown + exact-match validity signal) plus a new `edts.branchDropdownMaxRows` setting driving the visible row count. No call-site adoption in this spec — that is the follow-up adoption spec.

## Boundaries & Constraints

**Always:** Core never imports from adapters (AD-1); relative imports end in `.js` with imports-first-in-file; every keystroke behavior is a standalone pure function, unit-tested directly, with no component-owned `useInput`; status is never color-alone — glyph always paired (UX-DR26); text editing reuses the shared `nextTextInputValue` interpreter (no forked text logic); settings fallback convention holds (corrupt yaml = every default + field-naming warning, never a crash).

**Ask First:** If the dropdown needs anything beyond a `maxRows`-capped slice with a `… N more` overflow line (e.g. scrolling window, bounded-list reuse); if validity should compare anything but the trimmed text case-sensitively.

**Never:** No adoption in BranchPicker or update-config (follow-up spec); no git reads or writes from the component (branches arrive via props); no remote-branch listing; no change to `TextInputLine` itself; no per-service row-count override.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Filter as you type | `branches=[development, feat-x, fix-y]`, type `f` | Dropdown lists `feat-x`, `fix-y` (substring, case-insensitive), capped at `maxRows` with a `… N more` line | Zero matches: no dropdown rows, text stays editable |
| Navigate + insert | `↓`/`↑` with dropdown open, then `Enter` | `pickCursor` moves (clamped); `Enter` emits `insert` with the highlighted branch and keeps editing | Empty list: `Enter` emits `commit-through` to the parent instead |
| Text caret | `←`/`→`/`Home`/`End`/typing/`Backspace`/`Delete` | Caret moves/edits via `nextTextInputValue`; `pickCursor` resets to 0 only when the filter value actually changed | Ctrl/Meta combos stay inert |
| Exact match | Trimmed text equals a listed branch (case-sensitive) | `✔` + `colors.success` when unfocused; accent field + appended `✔` when focused | Advisory only — never blocks typing |
| No match | Trimmed text matches nothing | `✖` + `colors.error` when unfocused; accent field + appended `✖` when focused | Same — advisory only |
| Loading / error | `branchesStatus=loading/error` | `Loading branches…` / `Failed to load branches.` line, no dropdown, no validity coloring (text-dim field) | N/A |
| Setting bounds | `branchDropdownMaxRows` stepped/typed outside 1–20, or hand-edited yaml out of range | Screen clamps live; loader falls back to every default with a field-naming warning | Genuine I/O error stays an `err` Result |

</frozen-after-approval>

## Code Map

- `src/adapters/driving/tui/shared/components/text-input-line.tsx:4,28` -- `TextInputLineProps` (`label/value/cursor/focused`) and renderer the new component delegates text rendering to; untouched.
- `src/adapters/driving/tui/zones/edts/edts-zone.logic.ts:202` -- `nextTextInputValue` (single text interpreter to reuse, never reimplemented).
- `src/core/ports/settings.ts:23,64,81` -- `Settings.edts` type, `DEFAULT_SETTINGS.edts`, MIN/MAX idiom (add `branchDropdownMaxRows: 5`, `MIN/MAX_EDTS_BRANCH_DROPDOWN_MAX_ROWS = 1/20`).
- `src/adapters/driven/settings/schema.ts:35,66` -- `edts` zod block and the additive `optional().default()` numeric-field idiom to mirror (per the `hiddenActionTypes` lesson).
- `src/adapters/driving/tui/shared/settings-screen.tsx:219,223,557` -- EDTs group model (`SettingsGroupId`/`SETTINGS_GROUPS`) gaining a `branch-dropdown-rows` group with the clamp/adjust/parse-digit idiom and single-field `updateSettings({ edts: {...} })` calls.
- `src/adapters/driving/tui/store/slices/settings-slice.ts:19,78` -- `SettingsUpdate` shallow-merge already covers the new field; no change expected.

## Tasks & Acceptance

**Execution:**
- [x] `src/core/ports/settings.ts` -- add `edts.branchDropdownMaxRows` + default 5 + MIN/MAX 1/20 -- single source of truth for schema and screen.
- [x] `src/adapters/driven/settings/schema.ts` (+ `index.test.ts`) -- additive zod field via `optional().default()`, whole-file fallback on out-of-range -- corrupt yaml never blocks.
- [x] `src/adapters/driving/tui/shared/settings-screen.tsx` (+ `.test.tsx`) -- third EDTs group with clamp/adjust/digit idiom, live-persist via `updateSettings` -- mirrors existing groups.
- [x] `src/adapters/driving/tui/shared/components/branch-autocomplete-input.tsx` (+ `.test.tsx`) -- new shared pure reducer (`matchBranchesBySubstring`, `createBranchAutocompleteState`, `handleBranchAutocompleteKey` emitting `update | insert | commit-through`) + render-only component (delegates text to `TextInputLine`, caps dropdown at `maxRows`, `✔`/`✖` validity per the matrix) -- the single implementation adoptees reuse.

**Acceptance Criteria:**
- Given characters typed in the field, when branches are loaded, then at most `maxRows` substring-matched branches show below with a `… N more` overflow line when truncated.
- Given an open dropdown, when `↓`/`↑` then `Enter` is pressed, then an `insert` step carries the highlighted branch and editing continues; with zero matches `Enter` is a `commit-through`.
- Given text exactly matching a listed branch vs matching none, when rendered unfocused, then it shows `✔` in success color vs `✖` in error color; when focused the accent treatment stays with the same glyph appended.
- Given `edts.branchDropdownMaxRows` changed in `:settings`, when the dropdown renders, then it caps at the new value immediately with no restart.

## Spec Change Log

## Design Notes

The reducer never commits by itself: the first `Enter` on a non-empty list is always `insert`, so host dialogs keep their own commit semantics (a second `Enter` commits). `Left`/`Right` never touch the highlight; `Up`/`Down` never touch the caret. Filtering is case-insensitive substring; validity compares the trimmed text case-sensitively (git branch names are case-sensitive).

Idempotent-submit note: the shared reducer always emits `insert`, even when the filter already equals the highlighted branch — an insert there is a character-identical no-op. Hosts map that no-op insert straight onto their existing commit path (typing an exact name + `Enter` submits immediately) rather than forcing a literate-but-pointless second `Enter`. The navigated flow (filter differs from highlight) always stays two-step: insert first, commit next.

## Verification

**Commands:**
- `npm test && npm run typecheck && npm run depcheck` -- expected: all green (AGENTS.md order).

## Suggested Review Order

**Shared reducer (start here)**

- Single reducer owning text, highlight and insert/commit-through steps
  [`branch-autocomplete-input.tsx:108`](../../src/adapters/driving/tui/shared/components/branch-autocomplete-input.tsx#L108)

- Trimmed substring filter plus exact-match validity pairing
  [`branch-autocomplete-input.tsx:50`](../../src/adapters/driving/tui/shared/components/branch-autocomplete-input.tsx#L50)

- Bounded dropdown slice with overflow count, no scrolling window
  [`branch-autocomplete-input.tsx:82`](../../src/adapters/driving/tui/shared/components/branch-autocomplete-input.tsx#L82)

**Leaf text interpreter**

- Moved verbatim from edts-zone.logic to break the import cycle
  [`text-edit.ts:40`](../../src/adapters/driving/tui/shared/components/text-edit.ts#L40)

**Row-count setting**

- New field, default 5, range constants 1–20
  [`settings.ts:32`](../../src/core/ports/settings.ts#L32)

- Additive zod field preserving pre-existing yaml customizations
  [`schema.ts:55`](../../src/adapters/driven/settings/schema.ts#L55)

- Third EDTs group reusing the clamp/adjust/digit idiom
  [`settings-screen.tsx:604`](../../src/adapters/driving/tui/shared/settings-screen.tsx#L604)

**Peripherals**

- Reducer matrix plus render smoke for cap, overflow and glyphs
  [`branch-autocomplete-input.test.tsx:1`](../../src/adapters/driving/tui/shared/components/branch-autocomplete-input.test.tsx#L1)

- Predated-file defaulting and out-of-range fallback pins
  [`index.test.ts:29`](../../src/adapters/driven/settings/index.test.ts#L29)
