---
title: 'Split UpdateZone into Hooks and Subcomponents'
type: 'refactor'
created: '2026-11-18'
status: 'done'
baseline_commit: '83cde8fa40b2c92cf96c928bad1821168a8c9648'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/sprint-2-refonte-fichiers-volumineux/epic-12-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `update-zone.tsx` is a single 951-line component (~45 store selectors, 15 `useState`, ~10 effects, a ~200-line `useInput` and the full render) mixing store wiring, derived data, input handling and panels.

**Approach:** Move code verbatim into layered hooks, a key dispatcher and render subcomponents, following the story 12.10/12.11 pattern. `UpdateZone` keeps its path and export and only composes them. Hook/effect order and Ink input priority stay identical.

## Boundaries & Constraints

**Always:** Behaviour-preserving. `update-zone.tsx` still exports `UpdateZone` with the same props (`useStore`, `initialRecap`) and keeps the two `export * from` re-exports. Effects keep their original relative order. `useInput` registration stays in the dispatcher hook called last; subcomponents never call `useInput`. One responsibility + header comment per file, each under ~400 lines. No import cycle. Gates before every commit: `npm test && npm run typecheck && npm run depcheck` (known `app-shell` `:reset` failure aside).

**Ask First:** Any need to change a test file, a store key, a footer context id or a rendered string.

**Never:** Edit any test file, rename store actions/keys, reorder key-handler branches.

</frozen-after-approval>

## Code Map

All in `src/adapters/driving/tui/zones/update/`.

- `update-zone.ctx.ts` -- `UpdateZoneCtx` flat context type shared by the hooks.
- `use-update-state.ts` -- store selectors (L107-186) + `useState`s/refs (L124-126, L188-223).
- `use-update-derived.ts` -- incident popup derivations, rows/panes/cursor clamp, run targeting, report input/content, labels, recap/detail data (L127-139, L260-292, L404-431, L658-722).
- `use-update-effects.ts` -- footer context + effects in original order (L238-258, L294-401, L433-438).
- `use-update-input.ts` -- `useZoneInputActive` + `useInput` dispatcher (L448-656) with `openReport`.
- `update-service-list-column.tsx` -- left column (SERVICES, members/others BoundedLists, `renderServiceRow`).
- `update-detail-column.tsx` -- right column (detail, spinner, toast, notice, error, recap states).
- `update-zone-dialogs.tsx` -- quit-confirm, config, service menu, pick and incidents dialogs.
- `update-zone.tsx` -- composer + re-exports + chrome-row constants.

## Tasks & Acceptance

**Execution:**
- [ ] Create the modules above and reduce `update-zone.tsx` to the composer (single refactor commit; intermediate states would not typecheck).

**Acceptance Criteria:**
- Given the split, when `update-zone.test.tsx`, `update-zone.interaction.test.tsx` and the other update tests run unchanged, then they pass; full suite, typecheck and depcheck green.
- No produced file exceeds 400 lines.

## Verification

**Commands:**
- `npx vitest run --configLoader runner && npm run typecheck && npm run depcheck` -- expected: only the known `:reset` failure.

## Review Notes

Three layers ran (blind, edge-case, verification-gap). Applied: reindented the recap JSX of the detail column, fixed four comments made stale by the move. Rejected/out of scope (verbatim-move refactor): ctx collision guards, memoization, `Pick`-narrowed props, extracting the key ladder into a pure resolver, hoisting `REPORT_HEADER_ROWS`, extra tests. Deviations: chrome-row constants live in `update-zone.ctx.ts` (importing from the composer would be a cycle); `shared/test-support/dialog-registry.tsx` entry `update/zone` repointed to `update-zone-dialogs.tsx` (same as story 12.9). Gates: full suite only the known `:reset` failure; typecheck and depcheck green.

## Suggested Review Order

**Composition**

- Composer: state, derived, effects, then input last, then views.
  [`update-zone.tsx:22`](../../../../../src/adapters/driving/tui/zones/update/update-zone.tsx#L22)

- Flat context type shared by every layer.
  [`update-zone.ctx.ts:8`](../../../../../src/adapters/driving/tui/zones/update/update-zone.ctx.ts#L8)

**Logic layers**

- Store selectors and local state.
  [`use-update-state.ts:10`](../../../../../src/adapters/driving/tui/zones/update/use-update-state.ts#L10)

- Derived rows, run targeting and report data.
  [`use-update-derived.ts:27`](../../../../../src/adapters/driving/tui/zones/update/use-update-derived.ts#L27)

- Effects keep their original relative order.
  [`use-update-effects.ts:12`](../../../../../src/adapters/driving/tui/zones/update/use-update-effects.ts#L12)

- Key dispatcher, branch order untouched.
  [`use-update-input.ts:24`](../../../../../src/adapters/driving/tui/zones/update/use-update-input.ts#L24)

**Views**

- Services list column.
  [`update-service-list-column.tsx:13`](../../../../../src/adapters/driving/tui/zones/update/update-service-list-column.tsx#L13)

- Detail and recap column.
  [`update-detail-column.tsx:21`](../../../../../src/adapters/driving/tui/zones/update/update-detail-column.tsx#L21)

- Dialog stack.
  [`update-zone-dialogs.tsx:14`](../../../../../src/adapters/driving/tui/zones/update/update-zone-dialogs.tsx#L14)

**Peripherals**

- Dialog registry repointed to the new dialogs file.
  [`dialog-registry.tsx:392`](../../../../../src/adapters/driving/tui/shared/test-support/dialog-registry.tsx#L392)
