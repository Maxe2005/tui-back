// Story 2.8: alt-screen enter/exit and resize re-render are otherwise unautomatable — the
// repo has no pty library (AGENTS.md), so `tui-back.e2e.test.ts` only exercises the CLI's
// non-TTY branch and `render-to-string.ts`'s harness deliberately renders `interactive:
// false` (alternateScreen is a documented no-op there). This file closes that gap without a
// real pty: a fake stdout/stdin that report `isTTY: true` is enough to drive Ink's actual
// alternate-screen and resize machinery — the same technique `render-to-string.ts` already
// uses for its fake TTY stdin, just with `interactive: true` instead of `false`.
// Story 2.9 extracted the fakes themselves to `shared/test-support/fake-tty.ts` so the new
// real-keypress interaction tests (edts-zone.interaction.test.tsx) reuse this exact
// technique instead of re-declaring it.
import { createElement } from 'react';
import { render } from 'ink';
import { describe, it, expect } from 'vitest';
import { AppShell } from './app-shell.js';
import { createAppStore } from './store/app-store.js';
import { FakeTtyStdout, fakeTtyStdin } from './shared/test-support/fake-tty.js';

describe('AppShell alternate-screen rendering (AC1, AC2, AC3)', () => {
  it('enters the alternate screen on mount and exits it on unmount', async () => {
    const stdout = new FakeTtyStdout();
    const stdin = fakeTtyStdin();
    const store = createAppStore();

    const instance = render(
      createElement(AppShell, { useStore: store, onQuit: () => {} }),
      {
        stdout: stdout as unknown as NodeJS.WriteStream,
        stdin,
        interactive: true,
        alternateScreen: true,
        exitOnCtrlC: false,
        patchConsole: false,
      },
    );

    try {
      // Deterministic instead of a fixed setTimeout: Ink throttles renders to `maxFps`
      // (default 30, ~34ms window), so a fixed short sleep can race the throttle's
      // trailing edge under CI load. waitUntilRenderFlush() resolves once the current
      // frame is actually written to stdout.
      await instance.waitUntilRenderFlush();
      // AC1: alt-screen entered on mount (ansi-escapes' enterAlternativeScreen = ESC + '?1049h').
      expect(stdout.output).toContain('[?1049h');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
    // AC3: alt-screen restored on exit (exitAlternativeScreen = ESC + '?1049l').
    expect(stdout.output).toContain('[?1049l');
  });

  it('clips content to the terminal height on resize instead of spilling past it (AC2)', async () => {
    // Isolating rows alone (columns held fixed) matters: Ink's own internal resize
    // handler re-triggers layout/render on ANY 'resize' event regardless of what
    // changed, so an assertion that only checks "did output grow" would still pass even
    // without AppShell's own height={rows} binding — it'd just be observing Ink's
    // pre-existing column-driven repaint. Shrinking rows far below the chrome's natural
    // height and asserting the rendered frame's line count is capped near the new row
    // count is a signal that specifically depends on AppShell's height+overflow binding.
    const stdout = new FakeTtyStdout();
    stdout.rows = 24;
    const stdin = fakeTtyStdin();
    const store = createAppStore();

    const instance = render(
      createElement(AppShell, { useStore: store, onQuit: () => {} }),
      {
        stdout: stdout as unknown as NodeJS.WriteStream,
        stdin,
        interactive: true,
        alternateScreen: true,
        exitOnCtrlC: false,
        patchConsole: false,
      },
    );

    try {
      await instance.waitUntilRenderFlush();
      const chunkCountBeforeResize = stdout.chunkCount;

      // Columns unchanged — only rows shrinks, well below the chrome's natural height.
      stdout.rows = 3;
      stdout.emit('resize');
      // Two renders happen here, not one: Ink's own internal resize handler (registered
      // before AppShell mounts) fires synchronously on 'resize' and repaints with the
      // *old* React state, since useWindowSize's `setSize` — which updates the `rows`
      // AppShell binds `height` to — only runs via its own 'resize' listener, registered
      // later, whose state update flows through React asynchronously. The first
      // waitUntilRenderFlush() below only catches that first, still-unclipped frame; a
      // second one is needed to observe the frame actually clipped to the new height.
      await instance.waitUntilRenderFlush();
      await instance.waitUntilRenderFlush();

      const framesAfterResize = stdout.contentFramesSince(chunkCountBeforeResize);
      expect(framesAfterResize.length).toBeGreaterThanOrEqual(2);
      const lastFrame = framesAfterResize.at(-1) ?? '';
      const renderedLines = lastFrame.split('\n').length;
      // The chrome alone (top bar, zone tabs, footer, plus a zone screen) naturally
      // renders at 9+ lines; if height/overflow stopped tracking rows, this frame would
      // still carry that full unclipped content instead of being capped near the new
      // height (allowing one line of slack for boundary rounding).
      expect(renderedLines).toBeLessThanOrEqual(4);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});
