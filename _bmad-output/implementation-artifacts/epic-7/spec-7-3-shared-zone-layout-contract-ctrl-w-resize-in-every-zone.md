---
title: 'Story 7.3: Shared zone layout contract & Ctrl+W resize in every zone (UX-DR35)'
type: 'feature'
created: '2026-10-07'
status: 'in-review'
baseline_commit: '13edecf001e8efcfc57272f292e12ad8db1b4eeb'
review_loop_iteration: 0
context:
  - '{project-root}/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Only the EDTs zone supports `Ctrl+W` resize; Routes and Update hand-wire a `ListDetailSplit`, EDTs hand-builds two extra horizontal splitters, Logs has a fixed 32-col list column, and Dashboard/shared-types render a placeholder split that never recolors. Boundary orientation and default ratios are hardcoded (`isVerticalResizeBoundary`, `emptyRatios` special-casing `edts`).

**Approach:** One declarative per-zone layout spec (boundaries: orientation, default ratio, min, max) drives a shared `ZoneLayout` that renders panes and `Splitter`s, recolors the targeted boundary from the store, and feeds resize-mode, ratio defaults/validation and footer advertising. Every zone builds its split through it; `Ctrl+W` works in any zone with ≥1 boundary.

## Boundaries & Constraints

**Always:** Spec is the single source of boundary count/orientation/min/max/default (not the persisted array length). Persistence keeps the existing state-port shape (`splitterRatios: {zoneId: number[]}`); a persisted array of the wrong length for a zone → that zone's defaults, never a crash. EDTs keeps 3 boundaries, same defaults (0.4 each), same behavior and persisted data. Logs wrap-all moves to `W` (Shift+w), updated in footer hints, `?` help and Logs hint list; bare `w` unchanged. Core never imports TUI; AD-17 comment rule (no story/AC refs in `src/`, tests included); imports first; conventional commits with `(story 7.3)` on this story branch, atomic; verify with `npm test && npm run typecheck && npm run depcheck`.

**Ask First:** Any change to the state-port or persisted file shape.

**Never:** Fill the Dashboard's real content (7.5 does; here it keeps today's placeholder under a placeholder pane spec); add drag/mouse resize; change shared-focus navigation (7.7) or other keys (7.4); leave a hand-rolled split in any zone.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Enter resize | `Ctrl+W`, any zone with ≥1 boundary, no overlay | resize-mode on boundary 0, that boundary recolored | N/A |
| Zone without boundary | `Ctrl+W`, zone spec has 0 boundaries | no-op; footer omits `^W resize` | N/A |
| Cycle / move | `Tab`; arrows | Tab cycles the zone's boundaries; arrows move per boundary orientation, clamped to its min/max | N/A |
| Exit | `Enter` / `Esc` | resize-mode off; ratio persisted | write failure keeps live ratio |
| Restart | persisted array wrong length for zone | that zone uses spec defaults | no crash, other zones unaffected |
| Logs wrap all | `W` in Logs grid | toggles wrap on all panes; `Ctrl+W` now enters resize | fullscreen: `W` no-op as before |
| EDTs | 3 boundaries | identical behavior and persisted ratios | N/A |

</frozen-after-approval>

## Code Map

- `src/adapters/driving/tui/shared/components/list-detail-split.tsx` -- current 2-pane vertical split, clamp/default constants; fold into `ZoneLayout` (keep `resolveSplitFlex`/clamp semantics, now per-boundary min/max).
- `src/adapters/driving/tui/shared/components/splitter.tsx` -- dumb glyph with `targeted`; reused as-is.
- `src/adapters/driving/tui/shared/components/zone-placeholder.tsx` -- Dashboard/shared-types placeholder split; becomes a `ZoneLayout` consumer (reads `resizeMode`).
- `src/adapters/driving/tui/zones/zones.ts` -- `ZONES`; home for (or neighbor of) the per-zone layout specs.
- `src/adapters/driving/tui/store/slices/navigation-slice.ts:12-175` -- `emptyRatios` (edts special-case), `setSplitterRatio` (clamp), `loadSplitterRatios` (length check), `enterResizeMode`/`cycleResizeTargetBoundary`; derive from specs.
- `src/adapters/driving/tui/app-shell.tsx:83-124,273-300` -- `shouldEnterResizeMode` (drop `activeZone==='edts'`, require boundary count ≥1), `isVerticalResizeBoundary`/`resolveResizeStep` (use spec orientation), footer render (`:401`).
- `src/adapters/driving/tui/shared/components/footer.tsx:12` -- static `^W resize`; make zone-aware.
- `src/adapters/driving/tui/zones/edts/edts-zone.tsx:110,811-913` -- boundary 0 + two hand-built horizontal splitters; migrate to 3-boundary spec.
- `src/adapters/driving/tui/zones/{update/update-zone.tsx:373,785,routes/routes-zone.tsx:107,1422}` -- pass-through `listSplitterTargeted` → `ZoneLayout`.
- `src/adapters/driving/tui/zones/logs/{logs-zone.tsx,logs-zone.logic.ts:115,353-364,logs-grid.tsx}` -- fixed `LIST_COLUMN_WIDTH=32` → one vertical boundary (list vs grid); `isWrapAllLogsKey` → `W`; fullscreen no-op branch `:517-521`; hint list `:840-860`.
- `src/adapters/driving/tui/keybindings/keybindings.ts:35-48` -- `Ctrl+W` help text, add Logs `W` entry if lists apply.
- Tests to update: `app-shell.test.tsx:246-310` (non-EDTs false case), `app-shell.interaction.test.tsx:2008` (dashboard no-op case), `keybindings.test.ts:18`, `logs-zone.logic.test.ts:~362`, logs interaction/hint tests, `app-store.test.ts:147,1401`, `edts-zone.styles/layout.test.tsx`, `list-detail-split.layout.test.tsx`.

## Tasks & Acceptance

**Execution:**
- [ ] `src/adapters/driving/tui/shared/components/zone-layout.tsx` (+ spec type/registry, tests) -- `ZoneLayout` + declarative boundary spec, per-boundary orientation/default/min/max, targeted recoloring from store -- the shared primitive.
- [ ] `navigation-slice.ts` (+ `app-store.test.ts`) -- defaults, clamp, wrong-length fallback and Tab cycling derived from specs -- one source of truth.
- [ ] `app-shell.tsx`, `footer.tsx` (+ tests) -- generalized resize entry/step, zone-aware footer hint -- `Ctrl+W` everywhere it applies.
- [ ] EDTs, Update, Routes, Dashboard (placeholder spec), shared-types zones -- build splits through `ZoneLayout` -- no hand-rolled split left.
- [ ] Logs zone + keybindings/help (+ tests) -- list/grid boundary via `ZoneLayout`, wrap-all on `W` -- frees `Ctrl+W`.

**Acceptance Criteria:**
- Given any zone with a boundary and no overlay, when `Ctrl+W` is pressed, then resize-mode engages on boundary 0 and Tab/arrows/Enter/Esc behave as in the EDTs zone today.
- Given ratios moved in any zone, when the app restarts, then they are restored per zone; wrong-length arrays fall back to that zone's defaults.
- Given the EDTs zone, when migrated, then behavior and persisted ratios are unchanged.
- Given Logs, when `W` is pressed in the grid, then all panes' wrap toggles, and the footer, `?` help and Logs hints show `W`, not `Ctrl+W`.
- Given a grep of `src/`, then no zone renders `Splitter` outside `ZoneLayout`.

## Spec Change Log

## Design Notes

```ts
type BoundarySpec = { orientation: 'vertical' | 'horizontal'; defaultRatio: number; min: number; max: number };
type ZoneLayoutSpec = { boundaries: readonly BoundarySpec[] };
```
Boundary count 0 = single-pane zone (contract supports it; Ctrl+W no-op, no footer hint). Dashboard and shared-types keep their placeholder split (1 boundary) until 7.5. Logs: one vertical boundary between the list column and the pane grid; default ratio ≈ today's 32 cols on a typical width. `W` chosen over `Ctrl+T`: no ctrl-byte quirks, mirrors `R`, no collision with existing Logs/global keys.

## Verification

**Commands:**
- `npm test` -- expected: all pass
- `npm run typecheck` -- expected: clean
- `npm run depcheck` -- expected: clean
