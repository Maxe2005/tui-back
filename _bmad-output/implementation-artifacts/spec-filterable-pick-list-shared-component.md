---
title: 'Shared filterable pick list — unify the EDT quick-pick and the update-service pick'
type: 'refactor'
created: '2026-09-30'
status: 'in-review'
baseline_commit: 'f4f3984921285b84c2d51507f8ffebbe969560fe'
review_loop_iteration: 0
context: [_bmad-output/implementation-artifacts/epic-2/epic-2-context.md, _bmad-output/implementation-artifacts/epic-3-context.md]
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Stories 2.30 (EDT quick-pick) and 3.11 (update-service pick) each built their own "filter field + navigable list + Enter selects + Esc cancels" dialog on diverged epics. They now coexist with different filter semantics, text editing, Home/End meaning, row rendering and scrolling — two behaviors for one interaction, and two places to fix every bug.

**Approach:** Add one shared filterable pick list (pure key reducer + render-only view) under `shared/components/`, then turn both dialogs into thin consumers that only supply their candidates and what Enter does with the chosen one. The unified behavior takes the best of each side: substring filter, caret-editable filter field, bounded scrolling list.

## Boundaries & Constraints

**Always:** One implementation of filtering, highlight movement and filter-text editing — neither zone keeps its own copy. Filter is a case-insensitive substring match on the trimmed query, over each candidate's label and its optional secondary text (the repo path for services; topic only for EDTs). Filter text is edited through the shared `nextTextInputValue` and rendered by `TextInputLine` (no forked text logic, no hand-drawn caret). Rows render through `ListRow` inside `BoundedList`. Every keystroke behavior is a standalone pure function unit-tested directly, with no component-owned `useInput`. What each dialog does on Enter/Esc is unchanged: EDT pick opens the same pre-targeted switch/modify/delete dialog and keeps its per-mode candidate pool; service pick opens the 3.7 config pre-scoped to the chosen service. Relative imports end in `.js`; core untouched (AD-1).

**Ask First:** Making the visible row count a user setting rather than one shared constant; any change to where the service pick's candidates live (they stay in the update slice); any behavior change not listed in the matrix below.

**Never:** No adoption in `branch-picker.tsx`'s `FilterableBranchList` (follow-up adoption spec, same two-step split as the branch-autocomplete component). No cursor-by-identity re-anchoring for live-reordering lists (stays in the deferred-work ledger as a codebase-wide item). No change to the command bar's own `typeCommandQueryChar`/`backspaceCommandQuery` (the service pick just stops borrowing them). No change to `runCommand`, the command registry, or the store's pick-opening guards and generation counter.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Filter as you type | candidates `[alpha-api, beta-api]`, type `api` | Both rows listed (substring, not prefix); highlight resets to the first row | Zero matches: "no match" line, Enter is a no-op |
| Secondary text match | service `gateway` at `/repos/edge/gateway`, type `edge` | Row still listed (path matches) | N/A |
| Navigate | `↓`/`↑` | Highlight moves, clamped at both ends; list scrolls to keep it visible | Empty list: highlight stays 0 |
| Caret editing | `←`/`→`/`Home`/`End`/`Backspace`/`Delete`/typing | Caret moves and edits inside the filter text; a pure caret move keeps the highlight, only a text change resets it | Ctrl/Meta combos inert |
| Select | `Enter` on a highlighted row | Host receives the chosen candidate and runs its own follow-up | N/A |
| Cancel | `Esc` | Host closes the dialog with nothing opened | N/A |
| Long list | more candidates than the row budget | `▲ more above` / `▼ more below` indicators, highlight always visible | N/A |
| Genuinely empty pool | pool is empty before any filtering (e.g. `edt-switch` with a single, active EDT) | A distinct "nothing to select" line, not the filtered-to-zero wording | Enter is a no-op, Esc closes |

</frozen-after-approval>

## Code Map

- `src/adapters/driving/tui/zones/edts/dialogs/quick-pick-dialog.tsx` -- story 2.30's pick: `matchEdtsByPrefix` (prefix), `createQuickPickDialogHandlers` (pure handler), `QuickPickDialogView` (unbounded hand-drawn rows). Keeps `resolveQuickPickCandidates` and the Enter → dialog mapping; the rest moves to the shared component.
- `src/adapters/driving/tui/zones/edts/edts-zone.logic.ts:896-930` -- `QuickPickDialogState` (`query`/`queryCursor`/`cursor`) and `initialQuickPickDialog`; should embed the shared state rather than redeclare it.
- `src/adapters/driving/tui/zones/edts/edts-zone.tsx:445-487,707,756,1043` -- opens the pick per mode, routes keys to the handler, renders the view.
- `src/adapters/driving/tui/zones/update/update-zone.tsx:373-377,457-466,583-627,743-746,881-901` -- story 3.11's pick: local `pickFilter`/`pickCursor`, ~45 lines of key handling inside the zone's `useInput`, inline `ModalDialog` with a hand-drawn `█` caret.
- `src/adapters/driving/tui/zones/update/update-zone.logic.ts:119-131` -- `matchServicesBySubstring` (the substring-over-name-or-path convention the shared filter generalizes).
- `src/adapters/driving/tui/store/slices/update-slice.ts:131-142,745-800` -- `updateServicePick` candidates + open/close guards; unchanged.
- `src/adapters/driving/tui/shared/components/text-edit.ts:40`, `text-input-line.tsx`, `bounded-list.tsx:151`, `list-row.tsx`, `modal-dialog.tsx` -- the existing primitives to compose; `index.ts` is the barrel to extend.
- `src/adapters/driving/tui/shared/components/branch-autocomplete-input.tsx` -- precedent for the reducer + render-only split and its test layout.

## Tasks & Acceptance

**Execution:**
- [x] `src/adapters/driving/tui/shared/components/filterable-pick-list.tsx` (+ `.test.tsx`, barrel export) -- new shared generic state, substring matcher, pure key reducer emitting `update | select | cancel`, and render-only view; unit tests cover every matrix row -- the single implementation both dialogs reuse.
- [x] `src/adapters/driving/tui/zones/edts/dialogs/quick-pick-dialog.tsx` + `edts-zone.logic.ts` + `edts-zone.tsx` -- rebuild the EDT pick on the shared component; drop `matchEdtsByPrefix` and the hand-drawn rows -- removes duplicate #1.
- [x] `src/adapters/driving/tui/zones/update/update-service-pick-dialog.tsx` (new) + `update-zone.tsx` + `update-zone.logic.ts` -- rebuild the service pick on the shared component; pull its key handling out of the zone's `useInput`; drop `matchServicesBySubstring` and the command-bar text helpers import -- removes duplicate #2.
- [x] `edts-zone.test.tsx`, `edts-zone.interaction.test.tsx`, `update-zone.test.tsx`, `update-zone.interaction.test.tsx` -- re-point tests at the shared behavior; rewrite the ones pinning the retired behaviors (prefix-only EDT filter, Home/End jumping the service list, append-only service filter) -- the suite must assert the unified contract.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- close the 3.11 "two parallel implementations" entry and the 2.30 "identical empty wording" entry; add the `FilterableBranchList` adoption as a new deferred item -- ledger matches reality.

**Acceptance Criteria:**
- Given `:edt-switch`, `:edt-modify`, `:edt-delete` or `:update-service` run with no argument, when the pick opens, then all four show the same filter field, row style, scrolling indicators and hint line.
- Given either pick, when the same keys are pressed, then filtering, highlight movement and caret editing behave identically.
- Given the refactor is complete, when searching the TUI adapter, then no filter-match function or pick key handling remains in `zones/edts` or `zones/update`.
- Given an EDT or service chosen in the pick, when Enter is pressed, then the dialog that opens next is the same one as before the refactor.

## Spec Change Log

## Design Notes

Three user-visible behavior changes are intended and approved — everything else is behavior-preserving:

1. EDT pick: prefix → substring filter (typing `api` now finds `billing-api`).
2. Service pick: Home/End move the caret in the filter text instead of jumping to the first/last row; the filter becomes caret-editable.
3. EDT pick: long lists scroll inside a bounded window instead of growing the dialog; a genuinely empty pool gets its own wording.

The hosts stay in charge of state placement: the EDT zone keeps the pick inside its `EdtDialogState` union, the Update zone keeps candidates in the store and the filter/highlight local. The shared component only defines the state shape and the transitions, so neither host has to migrate its storage.

Both hosts pass the same row budget (today's service-pick value, 8) from one shared constant.

## Verification

**Commands:**
- `npm test && npm run typecheck && npm run depcheck` -- expected: all green (AGENTS.md order).

**Manual checks (if no CLI):**
- Run the TUI, open each of the four no-argument commands, and confirm the dialogs look and respond the same.
