// tui/zones/logs: real-keypress focus, selection, preview, retry and Ctrl+A interactions.
import { describe, it, expect, vi } from 'vitest';
import { KEYS } from '../../shared/test-support/fake-tty.js';
import { LogsZone } from './logs-zone.js';
import { service, press, pressEscape, mount, seedStore } from './logs-zone.test-support.js';

describe('LogsZone real-keypress interactions — navigation', () => {
  it('mounting resolves container presence and polls the listed rows, unmount stops polling', async () => {
    const store = seedStore();
    const resolveLogsContainerPresence = vi.fn();
    const startLogsListedHealthPolling = vi.fn();
    const stopLogsListedHealthPolling = vi.fn();
    store.setState({ resolveLogsContainerPresence, startLogsListedHealthPolling, stopLogsListedHealthPolling });
    const { instance } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      expect(resolveLogsContainerPresence).toHaveBeenCalledWith(['/repos/api-gateway', '/repos/route-explorer']);
      expect(startLogsListedHealthPolling).toHaveBeenCalledWith(['/repos/api-gateway', '/repos/route-explorer']);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
    expect(stopLogsListedHealthPolling).toHaveBeenCalled();
  });

  it('Tab cycles focus edt-list -> other-list -> panes -> edt-list (Space toggles the currently-focused list)', async () => {
    const store = seedStore();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      // Both services land in OTHER SERVICES (no active EDT) — Tab once to reach that list.
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, KEYS.space);
      expect(store.getState().logsOtherSelected).toEqual(['/repos/api-gateway']);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Shift+Tab reverses focus edt-list -> panes -> other-list (Space then toggles the other list)', async () => {
    const store = seedStore();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.shiftTab); // edt-list -> panes (wraps back)
      await press(instance, stdin, KEYS.shiftTab); // panes -> other-list
      await press(instance, stdin, KEYS.space);
      expect(store.getState().logsOtherSelected).toEqual(['/repos/api-gateway']);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Space toggles a selection on and back off', async () => {
    const store = seedStore();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab); // edt-list -> other-list

      await press(instance, stdin, KEYS.space);
      expect(store.getState().logsOtherSelected).toEqual(['/repos/api-gateway']);

      await press(instance, stdin, KEYS.space);
      expect(store.getState().logsOtherSelected).toEqual([]);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Enter on an unselected list row opens an ad hoc fullscreen preview without changing selection; Escape closes it, selection unchanged', async () => {
    const subscribeLogsPane = vi.fn(async () => {});
    const unsubscribeLogsPane = vi.fn();
    const store = seedStore({ subscribeLogsPane, unsubscribeLogsPane });
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab); // edt-list -> other-list

      await press(instance, stdin, KEYS.enter);
      expect(store.getState().logsFullscreenTarget).toBe('/repos/api-gateway');
      expect(store.getState().logsOtherSelected).toEqual([]);
      // "stream started ad hoc" — the reconciliation effect subscribes the preview target even
      // though it was never added to either selection list.
      expect(subscribeLogsPane).toHaveBeenCalledWith('/repos/api-gateway', 'api-gateway');

      await pressEscape(instance, stdin);
      expect(store.getState().logsFullscreenTarget).toBeNull();
      // Escape stops that ad hoc stream and returns, selection unchanged.
      expect(store.getState().logsOtherSelected).toEqual([]);
      expect(unsubscribeLogsPane).toHaveBeenCalledWith('/repos/api-gateway');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('deselecting a service stops its stream and removes its pane entry', async () => {
    const subscribeLogsPane = vi.fn(async () => {});
    const unsubscribeLogsPane = vi.fn();
    const store = seedStore({ subscribeLogsPane, unsubscribeLogsPane });
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab); // edt-list -> other-list

      // Select both other-list services.
      await press(instance, stdin, KEYS.space);
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.space);
      expect(store.getState().logsOtherSelected.sort()).toEqual(['/repos/api-gateway', '/repos/route-explorer']);
      expect(subscribeLogsPane).toHaveBeenCalledWith('/repos/api-gateway', 'api-gateway');
      expect(subscribeLogsPane).toHaveBeenCalledWith('/repos/route-explorer', 'route-explorer');

      // Deselect route-explorer (cursor is still on it) — its stream stops.
      await press(instance, stdin, KEYS.space);
      expect(store.getState().logsOtherSelected).toEqual(['/repos/api-gateway']);
      expect(unsubscribeLogsPane).toHaveBeenCalledWith('/repos/route-explorer');
      expect(unsubscribeLogsPane).not.toHaveBeenCalledWith('/repos/api-gateway');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('R retries the service load while it is in error and no pane is open', async () => {
    const loadEdtsBranches = vi.fn(async () => {});
    const store = seedStore({ edtsBranchesStatus: 'error', loadEdtsBranches });
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      const before = loadEdtsBranches.mock.calls.length;
      await press(instance, stdin, 'R');
      expect(loadEdtsBranches.mock.calls.length).toBe(before + 1);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('R does nothing to the loader while the services loaded fine', async () => {
    const loadEdtsBranches = vi.fn(async () => {});
    const store = seedStore({ loadEdtsBranches });
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      const before = loadEdtsBranches.mock.calls.length;
      await press(instance, stdin, 'R');
      expect(loadEdtsBranches.mock.calls.length).toBe(before);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Ctrl+A selects every row currently in the EDT-members list, then a second press deselects all', async () => {
    // A `Ctrl+letter` combo is a single control byte at the wire level — it never carries shift
    // information (Ink's parser), so Ctrl+A and Ctrl+Shift+A are indistinguishable on virtually
    // every real terminal. One Ctrl+A toggles instead.
    const store = seedStore({
      edts: [
        {
          ulid: 'active-ulid',
          topic: 'active-edt',
          createdAt: '2026-01-01T00:00:00.000Z',
          status: 'active',
          members: [
            { service: 'api-gateway', repoPath: '/repos/api-gateway', branch: 'main' },
            { service: 'route-explorer', repoPath: '/repos/route-explorer', branch: 'main' },
          ],
        },
      ],
      activeEdt: 'active-ulid',
    });
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      // paneFocus already defaults to 'edt-list' — Ctrl+A is byte 0x01.
      await press(instance, stdin, '\x01');
      expect(store.getState().logsEdtSelected.sort()).toEqual(['/repos/api-gateway', '/repos/route-explorer']);

      await press(instance, stdin, '\x01');

      expect(store.getState().logsEdtSelected).toEqual([]);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Ctrl+A on the other-services list toggles only that list, then a second press deselects all', async () => {
    const store = seedStore();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab); // edt-list -> other-list

      await press(instance, stdin, '\x01');
      expect(store.getState().logsOtherSelected.sort()).toEqual(['/repos/api-gateway', '/repos/route-explorer']);

      await press(instance, stdin, '\x01');

      expect(store.getState().logsOtherSelected).toEqual([]);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Ctrl+A is scoped to the focused list — each toggle leaves the other list untouched', async () => {
    const store = seedStore({
      edts: [
        {
          ulid: 'active-ulid',
          topic: 'active-edt',
          createdAt: '2026-01-01T00:00:00.000Z',
          status: 'active',
          members: [{ service: 'api-gateway', repoPath: '/repos/api-gateway', branch: 'main' }],
        },
      ],
      activeEdt: 'active-ulid',
      edtsBranches: [
        service({ service: 'api-gateway', path: '/repos/api-gateway', isMember: true }),
        service({ service: 'route-explorer', path: '/repos/route-explorer', isMember: false }),
      ],
      logsOtherSelected: ['/repos/route-explorer'],
    });
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      // paneFocus defaults to 'edt-list'.
      await press(instance, stdin, '\x01');
      expect(store.getState().logsEdtSelected).toEqual(['/repos/api-gateway']);
      expect(store.getState().logsOtherSelected).toEqual(['/repos/route-explorer']);

      await press(instance, stdin, KEYS.tab); // edt-list -> other-list
      await press(instance, stdin, '\x01');
      expect(store.getState().logsOtherSelected).toEqual([]);
      expect(store.getState().logsEdtSelected).toEqual(['/repos/api-gateway']);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('the without-container section is never selectable — Space and Ctrl+A cannot reach it', async () => {
    const store = seedStore({
      edtsBranches: [
        service({ service: 'api-gateway', path: '/repos/api-gateway' }),
        service({ service: 'shared-types', path: '/repos/shared-types' }),
      ],
      logsNoContainer: { '/repos/shared-types': true },
    });
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab); // edt-list -> other-list (only api-gateway is selectable)

      await press(instance, stdin, KEYS.space);
      expect(store.getState().logsOtherSelected).toEqual(['/repos/api-gateway']);

      // Ctrl+A toggles the selectable list only — the info-only row is never affected.
      await press(instance, stdin, '\x01');
      expect(store.getState().logsOtherSelected).toEqual([]);
      await press(instance, stdin, '\x01');
      expect(store.getState().logsOtherSelected).toEqual(['/repos/api-gateway']);

      // Cursor movement across the selectable list never lands on the info-only row.
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.space);
      expect(store.getState().logsOtherSelected).toEqual([]);
      expect(store.getState().logsEdtSelected).toEqual([]);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});
