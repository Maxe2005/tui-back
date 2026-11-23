---
title: 'Favorites Pane Above the Routes List & Add-to-Favorites Key'
type: 'feature'
created: '2026-11-23'
status: 'in-progress'
baseline_commit: 'c1cab3ff91b9c3abaa5bfaf99fef4407d3532ff6'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/sprint-1-delivery-of-tui-back/epic-6-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 6.11 persists favorite routes per EDT, but the Routes zone cannot show or toggle them, so usual routes still require searching.

**Approach:** Add a bounded Favorites pane above the routes list, a `*` toggle key (list and open route), pane focus via Tab, and footer/help hints. Pure cursor/focus logic in a new `.logic.ts`; the zone only wires it; the store slice gains `favoriteRoutes` + `toggleFavoriteRoute` on the 6.11 use-cases.

## Boundaries & Constraints

**Always:** Favorite identity = `(routesRepoPath, METHOD, path)`; only favorites of the displayed repo are listed. Pane bounded and scrollable (`BoundedList`, AD-19); the list keeps a minimum height on small terminals. `Enter` on a favorite selects it in the list (clearing the filter if it hides it) and calls `openPaneForRoute` (Request step, never fires). Stale favorites: dim + `stale` suffix, `Enter` refused with a message, removable. Without `deps` the slice degrades (`store-not-wired`), never throws. Touch `routes-zone.tsx` minimally (Epic 12 large-file list).

**Ask First:** Any change to core use-cases or `edts.yaml` shape (6.11 is frozen); any new store dependency.

**Never:** No Recent section / `Ctrl+R` (6.13). No firing from favorites. No new dependency. `*` must not fire while any overlay, the filter, or a pane inline editor has input.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Toggle from list | list focus, `*` on route | favorite toggled, pane updates at once | store failure → notice, state unchanged |
| Toggle open route | right pane focus (not in editor), `*` | open route toggled | N/A |
| Inline editor | filter / name prompt / field editor, `*` | types `*` | N/A |
| Empty | no favorites | teaching line "press `*` on a route to add it" | N/A |
| Pane focus | `Tab`/`Shift+Tab` from list | focus list ↔ pane; arrows/`j`/`k` move; `Esc` back | N/A |
| Remove | pane focus, `*` or `d` | favorite removed | N/A |
| Stale | favorite not rescanned | dim `stale`; `Enter` refused | message, no pane open |
| EDT change | active EDT switches | pane shows new EDT's favorites | N/A |
| Other repo | favorite repo ≠ displayed repo | not listed | N/A |
| Small terminal | few rows | pane height capped, list keeps min rows | N/A |

</frozen-after-approval>

## Code Map

- `src/adapters/driving/tui/store/slices/workspace/routes-slice.ts` -- `RoutesSlice` (l.65), `refreshSavedRequests` (l.413) as the precedent: add `favoriteRoutes`, `refreshFavoriteRoutes`, `toggleFavoriteRoute`; call `listFavoriteRoutes({edtRegistry,state,manifest,scanner},{})` / `toggleFavoriteRoute`; degrade when deps missing; refresh after EDT change in `loadRoutes`.
- `src/core/insight/routes/favorites.ts` -- 6.11 use-cases (read-only reuse).
- `src/adapters/driving/tui/zones/routes/routes-zone.tsx` -- compose pane above the list (l.~97-113 footer selection); `RoutesZoneCtx` in `routes-zone.ctx.ts`.
- `zones/routes/panes/routes-list-pane.tsx` -- list area (`listAreaRef` box, budget measured); render Favorites pane above it with capped height; `routes-zone.constants.ts` for height cap/min list rows.
- `zones/routes/panes/routes-favorites-pane.tsx` (new) -- `BoundedList` + `ListRow`, `StateLine`/`DimAnnotation`.
- `zones/routes/logic/routes-favorites.logic.ts` (+ `.test.ts`, new) -- pure: visible favorites (repo filter), cursor move/clamp, `isFavorite`, row label, pane height budget, resolve favorite → route index.
- `zones/routes/keys/routes-zone.list-keys.ts` -- `*` and Tab in `handleListKey`; new `routes-zone.favorites-keys.ts` for pane keys; `routes-zone.pane-keys.ts` -- `*` when not in inline editor.
- `zones/routes/hooks/use-routes-input.ts` (dispatch order l.~), `use-routes-effects.ts` (refresh), `use-routes-pane-actions.ts` `openPaneForRoute` (l.99).
- Store `routesPaneFocus` 'list'|'detail' → add 'favorites'.
- `keybindings/footer-contexts.ts` (l.241-246) + `routesFooterContext` in `logic/routes-zone.logic.ts` (l.140) -- add `* favorite` to `routes-list`/`routes-list-editable`/pane contexts, new `routes-favorites` context; `keybindings.ts` rows.
- Tests: `routes-slice.test.ts`; scenario `zones/routes/scenarios/routes-zone.favorites.test.tsx` using `routes-zone.test-support.tsx` + fake ports.

## Tasks & Acceptance

**Execution:**
- [ ] `routes-slice.ts` + test -- favorites state/actions, degrade path -- AC toggle/EDT change
- [ ] `routes-favorites.logic.ts` + test -- pure logic -- AC pane keys/stale/repo filter/budget
- [ ] `routes-favorites-pane.tsx`, `routes-list-pane.tsx`, `routes-zone.tsx`, constants -- render pane, minimal wiring -- AC render/empty/small terminal
- [ ] key handlers, `use-routes-input.ts`, `use-routes-pane-actions.ts` -- `*`, Tab, Enter, d, Esc -- AC key behavior
- [ ] `footer-contexts.ts`, `routes-zone.logic.ts`, `keybindings.ts` + tests -- hints (UX-DR7)
- [ ] scenario test -- matrix end-to-end

**Acceptance Criteria:**
- Given the Routes zone, when it renders, then a Favorites pane sits above the list showing `METHOD path` + summary, with a teaching line when empty and a guaranteed minimum list height.
- Given any focus in list or right pane outside inline editors, when `*` is pressed, then the relevant route is toggled and the pane updates immediately.
- Given the pane has focus, when `Enter` is pressed on a non-stale favorite, then the route is selected and the right pane opens on Request without firing.
- Given footer and `?` help, when focus is list/pane/right pane, then `* favorite` and the pane's keys are shown.

## Spec Change Log

## Verification

**Commands:**
- `npx tsc --noEmit` -- expected: no errors
- `npx vitest run` -- expected: all green
- `npm run lint` -- expected: clean (if defined)
