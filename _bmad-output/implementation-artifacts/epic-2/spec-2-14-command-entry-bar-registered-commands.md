---
title: 'Command Entry Bar (`:`) & Registered Commands (Story 2.14)'
type: 'feature'
created: '2026-08-25'
status: 'done'
review_loop_iteration: 0
baseline_commit: '60e9adbb7ab406669d80fe06fd9c3b138ce44d47'
context:
  - '_bmad-output/planning-artifacts/epics.md'
  - '_bmad-output/planning-artifacts/sprint-change-proposal-2026-08-25.md'
  - '_bmad-output/planning-artifacts/sprint-change-proposal-2026-08-25-2.md'
  - '_bmad-output/implementation-artifacts/epic-2/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `:` currently opens the repo-registry screen directly — a misreading of the keybinding contract's promise of a generic, extensible command-entry input (stubbed since Story 1.13). There is no way to add a future action without re-binding a key each time.

**Approach:** `:` opens a real command-entry bar (`modal-dialog` + text input + filtered `list-row` candidate list) driven by a small in-memory command registry (name → handler) living in `adapters/driving/tui`. Only one command, `registry`, is registered initially — it replaces the current direct binding.

## Boundaries & Constraints

**Always:**
- Command registry is a static, in-memory list in `adapters/driving/tui` (new sibling folder to `keybindings/`/`zones/`) — no core/port change, no new port/adapter (mirrors Story 2.11's own rule).
- `:` dispatch (currently `openRegistryScreen()` in the `shouldOpenCommand` branch of `app-shell.tsx`'s `useInput`) opens the command bar instead. The bar owns its own `useInput` (self-contained, mirroring `RepoRegistryScreen`'s phase-dispatch shape) for typing, filtering, Tab-autocomplete, Enter-run/unknown-message, and Esc-cancel — not routed through the shell's central callback.
- The command bar never opens while another overlay (help, filter, registry screen, or itself) is open — extend the existing `if (!helpOpen && !filterOpen && !registryScreenOpen)` guard with a fourth check.
- Filtering is case-insensitive name-prefix match; empty input shows every command; zero matches shows an explicit "no matching command" state, never a blank list.
- Only an exact name match on `Enter` runs the command and closes the bar; any other `Enter` keeps the bar open and shows an inline "unknown command" message — never executes silently.
- The `registry` command's handler calls the existing store action `openRegistryScreen()` (same call Dashboard's own empty-registry prompt already makes) — no direct `core/ports` import.
- While the bar is open, `Tab` is fully consumed by its own autocomplete; Story 2.12's `Left`/`Right` zone-switch dispatch is untouched and unaffected everywhere else.

**Ask First:** none identified.

**Never:**
- Never let `:` open the registry screen directly — it is reachable only via the `registry` command inside the bar.
- Never add a core/port/use-case for commands — the registry stays a static in-memory list in the TUI adapter.
- Never add shell-level `Tab` handling or touch Story 2.12's arrow-switch dispatch.
- Never execute a command on a non-exact, ambiguous, or partial `Enter` match.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Open bar | content focus, no overlay open, `:` pressed | bar opens, empty focused input, full command list shown | N/A |
| Open blocked | help/filter/registry/bar already open, `:` pressed | nothing happens — no stacking | N/A |
| Filter as typed | bar open, text typed | list narrows to name-prefix, case-insensitive matches; empty input = all commands | zero matches → explicit "no matching command" state |
| Autocomplete single match | bar open, `Tab`, exactly one match | input completed to that command's full name | N/A |
| Autocomplete ambiguous/none | bar open, `Tab`, zero or 2+ matches | input unchanged | N/A |
| Run exact match | bar open, text exactly matches a command name, `Enter` | command executes, bar closes | N/A |
| Run no match | bar open, text matches no command exactly, `Enter` | bar stays open, shows "unknown command" message | never executes |
| Cancel | bar open, `Esc` | bar closes, typed text discarded, nothing executes | N/A |
| Registry via command | bar open, text `registry`, `Enter` | repo-registry screen opens (`openRegistryScreen()`), bar closes | N/A |
| Tab exclusivity | bar open, `Tab` | consumed entirely by autocomplete, no zone-switch side effect | N/A |

</frozen-after-approval>

## Code Map

- `src/adapters/driving/tui/app-shell.tsx:159` -- replaces the `openRegistryScreen()` call in the `shouldOpenCommand` branch with opening the new bar; overlay guard at line 140 extended with the new open-flag
- `src/adapters/driving/tui/app-shell.tsx:131-137` -- extends the registry-screen-only skip-help-dispatch condition to also skip while the command bar is open (same reasoning as the existing comment: it owns free-text capture)
- `src/adapters/driving/tui/app-shell.tsx:196-199` -- mounts the new command-bar component the same way `RepoRegistryScreen`/`KeybindingHelp` are mounted
- `src/adapters/driving/tui/commands/commands.ts` (new) -- static registry `Command[] = [{ name, run }]`, one `registry` entry calling `useStore.getState().openRegistryScreen()`; pure `matchCommands(query, commands)` prefix-filter helper (mirrors `zones.ts`'s pure-function convention)
- `src/adapters/driving/tui/shared/command-bar.tsx` (new) -- `modal-dialog` + `list-row` bar component; self-contained `useInput`, mirroring `repo-registry-screen.tsx`'s `typeRootInputChar`/`backspaceRootInput` shape for the query text; renders one `ListRow` per filtered command plus the "no matching command"/"unknown command" states
- `src/adapters/driving/tui/shared/components/modal-dialog.tsx`, `.../list-row.tsx` -- reused as-is
- `src/adapters/driving/tui/keybindings/keybindings.ts:57-60` -- verify the `:` entry's description still matches actual behavior (current text "Open command entry" is already accurate; adjust only if imprecise)
- `src/adapters/driving/tui/app-shell.test.tsx:77-90` -- rewrite the existing test framing the registry screen as "the `:` command palette's one wired command" — that framing is now wrong

## Tasks & Acceptance

**Execution:**
- [x] `commands/commands.ts` -- static registry + `matchCommands` pure filter -- new dispatch mechanism, no core/port change
- [x] `commands/commands.test.ts` -- unit tests for `matchCommands` (empty/no-match/partial/case-insensitive/exact) -- covers filter rows of the I/O matrix
- [x] `shared/command-bar.tsx` -- bar component: self-contained typing/filter/Tab/Enter/Esc handling, "no matching command"/"unknown command" states -- delivers the bar end-to-end
- [x] `app-shell.tsx` -- add `commandBarOpen` state (store-based, mirrors `registryScreenOpen` — see Spec Change Log); replace the `:` dispatch bug; extend the overlay guard; mount `<CommandBar>` -- wires `:` to the bar, removes the direct-registry-open bug
- [x] `app-shell.test.tsx` -- rewrite the outdated registry-via-`:` test; add coverage for the new dispatch and guard extension
- [x] `app-shell.interaction.test.tsx` -- real-keypress coverage for the full I/O matrix (open, blocked-while-overlay-open, filter, Tab single/ambiguous, Enter run/unknown, Esc, registry-via-command end-to-end, Tab-exclusivity) -- mirrors Story 2.12's existing test shape
- [x] `keybindings/keybindings.ts` + `keybindings.test.ts` -- confirm/adjust `:` description and its `EXPECTED` fixture if changed -- confirmed: current text "Open command entry" is already accurate, no change made

**Acceptance Criteria:**
- Given the registry screen (Story 2.11), when it is opened, then it is opened only by running the `registry` command through the bar — `:` itself never opens it directly
- Given the command bar is open, when `Tab` is pressed, then it is fully consumed by autocomplete with no zone-switching side effect
- Given this bar, when exercised via keyboard only, then every action (type, filter, autocomplete, run, cancel) is reachable without a mouse (Story 1.9's standing rule)

## Spec Change Log

- **Finding (review, two independent reviewers, confirmed against Ink's actual `useInput` semantics):** Ink dispatches every keypress to every mounted `useInput` hook unless a component passes `{ isActive: false }`. `EdtsZone`'s own `useInput` has no such gate and stays mounted regardless of `commandBarOpen`, so while the bar is open with the EDTs zone active, `Tab` also fires `EdtsZone`'s own pane-focus toggle and an exact-match `Enter` also fires its `openEdtAction()` (which can open a dialog and set `zoneInputCaptured: true`, silently freezing global shortcuts once the bar closes).
- **Amended:** `commandBarOpen` moved from `AppShell` local state into the store (mirrors `registryScreenOpen`'s placement, not `filterOpen`'s, since — like it — another component now needs to read it). `EdtsZone`'s `useInput` is gated with `{ isActive: !commandBarOpen }` so it stops reacting to keystrokes while the bar owns input.
- **Known-bad state avoided:** silent, invisible zone-state mutation (pane-focus toggle, or a stray dialog opening) behind the command bar, including a `zoneInputCaptured` stuck `true` after the bar closes.
- **KEEP:** the bar's own self-contained phase-dispatch `useInput` (typing/filter/Tab/Enter/Esc) is unaffected and correct as originally specified — the gap was one-directional (the bar never leaked into the zone; the zone leaked into itself underneath the bar).
- **Deferred (not this story's problem — pre-existing, predates 2.14):** the same exposure already exists for `registryScreenOpen`/`filterOpen`/`helpOpen` against any zone with meaningful key handling (e.g. `EdtsZone`'s own `Enter` already collides with Story 2.11's registry-screen `Enter`-to-scan). Logged to `deferred-work.md` for a dedicated hardening pass rather than fixed piecemeal here.

## Design Notes

The bar mirrors `RepoRegistryScreen`'s self-contained phase-dispatch shape rather than routing keys through `AppShell`'s central `useInput`. `run` takes the store as a parameter (not a closure over the module-level singleton), matching `RepoRegistryScreen`'s own `useStore`-as-prop dependency-injection convention:

```ts
export const COMMANDS: readonly Command[] = [
  { name: 'registry', run: (useStore) => useStore.getState().openRegistryScreen() },
];
```

`commandBarOpen` lives in the store (like `registryScreenOpen`, not `filterOpen`'s local placement originally sketched here) so that a mounted zone screen can read it too — see Spec Change Log.

## Verification

**Commands:**
- `npm test` -- all suites green, including new `commands`/`command-bar`/`app-shell` cases
- `npm run typecheck` -- clean
- `npm run depcheck` -- no boundary violations (new files confined to `adapters/driving/tui`)

**Manual checks:**
- From Dashboard, press `:` — bar opens with the full command list. Type `reg` — list filters to `registry`. Press `Tab` — input completes to `registry`. Press `Enter` — repo-registry screen opens, bar closes. Reopen with `:`, press `Esc` — bar closes without executing. Press `:` while help/filter/registry is open — nothing happens.

## Suggested Review Order

**Ink `useInput` fan-out fix (review-caught, see Spec Change Log)**

- Entry point — `commandBarOpen` moved into the store so a mounted zone can read it.
  [`app-store.ts:189`](../../../src/adapters/driving/tui/store/app-store.ts#L189)

- The actual fix: `EdtsZone`'s own `useInput` stops reacting while the bar owns input.
  [`edts-zone.tsx:857`](../../../src/adapters/driving/tui/zones/edts/edts-zone.tsx#L857)

**Command dispatch — `:` wiring**

- The bug this story corrects: `:` now opens the bar instead of the registry screen directly.
  [`app-shell.tsx:162`](../../../src/adapters/driving/tui/app-shell.tsx#L162)

- Overlay-exclusivity guard extended with the new flag, mirroring the other three overlays.
  [`app-shell.tsx:144`](../../../src/adapters/driving/tui/app-shell.tsx#L144)

- Command bar mounted the same way `RepoRegistryScreen`/`KeybindingHelp` already are.
  [`app-shell.tsx:201`](../../../src/adapters/driving/tui/app-shell.tsx#L201)

**Command bar — self-contained input handling**

- The bar's own `useInput`: typing, filter, Tab-autocomplete, Enter-run/unknown, Esc-cancel.
  [`command-bar.tsx:57`](../../../src/adapters/driving/tui/shared/command-bar.tsx#L57)

- Tab-autocomplete extracted as its own pure function — the 2+-match branch is unreachable via a real keypress today, so it's unit-tested directly instead.
  [`command-bar.tsx:42`](../../../src/adapters/driving/tui/shared/command-bar.tsx#L42)

**Command registry**

- The static registry and its pure prefix-match / exact-match helpers — no core/port change.
  [`commands.ts`](../../../src/adapters/driving/tui/commands/commands.ts)

**Peripherals**

- Real-keypress coverage for the fan-out regression, the full I/O matrix, and the two new overlay-guard cases.
  [`app-shell.interaction.test.tsx:258`](../../../src/adapters/driving/tui/app-shell.interaction.test.tsx#L258)

- Unit coverage for the command bar's own pure functions, including the ambiguous-match case.
  [`command-bar.test.tsx`](../../../src/adapters/driving/tui/shared/command-bar.test.tsx)

- Unit coverage for the registry's filter/exact-match helpers.
  [`commands.test.ts`](../../../src/adapters/driving/tui/commands/commands.test.ts)

- Two stale comments corrected to stop describing `:` as opening the registry screen directly.
  [`repo-registry-screen.tsx:3`](../../../src/adapters/driving/tui/shared/repo-registry-screen.tsx#L3)
</content>
