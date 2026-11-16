// tui/shared/realign-dialog: real keypresses on the mounted dialog — cursor, Space toggle, the
// preset key, the restart selector and Enter dispatch to the store.
import { createElement } from 'react';
import { render } from 'ink';
import { describe, expect, it, vi } from 'vitest';
import type { DriftCandidate } from '../../../../core/dashboard/drift.js';
import { createAppStore } from '../store/app-store.js';
import { fakeInteractiveTtyStdin, FakeTtyStdout, KEYS } from './test-support/fake-tty.js';
import { RealignDialog } from './realign-dialog.js';

const ROWS: DriftCandidate[] = [
  { kind: 'member', service: 'svc-a', path: '/repo/a', branch: 'development', expectedBranch: 'feat/a', drift: 'drifted' },
  { kind: 'member', service: 'svc-b', path: '/repo/b', branch: 'development', expectedBranch: 'feat/b', drift: 'drifted' },
  { kind: 'other', service: 'svc-c', path: '/repo/c', branch: 'feat/x', expectedBranch: 'development', drift: 'drifted' },
];

async function press(instance: ReturnType<typeof render>, stdin: NodeJS.ReadStream, sequence: string): Promise<void> {
  (stdin as unknown as { write: (chunk: string) => void }).write(sequence);
  await instance.waitUntilRenderFlush();
  await new Promise((resolve) => setTimeout(resolve, 10));
}

describe('RealignDialog interaction', () => {
  it('toggles, applies presets, cycles the restart mode and runs on Enter', async () => {
    const store = createAppStore();
    const runRealign = vi.fn(async () => {});
    store.setState({
      realignScreenOpen: true,
      realignCandidates: { status: 'ready', rows: ROWS, error: null },
      realignDraft: { cursor: 0, selected: [], restartMode: 'none' },
      runRealign,
    });
    const stdout = new FakeTtyStdout();
    Object.assign(stdout, { columns: 120, rows: 40 });
    const stdin = fakeInteractiveTtyStdin();
    const instance = render(createElement(RealignDialog, { useStore: store }), {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin,
      interactive: true,
      exitOnCtrlC: false,
      patchConsole: false,
    });
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.space);
      expect(store.getState().realignDraft).toMatchObject({ cursor: 1, selected: ['/repo/b'] });

      // A hand-edited selection starts the presets over: none, then the EDT members, then all.
      await press(instance, stdin, 'p');
      expect(store.getState().realignDraft.selected).toEqual([]);
      await press(instance, stdin, 'p');
      expect(store.getState().realignDraft.selected).toEqual(['/repo/a', '/repo/b']);
      await press(instance, stdin, 'p');
      expect(store.getState().realignDraft.selected).toEqual(['/repo/a', '/repo/b', '/repo/c']);

      await press(instance, stdin, KEYS.right);
      expect(store.getState().realignDraft.restartMode).toBe('simple');
      await press(instance, stdin, KEYS.left);
      await press(instance, stdin, KEYS.left);
      expect(store.getState().realignDraft.restartMode).toBe('clean');

      await press(instance, stdin, KEYS.enter);
      expect(runRealign).toHaveBeenCalledTimes(1);
    } finally {
      instance.unmount();
    }
  });
});
