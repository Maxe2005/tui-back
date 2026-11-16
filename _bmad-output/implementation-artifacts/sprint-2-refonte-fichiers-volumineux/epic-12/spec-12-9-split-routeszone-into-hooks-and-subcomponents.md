---
title: 'Split RoutesZone into Hooks and Subcomponents'
type: 'refactor'
created: '2026-11-16'
status: 'in-review'
baseline_commit: 'c5c52fbacd45442cb735717ae3477431468ad2a6'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/sprint-2-refonte-fichiers-volumineux/epic-12-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `routes-zone.tsx` is a single 1935-line component (store selectors, ~25 `useState`, 6 effects, tree/editor/save/picker actions and a ~620-line `useInput` handler) mixing every concern of the Routes zone.

**Approach:** Move code verbatim into named hooks (layered, each taking the layers before it) and per-mode key handlers, and the render into subcomponents. `RoutesZone` keeps its path and exports and only composes them. Hook call order and effect order stay identical.

## Boundaries & Constraints

**Always:** Behaviour-preserving. `routes-zone.tsx` still exports `RoutesZone` and `formatRoutesDisabledMessage`. Hooks are called in the same relative order (state → derived → tree/editor/pane actions → effects → `useZoneInputActive` → `useInput`); the effects keep their original declaration order inside one `useRoutesEffects`. The `useInput` registration stays last in `RoutesZone`; no new subcomponent calls `useInput`. One responsibility + header comment per file, each under ~400 lines (justify exceptions). No import cycle (hooks never import key handlers). Gates before every commit: `npm test && npm run typecheck && npm run depcheck`.

**Ask First:** Any need to change a test file, a store key, a footer context id or a rendered string.

**Never:** Edit any test file, rename store actions/keys, reorder key-handler branches (Ink input priority), or alter `set`/`get` call timing.

</frozen-after-approval>

## Code Map

All in `src/adapters/driving/tui/zones/routes/`. Original line ranges of `routes-zone.tsx` in brackets.

- `routes-zone.ctx.ts` -- `RoutesZoneCtx` type (intersection of every hook layer's return type).
- `use-routes-state.ts` -- store selectors, `useState`s, element sizes, `paneFocused` [127-219].
- `use-routes-derived.ts` -- visible routes, pane route/draft, saved items, response-tree and editor-tree memos, viewports [233-277, 318-394].
- `use-routes-response-tree.ts` -- response tree amend/frame helpers + `applyTreeAction` / `applyTreePanelAction` [396-419, 871-991].
- `use-routes-body-editor.ts` -- body editor plumbing, scalar/add/raw confirms, `applyEditorTreeAction` / `applyEditorPanelAction` [421-456, 570-869].
- `use-routes-pane-actions.ts` -- save prompt, picker open, pane transients, open/close/fire pane, row confirms [279-316, 458-568].
- `use-routes-effects.ts` -- captured-input effects + the 6 lifecycle effects [220-231, 993-1063].
- `routes-zone.overlay-keys.ts` -- overwrite/delete confirms, save prompt, saved picker key handlers [1070-1232].
- `routes-zone.pane-keys.ts` -- focused-pane dispatcher: sub-editors, Ctrl+R, tab nav, `s` [1261-1375].
- `routes-zone.saved-tab-keys.ts`, `routes-zone.request-keys.ts`, `routes-zone.response-keys.ts` -- per-tab key handlers [1376-1635].
- `routes-zone.list-keys.ts` -- filter-editing and list-focused key handlers [1233-1257, 1637-1682].
- `use-routes-input.ts` -- `useZoneInputActive` + `useInput` dispatcher in the original priority order.
- `routes-zone.states.tsx` -- disabled / notice screen shells [1687-1734].
- `routes-list-pane.tsx`, `routes-detail-pane.tsx`, `routes-zone.nodes.tsx`, `routes-modals.tsx` -- list pane, right pane, body/response nodes, modal dialogs [1767-1932].
- `routes-zone.tsx` -- composes the above; keeps footer-context computation and early returns.

## Tasks & Acceptance

**Execution:**
- [x] state + derived hooks + ctx type -- commit `refactor(routes-zone): extract state and derived hooks (story 12.9)`
- [x] tree, editor and pane-action hooks -- commit `refactor(routes-zone): extract tree, editor and pane-action hooks (story 12.9)`
- [x] effects hook + key handlers + input hook -- commit `refactor(routes-zone): extract effects and per-mode key handlers (story 12.9)`
- [x] render subcomponents -- commit `refactor(routes-zone): extract list, detail, modal and state views (story 12.9)`

**Acceptance Criteria:**
- Given the split, when `routes-zone.test.tsx`, `routes-zone.interaction.test.tsx` and the full suite run unchanged, then they pass (modulo the known `app-shell` `:reset` failure) and typecheck + depcheck are green.
- Given `routes-zone.tsx`, then it still exports `RoutesZone` and `formatRoutesDisabledMessage`, and no produced file exceeds ~400 lines without justification.

## Design Notes

Hooks share state through one context object built each render (`{ useStore, ...state, ...derived, ... }`), so every moved block keeps its original identifiers via a top-of-function destructure. Key handlers are plain functions `(ctx, input, key)` called by the dispatcher under the original `if` order; narrowed overlay values are passed as parameters.

## Verification

**Commands:**
- `npx vitest run --configLoader runner && npm run typecheck && npm run depcheck` -- expected: green (modulo the known `:reset` failure)
