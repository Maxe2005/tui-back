// AppShell real-keypress tests: renderToString's fake stdin never emits a real keypress and
// the zone interaction tests never mount AppShell, so only these tests (real Ink input via
// shared/test-support/fake-tty.ts) observe whether a keystroke reaches, or is blocked from,
// AppShell's global dispatch — e.g. the zoneInputCaptured gate.
import { describe, it, expect, vi } from 'vitest';
import { ok } from '../../../core/result.js';
import type { DockerPort } from '../../../core/ports/runtime/docker.js';
import { AppShell } from './app-shell.js';
import { createAppStore } from './store/app-store.js';
import { KEYS } from './shared/test-support/fake-tty.js';
import { fakeDeps, flushAsyncLoad, mount, press, pressEscape } from './app-shell.test-support.js';

describe('AppShell real-keypress interactions', () => {
  it('a typed "?" never opens the global help modal while zoneInputCaptured is set', async () => {
    const store = createAppStore();
    store.setState({ zoneInputCaptured: true });

    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      expect(store.getState().helpOpen).toBe(false);

      await press(instance, stdin, '?');

      // The decisive check: help must still be closed, and zoneInputCaptured must be
      // exactly what the zone set it to — never reset by AppShell's own dispatch.
      expect(store.getState().helpOpen).toBe(false);
      expect(store.getState().zoneInputCaptured).toBe(true);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('a zone mnemonic never switches the active zone while zoneInputCaptured is set', async () => {
    const store = createAppStore();
    // Stays on 'dashboard' — a zone with no dialog/capture logic of its own — so the only
    // thing that could flip zoneInputCaptured back off is AppShell's own dispatch, not a
    // zone effect resetting it underneath the test (as the real EDTs zone's mount effect
    // would if activeZone were 'edts').
    store.setState({ zoneInputCaptured: true, activeZone: 'dashboard' });

    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      // 'l' is the logs zone's mnemonic — would switch away from 'dashboard' if the
      // zoneInputCaptured gate didn't block it.
      await press(instance, stdin, 'l');

      expect(store.getState().activeZone).toBe('dashboard');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('"?" opens the global help modal normally once zoneInputCaptured clears', async () => {
    const store = createAppStore();
    store.setState({ zoneInputCaptured: false });

    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await press(instance, stdin, '?');

      expect(store.getState().helpOpen).toBe(true);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});

describe('AppShell Left/Right zone-arrow navigation', () => {
  it('Right switches to the next zone in ZONES order', async () => {
    const store = createAppStore();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      expect(store.getState().activeZone).toBe('dashboard');

      await press(instance, stdin, KEYS.right);

      expect(store.getState().activeZone).toBe('edts');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Left switches to the previous zone in ZONES order', async () => {
    const store = createAppStore();
    store.getState().setActiveZone('update');
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await press(instance, stdin, KEYS.left);

      expect(store.getState().activeZone).toBe('edts');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Right wraps from the last zone back to the first', async () => {
    const store = createAppStore();
    store.getState().setActiveZone('shared-types');
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await press(instance, stdin, KEYS.right);

      expect(store.getState().activeZone).toBe('dashboard');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Left wraps from the first zone back to the last', async () => {
    const store = createAppStore();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      expect(store.getState().activeZone).toBe('dashboard');

      await press(instance, stdin, KEYS.left);

      expect(store.getState().activeZone).toBe('shared-types');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('has no effect while a zone dialog has captured input (zoneInputCaptured)', async () => {
    const store = createAppStore();
    store.setState({ zoneInputCaptured: true, activeZone: 'dashboard' });
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await press(instance, stdin, KEYS.right);

      expect(store.getState().activeZone).toBe('dashboard');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('has no effect while the help overlay is open', async () => {
    const store = createAppStore();
    store.getState().openHelp();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await press(instance, stdin, KEYS.right);

      expect(store.getState().activeZone).toBe('dashboard');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('has no effect while the repo registry screen is open', async () => {
    const store = createAppStore();
    store.getState().openRegistryScreen();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await press(instance, stdin, KEYS.right);

      expect(store.getState().activeZone).toBe('dashboard');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('has no effect while the command bar is open', async () => {
    const store = createAppStore();
    store.getState().openCommandBar();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await press(instance, stdin, KEYS.right);

      expect(store.getState().activeZone).toBe('dashboard');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('leaves Tab byte-for-byte unaffected — no shell-level interception is added', async () => {
    const store = createAppStore();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      expect(store.getState().activeZone).toBe('dashboard');

      await press(instance, stdin, KEYS.tab);

      // Tab has no shell-level zone-switching effect.
      expect(store.getState().activeZone).toBe('dashboard');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});

describe('AppShell Logs zone pane-grid arrow ownership', () => {
  // Ink dispatches every keypress to every mounted `useInput` hook regardless of z-order —
  // with the Logs zone active and its pane-focus on the grid (Left/Right/Up/Down move
  // sub-focus between panes there), the same Left/Right keypress would also reach the global
  // Left/Right zone-switch and switch the zone out from under the grid. Only a real-keypress
  // round-trip through both components together can catch this.
  function seedLogsStore(overrides: Record<string, unknown> = {}) {
    const store = createAppStore();
    store.setState({
      activeZone: 'logs',
      edts: [],
      edtsStatus: 'idle',
      activeEdt: null,
      edtsBranches: [
        {
          service: 'api-gateway',
          path: '/repos/api-gateway',
          isMember: false,
          branch: 'main',
          ahead: 0,
          behind: 0,
          status: 'current',
          sharedBranch: 'development',
          protectedBranches: [],
        },
      ],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      ...overrides,
    });
    return store;
  }

  it('Right no longer switches the active zone while Logs pane sub-focus owns the arrows', async () => {
    const store = seedLogsStore();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab); // edt-list -> other-list
      await press(instance, stdin, KEYS.space); // select the one service, so an active pane exists
      await press(instance, stdin, KEYS.tab); // other-list -> panes
      expect(store.getState().logsPaneGridArrowsActive).toBe(true);

      await press(instance, stdin, KEYS.right);

      expect(store.getState().activeZone).toBe('logs');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Right still switches the active zone normally once pane focus cycles back off the grid', async () => {
    const store = seedLogsStore();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab); // edt-list -> other-list
      await press(instance, stdin, KEYS.space);
      await press(instance, stdin, KEYS.tab); // other-list -> panes
      await press(instance, stdin, KEYS.tab); // panes -> edt-list (cycle wraps)
      expect(store.getState().logsPaneGridArrowsActive).toBe(false);

      await press(instance, stdin, KEYS.right);

      // 'routes' is the next zone after 'logs' in ZONES order.
      expect(store.getState().activeZone).toBe('routes');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('clears logsPaneGridArrowsActive on unmount — leaving the Logs zone never leaves global arrow-switch inert', async () => {
    const store = seedLogsStore();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, KEYS.space);
      await press(instance, stdin, KEYS.tab); // -> panes
      expect(store.getState().logsPaneGridArrowsActive).toBe(true);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
    expect(store.getState().logsPaneGridArrowsActive).toBe(false);
  });
});

describe('AppShell Logs zone clear-pane shortcut', () => {
  // Real docker wiring (unlike seedLogsStore above, which uses a bare createAppStore() —
  // subscribeLogsPane no-ops without deps, so it never populates logsPanes with real lines)
  // is needed here to prove `c` actually wipes buffered lines without touching the stream.
  function seedLogsStoreWithDocker(docker: DockerPort) {
    const store = createAppStore(fakeDeps({ docker }));
    store.setState({
      activeZone: 'logs',
      edts: [],
      edtsStatus: 'idle',
      activeEdt: null,
      edtsBranches: [
        {
          service: 'api-gateway',
          path: '/repos/api-gateway',
          isMember: false,
          branch: 'main',
          ahead: 0,
          behind: 0,
          status: 'current',
          sharedBranch: 'development',
          protectedBranches: [],
        },
      ],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
    });
    return store;
  }

  it('c clears the sub-focused pane\'s buffered lines in the grid without stopping its stream', async () => {
    const streamed: { onLine: (line: { timestamp: string; stream: 'stdout' | 'stderr'; text: string }) => void } = {
      onLine: () => {},
    };
    const stop = vi.fn();
    const docker: DockerPort = {
      streamLogs: vi.fn((_container, onLine) => {
        streamed.onLine = onLine;
        return stop;
      }),
      fetchLogsBefore: vi.fn(async () => ok([])),
      getContainerHealth: vi.fn(async () => ok('up' as const)),
      restartContainer: vi.fn(async () => ok(undefined)),
    };
    const store = seedLogsStoreWithDocker(docker);
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab); // edt-list -> other-list
      await press(instance, stdin, KEYS.space); // select api-gateway, starts its stream
      await press(instance, stdin, KEYS.tab); // other-list -> panes
      streamed.onLine({ timestamp: '2026-01-01T00:00:00.000Z', stream: 'stdout', text: 'hello' });
      expect(store.getState().logsPanes['/repos/api-gateway']?.lines).toHaveLength(1);

      await press(instance, stdin, 'c');

      expect(store.getState().logsPanes['/repos/api-gateway']?.lines).toEqual([]);
      // The subscription itself is untouched — clearing is a display wipe, not a teardown.
      expect(stop).not.toHaveBeenCalled();
      streamed.onLine({ timestamp: '2026-01-01T00:00:01.000Z', stream: 'stdout', text: 'world' });
      expect(store.getState().logsPanes['/repos/api-gateway']?.lines.map((l) => l.text)).toEqual(['world']);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('c clears the fullscreen preview\'s pane too', async () => {
    const streamed: { onLine: (line: { timestamp: string; stream: 'stdout' | 'stderr'; text: string }) => void } = {
      onLine: () => {},
    };
    const docker: DockerPort = {
      streamLogs: vi.fn((_container, onLine) => {
        streamed.onLine = onLine;
        return () => {};
      }),
      fetchLogsBefore: vi.fn(async () => ok([])),
      getContainerHealth: vi.fn(async () => ok('up' as const)),
      restartContainer: vi.fn(async () => ok(undefined)),
    };
    const store = seedLogsStoreWithDocker(docker);
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab); // edt-list -> other-list
      await press(instance, stdin, KEYS.enter); // ad hoc fullscreen preview on api-gateway
      streamed.onLine({ timestamp: '2026-01-01T00:00:00.000Z', stream: 'stdout', text: 'hello' });
      expect(store.getState().logsPanes['/repos/api-gateway']?.lines).toHaveLength(1);

      await press(instance, stdin, 'c');

      expect(store.getState().logsPanes['/repos/api-gateway']?.lines).toEqual([]);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});

describe('AppShell manifest-gated tab visibility', () => {
  it('skips an omitted tab entirely during Right arrow-nav wrap traversal', async () => {
    const store = createAppStore();
    store.setState({
      activeZone: 'logs',
      tabVisibility: {
        routes: { status: 'omitted', carryingServices: [] },
        sharedTypes: { status: 'enabled', carryingServices: [] },
      },
    });
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await press(instance, stdin, KEYS.right);

      // 'routes' is omitted — Right from 'logs' must land directly on 'shared-types'.
      expect(store.getState().activeZone).toBe('shared-types');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('lands on a disabled tab via arrow-nav rather than skipping it', async () => {
    const store = createAppStore();
    store.setState({
      activeZone: 'logs',
      tabVisibility: {
        routes: { status: 'disabled', carryingServices: ['api-gateway'] },
        sharedTypes: { status: 'enabled', carryingServices: [] },
      },
    });
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await press(instance, stdin, KEYS.right);

      expect(store.getState().activeZone).toBe('routes');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('an omitted tab\'s mnemonic does nothing — never lands on it', async () => {
    const store = createAppStore();
    store.setState({
      activeZone: 'dashboard',
      tabVisibility: {
        routes: { status: 'omitted', carryingServices: [] },
        sharedTypes: { status: 'enabled', carryingServices: [] },
      },
    });
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await press(instance, stdin, 'r'); // routes' mnemonic

      expect(store.getState().activeZone).toBe('dashboard');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('a disabled tab\'s mnemonic still lands on it — becomes the active zone', async () => {
    const store = createAppStore();
    store.setState({
      activeZone: 'dashboard',
      tabVisibility: {
        routes: { status: 'disabled', carryingServices: ['api-gateway'] },
        sharedTypes: { status: 'enabled', carryingServices: [] },
      },
    });
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await press(instance, stdin, 'r');

      expect(store.getState().activeZone).toBe('routes');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('falls back to Dashboard when the active zone\'s tab becomes omitted', async () => {
    const store = createAppStore();
    store.setState({
      activeZone: 'routes',
      tabVisibility: {
        routes: { status: 'enabled', carryingServices: ['api-gateway'] },
        sharedTypes: { status: 'omitted', carryingServices: [] },
      },
    });
    const { instance } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      expect(store.getState().activeZone).toBe('routes');

      // A registry change drops the only carrying repo — routes flips omitted while it's still
      // the active zone.
      store.setState({
        tabVisibility: {
          routes: { status: 'omitted', carryingServices: [] },
          sharedTypes: { status: 'omitted', carryingServices: [] },
        },
      });
      await instance.waitUntilRenderFlush();

      expect(store.getState().activeZone).toBe('dashboard');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('never forces navigation when the active zone merely becomes disabled (content swaps in place)', async () => {
    const store = createAppStore();
    store.setState({
      activeZone: 'routes',
      tabVisibility: {
        routes: { status: 'enabled', carryingServices: ['api-gateway'] },
        sharedTypes: { status: 'omitted', carryingServices: [] },
      },
    });
    const { instance } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      store.setState({
        tabVisibility: {
          routes: { status: 'disabled', carryingServices: ['api-gateway'] },
          sharedTypes: { status: 'omitted', carryingServices: [] },
        },
      });
      await instance.waitUntilRenderFlush();

      expect(store.getState().activeZone).toBe('routes');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});

describe('AppShell Routes right-pane key ownership', () => {
  // Same double-dispatch hazard as the Logs pane grid: Ink dispatches every keypress to every
  // mounted `useInput` hook, so the tree's own Left/Right fold keys would also reach the
  // global Left/Right zone-switch. The focused pane captures the keyboard, which also keeps
  // zone mnemonics (`d`, `e`, `l`…) inert mid-edit. Only a real-keypress round-trip through
  // both components together can prove the gate.
  function seedRoutesStore() {
    const store = createAppStore();
    store.setState({
      activeZone: 'routes',
      tabVisibility: {
        routes: { status: 'enabled', carryingServices: [] },
        sharedTypes: { status: 'omitted', carryingServices: [] },
      },
      routesStatus: 'ready',
      routesRepoPath: '/repos/gateway',
      routes: [{ method: 'GET', path: '/users', summary: 'List users' }],
      routesError: null,
      loadRoutes: async () => {},
      fireRoute: async () => {},
      responses: { 'GET /users': { status: 'fired', result: { status: 200, durationMs: 42, body: '{"data":{"a":1}}' } } },
      routesPaneFocus: 'detail',
      routesPaneTab: 'response',
    });
    return store;
  }

  it('Left folds the tree without switching the active zone while the tree owns the arrows', async () => {
    const store = seedRoutesStore();
    const { instance, stdin } = mount(store);
    try {
      await flushAsyncLoad(instance);
      expect(store.getState().zoneInputCaptured).toBe(true);

      await press(instance, stdin, KEYS.down); // root -> `data`
      await press(instance, stdin, KEYS.left); // fold `data`

      expect(store.getState().jsonTreeStates['GET /users']?.foldedPaths).toEqual(['data']);
      expect(store.getState().activeZone).toBe('routes');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Left switches the active zone normally once focus returns to the list', async () => {
    const store = seedRoutesStore();
    const { instance, stdin } = mount(store);
    try {
      await flushAsyncLoad(instance);
      await pressEscape(instance, stdin); // Response -> Request
      await pressEscape(instance, stdin); // Request -> list
      expect(store.getState().routesPaneFocus).toBe('list');

      await press(instance, stdin, KEYS.left);

      // 'logs' is the previous zone before 'routes' in ZONES order.
      expect(store.getState().activeZone).toBe('logs');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('keeps zone mnemonics inert while the pane holds focus', async () => {
    const store = seedRoutesStore();
    const { instance, stdin } = mount(store);
    try {
      await flushAsyncLoad(instance);
      await press(instance, stdin, 'd');
      await press(instance, stdin, 'l');

      expect(store.getState().activeZone).toBe('routes');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});
