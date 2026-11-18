import { createElement } from 'react';
import { render } from 'ink';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { ok } from '../../../core/result.js';
import type { EdtRegistryEntry, EdtRegistryPort } from '../../../core/ports/edt-registry.js';
import type { StatePort } from '../../../core/ports/state.js';
import { AppShell } from './app-shell.js';
import { createAppStore } from './store/app-store.js';
import { fakeInteractiveTtyStdin, FakeTtyStdout, KEYS } from './shared/test-support/fake-tty.js';
import { fakeDeps, flushAsyncLoad, mount, press, pressEscape } from './app-shell.test-support.js';

describe('AppShell reset screen (:reset)', () => {
  function statefulDeps() {
    const disk = {
      edts: [
        {
          ulid: 'ULID1',
          topic: 'feature-a',
          createdAt: '2026-09-29T00:00:00.000Z',
          status: 'active' as const,
          members: [{ service: 'svc-a', repoPath: '/repo/a', branch: 'feat/a' }],
        },
      ] as EdtRegistryEntry[],
      activeEdt: 'ULID1' as string | null,
    };
    const edtRegistry: EdtRegistryPort = {
      add: vi.fn(async () => ok(undefined)),
      list: vi.fn(async () => ok([...disk.edts])),
      setStatus: vi.fn(async () => ok(undefined)),
      update: vi.fn(async () => ok(undefined)),
      remove: vi.fn(async (ulid: string) => {
        disk.edts = disk.edts.filter((e) => e.ulid !== ulid);
        return ok(undefined);
      }),
    };
    const base = fakeDeps();
    const state: StatePort = {
      ...base.state,
      readActiveEdt: vi.fn(async () => ok(disk.activeEdt)),
      writeActiveEdt: vi.fn(async (ulid: string | null) => {
        disk.activeEdt = ulid;
        return ok(undefined);
      }),
    };
    return { deps: fakeDeps({ edtRegistry, state, edtsBaseDir: resetEdtsBaseDir }), disk };
  }

  // A real tmp EDT data dir, so the wipe is exercised against the filesystem.
  let resetTmpRoot: string;
  let resetEdtsBaseDir: string;
  beforeEach(async () => {
    resetTmpRoot = await mkdtemp(join(tmpdir(), 'tui-back-reset-shell-'));
    resetEdtsBaseDir = join(resetTmpRoot, 'edts');
    await mkdir(join(resetEdtsBaseDir, 'ULID1'), { recursive: true });
    await writeFile(join(resetEdtsBaseDir, 'ULID1.db'), 'db');
  });
  afterEach(async () => {
    await rm(resetTmpRoot, { recursive: true, force: true });
  });

  function mountWithQuitSpy(store: ReturnType<typeof createAppStore>) {
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
    return { instance, stdout, stdin, onQuit };
  }

  it('with the overlay open, single global-shortcut keys never leak to AppShell', async () => {
    const { deps } = statefulDeps();
    const store = createAppStore(deps);
    const { instance, stdin, onQuit } = mountWithQuitSpy(store);
    try {
      await flushAsyncLoad(instance);
      store.getState().openResetScreen();
      await flushAsyncLoad(instance);
      const zoneBefore = store.getState().activeZone;

      // One character per press, so each one arrives as its own keystroke.
      for (const key of ['e', 'r', 'l', ':', 'q', '?', KEYS.right]) {
        await press(instance, stdin, key);
      }

      expect(store.getState().activeZone).toBe(zoneBefore);
      expect(store.getState().commandBarOpen).toBe(false);
      expect(store.getState().helpOpen).toBe(false);
      expect(onQuit).not.toHaveBeenCalled();
      expect(store.getState().resetScreenOpen).toBe(true);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('with the overlay open over the EDTs zone, Enter/Space never reach the zone', async () => {
    const { deps } = statefulDeps();
    const store = createAppStore(deps);
    store.getState().setActiveZone('edts');
    const { instance, stdin } = mountWithQuitSpy(store);
    try {
      await flushAsyncLoad(instance);
      store.getState().openResetScreen();
      await flushAsyncLoad(instance);

      await press(instance, stdin, KEYS.space);
      await press(instance, stdin, KEYS.enter);
      await flushAsyncLoad(instance);

      // Enter on the EDTs zone's focused (active) EDT would open its modify dialog, which
      // captures input — it must not have happened underneath the overlay.
      expect(store.getState().zoneInputCaptured).toBe(false);
      expect(store.getState().activeZone).toBe('edts');

      // Control: once the overlay closes, the same Enter does reach the zone.
      await pressEscape(instance, stdin);
      expect(store.getState().resetScreenOpen).toBe(false);
      await press(instance, stdin, KEYS.enter);
      await flushAsyncLoad(instance);
      expect(store.getState().zoneInputCaptured).toBe(true);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('while a reset is running, Esc and other keys are ignored', async () => {
    const store = createAppStore();
    store.setState({ resetScreenOpen: true, resetStatus: 'running' });
    const { instance, stdin, stdout } = mountWithQuitSpy(store);
    try {
      await instance.waitUntilRenderFlush();
      expect(stdout.output).toContain('Resetting…');

      await pressEscape(instance, stdin);
      await press(instance, stdin, KEYS.enter);
      await press(instance, stdin, ':');

      expect(store.getState().resetScreenOpen).toBe(true);
      expect(store.getState().resetStatus).toBe('running');
      expect(store.getState().commandBarOpen).toBe(false);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('opens only through the `reset` command, and Esc closes it with zero writes', async () => {
    const { deps } = statefulDeps();
    const store = createAppStore(deps);
    const { instance, stdin, stdout } = mount(store);
    try {
      await flushAsyncLoad(instance);

      await press(instance, stdin, ':');
      await press(instance, stdin, 'reset');
      await press(instance, stdin, KEYS.enter);

      expect(store.getState().resetScreenOpen).toBe(true);
      expect(stdout.output).toContain('RESET TOOL DATA');

      await press(instance, stdin, KEYS.space);
      await press(instance, stdin, KEYS.enter);
      await pressEscape(instance, stdin);

      expect(store.getState().resetScreenOpen).toBe(false);
      expect(deps.edtRegistry.remove).not.toHaveBeenCalled();
      expect(deps.state.writeActiveEdt).not.toHaveBeenCalled();
      expect(deps.state.writeFilterHistory).not.toHaveBeenCalled();
      expect(deps.registry.remove).not.toHaveBeenCalled();
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('BUSY: is refused while a run is in progress, with the reason shown', async () => {
    const store = createAppStore();
    store.getState().setRunInProgress(true);
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await press(instance, stdin, ':');
      await press(instance, stdin, 'reset');
      await press(instance, stdin, KEYS.enter);

      expect(store.getState().resetScreenOpen).toBe(false);
      expect(stdout.output).toContain('Reset unavailable');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('a wrong confirmation word writes nothing; the exact word resets and rehydrates the store', async () => {
    const { deps, disk } = statefulDeps();
    const store = createAppStore(deps);
    const { instance, stdin, stdout } = mount(store);
    try {
      await flushAsyncLoad(instance);
      expect(store.getState().activeEdt).toBe('ULID1');

      store.getState().openResetScreen();
      await flushAsyncLoad(instance);

      await press(instance, stdin, KEYS.space); // EDTs
      await press(instance, stdin, KEYS.enter); // -> summary
      expect(stdout.output).toContain('feature-a');
      await press(instance, stdin, KEYS.enter); // -> confirm

      // `?` must type into the confirm field, never open global help on top of it.
      await press(instance, stdin, '?');
      expect(store.getState().helpOpen).toBe(false);
      await press(instance, stdin, KEYS.backspace);

      await press(instance, stdin, 'Reset');
      await press(instance, stdin, KEYS.enter);
      await flushAsyncLoad(instance);
      expect(deps.edtRegistry.remove).not.toHaveBeenCalled();
      expect(store.getState().resetStatus).toBe('idle');

      for (let i = 0; i < 5; i += 1) {
        await press(instance, stdin, KEYS.backspace);
      }
      await press(instance, stdin, 'reset');
      await press(instance, stdin, KEYS.enter);
      await flushAsyncLoad(instance);

      expect(disk.edts).toEqual([]);
      expect(disk.activeEdt).toBeNull();
      expect(await readdir(resetEdtsBaseDir)).toEqual([]);
      expect(store.getState().resetStatus).toBe('done');
      expect(store.getState().edts).toEqual([]);
      expect(store.getState().activeEdt).toBeNull();
      expect(stdout.output).toContain('svc-a / /repo/a / feat/a');

      await press(instance, stdin, KEYS.enter);
      expect(store.getState().resetScreenOpen).toBe(false);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});
