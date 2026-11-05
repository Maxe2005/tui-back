---
title: 'Terminal View in the TUI'
type: 'feature'
created: '2026-11-04'
status: 'done'
baseline_commit: 'c20a970d100a4bf07d28c35b413516a01c7b5838'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-9-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The registry lists `terminal-service` (`Ctrl+T`) and `terminal-container` (`Ctrl+X`) since Story 9.2, but `runAction` ignores them: nothing lets the developer type a command on a service or its container from the TUI.

**Approach:** An app-level terminal overlay backed by one `core/shell` session, opened from the Dashboard's focused row through the registry: header (target, cwd, running indicator), the shared `ScrollableOutput`, a prompt at the bottom.

## Boundaries & Constraints

**Always:**
- Keys (decided by the user 2026-11-04): prompt focused — Enter run, `↑/↓` history, `Ctrl+C` cancels the running command (idle: clears the draft), `Tab` moves focus to the output and back, `Ctrl+F` toggles fullscreen from either focus (documented deviation from the AC's bare `F`, which must stay typeable), `Esc` closes. Output focused — `↑/↓` scroll, `PgUp/PgDn` page, `?` opens help; any printable key returns focus to the prompt.
- `Esc` while a command runs asks a confirmation (Enter = cancel it and close, Esc = keep); `Ctrl+C` never quits the app.
- History: one in-memory list shared by every terminal for the app run, never persisted, via `tui/shared/input-history` (`pushHistoryEntry`, `resolveHistoryBrowseUp/Down`).
- Closing discards the session (running command cancelled, cwd and output dropped); reopening starts fresh. Every exit path of the app cancels it too.
- The overlay owns the keys (Story 7.11): zones, global shortcuts and `q` are inert while it is open. Footer and `?` rows come from `FOOTER_CONTEXTS`/`KEYBINDINGS`. AD-19: only windowed `.map`, every dynamic line truncated or clamped.
- stdout `colors.text`, stderr `colors.error`; the echoed `$ <command>` and status lines (`exit N`, `cancelled`, errors) are display-only, dim.

**Ask First:** changing the registry's entries/keys, `ScrollableOutput`/`FullscreenFrame` props, or the `core/shell` contract.

**Never:** a PTY or new dependency; Logs-tab entry points or `R`/`O` rerouting (Story 9.5); `child_process` outside adapters; persisting history.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Service command | `Ctrl+T`, type `ls`, Enter | `$ ls` then stdout lines; header cwd = repo path; running indicator during the run | N/A |
| `cd` | `cd src` then `pwd` | header cwd updates; `pwd` prints `<repo>/src` | bad `cd`: stderr line, cwd kept |
| Container | `Ctrl+X` on a running container | header names the container; commands run via `docker exec` | `container-not-running` → one error status line, prompt usable |
| Cancel | `sleep 30`, `Ctrl+C` | `cancelled` status line, indicator off, app still open | N/A |
| Busy prompt | Enter while running | draft kept, not run | dim notice "a command is running" |
| TTY / blank | `vim` / empty Enter | `tty-required` hint line / no-op | never hangs |
| Esc running | `Esc` during `sleep 30` | confirm line; Enter cancels + closes, Esc keeps | N/A |
| Unwired | no `shell` port in deps | view opens with an error line, prompt disabled | no throw |
| Long output | 10 000 lines | last `DEFAULT_MAX_LINES` kept + `N lines dropped` marker | N/A |

</frozen-after-approval>

## Code Map

- `src/core/shell/index.ts` -- `createShellSession(deps, target)` → `run(command, onLine)` (never rejects), `cancel`, `cwd`, `isRunning`; `line-buffer.ts` `createLineBuffer`, `DEFAULT_MAX_LINES`, `markerText`.
- `src/adapters/driven/shell-session/index.ts:79` -- `createShellSessionPort()`; not yet wired anywhere.
- `src/adapters/driving/tui/store/app-store.ts:61` -- `AppStoreDeps` (add optional `shell?: ShellSessionPort`), slice composition at L117.
- `src/adapters/driving/tui/store/slices/realign-slice.ts` -- overlay slice precedent (`realignScreenOpen`, open/close).
- `src/adapters/driving/tui/store/slices/dashboard-slice.ts:136` -- `runAction`: unknown ids return early; terminals land here after the fresh-availability check (L196).
- `src/adapters/driving/tui/zones/dashboard/dashboard-zone.tsx:101` -- `Ctrl+<letter>` dispatch; rows carry `service` (`core/dashboard/snapshot.ts:36`).
- `src/adapters/driving/tui/shared/hooks/use-zone-input-active.ts` -- the one overlay predicate; add the terminal flag.
- `src/adapters/driving/tui/app-shell.tsx:309,343,350,429` -- overlay exclusions for resize, help, zone switch/quit, and overlay mounting; ZoneScreen stays mounted.
- `src/adapters/driving/tui/keybindings/footer-contexts.ts:324,366-368` -- context declarations, `FooterOwner`, `FOOTER_OVERLAY_OWNERS`; `keybindings.ts:211-224` Dashboard `Ctrl+O/R/L` rows (`when: 'service-focused'`).
- `src/adapters/driving/tui/shared/components/scrollable-output.tsx`, `fullscreen-frame.tsx`, `text-input-line.tsx` (`windowAroundCaret`), `shared/scrollable-output/` (`adjustScrollOffset`) -- reuse, unchanged.
- `src/adapters/driving/tui/shared/test-support/dialog-registry.tsx:274` -- add terminal fixtures (matrix bounds).
- `src/bin/tui.ts:170,205-226` -- store deps; exit/SIGINT/SIGTERM cleanup idiom (`stopAllLogsPanes`).
- `EXPERIENCE.md:86` terminal-view row; deviation table ~L256.

## Tasks & Acceptance

**Execution:**
- [x] `src/adapters/driving/tui/store/slices/terminal-slice.ts` (+ test) -- `terminalOpen`, target `{kind, repoPath, label}`, display lines (bounded, dropped count), cwd, running, fullscreen, notice, shared `terminalHistory`; `openTerminal(repoPath, kind, service)` (container name from `manifest.load`), `runTerminalCommand`, `cancelTerminalCommand`, `toggleTerminalFullscreen`, `closeTerminal` (cancels); session held in the slice closure; streamed lines batched (≤ one store update per ~50 ms); register in `app-store.ts` -- one owner for the session.
- [x] `src/adapters/driving/tui/store/slices/dashboard-slice.ts` (+ test) -- `runAction` maps `terminal-service`/`terminal-container` to `openTerminal` -- registry-driven, no new availability rule.
- [x] `src/adapters/driving/tui/shared/terminal-view.logic.ts` (+ test) -- pure key resolution per focus/state, footer context id, status-line text -- testable decisions.
- [x] `src/adapters/driving/tui/shared/terminal-view.tsx` (+ interaction test) -- windowed: double-bordered surface box, height `max(8, ⌊2/3·bounds.rows⌋)` capped at bounds; fullscreen: `FullscreenFrame` over the whole zone region; local draft/cursor/focus/scroll/confirm state; input gated on `!helpOpen`.
- [x] `src/adapters/driving/tui/app-shell.tsx`, `shared/hooks/use-zone-input-active.ts` -- add `terminalOpen` to every overlay exclusion, mount the view; hide (not unmount) ZoneScreen while fullscreen.
- [x] `src/adapters/driving/tui/keybindings/footer-contexts.ts`, `keybindings.ts` (+ tests) -- owner `terminal` (overlay); contexts `terminal-prompt`, `terminal-output`, `terminal-running`, `terminal-confirm-close`; Dashboard rows `Ctrl+T` terminal, `Ctrl+X` container terminal (`service-focused`).
- [x] `src/adapters/driving/tui/shared/test-support/dialog-registry.tsx` -- fixtures: idle, running with 5000 `LONG_TEXT` lines, fullscreen, confirm-close.
- [x] `src/bin/tui.ts` -- wire `shell: createShellSessionPort()`; `closeTerminal()` on exit/SIGINT/SIGTERM.
- [x] `EXPERIENCE.md` -- terminal-view row: `Tab` focus, `Ctrl+F` fullscreen; deviation row for `Ctrl+F` vs bare `F`.

**Acceptance Criteria:**
- Given a focused Dashboard service, when `Ctrl+T` (or `Ctrl+X` on an available container) is pressed, then the terminal overlay opens on that target and the zone below receives no key.
- Given the overlay open, when `q`, `:`, `?` (prompt focused) or a zone mnemonic is typed, then it lands in the prompt as text and nothing global fires.
- Given `npm test && npm run typecheck && npm run depcheck`, then all pass, bounded-rendering and dialog-registry guards included.

## Spec Change Log

## Design Notes

The view is an app-level overlay (like `RealignDialog`), not a `ModalDialog`: its body must be a measured, flex-grown box for `ScrollableOutput`, which `ModalDialog`'s shrink-0 scroll body would defeat. Scroll offset resets to the tail when a new command starts.

## Verification

**Commands:**
- `npm test` -- expected: all green
- `npm run typecheck && npm run depcheck` -- expected: no errors

**Manual checks:**
- `node src/bin/tui-back.mjs` in a real terminal: `Ctrl+T` on a service, run `ls`, `cd src`, `sleep 30` + `Ctrl+C`, `Ctrl+F`, `Esc` while running.

## Suggested Review Order

**Terminal session ownership (entry point)**

- One slice owns the `core/shell` session; runs decided synchronously, `{ accepted, done }`.
  [`terminal-slice.ts:54`](../../src/adapters/driving/tui/store/slices/terminal-slice.ts#L54)

- Streamed lines batched into one store update per flush interval.
  [`terminal-slice.ts:101`](../../src/adapters/driving/tui/store/slices/terminal-slice.ts#L101)

- Opening resolves the container name from the manifest; unwired shell degrades to an error line.
  [`terminal-slice.ts:50`](../../src/adapters/driving/tui/store/slices/terminal-slice.ts#L50)

- Display text helpers live store-side so the slice never imports the view.
  [`terminal-text.ts:1`](../../src/adapters/driving/tui/store/slices/terminal-text.ts#L1)

**Key handling & rendering**

- Pure key resolution per focus, run state and close confirmation.
  [`terminal-view.logic.ts:58`](../../src/adapters/driving/tui/shared/terminal-view.logic.ts#L58)

- Program output sanitised: escapes stripped, `\r` collapsed, tabs expanded.
  [`terminal-view.logic.ts:147`](../../src/adapters/driving/tui/shared/terminal-view.logic.ts#L147)

- Scrolled-back view stays put while output streams; tail stays pinned.
  [`terminal-view.tsx:97`](../../src/adapters/driving/tui/shared/terminal-view.tsx#L97)

- Handler reads refs, so chunked keypresses never edit a stale draft.
  [`terminal-view.tsx:122`](../../src/adapters/driving/tui/shared/terminal-view.tsx#L122)

**Shell integration & key ownership**

- Help branch first (Esc closes help over the Terminal), then the Terminal owns every key.
  [`app-shell.tsx:302`](../../src/adapters/driving/tui/app-shell.tsx#L302)

- Zone bounds shrink by the windowed terminal's rows; fullscreen hides the zone.
  [`app-shell.tsx:429`](../../src/adapters/driving/tui/app-shell.tsx#L429)

- Footer owner `terminal` registered as an overlay; four terminal contexts.
  [`footer-contexts.ts:332`](../../src/adapters/driving/tui/keybindings/footer-contexts.ts#L332)

**Dashboard entry & wiring**

- Registry terminal ids route to `openTerminal` after the fresh-availability check.
  [`dashboard-slice.ts:162`](../../src/adapters/driving/tui/store/slices/dashboard-slice.ts#L162)

- `Ctrl+T` fallback for unloaded rows; no container fallback (needs live health).
  [`dashboard-zone.tsx:32`](../../src/adapters/driving/tui/zones/dashboard/dashboard-zone.tsx#L32)

- Composition root wires the real shell port and closes the terminal on exit.
  [`tui.ts:197`](../../src/bin/tui.ts#L197)

**Peripherals**

- Dashboard `Ctrl+T` / `Ctrl+X` help and footer rows.
  [`keybindings.ts:226`](../../src/adapters/driving/tui/keybindings/keybindings.ts#L226)

- Registry guard accepts non-ModalDialog overlays for the size matrix.
  [`bounds-dialogs.test.tsx:39`](../../src/adapters/driving/tui/shared/bounds/bounds-dialogs.test.tsx#L39)

- Terminal fixtures at every matrix size.
  [`dialog-registry.tsx:280`](../../src/adapters/driving/tui/shared/test-support/dialog-registry.tsx#L280)

- UX doc: decided keys and the `Ctrl+F` / `Tab` deviation.
  [`EXPERIENCE.md:257`](../planning-artifacts/ux-designs/ux-tui-back-2026-08-10/EXPERIENCE.md#L257)
