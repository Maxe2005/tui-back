// tui/zones/logs: landing from a Dashboard `Enter` — the pending service is selected, the list
// cursor and pane focus follow it, and the request is consumed (or dropped) exactly once.
import { createElement } from 'react';
import { render } from 'ink';
import { describe, it, expect, vi } from 'vitest';
import type { ServiceBranchDivergence } from '../../../../../core/edt/list.js';
import { createAppStore } from '../../store/app-store.js';
import { fakeInteractiveTtyStdin, FakeTtyStdout } from '../../shared/test-support/fake-tty.js';
import { LogsZone } from './logs-zone.js';

function service(name: string, isMember: boolean): ServiceBranchDivergence {
  return {
    service: name,
    path: `/repos/${name}`,
    isMember,
    branch: 'main',
    ahead: 0,
    behind: 0,
    status: 'current',
    sharedBranch: 'development',
    protectedBranches: [],
  };
}

function seed(overrides: Record<string, unknown> = {}) {
  const store = createAppStore();
  const clear = vi.fn(store.getState().clearPendingServiceFocus);
  store.setState({
    edts: [
      {
        ulid: 'u1',
        topic: 't',
        createdAt: '2026-01-01T00:00:00.000Z',
        status: 'active',
        members: [
          { service: 'm-a', repoPath: '/repos/m-a', branch: 'main' },
          { service: 'm-b', repoPath: '/repos/m-b', branch: 'main' },
        ],
      },
    ],
    edtsStatus: 'idle',
    activeEdt: 'u1',
    edtsBranches: [service('m-a', true), service('m-b', true), service('o-a', false), service('o-b', false)],
    edtsBranchesStatus: 'idle',
    loadEdts: async () => {},
    loadEdtsBranches: async () => {},
    clearPendingServiceFocus: clear,
    ...overrides,
  });
  return { store, clear };
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
  return { instance, stdin };
}

async function space(instance: ReturnType<typeof render>, stdin: NodeJS.ReadStream): Promise<void> {
  (stdin as unknown as { write: (chunk: string) => void }).write(' ');
  await instance.waitUntilRenderFlush();
  await new Promise((resolve) => setTimeout(resolve, 10));
}

describe('LogsZone pending service focus', () => {
  it('selects an EDT member, puts the cursor and focus on it, and consumes the request', async () => {
    const { store, clear } = seed({ pendingServiceFocus: '/repos/m-b' });
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      expect(store.getState().logsEdtSelected).toEqual(['/repos/m-b']);
      expect(clear).toHaveBeenCalledTimes(1);
      expect(store.getState().pendingServiceFocus).toBeNull();
      // Space acts on the cursor row of the focused list: it must be m-b.
      await space(instance, stdin);
      expect(store.getState().logsEdtSelected).toEqual([]);
    } finally {
      instance.unmount();
    }
  });

  it('selects a non-member service in the other list', async () => {
    const { store, clear } = seed({ pendingServiceFocus: '/repos/o-b' });
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      expect(store.getState().logsOtherSelected).toEqual(['/repos/o-b']);
      expect(clear).toHaveBeenCalledTimes(1);
      await space(instance, stdin);
      expect(store.getState().logsOtherSelected).toEqual([]);
    } finally {
      instance.unmount();
    }
  });

  it('keeps an already selected service selected', async () => {
    const { store } = seed({ pendingServiceFocus: '/repos/m-a', logsEdtSelected: ['/repos/m-a'] });
    const { instance } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      expect(store.getState().logsEdtSelected).toEqual(['/repos/m-a']);
      expect(store.getState().pendingServiceFocus).toBeNull();
    } finally {
      instance.unmount();
    }
  });

  it('drops a path that is not listed once the listing has loaded', async () => {
    const { store, clear } = seed({ pendingServiceFocus: '/repos/ghost' });
    const { instance } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      expect(store.getState().logsEdtSelected).toEqual([]);
      expect(store.getState().logsOtherSelected).toEqual([]);
      expect(clear).toHaveBeenCalled();
      expect(store.getState().pendingServiceFocus).toBeNull();
    } finally {
      instance.unmount();
    }
  });

  it('waits while the listing is still loading, then consumes it', async () => {
    const { store, clear } = seed({ pendingServiceFocus: '/repos/o-a', edtsBranchesStatus: 'loading', edtsBranches: null });
    const { instance } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      expect(store.getState().pendingServiceFocus).toBe('/repos/o-a');
      expect(clear).not.toHaveBeenCalled();
      store.setState({ edtsBranches: [service('m-a', true), service('o-a', false)], edtsBranchesStatus: 'idle' });
      await instance.waitUntilRenderFlush();
      expect(store.getState().logsOtherSelected).toEqual(['/repos/o-a']);
      expect(store.getState().pendingServiceFocus).toBeNull();
    } finally {
      instance.unmount();
    }
  });

  it('clears a never-consumed request when the zone unmounts', async () => {
    const { store, clear } = seed({ pendingServiceFocus: '/repos/o-a', edtsBranchesStatus: 'loading', edtsBranches: null });
    const { instance } = mount(store);
    await instance.waitUntilRenderFlush();
    expect(store.getState().pendingServiceFocus).toBe('/repos/o-a');
    instance.unmount();
    expect(clear).toHaveBeenCalled();
    expect(store.getState().pendingServiceFocus).toBeNull();
  });
});
