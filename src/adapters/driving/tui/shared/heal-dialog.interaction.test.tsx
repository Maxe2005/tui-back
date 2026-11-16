// tui/shared/heal-dialog: real keypresses on the mounted overlay — the mode toggle, Enter running
// the heal, and the confirm-close prompt while it runs.
import { createElement } from 'react';
import { render } from 'ink';
import { describe, expect, it, vi } from 'vitest';
import type { RestartRow } from '../../../../core/edt/switch-restart.js';
import { createAppStore } from '../store/app-store.js';
import { fakeInteractiveTtyStdin, FakeTtyStdout, KEYS } from './test-support/fake-tty.js';
import { HealDialog } from './heal-dialog.js';
import { footerIdOf } from './test-support/mount-for-test.js';

const ROWS: RestartRow[] = [
  { service: 'svc-a', repoPath: '/repo/a', phase: 'pending' },
  { service: 'svc-b', repoPath: '/repo/b', phase: 'skipped', skipReason: 'up' },
];

async function press(instance: ReturnType<typeof render>, stdin: NodeJS.ReadStream, sequence: string): Promise<void> {
  (stdin as unknown as { write: (chunk: string) => void }).write(sequence);
  await instance.waitUntilRenderFlush();
  // A lone ESC is only delivered once Ink's own pending-input timer fires.
  await new Promise((resolve) => setTimeout(resolve, sequence === KEYS.escape ? 80 : 10));
  await instance.waitUntilRenderFlush();
}

function mount(store: ReturnType<typeof createAppStore>, onClose: () => void) {
  const stdout = new FakeTtyStdout();
  Object.assign(stdout, { columns: 160, rows: 40 });
  const stdin = fakeInteractiveTtyStdin();
  const instance = render(createElement(HealDialog, { useStore: store, onClose }), {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin,
    interactive: true,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  return { instance, stdin, stdout };
}

function seeded() {
  const store = createAppStore();
  store.setState({
    healScreenOpen: true,
    healRun: { status: 'confirm', plan: { edt: { ulid: 'e1', topic: 'demo' }, rows: ROWS }, mode: 'simple', rows: ROWS, report: null, error: null },
  });
  return store;
}

describe('HealDialog interaction', () => {
  it('toggles the mode with ←/→/Space and runs on Enter', async () => {
    const store = seeded();
    const startHeal = vi.fn(async () => {});
    store.setState({ startHeal });
    const { instance, stdin } = mount(store, vi.fn());
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.right);
      expect(store.getState().healRun?.mode).toBe('clean');
      await press(instance, stdin, KEYS.left);
      expect(store.getState().healRun?.mode).toBe('simple');
      await press(instance, stdin, KEYS.space);
      expect(store.getState().healRun?.mode).toBe('clean');
      await press(instance, stdin, KEYS.enter);
      expect(startHeal).toHaveBeenCalledTimes(1);
    } finally {
      instance.unmount();
    }
  });

  it('Esc in confirm closes without running', async () => {
    const store = seeded();
    const startHeal = vi.fn(async () => {});
    store.setState({ startHeal });
    const onClose = vi.fn();
    const { instance, stdin } = mount(store, onClose);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.escape);
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(startHeal).not.toHaveBeenCalled();
    } finally {
      instance.unmount();
    }
  });

  it('asks before hiding a running heal: Esc keeps it open, Enter closes', async () => {
    const store = seeded();
    store.setState({ healRun: { ...store.getState().healRun!, status: 'running', rows: [{ ...ROWS[0]!, phase: 'restarting' }, ROWS[1]!] } });
    const onClose = vi.fn();
    const { instance, stdin, stdout } = mount(store, onClose);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.enter);
      expect(onClose).not.toHaveBeenCalled();
      expect(footerIdOf(store)).toBe('heal-busy');
      await press(instance, stdin, KEYS.escape);
      expect(footerIdOf(store)).toBe('heal-confirm-close');
      expect(stdout.output).toContain('lets it finish in the background');
      await press(instance, stdin, KEYS.escape);
      expect(onClose).not.toHaveBeenCalled();
      expect(footerIdOf(store)).toBe('heal-busy');
      await press(instance, stdin, KEYS.escape);
      await press(instance, stdin, KEYS.enter);
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      instance.unmount();
    }
  });

  it('streams the rows as the store updates them', async () => {
    const store = seeded();
    store.setState({ healRun: { ...store.getState().healRun!, status: 'running' } });
    const { instance, stdout } = mount(store, vi.fn());
    try {
      await instance.waitUntilRenderFlush();
      for (const phase of ['restarting', 'verifying', 'functional'] as const) {
        const mark = stdout.output.length;
        store.setState({ healRun: { ...store.getState().healRun!, rows: [{ ...ROWS[0]!, phase }, ROWS[1]!] } });
        await instance.waitUntilRenderFlush();
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(stdout.output.slice(mark)).toContain(`svc-a — ${phase}`);
      }
    } finally {
      instance.unmount();
    }
  });
});
