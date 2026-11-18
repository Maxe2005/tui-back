// tui/zones/logs: real-keypress inline service health, restart and open-in-IDE interactions.
import { describe, it, expect, vi } from 'vitest';
import { KEYS } from '../../shared/test-support/fake-tty.js';
import { LogsZone } from './logs-zone.js';
import { service, press, mount, seedStore } from './logs-zone.test-support.js';

describe('LogsZone real-keypress interactions — service actions', () => {
  // `R` on a sub-focused grid pane restarts that one pane's service.
  describe('inline service health & restart', () => {
    function paneFor(path: string, overrides: Record<string, unknown> = {}) {
      const name = path.split('/').pop() ?? path;
      return {
        repoPath: path,
        service: name,
        lines: [],
        streamError: null,
        noMoreHistory: false,
        scrollOffset: 0,
        health: 'down',
        restarting: false,
        ...overrides,
      };
    }

    it('"R" on a sub-focused grid pane runs the registry restart shortcut for that pane only', async () => {
      const runLogsPaneShortcut = vi.fn(async () => {});
      const store = seedStore({
        subscribeLogsPane: vi.fn(async () => {}),
        unsubscribeLogsPane: vi.fn(),
        runLogsPaneShortcut,
        logsOtherSelected: ['/repos/api-gateway'],
        logsPanes: { '/repos/api-gateway': paneFor('/repos/api-gateway') },
      });
      const { instance, stdin, stdout } = mount(store);
      try {
        await instance.waitUntilRenderFlush();
        // The pane header renders the inline health badge next to the service's logs.
        expect(stdout.output).toContain('down');
        await press(instance, stdin, KEYS.tab); // edt-list -> other-list
        await press(instance, stdin, KEYS.tab); // other-list -> panes

        await press(instance, stdin, 'R');

        expect(runLogsPaneShortcut).toHaveBeenCalledTimes(1);
        expect(runLogsPaneShortcut).toHaveBeenCalledWith('/repos/api-gateway', 'restart', 'api-gateway');
      } finally {
        instance.unmount();
        await instance.waitUntilExit();
      }
    });

    it('a restarting pane renders its disabled restart control; `R` still defers to the registry and the slice guard', async () => {
      const runLogsPaneShortcut = vi.fn(async () => {});
      const store = seedStore({
        subscribeLogsPane: vi.fn(async () => {}),
        unsubscribeLogsPane: vi.fn(),
        runLogsPaneShortcut,
        logsOtherSelected: ['/repos/api-gateway'],
        logsPanes: { '/repos/api-gateway': paneFor('/repos/api-gateway', { restarting: true }) },
      });
      const { instance, stdin, stdout } = mount(store);
      try {
        await instance.waitUntilRenderFlush();
        // The control renders its disabled state while a restart is in flight. The exact
        // wording is locked in the logic unit tests; the narrow row truncates it, so here assert
        // its distinctive leading words while the bare state is gone.
        const flat = stdout.output.replace(/\s+/g, ' ');
        expect(flat).toContain('restart requested');
        expect(flat).not.toContain('restarting');
        await press(instance, stdin, KEYS.tab); // edt-list -> other-list
        await press(instance, stdin, KEYS.tab); // other-list -> panes

        await press(instance, stdin, 'R');

        // No availability rule in the zone: the registry/slice decide (the slice no-ops).
        expect(runLogsPaneShortcut).toHaveBeenCalledWith('/repos/api-gateway', 'restart', 'api-gateway');
      } finally {
        instance.unmount();
        await instance.waitUntilExit();
      }
    });

    it('"R" on a fullscreen pane runs the registry restart shortcut for that pane\'s service', async () => {
      const runLogsPaneShortcut = vi.fn(async () => {});
      const store = seedStore({
        subscribeLogsPane: vi.fn(async () => {}),
        unsubscribeLogsPane: vi.fn(),
        runLogsPaneShortcut,
        logsPanes: { '/repos/api-gateway': paneFor('/repos/api-gateway', { health: 'up' }) },
      });
      const { instance, stdin } = mount(store);
      try {
        await instance.waitUntilRenderFlush();
        await press(instance, stdin, KEYS.tab); // edt-list -> other-list
        await press(instance, stdin, KEYS.enter); // ad hoc fullscreen preview on api-gateway
        expect(store.getState().logsFullscreenTarget).toBe('/repos/api-gateway');

        await press(instance, stdin, 'R');

        expect(runLogsPaneShortcut).toHaveBeenCalledTimes(1);
        expect(runLogsPaneShortcut).toHaveBeenCalledWith('/repos/api-gateway', 'restart', 'api-gateway');
      } finally {
        instance.unmount();
        await instance.waitUntilExit();
      }
    });
  });

  describe('open-in-IDE key and restart mode hint', () => {
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

    it('"O" on a sub-focused grid pane runs the registry open-in-IDE shortcut, including a container-less one', async () => {
      const runLogsPaneShortcut = vi.fn(async () => {});
      const store = seedStore({
        subscribeLogsPane: vi.fn(async () => {}),
        unsubscribeLogsPane: vi.fn(),
        runLogsPaneShortcut,
        logsOtherSelected: ['/repos/api-gateway'],
        logsPanes: { '/repos/api-gateway': pane('/repos/api-gateway', { health: 'no-container' }) },
      });
      const { instance, stdin } = mount(store);
      try {
        await instance.waitUntilRenderFlush();
        await press(instance, stdin, KEYS.tab);
        await press(instance, stdin, KEYS.tab);

        await press(instance, stdin, 'O');

        expect(runLogsPaneShortcut).toHaveBeenCalledWith('/repos/api-gateway', 'ide', 'api-gateway');
      } finally {
        instance.unmount();
        await instance.waitUntilExit();
      }
    });

    it('"O" in fullscreen opens the IDE while lowercase "o" still only toggles stdout', async () => {
      const runLogsPaneShortcut = vi.fn(async () => {});
      const store = seedStore({
        subscribeLogsPane: vi.fn(async () => {}),
        unsubscribeLogsPane: vi.fn(),
        runLogsPaneShortcut,
        logsPanes: { '/repos/api-gateway': pane('/repos/api-gateway') },
      });
      const { instance, stdin } = mount(store);
      try {
        await instance.waitUntilRenderFlush();
        await press(instance, stdin, KEYS.tab);
        await press(instance, stdin, KEYS.enter);
        expect(store.getState().logsFullscreenTarget).toBe('/repos/api-gateway');

        await press(instance, stdin, 'o');
        expect(runLogsPaneShortcut).not.toHaveBeenCalled();
        await press(instance, stdin, 'O');
        expect(runLogsPaneShortcut).toHaveBeenCalledWith('/repos/api-gateway', 'ide', 'api-gateway');
      } finally {
        instance.unmount();
        await instance.waitUntilExit();
      }
    });

    it('the pane hint names the active restart mode and the pane shows its notice dim', async () => {
      const store = seedStore({
        subscribeLogsPane: vi.fn(async () => {}),
        unsubscribeLogsPane: vi.fn(),
        logsOtherSelected: ['/repos/api-gateway'],
        logsPanes: {
          '/repos/api-gateway': pane('/repos/api-gateway', { notice: 'no clean-restart recipe — simple restart' }),
        },
      });
      const { instance, stdout } = mount(store);
      try {
        await instance.waitUntilRenderFlush();
        expect(stdout.output).toContain('restart');
        expect(stdout.output).not.toContain('restart (clean)');
        expect(stdout.output).toContain('no clean-restart recipe — simple restart');

        store.setState((state) => ({ settings: { ...state.settings, logs: { ...state.settings.logs, restartMode: 'clean' } } }));
        await instance.waitUntilRenderFlush();
        expect(stdout.output).toContain('restart (clean)');
      } finally {
        instance.unmount();
        await instance.waitUntilExit();
      }
    });
  });
});
