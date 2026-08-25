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
import { describe, it, expect } from 'vitest';
import { AppShell } from './app-shell.js';
import { createAppStore } from './store/app-store.js';
import { fakeInteractiveTtyStdin, FakeTtyStdout, KEYS } from './shared/test-support/fake-tty.js';

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

      // The bar itself closing (commandBarOpen reset) has no store field of its own to read
      // directly — prove it the same way Story 2.12's suite proves an overlay guard lifted:
      // close the registry screen programmatically (bypassing the UI) and confirm Left/Right
      // zone-switching works again. If the bar's local commandBarOpen had wrongly stayed
      // true, this would still be blocked.
      store.getState().closeRegistryScreen();
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.right);
      expect(store.getState().activeZone).toBe('edts');
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

      // Never executed.
      expect(store.getState().registryScreenOpen).toBe(false);

      // The bar itself closed (commandBarOpen reset, unlike registryScreenOpen there's no
      // store field to read directly) — proven the same way as the Enter/exact-match test
      // above: Left/Right zone-switching, blocked while the bar owns input, works again.
      await press(instance, stdin, KEYS.right);
      expect(store.getState().activeZone).toBe('edts');
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
});
