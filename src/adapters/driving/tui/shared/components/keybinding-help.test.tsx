import { describe, it, expect } from 'vitest';
import { KEYBINDINGS } from '../../keybindings/index.js';
import { createAppStore } from '../../store/app-store.js';
import {
  KeybindingHelp,
  clampHelpOffset,
  resolveHelpScroll,
  resolveHelpWindow,
} from './index.js';
import { clampBoundedOffset, resolveBoundedWindow } from './bounded-list.js';
import { renderToString } from './render-to-string.js';

// clampHelpOffset/resolveHelpWindow are thin aliases for bounded-list.tsx's
// clampBoundedOffset/resolveBoundedWindow, not a second copy of the window logic.
describe('keybinding-help delegates to the shared bounded-list primitive', () => {
  it('clampHelpOffset/resolveHelpWindow are literally bounded-list.tsx\'s own exports', () => {
    expect(clampHelpOffset).toBe(clampBoundedOffset);
    expect(resolveHelpWindow).toBe(resolveBoundedWindow);
  });
});

describe('keybinding-help scroll window (UX-DR15)', () => {
  it('clamps negative and non-finite offsets to 0', () => {
    expect(clampHelpOffset(-3, 10)).toBe(0);
    expect(clampHelpOffset(Number.NaN, 10)).toBe(0);
    expect(clampHelpOffset(Number.POSITIVE_INFINITY, 10)).toBe(0);
  });

  it('clamps offsets above the max to the max', () => {
    expect(clampHelpOffset(12, 10)).toBe(10);
    expect(clampHelpOffset(10, 10)).toBe(10);
  });

  it('clamps the max offset itself when non-finite or negative', () => {
    expect(clampHelpOffset(5, Number.NaN)).toBe(0);
    expect(clampHelpOffset(5, -1)).toBe(0);
  });

  it('resolves the visible slice for the given offset and line count', () => {
    const window = resolveHelpWindow(KEYBINDINGS, 0, 10);
    expect(window.visible).toHaveLength(10);
    expect(window.visible[0].keys).toBe('↑ / ↓');
    expect(window.scrollOffset).toBe(0);
  });

  it('moves the visible slice down and up by one row, clamped', () => {
    const down = resolveHelpWindow(KEYBINDINGS, 1, 10);
    expect(down.visible[0].keys).toBe('Home / End');
    expect(down.scrollOffset).toBe(1);

    const atBottom = resolveHelpWindow(KEYBINDINGS, 100, 10);
    expect(atBottom.visible.at(-1)?.keys).toBe('Ctrl+T (branch picker)');
    expect(atBottom.scrollOffset).toBe(KEYBINDINGS.length - 10);

    const backUp = resolveHelpWindow(KEYBINDINGS, atBottom.scrollOffset - 1, 10);
    expect(backUp.scrollOffset).toBe(atBottom.scrollOffset - 1);
  });
});

// resolveHelpScroll reads key flags (upArrow/downArrow/home/end), never input==='j'/'k'; j/k/g/G
// are inert.
describe('resolveHelpScroll', () => {
  const noKey = { upArrow: false, downArrow: false, home: false, end: false, tab: false };

  it('moves the offset down on downArrow and up on upArrow', () => {
    expect(resolveHelpScroll({ ...noKey, downArrow: true }, 0, 10)).toBe(1);
    expect(resolveHelpScroll({ ...noKey, upArrow: true }, 1, 10)).toBe(0);
  });

  it('clamps at the top bound on upArrow', () => {
    expect(resolveHelpScroll({ ...noKey, upArrow: true }, 0, 10)).toBe(0);
  });

  it('jumps to the top on Home', () => {
    expect(resolveHelpScroll({ ...noKey, home: true }, 5, 10)).toBe(0);
  });

  it('jumps to the bottom on End', () => {
    expect(resolveHelpScroll({ ...noKey, end: true }, 0, 10)).toBe(
      KEYBINDINGS.length - 10,
    );
  });

  it('leaves the offset unchanged when no relevant key flag is set (j/k/g/G are inert)', () => {
    expect(resolveHelpScroll(noKey, 3, 10)).toBe(3);
  });
});

describe('KeybindingHelp modal', () => {
  it('renders the keybinding list while open and nothing when closed', async () => {
    const store = createAppStore();
    let output = await renderToString(<KeybindingHelp useStore={store} />);
    expect(output).not.toContain('KEYBINDINGS');

    store.getState().openHelp();
    output = await renderToString(<KeybindingHelp useStore={store} />);
    expect(output).toContain('KEYBINDINGS');
    expect(output).toContain('[↑ / ↓]');
    expect(output).toContain('Open the keybinding-help screen');
  });

  it('renders only the visible slice of keybindings', async () => {
    const store = createAppStore();
    store.getState().openHelp();
    const output = await renderToString(
      <KeybindingHelp useStore={store} visibleLines={3} />,
    );
    expect(output).toContain('[↑ / ↓]');
    expect(output).toContain('[Home / End]');
    expect(output).not.toContain('Open command entry');
  });
});
