// tui/zones/logs: real-keypress interactions — renderToString's fake stdin never emits data, so
// Tab/Space/Enter/Escape/Ctrl+A's dispatch through a real `useInput` round-trip is only
// observable here (shared/test-support/fake-tty.ts).
import { render } from 'ink';
import { describe, it, expect, vi } from 'vitest';
import type { ServiceAction } from '../../../../../core/service-actions/index.js';
import { FakeTtyStdout, KEYS } from '../../shared/test-support/fake-tty.js';
import { LogsZone } from './logs-zone.js';
import { service, press, pressEscape, openRuleEditor, mount, seedStore } from './logs-zone.test-support.js';

describe('LogsZone real-keypress interactions', () => {
  // Bounds the filter-history grid browser's vertical extent to the terminal's actual row count,
  // like its horizontal truncation/scroll, recomputed live off useWindowSize() on every resize.
  describe('history grid vertical pagination', () => {
    it('the grid gains a "more below" indicator once the terminal shrinks below its row count, and loses it again once the terminal grows back', async () => {
      const history = Array.from({ length: 10 }, (_, i) => `entry-${i}`);
      const store = seedStore({ filterHistory: { 'global:text': history } });
      const { instance, stdin, stdout } = mount(store);
      try {
        await instance.waitUntilRenderFlush();

        await openRuleEditor(instance, stdin, '/');
        await press(instance, stdin, KEYS.down); // opens the grid, cursor at column 0 row 0
        let lastFrame = stdout.output.slice(stdout.output.lastIndexOf('GLOBAL LOG FILTER'));
        expect(lastFrame).toContain('entry-0');
        expect(lastFrame).not.toContain('more below');
        expect(lastFrame).not.toContain('more above');

        // Shrinks to the 12-row minimum, still below what the 8-row (default) first column needs.
        stdout.rows = 12;
        stdout.emit('resize');
        await instance.waitUntilRenderFlush();
        await instance.waitUntilRenderFlush();
        lastFrame = stdout.output.slice(stdout.output.lastIndexOf('GLOBAL LOG FILTER'));
        expect(lastFrame).toContain('more below');
        expect(lastFrame).not.toContain('more above');

        // Grows back to the original size — the grid un-paginates, no visible regression.
        stdout.rows = 24;
        stdout.emit('resize');
        await instance.waitUntilRenderFlush();
        await instance.waitUntilRenderFlush();
        lastFrame = stdout.output.slice(stdout.output.lastIndexOf('GLOBAL LOG FILTER'));
        expect(lastFrame).not.toContain('more below');
        expect(lastFrame).not.toContain('more above');
      } finally {
        instance.unmount();
        await instance.waitUntilExit();
      }
    });

    // `GridCursor.row` is an absolute index into the *full* (unsliced) column — the lookup uses
    // `groupCommandsByColumn`, never the vertically-windowed `layoutCommandGrid` result (built
    // only for rendering) — so scrolling the grid down must never change which entry Enter
    // recalls. Exactly 8 entries keeps every one in a single column (default
    // filterHistoryGridMaxRows); shrinking the terminal forces rowScrollOffset > 0 partway.
    it('recalls the correct entry after scrolling the grid past rowScrollOffset > 0, not an off-by-rowScrollOffset one', async () => {
      const history = Array.from({ length: 8 }, (_, i) => `entry-${i}`);
      const store = seedStore({ filterHistory: { 'global:text': history } });
      const { instance, stdin, stdout } = mount(store);
      try {
        await instance.waitUntilRenderFlush();

        await openRuleEditor(instance, stdin, '/');
        await press(instance, stdin, KEYS.down); // opens the grid, cursor at column 0 row 0

        // Shrinks enough that the 8-row column can't fit without vertical pagination.
        stdout.rows = 11;
        stdout.emit('resize');
        await instance.waitUntilRenderFlush();
        await instance.waitUntilRenderFlush();

        // Walks the cursor down to row 5 — past where the window must have scrolled
        // (rowScrollOffset > 0) to keep it visible under the shrunk budget.
        for (let i = 0; i < 5; i += 1) {
          await press(instance, stdin, KEYS.down);
        }
        let lastFrame = stdout.output.slice(stdout.output.lastIndexOf('GLOBAL LOG FILTER'));
        expect(lastFrame).toContain('more above'); // proves rowScrollOffset > 0 at this point

        await press(instance, stdin, KEYS.enter);
        lastFrame = stdout.output.slice(stdout.output.lastIndexOf('GLOBAL LOG FILTER'));
        expect(lastFrame).toContain('Text: entry-5');
      } finally {
        instance.unmount();
        await instance.waitUntilExit();
      }
    });

    // A column's display width comes from the full column, so its widest entry scrolling out of
    // view must not shrink it or misalign the columns after it. Two columns of 5 rows each
    // (filterHistoryGridMaxRows: 5), the widest entry pinned to column 0's top row: scrolling
    // column 0 down past it must not move where column 1's entries start.
    it('keeps a column\'s display width stable as its own vertical scroll changes (column 1 never shifts)', async () => {
      const history = ['LONGLONGLONGLONGLONGLONG', 'e1', 'e2', 'e3', 'e4', 'f5', 'f6', 'f7', 'f8', 'f9'];
      const store = seedStore({ filterHistory: { 'global:text': history } });
      store.setState({
        settings: { ...store.getState().settings, logs: { ...store.getState().settings.logs, filterHistoryGridMaxRows: 5 } },
      });
      const { instance, stdin, stdout } = mount(store);
      try {
        await instance.waitUntilRenderFlush();

        await openRuleEditor(instance, stdin, '/');
        await press(instance, stdin, KEYS.down); // opens the grid, cursor at column 0 row 0 — the wide entry is visible here

        stdout.rows = 12; // the 12-row minimum still forces vertical pagination on the 5-row-tall column 0
        stdout.emit('resize');
        await instance.waitUntilRenderFlush();
        await instance.waitUntilRenderFlush();

        let frame = stdout.output.slice(stdout.output.lastIndexOf('GLOBAL LOG FILTER'));
        const wideEntryLine = frame.split('\n').find((line) => line.includes('LONGLONGLONGLONGLONGLONG'));
        const column1StartWithWideEntryVisible = wideEntryLine?.indexOf('f5');
        expect(column1StartWithWideEntryVisible).toBeGreaterThan(0);

        // Scrolls column 0 down past the wide entry (row 0) to row 4 — it's no longer rendered.
        for (let i = 0; i < 4; i += 1) {
          await press(instance, stdin, KEYS.down);
        }
        frame = stdout.output.slice(stdout.output.lastIndexOf('GLOBAL LOG FILTER'));
        expect(frame).not.toContain('LONGLONGLONGLONGLONGLONG');
        const shortEntryLine = frame.split('\n').find((line) => line.includes('e3'));
        const column1StartWithWideEntryHidden = shortEntryLine?.indexOf('f8');

        expect(column1StartWithWideEntryHidden).toBe(column1StartWithWideEntryVisible);
      } finally {
        instance.unmount();
        await instance.waitUntilExit();
      }
    });

    // The editor renders as a sibling *below* the "LOGS" + list/grid block (Ink has no absolute
    // positioning), so its rows compete with the still-mounted service lists/hints/grid for the
    // same row budget. With enough services to overflow, opening the global filter editor must
    // keep the hints panel hidden and the service list behind the editor bounded.
    it('EDITOR_OPEN_BEHIND_CONTENT: opening the filter editor over an overflowing services list keeps the hints panel hidden and the list itself bounded', async () => {
      const store = seedStore({
        edtsBranches: Array.from({ length: 60 }, (_, i) => service({ service: `svc-${i}`, path: `/repos/svc-${i}` })),
      });
      const { instance, stdin, stdout } = mount(store);
      try {
        await instance.waitUntilRenderFlush();

        // Before the editor opens: an overflowing OTHER SERVICES list already shows the
        // bounded-window indicator.
        let lastFrame = stdout.output.slice(stdout.output.lastIndexOf('LOGS'));
        expect(lastFrame).toContain('more below');

        await openRuleEditor(instance, stdin, '/');
        lastFrame = stdout.output.slice(stdout.output.lastIndexOf('LOGS'));
        expect(lastFrame).toContain('GLOBAL LOG FILTER');

        // None of the services-list keybinding hints render while the editor owns input.
        expect(lastFrame).not.toContain('[Space] toggle');
        expect(lastFrame).not.toContain('[Ctrl+A] toggle all');

        // The service list mounted behind the editor is still present but bounded, not an
        // unconditional dump of all 60 rows now that the editor's own body also needs rows.
        expect(lastFrame).toContain('svc-0');
        expect(lastFrame).not.toContain('svc-59');
        expect(lastFrame).toContain('more below');
      } finally {
        instance.unmount();
        await instance.waitUntilExit();
      }
    });
  });

  describe('wrap keys', () => {
    function longPane(path: string, marker: string) {
      return {
        repoPath: path,
        service: path.split('/').pop() ?? path,
        lines: [{ timestamp: '2026-01-01T00:00:00.000Z', stream: 'stdout' as const, text: `${'word '.repeat(60)}${marker}` }],
        streamError: null,
        noMoreHistory: false,
        scrollOffset: 0,
        health: 'up',
        restarting: false,
      };
    }

    async function mountWithTwoPanes() {
      const store = seedStore({
        subscribeLogsPane: vi.fn(async () => {}),
        unsubscribeLogsPane: vi.fn(),
        logsOtherSelected: ['/repos/api-gateway', '/repos/route-explorer'],
        logsPanes: {
          '/repos/api-gateway': longPane('/repos/api-gateway', 'ENDAAA'),
          '/repos/route-explorer': longPane('/repos/route-explorer', 'ENDBBB'),
        },
      });
      const mounted = mount(store);
      await mounted.instance.waitUntilRenderFlush();
      await press(mounted.instance, mounted.stdin, KEYS.tab);
      await press(mounted.instance, mounted.stdin, KEYS.tab);
      return mounted;
    }

    function lastFrame(stdout: FakeTtyStdout, before: number): string {
      return stdout.contentFramesSince(before).at(-1) ?? '';
    }

    it('Ctrl+W wraps nothing, W wraps every pane, bare w flips only the focused pane', async () => {
      const { instance, stdin, stdout } = await mountWithTwoPanes();
      try {
        let mark = stdout.chunkCount;
        await press(instance, stdin, KEYS.ctrlW);
        let frame = lastFrame(stdout, mark);
        expect(frame).not.toContain('ENDAAA');
        expect(frame).not.toContain('ENDBBB');

        mark = stdout.chunkCount;
        await press(instance, stdin, 'W');
        frame = lastFrame(stdout, mark);
        expect(frame).toContain('ENDAAA');
        expect(frame).toContain('ENDBBB');

        // Bare w flips only the focused (first) pane back to truncated.
        mark = stdout.chunkCount;
        await press(instance, stdin, 'w');
        frame = lastFrame(stdout, mark);
        expect(frame).not.toContain('ENDAAA');
        expect(frame).toContain('ENDBBB');
      } finally {
        instance.unmount();
        await instance.waitUntilExit();
      }
    });
  });
});

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
