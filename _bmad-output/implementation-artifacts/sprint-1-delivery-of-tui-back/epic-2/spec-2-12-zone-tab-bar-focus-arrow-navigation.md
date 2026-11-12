---
title: 'Zone-Tab Bar Focus & Arrow Navigation (Story 2.12)'
type: 'feature'
created: '2026-08-25'
status: 'done'
review_loop_iteration: 1
baseline_commit: 'cb471505c3bf5642396d416ae6ceb8f098ce1271'
context:
  - '_bmad-output/planning-artifacts/epics.md'
  - '_bmad-output/implementation-artifacts/epic-2/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Switching zones today requires memorizing/reaching for a single-letter mnemonic (`d`/`e`/`u`/`l`/`r`/`s`); there is no way to browse zones with the keyboard. The first design (a `Tab`-triggered tab-bar "focus mode" with `Left`/`Right` to highlight and `Enter` to confirm) left `shellFocus` stuck on the tab bar whenever a global overlay (`?`/`/`/`:`) opened while it was active, since nothing blurred it. Renegotiated: drop the whole focus-mode state machine.

**Approach:** `Left`/`Right` (content-focused, nothing capturing input) directly switch the active zone to the previous/next zone in `ZONES` order, wrapping at the ends — always available, no mode to enter first. `Tab` is fully unchanged: it keeps exactly its pre-story role (per-zone/dialog focus cycling), with zero shell-level involvement.

## Boundaries & Constraints

**Always:**
- `Left`/`Right` dispatch lives beside `shouldSwitchZone` in `AppShell`'s single `useInput` callback, gated exactly like mnemonics (`!helpOpen && !filterOpen && !registryScreenOpen`, inert while `zoneInputCaptured` via the existing early-return). No new store state.
- Wrap arithmetic over the full `ZONES` order lives in its own pure function in `zones.ts` (mirrors `shouldSwitchZone`'s lookup shape), so Story 2.13 can later narrow the candidate set without a rewrite — today every zone counts as reachable.
- Switching reuses `setActiveZone` as-is (same badge-clear behavior as a mnemonic switch). No new tab visual: the active zone's existing solid `colors.accent` fill is the only marker — there's no "highlighted-but-not-active" state since there's no confirm step.

**Ask First:** none identified.

**Never:**
- Never add any shell-level `Tab` handling, `shellFocus`/focus-mode state, or an `isActive` gate on any zone's own `useInput` — `Tab` and every zone's own key handling stay byte-for-byte as they were before this story.
- Never build resize-mode (`Ctrl+W`) — no state for it exists yet, out of scope here.
- Never change `/`(filter), `:`(command), or `?`(help) dispatch — unaffected, since there is no focus mode for them to interact with.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Switch to next zone | content focused, nothing capturing input, `Right` pressed | `activeZone` moves to the next zone in `ZONES` order | N/A |
| Switch to previous zone | same preconditions, `Left` pressed | `activeZone` moves to the previous zone in `ZONES` order | N/A |
| Wrap forward | `activeZone` is the last zone, `Right` pressed | `activeZone` wraps to the first zone | N/A |
| Wrap backward | `activeZone` is the first zone, `Left` pressed | `activeZone` wraps to the last zone | N/A |
| Zone dialog owns input | `zoneInputCaptured:true`, `Left`/`Right` pressed | No effect (existing early-return, same as mnemonics) | N/A |
| Overlay open | `helpOpen`/`filterOpen`/`registryScreenOpen`, `Left`/`Right` pressed | No effect (same gate mnemonics already use) | N/A |
| Tab unaffected | any state, `Tab` pressed | Exactly today's pre-story behavior (per-zone/dialog cycling); shell never intercepts it | N/A |

</frozen-after-approval>

## Code Map

- `src/adapters/driving/tui/zones/zones.ts:18-59` -- `ZONES` array; add a `nextZoneId(current, direction)` pure wrap function beside `isZoneId` (mirrors `shouldSwitchZone`'s lookup shape)
- `src/adapters/driving/tui/app-shell.tsx:40-140` -- `shouldSwitchZone` and the `useInput` callback's `if (!helpOpen && !filterOpen && !registryScreenOpen)` block (~line 119): add a sibling pure function (e.g. `resolveZoneArrowSwitch(key, activeZone)`) and one dispatch branch calling `setActiveZone` directly, same shape as the mnemonic branch
- `src/adapters/driving/tui/keybindings/keybindings.ts:21-74` -- `KEYBINDINGS`: add a `← / →` entry ("Switch to previous/next zone tab"); the `Tab` entry's text is untouched
- `src/adapters/driving/tui/app-shell.test.tsx`, `app-shell.interaction.test.tsx`, `zones/zones.test.ts`, `keybindings/keybindings.test.ts` -- unit + real-keypress coverage for the I/O matrix and the new help entry

## Tasks & Acceptance

**Execution:**
- [x] `zones.ts` -- add `nextZoneId(current, direction)` -- reusable wrap-arithmetic, no dispatch coupling
- [x] `app-shell.tsx` -- add arrow-switch pure function + dispatch branch beside `shouldSwitchZone` -- drives the interaction with zero new state
- [x] `keybindings.ts` -- add the `← / →` help entry -- keeps `?` help accurate
- [x] `zones.test.ts`, `app-shell.test.tsx`, `app-shell.interaction.test.tsx`, `keybindings.test.ts` -- cover the I/O matrix and the new help entry (also fixed a pre-existing hardcoded last-row assertion in `keybinding-help.test.tsx`, and added `left`/`right` raw sequences to the shared `KEYS` test fixture)

**Acceptance Criteria:**
- Given any focus state, when a zone mnemonic is pressed, then it switches zones immediately exactly as it does today (mnemonics are untouched by this story)
- Given `Tab` is pressed in any zone or dialog, when observed, then behavior is byte-for-byte identical to before this story (no shell-level interception was added)

## Spec Change Log

- **Finding (review, human-directed simplification):** the first design's `Tab`-triggered tab-bar focus mode left `shellFocus` stuck on `'tab-bar'` after a global overlay (`?`/`/`/`:`) opened and closed while it was active — root cause was the frozen Boundaries' explicit "never touch `/`/`:` dispatch's relationship to `shellFocus`," which forbade the natural fix.
- **Amended:** dropped the entire focus-mode state machine (`shellFocus`, `highlightedZone`, `focusTabBar`/`blurTabBar`/`moveHighlight`/`activateHighlightedZone`, the `isActive` gate on `EdtsZone`, the tab bar's `highlighted` visual). Replaced with direct, always-available `Left`/`Right` zone switching — no mode, so nothing to get stuck in, and `Tab` needs zero changes.
- **Known-bad state avoided:** a stuck tab-bar-focus UI state after closing any global overlay, and the EdtsZone `isActive`-gate race on the mode-entry keystroke (both reported in review as real, reproducible issues).
- **KEEP:** the wrap-arithmetic pure function over `ZONES` (previously `nextZoneId`, mirroring `shouldSwitchZone`'s lookup shape) is still the right, reusable shape for Story 2.13 to later narrow — re-add it as specified in Code Map above.

## Design Notes

Story 2.13 will later filter which zones count as "reachable" (skip fully-omitted tabs, still land on disabled ones). Keep `nextZoneId` as its own small pure function over `ZONES` so 2.13 can swap its candidate list without touching the dispatch plumbing around it.

## Verification

**Commands:**
- `npm test` -- all suites green, including the new `zones`/`app-shell`/`keybindings` cases
- `npm run typecheck` -- clean
- `npm run depcheck` -- no boundary violations (changes confined to `adapters/driving/tui`)

**Manual checks (if no CLI):**
- Launch the TUI: from Dashboard, `Right` switches straight to EDTs; repeated `Right` cycles through all six zones and wraps back to Dashboard; `Left` cycles backward and wraps past Dashboard to shared-types. `Tab` behaves exactly as before this story in every zone/dialog. Opening `?`/`/`/`:` and closing it leaves zone switching unaffected either way.

## Suggested Review Order

**Zone arrow-switch dispatch**

- Entry point — the pure function turning arrow keys into a target zone, mirroring `shouldSwitchZone`'s mnemonic lookup.
  [`app-shell.tsx:48`](../../../src/adapters/driving/tui/app-shell.tsx#L48)

- Where it's wired into the existing dispatch, beside the mnemonic branch, same gating.
  [`app-shell.tsx:142`](../../../src/adapters/driving/tui/app-shell.tsx#L142)

- The wrap-arithmetic it delegates to — kept separate so Story 2.13 can later narrow the candidate set.
  [`zones.ts:65`](../../../src/adapters/driving/tui/zones/zones.ts#L65)

- The new help-screen entry, kept in sync with the actual behavior (including the wrap).
  [`keybindings.ts:75`](../../../src/adapters/driving/tui/keybindings/keybindings.ts#L75)

**Peripherals**

- Pure-function unit coverage for `resolveZoneArrowSwitch` (next/prev/wrap-forward/wrap-backward/no-op).
  [`app-shell.test.tsx:152`](../../../src/adapters/driving/tui/app-shell.test.tsx#L152)

- `nextZoneId` unit coverage over the full `ZONES` order.
  [`zones.test.ts:36`](../../../src/adapters/driving/tui/zones/zones.test.ts#L36)

- Real fake-stdin keypress coverage for every I/O-matrix row, including the three overlay-inert cases and Tab's untouched behavior.
  [`app-shell.interaction.test.tsx:97`](../../../src/adapters/driving/tui/app-shell.interaction.test.tsx#L97)
