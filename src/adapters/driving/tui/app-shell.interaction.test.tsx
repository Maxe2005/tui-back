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
  };
  const edtRegistry: EdtRegistryPort = {
    add: vi.fn(async () => ok(undefined)),
    list: vi.fn(async () => ok([] as EdtRegistryEntry[])),
    setStatus: vi.fn(async () => ok(undefined)),
    update: vi.fn(async () => ok(undefined)),
  };
  const state: StatePort = {
    readActiveEdt: vi.fn(async () => ok(null)),
    writeActiveEdt: vi.fn(async () => ok(undefined)),
  };
  const lock: LockPort = {
    acquire: vi.fn(async () => ok({ release: vi.fn(async () => ok(undefined)) })),
    peek: vi.fn(async () => ok({ locked: false })),
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

describe('AppShell command-entry bar (:) (story 2.14)', () => {
  it('opens on : from content focus with an empty focused input and the full command list', async () => {
    const store = createAppStore();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await press(instance, stdin, ':');

      expect(stdout.output).toContain('COMMAND');
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

  it('filters the command list to a case-insensitive name-prefix match as text is typed', async () => {
    const store = createAppStore();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, ':');

      await press(instance, stdin, 'REG');

      expect(stdout.output).toContain('registry');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('shows an explicit "no matching command" state on zero matches — never a blank list', async () => {
    const store = createAppStore();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, ':');

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

  it('Tab leaves the input unchanged on zero matches — never guesses at a command', async () => {
    const store = createAppStore();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, ':');
      await press(instance, stdin, 'zzz');
      expect(stdout.output).toContain('No matching command.');

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
