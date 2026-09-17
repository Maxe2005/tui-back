// tui/zones/logs: real-keypress interactions (story 5.1) — `renderToString`'s fake stdin
// never emits data (see logs-zone.test.tsx), so Tab/Space/Enter/Escape/Ctrl+A's actual
// dispatch through a real `useInput` round-trip is only observable here, reusing
// edts-zone.interaction.test.tsx's own fake-tty technique (shared/test-support/fake-tty.ts).
import { createElement } from 'react';
import { render } from 'ink';
import { describe, it, expect, vi } from 'vitest';
import type { ServiceBranchDivergence } from '../../../../../core/edt/list.js';
import { createAppStore } from '../../store/app-store.js';
import { fakeInteractiveTtyStdin, FakeTtyStdout, KEYS } from '../../shared/test-support/fake-tty.js';
import { LogsZone } from './logs-zone.js';

function service(overrides: Partial<ServiceBranchDivergence> = {}): ServiceBranchDivergence {
  return {
    service: 'route-explorer',
    path: '/repos/route-explorer',
    isMember: false,
    branch: 'main',
    ahead: 0,
    behind: 0,
    status: 'current',
    sharedBranch: 'development',
    ...overrides,
  };
}

async function press(instance: ReturnType<typeof render>, stdin: NodeJS.ReadStream, sequence: string): Promise<void> {
  (stdin as unknown as { write: (chunk: string) => void }).write(sequence);
  await instance.waitUntilRenderFlush();
}

// Mirrors edts-zone.interaction.test.tsx's own pressEscape: a lone ESC byte is ambiguous on
// the wire until Ink's internal flush-delay timer fires.
async function pressEscape(instance: ReturnType<typeof render>, stdin: NodeJS.ReadStream): Promise<void> {
  await press(instance, stdin, KEYS.escape);
  await new Promise((resolve) => setTimeout(resolve, 30));
  await instance.waitUntilRenderFlush();
}

function mount(store: ReturnType<typeof createAppStore>) {
  const stdout = new FakeTtyStdout();
  const stdin = fakeInteractiveTtyStdin();
  const instance = render(createElement(LogsZone, { useStore: store }), {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin,
    interactive: true,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  return { instance, stdout, stdin };
}

function seedStore(overrides: Record<string, unknown> = {}) {
  const store = createAppStore();
  store.setState({
    edts: [],
    edtsStatus: 'idle',
    activeEdt: null,
    edtsBranches: [
      service({ service: 'api-gateway', path: '/repos/api-gateway' }),
      service({ service: 'route-explorer', path: '/repos/route-explorer' }),
    ],
    edtsBranchesStatus: 'idle',
    loadEdts: async () => {},
    loadEdtsBranches: async () => {},
    ...overrides,
  });
  return store;
}

describe('LogsZone real-keypress interactions (story 5.1)', () => {
  it('AC: Tab cycles focus edt-list -> other-list -> panes -> edt-list (Space toggles the currently-focused list)', async () => {
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

  it('AC: Enter on an unselected list row opens an ad hoc fullscreen preview without changing selection; Escape closes it, selection unchanged', async () => {
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
      // I/O matrix FULLSCREEN_PREVIEW: "Escape stops that ad hoc stream and returns, selection
      // unchanged".
      expect(store.getState().logsOtherSelected).toEqual([]);
      expect(unsubscribeLogsPane).toHaveBeenCalledWith('/repos/api-gateway');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('I/O matrix SELECTION_CHANGE: deselecting a service stops its stream and removes its pane entry', async () => {
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

  it('Ctrl+A selects every row currently in the EDT-members list, then a second press deselects all (review fix: replaces the unreachable Ctrl+Shift+A)', async () => {
    // A `Ctrl+letter` combo is a single control byte at the wire level — it never carries
    // shift information (confirmed against Ink's own parser), so Ctrl+A and Ctrl+Shift+A were
    // indistinguishable on virtually every real terminal, making the old, separate
    // deselect-all shortcut unreachable in practice (user-reported). Ctrl+A now toggles.
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
});
