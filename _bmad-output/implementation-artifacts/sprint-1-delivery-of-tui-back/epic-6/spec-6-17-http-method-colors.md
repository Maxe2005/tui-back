---
title: 'Story 6.17: HTTP Method Colors'
type: 'feature'
created: '2026-11-25'
baseline_commit: '1f6b7e2cae47ad64bce7f806ad21b2053b0df819'
status: 'done'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/sprint-1-delivery-of-tui-back/epic-6-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Every route surface prints `METHOD path` as one uniform-colored string, so GET/POST/PUT/PATCH/DELETE cannot be told apart at a glance when scanning.

**Approach:** Add a `methodColor(method)` helper plus per-method tokens to `shared/theme`, and have every route surface draw the method token in that color while the method stays printed as text.

## Boundaries & Constraints

**Always:** One token per method (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`) plus a neutral fallback for `HEAD`/`OPTIONS`/unknown methods; lookup is case-insensitive and never throws. Colors come from hexes defined in the theme module only (no per-zone literals) and are covered by the theme's existing palette/contrast tests. Selected rows keep the method color; a stale (dim) row is dimmed whole, method included. Method text is always printed (works under `NO_COLOR`/monochrome).

**Ask First:** Adding new hues outside the existing palette family (if the palette cannot yield five distinguishable method colors with acceptable contrast).

**Never:** Change what is stored, filtered or matched (filter still matches `METHOD path` text); touch core/ports; change row layout or truncation behavior.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Known method | `get` / `DELETE` | its token color | N/A |
| Fallback | `HEAD`, `OPTIONS`, `TRACE`, `''` | neutral fallback color | never throws |
| Selected row | cursor on a GET row | method keeps GET color, rest of row selected style | N/A |
| Stale row | stale favorite | whole row dimmed incl. method | N/A |

</frozen-after-approval>

## Code Map

- `src/adapters/driving/tui/shared/theme/theme.ts` -- palette; add `methodColors` (beside `jsonTreeColors`, aggregate `theme` shape untouched) + `methodColor()`.
- `src/adapters/driving/tui/shared/theme/theme.test.ts` -- existing palette/contrast tests to extend.
- `src/adapters/driving/tui/shared/components/lists/list-row.tsx` -- shared row; used by routes list, favorites, recent, request tab, picker (`filterable-pick-list.tsx:150`). Add optional `method` prop rendering a colored method token before the label.
- `zones/routes/logic/routes-zone.logic.ts:33,54` (`formatRouteRow`, `formatRouteDetail`), `routes-favorites.logic.ts:52`, `routes-recent.logic.ts:33`, `routes-smoke.logic.ts:72` -- build `METHOD path` labels; split method from remainder.
- `zones/routes/panes/routes-list-pane.tsx:97`, `routes-favorites-pane.tsx:58`, `routes-recent-section.tsx:41`, `routes-smoke-pane.tsx:72` (custom `<Text>` row), `routes-detail-pane.tsx:34` (Route header via `DetailPane`, single string), `routes-saved-tab.tsx` + `hooks/use-routes-derived.ts:60-90` (picker `meta: METHOD path`), `shared/components/pickers/filterable-pick-list.tsx`.

## Tasks & Acceptance

**Execution:**
- [ ] `shared/theme/theme.ts` + `theme.test.ts` -- add `methodColors`/`methodColor`, test mapping, case-insensitivity, fallback, palette/contrast.
- [ ] `shared/components/lists/list-row.tsx` (+ test) -- optional `method` prop: colored method token, label follows; selection/dim behavior preserved.
- [ ] routes logic formatters + list/favorites/recent panes -- pass method separately to `ListRow`; update logic tests.
- [ ] `routes-smoke-pane.tsx`, `routes-detail-pane.tsx` (Route header), Saved tab/picker rows -- color the method token.
- [ ] Render tests: each surface prints the method text; selected and stale cases.

**Acceptance Criteria:**
- Given the theme module, when extended, then it exposes a color per method plus a fallback and the theme tests pass.
- Given the Routes list, Favorites, Recent, Saved tab/picker, smoke table and Route header, when a route renders, then its method text is in its method color.
- Given a selected or stale row, when rendered, then selection reads correctly and a stale row is dimmed whole.
- Given an unknown method, when rendered, then the fallback color is used with no error.

## Design Notes

Where a surface renders `meta` as `METHOD path` (picker), the method token is split out of the meta string for coloring; filtering keeps matching the full text.

## Verification

**Commands:**
- `npm run typecheck` -- expected: no errors
- `npm test` -- expected: all pass
- `npm run depcheck` -- expected: no violations

## Suggested Review Order

**Theme: one source of method colors**

- `methodColors` tokens and the case-insensitive, never-throwing `methodColor` helper.
  [`theme.ts:39`](../../../../../src/adapters/driving/tui/shared/theme/theme.ts#L39)

**Shared rendering**

- `ListRow` prints a colored method token; dim rows dim it too.
  [`list-row.tsx:22`](../../../../../src/adapters/driving/tui/shared/components/lists/list-row.tsx#L22)

- `DetailPane` lead token carries the method in the Route header.
  [`detail-pane.tsx:25`](../../../../../src/adapters/driving/tui/shared/components/layout/detail-pane.tsx#L25)

- Picker items forward the method so `meta` stays the full filterable text.
  [`filterable-pick-list.tsx:156`](../../../../../src/adapters/driving/tui/shared/components/pickers/filterable-pick-list.tsx#L156)

**Routes surfaces**

- List pane passes the method separately from the path.
  [`routes-list-pane.tsx:97`](../../../../../src/adapters/driving/tui/zones/routes/panes/routes-list-pane.tsx#L97)

- Smoke table prints a colored method token after the outcome meta.
  [`routes-smoke-pane.tsx:77`](../../../../../src/adapters/driving/tui/zones/routes/panes/routes-smoke-pane.tsx#L77)

- Detail pane strips the leading method from the text it already shows as lead.
  [`routes-detail-pane.tsx:39`](../../../../../src/adapters/driving/tui/zones/routes/panes/routes-detail-pane.tsx#L39)
