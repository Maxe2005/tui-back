// tui/zones/dashboard: real keypresses — R reloads the snapshot, and stays inert behind an overlay.
import { createElement } from 'react';
import { Box, render } from 'ink';
import { describe, expect, it, vi } from 'vitest';
import { createAppStore } from '../../store/app-store.js';
import { fakeInteractiveTtyStdin, FakeTtyStdout } from '../../shared/test-support/fake-tty.js';
import { renderToString } from '../../shared/components/render-to-string.js';
import { EdtsZone } from '../edts/edts-zone.js';
import { DashboardZone } from './dashboard-zone.js';

function mount(store: ReturnType<typeof createAppStore>) {
  const stdout = new FakeTtyStdout();
  Object.assign(stdout, { columns: 100, rows: 30 });
  const stdin = fakeInteractiveTtyStdin();
  const instance = render(createElement(Box, { flexDirection: 'column', height: 30 }, createElement(DashboardZone, { useStore: store })), {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin,
    interactive: true,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  return { instance, stdin };
}

async function press(instance: ReturnType<typeof render>, stdin: NodeJS.ReadStream, sequence: string): Promise<void> {
  (stdin as unknown as { write: (chunk: string) => void }).write(sequence);
  await instance.waitUntilRenderFlush();
  await new Promise((resolve) => setTimeout(resolve, 10));
}

function seed() {
  const store = createAppStore();
  const loadDashboard = vi.fn(async () => {});
  store.setState({ registryEmpty: false, checkRegistryEmpty: async () => {}, loadDashboard });
  return { store, loadDashboard };
}

function serviceRow(name: string) {
  return {
    service: name,
    path: `/r/${name}`,
    manifest: { ok: true as const, value: { sharedBranch: 'development', protectedBranches: [] } },
    status: { ok: true as const, value: { state: 'up' as const, verified: false, container: 'up' as const } },
    branch: 'feat/x',
    divergence: { status: 'current' as const, ahead: 0, behind: 0 },
    workingTree: { ok: true as const, value: { uncommitted: false, mergeInProgress: false, rebaseInProgress: false } },
    protectedBranch: false,
    usedByEdts: [],
    expectedBranch: 'feat/x',
    drift: 'aligned' as const,
  };
}

function seedServices(available = true) {
  const { store, loadDashboard } = seed();
  const runDashboardServiceAction = vi.fn(async (_path: string, _id: string) => {});
  const loadDashboardServiceActions = vi.fn(async () => {});
  const openServiceInZone = vi.fn();
  const action = (id: string, key: string) => ({ id, label: id, key, availability: available ? { available: true as const } : { available: false as const, reason: 'group update' } });
  store.setState({
    dashboardServicesStatus: 'ready',
    dashboardServices: { status: 'active', edt: { ulid: 'e', topic: 't', serviceCount: 2 }, services: [serviceRow('a'), serviceRow('b')], others: [] },
    dashboardServiceActions: {
      '/r/a': [
        action('open-in-ide', 'Ctrl+O'),
        action('restart-simple', 'Ctrl+R'),
        action('restart-clean', 'Ctrl+L'),
        action('terminal-service', 'Ctrl+T'),
        action('terminal-container', 'Ctrl+X'),
      ],
      '/r/b': [action('open-in-ide', 'Ctrl+O'), action('restart-simple', 'Ctrl+R'), action('restart-clean', 'Ctrl+L')],
    },
    runDashboardServiceAction,
    loadDashboardServiceActions,
    openServiceInZone,
  });
  return { store, loadDashboard, runDashboardServiceAction, openServiceInZone };
}

describe('DashboardZone interaction', () => {
  it('a steps through the attention lines and moves the cursor to the line service', async () => {
    const { store, openServiceInZone } = seedServices();
    const services = store.getState().dashboardServices!;
    store.setState({
      dashboardServices: { ...services, services: [serviceRow('a'), { ...serviceRow('b'), divergence: { status: 'current', ahead: 0, behind: 2 } }] },
    });
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, 'a');
      await press(instance, stdin, '\r');
      expect(openServiceInZone).toHaveBeenCalledWith('/r/b');
    } finally {
      instance.unmount();
    }
  });

  it('a skips the attention lines of other services, which have no row', async () => {
    const { store, openServiceInZone } = seedServices();
    const services = store.getState().dashboardServices!;
    store.setState({
      dashboardServices: {
        ...services,
        services: [
          { ...serviceRow('a'), divergence: { status: 'current', ahead: 0, behind: 3 } },
          { ...serviceRow('b'), branch: 'main', drift: 'drifted' },
        ],
        others: [{ service: 'o', path: '/r/o', branch: 'hotfix', expectedBranch: 'development', drift: 'drifted' }],
      },
    });
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      // Lines: b (member drift), o (other drift, no row), a (behind). The second `a` must
      // jump over o straight to a's line.
      await press(instance, stdin, 'a');
      await press(instance, stdin, 'a');
      await press(instance, stdin, '\r');
      expect(openServiceInZone).toHaveBeenLastCalledWith('/r/a');
    } finally {
      instance.unmount();
    }
  });

  it('A opens the realign dialog, a and R keep their own actions', async () => {
    const { store, loadDashboard } = seedServices();
    const openRealignScreen = vi.fn();
    store.setState({ openRealignScreen });
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, 'A');
      expect(openRealignScreen).toHaveBeenCalledTimes(1);
      await press(instance, stdin, 'a');
      await press(instance, stdin, 'R');
      expect(openRealignScreen).toHaveBeenCalledTimes(1);
      expect(loadDashboard).toHaveBeenCalledTimes(2);
    } finally {
      instance.unmount();
    }
  });

  it('ignores A while an overlay owns the keyboard', async () => {
    const { store } = seedServices();
    const openRealignScreen = vi.fn();
    store.setState({ openRealignScreen, commandBarOpen: true });
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, 'A');
      expect(openRealignScreen).not.toHaveBeenCalled();
    } finally {
      instance.unmount();
    }
  });

  it('H opens the heal overlay, and is ignored while an overlay owns the keyboard', async () => {
    const { store } = seedServices();
    const openHeal = vi.fn(async () => {});
    const openRealignScreen = vi.fn();
    store.setState({ openHeal, openRealignScreen });
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, 'H');
      expect(openHeal).toHaveBeenCalledTimes(1);
      expect(openRealignScreen).not.toHaveBeenCalled();
      store.setState({ healScreenOpen: true });
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, 'H');
      expect(openHeal).toHaveBeenCalledTimes(1);
    } finally {
      instance.unmount();
    }
  });

  it('offers [A] realign in the Attention header only when a line is a drift', async () => {
    const { store } = seedServices();
    const services = store.getState().dashboardServices!;
    const aligned = await renderToString(createElement(DashboardZone, { useStore: store }), { columns: 120, rows: 40 });
    expect(aligned).not.toContain('[A] realign');
    store.setState({ dashboardServices: { ...services, others: [{ service: 'o', path: '/r/o', branch: 'hotfix', expectedBranch: 'development', drift: 'drifted' }] } });
    const drifted = await renderToString(createElement(DashboardZone, { useStore: store }), { columns: 120, rows: 40 });
    expect(drifted).toMatch(/Attention \(1\)\s+\[A\] realign/);
  });

  it('loads on mount and again on R', async () => {
    const { store, loadDashboard } = seed();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      expect(loadDashboard).toHaveBeenCalledTimes(1);
      await press(instance, stdin, 'R');
      expect(loadDashboard).toHaveBeenCalledTimes(2);
    } finally {
      instance.unmount();
    }
  });

  it('ignores R while an overlay owns the keyboard', async () => {
    const { store, loadDashboard } = seed();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      store.setState({ settingsScreenOpen: true });
      await press(instance, stdin, 'R');
      expect(loadDashboard).toHaveBeenCalledTimes(1);
    } finally {
      instance.unmount();
    }
  });

  it('reloads when the active EDT changes', async () => {
    const { store, loadDashboard } = seed();
    const { instance } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      store.setState({ activeEdt: 'e2' });
      await instance.waitUntilRenderFlush();
      expect(loadDashboard).toHaveBeenCalledTimes(2);
    } finally {
      instance.unmount();
    }
  });

  it('runs the focused row actions on Ctrl+O/R/L, keeps R as refresh, and follows the cursor', async () => {
    const { store, loadDashboard, runDashboardServiceAction } = seedServices();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, '\x12');
      expect(runDashboardServiceAction).toHaveBeenLastCalledWith('/r/a', 'restart-simple');
      await press(instance, stdin, '\x0c');
      expect(runDashboardServiceAction).toHaveBeenLastCalledWith('/r/a', 'restart-clean');
      await press(instance, stdin, '\x0f');
      expect(runDashboardServiceAction).toHaveBeenLastCalledWith('/r/a', 'open-in-ide');
      await press(instance, stdin, '\x1b[B');
      await press(instance, stdin, '\x12');
      expect(runDashboardServiceAction).toHaveBeenLastCalledWith('/r/b', 'restart-simple');
      const calls = loadDashboard.mock.calls.length;
      await press(instance, stdin, 'R');
      expect(loadDashboard).toHaveBeenCalledTimes(calls + 1);
    } finally {
      instance.unmount();
    }
  });

  it('opens the focused row terminals on Ctrl+T and Ctrl+X, inert once the terminal owns the keys', async () => {
    const { store, runDashboardServiceAction } = seedServices();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, '\x14');
      expect(runDashboardServiceAction).toHaveBeenLastCalledWith('/r/a', 'terminal-service');
      await press(instance, stdin, '\x18');
      expect(runDashboardServiceAction).toHaveBeenLastCalledWith('/r/a', 'terminal-container');
      store.setState({ terminalOpen: true });
      await press(instance, stdin, '\x14');
      await press(instance, stdin, '\x12');
      expect(runDashboardServiceAction).toHaveBeenCalledTimes(2);
    } finally {
      instance.unmount();
    }
  });

  it('falls back to the service terminal on Ctrl+T while the action list is unloaded, never the container one', async () => {
    const { store, runDashboardServiceAction } = seedServices();
    store.setState({ dashboardServiceActions: {} });
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, '\x18');
      expect(runDashboardServiceAction).not.toHaveBeenCalled();
      await press(instance, stdin, '\x14');
      expect(runDashboardServiceAction.mock.calls).toEqual([['/r/a', 'terminal-service']]);
    } finally {
      instance.unmount();
    }
  });

  it('opens the focused service in its zone on Enter', async () => {
    const { store, openServiceInZone } = seedServices();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, '\x1b[B');
      await press(instance, stdin, '\r');
      expect(openServiceInZone).toHaveBeenCalledWith('/r/b');
    } finally {
      instance.unmount();
    }
  });

  it('ignores an unavailable action and every key while an overlay owns the keyboard', async () => {
    const blocked = seedServices(false);
    const first = mount(blocked.store);
    try {
      await first.instance.waitUntilRenderFlush();
      await press(first.instance, first.stdin, '\x12');
      expect(blocked.runDashboardServiceAction).not.toHaveBeenCalled();
    } finally {
      first.instance.unmount();
    }
    const { store, runDashboardServiceAction, openServiceInZone } = seedServices();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      store.setState({ helpOpen: true });
      await press(instance, stdin, '\x12');
      await press(instance, stdin, '\r');
      expect(runDashboardServiceAction).not.toHaveBeenCalled();
      expect(openServiceInZone).not.toHaveBeenCalled();
    } finally {
      instance.unmount();
    }
  });

  it('resets the cursor to the first row when the active EDT changes', async () => {
    const { store, runDashboardServiceAction } = seedServices();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, '\x1b[B');
      store.setState({ activeEdt: 'other-edt' });
      await instance.waitUntilRenderFlush();
      await new Promise((resolve) => setTimeout(resolve, 20));
      await press(instance, stdin, '\x12');
      expect(runDashboardServiceAction).toHaveBeenLastCalledWith('/r/a', 'restart-simple');
    } finally {
      instance.unmount();
    }
  });

  it('keeps the cursor inside the rows when they shrink', async () => {
    const { store, runDashboardServiceAction } = seedServices();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, '\x1b[B');
      store.setState({ dashboardServices: { status: 'active', edt: { ulid: 'e', topic: 't', serviceCount: 1 }, services: [serviceRow('a')], others: [] } });
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, '\x12');
      expect(runDashboardServiceAction).toHaveBeenLastCalledWith('/r/a', 'restart-simple');
    } finally {
      instance.unmount();
    }
  });

  describe('EDT actions', () => {
    function withSpies(extra: Record<string, unknown> = {}) {
      const { store } = seedServices();
      const openEdtSwitchDialog = vi.fn();
      const openEdtCreateDialog = vi.fn();
      const setActiveZone = vi.fn();
      store.setState({ openEdtSwitchDialog, openEdtCreateDialog, setActiveZone, ...extra } as never);
      return { store, openEdtSwitchDialog, openEdtCreateDialog, setActiveZone };
    }

    it('E enters the active EDT in the EDTs zone without a dialog', async () => {
      const { store, openEdtSwitchDialog, openEdtCreateDialog, setActiveZone } = withSpies();
      const { instance, stdin } = mount(store);
      try {
        await instance.waitUntilRenderFlush();
        await press(instance, stdin, 'E');
        expect(setActiveZone).toHaveBeenCalledWith('edts');
        expect(openEdtSwitchDialog).not.toHaveBeenCalled();
        expect(openEdtCreateDialog).not.toHaveBeenCalled();
      } finally {
        instance.unmount();
      }
    });

    it('e opens the quick-pick, or the create wizard when no EDT exists', async () => {
      const first = withSpies({ edts: [{}] });
      const a = mount(first.store);
      try {
        await a.instance.waitUntilRenderFlush();
        await press(a.instance, a.stdin, 'e');
        expect(first.openEdtSwitchDialog).toHaveBeenCalledWith('edt-switch');
        expect(first.setActiveZone).toHaveBeenCalledWith('edts');
      } finally {
        a.instance.unmount();
      }
      const second = withSpies({ edts: [], dashboardServices: { status: 'no-active-edt', edt: null, services: [], others: [] } });
      const b = mount(second.store);
      try {
        await b.instance.waitUntilRenderFlush();
        await press(b.instance, b.stdin, 'e');
        expect(second.openEdtCreateDialog).toHaveBeenCalled();
        expect(second.setActiveZone).toHaveBeenCalledWith('edts');
        await press(b.instance, b.stdin, 'E');
        expect(second.openEdtSwitchDialog).not.toHaveBeenCalled();
      } finally {
        b.instance.unmount();
      }
    });

    it('leaves E and e to the shell on a missing snapshot, an errored one and the registry prompts', async () => {
      const cases: Record<string, Record<string, unknown>> = {
        'null snapshot': { dashboardServices: null, dashboardServicesStatus: 'loading' },
        'error snapshot': { dashboardServices: null, dashboardServicesStatus: 'error' },
        'registry error': { registryEmptyStatus: 'error', checkRegistryEmpty: async () => {} },
        'empty registry': { registryEmpty: true },
      };
      for (const [name, extra] of Object.entries(cases)) {
        const { store, openEdtSwitchDialog, openEdtCreateDialog, setActiveZone } = withSpies({ edts: [], ...extra });
        const { instance, stdin } = mount(store);
        try {
          await instance.waitUntilRenderFlush();
          await press(instance, stdin, 'E');
          await press(instance, stdin, 'e');
          expect(openEdtSwitchDialog, name).not.toHaveBeenCalled();
          expect(openEdtCreateDialog, name).not.toHaveBeenCalled();
          expect(setActiveZone, name).not.toHaveBeenCalled();
        } finally {
          instance.unmount();
        }
      }
    });

    it('with the real store, e leaves the quick-pick request and the EDTs zone active', async () => {
      const { store } = seedServices();
      store.setState({ edts: [{ ulid: 'x', topic: 'x', createdAt: '2026-01-01T00:00:00Z', status: 'active', members: [] } as never] });
      const { instance, stdin } = mount(store);
      try {
        await instance.waitUntilRenderFlush();
        await press(instance, stdin, 'e');
        expect(store.getState().currentEdtAction).toMatchObject({ type: 'switch', target: 'select EDT' });
        expect(store.getState().activeZone).toBe('edts');
        // The EDTs zone consumes the request when it mounts.
        store.setState({ loadEdts: async () => {}, loadEdtsBranches: async () => {} } as never);
        await renderToString(createElement(EdtsZone, { useStore: store }));
        expect(store.getState().currentEdtAction).toBeNull();
      } finally {
        instance.unmount();
      }
      const zero = seedServices();
      zero.store.setState({ edts: [], dashboardServices: { status: 'no-active-edt', edt: null, services: [], others: [] } });
      const again = mount(zero.store);
      try {
        await again.instance.waitUntilRenderFlush();
        await press(again.instance, again.stdin, 'e');
        expect(zero.store.getState().currentEdtAction).toMatchObject({ type: 'create' });
        expect(zero.store.getState().activeZone).toBe('edts');
      } finally {
        again.instance.unmount();
      }
    });

    it('ignores E and e while an overlay owns the keyboard', async () => {
      const { store, openEdtSwitchDialog, setActiveZone } = withSpies();
      const { instance, stdin } = mount(store);
      try {
        await instance.waitUntilRenderFlush();
        store.setState({ helpOpen: true });
        await press(instance, stdin, 'E');
        await press(instance, stdin, 'e');
        expect(setActiveZone).not.toHaveBeenCalled();
        expect(openEdtSwitchDialog).not.toHaveBeenCalled();
      } finally {
        instance.unmount();
      }
    });
  });
});
