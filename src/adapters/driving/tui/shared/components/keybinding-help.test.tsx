import { describe, it, expect } from 'vitest';
import { KEYBINDINGS } from '../../keybindings/index.js';
import { createAppStore } from '../../store/app-store.js';
import {
  KeybindingHelp,
  clampHelpOffset,
  resolveHelpWindow,
} from './index.js';
import { renderToString } from './render-to-string.js';

describe('keybinding-help scroll window (AC3, UX-DR15)', () => {
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
    expect(window.visible[0].keys).toBe('j / k');
    expect(window.scrollOffset).toBe(0);
  });

  it('moves the visible slice down with j and up with k, clamped', () => {
    const down = resolveHelpWindow(KEYBINDINGS, 1, 10);
    expect(down.visible[0].keys).toBe('g / G');
    expect(down.scrollOffset).toBe(1);

    const atBottom = resolveHelpWindow(KEYBINDINGS, 100, 10);
    expect(atBottom.visible.at(-1)?.keys).toBe('d / e / u / l / r / s');
    expect(atBottom.scrollOffset).toBe(KEYBINDINGS.length - 10);

    const backUp = resolveHelpWindow(KEYBINDINGS, atBottom.scrollOffset - 1, 10);
    expect(backUp.scrollOffset).toBe(atBottom.scrollOffset - 1);
  });
});

describe('KeybindingHelp modal (AC2, AC3)', () => {
  it('renders the keybinding list while open and nothing when closed', async () => {
    const store = createAppStore();
    let output = await renderToString(<KeybindingHelp useStore={store} />);
    expect(output).not.toContain('KEYBINDINGS');

    store.getState().openHelp();
    output = await renderToString(<KeybindingHelp useStore={store} />);
    expect(output).toContain('KEYBINDINGS');
    expect(output).toContain('[j / k]');
    expect(output).toContain('Open the keybinding-help screen');
  });

  it('renders only the visible slice of keybindings (AC3)', async () => {
    const store = createAppStore();
    store.getState().openHelp();
    const output = await renderToString(
      <KeybindingHelp useStore={store} visibleLines={3} />,
    );
    expect(output).toContain('[j / k]');
    expect(output).toContain('[g / G]');
    expect(output).not.toContain('Open command entry');
  });
});
