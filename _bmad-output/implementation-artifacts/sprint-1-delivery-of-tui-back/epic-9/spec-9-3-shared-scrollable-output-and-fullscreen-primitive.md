---
title: 'Shared Scrollable Output & Fullscreen Primitive'
type: 'refactor'
created: '2026-11-04'
status: 'done'
baseline_commit: 'be56215fee1075a14c5cbe5e098eff6757aa77a2'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-9-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The scroll offset, row-cost windowing, wrap toggle and fullscreen frame live inside the Logs zone (`logs-zone.logic.ts`, duplicated JSX in `logs-pane-view.tsx` and `fullscreen-pane.tsx`), so the upcoming Terminal view (Story 9.4) would have to copy them or import from another zone.

**Approach:** Move the pure scroll/wrap/window helpers into an Ink-free `tui/shared/scrollable-output/` module and the measured, windowed line renderer plus the fullscreen frame into `tui/shared/components/`, then rewire Logs (and Update's existing cross-zone import) onto them with zero behaviour change.

## Boundaries & Constraints

**Always:** Logs renders byte-identical frames and handles keys identically; every existing Logs/Update test passes unmodified (old Logs export names stay re-exported from `logs-zone.logic.ts`). The primitive is generic over the line type (formatter + colour callbacks), bounded in both axes (AD-19): measured viewport, `truncate-end` or row-cost-aware `wrap`, only windowed `.map`. No new dependency.

**Ask First:** Any change that alters a Logs snapshot/frame, a key binding, or the store shape.

**Never:** Terminal-specific features (prompt, history, cancel); moving Logs' filter/visibility/health logic; moving fullscreen open/close state out of the store; dialog/zone registry entries (the primitive is neither a dialog nor a zone).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Tail, truncate | 500 lines, offset 0, wrap off | last N lines fill the measured height, one row each | N/A |
| Scrolled, wrap | offset 10, wrap on, long lines | window ends 10 lines from tail, sized by wrapped row cost | N/A |
| Oversized line | one line wider than budget×width, wrap on | that line still renders (clipped), never a blank viewport | N/A |
| Empty | 0 lines | placeholder node rendered, no lines | N/A |
| Tiny terminal | MIN_TERMINAL size, 5000-char lines | no frame line exceeds columns, no overflow past rows | N/A |

</frozen-after-approval>

## Code Map

- `src/adapters/driving/tui/zones/logs/logs-zone.logic.ts` -- source of `adjustScrollOffset`(~290), `isAtOldestLine`, `resolvePaneScrollDirection`(~323), `resolveFullscreenScrollDirection`(~338), wrap helpers `DEFAULT_PANE_WRAP`/`isPaneWrapped`/`togglePaneWrapFlag`/`toggleAllPanesWrapFlag`(~467-482), `sliceVisibleWindow`(~717), `computeLineRowCount`(~748, uses `wrap-ansi`). Keep log-specific (`resolvePostLoadScrollOffset`, filters, `formatLogLine`) here.
- `src/adapters/driving/tui/zones/logs/logs-pane-view.tsx` / `fullscreen-pane.tsx` -- both duplicate: `useElementSize` measure → rowBudget/width fallback → `sliceVisibleWindow` with `computeLineRowCount` → `windowLines.map(<Text color stderr? error : text, wrap>)`; plus empty-state `StateLine`s. Fullscreen outer Box: column, flexGrow 1, minHeight 0, overflow hidden, `paddingX={spacing['pane-padding-x']}`.
- `src/adapters/driving/tui/zones/update/update-zone.logic.ts:19` -- imports `computeLineRowCount`/`sliceVisibleWindow` from logs; repoint to shared.
- `src/adapters/driving/tui/shared/input-history/` -- precedent for a pure shared module with `index.ts`.
- `src/adapters/driving/tui/shared/components/index.ts` -- barrel; add new exports.
- `src/adapters/driving/tui/shared/bounds/bounded-rendering.guard.test.ts` -- static guard; `window*`/`visible*` receivers count as bounded.
- `src/adapters/driving/tui/shared/test-support/matrix.ts` -- `MATRIX_SIZES`, `frameLines` for the bounds test; `dialog-registry.tsx` exports `LONG_TEXT`.

## Tasks & Acceptance

**Execution:**
- [x] `src/adapters/driving/tui/shared/scrollable-output/scroll-window.ts` (+ `index.ts`, `scroll-window.test.ts`) -- move the pure helpers listed above, renaming wrap helpers generically (`isWrapped`, `toggleWrapFlag`, `toggleAllWrapFlags`, `DEFAULT_WRAP`, keyed by any string) and keeping scroll names; unit-test I/O matrix rows 1-3 plus offset clamping -- one Ink-free home for Logs and Terminal.
- [x] `src/adapters/driving/tui/zones/logs/logs-zone.logic.ts` -- delete moved bodies, re-export them under their existing names (aliases for the wrap helpers) -- keeps Logs tests and callers untouched.
- [x] `src/adapters/driving/tui/shared/components/scrollable-output.tsx` -- `ScrollableOutput<T>` props: `lines`, `offset`, `wrap`, `fallbackRows`, `fallbackWidth`, `format(line)→string`, `color(line)→string`, `placeholder?: ReactNode`; owns measurement, windowing and line rendering exactly as the two Logs views do today -- single renderer.
- [x] `src/adapters/driving/tui/shared/components/fullscreen-frame.tsx` -- `FullscreenFrame({ children })` with the fullscreen outer Box props -- shared fullscreen container.
- [x] `src/adapters/driving/tui/shared/components/index.ts` -- export both components.
- [x] `src/adapters/driving/tui/zones/logs/logs-pane-view.tsx`, `fullscreen-pane.tsx` -- replace the duplicated measure/window/map block with `ScrollableOutput` (empty-state `StateLine` passed as `placeholder`, shown only when `!pane?.streamError`), wrap fullscreen in `FullscreenFrame`.
- [x] `src/adapters/driving/tui/zones/update/update-zone.logic.ts` -- import from `shared/scrollable-output/index.js`.
- [x] `src/adapters/driving/tui/shared/components/scrollable-output.test.tsx` -- render tests for matrix rows 1, 2, 4 and a bounds test at every `MATRIX_SIZES` entry with 5000 `LONG_TEXT` lines, wrap on and off.

**Acceptance Criteria:**
- Given the refactor, when `npm test` runs, then every pre-existing Logs, Update and bounds test passes without edits to those test files.
- Given `src/adapters/driving/tui/zones/logs/`, when grepped, then neither view contains `sliceVisibleWindow`, `computeLineRowCount` or `useElementSize`.
- Given `npm run typecheck && npm run depcheck`, then both pass with no new dependency in `package.json`.

## Design Notes

`ScrollableOutput` keeps the content Box exactly as today (`ref`, column, flexGrow 1, minHeight 0, minWidth 0) — the measured height drives the row budget, `fallbackRows`/`fallbackWidth` are only the first-frame estimate. Placeholder rendering is the caller's decision (it passes `null` when an error annotation already explains the emptiness).

```tsx
<ScrollableOutput lines={lines} offset={pane?.scrollOffset ?? 0} wrap={wrapLines}
  fallbackRows={visibleLines} fallbackWidth={contentWidth}
  format={(l) => formatLogLine(l, visibility.showTimestamps)}
  color={(l) => (l.stream === 'stderr' ? colors.error : colors.text)}
  placeholder={pane?.streamError ? null : emptyState} />
```

## Verification

**Commands:**
- `npm test` -- expected: all green, including `bounded-rendering.guard.test.ts` and `bounds-*.test.tsx`.
- `npm run typecheck && npm run depcheck` -- expected: no errors.
- `git diff be56215f --stat -- '*.test.ts' '*.test.tsx'` -- expected: only new test files.

## Suggested Review Order

**Shared primitive (entry point)**

- The single windowed renderer Logs and the future Terminal both use.
  [`scrollable-output.tsx:26`](../../src/adapters/driving/tui/shared/components/scrollable-output.tsx#L26)

- Row cost only computed under wrap; self-clipping content box.
  [`scrollable-output.tsx:31`](../../src/adapters/driving/tui/shared/components/scrollable-output.tsx#L31)

- Fullscreen container extracted verbatim from the Logs fullscreen pane.
  [`fullscreen-frame.tsx:10`](../../src/adapters/driving/tui/shared/components/fullscreen-frame.tsx#L10)

**Pure scroll/wrap math**

- Row-cost windowing, now clamping negative offsets.
  [`scroll-window.ts:73`](../../src/adapters/driving/tui/shared/scrollable-output/scroll-window.ts#L73)

- Wrap-ansi row count matching Ink's own wrap.
  [`scroll-window.ts:99`](../../src/adapters/driving/tui/shared/scrollable-output/scroll-window.ts#L99)

- Generic per-key wrap flags replacing per-pane helpers.
  [`scroll-window.ts:55`](../../src/adapters/driving/tui/shared/scrollable-output/scroll-window.ts#L55)

**Logs and Update rewiring**

- Old Logs names re-exported so callers and tests stay untouched.
  [`logs-zone.logic.ts:287`](../../src/adapters/driving/tui/zones/logs/logs-zone.logic.ts#L287)

- Grid pane delegates measure/window/render; placeholder chosen by caller.
  [`logs-pane-view.tsx:103`](../../src/adapters/driving/tui/zones/logs/logs-pane-view.tsx#L103)

- Fullscreen pane wrapped in FullscreenFrame plus ScrollableOutput.
  [`fullscreen-pane.tsx:64`](../../src/adapters/driving/tui/zones/logs/fullscreen-pane.tsx#L64)

- Update zone stops importing from another zone.
  [`update-zone.logic.ts:19`](../../src/adapters/driving/tui/zones/update/update-zone.logic.ts#L19)

**Tests**

- Logs views: scroll offset, timestamps, stream-error and filtered empty states.
  [`logs-pane-views.test.tsx:60`](../../src/adapters/driving/tui/zones/logs/logs-pane-views.test.tsx#L60)

- Component matrix rows plus bounds at every MATRIX_SIZES entry.
  [`scrollable-output.test.tsx:32`](../../src/adapters/driving/tui/shared/components/scrollable-output.test.tsx#L32)

- Pure helper unit tests.
  [`scroll-window.test.ts:18`](../../src/adapters/driving/tui/shared/scrollable-output/scroll-window.test.ts#L18)
