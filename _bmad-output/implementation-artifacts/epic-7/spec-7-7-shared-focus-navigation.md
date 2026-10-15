---
title: 'Story 7.7: Shared focus-navigation component (FR-33)'
type: 'feature'
created: '2026-10-07'
status: 'done'
baseline_commit: 'ac2605cd7fa26b1485f170f3a355219665eda18c'
review_loop_iteration: 0
context:
  - '{project-root}/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Every zone and dialog hand-rolls its own `key.tab` branch (EDTs panes, Logs panes, Settings tabs, resize boundaries, modify form, wizard/switch-resolution panels, branch-picker modes, update-config panels). Most cycle forward only, so Shift+Tab (Ink: `key.tab` + `key.shift`) does the same as Tab; only the Routes request sections reverse. Footer hints and `?` help restate bindings by hand.

**Approach:** One `focus-navigation` primitive in `shared/keys/` takes a per-zone declaration (mode: H/V arrows, Tab/Shift+Tab, or Ctrl+N/P; ordered stops; wrap) and returns the next focus; Shift+Tab always reverses Tab. Footer and `?` help read the same declarations.

## Boundaries & Constraints

**Always:** Pure functions in `tui/shared/keys/`, next to `tab-navigation.ts` (reuse `stepTab`/`resolveTabNavKey` semantics for Ctrl modes; do not duplicate). Tab-driven cycles wrap, as today. Behavior of existing forward Tab is unchanged. Stops excluded today stay excluded (Logs info-only "without container" group is never a stop). No story/AC refs in `src/` (AD-17); imports first; conventional commits with `(story 7.7)`, atomic; verify with `npm test && npm run typecheck && npm run depcheck`.

**Ask First:** Any change to a key other than adding Shift+Tab reversal (key reassignments belong to 7.4).

**Never:** Alter text-input Tab semantics (command-bar completion, filter-editor mode flip, branch-autocomplete) beyond adding reverse where Tab already cycles non-text focus; change the Ctrl+W resize contract other than reversing boundary cycling; touch Dashboard content (7.5/7.6).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Reverse | Shift+Tab on any migrated stop list | previous stop, wrapping first → last | N/A |
| Forward | Tab | unchanged next stop, wrapping | N/A |
| Unknown current | current focus not in stops | first stop (forward) / last stop (back) | no crash |
| Single stop | one stop | stays | N/A |
| Resize mode | Shift+Tab | previous boundary, wrapping | N/A |
| Foreign key | any key outside the zone's declared mode | `null` (caller handles) | N/A |

</frozen-after-approval>

## Code Map

- `src/adapters/driving/tui/shared/keys/tab-navigation.ts` -- existing Ctrl+→/Ctrl+N `stepTab` (no wrap); model for the new module.
- `src/adapters/driving/tui/shared/keys/focus-navigation.ts` -- NEW: `FocusNavMode`, `FocusNavDeclaration`, `resolveFocusStep(input,key,mode)`, `stepFocus(stops,current,direction)`, hint text per mode.
- Hand-rolled Tab sites to migrate: `zones/edts/edts-zone.logic.ts:202` + `edts-zone.tsx:730` (pane focus); `zones/logs/logs-zone.logic.ts:75` + `logs-zone.tsx:555`; `shared/settings-screen.tsx:42,398` (`nextSettingsTab` already takes ±1); `store/slices/navigation-slice.ts:182` + `app-shell.tsx:279` (resize boundary cycling); `zones/edts/dialogs/modify-dialog.tsx:264` (`cycleFormFocus`); `create-wizard/step-branches.tsx:88`, `switch-resolution.logic.ts:484`, `update-config-panels.logic.ts:180` (two-panel toggles); `shared/components/branch-picker.tsx:217` (`cycleBranchPickerMode`); `routes-zone.tsx:1037` (already reverses via `nextRequestSection`; adopt primitive).
- Left as-is (text-editing semantics): `shared/command-bar.tsx`, `log-filter-editor`, `text-edit.ts`, `override-box.logic.ts:241`, `update-service-box.logic.ts:129` (space/tab toggle cycle — decide per-site; reverse only if it cycles focus, not a value).
- `src/adapters/driving/tui/keybindings/keybindings.ts:35` -- `Tab` help row; `shared/components/footer.tsx` -- hints; both derive Tab/Shift+Tab text from the declarations.

## Tasks & Acceptance

**Execution:**
- [ ] `shared/keys/focus-navigation.ts` (+ tests) -- primitive, three modes, wrap/clamp, Shift+Tab reversal -- single source.
- [ ] EDTs, Logs, Settings, Routes zones (+ tests) -- replace local cycle/Tab handlers with the primitive and a per-zone declaration -- no ad-hoc Tab handler.
- [ ] `navigation-slice.ts`, `app-shell.tsx` (+ `app-store.test.ts`) -- resize boundary cycling takes a direction -- Shift+Tab reverses.
- [ ] Dialogs (modify, wizard branches, switch-resolution, update-config panels, branch-picker) (+ tests) -- adopt primitive -- Shift+Tab reverses.
- [ ] `keybindings.ts`, `footer.tsx` (+ tests) -- Tab/Shift+Tab hint text generated from declarations -- help and footer cannot drift.
- [ ] Guard test -- grep that `key.tab` appears in `src/` only inside `focus-navigation.ts` and the documented text-input exceptions.

**Acceptance Criteria:**
- Given any migrated zone or dialog where Tab advances focus, when Shift+Tab is pressed, then focus retreats to the previous stop (wrapping).
- Given each zone's declaration, when keys arrive, then only its declared mode moves focus and no zone keeps a private Tab handler outside the documented exceptions.
- Given footer and `?` help, when rendered for a zone, then their Tab/Shift+Tab entries come from the same declaration.

## Design Notes

```ts
type FocusNavMode = 'tab' | 'horizontal' | 'vertical' | 'ctrl-np';
resolveFocusStep(input, key, 'tab') // Tab → 'next', Shift+Tab → 'back', else null
stepFocus(['edts','edt-services','other-services'], 'edts', 'back') // 'other-services'
```
Ink parses `ESC[Z` as `tab` with `shift: true`, so one `key.tab` check suffices.

## Verification

**Commands:**
- `npm test` -- expected: all pass
- `npm run typecheck` -- expected: clean
- `npm run depcheck` -- expected: clean

## Suggested Review Order

**Primitive**

- Entry point: modes, Shift+Tab reversal, wrapping step, hint helpers.
  [`focus-navigation.ts:28`](../../../src/adapters/driving/tui/shared/keys/focus-navigation.ts#L28)

- Wrapping step with first/last fallback for an unknown current stop.
  [`focus-navigation.ts:52`](../../../src/adapters/driving/tui/shared/keys/focus-navigation.ts#L52)

**Zone declarations and handlers**

- EDTs pane-focus declaration consumed by the zone handler.
  [`edts-zone.logic.ts:203`](../../../src/adapters/driving/tui/zones/edts/edts-zone.logic.ts#L203)

- Shared two-panel declaration for wizard and switch-resolution.
  [`edts-zone.logic.ts:218`](../../../src/adapters/driving/tui/zones/edts/edts-zone.logic.ts#L218)

- Settings tabs: Tab and Left/Right both go through the primitive.
  [`settings-screen.tsx:398`](../../../src/adapters/driving/tui/shared/settings-screen.tsx#L398)

- Resize-mode boundary cycling now takes a direction.
  [`navigation-slice.ts:187`](../../../src/adapters/driving/tui/store/slices/navigation-slice.ts#L187)

- Shift+Tab passed as back from the app shell.
  [`app-shell.tsx:282`](../../../src/adapters/driving/tui/app-shell.tsx#L282)

**Hints**

- Footer focus hint built from the zone declarations.
  [`footer.tsx:4`](../../../src/adapters/driving/tui/shared/components/footer.tsx#L4)

**Guard and tests**

- Guard keeps `key.tab` inside the primitive and documented text-input exceptions.
  [`focus-navigation.guard.test.ts`](../../../src/adapters/driving/tui/shared/keys/focus-navigation.guard.test.ts)
