// tui/zones/dashboard: real keypresses — R reloads the snapshot, and stays inert behind an overlay.
import { createElement } from 'react';
import { Box, render } from 'ink';
import { describe, expect, it, vi } from 'vitest';
import { createAppStore } from '../../store/app-store.js';
import { fakeInteractiveTtyStdin, FakeTtyStdout } from '../../shared/test-support/fake-tty.js';
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
    container: { ok: true as const, value: 'up' as const },
    branch: 'feat/x',
    divergence: { status: 'current' as const, ahead: 0, behind: 0 },
    workingTree: { ok: true as const, value: { uncommitted: false, mergeInProgress: false, rebaseInProgress: false } },
    protectedBranch: false,
    usedByEdts: [],
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
    dashboardServices: { status: 'active', edt: { ulid: 'e', topic: 't', serviceCount: 2 }, services: [serviceRow('a'), serviceRow('b')] },
    dashboardServiceActions: {
      '/r/a': [action('open-in-ide', 'Ctrl+O'), action('restart-simple', 'Ctrl+R'), action('restart-clean', 'Ctrl+L')],
      '/r/b': [action('open-in-ide', 'Ctrl+O'), action('restart-simple', 'Ctrl+R'), action('restart-clean', 'Ctrl+L')],
    },
    runDashboardServiceAction,
    loadDashboardServiceActions,
    openServiceInZone,
  });
  return { store, loadDashboard, runDashboardServiceAction, openServiceInZone };
}

describe('DashboardZone interaction', () => {
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
      store.setState({ dashboardServices: { status: 'active', edt: { ulid: 'e', topic: 't', serviceCount: 1 }, services: [serviceRow('a')] } });
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, '\x12');
      expect(runDashboardServiceAction).toHaveBeenLastCalledWith('/r/a', 'restart-simple');
    } finally {
      instance.unmount();
    }
  });
});
