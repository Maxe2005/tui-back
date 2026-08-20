---
title: 'Fullscreen TUI Rendering'
type: 'feature'
created: '2026-08-19'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'b5becd2c072ad515fcc9da9ee68cf82c2a6096e4'
context:
  - '_bmad-output/planning-artifacts/epics.md'
  - '_bmad-output/planning-artifacts/ux-designs/ux-tui-back-2026-08-10/EXPERIENCE.md'
  - '_bmad-output/planning-artifacts/sprint-change-proposal-2026-08-19.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The TUI renders inline via Ink's default mode — no alternate-screen buffer, no binding to the terminal's dimensions — so it never takes over the terminal the way k9s/lazygit do, contradicting the permanent-chrome experience Story 1.11 requires.

**Approach:** Enable Ink's native `alternateScreen` render option and bind the app shell's root height to the terminal's live row count via Ink's built-in `useWindowSize` hook. Both mechanisms are already shipped in the installed Ink version (7.1.1, verified directly against `node_modules/ink/build/`) — no custom ANSI escapes, signal handlers, or resize listeners needed.

## Boundaries & Constraints

**Always:**
- Use Ink's native `alternateScreen: true` render option (`src/bin/tui.ts`) — verified in `node_modules/ink/build/render.d.ts`: "renders on a separate screen, and the original terminal content is restored when the app exits."
- Use Ink's native `useWindowSize()` hook (`ink` export) for the reactive row count — verified in `node_modules/ink/build/hooks/use-window-size.js`: re-renders the component on every terminal resize.
- Do not add a manual `stdout.on('resize', ...)` listener, manual ANSI escape writes, or manual `SIGINT`/`SIGTERM` handlers — Ink's `alternateScreen` + the `signal-exit` package it already depends on (verified in `node_modules/ink/build/ink.js:256` and `node_modules/signal-exit`) call `unmount()` — which writes the exit-alternate-screen sequence — on every exit path (`process.exit()`, `SIGINT`, `SIGTERM`, an uncaught throw), including the existing `onQuit`'s bare `process.exit(0)` in `tui.ts`. Adding our own handling would duplicate or race Ink's.
- Do not bind an explicit `width` — Ink already sets the root Yoga node's width to the live terminal column count on every layout pass (verified in `node_modules/ink/build/ink.js:320-321`, `calculateLayout()`), independent of any React prop.
- NodeNext `.js` relative imports; imports first in file (depcruise acorn-fallback landmine).

**Ask First:**
- None — mechanism and scope were fixed by the approved sprint-change-proposal; the exact APIs were verified against the installed Ink version during planning, no open design question remains.

**Never:**
- Don't touch the narrow-terminal minimum-width question (EXPERIENCE.md "Open Questions") — explicitly deferred, out of scope.
- Don't change `renderToString`'s test-harness `interactive: false` stdout stub (`shared/components/render-to-string.ts`) — `alternateScreen` is a no-op there by Ink's own design ("Only works in interactive mode"), so existing smoke tests are unaffected by construction.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Launch in a TTY | `tui-back-tui` started interactively | Alt-screen entered; app shell's root `Box` height equals the terminal's current row count | N/A |
| Terminal resized while running | User resizes the terminal window | `useWindowSize()` re-renders `AppShell` with the new row count; root `Box` height updates to match | N/A |
| Quit via `q` | `onQuit` → `process.exit(0)` | Alt-screen restored (original terminal content visible again) before the process actually exits | N/A |
| Quit via Ctrl+C | `exitOnCtrlC` triggers Ink's own exit path | Same alt-screen restoration as `q` | N/A |
| Non-interactive render (tests) | `renderToString`'s `interactive: false` stub | `alternateScreen` and the row-bound height are inert/no-op — existing assertions unaffected | N/A |

</frozen-after-approval>

## Code Map

- `src/bin/tui.ts:63` — `render(createElement(AppShell, { useStore: store, onQuit }), { exitOnCtrlC: true });`: add `alternateScreen: true` to the options object.
- `src/adapters/driving/tui/app-shell.tsx:119` — root `<Box flexDirection="column">`: import `useWindowSize` from `'ink'`, call it inside `AppShell`, bind `height={rows}` (destructure `{ rows }` from the hook's return) and `overflow="hidden"` (Ink's `Box` default is `overflow: visible`, which would let content taller than `rows` spill past the bound height instead of being clipped — a review finding, added alongside `height`).
- `src/adapters/driving/tui/app-shell.alternate-screen.test.tsx` (new, added during the Matrix Test Audit) — a fake-but-`isTTY: true` stdout/stdin, mirroring `render-to-string.ts`'s existing fake-stdin technique but with `interactive: true`, drives Ink's real alt-screen/resize machinery without a pty. Closes the mount (alt-screen entered), resize (root height re-clipped to the new row count), and `unmount()` (alt-screen restored) matrix rows. It does **not** exercise the real `q`/Ctrl+C production exit paths (`process.exit(0)` via `onQuit`, or Ink's own `exitOnCtrlC` handler) — those remain covered only by the manual verification step below, resting on the same `signal-exit`-patches-`process.exit` mechanism documented in Design Notes, not on new code this story adds.

## Tasks & Acceptance

**Execution:**
- [x] `src/bin/tui.ts` -- add `alternateScreen: true` to the `render()` options -- enters/exits the alt-screen buffer automatically on every exit path
- [x] `src/adapters/driving/tui/app-shell.tsx` -- call `useWindowSize()`, bind root `Box`'s `height` to `rows` -- fills the terminal vertically and re-renders on resize
- [x] `src/bin/tui-back.e2e.test.ts` -- confirm no change needed (TUI binary isn't exercised there per AGENTS.md: no pty lib, only the CLI's non-TTY JSON branch is tested) -- document the gap rather than silently skip it
- [x] `src/adapters/driving/tui/app-shell.test.tsx` -- add a render assertion that `AppShell` still renders its full chrome (top bar, zone tabs, footer) with the test harness's fixed 40-row stdout -- guards against the height binding accidentally clipping content
- [x] `src/adapters/driving/tui/app-shell.tsx` -- add `overflow="hidden"` to the root `Box` alongside `height={rows}` -- without it, Ink's default `overflow: visible` lets content taller than the terminal spill past the bound height instead of being clipped, undermining AC2's "without visual artifacts"
- [x] `src/adapters/driving/tui/app-shell.alternate-screen.test.tsx` -- committed regression test (Matrix Test Audit finding: no pty lib was assumed to make this unautomatable, but a fake-`isTTY` stdout/stdin is enough to drive Ink's real alt-screen/resize machinery) -- asserts `[?1049h` on mount and `[?1049l` after `unmount()` against the real `AppShell` through the real installed Ink; a second test shrinks the terminal to 3 rows (columns held fixed, isolating the row-height binding from Ink's own column-driven resize repaint) and asserts the rendered frame's line count is actually clipped near the new row count rather than merely "some new output was written" -- both were verified during review to actually fail if `height`/`overflow` were reverted, not just pass vacuously. A real-terminal glance is still worth doing at least once, but the mechanism itself is now automatically regression-tested, not just trusted.

**Acceptance Criteria:**
- Given the TUI launches in a TTY, when it starts rendering, then it enters the terminal's alternate-screen buffer and the app shell fills exactly the terminal's current rows/columns.
- Given the terminal is resized while the TUI is running, when the resize event fires, then the app shell re-renders to fill the new dimensions without visual artifacts.
- Given the TUI quits (`q`, Ctrl+C, or a crash), when the process exits, then the alternate-screen buffer is restored to the original terminal content — no leftover TUI output remains in the shell.

## Design Notes

Both mechanisms are Ink 7.1.1 built-ins, not custom code — this story is two prop/option additions, not new infrastructure. Confirmed by direct source trace (not documentation alone): `alternateScreen`'s exit-restoration rides on `signal-exit`, which patches `process.exit`/`reallyExit` to emit `'exit'` before the process actually terminates, so Ink's registered `unmount` handler (which writes `ansiEscapes.exitAlternativeScreen`) fires even from the existing bare `process.exit(0)` calls in `tui.ts` — nothing in that file needs to await or call `unmount()` explicitly.

## Verification

**Commands:**
- `npm test` -- expected: all suites green, including the new `app-shell.test.tsx` assertion.
- `npm run typecheck` -- expected: `tsc --noEmit` clean.
- `npm run depcheck` -- expected: no boundary violations (this story touches `src/bin/` and `adapters/driving/tui` only).

**Manual checks (if no CLI):**
- `node src/bin/tui-back-tui.mjs` in a real terminal: the screen clears and fills with the app shell (top bar/tabs/footer visible, content pane extends to the bottom); resize the terminal window and confirm the layout redraws to the new size without stray characters; press `q` and confirm the terminal returns to exactly what was on screen before launch, with the shell prompt appearing immediately after (no leftover TUI frame).

## Suggested Review Order

**Alt-screen entry point**

- The one-line composition-root change that makes the shipped binary enter/exit the terminal's alt-screen buffer.
  [`tui.ts:63`](../../src/bin/tui.ts#L63)

**Height/overflow binding (the "fullscreen" mechanism)**

- `useWindowSize()` gives the live row count; binding it to the root `Box` is the core of AC1/AC2.
  [`app-shell.tsx:71`](../../src/adapters/driving/tui/app-shell.tsx#L71)

- `overflow="hidden"` added alongside `height={rows}` — without it, Ink's default `overflow: visible` lets content taller than the terminal spill past the bound height instead of clipping (review finding).
  [`app-shell.tsx:120`](../../src/adapters/driving/tui/app-shell.tsx#L120)

**Regression coverage for the alt-screen/resize mechanism (no pty required)**

- Mount/unmount test: `[?1049h` on mount, `[?1049l` after `unmount()`, using `waitUntilRenderFlush()` instead of a fixed sleep for determinism.
  [`app-shell.alternate-screen.test.tsx:59`](../../src/adapters/driving/tui/app-shell.alternate-screen.test.tsx#L59)

- Resize test: shrinks rows only (columns held fixed, isolating the row-height binding from Ink's own column-driven resize repaint) and asserts the rendered frame is actually clipped near the new row count — verified during review to fail if `height`/`overflow` were reverted, not just pass vacuously.
  [`app-shell.alternate-screen.test.tsx:92`](../../src/adapters/driving/tui/app-shell.alternate-screen.test.tsx#L92)

**Peripherals**

- Chrome-still-renders smoke check against the existing fixed 40-row `renderToString` harness.
  [`app-shell.test.tsx:36`](../../src/adapters/driving/tui/app-shell.test.tsx#L36)

- Documents why the interactive binary's alt-screen/resize/quit paths are out of this suite's reach (no pty lib) — no behavior change.
  [`tui-back.e2e.test.ts:10`](../../src/bin/tui-back.e2e.test.ts#L10)
