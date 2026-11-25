---
title: 'Smoke Run in the Routes Zone'
type: 'feature'
created: '2026-11-25'
status: 'done'
baseline_commit: 'c41b7b275811b159d9b4afe91c455e99be08476d'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/sprint-1-delivery-of-tui-back/epic-6-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The smoke run (6.14) exists only as a CLI command; the developer must leave the TUI to learn which favorites are up.

**Approach:** Key `t` in the Favorites pane starts `smokeRunFavorites` through a store action; a bounded live table (glyph + colour) shows each row `pending → firing → outcome`, with a summary line. `Enter` on a row opens the route on **Response** with that fire's response kept as the route's last response.

## Boundaries & Constraints

**Always:** Reuse `smokeRunFavorites` (no second HTTP path). Run state lives in the store (survives leaving the zone; late rows dropped on `repoGeneration` change). Table windowed with `BoundedList` (AD-19). Every outcome shown with glyph **and** colour. Mutating favorites present → confirm dialog listing `METHOD path`: Enter includes them, Esc declines (safe ones only run). A second run while one is in flight is rejected with a notice; `Esc` while running aborts via `AbortSignal` (unstarted rows → `skipped: cancelled`). Summary counts ok / client-error / server-error / auth-error / network-error / skipped. Drafts: the route's saved request draft when one exists, else the use-case default. New logic in new modules (`keys/`, `logic/`, `panes/`, `hooks/`); `routes-zone.tsx` and `use-routes-input.ts` get only the dispatch branch and modal render. `t` is free in the Favorites pane (verified); declare it in `footer-contexts.ts` and `?` help (UX-DR7).

**Ask First:** Any change to `fire-request`/`favorites` signatures; new dependency.

**Never:** No persistence of the table. No CLI behaviour change (CLI `rows` stay body-free). No smoke run of mutating routes without the confirm.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Safe run | `t`, only GET favorites | table fills live, summary at end | N/A |
| Mutating | `t`, a POST favorite | confirm lists `POST /x`; Enter fires it, Esc runs safe ones | N/A |
| No favorites | `t` on empty pane | notice "no favorites", nothing starts | N/A |
| Concurrent | `t` during a run | rejected, notice "smoke run already in progress" | run unaffected |
| Cancel | `Esc` mid-run | pending rows → `skipped (cancelled)`, summary shown | N/A |
| Open row | `Enter` on a fired row | route open on Response, response stored as last response | skipped/errored row: opens Request, notice |
| Leave zone | switch zone mid-run | run continues; table intact on return | N/A |

</frozen-after-approval>

## Code Map

- `src/core/insight/routes/smoke-run.ts` -- `SmokeRowUpdate` `done` phase carries only `SmokeRow` (no body); add an optional `response?: FireResult` to the `done` update (not to `rows`) so the TUI can store it.
- `src/adapters/driving/tui/store/slices/workspace/routes-slice.ts` -- `responses[routeKey]`, `touchEntry`/`MAX_ROUTE_RESPONSES`, `inFlight`, `repoGeneration`, `fireRoute` (~l.425), `routeKeyFor`; add smoke state + `startSmokeRun`/`cancelSmokeRun`. Deps (`manifest`, `scanner`, `auth`, `edtRegistry`, `state`) from `AppStoreDeps`.
- `src/adapters/driving/tui/zones/routes/keys/routes-zone.favorites-keys.ts` -- `handleFavoritesKey` (l.31): add `t`.
- `src/adapters/driving/tui/zones/routes/hooks/use-routes-input.ts` -- dispatch chain: add confirm/smoke branches; `use-routes-effects.ts` `setZoneInputCaptured` gets the new confirm flag.
- `src/adapters/driving/tui/zones/routes/panes/routes-modals.tsx`, `shared/components/dialogs/modal-dialog.tsx`, `keys/routes-zone.overlay-keys.ts` -- confirm dialog pattern.
- `src/adapters/driving/tui/zones/routes/panes/routes-favorites-pane.tsx`, `logic/routes-favorites.logic.ts` -- `BoundedList` model and row budget.
- `src/adapters/driving/tui/shared/components/feedback/status-badge.tsx`, `shared/theme/theme.ts` -- glyph/colour set; local outcome→badge map.
- `src/adapters/driving/tui/keybindings/footer-contexts.ts` (l.251), `keybindings/keybindings.ts` (~l.287), `logic/routes-zone.logic.ts` `routesFooterContext` (l.144) -- footer/help.
- `hooks/use-routes-pane-actions.ts` -- `openPaneForRoute`, `reFireRoute` draft building (`buildFireRequest`) for drafts; then `setRoutesPaneTab('response')`.

## Tasks & Acceptance

**Execution:**
- [x] `src/core/insight/routes/smoke-run.ts` + test -- `done` update carries `response` for fired rows
- [x] `store/slices/workspace/routes-slice.ts` + test -- smoke state (rows, summary, running, AbortController), `startSmokeRun`, `cancelSmokeRun`, response write per fired row, concurrent rejection, generation guard
- [x] `zones/routes/logic/routes-smoke.logic.ts` + test -- pure: mutating list, outcome→glyph/colour, summary line, row label, windowing budget
- [x] `zones/routes/panes/routes-smoke-pane.tsx` + `hooks`/`keys/routes-zone.smoke-keys.ts` -- bounded table, cursor, Enter/Esc/`t`
- [x] `routes-modals.tsx`, `use-routes-input.ts`, `use-routes-effects.ts`, `routes-zone.tsx` -- mutating confirm + minimal wiring
- [x] `footer-contexts.ts`, `keybindings.ts`, `routes-zone.logic.ts` -- hints/help; scenario test in `scenarios/` covering the I/O matrix

**Acceptance Criteria:**
- Given favorites, when `t` is pressed, then rows update live with glyph and colour, the table is bounded and the TUI stays responsive.
- Given mutating favorites, when the run starts, then a confirm lists them and the choice decides inclusion.
- Given a result row, when `Enter` is pressed, then the route opens on Response showing that fire's response.
- Given a run in flight, when `t` is pressed again, then it is rejected; `Esc` cancels pending rows.
- Given the run ends, then the summary line counts all six outcomes.

## Spec Change Log

## Verification

**Commands:**
- `npx tsc --noEmit` -- expected: no errors
- `npx vitest run` -- expected: all green
- `npm run lint` -- expected: clean

## Suggested Review Order

**Core hook**

- Done update now carries the fire result so the TUI can keep it as last response.
  [`smoke-run.ts:43`](../../../../../src/core/insight/routes/smoke-run.ts#L43)

**Run state in the store**

- Start/cancel, concurrency guard, abort on repo change, draft-aware firing.
  [`routes-slice.ts:740`](../../../../../src/adapters/driving/tui/store/slices/workspace/routes-slice.ts#L740)

- Enter on a row re-writes the fire's response as the route's last response.
  [`routes-slice.ts:833`](../../../../../src/adapters/driving/tui/store/slices/workspace/routes-slice.ts#L833)

**Zone UI**

- `t`, mutating confirm and table keys, kept out of the zone file.
  [`routes-zone.smoke-keys.ts:28`](../../../../../src/adapters/driving/tui/zones/routes/keys/routes-zone.smoke-keys.ts#L28)

- Pure glyph/colour mapping and row formatting.
  [`routes-smoke.logic.ts:53`](../../../../../src/adapters/driving/tui/zones/routes/logic/routes-smoke.logic.ts#L53)

- Bounded live table with header, summary and notice line.
  [`routes-smoke-pane.tsx:16`](../../../../../src/adapters/driving/tui/zones/routes/panes/routes-smoke-pane.tsx#L16)

**Tests**

- Scenario covering the I/O matrix through the zone.
  [`routes-zone.smoke.test.tsx`](../../../../../src/adapters/driving/tui/zones/routes/scenarios/routes-zone.smoke.test.tsx)
