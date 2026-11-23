---
title: 'Recent Routes & Quick Re-Fire'
type: 'feature'
created: '2026-11-23'
status: 'done'
baseline_commit: '404dd4415c32df4eb530fe000b24d96e69a37102'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/sprint-1-delivery-of-tui-back/epic-6-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Iterating on a route (edit code → fire → read) needs the route found and the pane opened again each time; fired routes are not remembered and `Ctrl+R` only works from the right pane.

**Approach:** Record fired routes per session in the routes slice, show a **Recent** section below the favorites in the Favorites pane, and make `Ctrl+R` re-fire the selected route's current draft from the list, the Favorites pane or a Recent row (reusing the 6.9 `fireRoute` path and fire-block rules).

## Boundaries & Constraints

**Always:** Recent = last 10 distinct fired routes of the displayed repo, most recent first, each with last status code + duration (an error outcome shows its error code instead); session-only (never persisted), hidden when empty. Identity = `(repoPath, METHOD, path template)`. Re-fire goes through `firePaneRoute`'s logic (`resolveFireBlock`, `buildFireRequest`, `fireRoute`) — same required-parameter and auth rules as 6.9; no second fire path. After a successful launch the pane shows **Response**. `Enter` on a Recent row = `Enter` on a favorite (select in list, clear filter if it hides it, open Request, never fires; unknown route → notice). Keep the Favorites pane bounded (AD-19) and the list's minimum height; touch `routes-zone.tsx` minimally (Epic 12 large-file list).

**Ask First:** Any change to core use-cases (`fire-request`, `favorites`) or `edts.yaml`; any new dependency.

**Never:** No persistence of recents. No fire from `Enter`. `Ctrl+R` must not fire while the filter, an overlay or a pane inline editor owns input.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Recent listed | routes fired this session | Recent section under favorites: ≤10 rows, `METHOD path  200 · 42ms`, newest first, repo-filtered | N/A |
| Re-fire repeated | same route fired again | row moves to top, no duplicate | N/A |
| No fire yet | nothing fired | Recent section not rendered | N/A |
| Ctrl+R, list/Favorites/Recent focus | route fired before, draft complete | re-fired with its current draft, pane on Response | fire failure → Response error as today |
| Ctrl+R, never fired | route absent from responses and recents | opens Request, nothing sent | N/A |
| Ctrl+R, missing required params | draft incomplete | opens Request listing the missing names, nothing sent | fire block shown |
| Ctrl+R, stale favorite | favorite not discovered | refused with a notice, nothing sent | notice |
| Ctrl+R on Response tab | right pane focus | re-fires in place | N/A |
| Enter on Recent row | row focused | selects route, opens Request, no fire | unknown route → notice |
| Error outcome | network/auth error | row shows the error code, no status | N/A |

</frozen-after-approval>

## Code Map

- `src/adapters/driving/tui/store/slices/workspace/routes-slice.ts` -- `fireRoute` (l.410): on completion record `recentRoutes` (cap 10 per repo, MRU, dedupe); reset on repo change like `responses`; add to `RoutesPaneFocus` the value `'recent'`.
- `zones/routes/logic/routes-recent.logic.ts` (+ `.test.ts`, new) -- pure: repo filter, MRU upsert, row label (`status · duration` / error code), pane row budget shared with favorites, cursor clamp, recent → route resolution (reuse `resolveFavoriteSelection` shape).
- `zones/routes/logic/routes-favorites.logic.ts` -- `resolveFavoritesPaneRows` (l.~71): extend budget so the Recent section shrinks first, favorites keep priority.
- `zones/routes/panes/routes-favorites-pane.tsx` / `routes-list-pane.tsx` -- render the Recent section under favorites; selected highlight when focus is `'recent'`.
- `zones/routes/keys/routes-zone.list-keys.ts` (Tab, l.~75) + `routes-zone.favorites-keys.ts` -- Tab cycle list → favorites → recent → list (skipping empty); new `routes-zone.recent-keys.ts` (move, Enter, Esc/Tab).
- `zones/routes/hooks/use-routes-pane-actions.ts` -- `firePaneRoute` (l.120): generalize to `fireRouteTarget(route)`; add `reFireRoute(route)` implementing the never-fired / blocked / fire decision; `firePaneRoute` delegates.
- `zones/routes/keys/routes-zone.pane-keys.ts` (Ctrl+R already fires before tab dispatch → covers Response tab; lock with a test), `use-routes-input.ts` (dispatch order, add recent focus), `routes-zone.ctx.ts`, `use-routes-state.ts`, `use-routes-derived.ts`.
- `keybindings/footer-contexts.ts` + `routesFooterContext` (`routes-zone.logic.ts` l.~140) + `keybindings.ts` -- add `Ctrl+R fire` to list/favorites/recent contexts, new `routes-recent` context (UX-DR7: no inert hint).
- Tests: `routes-slice.test.ts`, scenario `zones/routes/scenarios/routes-zone.recent.test.tsx` (`routes-zone.test-support.tsx` + fake ports); `app-shell.tsx` (l.~359) global-shortcut guard must also hold for `'recent'`.

## Tasks & Acceptance

**Execution:**
- [x] `routes-slice.ts` + test -- `recentRoutes` state, record on fire, repo reset, `'recent'` focus -- AC list/dedupe/session-only
- [x] `routes-recent.logic.ts` + test, `routes-favorites.logic.ts` -- pure logic and height budget -- AC bounded/empty-hidden
- [x] `routes-favorites-pane.tsx`, `routes-list-pane.tsx` -- render Recent section -- AC render
- [x] key handlers, `use-routes-input.ts`, `use-routes-pane-actions.ts`, ctx/state/derived -- Tab cycle, Enter, `Ctrl+R` re-fire decision -- AC keys
- [x] `footer-contexts.ts`, `routes-zone.logic.ts`, `keybindings.ts` + tests -- hints
- [x] scenario test -- matrix end-to-end (incl. Response tab `Ctrl+R`)

**Acceptance Criteria:**
- Given requests were fired this session, when the Favorites pane renders, then Recent lists the last 10 distinct routes of the displayed repo with status and duration, and is hidden when empty.
- Given list, Favorites pane or a Recent row has focus, when `Ctrl+R` is pressed, then the selected route's draft is re-fired through the 6.9 path and the pane shows Response; never-fired or incomplete routes open Request with nothing sent.
- Given the Response tab, when `Ctrl+R` is pressed, then the draft is re-fired in place.
- Given Enter on a Recent row, then it opens Request without firing.

## Spec Change Log

## Design Notes

"Never fired" = the route key is in neither `responses` nor `recentRoutes`. It keeps the mandatory request step (6.9) for a first fire while making every later iteration a single key. Recent is a distinct focus (`'recent'`) with its own cursor rather than a merged cursor, so favorites keys stay unchanged.

## Verification

**Commands:**
- `npx tsc --noEmit` -- expected: no errors
- `npx vitest run` -- expected: all green
- `npm run lint` -- expected: clean (if defined)

## Suggested Review Order

**Re-fire decision (entry point)**

- Never-fired / blocked / fire decision; reuses the 6.9 fire path.
  [`use-routes-pane-actions.ts:163`](../../../../../src/adapters/driving/tui/zones/routes/hooks/use-routes-pane-actions.ts#L163)

- Shared fire logic that `firePaneRoute` and `reFireRoute` both use.
  [`use-routes-pane-actions.ts:124`](../../../../../src/adapters/driving/tui/zones/routes/hooks/use-routes-pane-actions.ts#L124)

**Recording recents**

- Each fire outcome upserts a session-only recent, MRU, capped.
  [`routes-slice.ts:476`](../../../../../src/adapters/driving/tui/store/slices/workspace/routes-slice.ts#L476)

- Recents dropped when the routes repo changes.
  [`routes-slice.ts:403`](../../../../../src/adapters/driving/tui/store/slices/workspace/routes-slice.ts#L403)

**Pure logic**

- Repo-scoped never-fired test deciding Ctrl+R behavior.
  [`routes-recent.logic.ts:46`](../../../../../src/adapters/driving/tui/zones/routes/logic/routes-recent.logic.ts#L46)

- Tab cycle list, favorites, recent, skipping hidden panes.
  [`routes-recent.logic.ts:59`](../../../../../src/adapters/driving/tui/zones/routes/logic/routes-recent.logic.ts#L59)

**Keys and focus**

- Recent pane keys: move, Enter opens Request, Ctrl+R re-fires.
  [`routes-zone.recent-keys.ts:11`](../../../../../src/adapters/driving/tui/zones/routes/keys/routes-zone.recent-keys.ts#L11)

- Tab from the list joins the cycle; Ctrl+R from the list.
  [`routes-zone.list-keys.ts:80`](../../../../../src/adapters/driving/tui/zones/routes/keys/routes-zone.list-keys.ts#L80)

- Focus returns to the list when its pane disappears.
  [`use-routes-effects.ts:15`](../../../../../src/adapters/driving/tui/zones/routes/hooks/use-routes-effects.ts#L15)

**Rendering and hints**

- Recent section rendered under the favorites.
  [`routes-recent-section.tsx:10`](../../../../../src/adapters/driving/tui/zones/routes/panes/routes-recent-section.tsx#L10)

- Footer context for the Recent pane.
  [`footer-contexts.ts:255`](../../../../../src/adapters/driving/tui/keybindings/footer-contexts.ts#L255)

**Tests**

- End-to-end scenarios for the I/O matrix.
  [`routes-zone.recent.test.tsx`](../../../../../src/adapters/driving/tui/zones/routes/scenarios/routes-zone.recent.test.tsx)
