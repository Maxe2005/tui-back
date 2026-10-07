---
title: 'Routes Right Pane — Route-Scoped Saved Sub-Tab'
type: 'feature'
created: '2026-10-07'
status: 'done'
review_loop_iteration: 0
baseline_commit: '917afabe9c0611f5720796e661eca848717357fd'
context:
  - '/home/mchoisel/Documents/IANORD/tui-back-epic-6/_bmad-output/implementation-artifacts/epic-6-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A route's saved requests are only reachable through the global `s` picker (every repo, cursor-move required) — there is no at-a-glance view of what can be re-fired for *this* route.

**Approach:** Add a `Saved` sub-tab first in the strip (`Saved | Request | Response`) listing only the selected route's saved requests with a `/` filter; `Enter` loads one into the Request tab and switches to it. Never autofocused: `Enter` from the list still opens `Request`.

## Boundaries & Constraints

**Always:**
- `core/` never imports `adapters/` (AD-1); imports first, relative imports end in `.js`; pure logic in `*.logic.ts`, unit-tested.
- `ROUTES_PANE_TABS` becomes `['saved','request','response']`; the `stepTab` stepper is fully generic and needs no change. The store default, the repo-change reset and `Enter`-from-list still target `'request'`; `fireRoute` still switches to `'response'`.
- Rows are `savedRequests` filtered by `paneRouteKey` (normalized `METHOD + ' ' + path`, same equality as `resolveRouteIndex`). Route-scoped means stale and cross-repo cases cannot occur here: no stale flags, no stale blocking, no repo-mismatch error in this tab.
- The tab reuses the slice's `loadSavedRequest`/`deleteSavedRequest` and the shared `FilterablePickList` reducer + view (host-owned state, like the `s` picker). One zone-local pick state, reset on route change alongside the other pane transients.
- Keys in the tab: `/` focuses the filter (input owns every key while focused), arrows/`j`/`k` move, `Enter` loads and switches to `Request` (focus stays `detail`), `d` deletes through the existing `modal-dialog` confirm, `Esc` returns to the list, `Ctrl+←/→` switch tabs. Footer hints show only bound keys (UX-DR7).
- Empty states are distinct: cache not loaded → dim "not loaded" hint; zero rows for the route → teaching line pointing at the `s` save flow in the Request tab.
- `PANE_TAB_LABELS` gains `saved: 'Saved'`; the new view is a stateless `routes-saved-tab.tsx` following the `RoutesResponseTab` prop pattern.

**Ask First:** Any change to the `Enter`-from-list → `Request` rule or the store default tab.

**Never:** No core changes (no new use-case or port); no CLI changes; no change to the global `s` picker (it stays the cross-repo quick-pick); no stale/cross-repo handling in the tab; no autofocus change.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Open pane | `Enter` on a route with saves | strip `Saved \| Request \| Response`, active `Request` | N/A |
| Visit Saved | `Ctrl+←` from Request | Saved lists only this route's requests | N/A |
| Load | `Enter` on a row | draft+body+tree loaded, pane on Request, focus stays detail | Load error → inline error line, stay on Saved |
| Delete | `d`, confirm | record removed, row gone | Modal cancel aborts |
| Empty route | no saves for this route | teaching empty state (save via `s`) | N/A |
| Other route's saves | saved exists for route B, pane on A | B's saves not shown | N/A |
| Filter | `/`, text, no match | no-match line; `Esc` clears filter | N/A |
| Route switch | move list cursor to another route | tab filter/cursor reset | N/A |

</frozen-after-approval>

## Code Map

- `src/adapters/driving/tui/store/slices/routes-slice.ts:60` -- `RoutesPaneTab`/`ROUTES_PANE_TABS` gain `'saved'` first; default `:200` and resets stay `'request'`; reuse `loadSavedRequest:490`/`deleteSavedRequest:561`.
- `src/adapters/driving/tui/shared/keys/tab-navigation.ts:15-29` -- `resolveTabNavKey` + generic `stepTab` need no change; zone call `:1244-1253` works with the longer list.
- `src/adapters/driving/tui/zones/routes/routes-saved-tab.tsx` (new) -- stateless view mirroring `routes-response-tab.tsx:13-24`; renders `FilterablePickList` (`filterable-pick-list.tsx:134-158`) + error line; props `{items, pickState, error}`.
- `src/adapters/driving/tui/zones/routes/routes-zone.tsx:1693` -- strip render; `:1694-1721` add the `==='saved'` branch; tab-key handling `:1244-1253` is free; `Esc` unwind `:1376-1382` gains Saved → list.
- `src/adapters/driving/tui/zones/routes/routes-zone.tsx:229` -- `savedItems` construction is the reuse point: filter by `paneRouteKey:216` for tab rows (same `resolveRouteIndex` equality).
- `src/adapters/driving/tui/zones/routes/routes-zone.tsx:1570` -- hints gain the Saved-tab line (`[enter] load · [/] filter · [d] delete · [esc] list · [ctrl+←→] tab`).
- `src/adapters/driving/tui/zones/routes/routes-request-tab.tsx:25` -- `PANE_TAB_LABELS` gains `saved: 'Saved'`.
- Tests to update: `routes-slice.test.ts:227-535` (defaults, fire→response), `routes-zone.test.tsx:148-371`, `routes-zone.interaction.test.tsx:228-1294` (tab stepping `:1056-1068`), `app-shell.test.tsx:515-517` + `app-shell.interaction.test.tsx:2555` (tab mocks).

## Tasks & Acceptance

**Execution:**
- [x] `store/slices/routes-slice.ts` + test -- `'saved'` first in tab type/list, defaults/resets unchanged.
- [x] `zones/routes/routes-saved-tab.tsx` + test -- stateless Saved view (list, filter, empty/not-loaded, error line).
- [x] `zones/routes/routes-zone.tsx` + zone/interaction tests -- Saved branch, keys, filter reset on route change, hints, Esc unwind.
- [x] Order-assumption tests -- slice/zone/app-shell expectations moved to the 3-tab strip.

**Acceptance Criteria:**
- Given the pane open on a route with saved requests, when `Ctrl+←` is pressed from Request, then the Saved tab lists only that route's saved requests.
- Given a Saved row, when `Enter` is pressed, then its draft loads into the Request tab and the pane switches to Request with focus kept.
- Given `Enter` on the routes list, when a route opens, then the pane still lands on Request, never on Saved.
- Given no saved request for the route, when the Saved tab opens, then the teaching empty state shows instead of rows.

## Spec Change Log

## Design Notes

The tab model already anticipates a third entry (Story 6.4's `Logs` becomes the fourth with no further model change — `stepTab` clamps without wrapping over any list length). The global `s` picker keeps the cross-repo quick-pick role with its cursor-move + repo-mismatch guard; the tab never needs either because its rows share the pane's route by construction.

## Verification

**Commands:**
- `npm test` -- expected: Vitest green.
- `npm run typecheck` -- expected: clean.
- `npm run depcheck` -- expected: no `core → adapters` violation.

## Suggested Review Order

**Tab model (start here)**

- Saved first, defaults and resets still on Request
  [`routes-slice.ts:60`](../../../src/adapters/driving/tui/store/slices/routes-slice.ts#L60)

- Generic stepper needed no change for three tabs
  [`tab-navigation.ts:29`](../../../src/adapters/driving/tui/shared/keys/tab-navigation.ts#L29)

**Tab view and rows**

- Stateless Saved view: list, filter, empty, error line
  [`routes-saved-tab.tsx:14`](../../../src/adapters/driving/tui/zones/routes/routes-saved-tab.tsx#L14)

- Rows filtered by pane route key, no stale possible
  [`routes-zone.tsx:257`](../../../src/adapters/driving/tui/zones/routes/routes-zone.tsx#L257)

**Zone wiring**

- Saved keys: filter, load, delete, retry, Esc unwind
  [`routes-zone.tsx:1338`](../../../src/adapters/driving/tui/zones/routes/routes-zone.tsx#L1338)

- Store errors surface with retry; reset on route change
  [`routes-zone.tsx:985`](../../../src/adapters/driving/tui/zones/routes/routes-zone.tsx#L985)

- Saved branch render and footer hints
  [`routes-zone.tsx:1891`](../../../src/adapters/driving/tui/zones/routes/routes-zone.tsx#L1891)

**Tests (last)**

- Scoped list, load, delete, filter, reset flows end to end
  [`routes-zone.interaction.test.tsx:1350`](../../../src/adapters/driving/tui/zones/routes/routes-zone.interaction.test.tsx#L1350)
