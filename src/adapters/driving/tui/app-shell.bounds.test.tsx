// The shell's bounded-rendering contract: a too-small terminal shows one message and recovers
// live, and at the minimum size top bar, tab bar and footer all stay on screen.
import { createElement } from 'react';
import { render } from 'ink';
import { describe, it, expect } from 'vitest';
import { AppShell } from './app-shell.js';
import { createAppStore } from './store/app-store.js';
import { FakeTtyStdout, fakeInteractiveTtyStdin, fakeTtyStdin } from './shared/test-support/fake-tty.js';
import { MIN_TERMINAL_COLUMNS, MIN_TERMINAL_ROWS } from './shared/bounds/bounds.js';

describe('AppShell bounds', () => {
  it('shows the too-small screen below the minimum and returns live on grow', async () => {
    const stdout = new FakeTtyStdout();
    stdout.columns = 30;
    stdout.rows = 8;
    const instance = render(createElement(AppShell, { useStore: createAppStore(), onQuit: () => {} }), {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: fakeTtyStdin(),
      interactive: true,
      alternateScreen: true,
      exitOnCtrlC: false,
      patchConsole: false,
    });
    try {
      await instance.waitUntilRenderFlush();
      expect(stdout.output).toContain('Terminal too small');
      expect(stdout.output).toContain('40×12');
      expect(stdout.output).toContain('now 30×8');

      const before = stdout.output.length;
      stdout.columns = 120;
      stdout.rows = 40;
      stdout.emit('resize');
      await instance.waitUntilRenderFlush();
      await instance.waitUntilRenderFlush();
      const frame = stdout.output.slice(before);
      expect(frame).toContain('tui-back');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('keeps top bar, tab bar and footer within the frame at the minimum size', async () => {
    const stdout = new FakeTtyStdout();
    stdout.columns = MIN_TERMINAL_COLUMNS;
    stdout.rows = MIN_TERMINAL_ROWS;
    const instance = render(createElement(AppShell, { useStore: createAppStore(), onQuit: () => {} }), {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: fakeTtyStdin(),
      interactive: true,
      alternateScreen: true,
      exitOnCtrlC: false,
      patchConsole: false,
    });
    try {
      await instance.waitUntilRenderFlush();
      const frame = stdout.output.slice(stdout.output.lastIndexOf('tui-back')).replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '\n');
      const lines = frame.split('\n').filter((line) => line.trim() !== '');
      expect(frame).toContain('tui-back');
      expect(frame).toContain('[d]');
      expect(frame).toContain('[?] help');
      for (const line of lines) {
        expect(line.length).toBeLessThanOrEqual(MIN_TERMINAL_COLUMNS);
      }
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('ignores keys while too small and keeps zone-local state across a shrink', async () => {
    const stdout = new FakeTtyStdout();
    stdout.columns = 120;
    stdout.rows = 40;
    const stdin = fakeInteractiveTtyStdin();
    const store = createAppStore();
    let quit = 0;
    const instance = render(createElement(AppShell, { useStore: store, onQuit: () => { quit += 1; } }), {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin,
      interactive: true,
      alternateScreen: true,
      exitOnCtrlC: false,
      patchConsole: false,
    });
    const write = async (chunk: string) => {
      (stdin as unknown as { write: (c: string) => void }).write(chunk);
      await instance.waitUntilRenderFlush();
    };
    try {
      await instance.waitUntilRenderFlush();
      await write(':');
      await write('r');
      await write('e');
      expect(store.getState().commandBarOpen).toBe(true);

      stdout.columns = 30;
      stdout.rows = 8;
      stdout.emit('resize');
      await instance.waitUntilRenderFlush();
      await instance.waitUntilRenderFlush();
      await write('x');
      await write('q');
      await write('\x1b');
      await new Promise((resolve) => setTimeout(resolve, 30));
      await instance.waitUntilRenderFlush();
      expect(store.getState().commandBarOpen).toBe(true);
      expect(quit).toBe(0);

      const before = stdout.output.length;
      stdout.columns = 120;
      stdout.rows = 40;
      stdout.emit('resize');
      await instance.waitUntilRenderFlush();
      await instance.waitUntilRenderFlush();
      const frame = stdout.output.slice(before);
      expect(frame).toContain(':re');
      expect(frame).not.toContain(':rex');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});
