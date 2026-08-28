---
title: 'EDT Zone — Multi-Splitter Layout with Keyboard Resize-Mode (Ctrl+W)'
type: 'feature'
created: '2026-08-28'
status: 'done'
review_loop_iteration: 0
context: []
baseline_commit: '6bd7f00b51ff553c0995dc7398ebebe502d3f5f5'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The EDT zone's list column stacks three panes (EDT selector / EDT SERVICES / OTHER SERVICES) with no visible or movable border, and the `splitter` component's `Ctrl+W` keyboard resize-mode — documented in keybinding-help since Story 1.9/1.10 — was never implemented (flagged in `deferred-work.md` against `app-shell.tsx`'s zone-switch exclusion gate).

**Approach:** Give the EDT zone's list column 3 fixed-but-movable borders (2 between stacked panes, 1 for the existing list↔detail split), driven by per-boundary ratios in the store; add a `Ctrl+W` resize-mode (`Tab` cycles target, arrows resize, `Enter`/`Esc` exit) scoped to the EDT zone; persist ratios via `StatePort`/`state.json` across restarts.

## Boundaries & Constraints

**Always:**
- `Ctrl+W` engages resize-mode only while the EDT zone is active — a no-op elsewhere.
- Resize-mode is one store flag (`resizeMode: { zone: ZoneId; targetBoundary: number } | null`) so AppShell's global gate and EdtsZone's own `useInput` check the same source.
- Every boundary move applies live and persists immediately — no separate save step (mirrors `updateSettings`).
- `state.json` reads/writes must not clobber the sibling field — `writeActiveEdt` today overwrites the whole file with only `{ activeEdt }` (`adapters/driven/state/index.ts` L74-87); switch to read-merge-write before `splitterRatios` can coexist.
- Ratios stay clamped to `MIN_LIST_RATIO`/`MAX_LIST_RATIO` (0.2–0.8) per boundary independently, reusing `clampListRatio`.
- Corrupt/missing/shape-mismatched persisted ratios fall back to that zone's default silently (same convention as `activeEdt` ENOENT → `null`).

**Ask First:** None expected — shape and math follow existing `StatePort`/`ListDetailSplit` precedent (Design Notes). If Ink's flex layout can't support the sequential-binary-split model, halt and confirm before diverging.

**Never:** Mouse-drag resize (no Ink mouse support, `UX-DR27`); wiring resize-mode into any zone but EDTs this story; touching the EDT/OTHER SERVICES partition logic or per-service actions from 2.6/2.18.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Fresh machine | `Ctrl+W` + arrows, no `state.json` yet | Moves from built-in defaults; write creates the file with both `activeEdt: null` and `splitterRatios` | Write failure: move still applies live |
| Pre-2.21 `state.json` (`activeEdt` only) | App loads | `splitterRatios` hydrates to defaults; `activeEdt` unchanged | N/A |
| Persisted ratio array wrong length for a zone | Load | That zone falls back to its default array only | Same `state-invalid-format` path as today |
| `Ctrl+W` under any overlay, or on a non-EDTs zone | Keypress | No-op | N/A |
| App restart after a boundary move | Launch | EDT zone renders with persisted ratios | N/A |

</frozen-after-approval>

## Code Map

- `src/core/ports/state.ts` -- add `readSplitterRatios()`/`writeSplitterRatios(ratios)` to `StatePort`, alongside `readActiveEdt`/`writeActiveEdt`.
- `src/adapters/driven/state/schema.ts` -- `stateSchema` (`{ activeEdt }`, `.strict()`) gains `splitterRatios: z.record(z.string(), z.array(z.number())).optional()`.
- `src/adapters/driven/state/index.ts` -- `readActiveEdt`/`writeActiveEdt` (L36-87): factor a shared read-parse-validate + read-merge-write helper so neither field clobbers the other (fixes L81's full-file overwrite); new functions reuse the same ENOENT/invalid-JSON/invalid-format shape.
- `src/adapters/driving/tui/store/app-store.ts` -- `ZoneRatios` (L46) widens `Record<ZoneId, number>` → `Record<ZoneId, number[]>`; `emptyRatios()` (L303-307) gives every zone `[DEFAULT_LIST_RATIO]` except `edts` (3 entries); `setSplitterRatio` (L332-339) takes a `boundaryIndex` and persists via `deps.state.writeSplitterRatios`, chained like `settingsSaveChain` (L310-316/585-598); add `resizeMode` slice + `enterResizeMode`/`exitResizeMode`/`cycleResizeTargetBoundary`; add `loadSplitterRatios()` mirroring `loadSettings()` (L550-569), called once at AppShell mount.
- `src/adapters/driving/tui/shared/components/list-detail-split.tsx` -- `clampListRatio`/`resolveSplitFlex` reused per boundary, unchanged.
- `src/adapters/driving/tui/shared/components/splitter.tsx` -- always renders `colors.accent` today (L24-26); add a `targeted?: boolean` prop, default → `colors.border`, `targeted` → `colors.accent`.
- `src/adapters/driving/tui/app-shell.tsx` -- global `useInput`: detect `key.ctrl && input === 'w'` scoped to `activeZone === 'edts'` → `enterResizeMode`; while `resizeMode` set, dispatch `Tab` (cycle boundary), boundary 0 (vertical) `←`/`→`, boundaries 1-2 (horizontal) `↑`/`↓`, `Enter`/`Esc` → `exitResizeMode`; extend the L216 exclusion gate with `&& state.resizeMode === null` — the tracked `deferred-work.md` item.
- `src/adapters/driving/tui/zones/edts/edts-zone.tsx` -- list-column block (L1417-1493): 3 sub-`Box`es separated by `<Splitter orientation="horizontal">`, `flexGrow` from `splitterRatios.edts[1]`/`[2]`; outer `ratio` (L615/L1418) becomes `splitterRatios.edts[0]`; own `useInput` gate (L1410) adds `&& !resizeMode`.
- `src/adapters/driving/tui/shared/components/zone-placeholder.tsx` -- L20 `ratio` → `ratio[0]`.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- close the item at L236-239 once the gate lands.

## Tasks & Acceptance

**Execution:**
- [x] `src/core/ports/state.ts` -- extend `StatePort` -- new persistence contract (AD-7)
- [x] `src/adapters/driven/state/schema.ts` + `index.ts` -- add `splitterRatios`, fix the overwrite bug via read-merge-write -- both fields must coexist on disk
- [x] `src/adapters/driving/tui/store/app-store.ts` -- widen `ZoneRatios`, add `resizeMode` slice + `loadSplitterRatios`, persist on `setSplitterRatio` -- store-level source of truth for layout + persistence
- [x] `src/adapters/driving/tui/shared/components/splitter.tsx` -- add `targeted` prop -- makes "recolors when targeted" true instead of always-accent (also `list-detail-split.tsx` gained `listSplitterTargeted` so boundary 0, owned by `ListDetailSplit`, can recolor too — a small, deliberate divergence from the Code Map's "unchanged" note, needed to satisfy the AC)
- [x] `src/adapters/driving/tui/zones/edts/edts-zone.tsx` -- 3 bordered sub-panes, gate own input on `resizeMode` -- the AC's "4 regions, 3 boundaries"
- [x] `src/adapters/driving/tui/app-shell.tsx` -- `Ctrl+W`/`Tab`/arrow dispatch as pure, unit-tested functions alongside `resolveZoneArrowSwitch`; extend the exclusion gate -- closes the tracked deferred-work item
- [x] `src/adapters/driving/tui/shared/components/zone-placeholder.tsx` -- index `ratio[0]` -- keeps the other 5 zones unchanged
- [x] Extend `adapters/driven/state/index.test.ts`, `app-store.test.ts`, `app-shell.interaction.test.tsx`, `edts-zone.interaction.test.tsx`, `splitter.test.tsx` for the I/O matrix and new behaviors

**Acceptance Criteria:**
- Given the EDT zone, when it renders, then 4 regions show with a fixed border between each — 3 boundaries total.
- Given no dialog open, when `Ctrl+W` is pressed, then resize-mode engages, the targeted boundary recolors to accent, and same-key global shortcuts go inert.
- Given resize-mode active, when `Tab` is pressed, then the targeted boundary cycles across the 3.
- Given resize-mode active on a horizontal boundary, `↑`/`↓` moves it one clamped step; on the vertical boundary, `←`/`→` does likewise.
- Given resize-mode active, `Enter` or `Esc` exits with no separate save step.
- Given a moved boundary, after restart the EDT zone reads its ratios back from `state.json`, independent of other zones.
- `npm test`, `npm run typecheck`, `npm run depcheck` all pass.

## Spec Change Log

## Design Notes

Reuse `resolveSplitFlex`/`clampListRatio` three times rather than inventing an N-pane primitive: `splitterRatios.edts = [listDetailRatio, edtsVsRestRatio, edtServicesVsOtherRatio]` — boundary 0 splits list-column vs. detail (existing math); boundary 1 splits the list column into selector vs. rest; boundary 2 splits that rest into EDT SERVICES vs. OTHER SERVICES. A per-keypress step (e.g. `0.05`, ~12 positions across the clamp range) is an implementation choice — pick something responsive and name the constant.

## Verification

**Commands:**
- `npm test` -- all suites green, including new/updated `state`, `app-store`, `app-shell.interaction`, `edts-zone.interaction`, `splitter` tests
- `npm run typecheck` -- clean
- `npm run depcheck` -- no boundary violations

**Manual checks:**
- TUI: EDTs zone shows 3 borders; `Ctrl+W` recolors the first to accent and disables zone-switch/list-nav; `Tab` moves accent through boundaries 2 and 3; `↑`/`↓` moves a horizontal one, `←`/`→` moves the vertical one when targeted; `Esc` exits and normal keys resume; relaunch shows the moved boundaries persisted, other zones unaffected.

## Suggested Review Order

**Ctrl+W resize-mode dispatch (entry point)**

- Start here: pure, unit-tested helpers deciding when resize-mode engages/exits and which arrow moves which axis.
  [`app-shell.tsx:87`](../../../src/adapters/driving/tui/app-shell.tsx#L87)

- Where those helpers get wired into the global keypress handler, gated the same way every other overlay already is.
  [`app-shell.tsx:275`](../../../src/adapters/driving/tui/app-shell.tsx#L275)

- The tracked `deferred-work.md` gate item: `resizeMode` joins the zone-switch exclusion so arrows resize instead of switching zones.
  [`app-shell.tsx:329`](../../../src/adapters/driving/tui/app-shell.tsx#L329)

**Persistence: state.json read-merge-write + concurrency (review-fix hardened)**

- `withWriteLock` serializes the whole read-merge-write per file path — closes the cross-field write race a first review pass found.
  [`state/index.ts:58`](../../../src/adapters/driven/state/index.ts#L58)

- Shared read-parse-validate step; carries raw JSON forward so a validation failure in one field never blocks the other.
  [`state/index.ts:118`](../../../src/adapters/driven/state/index.ts#L118)

- Best-effort single-field recovery from raw JSON when the whole-file schema check fails elsewhere.
  [`state/index.ts:146`](../../../src/adapters/driven/state/index.ts#L146)

- `writeActiveEdt`: read-merge-write under the lock, now propagating a genuine I/O read error instead of silently dropping data.
  [`state/index.ts:208`](../../../src/adapters/driven/state/index.ts#L208)

- `writeSplitterRatios`: the symmetric read-merge-write for the new field.
  [`state/index.ts:238`](../../../src/adapters/driven/state/index.ts#L238)

- The optional `splitterRatios` field, kept loose (plain-string keys) so core stays TUI-agnostic.
  [`state/schema.ts:18`](../../../src/adapters/driven/state/schema.ts#L18)

**Store: ZoneRatios widening + resize-mode state**

- `resizeMode`'s shape — the single source of truth both AppShell and EdtsZone read.
  [`app-store.ts:57`](../../../src/adapters/driving/tui/store/app-store.ts#L57)

- `setSplitterRatio`: per-boundary clamp, live apply, then persists via the save chain; bumps the version guard.
  [`app-store.ts:374`](../../../src/adapters/driving/tui/store/app-store.ts#L374)

- `loadSplitterRatios`: per-zone fallback on shape mismatch, version-guarded against a load racing a live move (review fix).
  [`app-store.ts:405`](../../../src/adapters/driving/tui/store/app-store.ts#L405)

**Visual: 3-pane restructure + accent-targeting**

- The EDT zone's list column split into 3 sub-panes, each `targeted` prop wired to `resizeMode`.
  [`edts-zone.tsx:1428`](../../../src/adapters/driving/tui/zones/edts/edts-zone.tsx#L1428)
  [`edts-zone.tsx:1470`](../../../src/adapters/driving/tui/zones/edts/edts-zone.tsx#L1470)
  [`edts-zone.tsx:1511`](../../../src/adapters/driving/tui/zones/edts/edts-zone.tsx#L1511)

- `Splitter`'s default flips from always-accent to border-unless-targeted.
  [`splitter.tsx:28`](../../../src/adapters/driving/tui/shared/components/splitter.tsx#L28)

**Peripherals**

- `zone-placeholder.tsx` -- indexes `ratio[0]` now that every zone's entry is an array.
- Tests: `state/index.test.ts`, `app-store.test.ts`, `app-shell.test.tsx`, `app-shell.interaction.test.tsx`, `edts-zone.test.tsx`/`.styles.test.tsx`, `splitter.test.tsx`/`.styles.test.tsx` -- cover the I/O matrix, the ACs, and the review-fix regressions (each confirmed to fail when its fix was temporarily reverted).
