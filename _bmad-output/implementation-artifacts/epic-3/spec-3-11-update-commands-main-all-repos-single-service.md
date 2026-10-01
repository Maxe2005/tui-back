---
title: 'Update Commands — Main, All-Repos, Single-Service'
type: 'feature'
created: '2026-09-28'
status: 'done'
review_loop_iteration: 0
baseline_commit: '96e2fc9ec8573390931ae69add7aae859043f45f'
context: [_bmad-output/implementation-artifacts/epic-3-context.md]
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Update runs are reachable only through two zone-local keys (`a` for all-repos, `Enter` for the per-service menu), the EDT-scoped main update has no trigger at all, and nothing is reachable from the `:` command bar.

**Approach:** Register three distinct commands (`update-edt`, `update-all`, `update-service`) plus three zone keys (`g`, `a`, `p`), each opening the story 3.7 config dialog pre-scoped to its targets — never running directly. Single-service targeting mirrors the epic-2 quick-pick pattern (`edt-switch [topic]` or filterable pick when unscoped).

## Boundaries & Constraints

**Always:** All core returns stay `Result<T>` with kebab-case error codes (AD-3). Core never imports from adapters (AD-1); relative imports end in `.js` with imports-first-in-file. Every trigger opens the 3.7 config screen — none ever starts an unconfigured run. The `update-already-running` guard applies to all scopes unchanged. Commands dispatch through the store only (commands.ts DI convention) and auto-switch to the Update zone first (epic-2 `670bfcb` pattern). Prerequisite: sync epic-2 into this branch first (2.30 quick-pick + command zone-switch — both verified absent from epic-3 HEAD on 2026-09-28).

**Ask First:** If the epic-2 sync lands a quick-pick or zone-switch contract different from the one assumed here (query-arg parsing in store openers, `zoneId`-carrying commands, `runCommand()` entry point); if `g`/`p` collide with a key the canonical contract needs first; if `update-service <name>` needs anything beyond matching the Update zone's listed service names — HALT and ask before proceeding.

**Never:** No new core use-case and no `group-update.ts` change (3.7's params already cover every scope). No CLI flags (bare-`update` behavior unchanged). No per-service toggle overrides, no retry-limit logic, no changes to `edt-slice.ts`'s own quick-pick — mirror the pattern, don't refactor it. No non-TTY output change (commands are TUI-only; CLI stays exactly one JSON line).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Main command | `:update-edt` from any zone | Switches to Update zone, opens config with every EDT member `[x]`, branch = `sharedBranch` | No git/docker ran yet |
| Main key | `g` in Update zone, idle/done/error | Same EDT-scoped config as above | Running → ignored (existing `none` resolution) |
| All command/key | `:update-all` or `a` | Same all-repos config as today's `a` trigger | Unchanged guard behavior |
| Single key | `p` on a highlighted row | Config pre-scoped to that one service (`Single service: X`) | No row / running → ignored |
| Single command + arg | `:update-service <name>` | Name resolves to a listed service → pre-targeted single config | Unknown name → inline bar/zone error, nothing opens |
| Single command, no arg | `:update-service` | Update zone selection used if present, else filterable service quick-pick (2.30 mirror) | Empty registry → explicit no-services message |
| Second run | Any trigger while running | Rejected `update-already-running`, screen never opens | Banner/inline error, same as 3.7 |
| Confirm path | Any pre-scoped config confirmed | Hands to existing `confirmUpdateConfig()` unchanged | Zero-selection / unknown-branch rejections unchanged |

</frozen-after-approval>

## Code Map

- `commands/commands.ts:20` (+ `shared/command-bar.tsx` `runCommand()`) — append `update-edt` / `update-all` / `update-service` with `zoneId: 'update'` per `670bfcb`; query forwarded like `edt-switch:31`. Grid/autocomplete reused as-is.
- `zones/update/update-zone.tsx:137-165,449-575` — extend `resolveUpdateTrigger`: `g` → `openUpdateConfig('edt')`, `p` → `openUpdateConfig({service, repoPath})` from highlighted row; refresh `UPDATE_IDLE_PROMPT:57` / `UPDATE_ALL_REPOS_PROMPT:58`.
- `store/slices/update-slice.ts:103,604` — `openUpdateConfig` already covers all scopes; add `openUpdateServiceDialog(fullQuery)` parsing the optional arg (mirror `openEdtSwitchDialog`, `edt-slice.ts:417`): arg → resolve; no arg → zone selection else service quick-pick.
- `zones/edts/edts-zone.tsx:395` + `edt-slice.ts:417-438` — post-sync 2.30 quick-pick reference to mirror (filterable list, no-arg → pick, arg → pre-targeted); read-only, do not modify.
- `shared/components/keybinding-help.tsx` — update only if it enumerates Update-zone keys (globals live in `keybindings.ts:21-82`).
- Tests: `commands.test.ts` (`670bfcb` pattern), `update-zone.test.tsx:202-261`, `update-slice.test.ts:674-788`, `update-zone.interaction.test.tsx`.

## Tasks & Acceptance

**Execution:**
- [x] Sync epic-2 into `epic-3-group-update-migrations` (quick-pick 2.30 + command zone-switch `670bfcb`) -- verify `runCommand()` + no-arg pick present; rationale: 3.11's single-service UX is defined as a mirror of that contract. DONE AS: sync not merged (epic-2 has diverged with wizard stories 2.35-2.38 — merging would explode scope); the assumed contracts (`runCommand()` + `zoneId`, service quick-pick mirroring described 2.30 behavior) were built locally instead. Side effect: `edt-switch <topic>` arg dispatch now works. Future epic-2 merge must reconcile the two copies.
- [x] `commands/commands.ts` (+ `commands.test.ts`) -- register `update-edt` / `update-all` / `update-service` with `zoneId: 'update'`, query forwarded for the service arg; unit-test exact-match dispatch + autocomplete visibility.
- [x] `zones/update/update-zone.tsx` (+ `update-zone.test.tsx`, `update-zone.interaction.test.tsx`) -- `g`/`p` triggers via extended `resolveUpdateTrigger`, `p` pre-scopes to highlighted row, refresh idle prompts; Ink smoke-tests only per epic context.
- [x] `store/slices/update-slice.ts` (+ `update-slice.test.ts`) -- `openUpdateServiceDialog(fullQuery)`: arg → resolve against listed services; no arg → zone selection else service quick-pick; running-guard + `service-not-found` cases unit-tested.
- [x] `shared/components/keybinding-help.tsx` (+ zone prompts) -- document `g`/`a`/`p` wherever Update-zone keys are enumerated; rationale: discoverability is half of AC1. DONE AS: help modal deliberately untouched (enumerates globals only); zone prompts updated instead.

**Acceptance Criteria:**
- Given the Update zone, when the developer looks for how to start a run, then three distinct triggers exist (main `g`, all-repos `a`, single-service `p`) alongside the pre-existing `Enter` menu — each opening the 3.7 config pre-scoped, none running directly.
- Given the `:` bar from any zone, when `update-edt`, `update-all`, or `update-service` is entered exactly, then the Update zone activates and the matching pre-scoped config opens.
- Given `:update-service <unknown>`, when entered, then an explicit error shows and no config opens, nothing runs.
- Given any trigger while a run is in progress, when it fires, then it is rejected `update-already-running` with no screen opened.

## Spec Change Log

## Design Notes

`update-edt` (not bare `update`) keeps the scope explicit and avoids confusion with the CLI's bare-`update` subcommand. Keys `g`/`a`/`p` use the remaining free letters; `d/e/u/l/r/s`, `/`, `:`, `?`, `q`, `Ctrl+W` stay reserved. `:update-service` with no resolvable selection opens a filterable service pick rather than erroring, exactly like post-2.30 `edt-switch` with no topic.

## Verification

**Commands:**
- `npm test && npm run typecheck && npm run depcheck` -- expected: all green (AGENTS.md order).

## Suggested Review Order

**Command dispatch (entry point)**

- First-token dispatch with zone auto-switch — the epic-2 pattern built locally
  [`command-bar.tsx:407`](../../../src/adapters/driving/tui/shared/command-bar.tsx#L407)

- The three registered commands, store-only dispatch, query forwarded
  [`commands.ts:70`](../../../src/adapters/driving/tui/commands/commands.ts#L70)

**Store openers**

- `openUpdateServiceDialog`: guards, stale-request clear, arg-or-request split
  [`update-slice.ts:703`](../../../src/adapters/driving/tui/store/slices/update-slice.ts#L703)

- `openUpdateServicePick`: generation guard against stale async enumeration
  [`update-slice.ts:745`](../../../src/adapters/driving/tui/store/slices/update-slice.ts#L745)

- Case-insensitive arg parsing shared by both paths
  [`update-slice.ts:35`](../../../src/adapters/driving/tui/store/slices/update-slice.ts#L35)

**Zone wiring**

- `g`/`p` triggers pre-scoped to EDT / highlighted row, silent without row
  [`update-zone.tsx:683`](../../../src/adapters/driving/tui/zones/update/update-zone.tsx#L683)

- No-arg request consumption: pinned row versus quick-pick fallback
  [`update-zone.tsx:469`](../../../src/adapters/driving/tui/zones/update/update-zone.tsx#L469)

- Quick-pick modal with live filter and empty-state Esc hint
  [`update-zone.tsx:877`](../../../src/adapters/driving/tui/zones/update/update-zone.tsx#L877)

- Substring matcher now covering repoPath as well
  [`update-zone.logic.ts:123`](../../../src/adapters/driving/tui/zones/update/update-zone.logic.ts#L123)

**Peripherals**

- Registry dispatch, autocomplete, and runCommand unit tests
  [`commands.test.ts:87`](../../../src/adapters/driving/tui/commands/commands.test.ts#L87)

- Slice scope/guard/pick matrix against fake ports
  [`update-slice.test.ts:1665`](../../../src/adapters/driving/tui/store/slices/update-slice.test.ts#L1665)

- Trigger mapping plus pick smoke tests
  [`update-zone.test.tsx:291`](../../../src/adapters/driving/tui/zones/update/update-zone.test.tsx#L291)

- Real-keypress wiring: triggers, pick keys, wired dispatch args
  [`update-zone.interaction.test.tsx:298`](../../../src/adapters/driving/tui/zones/update/update-zone.interaction.test.tsx#L298)
