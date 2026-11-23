import { createElement } from 'react';
import { render } from 'ink';
import { describe, it, expect, vi } from 'vitest';
import { AppShell } from './app-shell.js';
import { createAppStore } from './store/app-store.js';
import { fakeInteractiveTtyStdin, FakeTtyStdout, KEYS } from './shared/test-support/fake-tty.js';
import { footerIdOf } from './shared/test-support/mount-for-test.js';
import { filterKeybindings } from './shared/components/dialogs/keybinding-help.js';
import { KEYBINDINGS } from './keybindings/index.js';
import { mount, press, pressEscape } from './app-shell.test-support.js';

describe('AppShell footer contexts (real keypress)', () => {
  const settle = async (instance: ReturnType<typeof render>) => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    await instance.waitUntilRenderFlush();
  };

  async function withShell(run: (ctx: { store: ReturnType<typeof createAppStore>; instance: ReturnType<typeof render>; stdin: NodeJS.ReadStream }) => Promise<void>) {
    const store = createAppStore();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await run({ store, instance, stdin });
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  }

  it('the help registers its context while open and clears it on close', async () => {
    await withShell(async ({ store, instance, stdin }) => {
      await press(instance, stdin, '?');
      await settle(instance);
      expect(footerIdOf(store)).toBe('help');
      await press(instance, stdin, '?');
      await settle(instance);
      expect(footerIdOf(store)).toBeUndefined();
    });
  });

  it('typing in the open help filters it; ? and Esc edit a non-empty filter before closing', async () => {
    await withShell(async ({ store, instance, stdin }) => {
      await press(instance, stdin, '?');
      await settle(instance);
      await press(instance, stdin, 'r');
      await press(instance, stdin, 'E');
      expect(store.getState()).toMatchObject({ helpOpen: true, helpFilter: 'rE', activeZone: 'dashboard' });
      await press(instance, stdin, KEYS.backspace);
      expect(store.getState().helpFilter).toBe('r');
      await press(instance, stdin, '?');
      expect(store.getState()).toMatchObject({ helpOpen: true, helpFilter: 'r?' });
      await pressEscape(instance, stdin);
      expect(store.getState()).toMatchObject({ helpOpen: true, helpFilter: '' });
      await press(instance, stdin, 'q');
      await pressEscape(instance, stdin);
      await press(instance, stdin, '?');
      expect(store.getState()).toMatchObject({ helpOpen: false, helpFilter: '' });
      await settle(instance);
      await press(instance, stdin, '?');
      expect(store.getState()).toMatchObject({ helpOpen: true, helpFilter: '' });
    });
  });

  // A wide, tall terminal so the whole help window renders unclipped and keys never wrap.
  function mountLarge(store: ReturnType<typeof createAppStore>) {
    const stdout = new FakeTtyStdout();
    stdout.columns = 200;
    stdout.rows = 60;
    const stdin = fakeInteractiveTtyStdin();
    const instance = render(createElement(AppShell, { useStore: store, onQuit: () => {} }), {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin,
      interactive: true,
      exitOnCtrlC: false,
      patchConsole: false,
    });
    const frame = () => stdout.output.slice(stdout.output.lastIndexOf('KEYBINDINGS'));
    return { instance, stdin, frame };
  }

  it('End then Up scrolls the filtered list by exactly one row', async () => {
    const store = createAppStore();
    const { instance, stdin, frame } = mountLarge(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, '?');
      await settle(instance);
      for (const char of 'logs') await press(instance, stdin, char);
      await settle(instance);
      const rows = filterKeybindings(KEYBINDINGS, 'logs');
      expect(rows.length).toBeGreaterThan(11);
      expect(rows.length).toBeLessThan(KEYBINDINGS.length);

      await press(instance, stdin, KEYS.end);
      await settle(instance);
      expect(frame()).toContain(`[${rows.at(-1)!.keys}]`);
      expect(frame()).toContain(`[${rows.at(-10)!.keys}]`);
      expect(frame()).not.toContain(`[${rows.at(-11)!.keys}]`);

      await press(instance, stdin, KEYS.up);
      await settle(instance);
      expect(frame()).toContain(`[${rows.at(-11)!.keys}]`);
      expect(frame()).toContain(`[${rows.at(-2)!.keys}]`);
      expect(frame()).not.toContain(`[${rows.at(-1)!.keys}]`);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('a filter change scrolls the help back to its first match', async () => {
    const store = createAppStore();
    const { instance, stdin, frame } = mountLarge(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, '?');
      await settle(instance);
      await press(instance, stdin, KEYS.end);
      await press(instance, stdin, KEYS.down);
      await settle(instance);
      expect(frame()).not.toContain(`[${KEYBINDINGS[0]!.keys}]`);

      await press(instance, stdin, 'z');
      await settle(instance);
      const matches = filterKeybindings(KEYBINDINGS, 'z');
      expect(matches.length).toBeGreaterThan(10);
      expect(frame()).toContain(`[${matches[0]!.keys}]`);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('q, : and a zone mnemonic typed in the open help only edit its filter', async () => {
    const store = createAppStore();
    const onQuit = vi.fn();
    const stdout = new FakeTtyStdout();
    const stdin = fakeInteractiveTtyStdin();
    const instance = render(createElement(AppShell, { useStore: store, onQuit }), {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin,
      interactive: true,
      exitOnCtrlC: false,
      patchConsole: false,
    });
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, '?');
      await settle(instance);
      const zone = store.getState().activeZone;
      await press(instance, stdin, 'q');
      await press(instance, stdin, ':');
      await press(instance, stdin, 'l');
      await settle(instance);
      expect(store.getState()).toMatchObject({
        helpOpen: true,
        helpFilter: 'q:l',
        commandBarOpen: false,
        quitRequested: false,
        activeZone: zone,
      });
      expect(onQuit).not.toHaveBeenCalled();
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('the open help footer lists the filter keys', async () => {
    const store = createAppStore();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, '?');
      await settle(instance);
      const frame = stdout.output.slice(stdout.output.lastIndexOf('KEYBINDINGS'));
      expect(frame).toContain('type to filter');
      expect(frame).toContain('[type] filter');
      expect(frame).toContain('[Backspace] erase');
      expect(frame).toContain('[PgUp/PgDn] page');
      expect(frame).toContain('clear/close');
      expect(frame).not.toContain('[?] close');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('the command bar registers its context while open and clears it on Esc', async () => {
    await withShell(async ({ store, instance, stdin }) => {
      await press(instance, stdin, ':');
      await settle(instance);
      expect(footerIdOf(store)).toBe('command');
      await pressEscape(instance, stdin);
      await settle(instance);
      expect(footerIdOf(store)).toBeUndefined();
    });
  });

  it('a zone registering while the help is open does not take the footer from it', async () => {
    await withShell(async ({ store, instance, stdin }) => {
      await press(instance, stdin, '?');
      await settle(instance);
      store.getState().setFooterContext('edts', 'confirm');
      expect(footerIdOf(store)).toBe('help');
      await press(instance, stdin, '?');
      await settle(instance);
      expect(footerIdOf(store)).toBe('confirm');
    });
  });

  it('"?" still closes an open help panel when a zone dialog captured input meanwhile', async () => {
    const store = createAppStore();
    store.setState({ helpOpen: true, zoneInputCaptured: true });

    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await press(instance, stdin, '?');

      expect(store.getState().helpOpen).toBe(false);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});
