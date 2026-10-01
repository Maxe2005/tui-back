---
title: 'JsonTree Edit Mode — Request Body Editing'
type: 'feature'
created: '2026-10-01'
status: 'done'
review_loop_iteration: 0
baseline_commit: '156e1958631e3d7f3ac01ac5a781facc481d728e'
context:
  - '/home/mchoisel/Documents/IANORD/tui-back-epic-6/_bmad-output/implementation-artifacts/epic-6-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A route with a JSON body can only be fired as-is (`Enter` fires method + path, no payload), so shaping a realistic payload requires leaving the terminal.

**Approach:** Extend the 6.7 JsonTree model with an immutable edit layer plus an edit-mode view (inline scalar editor, structural keys, raw-text buffer), holding a per-route session body draft pre-filled from the 6.6 `bodyExample`; hide/fold stay purely visual and hidden content is still sent.

## Boundaries & Constraints

**Always:**
- `core/` never imports from `adapters/` (AD-1); imports first, relative imports end in `.js`.
- The edit layer is pure and fully unit-tested: `setValue`, `addEntry`, `removeEntry`, `changeType` over an immutable JSON value, next to `flattenJson` in `json-tree/` (no Ink/React imports).
- Scalar edit: `Enter` on a scalar opens an inline field reusing `nextTextInputValue` + `TextInputLine` (`Enter` confirms, `Esc` cancels); the entry is validated against its kind (number must parse, boolean must be `true`/`false`, `null` must be the literal, string always valid) — an invalid entry stays displayed in error color with its reason, never silently coerced.
- Structural keys: `a` adds (object → prompts for the key name via inline `TextInputLine`, duplicate rejected; array → appends an empty-string item), `d` deletes the selected entry, `t` cycles a scalar's kind string → number → boolean → null (containers are not type-changeable).
- Raw mode: `r` opens a multi-line buffer holding a `TextInputState` (`Return` inserts `\n`); `Esc` leaves and validates — invalid JSON keeps the developer in raw mode with the parse error and line/column shown, and the previous valid body is preserved.
- Drafts live in the routes slice as `bodyDrafts: Record<routeKey, unknown>`, session-only, same 50-entry LRU prune as `jsonTreeStates`, seeded lazily from the route's `bodyExample` on first open; the editor tree reuses the route's existing `jsonTreeStates` folds/filters, so a revisit restores body, filters and folds together.
- The editor opens from the routes list with `e` on a route carrying `bodyExample` or any `bodyContentType` (non-JSON bodies start empty, per 6.6); the detail pane shows the editor while open and `Esc` (with no inline/raw editor open) closes back to the list. The editor status line shows the first validation error when present, and `N lines hidden — still sent` whenever hiddenCount > 0.
- Footer hints reflect editor focus; list `Enter`-fire behavior is unchanged (it still sends no body — 6.9 owns sending the draft).

**Ask First:** Any change to `fireRequest` or the fire triple; persisting drafts to disk.

**Never:**
- No sub-tabs or Request pane (6.9); no body sent on fire in this story; no `core/` change of any kind.
- No edit affordance on routes with neither `bodyExample` nor `bodyContentType` (`e` inert, no hint).
- No new dependency.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Scalar edit | `Enter` on number, type `12x`, `Enter` | value stays `12x` in error color + reason | Never coerced |
| Add key | `a`, name `id`, name exists | duplicate rejected, prompt stays | Inline message |
| Delete | `d` on key / array item | entry removed, selection clamped | N/A |
| Change type | `t` on string `"3"` | becomes number `3` (re-parse, may error) | Invalid stays in error |
| Raw valid | `r`, paste object, `Esc` | body replaced, tree re-renders | N/A |
| Raw invalid | `r`, broken JSON, `Esc` | stays in raw mode + error with line/column | Previous body kept |
| Hidden sent | rules hide 3 lines | status `3 lines hidden — still sent` | Display-only |
| Revisit | leave editor, reopen route | last body + folds/filters intact | N/A |
| Non-JSON body | route with multipart contentType | editor starts empty, hint to press `r` | Nothing fabricated |

</frozen-after-approval>

## Code Map

- `src/adapters/driving/tui/shared/components/json-tree/model.ts:209` -- `flattenJson(value, foldedPaths, rules)`; edit layer (`setValue/addEntry/removeEntry/changeType` + scalar validators) lands here, pure, unit-tested.
- `src/adapters/driving/tui/shared/components/json-tree/model.ts:441` -- `resolveTreeKeyAction` dispatch seam; edit keys (`Enter` edit, `a/d/t/r`) extend it — `Enter/Esc/digits` are currently swallowed while tree-focused, hence free.
- `src/adapters/driving/tui/shared/components/json-tree/json-tree.tsx:89` -- stateless `JsonTreeProps` view; edit mode adds inline-editor row + raw buffer rendering beside it (caller-owned `TextInputState`, like `FilterPanel`).
- `src/adapters/driving/tui/shared/components/text-edit.ts:40` -- `nextTextInputValue` interpreter reused for inline and raw inputs; `src/adapters/driving/tui/shared/components/text-input-line.tsx:28` -- dumb renderer.
- `src/adapters/driving/tui/shared/components/branch-autocomplete-input.tsx:71` -- consumer-side validity-with-glyph pattern to mirror for invalid values.
- `src/adapters/driving/tui/store/slices/routes-slice.ts:62` -- `jsonTreeStates` + 50-entry touch-prune pattern to mirror for `bodyDrafts`; `fireRoute:185` untouched.
- `src/adapters/driving/tui/zones/routes/routes-zone.tsx:349` -- zone `useInput`; list side owns `/ f Enter Esc` — `e` is free for the editor opener; editor focus owns keys while open, `Esc` unwinds inline/raw editor first, editor second, like the 6.7 panel rule.
- `src/core/ports/route-scanner.ts:30` -- `bodyContentType?` / `bodyExample?: unknown` — read-only seed, never mutated.
- Existing tests to extend, not rewrite: `json-tree/model.test.ts`, `routes-slice.test.ts`, `routes-zone.test.tsx` / `routes-zone.interaction.test.tsx`.

## Tasks & Acceptance

**Execution:**
- [x] `shared/components/json-tree/` edit model + `model.test.ts` -- immutable ops, scalar validators, raw parse with line/column -- every I/O matrix row unit-tested.
- [x] `shared/components/json-tree/json-tree.tsx` + view tests -- edit-mode rows, inline editor, raw buffer, status line (`first error` / `N lines hidden — still sent`), empty-body state -- renders only visible rows (AD-12).
- [x] `store/slices/routes-slice.ts` + `routes-slice.test.ts` -- `bodyDrafts` seeded from `bodyExample`, per-route isolation, 50-entry prune, survives re-render; `loadRoutes` preserves drafts like tree states.
- [x] `zones/routes/routes-zone.tsx` + zone tests -- `e` opener gating, editor focus + key routing, `Esc` unwind order, footer hints -- list `Enter`-fire unchanged.

**Acceptance Criteria:**
- Given a route with a JSON body, when `e` is pressed, then the detail pane shows its body (seeded from `bodyExample`) as an editable tree; `Esc` returns to the list.
- Given an invalid scalar or unparsable raw buffer, when the developer confirms/leaves, then the error is shown with its reason (raw: with line/column) and nothing is coerced or lost.
- Given hidden or folded lines in the editor, when the status renders, then it shows `N lines hidden — still sent`; hiding never removes content from the draft.
- Given an edited route revisited later in the session, when reopened, then its last body plus its folds/filters are restored.
- Given a route with no `bodyExample` and no `bodyContentType`, when `e` is pressed, then nothing happens and no edit hint is shown.

## Spec Change Log

## Verification

**Commands:**
- `npm test` -- expected: Vitest green, incl. new edit-model/view tests and extended slice/zone tests.
- `npm run typecheck` -- expected: `tsc --noEmit` clean.
- `npm run depcheck` -- expected: no `core → adapters` violation.

## Suggested Review Order

**Pure edit model (start here)**

- Immutable ops plus kind-preserving validation live here, Ink-free and unit-tested
  [`model.ts:649`](../../../src/adapters/driving/tui/shared/components/json-tree/model.ts#L649)

- Error entries carry the pre-error kind so fixes never flip number to string
  [`model.ts:634`](../../../src/adapters/driving/tui/shared/components/json-tree/model.ts#L634)

- Delete remaps sibling error indices instead of leaving stale paths
  [`model.ts:1118`](../../../src/adapters/driving/tui/shared/components/json-tree/model.ts#L1118)

- Raw buffer parse reports 1-based line/column for the stay-in-raw error
  [`model.ts:1030`](../../../src/adapters/driving/tui/shared/components/json-tree/model.ts#L1030)

**Session state**

- Per-route drafts plus kinded error maps, same 50-entry LRU prune as tree states
  [`routes-slice.ts:69`](../../../src/adapters/driving/tui/store/slices/routes-slice.ts#L69)

**Zone wiring**

- Editor owns keys while open; Esc unwinds raw, inline, panel, then editor
  [`routes-zone.tsx:410`](../../../src/adapters/driving/tui/zones/routes/routes-zone.tsx#L410)

- Scalar confirm validates against the stored kind; empty raw buffer cancels
  [`routes-zone.tsx:337`](../../../src/adapters/driving/tui/zones/routes/routes-zone.tsx#L337)

- `e` opener gated on bodyExample/content-type; list Enter-fire untouched
  [`routes-zone.tsx:1010`](../../../src/adapters/driving/tui/zones/routes/routes-zone.tsx#L1010)

**Peripherals**

- Stateless editor and raw views with honest footer hints
  [`json-tree.tsx:207`](../../../src/adapters/driving/tui/shared/components/json-tree/json-tree.tsx#L207)

- Consumer tests: invalid-scalar, add/delete/remap, raw round-trips, revisit restore
  [`routes-zone.interaction.test.tsx:415`](../../../src/adapters/driving/tui/zones/routes/routes-zone.interaction.test.tsx#L415)
