import { describe, it, expect, vi } from 'vitest';
import { ok } from '../../../../core/result.js';
import type { EdtRegistryEntry, EdtRegistryPort } from '../../../../core/ports/storage/edt-registry.js';
import type { StatePort } from '../../../../core/ports/storage/state.js';
import { AppShell } from '../app-shell.js';
import { createAppStore } from '../store/app-store.js';
import { KEYS } from '../shared/test-support/fake-tty.js';
import { fakeDeps, flushAsyncLoad, mount, press, pressEscape } from './app-shell.test-support.js';

describe('AppShell Ctrl+W resize-mode', () => {
  it.each(['dashboard', 'update', 'logs', 'routes', 'shared-types'] as const)('Ctrl+W engages resize-mode on boundary 0 in the %s zone', async (zone) => {
    const store = createAppStore();
    store.getState().setActiveZone(zone);
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await press(instance, stdin, KEYS.ctrlW);

      expect(store.getState().resizeMode).toEqual({ zone, targetBoundary: 0 });
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Ctrl+W is a no-op while the Logs fullscreen preview is open', async () => {
    const store = createAppStore();
    store.getState().setActiveZone('logs');
    store.setState({ logsFullscreenTarget: '/repos/api-gateway', logsFullscreenServiceName: 'api-gateway' });
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await press(instance, stdin, KEYS.ctrlW);

      expect(store.getState().resizeMode).toBeNull();
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Ctrl+W engages resize-mode, targeting boundary 0, while the EDTs zone is active', async () => {
    const store = createAppStore();
    store.getState().setActiveZone('edts');
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await press(instance, stdin, KEYS.ctrlW);

      expect(store.getState().resizeMode).toEqual({ zone: 'edts', targetBoundary: 0 });
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Ctrl+W under the command bar overlay is a no-op', async () => {
    const store = createAppStore();
    store.getState().setActiveZone('edts');
    store.getState().openCommandBar();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await press(instance, stdin, KEYS.ctrlW);

      expect(store.getState().resizeMode).toBeNull();
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Shift+Tab in resize-mode reverses the target boundary, wrapping first to last', async () => {
    const store = createAppStore();
    store.getState().setActiveZone('edts');
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.ctrlW);
      expect(store.getState().resizeMode).toEqual({ zone: 'edts', targetBoundary: 0 });

      await press(instance, stdin, KEYS.shiftTab);
      expect(store.getState().resizeMode).toEqual({ zone: 'edts', targetBoundary: 2 });

      await press(instance, stdin, KEYS.shiftTab);
      expect(store.getState().resizeMode).toEqual({ zone: 'edts', targetBoundary: 1 });
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('a second Ctrl+W while resize-mode is already active is a no-op', async () => {
    const store = createAppStore();
    store.getState().setActiveZone('edts');
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await press(instance, stdin, KEYS.ctrlW);
      expect(store.getState().resizeMode).toEqual({ zone: 'edts', targetBoundary: 0 });

      // Move the target off boundary 0 first, so a second Ctrl+W silently re-entering
      // (targetBoundary reset to 0) would be observable rather than coincidentally matching
      // the already-correct state.
      await press(instance, stdin, KEYS.tab);
      expect(store.getState().resizeMode).toEqual({ zone: 'edts', targetBoundary: 1 });

      await press(instance, stdin, KEYS.ctrlW);

      // Still targeting boundary 1 — the second Ctrl+W was swallowed as "every other key is
      // inert while resize-mode owns input", never re-entering (which would have reset
      // targetBoundary back to 0) and never exiting either.
      expect(store.getState().resizeMode).toEqual({ zone: 'edts', targetBoundary: 1 });
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Tab cycles the targeted boundary across all 3, wrapping back to 0 — and never touches EdtsZone\'s own paneFocus', async () => {
    // A populated, successfully-loaded EDT so the detail pane's "Topic: ..." line
    // (formatEdtDetail, unique to the EDT-selector's own detail content — never rendered by
    // either services pane) is a reliable, plain-text signal for "paneFocus is still 'edts'".
    // EdtsZone's own Tab handler (cyclePaneFocus) would otherwise move this to
    // 'edt-services' on the very first Tab. An *unwired* store's own mount-time loadEdts()
    // flips edtsStatus to 'error' (edtsRows then renders as empty regardless of any seeded
    // `edts` array — "never show stale rows under an error banner"), so this needs wired deps
    // with a populated edtRegistry, not a bare `createAppStore()` + `setState`.
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
    const store = createAppStore(fakeDeps({ edtRegistry }));
    store.getState().setActiveZone('edts');
    store.getState().enterResizeMode('edts');
    const { instance, stdin, stdout } = mount(store);
    // `stdout.output` accumulates every frame ever written — a string only ever needs to have
    // appeared *once* to satisfy a plain `toContain` against it, so a stale first-render frame
    // could hide a real regression on a later frame. Slice out just the most recent frame
    // (mirrors 'AppShell edts load activation' above) before every assertion below.
    const lastFrame = () => stdout.output.slice(stdout.output.lastIndexOf('tui-back'));
    try {
      await flushAsyncLoad(instance);
      expect(lastFrame()).toContain('Topic: checkout-revamp');

      await press(instance, stdin, KEYS.tab);
      expect(store.getState().resizeMode?.targetBoundary).toBe(1);
      expect(lastFrame()).toContain('Topic: checkout-revamp');

      await press(instance, stdin, KEYS.tab);
      expect(store.getState().resizeMode?.targetBoundary).toBe(2);
      expect(lastFrame()).toContain('Topic: checkout-revamp');

      await press(instance, stdin, KEYS.tab);
      expect(store.getState().resizeMode?.targetBoundary).toBe(0);
      expect(lastFrame()).toContain('Topic: checkout-revamp');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Left/Right resize the vertical boundary 0 (list<->detail split), clamped', async () => {
    const store = createAppStore();
    store.getState().setActiveZone('edts');
    store.getState().enterResizeMode('edts');
    const before = store.getState().splitterRatios.edts[0];
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await press(instance, stdin, KEYS.right);
      expect(store.getState().splitterRatios.edts[0]).toBeCloseTo(before + 0.05);

      await press(instance, stdin, KEYS.left);
      await press(instance, stdin, KEYS.left);
      expect(store.getState().splitterRatios.edts[0]).toBeCloseTo(before - 0.05);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Up/Down resize a horizontal boundary (1/2), while boundary 0 is unaffected', async () => {
    const store = createAppStore();
    store.getState().setActiveZone('edts');
    store.getState().enterResizeMode('edts');
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      // Tab from boundary 0 to boundary 1 (the EDTs zone's first horizontal sub-split).
      await press(instance, stdin, KEYS.tab);
      const boundary0Before = store.getState().splitterRatios.edts[0];
      const boundary1Before = store.getState().splitterRatios.edts[1];

      await press(instance, stdin, KEYS.down);

      expect(store.getState().splitterRatios.edts[1]).toBeCloseTo(boundary1Before + 0.05);
      expect(store.getState().splitterRatios.edts[0]).toBe(boundary0Before);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('a horizontal boundary ignores Left/Right (wrong axis) — no-op', async () => {
    const store = createAppStore();
    store.getState().setActiveZone('edts');
    store.getState().enterResizeMode('edts');
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab);
      const before = store.getState().splitterRatios.edts[1];

      await press(instance, stdin, KEYS.right);

      expect(store.getState().splitterRatios.edts[1]).toBe(before);
      // Left/Right's usual zone-switch binding is also inert while resize-mode is active.
      expect(store.getState().activeZone).toBe('edts');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Enter exits resize-mode with no separate save step (the live move already applied)', async () => {
    const store = createAppStore();
    store.getState().setActiveZone('edts');
    store.getState().enterResizeMode('edts');
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.right);
      const movedRatio = store.getState().splitterRatios.edts[0];

      await press(instance, stdin, KEYS.enter);

      expect(store.getState().resizeMode).toBeNull();
      expect(store.getState().splitterRatios.edts[0]).toBe(movedRatio);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Esc exits resize-mode and normal keys (e.g. zone-switch arrows) resume', async () => {
    const store = createAppStore();
    store.getState().setActiveZone('edts');
    store.getState().enterResizeMode('edts');
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await pressEscape(instance, stdin);
      expect(store.getState().resizeMode).toBeNull();

      await press(instance, stdin, KEYS.right);
      expect(store.getState().activeZone).toBe('update');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('resize-mode persists boundary moves via StatePort.writeSplitterRatios', async () => {
    const writeSplitterRatios = vi.fn(async () => ok(undefined));
    const state: StatePort = {
      readActiveEdt: vi.fn(async () => ok(null)),
      writeActiveEdt: vi.fn(async () => ok(undefined)),
      readSplitterRatios: vi.fn(async () => ok(null)),
      writeSplitterRatios,
      readFilterHistory: vi.fn(async () => ok(null)),
      writeFilterHistory: vi.fn(async () => ok(undefined)),
      readCommandHistory: vi.fn(async () => ok(null)),
      writeCommandHistory: vi.fn(async () => ok(undefined)),
      readLogRules: vi.fn(async () => ok(null)),
      writeLogRules: vi.fn(async () => ok(undefined)),
      readLogRuleSets: vi.fn(async () => ok(null)),
      writeLogRuleSets: vi.fn(async () => ok(undefined)),
    };
    // A non-empty EDT registry: an empty one auto-opens the EDTs zone's create dialog, which
    // sets zoneInputCaptured — that would swallow the Ctrl+W-driven resize keypress below
    // before it ever reaches AppShell's resize-mode dispatch.
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
    const store = createAppStore(fakeDeps({ state, edtRegistry }));
    store.getState().setActiveZone('edts');
    store.getState().enterResizeMode('edts');
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await press(instance, stdin, KEYS.right);
      // setSplitterRatio's own persistence chain is awaited internally, but the dispatch call
      // itself is fire-and-forget (`void`) from app-shell.tsx — give the microtask queue a
      // turn to flush before asserting the write actually landed.
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(writeSplitterRatios).toHaveBeenCalledWith(store.getState().splitterRatios);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});
