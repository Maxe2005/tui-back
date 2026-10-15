// Alt-screen enter/exit and resize re-render, without a pty library: a fake stdout/stdin
// reporting `isTTY: true` (shared/test-support/fake-tty.ts) drives Ink's real alternate-screen
// and resize machinery, which renderToString's `interactive: false` harness skips.
import { createElement } from 'react';
import { render } from 'ink';
import { describe, it, expect } from 'vitest';
import { AppShell } from './app-shell.js';
import { createAppStore } from './store/app-store.js';
import { FakeTtyStdout, fakeTtyStdin } from './shared/test-support/fake-tty.js';

describe('AppShell alternate-screen rendering', () => {
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
      // Alt-screen entered on mount (ansi-escapes' enterAlternativeScreen = ESC + '?1049h').
      expect(stdout.output).toContain('[?1049h');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
    // Alt-screen restored on exit (exitAlternativeScreen = ESC + '?1049l').
    expect(stdout.output).toContain('[?1049l');
  });

  it('clips content to the terminal height on resize instead of spilling past it', async () => {
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
