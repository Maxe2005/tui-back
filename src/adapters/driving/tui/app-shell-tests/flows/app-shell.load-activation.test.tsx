import { describe, it, expect, vi } from 'vitest';
import { ok } from '../../../../../core/result.js';
import type { EdtRegistryEntry, EdtRegistryPort } from '../../../../../core/ports/storage/edt-registry.js';
import type { ManifestPort } from '../../../../../core/ports/vcs/manifest.js';
import type { StatePort } from '../../../../../core/ports/storage/state.js';
import { AppShell } from '../../app-shell.js';
import { createAppStore } from '../../store/app-store.js';
import { fakeDeps, flushAsyncLoad, mount } from '../app-shell.test-support.js';
import { manifestFor } from '../../store/store.test-support.js';

describe('AppShell tabVisibility load activation', () => {
  it('loads real tabVisibility from wired deps on mount — reflected in store state and the rendered tab bar', async () => {
    const manifest: ManifestPort = {
      load: vi.fn(async (path: string) => ok({ ...manifestFor(path), modules: { 'route-explorer': {} } })),
    };
    const store = createAppStore(fakeDeps({ manifest }));

    const { instance, stdout } = mount(store);
    try {
      await flushAsyncLoad(instance);

      // routes has one carrying repo (svc-a) but no active EDT — 'disabled', not 'enabled'.
      // sharedTypes has zero carrying repos — 'omitted'. Neither is the pre-load default
      // (both 'enabled'), so this can only pass if the mount effect actually loaded real data.
      expect(store.getState().tabVisibility).toEqual({
        routes: { status: 'disabled', carryingServices: ['svc-a'] },
        sharedTypes: { status: 'omitted', carryingServices: [] },
      });
      // The tab bar reflects it too: routes (disabled) stays reachable, shared-types
      // (omitted) is dropped from the bar entirely. `stdout.output` accumulates every frame
      // (including the pre-load one, which still shows both tabs) — the TopBar's "tui-back"
      // label re-renders at the start of every frame, so its last occurrence marks where the
      // final (post-load) frame begins.
      const output = stdout.output;
      const lastFrame = output.slice(output.lastIndexOf('tui-back'));
      expect(lastFrame).toContain('[r] Routes');
      expect(lastFrame).not.toContain('[s] Shared types');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('reloads tabVisibility after closeRegistryScreen() is called on an already-mounted shell', async () => {
    let loadCount = 0;
    const manifest: ManifestPort = {
      load: vi.fn(async (path: string) => {
        loadCount += 1;
        // Only the reload triggered by closing the registry screen (the 3rd load: mount,
        // then the open->close flip) reports the carrying module — isolates the assertion to
        // that specific reload rather than any load happening at all.
        const modules: Record<string, Record<string, unknown>> = loadCount >= 3 ? { 'route-explorer': {} } : {};
        return ok({ ...manifestFor(path), modules });
      }),
    };
    const store = createAppStore(fakeDeps({ manifest }));

    const { instance } = mount(store);
    try {
      await flushAsyncLoad(instance);
      expect(store.getState().tabVisibility.routes.status).toBe('omitted');

      // Simulate the registry screen having been opened (without exercising openRegistryScreen
      // itself, which is a separate concern) so closeRegistryScreen() below actually flips
      // registryScreenOpen false->true->false, re-triggering AppShell's effect.
      store.setState({ registryScreenOpen: true });
      await flushAsyncLoad(instance);

      store.getState().closeRegistryScreen();
      await flushAsyncLoad(instance);

      expect(store.getState().tabVisibility.routes).toEqual({
        status: 'disabled',
        carryingServices: ['svc-a'],
      });
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});

describe('AppShell edts load activation', () => {
  it('resolves the active EDT topic in the top bar from a wired mount-time loadEdts(), without ever visiting the EDTs zone', async () => {
    const edtRegistry: EdtRegistryPort = {
      add: vi.fn(async () => ok(undefined)),
      list: vi.fn(async () =>
        ok([
          {
            ulid: '01JXXXXX1AAAAAAAAAAAAAAAAA',
            topic: 'checkout-revamp',
            createdAt: '2026-01-01T00:00:00.000Z',
            status: 'active',
            members: [],
          },
        ] as EdtRegistryEntry[]),
      ),
      setStatus: vi.fn(async () => ok(undefined)),
      update: vi.fn(async () => ok(undefined)),
      remove: vi.fn(async () => ok(undefined)),
    };
    const state: StatePort = {
      readActiveEdt: vi.fn(async () => ok('01JXXXXX1AAAAAAAAAAAAAAAAA')),
      writeActiveEdt: vi.fn(async () => ok(undefined)),
      readSplitterRatios: vi.fn(async () => ok(null)),
      writeSplitterRatios: vi.fn(async () => ok(undefined)),
      readFilterHistory: vi.fn(async () => ok(null)),
      writeFilterHistory: vi.fn(async () => ok(undefined)),
      readCommandHistory: vi.fn(async () => ok(null)),
      writeCommandHistory: vi.fn(async () => ok(undefined)),
      readLogRules: vi.fn(async () => ok(null)),
      writeLogRules: vi.fn(async () => ok(undefined)),
      readLogRuleSets: vi.fn(async () => ok(null)),
      writeLogRuleSets: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ edtRegistry, state }));

    // The default activeZone is 'dashboard' — this test never switches to 'edts', so
    // EdtsZone's own mount-time loadEdts() call never fires; the store's edts/activeEdt can
    // only be populated by AppShell's own mount-time loadEdts() effect.
    expect(store.getState().activeZone).toBe('dashboard');

    const { instance, stdout } = mount(store);
    try {
      await flushAsyncLoad(instance);

      expect(store.getState().edts).toEqual([
        expect.objectContaining({ ulid: '01JXXXXX1AAAAAAAAAAAAAAAAA', topic: 'checkout-revamp' }),
      ]);
      expect(store.getState().activeEdt).toBe('01JXXXXX1AAAAAAAAAAAAAAAAA');

      const output = stdout.output;
      const lastFrame = output.slice(output.lastIndexOf('tui-back'));
      expect(lastFrame).toContain('checkout-revamp');
      expect(lastFrame).not.toContain('01JXXXXX1AAAAAAAAAAAAAAAAA');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});

// Mounts AppShell with a StatePort.readSplitterRatios stub returning a non-null persisted map
// and asserts the store reflects it post-mount (every other test here stubs it as ok(null)).
describe('AppShell splitterRatios load activation', () => {
  it('resolves store.splitterRatios from a wired mount-time loadSplitterRatios(), independent of which zone renders first', async () => {
    const state: StatePort = {
      readActiveEdt: vi.fn(async () => ok(null)),
      writeActiveEdt: vi.fn(async () => ok(undefined)),
      readSplitterRatios: vi.fn(async () => ok({ edts: [0.3, 0.4, 0.5], dashboard: [0.6] })),
      writeSplitterRatios: vi.fn(async () => ok(undefined)),
      readFilterHistory: vi.fn(async () => ok(null)),
      writeFilterHistory: vi.fn(async () => ok(undefined)),
      readCommandHistory: vi.fn(async () => ok(null)),
      writeCommandHistory: vi.fn(async () => ok(undefined)),
      readLogRules: vi.fn(async () => ok(null)),
      writeLogRules: vi.fn(async () => ok(undefined)),
      readLogRuleSets: vi.fn(async () => ok(null)),
      writeLogRuleSets: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ state }));

    // The default activeZone is 'dashboard' — this test never switches to 'edts', so the
    // persisted ratios can only be populated by AppShell's own mount-time
    // loadSplitterRatios() effect, not by EdtsZone ever mounting.
    expect(store.getState().activeZone).toBe('dashboard');
    expect(store.getState().splitterRatios.edts).not.toEqual([0.3, 0.4, 0.5]);

    const { instance } = mount(store);
    try {
      await flushAsyncLoad(instance);

      expect(store.getState().splitterRatios.edts).toEqual([0.3, 0.4, 0.5]);
      expect(store.getState().splitterRatios.dashboard).toEqual([0.6]);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});

describe('AppShell commandHistory load activation', () => {
  it('resolves store.commandHistory from a wired mount-time loadCommandHistory()', async () => {
    const state: StatePort = {
      readActiveEdt: vi.fn(async () => ok(null)),
      writeActiveEdt: vi.fn(async () => ok(undefined)),
      readSplitterRatios: vi.fn(async () => ok(null)),
      writeSplitterRatios: vi.fn(async () => ok(undefined)),
      readFilterHistory: vi.fn(async () => ok(null)),
      writeFilterHistory: vi.fn(async () => ok(undefined)),
      readCommandHistory: vi.fn(async () => ok(['settings', 'registry'])),
      writeCommandHistory: vi.fn(async () => ok(undefined)),
      readLogRules: vi.fn(async () => ok(null)),
      writeLogRules: vi.fn(async () => ok(undefined)),
      readLogRuleSets: vi.fn(async () => ok(null)),
      writeLogRuleSets: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ state }));
    expect(store.getState().commandHistory).toEqual([]);

    const { instance } = mount(store);
    try {
      await flushAsyncLoad(instance);

      expect(state.readCommandHistory).toHaveBeenCalled();
      expect(store.getState().commandHistory).toEqual(['settings', 'registry']);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});

describe('AppShell filter rules load activation', () => {
  it('hydrates the persisted rule lists and library from the mount-time loadLogsRules()', async () => {
    const rule = { mode: 'text', query: 'noise', action: 'hide', target: 'line', enabled: true };
    const state: StatePort = {
      readActiveEdt: vi.fn(async () => ok(null)),
      writeActiveEdt: vi.fn(async () => ok(undefined)),
      readSplitterRatios: vi.fn(async () => ok(null)),
      writeSplitterRatios: vi.fn(async () => ok(undefined)),
      readFilterHistory: vi.fn(async () => ok(null)),
      writeFilterHistory: vi.fn(async () => ok(undefined)),
      readCommandHistory: vi.fn(async () => ok(null)),
      writeCommandHistory: vi.fn(async () => ok(undefined)),
      readLogRules: vi.fn(async () => ok({ global: [rule] })),
      writeLogRules: vi.fn(async () => ok(undefined)),
      readLogRuleSets: vi.fn(async () => ok([{ name: 'n', rules: [rule] }])),
      writeLogRuleSets: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ state }));
    expect(store.getState().logsGlobalFilter.rules).toEqual([]);

    const { instance } = mount(store);
    try {
      await flushAsyncLoad(instance);

      expect(state.readLogRules).toHaveBeenCalled();
      expect(store.getState().logsGlobalFilter.rules).toEqual([rule]);
      expect(store.getState().logsRuleSets).toHaveLength(1);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});
