---
title: 'JsonTree Component — Read-Only Navigation, Collapse & Session Filters'
type: 'feature'
created: '2026-09-30'
status: 'done'
review_loop_iteration: 0
baseline_commit: '9758f891400b6211eea984745becc7f7f65dfbfb'
context:
  - '/home/mchoisel/Documents/IANORD/tui-back-epic-6/_bmad-output/implementation-artifacts/epic-6-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A fired response is a raw text dump (`formatFireResult`), unreadable for large JSON payloads, with no navigation, folding, or filtering.

**Approach:** Build a shared `JsonTree` component (pure flatten/fold/rule model + thin Ink view on `bounded-list`) with per-route session state in the routes slice, and wire it into the existing Response pane in place of the raw dump.

## Boundaries & Constraints

**Always:**
- `core/` never imports from `adapters/` (AD-1); imports first, relative imports end in `.js`.
- `tui/shared/components/json-tree/` holds a pure model (`model.ts`: `flattenJson`, `normalizePath`, fold/rule helpers — no Ink/React imports) fully unit-tested, plus a thin view (`json-tree.tsx`) built on `BoundedList`; only visible rows are rendered (AD-12).
- Rows: `key: value` lines, containers with `{n}`/`[n]` size hints, indent = theme `spacing.indent`; scalars colored by type (string → `success`, number → `info`, boolean → `warning`, null → `text-dim`; keys in `text`); strings longer than 120 chars truncated with `…`.
- Navigation: `up/down` move line by line, `Home`/`End` jump, `PgUp`/`PgDn` move by viewport size (handled tree-locally — no change to the shared `NavigationKey` contract); viewport scrolls with the selection inside a measured bounded area.
- Fold: `→`/`Space` unfolds a container, `←` folds it (or jumps to parent when already folded); `+`/`-` unfold/fold every container down to the next depth level. Folded paths stored per normalized path (array indices become `[]`, e.g. `data.items[].tags`) so folds survive re-fires with different array lengths.
- Filters: `h` hides every line with the selected line's key name (global key rule), `H` adds it to an allow-list (only listed keys shown, with structural ancestors); `f` opens a panel listing active rules (remove per rule) plus a hide-nulls toggle; the status line always shows hidden-line count and active-rule count.
- State shape is serializable plain data: `{ foldedPaths: string[]; hiddenKeys: string[]; onlyKeys: string[]; hideNulls: boolean; selected: number }`, keyed per route (`METHOD + ' ' + path`) in a new `jsonTreeStates: Record<string, JsonTreeState>` slice field; session-only (never persisted to disk); prune map to the 50 most-recently-touched entries.
- Focus: firing switches focus to the response tree (arrows/fold/filter keys go to the tree); `Esc` returns focus to the routes list (existing list behavior unchanged when unfocused). `Enter` on the list still fires directly — the mandatory request step arrives in 6.9.
- Response classification: body parses as JSON → tree; empty body or empty object/array → explicit empty state (never an error); unparsable + length ≥ 64 KB cap → scrollable raw text with reason "truncated at 64 KB"; unparsable + shorter → raw text with reason "not JSON". A partial tree is never rendered as if complete.
- Slice stores the fired route's key (`firedRouteKey`) next to the existing fire triple; `loadRoutes` success resets the fire triple exactly as today.

**Ask First:** Any change to `FireResult`, `fireRequest`, or the fire triple's lifecycle; persisting tree state to disk.

**Never:**
- No edit mode (6.8); no sub-tabs or Request pane (6.9); no change to list firing, filtering, or scan states.
- Hidden/folded lines are display-only in this story (the "still sent" rule belongs to 6.8's editor).
- No new dependency; no `core/` change of any kind (response classification parses `fireResult.body` in the driving adapter).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Nested JSON | object with nested object/array/scalars | indented rows, `{n}`/`[n]` hints, type colors, `…` past 120 chars | N/A |
| Fold/unfold | container selected, `←` then `→` | children hidden/shown; `←` on folded moves to parent | N/A |
| Depth level | `+`/`-` on any line | all containers down to next depth level unfold/fold | N/A |
| Global hide | `h` on key `tags` | every `tags` line gone everywhere; status shows counts | N/A |
| Allow-list | `H` on key `id` | only `id` lines (+ ancestors) visible | N/A |
| Filter panel | `f`, remove a rule, toggle nulls | rule gone / nulls hidden; `Esc` closes | N/A |
| Re-fire same route | new response, same routeKey | same key rules + normalized folds re-applied | N/A |
| Other route | different routeKey selected+fired | its own fresh tree state | N/A |
| Truncated body | 64 KB body, invalid JSON | raw text + "truncated at 64 KB" reason | Never a partial tree |
| Plain text | HTML body under cap | raw text + "not JSON" reason | N/A |
| Empty | `""` body or `{}` | explicit empty state, distinct from error | N/A |

</frozen-after-approval>

## Code Map

- `src/adapters/driving/tui/shared/components/bounded-list.tsx:136` -- `BoundedList` viewport (`items`, `maxVisibleRows`, `renderItem`, `cursorIndex`); JsonTree renders through it, owns selection/scroll itself.
- `src/adapters/driving/tui/shared/components/json-tree/` -- NEW: `model.ts` (pure: `flattenJson(value, foldedPaths, rules) → Row[]`, `normalizePath`, fold/rule reducers), `json-tree.tsx` (view: rows, status line, filter panel, raw-text fallback, empty states), `model.test.ts` + `json-tree.test.tsx`.
- `src/adapters/driving/tui/shared/theme/theme.ts:1` -- add scalar type colors (no per-JSON colors exist today); `spacing.indent` is the tree indent.
- `src/adapters/driving/tui/store/slices/routes-slice.ts:46` -- fire triple (`fireStatus/fireResult/fireError`, global, reset on `loadRoutes` success at L121-129); add `jsonTreeStates`, `firedRouteKey`, `treeFocused`, and per-route actions here.
- `src/adapters/driving/tui/zones/routes/routes-zone.tsx:259` -- detail pane: `DetailPane title="Response"` renders one joined string via `formatFireResult` (`routes-zone.logic.ts:60`); replace the body dump with the JsonTree (status line stays), add detail-area measurement (`useElementSize` pattern at L79/241) and the `Esc`-returns-to-list focus rule in the zone `useInput` (L110-168).
- `src/core/routes/fire-request.ts:40` -- `MAX_BODY_CHARS = 64*1024`, silent slice, no truncated flag: classification reuses the exported cap, never changes core.
- `src/adapters/driving/tui/shared/components/detail-pane.tsx:13` -- single-`<Text>` children constraint: the tree lives in the detail `Box` next to (not inside) `DetailPane`.
- Existing tests to extend, not rewrite: `routes-slice.test.ts`, `routes-zone.test.tsx` / `routes-zone.interaction.test.tsx`.

## Tasks & Acceptance

**Execution:**
- [x] `shared/components/json-tree/model.ts` + `model.test.ts` -- flatten/normalize/fold/rules/parse-classify pure functions -- every I/O matrix row unit-tested.
- [x] `shared/components/json-tree/json-tree.tsx` + `json-tree.test.tsx` -- BoundedList view, type colors, truncation, status line, filter panel, raw fallback, empty states -- renders only visible rows.
- [x] `shared/theme/theme.ts` -- scalar type colors -- AC color mapping.
- [x] `store/slices/routes-slice.ts` + `routes-slice.test.ts` -- `jsonTreeStates`/`firedRouteKey`/`treeFocused` + actions -- per-route isolation, re-fire persistence, 50-entry prune.
- [x] `zones/routes/routes-zone.tsx` + `routes-zone.logic.ts` + zone tests -- Response pane wiring, detail-area budget, focus + key routing, footer hints -- raw dump replaced, list behavior unchanged when unfocused.
- [x] Follow-up (reopen 2026-10-01): filter panel cursor (`↑/↓/Home/End`, `Space`/`d` remove, windowed past 10 rule rows, digits kept) -- model + view + zone + tests.
- [x] Follow-up (reopen 2026-10-01): right-pane shortcut line moved to the bottom of the right pane; list pane keeps list-only hints -- zone + tests.

**Acceptance Criteria:**
- Given a fired JSON response, when shown, then it is a navigable tree (arrows/Home/End/PgUp/PgDn, fold/unfold, depth +/-, hide/allow-list/panel/null-toggle) with a live status line, inside a bounded viewport.
- Given a re-fire on the same route, when the new response arrives, then its prior key rules and normalized folds apply; a different route starts fresh.
- Given a non-JSON or truncated body, when shown, then scrollable raw text with its reason appears, never a partial tree; empty bodies show an explicit empty state.
- Given the tree focused, when `Esc` is pressed, then focus returns to the routes list with all list keys working as before.
- Given the filter panel open with any number of rules, when the developer moves `↑/↓/Home/End`, then a cursor navigates the rule list (windowed past 10 rows); `Space`/`d` removes the highlighted rule, digits `1-9` still remove directly.
- Given the tree focused, when hints render, then the right pane shows its own shortcut line at its bottom while the list pane keeps list-only hints.

## Spec Change Log

- 2026-10-01 (story reopen — user feedback on `review`): digit-only rule removal caps at 9 individually-removable rules, and tree hints rendered under the left pane. Follow-up tasks appended below (no frozen change: "list and remove active rules" and hint placement were never frozen in detail). KEEP: live-state recipes, path escaping, control-char sanitization, visible raw selection.

## Verification

**Commands:**
- `npm test` -- expected: Vitest green, incl. new model/view tests and extended slice/zone tests.
- `npm run typecheck` -- expected: `tsc --noEmit` clean.
- `npm run depcheck` -- expected: no `core → adapters` violation.

## Suggested Review Order

**Pure model (start here)**

- Flatten, fold and rule semantics live here, Ink-free and fully unit-tested
  [`model.ts:209`](../../../src/adapters/driving/tui/shared/components/json-tree/model.ts#L209)

- Response classification: tree vs raw-with-reason vs explicit empty state
  [`model.ts:525`](../../../src/adapters/driving/tui/shared/components/json-tree/model.ts#L525)

- Escaped key paths keep literal dots distinct from nesting; indices generalize
  [`model.ts:61`](../../../src/adapters/driving/tui/shared/components/json-tree/model.ts#L61)

- Depth-level fold/unfold and tree-local key dispatch (shared contract untouched)
  [`model.ts:273`](../../../src/adapters/driving/tui/shared/components/json-tree/model.ts#L273)

**Zone wiring**

- Live-state recipes compose rapid keypresses instead of dropping them
  [`routes-zone.tsx:184`](../../../src/adapters/driving/tui/zones/routes/routes-zone.tsx#L184)

- Tree owns the keyboard while focused; Esc unwinds panel then focus
  [`routes-zone.tsx:374`](../../../src/adapters/driving/tui/zones/routes/routes-zone.tsx#L374)

**Session state**

- Per-route tree states, fired key and focus next to the fire triple
  [`routes-slice.ts:92`](../../../src/adapters/driving/tui/store/slices/routes-slice.ts#L92)

- Global Left/Right switch stays inert while the tree owns the arrows
  [`app-shell.tsx:370`](../../../src/adapters/driving/tui/app-shell.tsx#L370)

**Peripherals**

- Scalar type colors beside (not inside) the pinned theme aggregate
  [`theme.ts:28`](../../../src/adapters/driving/tui/shared/theme/theme.ts#L28)

- Thin BoundedList view, filter panel, raw fallback with visible selection
  [`json-tree.tsx:89`](../../../src/adapters/driving/tui/shared/components/json-tree/json-tree.tsx#L89)

- Consumer tests: depth levels, panel clear/close, raw scrolling via real keypresses
  [`routes-zone.interaction.test.tsx:303`](../../../src/adapters/driving/tui/zones/routes/routes-zone.interaction.test.tsx#L303)
