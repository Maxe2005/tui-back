// tui/shared/command-bar: real-keypress coverage of the command history recall — every row of
// the recall I/O matrix, driven through the mounted bar's useInput (the shared input-history
// primitive's own logic is unit-tested in input-history/).
import { createElement } from 'react';
import { render } from 'ink';
import { describe, it, expect, vi } from 'vitest';
import { CommandBar } from './command-bar.js';
import { createAppStore } from '../store/app-store.js';
import { fakeInteractiveTtyStdin, FakeTtyStdout, KEYS } from './test-support/fake-tty.js';

function mount(store: ReturnType<typeof createAppStore>) {
  const stdout = new FakeTtyStdout();
  const stdin = fakeInteractiveTtyStdin();
  const onClose = vi.fn();
  const instance = render(createElement(CommandBar, { useStore: store, onClose }), {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin,
    interactive: true,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  return { instance, stdin, stdout, onClose };
}

async function press(instance: ReturnType<typeof render>, stdin: NodeJS.ReadStream, sequence: string) {
  (stdin as unknown as { write: (chunk: string) => void }).write(sequence);
  await instance.waitUntilRenderFlush();
}

async function type(instance: ReturnType<typeof render>, stdin: NodeJS.ReadStream, text: string) {
  for (const char of text) {
    await press(instance, stdin, char);
  }
}

async function withBar(
  history: string[],
  scenario: (ctx: ReturnType<typeof mount> & { store: ReturnType<typeof createAppStore> }) => Promise<void>,
) {
  const store = createAppStore();
  store.setState({ commandHistory: history });
  const mounted = mount(store);
  try {
    await mounted.instance.waitUntilRenderFlush();
    await scenario({ ...mounted, store });
  } finally {
    mounted.instance.unmount();
    await mounted.instance.waitUntilExit();
  }
}

describe('CommandBar history recall', () => {
  it('RECORD: Enter on a recognized command pushes it to the front of the history', async () => {
    await withBar(['registry'], async ({ instance, stdin, store, onClose }) => {
      await type(instance, stdin, 'settings');
      await press(instance, stdin, KEYS.enter);
      expect(store.getState().commandHistory).toEqual(['settings', 'registry']);
      expect(store.getState().settingsScreenOpen).toBe(true);
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('UNKNOWN: Enter on an unknown command never records it', async () => {
    await withBar(['registry'], async ({ instance, stdin, store, onClose }) => {
      await type(instance, stdin, 'zzz');
      await press(instance, stdin, KEYS.enter);
      expect(store.getState().commandHistory).toEqual(['registry']);
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  it('RECALL_UP: ↑ recalls the most recent, further ↑ walks older, no-op at the oldest; Enter runs the displayed command', async () => {
    await withBar(['registry', 'settings'], async ({ instance, stdin, store }) => {
      await press(instance, stdin, KEYS.up);
      await press(instance, stdin, KEYS.up);
      await press(instance, stdin, KEYS.up); // no-op at the oldest
      await press(instance, stdin, KEYS.enter);
      expect(store.getState().settingsScreenOpen).toBe(true);
      expect(store.getState().registryScreenOpen).toBe(false);
      expect(store.getState().commandHistory).toEqual(['settings', 'registry']);
    });
  });

  it('RESTORE: ↓ past the most recent entry restores the draft exactly', async () => {
    await withBar(['settings'], async ({ instance, stdin, store }) => {
      await type(instance, stdin, 'reg');
      await press(instance, stdin, KEYS.up);
      await press(instance, stdin, KEYS.down);
      await type(instance, stdin, 'istry');
      await press(instance, stdin, KEYS.enter);
      expect(store.getState().commandHistory).toEqual(['registry', 'settings']);
    });
  });

  it('SKIP_DRAFT: entries equal to the draft are skipped while walking older', async () => {
    await withBar(['registry', 'settings', 'reset'], async ({ instance, stdin, store }) => {
      await type(instance, stdin, 'settings');
      await press(instance, stdin, KEYS.up); // registry
      await press(instance, stdin, KEYS.up); // skips the draft-equal 'settings' → reset
      await press(instance, stdin, KEYS.enter);
      expect(store.getState().resetScreenOpen).toBe(true);
      expect(store.getState().settingsScreenOpen).toBe(false);
    });
  });

  it('SNAP_BACK: a printable character while browsing restores the draft and applies the key on top', async () => {
    await withBar(['settings'], async ({ instance, stdin, store }) => {
      await type(instance, stdin, 'regi');
      await press(instance, stdin, KEYS.up);
      await type(instance, stdin, 's');
      await type(instance, stdin, 'try');
      await press(instance, stdin, KEYS.enter);
      expect(store.getState().registryScreenOpen).toBe(true);
      expect(store.getState().commandHistory[0]).toBe('registry');
    });
  });

  it('SNAP_BACK: Backspace while browsing restores the draft minus its last character', async () => {
    await withBar(['settings'], async ({ instance, stdin, store }) => {
      await type(instance, stdin, 'registryx');
      await press(instance, stdin, KEYS.up);
      await press(instance, stdin, KEYS.backspace);
      await press(instance, stdin, KEYS.enter);
      expect(store.getState().registryScreenOpen).toBe(true);
    });
  });

  it('TAB_ADOPT: Tab adopts the recalled text as the new draft, ending browsing', async () => {
    await withBar(['registry'], async ({ instance, stdin, store }) => {
      await type(instance, stdin, 'x');
      await press(instance, stdin, KEYS.up);
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, KEYS.down); // not browsing any more: no walk back to 'x'
      await press(instance, stdin, KEYS.enter);
      expect(store.getState().registryScreenOpen).toBe(true);
    });
  });

  it('DOWN_DRAFT: ↓ on an untouched draft never recalls history', async () => {
    await withBar(['registry'], async ({ instance, stdin, store, onClose }) => {
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.enter); // empty draft → unknown, nothing ran
      expect(store.getState().registryScreenOpen).toBe(false);
      expect(onClose).not.toHaveBeenCalled();
    });
  });
});
