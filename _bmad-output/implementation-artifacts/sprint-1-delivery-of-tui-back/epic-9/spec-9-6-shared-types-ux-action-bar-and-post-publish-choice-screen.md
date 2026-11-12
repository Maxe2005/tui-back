---
title: 'Shared Types UX — Action Bar & Post-Publish Choice Screen'
type: 'feature'
created: '2026-11-04'
status: 'done'
baseline_commit: '72dc5611d92c226768b90cb403b65e934f924b5c'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-9-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** In the Shared Types tab the commands (Publish, Propagate, History, Reload) are scattered dim hints, and after a publish the next step is a dim `C chain…, Esc stop` line that is easy to miss.

**Approach:** Declare the four actions once (key, label, `?` description), derive their availability + disabled reason in pure zone logic, and render them as a labelled action bar in the form view. Replace the post-publish done/failed hint lines with a selectable choice list (`MenuList` + one explanation line per choice).

## Boundaries & Constraints

**Always:** Zone/logic only (`zones/shared-types/`, keybinding declarations, footer contexts, shared `MenuList` additive extension). Keys obey the interaction contract: `↑/↓`/`Home`/`End` move, Enter selects, Esc = innermost close; hints via `formatHint(s)`. Every new region bounded (AD-19): no raw `.map` in the zone, dynamic text truncated, row budgets (`FORM_CHROME_ROWS`, `RUN_CHROME_ROWS`) grown to match.

**Ask First:** Changing any store action, core use-case (`publish-version.ts`, `propagate-version.ts`) or the `q` mid-run guard; making Reload available outside the error states.

**Never:** New dependency; new store state for the choice screen (local zone state only); removing `historyDisabledReason` or its message text.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Form, all ready | 1 source ready, consumers ready, valid version + ≥1 checked | Bar: `[P] publish  [Enter] propagate  [H] history` available; Reload dim `(nothing to reload)` | N/A |
| Form, no single source | 0 or ≥2 sources / loading / error | Publish + History dim with reason (History uses `historyDisabledReason`) | Pressing `H` still sets the warning notice |
| Form, nothing checked / bad version | `canRun` false | Propagate dim `(select a consumer)` / `(enter a valid version)` | Enter does not run |
| Load error | sources or consumers `error` | Reload available | N/A |
| Publish done | `publish.status='done'`, version v | `Published v` + choices: `Propagate v to consumers` (cursor default), `Back to the form`, `Close`, each with a dim explanation | N/A |
| Publish failed | `publish.status='blocked'` | Error/output + choices `Relaunch`, `Back` | Esc = Back |
| Shortcuts kept | done: `C`; failed: `R` | Same as choosing Propagate / Relaunch | N/A |

</frozen-after-approval>

## Code Map

- `src/adapters/driving/tui/zones/shared-types/shared-types-zone.tsx` -- `SharedTypesPanel` (:89); `SHARED_TYPES_CHAIN_HINT` (:42, remove); row budgets (:46-49); `historyDisabledReason` (:56-64); `useFooterContext` (:154-180); `useInput` dispatcher (:185-282; publish blocked :215, done :224, reload :254, publish :265); `renderHistoryHint` (:311-319, replaced by bar); done/failed views (:356-376); form header `(P publish)` (:380).
- `src/adapters/driving/tui/zones/shared-types/shared-types-zone.logic.ts` -- `canRun` (:67), `reduceForm` (:76), `shouldConfirmQuit` (:114, unchanged), `shouldStartPublish` (:123), `resolvePublishBlockedKey` (:130), `resolvePublishDoneKey` (:140), `initialFormState` (:31).
- `src/adapters/driving/tui/store/slices/shared-types-slice.ts` -- READ-ONLY: `SharedTypesPublish` (:41), `retrySharedTypesPublish` (:614), `resetSharedTypesPublish`.
- `src/core/service-actions/index.ts:18-26` -- `ServiceAction` / availability shape to reuse.
- `src/adapters/driving/tui/shared/components/service-actions-row.tsx` -- one-line bar renderer; `zones/dashboard/dashboard-body.tsx:109-125` shows the bar + `ClampedParagraph` reasons line pattern.
- `src/adapters/driving/tui/shared/components/menu-list.tsx` -- `MenuItem`, `resolveMenuKey`, `MenuList`; usage `zones/update/update-zone.tsx:238-256,682`.
- `src/adapters/driving/tui/keybindings/keybindings.ts` (`KEYBINDINGS` :24-273) + `keybindings.test.ts` (`EXPECTED` :8-84, locked order).
- `src/adapters/driving/tui/keybindings/footer-contexts.ts` -- Shared Types contexts :295-312; `MOVE`, `CLOSE`, `BACK` consts :8-12.
- `src/adapters/driving/tui/shared/bounds/bounds-matrix.test.tsx:198-235` -- Shared Types size matrix (only run states today).
- Tests: `shared-types-publish.interaction.test.tsx` (:117 relaunch, :133-150 chain, :152 q guard), `shared-types-history.interaction.test.tsx` (:69 `H version history`, :88 unavailable), `shared-types-zone.logic.test.ts`, `shared-types-zone.test.tsx`.

## Tasks & Acceptance

**Execution:**
- [x] `src/adapters/driving/tui/keybindings/keybindings.ts` -- export `SHARED_TYPES_ACTIONS` (`publish` P, `propagate` Enter, `history` H, `reload` R: key, label, description) and append one `KEYBINDINGS` row per action (`keys: 'P (Shared Types)'` …) derived from it; update `EXPECTED` in `keybindings.test.ts` -- single declaration feeds bar and `?` help.
- [x] `src/adapters/driving/tui/zones/shared-types/shared-types-zone.logic.ts` -- add `sharedTypesActions(input) → ServiceAction[]` (reasons per matrix, reusing `shouldStartPublish`/`canRun` conditions and `historyDisabledReason`, moved here); add `PUBLISH_DONE_CHOICES` / `PUBLISH_FAILED_CHOICES` (`MenuItem` with `description`) and `resolvePublishDoneChoice` / `resolvePublishFailedChoice` wrapping `resolveMenuKey` plus `C` / `R` shortcuts; drop the old `resolvePublish*Key`; unit-test all branches in `shared-types-zone.logic.test.ts`.
- [x] `src/adapters/driving/tui/shared/components/menu-list.tsx` -- add optional `description?: string` to `MenuItem`, rendered as one dim truncated line under its row; existing callers unaffected.
- [x] `src/adapters/driving/tui/zones/shared-types/shared-types-zone.tsx` -- render `ServiceActionsRow` + one-line reasons (`ClampedParagraph maxLines={1}`) in the form view, replacing `renderHistoryHint` and the `(P publish)` header suffix; render choice lists in done/failed views with local `choiceCursor` state (reset to 0 on status change); dispatch choices: Propagate = `resetPublish()` + version pre-fill (today's chain), Back to the form = `resetPublish()` keeping the form, Close = `resetPublish()` + `initialFormState`; Relaunch = `retryPublish()`, Back = `resetPublish()`; grow row budgets.
- [x] `src/adapters/driving/tui/keybindings/footer-contexts.ts` -- `shared-types-publish-done`: `[MOVE, ['Enter','select'], CLOSE]`; `shared-types-publish-failed`: `[MOVE, ['Enter','select'], BACK]`.
- [x] `src/adapters/driving/tui/zones/shared-types/*.test.tsx` + `shared/bounds/bounds-matrix.test.tsx` -- interaction tests for each choice, Esc, `C`/`R` shortcuts, bar availability/reasons; update history tests for the bar text; add publish `done`/`blocked` to the size matrix.

**Acceptance Criteria:**
- Given the form view, when I press `?`, then help lists Publish, Propagate, History and Reload with their keys under the Shared Types rows.
- Given a publish is running, when I press `q`, then the QUIT MID-RUN confirmation still appears exactly as before.
- Given the publish done/failed screens at every matrix size, when rendered, then the frame stays within rows × columns.

## Design Notes

- Back vs Close: both dismiss the result; Back keeps the form as it was (version, selection), Close also resets the form to `initialFormState` — the only way to give the two choices distinct meaning without new store state.
- Kept shortcuts `C` (propagate) and `R` (relaunch) are recorded as extras, not replacements; `n`/`N` stop is dropped (Esc = Close covers it).
- Propagate's key is Enter because propagation already runs on Enter from the consumer list; the bar shows it so users stop hunting for it.

## Verification

**Commands:**
- `npm test && npm run typecheck && npm run depcheck` -- expected: all green, including `bounded-rendering.guard`, `hints.guard`, `bounds-dialogs`, `bounds-matrix`, `keybindings.test.ts`.

## Suggested Review Order

**Choice screen (post-publish)**

- Entry point: one predicate drives both rendering and key handling, whatever the source state.
  [`shared-types-zone.tsx:135`](../../../src/adapters/driving/tui/zones/shared-types/shared-types-zone.tsx#L135)

- Cursor reset keyed on the publish object during render, so no stale frame.
  [`shared-types-zone.tsx:127`](../../../src/adapters/driving/tui/zones/shared-types/shared-types-zone.tsx#L127)

- Key dispatch: Propagate pre-fills and lands on row 1, Back keeps, Close resets.
  [`shared-types-zone.tsx:232`](../../../src/adapters/driving/tui/zones/shared-types/shared-types-zone.tsx#L232)

- Choices built once and shared by render and resolver.
  [`shared-types-zone.logic.ts:258`](../../../src/adapters/driving/tui/zones/shared-types/shared-types-zone.logic.ts#L258)

- Resolvers wrap resolveMenuKey and keep the C / R shortcuts.
  [`shared-types-zone.logic.ts:278`](../../../src/adapters/driving/tui/zones/shared-types/shared-types-zone.logic.ts#L278)

- Menu rendered right under the result line to stay visible on small terminals.
  [`shared-types-zone.tsx:379`](../../../src/adapters/driving/tui/zones/shared-types/shared-types-zone.tsx#L379)

**Action bar**

- Single declaration feeding the bar and the `?` help rows.
  [`keybindings.ts:27`](../../../src/adapters/driving/tui/keybindings/keybindings.ts#L27)

- Availability + reasons; available actions first so Reload never clips off.
  [`shared-types-zone.logic.ts:238`](../../../src/adapters/driving/tui/zones/shared-types/shared-types-zone.logic.ts#L238)

- History reason moved here; new branches for several sources and unreadable source.
  [`shared-types-zone.logic.ts:134`](../../../src/adapters/driving/tui/zones/shared-types/shared-types-zone.logic.ts#L134)

- Bar + reasons line + history notice replace the old dim hints.
  [`shared-types-zone.tsx:344`](../../../src/adapters/driving/tui/zones/shared-types/shared-types-zone.tsx#L344)

- Row budget grows for the bar and, when shown, the history notice.
  [`shared-types-zone.tsx:53`](../../../src/adapters/driving/tui/zones/shared-types/shared-types-zone.tsx#L53)

**Shared primitives & footer**

- Optional one-line description under a menu row; rows without one unchanged.
  [`menu-list.tsx:60`](../../../src/adapters/driving/tui/shared/components/menu-list.tsx#L60)

- Footer contexts list Enter select plus the kept C / R shortcuts.
  [`footer-contexts.ts:299`](../../../src/adapters/driving/tui/keybindings/footer-contexts.ts#L299)

**Tests**

- Interaction coverage for bar, choices, shortcuts, Close reset, reload visibility.
  [`shared-types-publish.interaction.test.tsx:196`](../../../src/adapters/driving/tui/zones/shared-types/shared-types-publish.interaction.test.tsx#L196)

- Size matrix now covers publish done/blocked and asserts the highlighted choice is on screen.
  [`bounds-matrix.test.tsx:199`](../../../src/adapters/driving/tui/shared/bounds/bounds-matrix.test.tsx#L199)
