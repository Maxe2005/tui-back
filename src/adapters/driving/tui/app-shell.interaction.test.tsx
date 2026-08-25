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
