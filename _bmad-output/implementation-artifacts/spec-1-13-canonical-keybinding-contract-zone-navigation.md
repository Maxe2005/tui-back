---
title: 'Canonical Keybinding Contract & Zone Navigation'
type: 'feature'
created: '2026-08-17'
status: 'ready-for-dev'
review_loop_iteration: 0
baseline_commit: '37ea1a9d02943de4e8277c1a632a42a73cd28a69'
context:
  - /home/mchoisel/Documents/IANORD/tui-back/_bmad-output/implementation-artifacts/epic-1-context.md
  - /home/mchoisel/Documents/IANORD/tui-back/_bmad-output/planning-artifacts/epics.md
---

<!-- Target: 900–1300 tokens. Above 1600 = high risk of context rot.
     Never over-specify "how" — use boundaries + examples instead.
     Cohesive cross-layer stories (DB+BE+UI) stay in ONE file.
     IMPORTANT: Remove all HTML comments when filling this template. -->

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The TUI shell exists (Stories 1.11–1.12) but lacks the canonical keybinding contract: zone navigation (`d/e/u/l/r/s`), filter (`/`), command (`:`), quit (`q`), and single-TUI process enforcement (AD-9 mechanism 1). These are the global interaction primitives that must work identically from every zone from day one.

**Approach:** Wire the full canonical keybinding dispatch at the `AppShell` level using pure helper functions (extending the `shouldOpenHelp`/`shouldCloseHelp` pattern from Story 1.12). Add an advisory lock in `src/bin/tui.ts` for single-instance enforcement. Update the footer hints to reflect the complete contract. List navigation keys (`j/k/g/G`) remain per-zone concerns — the app shell does not intercept them.

## Boundaries & Constraints

**Always:**
- Hexagonal boundary (AD-1): `core/` never imports from `adapters/`. All TUI code stays in `src/adapters/driving/tui/`.
- Single Zustand store (AD-10): cross-zone state only in `app-store.ts`; zone screens read via injected `useStore`.
- Pure-function extraction for all key handlers: decision logic extracted, unit-tested without Ink.
- NodeNext imports: relative imports end in `.js` even though files are `.ts`.
- Imports always first in file (depcruise acorn-fallback constraint).
- Error codes kebab-case; CLI renders human text on TTY, exactly one JSON line otherwise; exit code only `0`/`1` (AD-3).
- Single-TUI lock uses XDG_STATE_HOME/tui-back/locks/tui.lock (AD-9); CLI never blocked by TUI lock.
- `q`-quit only when no run in progress (run-in-progress flag deferred to Epic 3/4; v1 always quits immediately).
- Footer hints ordered by expected frequency: move > zone > filter > cmd > help > quit > resize.
- Tests: store/key-helpers unit-tested directly (AD-13); `useInput` inert under `renderToString`.

**Ask First:**
- None — all decisions resolved in epic context and prior stories.

**Never:**
- No dynamic loading of keybindings or zones (AD-5, AD-15 — compiled-in data only).
- No mouse-only actions (UX-DR18 — keyboard parity mandatory).
- No `process.exit()` in core/use-cases; TUI entry point is the exception (interactive-only, no pipe flush concern).
- No modification of Story 1.10's `ModalDialog` border style (pre-existing `"double"` vs DESIGN.md `"bold"` — deferred).
- No per-zone list navigation logic in `AppShell` (belongs in zone screens, Epic 2+).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Zone switch | Press `d`/`e`/`u`/`l`/`r`/`s` | `activeZone` updates; zone screen swaps; pending badge clears on visit | Invalid key → no-op |
| Open filter | Press `/` | Modal opens with stub message "Filter input — wired in Epic 2+" | `Esc` closes |
| Open command | Press `:` | Modal opens with stub message "Command entry — wired in Epic 2+" | `Esc` closes |
| Quit app | Press `q` (no run in progress) | Lock released; process exits 0 | If lock already released → no-op |
| Second TUI instance | `tui-back-tui` while one running | Stderr: "Another TUI instance is already running"; exit 1; no render | Lock file stale (PID dead) → v1 treats as held, error |
| Help modal scroll | Help open, press `j`/`k` | Scroll offset updates; visible slice changes | Offset clamped to [0, maxOffset] |
| Footer hints | App running | Full canonical hint row rendered | Wraps on narrow terminals (accepted, per 1.12) |

</frozen-after-approval>

## Code Map

- `src/adapters/driving/tui/app-shell.tsx` -- Main composition component; adds global key dispatch via `useInput`; extends pure helpers `shouldSwitchZone`, `shouldOpenFilter`, `shouldOpenCommand`, `shouldQuit`; receives `onQuit` prop for quit wiring; renders `KeybindingHelp` over content
- `src/adapters/driving/tui/store/app-store.ts` -- Single cross-zone Zustand store (AD-10); already has `activeZone`, `setActiveZone`, `helpOpen`, `launchBannerShown`; no new fields needed for this story
- `src/adapters/driving/tui/keybindings/keybindings.ts` -- Compiled-in canonical keybinding data (`KEYBINDINGS: readonly Keybinding[]`); single source of truth for help modal and any future keybinding-aware features; 12 rows in canonical order
- `src/adapters/driving/tui/zones/zones.ts` -- Zone metadata (`ZONES: readonly Zone[]`) with `id`, `mnemonic` (`d/e/u/l/r/s`), `label`, `statusColor`; `isZoneId` guard; used by `shouldSwitchZone` to map mnemonics to `ZoneId`
- `src/bin/tui.ts` -- TUI composition root (AD-2); adds single-instance lock acquisition via `acquireTuiLock()` before `render()`; passes `onQuit` to `AppShell`; handles non-TTY guard
- `src/adapters/driving/tui/single-instance.ts` -- NEW: advisory lock utility using `XDG_STATE_HOME/tui-back/locks/tui.lock`; exports `acquireTuiLock(): Promise<{ release: () => Promise<void> } | null>`; uses `resolveXdgPaths` from `src/adapters/driven/xdg/index.ts`
- `src/adapters/driven/xdg/index.ts` -- XDG path resolution (`resolveXdgPaths`, `ensureXdgDir`); used by `single-instance.ts` to resolve `stateDir`
- `src/adapters/driving/tui/shared/components/footer.tsx` -- Updates `DEFAULT_FOOTER_HINTS` to full canonical set; test asserts fragments + ordering
- `src/adapters/driving/tui/shared/components/keybinding-help.tsx` -- Existing read-only help modal; uses `KEYBINDINGS` data; pure helpers `clampHelpOffset`, `resolveHelpWindow`, `resolveHelpScroll`; no changes needed except barrel sync
- `src/adapters/driving/tui/shared/components/modal-dialog.tsx` -- Extended in Story 1.12 with optional `children`/`maxHeight`; reused for filter/command stub modals
- `src/adapters/driving/tui/shared/components/index.ts` -- Barrel export; add `single-instance` if needed (depcruise globs already cover `src/**/*.ts`)
- `src/adapters/driving/tui/shared/README.md` -- Append Story 1.13 bullet documenting global key dispatch, list navigation per-zone, single-instance lock, `q`-quit
- `_bmad-output/implementation-artifacts/sprint-status.yaml` -- Update story status: `backlog` → `in-progress` → `review` → `done`

## Tasks & Acceptance

**Execution:**
- [ ] `src/adapters/driving/tui/single-instance.ts` -- create advisory lock utility using XDG state dir; unit-test with temp dir fixture (exclusive acquisition, release, stale PID handling)
- [ ] `src/bin/tui.ts` -- call `acquireTuiLock()` before render; on failure print error, exit 1; pass `onQuit` to `AppShell` that releases lock and exits 0
- [ ] `src/adapters/driving/tui/app-shell.tsx` -- add pure helpers `shouldSwitchZone`, `shouldOpenFilter`, `shouldOpenCommand`, `shouldQuit`; extend `useInput` to dispatch zone switch, filter/command stub modals, quit; add `onQuit` prop; render filter/command stub modals when triggered
- [ ] `src/adapters/driving/tui/zones/zones.ts` -- no code change; verify `ZONES` mnemonics match canonical contract (`d/e/u/l/r/s`)
- [ ] `src/adapters/driving/tui/shared/components/footer.tsx` -- update `DEFAULT_FOOTER_HINTS` to `[j/k] move  [g/G] top/bottom  [d/e/u/l/r/s] zone  [/] filter  [:] cmd  [?] help  [q] quit  [^W] resize`; update test
- [ ] `src/adapters/driving/tui/shared/components/index.ts` -- ensure barrel exports sync (no new exports needed for this story)
- [ ] `src/adapters/driving/tui/shared/README.md` -- append Story 1.13 documentation bullet
- [ ] `src/adapters/driving/tui/app-shell.test.tsx` -- add tests for new pure helpers; render test with injected store asserting zone switch via `setActiveZone`
- [ ] `src/adapters/driving/tui/store/app-store.test.ts` -- verify `setActiveZone` clears zone event badge (already covered by 1.11 AC3 pattern)
- [ ] `_bmad-output/implementation-artifacts/sprint-status.yaml` -- update status through `in-progress` → `review` → `done`

**Acceptance Criteria:**
- Given any zone, when `d`/`e`/`u`/`l`/`r`/`s` pressed, then `activeZone` updates and corresponding zone screen mounts
- Given app running, when `/` pressed, then filter stub modal opens; `Esc` closes it
- Given app running, when `:` pressed, then command stub modal opens; `Esc` closes it
- Given no run in progress, when `q` pressed, then lock released and process exits 0
- Given second `tui-back-tui` invocation while one running, then stderr shows "Another TUI instance is already running" and exits 1
- Given any list pane, `j`/`k`/`g`/`G`/arrows are NOT handled by `AppShell` (per-zone concern, documented in README)
- Footer renders full canonical hint row in documented order
- All tests pass: `npm test && npm run typecheck && npm run depcheck`

## Review Findings

**Patch findings (unchecked — require code fixes):**
- [ ] [Review][Patch] F1: Lock error not caught in bin/tui.ts — acquireTuiLock() throw not caught; process crashes without error message
- [ ] [Review][Patch] F2: onQuit optional prop risk — if undefined and q pressed, lock not released and process exit blocked
- [ ] [Review][Patch] F3: fd leak in single-instance.ts — writeFileSync throw between openSync and closeSync leaves lock file inconsistent
- [ ] [Review][Patch] F7: runInProgress field no guards — added without type-safe accessors or guards in app-store.ts
- [ ] [Review][Patch] F9: Lock leak on render error — lock acquired before try; release() only in catch/onQuit — potential leak on render error

**Defer findings (checked — pre-existing, not actioned now):**
- [x] [Review][Defer] F6: Story 1-10 status transition — status changed review→done without proper review loopback, pre-existing workflow issue

## Spec Change Log
*empty until first review loopback*

## Design Notes

**Pure-function dispatch pattern (from Story 1.12):**
```typescript
// In AppShell - exported for unit testing
export function shouldSwitchZone(input: string): ZoneId | null {
  const zone = ZONES.find(z => z.mnemonic === input);
  return zone?.id ?? null;
}

export function shouldOpenFilter(input: string): boolean {
  return input === '/';
}

export function shouldOpenCommand(input: string): boolean {
  return input === ':';
}

export function shouldQuit(input: string, key: { escape?: boolean }, state: AppState): boolean {
  return input === 'q' && !state.runInProgress; // runInProgress always false in v1
}
```

**Single-instance lock (AD-9 mechanism 1):**
- Lock file: `XDG_STATE_HOME/tui-back/locks/tui.lock`
- Content: JSON `{ pid: number; timestamp: string }`
- `acquireTuiLock()`: creates lock dir, attempts exclusive write (O_EXCL equivalent via `fs.open` with `'wx'` flag); on success returns releaser; on `EEXIST` reads existing lock, checks if PID alive (via `process.kill(pid, 0)`), if alive returns `null`, if dead could steal but v1 returns `null` (simpler, no stale-lock theft)
- Releaser: `fs.unlink` lock file

**Filter/Command stub modals:**
- Reuse `ModalDialog` with `children` prop (added in Story 1.12)
- Content: `<Text>` with stub message, `colors.text-dim`
- `onCancel={closeFilter}` / `onCancel={closeCommand}` (new store actions or inline handlers)
- Read-only: no confirm action, `Esc` closes

## Verification

**Commands:**
- `npm test` -- expected: all tests pass (unit + integration + e2e)
- `npm run typecheck` -- expected: `tsc --noEmit` clean
- `npm run depcheck` -- expected: no boundary violations (core→adapters, TUI leak)

**Manual checks (if no CLI):**
- Run `tui-back-tui` in a real TTY: verify banner shows once, zone tabs respond to `d/e/u/l/r/s`, footer shows full hint row, `?` opens help, `q` quits, second instance fails with error message
- Verify `j`/`k`/`g`/`G` do nothing at app level (zone screens handle in Epic 2+)