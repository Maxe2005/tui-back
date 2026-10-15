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

  const flagged = (name: string) => ({
    service: name,
    path: `/r/${name}`,
    manifest: { ok: true as const, value: { sharedBranch: 'development', protectedBranches: [] } },
    container: { ok: true as const, value: 'up' as const },
    branch: 'feat/x',
    divergence: { status: 'current' as const, ahead: 0, behind: 1 },
    workingTree: { ok: true as const, value: { uncommitted: false, mergeInProgress: false, rebaseInProgress: false } },
    protectedBranch: false,
    usedByEdts: [],
  });
  const seedAttention = () => {
    const { store } = seed();
    store.setState({
      dashboardServicesStatus: 'ready',
      dashboardServices: { status: 'active', edt: { ulid: 'e', topic: 't', serviceCount: 2 }, services: [flagged('svc-a'), flagged('svc-b')] },
    });
    return store;
  };

  it('moves the attention cursor with the arrows and focuses the service on Enter', async () => {
    const store = seedAttention();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, '\u001B[B');
      await press(instance, stdin, '\r');
      expect(store.getState().dashboardFocusedService).toBe('svc-b');
    } finally {
      instance.unmount();
    }
  });

  it('ignores Enter while an overlay owns the keyboard', async () => {
    const store = seedAttention();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      store.setState({ settingsScreenOpen: true });
      await press(instance, stdin, '\r');
      expect(store.getState().dashboardFocusedService).toBeNull();
    } finally {
      instance.unmount();
    }
  });
});
