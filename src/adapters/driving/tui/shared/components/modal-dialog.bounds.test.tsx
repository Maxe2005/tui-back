import { createElement } from 'react';
import { Text, render } from 'ink';
import { describe, expect, it } from 'vitest';
import { ModalDialog } from './modal-dialog.js';
import { BoundsProvider } from '../bounds/bounds-context.js';
import { renderToString } from './render-to-string.js';
import { FakeTtyStdout, KEYS, fakeInteractiveTtyStdin } from '../test-support/fake-tty.js';

describe('ModalDialog bounds', () => {
  it('never exceeds its bounds, keeps the title, pins the footer', async () => {
    const body = Array.from({ length: 50 }, (_, i) => createElement(Text, { key: i }, `row-${i}`));
    const out = await renderToString(
      createElement(
        BoundsProvider,
        { columns: 60, rows: 12, children: null },
        createElement(ModalDialog, { title: 'BIG', footer: createElement(Text, null, 'FOOT') }, ...body),
      ),
    );
    const lines = out.split('\n').filter((l) => l.includes('║') || l.includes('╔') || l.includes('╚'));
    expect(lines.length).toBeLessThanOrEqual(12);
    expect(out).toContain('BIG');
    expect(out).toContain('FOOT');
    expect(out).toContain('row-0');
    expect(out).not.toContain('row-49');
  });
});

describe('ModalDialog scrolling', () => {
  it('scrolls its clipped body with PgDn / PgUp, keeping title and footer', async () => {
    const stdout = new FakeTtyStdout();
    stdout.columns = 60;
    stdout.rows = 14;
    const stdin = fakeInteractiveTtyStdin();
    const body = Array.from({ length: 50 }, (_, i) => createElement(Text, { key: i }, `row-${i}`));
    const instance = render(
      createElement(
        BoundsProvider,
        { columns: 60, rows: 14, children: null },
        createElement(ModalDialog, { title: 'BIG', footer: createElement(Text, null, 'FOOT') }, ...body),
      ),
      { stdout: stdout as unknown as NodeJS.WriteStream, stdin, interactive: true, exitOnCtrlC: false, patchConsole: false },
    );
    const last = () => stdout.output.slice(stdout.output.lastIndexOf('BIG'));
    try {
      await instance.waitUntilRenderFlush();
      await instance.waitUntilRenderFlush();
      expect(last()).toContain('row-0');
      expect(last()).toContain('PgUp/PgDn scroll');

      (stdin as unknown as { write: (c: string) => void }).write(KEYS.pageDown);
      await instance.waitUntilRenderFlush();
      await instance.waitUntilRenderFlush();
      const after = last();
      expect(after).not.toContain('row-0\n');
      expect(after).toContain('row-5');
      expect(after).toContain('FOOT');

      (stdin as unknown as { write: (c: string) => void }).write(KEYS.pageUp);
      await instance.waitUntilRenderFlush();
      await instance.waitUntilRenderFlush();
      expect(last()).toContain('row-0');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('resets the scroll position when it reopens', async () => {
    const stdout = new FakeTtyStdout();
    stdout.columns = 60;
    stdout.rows = 14;
    const stdin = fakeInteractiveTtyStdin();
    const body = (prefix: string) => Array.from({ length: 50 }, (_, i) => createElement(Text, { key: i }, `${prefix}-${i}`));
    const tree = (open: boolean) =>
      createElement(
        BoundsProvider,
        { columns: 60, rows: 14, children: null },
        createElement(ModalDialog, { title: 'ONE', open }, ...body('a')),
      );
    const instance = render(tree(true), {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin,
      interactive: true,
      exitOnCtrlC: false,
      patchConsole: false,
    });
    const write = async (chunk: string) => {
      (stdin as unknown as { write: (c: string) => void }).write(chunk);
      await instance.waitUntilRenderFlush();
      await instance.waitUntilRenderFlush();
    };
    try {
      await instance.waitUntilRenderFlush();
      await instance.waitUntilRenderFlush();
      await write(KEYS.pageDown);
      expect(stdout.output.slice(stdout.output.lastIndexOf('ONE'))).not.toContain('a-0\n');
      instance.rerender(tree(false));
      await instance.waitUntilRenderFlush();
      instance.rerender(tree(true));
      await instance.waitUntilRenderFlush();
      await instance.waitUntilRenderFlush();
      expect(stdout.output.slice(stdout.output.lastIndexOf('ONE'))).toContain('a-0');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});
