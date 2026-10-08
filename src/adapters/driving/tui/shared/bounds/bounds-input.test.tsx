// A typed value longer than its line keeps its tail (where the caret is) on screen.
import { createElement } from 'react';
import { render } from 'ink';
import { describe, expect, it } from 'vitest';
import { CommandBar } from '../command-bar.js';
import { createAppStore } from '../../store/app-store.js';
import { FakeTtyStdout, fakeInteractiveTtyStdin } from '../test-support/fake-tty.js';
import { BoundsProvider } from './bounds-context.js';

describe('command bar input line', () => {
  it('shows the tail of a long query, not its head', async () => {
    const stdout = new FakeTtyStdout();
    stdout.columns = 40;
    stdout.rows = 12;
    const stdin = fakeInteractiveTtyStdin();
    const instance = render(
      createElement(BoundsProvider, { columns: 40, rows: 12, children: createElement(CommandBar, { useStore: createAppStore(), onClose: () => {} }) }),
      { stdout: stdout as unknown as NodeJS.WriteStream, stdin, interactive: true, exitOnCtrlC: false, patchConsole: false },
    );
    try {
      await instance.waitUntilRenderFlush();
      for (const char of 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJ') {
        (stdin as unknown as { write: (c: string) => void }).write(char);
        await instance.waitUntilRenderFlush();
      }
      const last = stdout.output.slice(stdout.output.lastIndexOf('COMMAND'));
      expect(last).toContain('GHIJ');
      expect(last).not.toContain(':abcdef');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});
