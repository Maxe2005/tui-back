---
title: 'Split EdtsZone into Hooks and Subcomponents'
type: 'refactor'
created: '2026-11-18'
status: 'done'
baseline_commit: 'f97cf59f66775ba26e3ab25b699f3e752732c0f9'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/sprint-2-refonte-fichiers-volumineux/epic-12-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `edts-zone.tsx` is a single 1043-line component (~36 store selectors, 5 `useState`, 15 effects, 7 dialog handler factories, a ~120-line `useInput` and the full render) mixing data loading, input handling and panels.

**Approach:** Move code verbatim into layered hooks, a dialog-seed helper, a key dispatcher and render subcomponents, following the story 12.10 pattern. `EdtsZone` keeps its path and export and only composes them. Hook call order, effect order and Ink input priority stay identical.

## Boundaries & Constraints

**Always:** Behaviour-preserving. `edts-zone.tsx` still exports `EdtsZone` with the same props (`useStore`, `initialPaneFocus`, `initialDialogKind`). The 15 effects keep their original relative order (split in two contiguous hooks). Handler factories are plain functions called before the effects (no side effects). `useInput` registration stays in the dispatcher hook called last; subcomponents never call `useInput`. One responsibility + header comment per file, each under ~400 lines. No import cycle. Gates before every commit: `npm test && npm run typecheck && npm run depcheck` (known `app-shell` `:reset` failure aside).

**Ask First:** Any need to change a test file, a store key, a footer context id or a rendered string.

**Never:** Edit any test file, rename store actions/keys, reorder key-handler branches, alter `setDialog` timing.

</frozen-after-approval>

## Code Map

All in `src/adapters/driving/tui/zones/edts/`.

- `edts-zone.dialog-seed.ts` -- `seedDialog(initialDialogKind, useStore)`: the test-only initial `useState` initializer (L185-269).
- `use-edts-state.ts` -- store selectors (L112-161) + `useState`s (paneFocus, 3 cursors, dialog).
- `use-edts-derived.ts` -- rows, issues summary/severity, clamped cursors, partition, window-size row budgets, `dialogOpen`, loading flags.
- `edts-zone.ctx.ts` -- `EdtsZoneCtx` flat context type.
- `use-edts-handlers.ts` -- `createEdtsHandlers`: switch/create/modify/service-actions/add-to-edt/delete/quick-pick factories + `openEdtAction`.
- `use-edts-effects.ts` -- effects L163-475 in order (mount load, cursor reset, footer, auto-open create, input-captured, branch picker, command dialogs, action log).
- `use-edts-dialog-effects.ts` -- effects L484-718 (restart report, switch resolution, decisions, pending lists, cancel, delete statuses).
- `use-edts-input.ts` -- `useZoneInputActive` + `useInput` dispatcher (dialog kinds first, then pane keys).
- `edts-list-column.tsx` -- left column render (EDTS + nested services ZoneLayouts).
- `edts-detail-column.tsx` -- right column (DetailPane per focused pane).
- `edts-dialog-views.tsx` -- dialog-kind → view switch.
- `edts-zone.tsx` -- composer.

## Tasks & Acceptance

**Execution:**
- [x] Create the modules above and reduce `edts-zone.tsx` to the composer (single refactor commit; intermediate states would not typecheck).

**Acceptance Criteria:**
- Given the split, when `edts-zone.test.tsx`, `edts-zone.interaction.test.tsx` and the other edts tests run unchanged, then they pass; full suite, typecheck and depcheck green.
- No produced file exceeds 400 lines.

## Verification

**Commands:**
- `npx vitest run --configLoader runner && npm run typecheck && npm run depcheck` -- expected: only the known `:reset` failure.

## Review Notes

Three layers ran (blind, edge-case, verification-gap). Applied: dedented the JSX of the two column components, fixed three comments made stale by the move. Rejected/out of scope (verbatim-move refactor): ctx collision guards, memoization, effect-dep cleanups, seed/if-chain dedup, extra unit tests, command-action cascade extraction. Handlers are rebuilt in the same render the effects run, so closure semantics are unchanged. Gates: edts tests 447/447; full suite only the known `:reset` failure; typecheck and depcheck green.
