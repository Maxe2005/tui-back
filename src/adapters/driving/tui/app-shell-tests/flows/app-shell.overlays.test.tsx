import { createElement } from 'react';
import { render } from 'ink';
import { describe, it, expect, vi } from 'vitest';
import { AppShell } from '../../app-shell.js';
import { createAppStore } from '../../store/app-store.js';
import { fakeInteractiveTtyStdin, FakeTtyStdout, KEYS } from '../../shared/test-support/fake-tty.js';
import { flushAsyncLoad, mount, press, pressEscape } from '../app-shell.test-support.js';

describe('AppShell realign overlay', () => {
  it('opens through `:realign`, owns every key while open, and Esc closes it', async () => {
    const store = createAppStore();
    const { instance, stdin, stdout } = mount(store);
    try {
      await flushAsyncLoad(instance);
      await press(instance, stdin, ':');
      await press(instance, stdin, 'realign');
      await press(instance, stdin, KEYS.enter);
      await flushAsyncLoad(instance);

      expect(store.getState().realignScreenOpen).toBe(true);
      expect(stdout.output).toContain('REALIGN');
      const zoneBefore = store.getState().activeZone;

      for (const key of ['e', 'u', ':', '?', KEYS.right]) {
        await press(instance, stdin, key);
      }
      expect(store.getState().activeZone).toBe(zoneBefore);
      expect(store.getState().commandBarOpen).toBe(false);
      expect(store.getState().helpOpen).toBe(false);
      expect(store.getState().realignScreenOpen).toBe(true);

      await pressEscape(instance, stdin);
      expect(store.getState().realignScreenOpen).toBe(false);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('while a realign is running, q does not quit', async () => {
    const store = createAppStore();
    store.setState({
      realignScreenOpen: true,
      realignCandidates: { status: 'ready', rows: [], error: null },
      realignRun: { status: 'running', restartMode: 'none', rows: [{ service: 'svc-a', path: '/repo/a', status: 'realigning' }], restartRows: [], restartError: null, error: null },
    });
    const stdout = new FakeTtyStdout();
    const stdin = fakeInteractiveTtyStdin();
    const onQuit = vi.fn();
    const instance = render(createElement(AppShell, { useStore: store, onQuit }), {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin,
      interactive: true,
      exitOnCtrlC: false,
      patchConsole: false,
    });
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, 'q');
      await instance.waitUntilRenderFlush();
      expect(onQuit).not.toHaveBeenCalled();
      expect(store.getState().quitRequested).toBe(false);
      expect(store.getState().realignScreenOpen).toBe(true);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('while a realign is running, Esc is ignored', async () => {
    const store = createAppStore();
    store.setState({
      realignScreenOpen: true,
      realignCandidates: { status: 'ready', rows: [], error: null },
      realignRun: { status: 'running', restartMode: 'none', rows: [{ service: 'svc-a', path: '/repo/a', status: 'realigning' }], restartRows: [], restartError: null, error: null },
    });
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      expect(stdout.output).toContain('Realigning services…');
      await pressEscape(instance, stdin);
      expect(store.getState().realignScreenOpen).toBe(true);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});

describe('AppShell heal overlay', () => {
  const rows = [
    { service: 'svc-a', repoPath: '/repo/a', phase: 'pending' as const },
    { service: 'svc-b', repoPath: '/repo/b', phase: 'skipped' as const, skipReason: 'up' as const },
  ];

  it('mounts while open, owns every key, and Esc closes it', async () => {
    const store = createAppStore();
    store.setState({
      healScreenOpen: true,
      healRun: { status: 'confirm', plan: { edt: { ulid: 'e1', topic: 'demo' }, rows }, mode: 'simple', rows, report: null, error: null },
    });
    const onQuit = vi.fn();
    const stdout = new FakeTtyStdout();
    const stdin = fakeInteractiveTtyStdin();
    const instance = render(createElement(AppShell, { useStore: store, onQuit }), {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin,
      interactive: true,
      exitOnCtrlC: false,
      patchConsole: false,
    });
    try {
      await instance.waitUntilRenderFlush();
      expect(stdout.output).toContain('HEAL');
      const zoneBefore = store.getState().activeZone;
      for (const key of ['e', 'u', ':', '?', 'q', KEYS.ctrlW]) {
        await press(instance, stdin, key);
      }
      expect(store.getState().activeZone).toBe(zoneBefore);
      expect(store.getState()).toMatchObject({ commandBarOpen: false, helpOpen: false, healScreenOpen: true, quitRequested: false, resizeMode: null });
      expect(onQuit).not.toHaveBeenCalled();
      await pressEscape(instance, stdin);
      expect(store.getState()).toMatchObject({ healScreenOpen: false, healRun: null });
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('renders the heal notice when no overlay opened', async () => {
    const store = createAppStore();
    store.setState({ healNotice: { message: 'every service is up', tone: 'success' } });
    const { instance, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      expect(stdout.output).toContain('every service is up');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});
