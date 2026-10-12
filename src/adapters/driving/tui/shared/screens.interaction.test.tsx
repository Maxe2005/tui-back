// Real-keypress checks for the registry and settings screens: Home/End on their lists and the
// Enter-only settings actions (renderToString never drives useInput).
import { createElement } from 'react';
import { render } from 'ink';
import { describe, expect, it, vi } from 'vitest';
import { createAppStore } from '../store/app-store.js';
import { RepoRegistryScreen } from './repo-registry-screen.js';
import { SettingsScreen } from './settings-screen.js';
import { fakeInteractiveTtyStdin, FakeTtyStdout, KEYS } from './test-support/fake-tty.js';
import { footerIdOf } from './test-support/mount-for-test.js';

function mount(element: ReturnType<typeof createElement>) {
  const stdout = new FakeTtyStdout();
  const stdin = fakeInteractiveTtyStdin();
  const instance = render(element, { stdout: stdout as unknown as NodeJS.WriteStream, stdin, exitOnCtrlC: false, patchConsole: false });
  const press = async (sequence: string) => {
    (stdin as unknown as { write: (chunk: string) => void }).write(sequence);
    await instance.waitUntilRenderFlush();
  };
  const stop = async () => {
    instance.unmount();
    await instance.waitUntilExit();
  };
  return { press, stop, stdout, instance };
}

describe('RepoRegistryScreen candidates (real keypress)', () => {
  it('End jumps to the last candidate and Home back to the first', async () => {
    const store = createAppStore();
    const registerRegistryCandidates = vi.fn(async () => {});
    store.setState({
      registryScanStatus: 'idle',
      registryScanResult: { candidates: ['/r/a', '/r/b', '/r/c'], skipped: [] },
      registerRegistryCandidates,
    });
    const { press, stop, instance } = mount(createElement(RepoRegistryScreen, { useStore: store }));
    try {
      await instance.waitUntilRenderFlush();
      await press(KEYS.end);
      await press(KEYS.space);
      await press(KEYS.enter);
      expect(registerRegistryCandidates).toHaveBeenLastCalledWith(['/r/c']);

      await press(KEYS.space); // deselect c
      await press(KEYS.home);
      await press(KEYS.space);
      await press(KEYS.enter);
      expect(registerRegistryCandidates).toHaveBeenLastCalledWith(['/r/a']);
    } finally {
      await stop();
    }
  });
});

describe('SettingsScreen (real keypress)', () => {
  it('End jumps to the last General row; one Up lands on the editor command, where Enter starts the edit', async () => {
    const store = createAppStore();
    const { press, stop, stdout, instance } = mount(createElement(SettingsScreen, { useStore: store }));
    try {
      await instance.waitUntilRenderFlush();
      await press(KEYS.end);
      await press(KEYS.up);
      await press(KEYS.enter);
      expect(footerIdOf(store)).toBe('confirm');
    } finally {
      await stop();
    }
  });

  it('Space no longer clears the global filter history; Enter does', async () => {
    const store = createAppStore();
    const clearGlobalFilterHistory = vi.fn();
    store.setState({ clearGlobalFilterHistory });
    const { press, stop, instance } = mount(
      createElement(SettingsScreen, { useStore: store, initialTab: 'logs', initialLogsGroup: 'clear-history' }),
    );
    try {
      await instance.waitUntilRenderFlush();
      await press(KEYS.space);
      expect(clearGlobalFilterHistory).not.toHaveBeenCalled();
      await press(KEYS.enter);
      expect(clearGlobalFilterHistory).toHaveBeenCalledTimes(1);
    } finally {
      await stop();
    }
  });
});
