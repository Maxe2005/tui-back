// tui/zones/logs: real-keypress actions menu (a).
import { render } from 'ink';
import { describe, it, expect, vi } from 'vitest';
import type { ServiceAction } from '../../../../../core/service-actions/index.js';
import { KEYS } from '../../shared/test-support/fake-tty.js';
import { LogsZone } from './logs-zone.js';
import { service, press, pressEscape, mount, seedStore } from './logs-zone.test-support.js';

// The `a` actions menu: the service-action registry's rows for the focused pane, in a MenuList.
describe('LogsZone actions menu (a)', () => {
  function pane(path: string, overrides: Record<string, unknown> = {}) {
    return {
      repoPath: path,
      service: path.split('/').pop() ?? path,
      lines: [],
      streamError: null,
      noMoreHistory: false,
      scrollOffset: 0,
      health: 'up',
      restarting: false,
      ...overrides,
    };
  }

  const AVAILABLE = { available: true as const };
  function registryActions(containerLess = false): ServiceAction[] {
    const blocked = containerLess ? { available: false as const, reason: 'no container' } : AVAILABLE;
    return [
      { id: 'open-in-ide', label: 'Open in IDE', key: 'Ctrl+O', availability: AVAILABLE },
      { id: 'restart-simple', label: 'Restart', key: 'Ctrl+R', availability: blocked },
      { id: 'restart-clean', label: 'Clean restart', key: 'Ctrl+L', availability: blocked },
      { id: 'terminal-service', label: 'Terminal', key: 'Ctrl+T', availability: AVAILABLE },
      { id: 'terminal-container', label: 'Container terminal', key: 'Ctrl+X', availability: blocked },
    ];
  }

  function gridStore(overrides: Record<string, unknown> = {}) {
    return seedStore({
      subscribeLogsPane: vi.fn(async () => {}),
      unsubscribeLogsPane: vi.fn(),
      logsOtherSelected: ['/repos/api-gateway'],
      logsPanes: { '/repos/api-gateway': pane('/repos/api-gateway') },
      ...overrides,
    });
  }

  async function focusPanes(instance: ReturnType<typeof render>, stdin: NodeJS.ReadStream): Promise<void> {
    await press(instance, stdin, KEYS.tab); // edt-list -> other-list
    await press(instance, stdin, KEYS.tab); // other-list -> panes
  }

  it('`a` on a sub-focused pane lists the five registry actions, and captures input', async () => {
    const listLogsPaneActions = vi.fn(async () => registryActions());
    const store = gridStore({ listLogsPaneActions });
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await focusPanes(instance, stdin);
      await press(instance, stdin, 'a');
      await instance.waitUntilRenderFlush();

      expect(listLogsPaneActions).toHaveBeenCalledWith('/repos/api-gateway');
      expect(store.getState().zoneInputCaptured).toBe(true);
      const frame = stdout.output;
      expect(frame).toContain('SERVICE ACTIONS');
      for (const label of ['Open in IDE', 'Restart', 'Clean restart', 'Terminal', 'Container terminal']) {
        expect(frame).toContain(label);
      }
      // The Dashboard's Ctrl keys do nothing in Logs, so the menu never shows them.
      for (const dashboardKey of ['Ctrl+O', 'Ctrl+R', 'Ctrl+L', 'Ctrl+T', 'Ctrl+X']) {
        expect(frame).not.toContain(dashboardKey);
      }
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('`a` from the service lists never opens the menu', async () => {
    const listLogsPaneActions = vi.fn(async () => registryActions());
    const store = gridStore({ listLogsPaneActions });
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, 'a');
      await press(instance, stdin, KEYS.tab); // other-list
      await press(instance, stdin, 'a');
      expect(listLogsPaneActions).not.toHaveBeenCalled();
      expect(store.getState().zoneInputCaptured).toBe(false);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Enter on Clean restart closes the menu and runs that registry action on the pane', async () => {
    const runLogsPaneAction = vi.fn(async () => {});
    const store = gridStore({ listLogsPaneActions: vi.fn(async () => registryActions()), runLogsPaneAction });
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await focusPanes(instance, stdin);
      await press(instance, stdin, 'a');
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.enter);

      expect(runLogsPaneAction).toHaveBeenCalledWith('/repos/api-gateway', 'restart-clean', 'api-gateway');
      expect(store.getState().zoneInputCaptured).toBe(false);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Enter on Terminal runs the terminal entry (End jumps to the last row, the container terminal)', async () => {
    const runLogsPaneAction = vi.fn(async () => {});
    const store = gridStore({ listLogsPaneActions: vi.fn(async () => registryActions()), runLogsPaneAction });
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await focusPanes(instance, stdin);
      await press(instance, stdin, 'a');
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.end);
      await press(instance, stdin, KEYS.up);
      await press(instance, stdin, KEYS.enter);

      expect(runLogsPaneAction).toHaveBeenCalledWith('/repos/api-gateway', 'terminal-service', 'api-gateway');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('a container-less pane shows the restarts and the container terminal disabled with `no container`; Enter on them is ignored', async () => {
    const runLogsPaneAction = vi.fn(async () => {});
    const store = gridStore({
      listLogsPaneActions: vi.fn(async () => registryActions(true)),
      runLogsPaneAction,
      logsPanes: { '/repos/api-gateway': pane('/repos/api-gateway', { health: 'no-container', noContainer: true }) },
    });
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await focusPanes(instance, stdin);
      await press(instance, stdin, 'a');
      await instance.waitUntilRenderFlush();
      expect(stdout.output).toContain('no container');
      expect(stdout.output).toContain('Terminal');

      await press(instance, stdin, KEYS.down); // Restart (disabled)
      await press(instance, stdin, KEYS.enter);
      await press(instance, stdin, KEYS.end); // Container terminal (disabled)
      await press(instance, stdin, KEYS.enter);

      expect(runLogsPaneAction).not.toHaveBeenCalled();
      expect(store.getState().zoneInputCaptured).toBe(true);

      // Open in IDE and Terminal stay enabled on a container-less pane.
      await press(instance, stdin, KEYS.home); // Open in IDE
      await press(instance, stdin, KEYS.enter);
      expect(runLogsPaneAction).toHaveBeenLastCalledWith('/repos/api-gateway', 'open-in-ide', 'api-gateway');
      await press(instance, stdin, 'a');
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.end);
      await press(instance, stdin, KEYS.up); // Terminal
      await press(instance, stdin, KEYS.enter);
      expect(runLogsPaneAction).toHaveBeenLastCalledWith('/repos/api-gateway', 'terminal-service', 'api-gateway');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('a failed listing shows one error line and Esc closes the menu', async () => {
    const store = gridStore({ listLogsPaneActions: vi.fn(async () => null) });
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await focusPanes(instance, stdin);
      await press(instance, stdin, 'a');
      await instance.waitUntilRenderFlush();
      expect(stdout.output).toContain('The service actions could not be loaded.');

      await pressEscape(instance, stdin);
      expect(store.getState().zoneInputCaptured).toBe(false);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('while open, zone keys (c, f, R, O, /) do nothing and the menu stays open', async () => {
    const runLogsPaneShortcut = vi.fn(async () => {});
    const clearLogsPane = vi.fn();
    const store = gridStore({ listLogsPaneActions: vi.fn(async () => registryActions()), runLogsPaneShortcut, clearLogsPane });
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await focusPanes(instance, stdin);
      await press(instance, stdin, 'a');
      for (const key of ['c', 'f', 'R', 'O', '/', 'q', ':', 'l']) {
        await press(instance, stdin, key);
      }
      expect(runLogsPaneShortcut).not.toHaveBeenCalled();
      expect(clearLogsPane).not.toHaveBeenCalled();
      expect(store.getState().zoneInputCaptured).toBe(true);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('`a` in fullscreen opens the menu on the fullscreen pane', async () => {
    const listLogsPaneActions = vi.fn(async () => registryActions());
    const runLogsPaneAction = vi.fn(async () => {});
    const store = gridStore({ listLogsPaneActions, runLogsPaneAction, logsOtherSelected: [] });
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, KEYS.enter); // ad hoc fullscreen preview on api-gateway
      expect(store.getState().logsFullscreenTarget).toBe('/repos/api-gateway');
      await press(instance, stdin, 'a');
      await instance.waitUntilRenderFlush();
      expect(listLogsPaneActions).toHaveBeenCalledWith('/repos/api-gateway');
      expect(stdout.output).toContain('SERVICE ACTIONS');

      await press(instance, stdin, KEYS.enter); // Open in IDE
      expect(runLogsPaneAction).toHaveBeenCalledWith('/repos/api-gateway', 'open-in-ide', 'api-gateway');
      // Closing the menu leaves fullscreen open.
      expect(store.getState().logsFullscreenTarget).toBe('/repos/api-gateway');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('a slow listing from an earlier open is dropped once the menu was closed and reopened on another pane', async () => {
    const pending = new Map<string, (actions: ServiceAction[] | null) => void>();
    const listLogsPaneActions = vi.fn(
      (repoPath: string) => new Promise<ServiceAction[] | null>((resolve) => pending.set(repoPath, resolve)),
    );
    const store = gridStore({
      listLogsPaneActions,
      logsOtherSelected: ['/repos/api-gateway', '/repos/route-explorer'],
      logsPanes: {
        '/repos/api-gateway': pane('/repos/api-gateway'),
        '/repos/route-explorer': pane('/repos/route-explorer'),
      },
    });
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await focusPanes(instance, stdin);
      await press(instance, stdin, 'a'); // api-gateway, listing hangs
      await pressEscape(instance, stdin);
      await press(instance, stdin, KEYS.right); // sub-focus route-explorer
      await press(instance, stdin, 'a');
      expect(listLogsPaneActions).toHaveBeenLastCalledWith('/repos/route-explorer');

      // The first listing lands late with an error: the open menu must not show it.
      const before = stdout.output.length;
      pending.get('/repos/api-gateway')?.(null);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await instance.waitUntilRenderFlush();
      expect(stdout.output.slice(before)).not.toContain('could not be loaded');
      pending.get('/repos/route-explorer')?.(registryActions());
      await new Promise((resolve) => setTimeout(resolve, 0));
      await instance.waitUntilRenderFlush();
      expect(stdout.output.slice(before)).toContain('Container terminal');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('a fullscreen pane with no captured or listed name passes its directory name, never the path', async () => {
    const listLogsPaneActions = vi.fn(async () => registryActions());
    const runLogsPaneShortcut = vi.fn(async () => {});
    const store = gridStore({
      listLogsPaneActions,
      runLogsPaneShortcut,
      logsOtherSelected: [],
      logsFullscreenTarget: '/repos/unlisted-svc',
      logsFullscreenServiceName: null,
      logsPanes: { '/repos/unlisted-svc': pane('/repos/unlisted-svc') },
    });
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, 'R');
      expect(runLogsPaneShortcut).toHaveBeenCalledWith('/repos/unlisted-svc', 'restart', 'unlisted-svc');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});
