---
title: ':reset command — selective tool reset with hardened confirmation'
type: 'feature'
created: '2026-09-29'
status: 'done'
baseline_commit: '68057bdcff11b564b6abef61761c464f5dbdaf25'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Resetting tui-back for testing means hand-deleting files across three XDG dirs (`edts.yaml`, `share/tui-back/edts/`, `registry.yaml`, fields inside `state.json`) — error-prone and undiscoverable.

**Approach:** A new `:reset` command opens a full-screen overlay where the developer selects categories (EDTs, histories, registered services), reviews an exact summary, then types the word `reset` to execute. A core use-case performs the deletion; the TUI store then rehydrates.

## Boundaries & Constraints

**Always:**
- Categories: **EDTs** = every `edts.yaml` entry removed, `edtsBaseDir` contents (per-EDT dirs, `<ulid>.db`, action logs) deleted, `activeEdt` set to `null` in `state.json`. **Histories** = `filterHistory` emptied in `state.json` (the only persisted history today). **Services** = every `registry.yaml` entry removed.
- Checking **Services** force-checks **EDTs** and the EDTs checkbox cannot be unchecked while Services is checked.
- Three-step flow: (1) checkboxes, all unchecked on open, Space toggles, Enter advances only if ≥1 checked; (2) summary listing exactly what goes (EDT topics, service count, files); (3) text input — Enter executes only when the input equals `reset` exactly (case-sensitive, no trim); any other Enter is a no-op. Esc cancels from any step with zero writes.
- `:reset` is refused (no overlay opened, reason shown) while `runInProgress` or an EDT action (`currentEdtAction`) is in progress.
- Git is never touched: member branches and `tui-back:<ulid>` stashes stay. The result screen lists every left-behind `service / repoPath / branch` from the reset EDTs.
- Mutations run under the existing action locks (`edtRegistryResourceKey`, `registryResourceKey`). Partial failure reports per-category outcome; no rollback.
- After execution the store rehydrates: `loadEdts`, `loadTabVisibility`, `checkRegistryEmpty`, `loadFilterHistory`.

**Ask First:** Any change to `settings.yaml`, `splitterRatios`, or git state.

**Never:** No backup copies. No CLI subcommand. No raw keybinding for reset (command bar only). No deletion of `settings.yaml`, `splitterRatios` or lock files.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| ALL | 3 categories, 2 EDTs, 4 services | edts.yaml empty, edtsBaseDir empty, activeEdt null, filterHistory `{}`, registry empty; branches listed | N/A |
| HISTORY_ONLY | Histories only | only filterHistory cleared; activeEdt, splitterRatios, EDTs, registry intact | N/A |
| SERVICES_FORCES_EDTS | check Services | EDTs auto-checked + locked; unchecking Services unlocks it (stays checked) | N/A |
| NOTHING_CHECKED | Enter on step 1 | stays on step 1 | N/A |
| WRONG_WORD | `Reset`, `reset `, `rese` + Enter | nothing happens | N/A |
| ESC | Esc at any step | overlay closes, no writes | N/A |
| EMPTY_STATE | no edts.yaml / registry / state.json | succeeds as no-op per category | ENOENT is not an error |
| BUSY | runInProgress or currentEdtAction set | overlay not opened | reason surfaced to user |
| LOCK_HELD | lock acquire fails for one category | other categories still run | that category reported failed with lock error |

</frozen-after-approval>

## Code Map

- `src/adapters/driving/tui/commands/commands.ts` -- COMMANDS registry; add `reset` entry (no `zoneId`), guard like `quit`.
- `src/adapters/driving/tui/store/slices/settings-slice.ts` -- open/close overlay triplet pattern to mirror.
- `src/adapters/driving/tui/store/app-store.ts` -- compose new slice; `AppStoreDeps` already has `edtRegistry`, `registry`, `state`, `lock`, both resource keys, `edtsBaseDir`.
- `src/adapters/driving/tui/app-shell.tsx:176-192,291,325,338,418-419` -- overlay flags gating global shortcuts; mount point for screens. New flag must join every `!settingsScreenOpen` guard.
- `src/adapters/driving/tui/shared/settings-screen.tsx:360` -- self-contained `useInput` + pure-function key handling pattern (useInput itself is untestable; logic lives in pure functions).
- `src/adapters/driving/tui/shared/components/{checkbox-list-item,text-input-line,dim-annotation}.tsx` -- reuse for steps 1/3.
- `src/core/edt/delete.ts:236-250` -- `deleteEdtFiles` precedent (direct `node:fs` rmSync in core, errors logged not thrown).
- `src/core/scripts/reset.ts` -- existing `register --reset`; unrelated name clash, do not modify.
- `src/core/locking.ts` -- `withActionLock`.
- `src/core/ports/state.ts:24` + `src/adapters/driven/state/index.ts:227` -- `writeActiveEdt(ulid: string)`; schema already allows `null` (`schema.ts`). Callers: `core/edt/activate.ts:167`, `core/edt/switch.ts:298`.
- `src/core/ports/registry.ts` -- `list()` + `remove(path)` suffice to empty the registry (no new port method).
- `src/core/ports/edt-registry.ts:42,54` -- `list()` + `remove(ulid)`.
- `src/adapters/driving/tui/store/slices/{edt,navigation,registry,logs}-slice.ts` -- rehydration actions `loadEdts`, `loadTabVisibility`, `checkRegistryEmpty`, `loadFilterHistory`; `runInProgress`, `currentEdtAction`.

## Tasks & Acceptance

**Execution:**
- [x] `src/core/ports/state.ts`, `src/adapters/driven/state/index.ts` -- widen `writeActiveEdt` to `string | null` (+ adapter test) -- clearing the pointer without a new method.
- [x] `src/core/scripts/reset-tool.ts` (+ `.test.ts`) -- `resetTool({ categories, edtRegistry, registry, state, lock, keys, edtsBaseDir })` returning per-category `{ ok | failed }` and `leftBranches`; enforces services⇒edts; covers I/O matrix rows ALL, HISTORY_ONLY, EMPTY_STATE, LOCK_HELD with fakes.
- [x] `src/adapters/driving/tui/shared/reset-screen.logic.ts` (+ `.test.ts`) -- pure step/checkbox/confirm-word state machine: SERVICES_FORCES_EDTS, NOTHING_CHECKED, WRONG_WORD, ESC.
- [x] `src/adapters/driving/tui/store/slices/reset-slice.ts` (+ `.test.ts`), `app-store.ts` -- `resetScreenOpen`, `openResetScreen` (BUSY guard), `closeResetScreen`, `runReset` (calls use-case then rehydrates), result state.
- [x] `src/adapters/driving/tui/shared/reset-screen.tsx` (+ render test) -- 3 steps + result view (per-category outcome, left-behind branches), danger styling.
- [x] `src/adapters/driving/tui/app-shell.tsx`, `commands/commands.ts` (+ tests) -- mount overlay, add to overlay guards, register `reset`.

**Acceptance Criteria:**
- Given the overlay on step 3, when anything other than exactly `reset` is typed and Enter pressed, then no file is modified.
- Given a completed reset of EDTs, when the overlay closes, then the EDTs zone and top bar show no EDT without restarting the TUI.
- Given a completed reset, when the result view shows, then every left-behind branch is listed with its repo.

- **Review patch (2026-09-30), no loopback:** reviewers found that running Services after a failed EDT reset leaves EDTs pointing at unregistered repos — the exact state the "Services force-checks EDTs" rule exists to prevent. `resetTool` now skips Services (reported failed, `reset-skipped-edts-failed`) when the EDT category failed; Histories still run independently. This narrows the LOCK_HELD matrix row ("other categories still run") to categories that do not depend on the failed one. Flagged to the human at presentation.

## Design Notes

Deletion order: EDTs (list → collect branches → remove entries under lock → rm edtsBaseDir children → `writeActiveEdt(null)`), then histories (`writeFilterHistory({})`), then services (list → `remove` each under lock). Store rehydration after disk writes avoids racing the logs slice's save chain.

## Verification

**Commands:**
- `npm run typecheck` -- expected: no errors
- `npm test` -- expected: all green
- `npm run depcheck` -- expected: no violations

**Manual checks:**
- Run the TUI, `:reset`, check each flow against the I/O matrix; inspect `~/.config/tui-back/` and `state.json` afterwards.

## Suggested Review Order

**Core deletion use-case**

- Entry point: category order, per-category outcome, services skipped when EDTs fail
  [`reset-tool.ts:72`](../../src/core/scripts/reset-tool.ts#L72)

- EDT reset under lock: pointer cleared first, entries removed, branches collected
  [`reset-tool.ts:100`](../../src/core/scripts/reset-tool.ts#L100)

- The destructive primitive: wipes `edtsBaseDir` children, guarded against empty/relative paths
  [`reset-tool.ts:144`](../../src/core/scripts/reset-tool.ts#L144)

- Services ⇒ EDTs rule enforced in core, not only in the UI
  [`reset-tool.ts:64`](../../src/core/scripts/reset-tool.ts#L64)

- Registry emptied via existing `list` + `remove`, no new port method
  [`reset-tool.ts:184`](../../src/core/scripts/reset-tool.ts#L184)

- Only port change: `writeActiveEdt` accepts `null`
  [`state.ts:26`](../../src/core/ports/state.ts#L26)
  [`index.ts:227`](../../src/adapters/driven/state/index.ts#L227)

**Hardened confirmation flow**

- Pure state machine: three steps, exact-word gate, summary gated on preview
  [`reset-screen.logic.ts:85`](../../src/adapters/driving/tui/shared/reset-screen.logic.ts#L85)

- Case-sensitive, untrimmed `reset` match
  [`reset-screen.logic.ts:63`](../../src/adapters/driving/tui/shared/reset-screen.logic.ts#L63)

- Checking Services force-checks and locks EDTs
  [`reset-screen.logic.ts:67`](../../src/adapters/driving/tui/shared/reset-screen.logic.ts#L67)

- Overlay: keys read from a ref so fast typing is never dropped
  [`reset-screen.tsx:58`](../../src/adapters/driving/tui/shared/reset-screen.tsx#L58)

**Store orchestration**

- Busy guard: refused while a run or an EDT action is in progress
  [`reset-slice.ts:41`](../../src/adapters/driving/tui/store/slices/reset-slice.ts#L41)

- `runReset`: drain history saves, execute, rehydrate; can never stay stuck on running
  [`reset-slice.ts:146`](../../src/adapters/driving/tui/store/slices/reset-slice.ts#L146)

- Prevents a queued filter-history save from undoing the reset
  [`logs-slice.ts:591`](../../src/adapters/driving/tui/store/slices/logs-slice.ts#L591)

**Wiring**

- `reset` registered as a command only, never a raw keypress
  [`commands.ts:62`](../../src/adapters/driving/tui/commands/commands.ts#L62)

- Overlay flag joins every global-shortcut guard; mount point
  [`app-shell.tsx:299`](../../src/adapters/driving/tui/app-shell.tsx#L299)
  [`app-shell.tsx:429`](../../src/adapters/driving/tui/app-shell.tsx#L429)

**Tests**

- I/O matrix rows against fake ports and a real temp dir
  [`reset-tool.test.ts:139`](../../src/core/scripts/reset-tool.test.ts#L139)

- Single-keypress isolation and the full flow through AppShell
  [`app-shell.interaction.test.tsx`](../../src/adapters/driving/tui/app-shell.interaction.test.tsx)
