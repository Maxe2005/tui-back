---
title: 'Zone-Tab Bar Focus & Arrow Navigation (Story 2.12)'
type: 'feature'
created: '2026-08-25'
status: 'in-progress'
review_loop_iteration: 0
baseline_commit: 'cb471505c3bf5642396d416ae6ceb8f098ce1271'
context:
  - '_bmad-output/planning-artifacts/epics.md'
  - '_bmad-output/implementation-artifacts/epic-2/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Switching zones today requires memorizing/reaching for a single-letter mnemonic (`d`/`e`/`u`/`l`/`r`/`s`); there is no way to browse the zone-tab bar with the keyboard.

**Approach:** Add shell-level keyboard focus (`shellFocus: 'content' | 'tab-bar'` + `highlightedZone`) to the store: `Tab` (content-focused, nothing else capturing input) moves focus onto the tab bar and highlights the active zone; `Left`/`Right` moves the highlight, wrapping at the ends; `Enter` switches to the highlighted zone and returns focus to content; `Esc`/`Tab` returns focus to content unchanged. Mnemonics keep working from any focus state.

## Boundaries & Constraints

**Always:**
- New store state only: `shellFocus: 'content' | 'tab-bar'`, `highlightedZone: ZoneId | null`, plus actions, following the `zoneInputCaptured`/`registryScreenOpen` flag-plus-paired-actions convention (`app-store.ts`). No core/port change.
- New dispatch lives inside `AppShell`'s single `useInput` callback, after the existing `state.zoneInputCaptured` early-return (~line 107) — already keeps it inert while a zone dialog owns input.
- `Left`/`Right` wrap over the full `ZONES` order (`zones.ts`) via its own pure function (mirrors `shouldSwitchZone`), so Story 2.13 can later narrow the candidate set without a rewrite — today every zone counts as reachable.
- `EdtsZone`'s `useInput` (`edts-zone.tsx:804`) has a base-view `Tab` handler (`togglePaneFocus`) that fires on the same keypress. Gate it with Ink's `useInput(fn, { isActive: shellFocus === 'content' })` so a zone never double-handles a keystroke meant for the tab bar. No other zone owns a `useInput` hook today.
- Highlighted-not-active tab needs a visual distinct from the active zone's solid `colors.accent` fill (reserved for current selection): reuse the list-row focus convention — `colors['surface-selected']` background plus an accent leading bar glyph (`list-row.tsx`'s `▌`/`resolveRowLayout`) — via a new `highlighted: boolean` input to `resolveZoneTabState`/`ZoneTabBar` (`zone-tab-bar.tsx`).
- Mnemonic dispatch (`shouldSwitchZone`, `app-shell.tsx:120`) is untouched and keeps firing in any `shellFocus` state.

**Ask First:** none identified.

**Never:**
- Never build resize-mode (`Ctrl+W`) — no state for it exists yet; the AC's resize-mode clause has nothing to gate on and is out of scope here.
- Never change `/`(filter) or `:`(command) dispatch's relationship to `shellFocus` — unaffected by this story.
- Never touch list-navigation or any zone's dialog Tab-cycling beyond the `isActive` gate above.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Focus the tab bar | `shellFocus:'content'`, `Tab` pressed, nothing capturing input | `shellFocus→'tab-bar'`, `highlightedZone` = current `activeZone` | N/A |
| Move highlight | `shellFocus:'tab-bar'`, `Right` at last zone | `highlightedZone` wraps to first zone | N/A |
| Activate highlighted zone | `shellFocus:'tab-bar'`, `Enter` on a non-active tab | `activeZone` switches, `shellFocus→'content'` | N/A |
| Cancel without switching | `shellFocus:'tab-bar'`, `Esc` or `Tab` pressed | `shellFocus→'content'`, `activeZone` unchanged | N/A |
| Zone dialog owns input | `zoneInputCaptured:true`, `Tab` pressed | No effect on `shellFocus` (existing early-return) | N/A |
| Mnemonic while tab bar focused | `shellFocus:'tab-bar'`, `e` pressed | Switches to EDTs immediately, same as today | N/A |

</frozen-after-approval>

## Code Map

- `src/adapters/driving/tui/store/app-store.ts:101-212` -- `AppState`; add `shellFocus`/`highlightedZone` + `focusTabBar`/`blurTabBar`/`moveHighlight`/`activateHighlightedZone`, plus their impls (~227+)
- `src/adapters/driving/tui/app-shell.tsx:100-151` -- single `useInput` callback; add dispatch after the `zoneInputCaptured` gate (line 107-109); pass focus props to `ZoneTabBar` (line 156)
- `src/adapters/driving/tui/zones/zones.ts:18-55` -- `ZONES` ordering array, iterated for wrap-around
- `src/adapters/driving/tui/shared/components/zone-tab-bar.tsx` -- `resolveZoneTabState`/`ZoneTabBar` (13-59): add `highlighted` input + visual; mirror `list-row.tsx:20-32`'s `▌` focus-glyph pattern
- `src/adapters/driving/tui/zones/edts/edts-zone.tsx:804,820` -- `useInput` call + base-view `Tab` handler; needs `isActive: shellFocus === 'content'`
- `src/adapters/driving/tui/keybindings/keybindings.ts:44-47` -- `Tab` entry's help text needs updating
- `src/adapters/driving/tui/app-shell.test.tsx:136+` -- pure-dispatch-helper tests
- `src/adapters/driving/tui/app-shell.interaction.test.tsx:34+` -- real fake-stdin keypress tests

## Tasks & Acceptance

**Execution:**
- [ ] `app-store.ts` -- add `shellFocus`/`highlightedZone` state + actions -- new focus model lives in the store per convention
- [ ] `app-shell.tsx` -- wire Tab/Left/Right/Enter/Esc dispatch, pass focus props to `ZoneTabBar` -- drives the new interaction
- [ ] `edts-zone.tsx` -- gate `useInput` with `isActive: shellFocus === 'content'` -- prevents double-handling `Tab`
- [ ] `zone-tab-bar.tsx` -- add `highlighted` visual state -- makes focus visible
- [ ] `keybindings.ts` -- update `Tab` description -- keeps `?` help accurate
- [ ] `app-shell.test.tsx` + `app-shell.interaction.test.tsx` -- cover the I/O matrix -- proves the dispatch and focus/blur/wrap/activate paths
- [ ] `zone-tab-bar.test.tsx` -- cover the new `highlighted` visual state

**Acceptance Criteria:**
- Given a form/dialog has captured input (`zoneInputCaptured`), when `Tab` is pressed, then `shellFocus` is unaffected (dialog's own Tab role, if any, still applies)
- Given the tab bar is focused, when a zone mnemonic is pressed, then the zone switches immediately and `shellFocus` returns to `'content'` (mirrors direct mnemonic use today)

## Design Notes

Story 2.13 will later filter which zones count as "reachable" for wrap-around (omitted tabs skipped, disabled tabs still landed on). Keep the wrap step as one small pure function over `ZONES` so 2.13 can swap its candidate list without touching the dispatch plumbing around it.

## Verification

**Commands:**
- `npm test` -- all suites green, including new `app-shell`/`zone-tab-bar` cases
- `npm run typecheck` -- clean
- `npm run depcheck` -- no boundary violations (changes confined to `adapters/driving/tui`)

**Manual checks (if no CLI):**
- Launch the TUI: `Tab` from Dashboard highlights the Dashboard tab; `Right` moves highlight to EDTs, wraps past shared-types back to Dashboard; `Enter` on a highlighted tab switches there; `Esc` from a highlighted tab returns to content with the zone unchanged; typing `e` while the tab bar is focused switches straight to EDTs.
