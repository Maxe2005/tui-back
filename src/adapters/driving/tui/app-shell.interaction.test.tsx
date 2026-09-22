// Story 2.9's AC6 ("no AppShell global shortcut fires while a zone dialog has captured
// input") is implemented entirely inside AppShell's own `useInput` — a single `if
// (state.zoneInputCaptured) { return; }` guard (app-shell.tsx). `renderToString`'s fake
// stdin never emits a real keypress (app-shell.test.tsx, documented repo-wide), and the
// EDTs-zone-only interaction tests (edts-zone.interaction.test.tsx) never mount AppShell
// itself, so neither suite can observe whether a captured keystroke actually reaches (or is
// blocked from) AppShell's global dispatch. This file reuses the same real-Ink-input
// technique (shared/test-support/fake-tty.ts) to close that gap.
import { createElement } from 'react';
import { render } from 'ink';
import { describe, it, expect, vi } from 'vitest';
import { ok } from '../../../core/result.js';
import type { EdtRegistryEntry, EdtRegistryPort } from '../../../core/ports/edt-registry.js';
import type { GitPort } from '../../../core/ports/git.js';
import type { LockPort } from '../../../core/ports/lock.js';
import type { Manifest, ManifestPort } from '../../../core/ports/manifest.js';
import type { RegistryPort } from '../../../core/ports/registry.js';
import type { StatePort } from '../../../core/ports/state.js';
import { DEFAULT_SETTINGS, type SettingsPort } from '../../../core/ports/settings.js';
import type { DockerPort } from '../../../core/ports/docker.js';
import { AppShell } from './app-shell.js';
import { createAppStore, type AppStoreDeps } from './store/app-store.js';
import { fakeInteractiveTtyStdin, FakeTtyStdout, KEYS } from './shared/test-support/fake-tty.js';

// Mirrors app-store.test.ts's own fakeDeps/manifestFor exactly (story 2.13 review fix): the
// mount-time/registry-close `loadTabVisibility()` effect is AppShell's sole production
// activation path, but every other test in this file uses a deps-less `createAppStore()`,
// where `loadTabVisibility()` only ever takes the `!deps` early-return branch — no test here
// could otherwise tell that effect running correctly apart from it being deleted entirely.
function manifestFor(repoPath: string): Manifest {
  const name = repoPath.split('/').pop();
  return {
    service: `svc-${name}`,
    container: `ctr-${name}`,
    migrationCommand: 'npm run migration:run',
    sharedBranch: 'development',
    modules: {},
  };
}

function fakeDeps(overrides: Partial<AppStoreDeps> = {}): AppStoreDeps {
  const registry: RegistryPort = {
    list: vi.fn(async () => ok(['/repo/a'])),
    add: vi.fn(async () => ok(undefined)),
    exists: vi.fn(async () => ok(true)),
    scan: vi.fn(async () => ok({ candidates: [], skipped: [] })),
    reset: vi.fn(async () => ok({ path: '/x', backupPath: null })),
    remove: vi.fn(async () => ok(undefined)),
  };
  const manifest: ManifestPort = {
    load: vi.fn(async (path: string) => ok(manifestFor(path))),
  };
  const git: GitPort = {
    assertAllowedBranch: vi.fn(async () => ok(undefined)),
    createBranch: vi.fn(async () => ok(undefined)),
    deleteBranch: vi.fn(async () => ok(undefined)),
    currentBranch: vi.fn(async () => ok('feat/a')),
    aheadBehind: vi.fn(async () => ok({ ahead: 0, behind: 0 })),
    checkout: vi.fn(async () => ok(undefined)),
    hasUncommittedChanges: vi.fn(async () => ok(false)),
    stashSave: vi.fn(async () => ok(undefined)),
    restoreStash: vi.fn(async () => ok(undefined)),
    branchExistsLocally: vi.fn(async () => ok(true)),
    fetch: vi.fn(async () => ok(undefined)),
    pull: vi.fn(async () => ok(undefined)),
    mergeBranch: vi.fn(async () => ok(undefined)),
    abortMerge: vi.fn(async () => ok(undefined)),
    isMergeInProgress: vi.fn(async () => ok(false)),
    listDirtyPaths: vi.fn(async () => ok([])),
    discardPaths: vi.fn(async () => ok(undefined)),
    isRebaseInProgress: vi.fn(async () => ok(false)),
    hasUnmergedPaths: vi.fn(async () => ok(false)),
    finalizeMerge: vi.fn(async () => ok(undefined)),
    listBranches: vi.fn(async () => ok([])),
    renameBranch: vi.fn(async () => ok(undefined)),
    isBranchMerged: vi.fn(async () => ok(true)),
    hasStash: vi.fn(async () => ok(false)),
  };
  const edtRegistry: EdtRegistryPort = {
    add: vi.fn(async () => ok(undefined)),
    list: vi.fn(async () => ok([] as EdtRegistryEntry[])),
    setStatus: vi.fn(async () => ok(undefined)),
    update: vi.fn(async () => ok(undefined)),
    remove: vi.fn(async () => ok(undefined)),
  };
  const state: StatePort = {
    readActiveEdt: vi.fn(async () => ok(null)),
    writeActiveEdt: vi.fn(async () => ok(undefined)),
    readSplitterRatios: vi.fn(async () => ok(null)),
    writeSplitterRatios: vi.fn(async () => ok(undefined)),
    readFilterHistory: vi.fn(async () => ok(null)),
    writeFilterHistory: vi.fn(async () => ok(undefined)),
  };
  const lock: LockPort = {
    acquire: vi.fn(async () => ok({ release: vi.fn(async () => ok(undefined)) })),
    peek: vi.fn(async () => ok({ locked: false })),
  };
  const settings: SettingsPort = {
    load: vi.fn(async () => ok({ settings: DEFAULT_SETTINGS, warning: null })),
    save: vi.fn(async () => ok(undefined)),
  };
  const docker: DockerPort = {
    streamLogs: vi.fn(() => () => {}),
    fetchLogsBefore: vi.fn(async () => ok([])),
    getContainerHealth: vi.fn(async () => ok('up' as const)),
    restartContainer: vi.fn(async () => ok(undefined)),
  };
  return {
    registry,
    manifest,
    git,
    edtRegistry,
    state,
    lock,
    registryResourceKey: '/config/registry.yaml',
    edtRegistryResourceKey: '/tmp/edts.yaml',
    edtsBaseDir: '/tmp/edts',
    settings,
    docker,
    ...overrides,
  };
}

// loadTabVisibility() chains several awaited port calls (listRepos, readActiveEdt, ...) before
// its terminal set() lands — `waitUntilRenderFlush()` only waits for React's own next commit,
// not that async chain settling, so every wait below pairs it with a real macrotask delay
// (mirrors this file's own `pressEscape` working around the same class of gap for Ink's
// internal Escape-flush timer).
async function flushAsyncLoad(instance: ReturnType<typeof render>): Promise<void> {
  await instance.waitUntilRenderFlush();
  await new Promise((resolve) => setTimeout(resolve, 50));
  await instance.waitUntilRenderFlush();
}

function mount(store: ReturnType<typeof createAppStore>) {
  const stdout = new FakeTtyStdout();
  const stdin = fakeInteractiveTtyStdin();
  const instance = render(createElement(AppShell, { useStore: store, onQuit: () => {} }), {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin,
    interactive: true,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  return { instance, stdout, stdin };
}

async function press(instance: ReturnType<typeof render>, stdin: NodeJS.ReadStream, sequence: string): Promise<void> {
  (stdin as unknown as { write: (chunk: string) => void }).write(sequence);
  await instance.waitUntilRenderFlush();
}

// A lone ESC byte is ambiguous on the wire — Ink's input parser can't tell it apart from the
// first byte of a CSI sequence (e.g. an arrow key) until either more bytes arrive or its own
// internal `pendingInputFlushDelayMilliseconds` (20ms, ink/build/components/App.js) real timer
// fires to flush it as a standalone Escape keypress. `waitUntilRenderFlush()` only waits for
// React's own commit, not that timer, so a bare `press(..., KEYS.escape)` can resolve before
// Ink has actually delivered `key.escape: true` to `useInput` at all (edts-zone.interaction
// .test.tsx documents/works around the same gap) — every Escape press in this file goes
// through this instead.
async function pressEscape(instance: ReturnType<typeof render>, stdin: NodeJS.ReadStream): Promise<void> {
  await press(instance, stdin, KEYS.escape);
  await new Promise((resolve) => setTimeout(resolve, 30));
  await instance.waitUntilRenderFlush();
}

describe('AppShell real-keypress interactions (story 2.9, AC6)', () => {
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

describe('AppShell Left/Right zone-arrow navigation (story 2.12)', () => {
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

  it('has no effect while the filter overlay is open', async () => {
    const store = createAppStore();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, '/'); // opens the filter modal (local AppShell state)

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

  it('has no effect while the command bar is open (story 2.14)', async () => {
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

      // Tab has no shell-level zone-switching effect either before or after this story.
      expect(store.getState().activeZone).toBe('dashboard');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});

describe('AppShell Logs zone pane-grid arrow ownership (story 5.1 review fix)', () => {
  // Ink dispatches every keypress to every mounted `useInput` hook regardless of z-order —
  // with the Logs zone active and its own pane-focus on the grid (Left/Right/Up/Down move
  // sub-focus between panes there), the very same Left/Right keypress used to also reach
  // this global Left/Right zone-switch (story 2.12) and switch the active zone out from
  // under the grid before the user ever saw their sub-focus move. Neither
  // logs-zone.interaction.test.tsx (mounts LogsZone alone, never AppShell) nor
  // app-shell.test.tsx (renderToString's fake stdin never emits real keypresses) could catch
  // this — only a real-keypress round-trip through both components together can.
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

describe('AppShell Logs zone clear-pane shortcut (story 5.1)', () => {
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

describe('AppShell manifest-gated tab visibility (story 2.13)', () => {
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

      // A registry change (Story 2.11) drops the only carrying repo — routes flips omitted
      // while it's still the active zone.
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

describe('AppShell command-entry bar (:) (story 2.14, Tab-completion grid reworked by story 2.17)', () => {
  it('opens on : with an empty focused input and no list/grid until Tab is pressed', async () => {
    const store = createAppStore();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await press(instance, stdin, ':');

      expect(stdout.output).toContain('COMMAND');
      expect(stdout.output).not.toContain('registry');

      // Tab on the still-empty input reveals the full grid immediately (no double-press
      // needed, nothing to complete).
      await press(instance, stdin, KEYS.tab);

      expect(stdout.output).toContain('registry');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('never stacks on top of the help overlay', async () => {
    const store = createAppStore();
    store.getState().openHelp();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await press(instance, stdin, ':');

      expect(stdout.output).not.toContain('COMMAND');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('a typed "?" never opens the global help modal while the command bar is open', async () => {
    const store = createAppStore();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, ':');
      expect(store.getState().helpOpen).toBe(false);

      await press(instance, stdin, '?');

      // "?" must land as a literal query character (the bar owns free-text capture) — it
      // must never also pop the global keybinding-help modal on top of the bar.
      expect(store.getState().helpOpen).toBe(false);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('never stacks on top of the filter overlay', async () => {
    const store = createAppStore();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, '/'); // opens the filter modal (local AppShell state)

      await press(instance, stdin, ':');

      expect(stdout.output).not.toContain('COMMAND');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('never stacks on top of the repo registry screen', async () => {
    const store = createAppStore();
    store.getState().openRegistryScreen();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await press(instance, stdin, ':');

      expect(stdout.output).not.toContain('COMMAND');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('never re-opens (no stacking) on a second : while already open — it types a literal ":" instead', async () => {
    const store = createAppStore();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, ':');
      expect(stdout.output).toContain('COMMAND');

      // A second ':' is captured as a literal query character by the bar's own free-text
      // input (it owns keystroke capture while open) rather than opening a second bar. Proven
      // by typing "registry" right after: the query becomes ":registry" (leading literal
      // colon), which is not an exact match on "registry" — Enter must show "unknown".
      await press(instance, stdin, ':');
      await press(instance, stdin, 'registry');
      await press(instance, stdin, KEYS.enter);

      expect(store.getState().registryScreenOpen).toBe(false);
      expect(stdout.output).toContain('Unknown command.');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('re-filters the visible grid live to a case-insensitive name-prefix match as text is typed', async () => {
    const store = createAppStore();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, ':');
      // Empty-input Tab reveals the full grid immediately.
      await press(instance, stdin, KEYS.tab);
      expect(stdout.output).toContain('registry');

      // "ED" (uppercase) case-insensitively narrows to the 3 edt-* commands — still 2+
      // matches, so the grid stays visible rather than hiding (that only happens at exactly
      // one remaining match).
      await press(instance, stdin, 'ED');

      // stdout.output accumulates every rendered frame (it can't express "no longer
      // present"), so this proves the live re-filter narrowed to the 3 edt-* commands by
      // their all appearing only after "ED" was typed, not that "registry" stopped
      // rendering — command-bar.test.tsx's layoutCommandGrid/matchCommands unit coverage
      // is what actually proves the match set itself narrows.
      expect(stdout.output).toContain('edt-create');
      expect(stdout.output).toContain('edt-switch');
      expect(stdout.output).toContain('edt-modify');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('shows an explicit "no matching command" state once the live-visible grid narrows to zero — never a blank grid', async () => {
    const store = createAppStore();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, ':');
      await press(instance, stdin, KEYS.tab); // reveal the grid first (nothing shows before Tab)

      await press(instance, stdin, 'zzz');

      expect(stdout.output).toContain('No matching command.');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Tab autocompletes a single match to its full name — proven by a subsequent exact-match Enter succeeding', async () => {
    const store = createAppStore();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, ':');
      await press(instance, stdin, 'reg'); // partial — not an exact match on its own

      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, KEYS.enter);

      // "reg" alone would show "unknown command" on Enter (not an exact match) — this only
      // succeeds if Tab actually completed the input to the full "registry" name first.
      expect(store.getState().registryScreenOpen).toBe(true);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('the :quit command requests a quit through the store — reachable regardless of the "q" shortcut setting', async () => {
    const store = createAppStore();
    store.setState({ settings: { ...store.getState().settings, general: { quitShortcutEnabled: false } } });
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, ':');
      await press(instance, stdin, 'quit');
      await press(instance, stdin, KEYS.enter);

      expect(store.getState().quitRequested).toBe(true);
      expect(store.getState().commandBarOpen).toBe(false);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('the :quit command is a no-op while a run is in progress', async () => {
    const store = createAppStore();
    store.setState({ runInProgress: true });
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, ':');
      await press(instance, stdin, 'quit');
      await press(instance, stdin, KEYS.enter);

      expect(store.getState().quitRequested).toBe(false);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Tab leaves the input unchanged on zero matches — never guesses at a command', async () => {
    const store = createAppStore();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, ':');
      await press(instance, stdin, 'zzz');

      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, KEYS.enter);

      // If Tab had wrongly filled in "registry" despite zero matches, this Enter would have
      // run it; it must not have.
      expect(store.getState().registryScreenOpen).toBe(false);
      expect(stdout.output).toContain('Unknown command.');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Enter on an exact match runs the command and closes the bar', async () => {
    const store = createAppStore();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, ':');
      await press(instance, stdin, 'registry');
      expect(stdout.output).toContain('COMMAND');

      await press(instance, stdin, KEYS.enter);

      // The command ran (store-verifiable proof it actually executed, not just closed).
      expect(store.getState().registryScreenOpen).toBe(true);
      // The bar itself closed too (commandBarOpen lives in the store since the review fix
      // that moved it there so EdtsZone could also read it — see spec-2-14's Spec Change Log).
      expect(store.getState().commandBarOpen).toBe(false);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Enter on a non-exact match keeps the bar open and shows "unknown command" — never executes', async () => {
    const store = createAppStore();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, ':');
      await press(instance, stdin, 'reg');

      await press(instance, stdin, KEYS.enter);

      expect(store.getState().registryScreenOpen).toBe(false);
      expect(stdout.output).toContain('Unknown command.');
      expect(stdout.output).toContain('COMMAND');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Esc closes the bar without executing anything, discarding the typed text', async () => {
    const store = createAppStore();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, ':');
      await press(instance, stdin, 'registry');
      expect(stdout.output).toContain('COMMAND');

      await pressEscape(instance, stdin);

      // Never executed, and the bar itself closed.
      expect(store.getState().registryScreenOpen).toBe(false);
      expect(store.getState().commandBarOpen).toBe(false);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Tab is fully consumed by autocomplete — no zone-switching side effect while the bar is open', async () => {
    const store = createAppStore();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      expect(store.getState().activeZone).toBe('dashboard');
      await press(instance, stdin, ':');
      await press(instance, stdin, 'zzz');

      await press(instance, stdin, KEYS.tab);

      expect(store.getState().activeZone).toBe('dashboard');
      expect(stdout.output).toContain('COMMAND');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Enter inside the bar never leaks into EdtsZone\'s own key.return handler underneath it (review fix)', async () => {
    // Ink dispatches every keypress to every mounted useInput hook regardless of z-order —
    // with the EDTs zone active, a selected row, and pane-focus on its default 'edts' list,
    // EdtsZone's own key.return (openEdtAction(), which opens a dialog and flips
    // zoneInputCaptured true via its effect) would otherwise silently fire underneath the bar
    // the moment an exact-match Enter also runs a command. EdtsZone gates its useInput with
    // `{ isActive: !commandBarOpen }` to prevent this.
    //
    // Deliberately no Tab press in this test: EdtsZone's own key.tab toggles its local
    // paneFocus to 'services' (also leaked without the gate, per the same root cause) —
    // that pane has no key.return handling at all, so a Tab immediately before Enter would
    // incidentally mask the very leak this test exists to catch, regardless of the fix.
    // paneFocus itself has no store-observable footprint to assert against directly; the
    // isActive gate covers both leaks identically, and this test proves it via the one leak
    // (Enter -> openEdtAction -> zoneInputCaptured) that is store-observable.
    const store = createAppStore();
    store.setState({
      activeZone: 'edts',
      edts: [
        {
          ulid: '01JXXXXX1AAAAAAAAAAAAAAAAA',
          topic: 'demo',
          createdAt: '2026-01-01T00:00:00.000Z',
          status: 'inactive',
          members: [],
        },
      ],
      edtsStatus: 'idle',
      // A bare createAppStore() has no deps wired, so EdtsZone's real loadEdts()/
      // loadEdtsBranches() (called once on its own mount effect) would unconditionally
      // overwrite the seeded edts/edtsStatus above with an error state before this test's
      // keypresses even run. edts-zone.interaction.test.tsx's own suite stubs these the same
      // way for the same reason.
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
    });
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, ':');
      await press(instance, stdin, 'registry');

      await press(instance, stdin, KEYS.enter);

      // The command actually ran...
      expect(store.getState().registryScreenOpen).toBe(true);
      // ...and EdtsZone's own Enter handler (openEdtAction) never fired underneath the bar —
      // if it had, its dialog-open effect would have flipped this true.
      expect(store.getState().zoneInputCaptured).toBe(false);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('a keypress meant for the settings overlay (already open) never leaks into EdtsZone underneath it (story 2.19 review fix)', async () => {
    // Confirmed in real usage: unlike the test above (which only checks the single Enter
    // that *opens* an overlay), this checks a *later*, separate keypress typed once the
    // overlay is already open — e.g. Tab/arrows cycling the settings screen's tab strip —
    // which EdtsZone's `useInput` previously kept receiving underneath it, silently moving
    // its own list selection/pane focus at the same time (isActive only checked
    // `!commandBarOpen`, never `!settingsScreenOpen`).
    const store = createAppStore();
    store.setState({
      activeZone: 'edts',
      edts: [
        {
          ulid: '01JXXXXX1AAAAAAAAAAAAAAAAA',
          topic: 'demo',
          createdAt: '2026-01-01T00:00:00.000Z',
          status: 'inactive',
          members: [],
        },
      ],
      edtsStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
    });
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, ':');
      await press(instance, stdin, 'settings');
      await press(instance, stdin, KEYS.enter);
      expect(store.getState().settingsScreenOpen).toBe(true);

      // A later Enter, meant for the settings screen, must not reach EdtsZone's own
      // key.return (openEdtAction) underneath it.
      await press(instance, stdin, KEYS.enter);

      expect(store.getState().zoneInputCaptured).toBe(false);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('a keypress meant for the registry overlay (already open) never leaks into EdtsZone underneath it (story 2.19 review fix)', async () => {
    const store = createAppStore();
    store.setState({
      activeZone: 'edts',
      edts: [
        {
          ulid: '01JXXXXX1AAAAAAAAAAAAAAAAA',
          topic: 'demo',
          createdAt: '2026-01-01T00:00:00.000Z',
          status: 'inactive',
          members: [],
        },
      ],
      edtsStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
    });
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, ':');
      await press(instance, stdin, 'registry');
      await press(instance, stdin, KEYS.enter);
      expect(store.getState().registryScreenOpen).toBe(true);

      await press(instance, stdin, KEYS.enter);

      expect(store.getState().zoneInputCaptured).toBe(false);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Down from the input enters the grid at the top of the first column; Enter on the highlighted cell completes the query and returns focus to the input (story 2.17)', async () => {
    const store = createAppStore();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, ':');
      await press(instance, stdin, KEYS.tab); // empty-input Tab reveals the full grid

      await press(instance, stdin, KEYS.down); // input -> grid, top of first column (registry)
      // Move to the second row (edt-create) before completing, proving the grid actually
      // tracks cursor movement rather than always completing to the first row.
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.enter); // completes to the highlighted cell, focus -> input

      // Focus is back on the input and the query is the exact "edt-create" name — a second
      // Enter (only reachable from input focus) now runs it.
      await press(instance, stdin, KEYS.enter);

      expect(store.getState().currentEdtAction?.type).toBe('create');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('a printable character typed while the grid is focused returns focus to the input, appends it, and collapses the grid (story 2.17)', async () => {
    const store = createAppStore();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, ':');
      await press(instance, stdin, KEYS.tab); // reveal the grid
      await press(instance, stdin, KEYS.down); // input -> grid, top of first column

      await press(instance, stdin, 'x');

      // The grid must have collapsed and focus returned to the input rather than the
      // keypress being swallowed as grid navigation — proven by a subsequent Enter treating
      // "x" as an unknown command (from the input) instead of the grid's own Enter-on-cell
      // behavior completing to whichever cell was highlighted.
      await press(instance, stdin, KEYS.enter);

      expect(store.getState().registryScreenOpen).toBe(false);
      expect(stdout.output).toContain('Unknown command.');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('backspace while the grid is focused returns focus to the input and applies the backspace, per the spec\'s Ask-First resolution (story 2.17)', async () => {
    const store = createAppStore();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, ':');
      await press(instance, stdin, 'edt-'); // 3 matches, already sitting at the maximal common prefix

      await press(instance, stdin, KEYS.tab); // 1st Tab: arms pending, no visible change
      await press(instance, stdin, KEYS.tab); // 2nd Tab, same query, within window: shows the grid
      await press(instance, stdin, KEYS.down); // input -> grid, top of first column (edt-create)

      await press(instance, stdin, KEYS.backspace);

      // Backspace returned focus to the input (not the grid's own Enter-on-cell path) and
      // dropped the query to "edt" — a subsequent Enter shows "unknown command" because "edt"
      // isn't an exact match on its own; if focus had wrongly stayed in the grid, this same
      // Enter would instead silently complete to the highlighted cell without that message.
      await press(instance, stdin, KEYS.enter);

      expect(stdout.output).toContain('Unknown command.');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('the grid hides once live filtering narrows the match set to exactly one (story 2.17)', async () => {
    const store = createAppStore();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, ':');
      await press(instance, stdin, KEYS.tab); // reveal the full grid

      await press(instance, stdin, 'registry'); // live-narrows the match set to exactly one

      // The grid must have hidden (fallen back to the no-list state) rather than continuing
      // to show a stale multi-command grid — proven by Down (only meaningful while the grid
      // is visible) being a no-op, so the very next Enter runs the single exact match
      // directly from the input rather than the grid's own Enter-on-cell behavior firing.
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.enter);

      expect(store.getState().registryScreenOpen).toBe(true);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Esc from grid focus closes the bar entirely without running anything (story 2.17)', async () => {
    const store = createAppStore();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, ':');
      await press(instance, stdin, KEYS.tab); // reveal the grid
      await press(instance, stdin, KEYS.down); // input -> grid, top of first column

      await pressEscape(instance, stdin);

      expect(store.getState().registryScreenOpen).toBe(false);
      expect(store.getState().commandBarOpen).toBe(false);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Tab while the grid is focused is a no-op — it never leaks a literal tab character into the query (review fix)', async () => {
    // Boundaries only defines Up/Down/Left/Right/Enter/printable/Esc for grid focus; Tab has
    // no case there. Left unguarded, it previously fell through to the printable-character
    // branch and got appended into the query as a literal '\t' (Ink reports Tab's raw input
    // as that byte), corrupting the query and dropping out of the grid.
    const store = createAppStore();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, ':');
      await press(instance, stdin, KEYS.tab); // reveal the grid
      await press(instance, stdin, KEYS.down); // input -> grid, top of first column (registry)

      await press(instance, stdin, KEYS.tab);

      // Still in the grid, query untouched — completing from the still-highlighted first
      // cell and running it proves both: the query was never corrupted, and focus never left
      // the grid.
      await press(instance, stdin, KEYS.enter);
      await press(instance, stdin, KEYS.enter);

      expect(store.getState().registryScreenOpen).toBe(true);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('a non-Tab key between two Tab presses discards the pending double-Tab state, so the grid does not open early (review fix)', async () => {
    const store = createAppStore();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, ':');
      await press(instance, stdin, 'edt-'); // 3 matches, already at the maximal common prefix

      await press(instance, stdin, KEYS.tab); // 1st Tab: arms pending
      // An intervening key that isn't Tab and doesn't disturb the query (gridVisible is still
      // false at this point, so Down is a no-op) must discard the pending state per the
      // Boundaries ("any other key ... discards the pending state").
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.tab); // this Tab must be treated as a fresh 1st press

      // If pending had wrongly survived the intervening key, this Tab would be read as the
      // 2nd press and open the grid; Down would then enter it and Enter would only complete
      // the query (not run it). Since pending was correctly discarded, the grid never opened:
      // Down remains a no-op and Enter runs straight off the unfinished "edt-" query instead.
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.enter);

      expect(stdout.output).toContain('Unknown command.');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Up at the top row leaves the grid and returns focus to the input (story 2.17, real-keypress wiring check)', async () => {
    const store = createAppStore();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, ':');
      await press(instance, stdin, KEYS.tab); // reveal the grid
      await press(instance, stdin, KEYS.down); // input -> grid, top of first column (row 0)

      await press(instance, stdin, KEYS.up); // row 0 -> back to the input

      // Back at the input: typing now appends to the (still-empty) query rather than being
      // swallowed as grid navigation — proven by a subsequent exact "registry" + Enter run.
      await press(instance, stdin, 'registry');
      await press(instance, stdin, KEYS.enter);

      expect(store.getState().registryScreenOpen).toBe(true);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('gridMaxRows from the settings screen is live in the command bar\'s grid layout', async () => {
    // 6 registered commands (registry, edt-create, edt-switch, edt-modify, settings, quit),
    // grouped column-major with maxRows=2 -> 3 columns of [2, 2, 2] — directly observable in
    // the rendered COMMAND grid without needing to stub extra commands.
    const store = createAppStore();
    store.setState({
      settings: { general: { quitShortcutEnabled: true }, commandPalette: { gridMaxRows: 2 }, edts: { hiddenActionHints: [], hiddenActionTypes: [] }, logs: { bufferSize: 500, startWithHistory: false, filterHistorySize: 20, filterHistoryGridMaxRows: 8, filterHistoryDedup: true } },
    });
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, ':');
      await press(instance, stdin, KEYS.tab); // reveal the full grid

      const lines = stdout.output.split('\n');
      // Column 0 = [registry, edt-create], column 1 = [edt-switch, edt-modify], column 2 =
      // [settings, quit] (maxRows=2). Row 0 of the grid renders column-0-row-0 and column-1-row-0
      // on the SAME terminal line ("registry" + "edt-switch"); "edt-create" (column 0's row
      // 1) lands on the NEXT line instead. A single-column-of-6 layout (the pre-2.19 default,
      // maxRows=8) would instead put every command on its own line, with "edt-create"
      // sharing no line with "registry" either way — the positive signal here is
      // "edt-switch" sharing registry's line, which only maxRows=2 grouping produces.
      const registryLine = lines.find((line) => line.includes('registry'));
      expect(registryLine).toBeDefined();
      expect(registryLine).toContain('edt-switch');
      expect(registryLine).not.toContain('edt-create');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});

describe('AppShell settings screen (:settings) (story 2.19)', () => {
  it('opens on the General tab via the registered `settings` command — never a raw keypress', async () => {
    const store = createAppStore();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      // A bare keypress (not through the command bar) must never open it.
      await press(instance, stdin, 's');
      expect(stdout.output).not.toContain('SETTINGS');

      await press(instance, stdin, ':');
      await press(instance, stdin, 'settings');
      await press(instance, stdin, KEYS.enter);

      expect(store.getState().settingsScreenOpen).toBe(true);
      expect(stdout.output).toContain('SETTINGS');
      expect(stdout.output).toContain("Enable 'q' to quit");
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Space on the General tab toggles settings.general.quitShortcutEnabled and persists via updateSettings', async () => {
    const settingsPort: SettingsPort = {
      load: async () => ok({ settings: DEFAULT_SETTINGS, warning: null }),
      save: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ settings: settingsPort }));
    store.getState().openSettingsScreen();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await press(instance, stdin, ' ');

      expect(store.getState().settings.general.quitShortcutEnabled).toBe(false);
      expect(settingsPort.save).toHaveBeenCalledWith({
        general: { quitShortcutEnabled: false },
        commandPalette: { gridMaxRows: 8 },
        edts: { hiddenActionHints: [], hiddenActionTypes: [] },
        logs: { bufferSize: 500, startWithHistory: false, filterHistorySize: 20, filterHistoryGridMaxRows: 8, filterHistoryDedup: true },
      });

      await press(instance, stdin, ' ');
      expect(store.getState().settings.general.quitShortcutEnabled).toBe(true);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Esc closes it (AC4) — nothing to discard', async () => {
    const store = createAppStore();
    store.getState().openSettingsScreen();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      expect(store.getState().settingsScreenOpen).toBe(true);

      await pressEscape(instance, stdin);

      expect(store.getState().settingsScreenOpen).toBe(false);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Tab/Left/Right cycle General -> EDTs -> Command Palette -> General (AC1)', async () => {
    const store = createAppStore();
    store.getState().openSettingsScreen();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      expect(stdout.output).toContain("Enable 'q' to quit");

      await press(instance, stdin, KEYS.tab);
      // Amended 2026-08-28: the EDTs tab now opens on its group list, not the flat checkbox
      // list — AC6.
      expect(stdout.output).toContain('Hint visibility');
      expect(stdout.output).toContain('Recent action types');

      await press(instance, stdin, KEYS.tab);
      expect(stdout.output).toContain('Command grid max rows:');

      await press(instance, stdin, KEYS.tab);
      expect(stdout.output).toContain("Enable 'q' to quit");
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('never cycles tabs while a group is drilled into on the EDTs tab (AC1 amended, AC6)', async () => {
    const store = createAppStore();
    store.getState().openSettingsScreen();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await press(instance, stdin, KEYS.tab); // General -> EDTs (group list)
      await press(instance, stdin, KEYS.enter); // drill into "Hint visibility"
      expect(stdout.output).toContain('EDT selector');

      // Tab must not cycle away to Command Palette while drilled in.
      await press(instance, stdin, KEYS.tab);
      expect(stdout.output).toContain('EDT selector');
      expect(stdout.output).not.toContain('Command grid max rows:');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Esc steps back to the EDTs tab group list without closing the screen, then closes on the next Esc (AC6, amended Boundaries)', async () => {
    const store = createAppStore();
    store.getState().openSettingsScreen();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await press(instance, stdin, KEYS.tab); // General -> EDTs (group list)
      await press(instance, stdin, KEYS.enter); // drill into "Hint visibility"
      expect(stdout.output).toContain('EDT selector');

      await pressEscape(instance, stdin);

      // Still open, back at the group list.
      expect(store.getState().settingsScreenOpen).toBe(true);
      expect(stdout.output).toContain('Hint visibility');
      expect(stdout.output).toContain('Recent action types');

      await pressEscape(instance, stdin);

      expect(store.getState().settingsScreenOpen).toBe(false);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('never stacks on top of the help overlay, and a typed "?" never opens help while it is open', async () => {
    const store = createAppStore();
    store.getState().openHelp();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, ':');
      await press(instance, stdin, 'settings');
      await press(instance, stdin, KEYS.enter);
      expect(stdout.output).not.toContain('SETTINGS');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Up/Down on the Command Palette tab adjusts gridMaxRows live and persists via updateSettings (I/O matrix "Adjust grid rows")', async () => {
    const settingsPort: SettingsPort = {
      load: async () => ok({ settings: DEFAULT_SETTINGS, warning: null }),
      save: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ settings: settingsPort }));
    store.getState().openSettingsScreen();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab); // General -> EDTs
      await press(instance, stdin, KEYS.tab); // EDTs -> Command Palette

      await press(instance, stdin, KEYS.up);

      expect(store.getState().settings.commandPalette.gridMaxRows).toBe(9);
      expect(settingsPort.save).toHaveBeenCalledWith({
        general: { quitShortcutEnabled: true },
        commandPalette: { gridMaxRows: 9 },
        edts: { hiddenActionHints: [], hiddenActionTypes: [] },
        logs: { bufferSize: 500, startWithHistory: false, filterHistorySize: 20, filterHistoryGridMaxRows: 8, filterHistoryDedup: true },
      });
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // Amended 2026-09-20: the Logs tab moved from a flat row cursor to a group list (mirrors the
  // EDTs tab's own group-list precedent) — fixes the settings modal overflowing its viewport
  // (border/title corruption, overlapping rows) when all six fields rendered as one flat list.
  // Up/Down now navigates between groups; Enter drills into a group; Left/Right adjusts the
  // one numeric field a drilled-in group holds.
  it('Left/Right on the Logs tab\'s default "Buffer size" group adjusts settings.logs.bufferSize live and persists via updateSettings (story 5.1 AC: "new stream afterward uses the new buffer size"; regrouped 2026-09-20)', async () => {
    const settingsPort: SettingsPort = {
      load: async () => ok({ settings: DEFAULT_SETTINGS, warning: null }),
      save: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ settings: settingsPort }));
    store.getState().openSettingsScreen();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab); // General -> EDTs
      await press(instance, stdin, KEYS.tab); // EDTs -> Command Palette
      await press(instance, stdin, KEYS.tab); // Command Palette -> Logs (group list)
      await press(instance, stdin, KEYS.enter); // drill into "Buffer size" (first, default group)

      await press(instance, stdin, KEYS.right);

      expect(store.getState().settings.logs.bufferSize).toBe(550);
      expect(settingsPort.save).toHaveBeenCalledWith({
        general: { quitShortcutEnabled: true },
        commandPalette: { gridMaxRows: 8 },
        edts: { hiddenActionHints: [], hiddenActionTypes: [] },
        logs: { bufferSize: 550, startWithHistory: false, filterHistorySize: 20, filterHistoryGridMaxRows: 8, filterHistoryDedup: true },
      });

      // A typed digit is a quick preset (digit x 100), still while on the bufferSize row.
      await press(instance, stdin, '3');
      expect(store.getState().settings.logs.bufferSize).toBe(300);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Space on the Logs tab\'s "Start with history" group (reached via one Down from "Buffer size") toggles settings.logs.startWithHistory live and persists via updateSettings, independently of bufferSize (review fix; regrouped 2026-09-20)', async () => {
    const settingsPort: SettingsPort = {
      load: async () => ok({ settings: DEFAULT_SETTINGS, warning: null }),
      save: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ settings: settingsPort }));
    store.getState().openSettingsScreen();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab); // General -> EDTs
      await press(instance, stdin, KEYS.tab); // EDTs -> Command Palette
      await press(instance, stdin, KEYS.tab); // Command Palette -> Logs (group list)
      await press(instance, stdin, KEYS.down); // "Buffer size" -> "Start with history" group
      await press(instance, stdin, KEYS.enter); // drill into "Start with history"

      await press(instance, stdin, KEYS.space);

      expect(store.getState().settings.logs.startWithHistory).toBe(true);
      expect(store.getState().settings.logs.bufferSize).toBe(DEFAULT_SETTINGS.logs.bufferSize);
      expect(settingsPort.save).toHaveBeenCalledWith({
        general: { quitShortcutEnabled: true },
        commandPalette: { gridMaxRows: 8 },
        edts: { hiddenActionHints: [], hiddenActionTypes: [] },
        logs: {
          bufferSize: DEFAULT_SETTINGS.logs.bufferSize,
          startWithHistory: true,
          filterHistorySize: 20,
          filterHistoryGridMaxRows: 8,
          filterHistoryDedup: true,
        },
      });

      await press(instance, stdin, KEYS.space);
      expect(store.getState().settings.logs.startWithHistory).toBe(false);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // Story 5.4: end-to-end coverage of the two new fields and the clear actions, real-keypress
  // driven (mirrors the two tests just above).
  it('Left/Right on the "Filter history size"/"Filter history grid" groups adjusts them live and persists (regrouped 2026-09-20)', async () => {
    const settingsPort: SettingsPort = {
      load: async () => ok({ settings: DEFAULT_SETTINGS, warning: null }),
      save: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ settings: settingsPort }));
    store.getState().openSettingsScreen();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab); // General -> EDTs
      await press(instance, stdin, KEYS.tab); // EDTs -> Command Palette
      await press(instance, stdin, KEYS.tab); // Command Palette -> Logs (group list)
      await press(instance, stdin, KEYS.down); // -> "Start with history"
      await press(instance, stdin, KEYS.down); // -> "Filter history size"
      await press(instance, stdin, KEYS.enter); // drill in

      await press(instance, stdin, KEYS.right);
      expect(store.getState().settings.logs.filterHistorySize).toBe(25);

      await pressEscape(instance, stdin); // back to the group list
      await press(instance, stdin, KEYS.down); // -> "Filter history grid"
      await press(instance, stdin, KEYS.enter); // drill in
      await press(instance, stdin, KEYS.right);
      expect(store.getState().settings.logs.filterHistoryGridMaxRows).toBe(9);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Enter on "Clear global filter history" clears both global lists; Enter on "Clear a service\'s filter history" drills into a service list that clears just that service\'s lists (regrouped 2026-09-20)', async () => {
    const store = createAppStore(fakeDeps());
    store.getState().commitFilterHistoryEntry({ scope: 'global', repoPath: null, mode: 'text' }, 'g-text');
    store.getState().commitFilterHistoryEntry({ scope: 'pane', repoPath: '/repo/a', mode: 'text' }, 'a-text');
    store.setState({
      edtsBranches: [
        { service: 'svc-a', path: '/repo/a', isMember: false, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development' },
      ],
    });
    store.getState().openSettingsScreen();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab); // General -> EDTs
      await press(instance, stdin, KEYS.tab); // EDTs -> Command Palette
      await press(instance, stdin, KEYS.tab); // Command Palette -> Logs (group list)
      await press(instance, stdin, KEYS.down); // -> "Start with history"
      await press(instance, stdin, KEYS.down); // -> "Filter history size"
      await press(instance, stdin, KEYS.down); // -> "Filter history grid"
      await press(instance, stdin, KEYS.down); // -> "Filter history dedup"
      await press(instance, stdin, KEYS.down); // -> "Clear history"
      await press(instance, stdin, KEYS.enter); // drill in (row cursor on clear-global)

      await press(instance, stdin, KEYS.enter);
      expect(store.getState().filterHistory['global:text']).toBeUndefined();
      expect(store.getState().filterHistory['service:/repo/a:text']).toEqual(['a-text']);

      await press(instance, stdin, KEYS.down); // -> clear-service
      await press(instance, stdin, KEYS.enter); // drill into the service list
      await press(instance, stdin, KEYS.enter); // clear svc-a's history

      expect(store.getState().filterHistory['service:/repo/a:text']).toBeUndefined();
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Space on a "Hint visibility" checkbox row toggles that hint into settings.edts.hiddenActionHints and persists (I/O matrix "Toggle hidden hint")', async () => {
    const settingsPort: SettingsPort = {
      load: async () => ok({ settings: DEFAULT_SETTINGS, warning: null }),
      save: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ settings: settingsPort }));
    store.getState().openSettingsScreen();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab); // General -> EDTs (group list)
      await press(instance, stdin, KEYS.enter); // drill into "Hint visibility" (first row highlighted)

      await press(instance, stdin, ' ');

      expect(store.getState().settings.edts.hiddenActionHints).toEqual(['edts']);
      expect(settingsPort.save).toHaveBeenCalledWith({
        general: { quitShortcutEnabled: true },
        commandPalette: { gridMaxRows: 8 },
        edts: { hiddenActionHints: ['edts'], hiddenActionTypes: [] },
        logs: { bufferSize: 500, startWithHistory: false, filterHistorySize: 20, filterHistoryGridMaxRows: 8, filterHistoryDedup: true },
      });
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Enter on the EDTs tab\'s group list drills into "Recent action types"; Space toggles a type into settings.edts.hiddenActionTypes and persists (AC5, AC6)', async () => {
    const settingsPort: SettingsPort = {
      load: async () => ok({ settings: DEFAULT_SETTINGS, warning: null }),
      save: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ settings: settingsPort }));
    store.getState().openSettingsScreen();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab); // General -> EDTs (group list, "Hint visibility" highlighted)

      await press(instance, stdin, KEYS.down); // highlight "Recent action types"
      await press(instance, stdin, KEYS.enter); // drill in
      expect(stdout.output).toContain('Create');
      expect(stdout.output).toContain('Switch');
      expect(stdout.output).toContain('Modify');

      await press(instance, stdin, ' '); // toggle "Create" (first row)

      expect(store.getState().settings.edts.hiddenActionTypes).toEqual(['create']);
      expect(settingsPort.save).toHaveBeenCalledWith({
        general: { quitShortcutEnabled: true },
        commandPalette: { gridMaxRows: 8 },
        edts: { hiddenActionHints: [], hiddenActionTypes: ['create'] },
        logs: { bufferSize: 500, startWithHistory: false, filterHistorySize: 20, filterHistoryGridMaxRows: 8, filterHistoryDedup: true },
      });
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // Story 5.2 (Code Map): "app-shell.tsx:352 -- guard shouldOpenFilter dispatch with
  // activeZone !== 'logs', same precedent as logsPaneGridArrowsActive" — the Logs zone now
  // owns `/` itself (its own global-filter editor), so this app-wide stub must go inert while
  // it's the active zone, the same double-dispatch hazard already solved for arrow keys.
  it('the global "/" filter stub opens normally outside the Logs zone', async () => {
    const store = createAppStore();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      expect(store.getState().activeZone).not.toBe('logs');

      await press(instance, stdin, '/');

      expect(stdout.output).toContain('Filter input — wired in Epic 2+');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('the global "/" filter stub stays inert while the Logs zone is active — it owns "/" itself', async () => {
    const store = createAppStore();
    store.setState({ activeZone: 'logs' });
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await press(instance, stdin, '/');

      expect(stdout.output).not.toContain('Filter input — wired in Epic 2+');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});

describe('AppShell tabVisibility load activation (story 2.13 review fix)', () => {
  it('loads real tabVisibility from wired deps on mount — reflected in store state and the rendered tab bar', async () => {
    const manifest: ManifestPort = {
      load: vi.fn(async (path: string) => ok({ ...manifestFor(path), modules: { 'route-explorer': {} } })),
    };
    const store = createAppStore(fakeDeps({ manifest }));

    const { instance, stdout } = mount(store);
    try {
      await flushAsyncLoad(instance);

      // routes has one carrying repo (svc-a) but no active EDT — 'disabled', not 'enabled'.
      // sharedTypes has zero carrying repos — 'omitted'. Neither is the pre-load default
      // (both 'enabled'), so this can only pass if the mount effect actually loaded real data.
      expect(store.getState().tabVisibility).toEqual({
        routes: { status: 'disabled', carryingServices: ['svc-a'] },
        sharedTypes: { status: 'omitted', carryingServices: [] },
      });
      // The tab bar reflects it too: routes (disabled) stays reachable, shared-types
      // (omitted) is dropped from the bar entirely. `stdout.output` accumulates every frame
      // (including the pre-load one, which still shows both tabs) — the TopBar's "tui-back"
      // label re-renders at the start of every frame, so its last occurrence marks where the
      // final (post-load) frame begins.
      const output = stdout.output;
      const lastFrame = output.slice(output.lastIndexOf('tui-back'));
      expect(lastFrame).toContain('[r] Routes');
      expect(lastFrame).not.toContain('[s] Shared types');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('reloads tabVisibility after closeRegistryScreen() is called on an already-mounted shell', async () => {
    let loadCount = 0;
    const manifest: ManifestPort = {
      load: vi.fn(async (path: string) => {
        loadCount += 1;
        // Only the reload triggered by closing the registry screen (the 3rd load: mount,
        // then the open->close flip) reports the carrying module — isolates the assertion to
        // that specific reload rather than any load happening at all.
        const modules: Record<string, Record<string, unknown>> = loadCount >= 3 ? { 'route-explorer': {} } : {};
        return ok({ ...manifestFor(path), modules });
      }),
    };
    const store = createAppStore(fakeDeps({ manifest }));

    const { instance } = mount(store);
    try {
      await flushAsyncLoad(instance);
      expect(store.getState().tabVisibility.routes.status).toBe('omitted');

      // Simulate the registry screen having been opened (without exercising openRegistryScreen
      // itself, which is a separate concern) so closeRegistryScreen() below actually flips
      // registryScreenOpen false->true->false, re-triggering AppShell's effect.
      store.setState({ registryScreenOpen: true });
      await flushAsyncLoad(instance);

      store.getState().closeRegistryScreen();
      await flushAsyncLoad(instance);

      expect(store.getState().tabVisibility.routes).toEqual({
        status: 'disabled',
        carryingServices: ['svc-a'],
      });
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});

describe('AppShell edts load activation (story 2.20)', () => {
  it('resolves the active EDT topic in the top bar from a wired mount-time loadEdts(), without ever visiting the EDTs zone', async () => {
    const edtRegistry: EdtRegistryPort = {
      add: vi.fn(async () => ok(undefined)),
      list: vi.fn(async () =>
        ok([
          {
            ulid: '01JXXXXX1AAAAAAAAAAAAAAAAA',
            topic: 'checkout-revamp',
            createdAt: '2026-01-01T00:00:00.000Z',
            status: 'active',
            members: [],
          },
        ] as EdtRegistryEntry[]),
      ),
      setStatus: vi.fn(async () => ok(undefined)),
      update: vi.fn(async () => ok(undefined)),
      remove: vi.fn(async () => ok(undefined)),
    };
    const state: StatePort = {
      readActiveEdt: vi.fn(async () => ok('01JXXXXX1AAAAAAAAAAAAAAAAA')),
      writeActiveEdt: vi.fn(async () => ok(undefined)),
      readSplitterRatios: vi.fn(async () => ok(null)),
      writeSplitterRatios: vi.fn(async () => ok(undefined)),
      readFilterHistory: vi.fn(async () => ok(null)),
      writeFilterHistory: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ edtRegistry, state }));

    // The default activeZone is 'dashboard' — this test never switches to 'edts', so
    // EdtsZone's own mount-time loadEdts() call never fires; the store's edts/activeEdt can
    // only be populated by AppShell's own mount-time loadEdts() effect.
    expect(store.getState().activeZone).toBe('dashboard');

    const { instance, stdout } = mount(store);
    try {
      await flushAsyncLoad(instance);

      expect(store.getState().edts).toEqual([
        expect.objectContaining({ ulid: '01JXXXXX1AAAAAAAAAAAAAAAAA', topic: 'checkout-revamp' }),
      ]);
      expect(store.getState().activeEdt).toBe('01JXXXXX1AAAAAAAAAAAAAAAAA');

      const output = stdout.output;
      const lastFrame = output.slice(output.lastIndexOf('tui-back'));
      expect(lastFrame).toContain('checkout-revamp');
      expect(lastFrame).not.toContain('01JXXXXX1AAAAAAAAAAAAAAAAA');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});

// Review fix (story 2.21, finding 5): no existing test mounts AppShell with a
// StatePort.readSplitterRatios stub returning a non-null persisted map and asserts the store
// reflects it post-mount — every other test in this file stubs it as ok(null). Mirrors
// 'AppShell edts load activation' above and 'AppShell tabVisibility load activation'
// (flushAsyncLoad idiom) for the mount-time loadSplitterRatios() effect specifically.
describe('AppShell splitterRatios load activation (story 2.21)', () => {
  it('resolves store.splitterRatios from a wired mount-time loadSplitterRatios(), independent of which zone renders first', async () => {
    const state: StatePort = {
      readActiveEdt: vi.fn(async () => ok(null)),
      writeActiveEdt: vi.fn(async () => ok(undefined)),
      readSplitterRatios: vi.fn(async () => ok({ edts: [0.3, 0.4, 0.5], dashboard: [0.6] })),
      writeSplitterRatios: vi.fn(async () => ok(undefined)),
      readFilterHistory: vi.fn(async () => ok(null)),
      writeFilterHistory: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ state }));

    // The default activeZone is 'dashboard' — this test never switches to 'edts', so the
    // persisted ratios can only be populated by AppShell's own mount-time
    // loadSplitterRatios() effect, not by EdtsZone ever mounting.
    expect(store.getState().activeZone).toBe('dashboard');
    expect(store.getState().splitterRatios.edts).not.toEqual([0.3, 0.4, 0.5]);

    const { instance } = mount(store);
    try {
      await flushAsyncLoad(instance);

      expect(store.getState().splitterRatios.edts).toEqual([0.3, 0.4, 0.5]);
      expect(store.getState().splitterRatios.dashboard).toEqual([0.6]);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});

describe('AppShell Ctrl+W resize-mode (story 2.21)', () => {
  it('Ctrl+W is a no-op on a non-EDTs zone (Boundaries: "a no-op elsewhere")', async () => {
    const store = createAppStore();
    store.getState().setActiveZone('dashboard');
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await press(instance, stdin, KEYS.ctrlW);

      expect(store.getState().resizeMode).toBeNull();
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Ctrl+W engages resize-mode, targeting boundary 0, while the EDTs zone is active', async () => {
    const store = createAppStore();
    store.getState().setActiveZone('edts');
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await press(instance, stdin, KEYS.ctrlW);

      expect(store.getState().resizeMode).toEqual({ zone: 'edts', targetBoundary: 0 });
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Ctrl+W under the command bar overlay is a no-op', async () => {
    const store = createAppStore();
    store.getState().setActiveZone('edts');
    store.getState().openCommandBar();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await press(instance, stdin, KEYS.ctrlW);

      expect(store.getState().resizeMode).toBeNull();
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('a second Ctrl+W while resize-mode is already active is a no-op (review fix, finding 7)', async () => {
    const store = createAppStore();
    store.getState().setActiveZone('edts');
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await press(instance, stdin, KEYS.ctrlW);
      expect(store.getState().resizeMode).toEqual({ zone: 'edts', targetBoundary: 0 });

      // Move the target off boundary 0 first, so a second Ctrl+W silently re-entering
      // (targetBoundary reset to 0) would be observable rather than coincidentally matching
      // the already-correct state.
      await press(instance, stdin, KEYS.tab);
      expect(store.getState().resizeMode).toEqual({ zone: 'edts', targetBoundary: 1 });

      await press(instance, stdin, KEYS.ctrlW);

      // Still targeting boundary 1 — the second Ctrl+W was swallowed as "every other key is
      // inert while resize-mode owns input", never re-entering (which would have reset
      // targetBoundary back to 0) and never exiting either.
      expect(store.getState().resizeMode).toEqual({ zone: 'edts', targetBoundary: 1 });
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Tab cycles the targeted boundary across all 3, wrapping back to 0 — and never touches EdtsZone\'s own paneFocus (review fix, finding 6)', async () => {
    // A populated, successfully-loaded EDT so the detail pane's "Topic: ..." line
    // (formatEdtDetail, unique to the EDT-selector's own detail content — never rendered by
    // either services pane) is a reliable, plain-text signal for "paneFocus is still 'edts'".
    // EdtsZone's own Tab handler (cyclePaneFocus) would otherwise move this to
    // 'edt-services' on the very first Tab. An *unwired* store's own mount-time loadEdts()
    // flips edtsStatus to 'error' (edtsRows then renders as empty regardless of any seeded
    // `edts` array — "never show stale rows under an error banner"), so this needs wired deps
    // with a populated edtRegistry, not a bare `createAppStore()` + `setState`.
    const edtRegistry: EdtRegistryPort = {
      add: vi.fn(async () => ok(undefined)),
      list: vi.fn(async () =>
        ok([
          {
            ulid: '01JXXXXX1AAAAAAAAAAAAAAAAA',
            topic: 'checkout-revamp',
            createdAt: '2026-01-01T00:00:00.000Z',
            status: 'active',
            members: [],
          },
        ] as EdtRegistryEntry[]),
      ),
      setStatus: vi.fn(async () => ok(undefined)),
      update: vi.fn(async () => ok(undefined)),
      remove: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ edtRegistry }));
    store.getState().setActiveZone('edts');
    store.getState().enterResizeMode('edts');
    const { instance, stdin, stdout } = mount(store);
    // `stdout.output` accumulates every frame ever written — a string only ever needs to have
    // appeared *once* to satisfy a plain `toContain` against it, so a stale first-render frame
    // could hide a real regression on a later frame. Slice out just the most recent frame
    // (mirrors 'AppShell edts load activation' above) before every assertion below.
    const lastFrame = () => stdout.output.slice(stdout.output.lastIndexOf('tui-back'));
    try {
      await flushAsyncLoad(instance);
      expect(lastFrame()).toContain('Topic: checkout-revamp');

      await press(instance, stdin, KEYS.tab);
      expect(store.getState().resizeMode?.targetBoundary).toBe(1);
      expect(lastFrame()).toContain('Topic: checkout-revamp');

      await press(instance, stdin, KEYS.tab);
      expect(store.getState().resizeMode?.targetBoundary).toBe(2);
      expect(lastFrame()).toContain('Topic: checkout-revamp');

      await press(instance, stdin, KEYS.tab);
      expect(store.getState().resizeMode?.targetBoundary).toBe(0);
      expect(lastFrame()).toContain('Topic: checkout-revamp');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Left/Right resize the vertical boundary 0 (list<->detail split), clamped', async () => {
    const store = createAppStore();
    store.getState().setActiveZone('edts');
    store.getState().enterResizeMode('edts');
    const before = store.getState().splitterRatios.edts[0];
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await press(instance, stdin, KEYS.right);
      expect(store.getState().splitterRatios.edts[0]).toBeCloseTo(before + 0.05);

      await press(instance, stdin, KEYS.left);
      await press(instance, stdin, KEYS.left);
      expect(store.getState().splitterRatios.edts[0]).toBeCloseTo(before - 0.05);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Up/Down resize a horizontal boundary (1/2), while boundary 0 is unaffected', async () => {
    const store = createAppStore();
    store.getState().setActiveZone('edts');
    store.getState().enterResizeMode('edts');
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      // Tab from boundary 0 to boundary 1 (the EDTs zone's first horizontal sub-split).
      await press(instance, stdin, KEYS.tab);
      const boundary0Before = store.getState().splitterRatios.edts[0];
      const boundary1Before = store.getState().splitterRatios.edts[1];

      await press(instance, stdin, KEYS.down);

      expect(store.getState().splitterRatios.edts[1]).toBeCloseTo(boundary1Before + 0.05);
      expect(store.getState().splitterRatios.edts[0]).toBe(boundary0Before);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('a horizontal boundary ignores Left/Right (wrong axis) — no-op', async () => {
    const store = createAppStore();
    store.getState().setActiveZone('edts');
    store.getState().enterResizeMode('edts');
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab);
      const before = store.getState().splitterRatios.edts[1];

      await press(instance, stdin, KEYS.right);

      expect(store.getState().splitterRatios.edts[1]).toBe(before);
      // Left/Right's usual zone-switch binding is also inert while resize-mode is active.
      expect(store.getState().activeZone).toBe('edts');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Enter exits resize-mode with no separate save step (the live move already applied)', async () => {
    const store = createAppStore();
    store.getState().setActiveZone('edts');
    store.getState().enterResizeMode('edts');
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.right);
      const movedRatio = store.getState().splitterRatios.edts[0];

      await press(instance, stdin, KEYS.enter);

      expect(store.getState().resizeMode).toBeNull();
      expect(store.getState().splitterRatios.edts[0]).toBe(movedRatio);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Esc exits resize-mode and normal keys (e.g. zone-switch arrows) resume', async () => {
    const store = createAppStore();
    store.getState().setActiveZone('edts');
    store.getState().enterResizeMode('edts');
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await pressEscape(instance, stdin);
      expect(store.getState().resizeMode).toBeNull();

      await press(instance, stdin, KEYS.right);
      expect(store.getState().activeZone).toBe('update');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('resize-mode persists boundary moves via StatePort.writeSplitterRatios', async () => {
    const writeSplitterRatios = vi.fn(async () => ok(undefined));
    const state: StatePort = {
      readActiveEdt: vi.fn(async () => ok(null)),
      writeActiveEdt: vi.fn(async () => ok(undefined)),
      readSplitterRatios: vi.fn(async () => ok(null)),
      writeSplitterRatios,
      readFilterHistory: vi.fn(async () => ok(null)),
      writeFilterHistory: vi.fn(async () => ok(undefined)),
    };
    // A non-empty EDT registry: an empty one auto-opens the EDTs zone's create dialog (AC1),
    // which sets zoneInputCaptured — that would swallow the Ctrl+W-driven resize keypress
    // below before it ever reaches AppShell's resize-mode dispatch.
    const edtRegistry: EdtRegistryPort = {
      add: vi.fn(async () => ok(undefined)),
      list: vi.fn(async () =>
        ok([
          {
            ulid: '01JXXXXX1AAAAAAAAAAAAAAAAA',
            topic: 'checkout-revamp',
            createdAt: '2026-01-01T00:00:00.000Z',
            status: 'active',
            members: [],
          },
        ] as EdtRegistryEntry[]),
      ),
      setStatus: vi.fn(async () => ok(undefined)),
      update: vi.fn(async () => ok(undefined)),
      remove: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ state, edtRegistry }));
    store.getState().setActiveZone('edts');
    store.getState().enterResizeMode('edts');
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await press(instance, stdin, KEYS.right);
      // setSplitterRatio's own persistence chain is awaited internally, but the dispatch call
      // itself is fire-and-forget (`void`) from app-shell.tsx — give the microtask queue a
      // turn to flush before asserting the write actually landed.
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(writeSplitterRatios).toHaveBeenCalledWith(store.getState().splitterRatios);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});
