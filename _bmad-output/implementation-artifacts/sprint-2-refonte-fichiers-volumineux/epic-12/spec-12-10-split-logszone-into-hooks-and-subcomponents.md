---
title: 'Split LogsZone into Hooks and Subcomponents'
type: 'refactor'
created: '2026-11-16'
status: 'in-review'
baseline_commit: 'ad94fa62'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/sprint-2-refonte-fichiers-volumineux/epic-12-context.md'
---

## Intent

**Problem:** `logs-zone.tsx` was a single 1404-line component (23 hooks, filter-editor actions and a ~450-line `useInput`).

**Approach:** Code moved verbatim into layered hooks, action factories, per-mode key handlers and a service-lists subcomponent. `LogsZone` keeps its path and export and only composes them. Hook/effect order and input priority are unchanged.

## Code Map

All in `src/adapters/driving/tui/zones/logs/`.

- `use-logs-state.ts` -- store selectors, `useState`s, actions-menu seq ref.
- `use-logs-derived.ts` -- service partition, clamped cursors, active panes, dialogOpen, window layout.
- `use-logs-effects.ts` -- all lifecycle effects in original order, footer context.
- `logs-zone.pane-actions.ts` / `logs-zone.editor-actions.ts` -- scroll, actions menu, shortcuts / filter-editor transitions.
- `logs-zone.ctx.ts` -- `LogsZoneCtx` flat context type.
- `use-logs-input.ts` -- `useInput` dispatcher in the original priority order.
- `logs-zone.overlay-keys.ts`, `logs-zone.rule-list-keys.ts`, `logs-zone.rule-draft-keys.ts`, `logs-zone.list-keys.ts`, `logs-zone.pane-keys.ts` -- per-mode key handlers.
- `logs-service-lists.tsx` -- left pane render. `logs-zone.tsx` -- composer (~130 lines).

## Tasks & Acceptance

- [x] Split into the modules above (single refactor commit; intermediate states would not typecheck).

**Acceptance Criteria:**
- Given the split, when `logs-zone.test.tsx` and `logs-zone.interaction.test.tsx` run unchanged, then they pass; full suite, typecheck and depcheck green (modulo the known `app-shell` `:reset` failure).
- No produced file exceeds 400 lines (largest: 222).

## Verification

- `npx vitest run --configLoader runner && npm run typecheck && npm run depcheck` -- logs zone 298/298 passing; full suite only the known `:reset` failure.
