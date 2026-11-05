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
import { footerContextOf } from '../test-support/mount-for-test.js';
import { filterKeybindings, withSectionHeadings } from './keybinding-help.js';
import type { Keybinding } from '../../keybindings/index.js';

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

    const atBottom = resolveHelpWindow(KEYBINDINGS, KEYBINDINGS.length + 100, 10);
    expect(atBottom.visible.at(-1)?.keys).toBe(KEYBINDINGS.at(-1)?.keys);
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

  it('lists the Dashboard heal key with its description', async () => {
    const store = createAppStore();
    store.getState().openHelp();
    store.setState({ helpFilter: 'heal' });
    const output = await renderToString(<KeybindingHelp useStore={store} />, { columns: 160, rows: 40 });
    expect(output).toContain('[H (Dashboard)]');
    expect(output).toContain('Heal: restart services that are not up');
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

describe('KeybindingHelp footer context and grouping', () => {
  it('registers the help context while open and nothing while closed', async () => {
    const closed = createAppStore();
    expect(await footerContextOf(closed, <KeybindingHelp useStore={closed} />)).toBeUndefined();
    const open = createAppStore();
    open.getState().openHelp();
    expect(await footerContextOf(open, <KeybindingHelp useStore={open} />)).toBe('help');
  });

  it('puts one heading before the per-context rows, also when the window starts inside them', () => {
    const firstContext = KEYBINDINGS.findIndex((entry) => entry.section !== undefined);
    const around = withSectionHeadings(KEYBINDINGS.slice(firstContext - 1, firstContext + 3));
    expect(around.filter((item) => item.kind === 'heading')).toHaveLength(1);
    expect(around.findIndex((item) => item.kind === 'heading')).toBe(1);
    const inside = withSectionHeadings(KEYBINDINGS.slice(firstContext + 2, firstContext + 5));
    expect(inside[0]).toMatchObject({ kind: 'heading' });
    expect(withSectionHeadings(KEYBINDINGS.slice(0, 5)).some((item) => item.kind === 'heading')).toBe(false);
  });
});

describe('filterKeybindings', () => {
  const rows: Keybinding[] = [
    { keys: 'R', description: 'Restart the service' },
    { keys: 'Ctrl+O', description: 'Open in IDE' },
    { keys: 'Command entry', description: '[Tab] complete', section: 'Contexts' },
    { keys: 'Logs filter editor', description: '[Enter] apply', section: 'Contexts' },
  ];

  it('returns the rows themselves for an empty query', () => {
    expect(filterKeybindings(rows, '')).toBe(rows);
  });

  it('matches keys, description and section case-insensitively, keeping order', () => {
    expect(filterKeybindings(rows, 'ctrl+o').map((row) => row.keys)).toEqual(['Ctrl+O']);
    expect(filterKeybindings(rows, 'rEsT').map((row) => row.keys)).toEqual(['R']);
    expect(filterKeybindings(rows, 'CONTEXTS').map((row) => row.keys)).toEqual(['Command entry', 'Logs filter editor']);
    expect(filterKeybindings(rows, 'e').map((row) => row.keys)).toEqual(['R', 'Ctrl+O', 'Command entry', 'Logs filter editor']);
  });

  it('is a plain substring match, never a regex', () => {
    expect(filterKeybindings(rows, '.*')).toEqual([]);
    expect(filterKeybindings(rows, '[tab]').map((row) => row.keys)).toEqual(['Command entry']);
  });

  it('shows a section heading only when one of its rows matched', () => {
    expect(withSectionHeadings(filterKeybindings(rows, 'open')).some((item) => item.kind === 'heading')).toBe(false);
    const matched = withSectionHeadings(filterKeybindings(rows, 'apply'));
    expect(matched.map((item) => item.kind)).toEqual(['heading', 'row']);
  });
});

describe('resolveHelpScroll over a filtered list', () => {
  const noKey = { upArrow: false, downArrow: false, home: false, end: false, tab: false };
  // A fixed synthetic list, independent of the real KEYBINDINGS count.
  const rows: Keybinding[] = Array.from({ length: 20 }, (_, i) => ({ keys: `k${i}`, description: `row ${i}` }));

  it('clamps End and arrows to the given rows', () => {
    expect(resolveHelpScroll({ ...noKey, end: true }, 0, 5, rows)).toBe(15);
    expect(resolveHelpScroll({ ...noKey, downArrow: true }, 15, 5, rows)).toBe(15);
    expect(resolveHelpScroll({ ...noKey, upArrow: true }, 15, 5, rows)).toBe(14);
  });

  it('pages by the visible line count on PgDn/PgUp, clamped', () => {
    expect(resolveHelpScroll({ ...noKey, pageDown: true }, 0, 5, rows)).toBe(5);
    expect(resolveHelpScroll({ ...noKey, pageUp: true }, 7, 5, rows)).toBe(2);
    expect(resolveHelpScroll({ ...noKey, pageUp: true }, 2, 5, rows)).toBe(0);
    expect(resolveHelpScroll({ ...noKey, pageDown: true }, 14, 5, rows)).toBe(15);
  });

  it('stays at 0 on a list shorter than the window or empty', () => {
    expect(resolveHelpScroll({ ...noKey, pageDown: true }, 0, 5, rows.slice(0, 2))).toBe(0);
    expect(resolveHelpScroll({ ...noKey, end: true }, 0, 5, [])).toBe(0);
  });
});

describe('KeybindingHelp filter line', () => {
  const renderHelp = async (filter: string, size?: { columns: number; rows: number }) => {
    const store = createAppStore();
    store.getState().openHelp();
    store.getState().setHelpFilter(filter);
    return renderToString(<KeybindingHelp useStore={store} visibleLines={5} />, size);
  };

  it('shows a dim placeholder while the filter is empty', async () => {
    const output = await renderHelp('');
    expect(output).toContain('type to filter');
    expect(output).not.toContain('filter: ');
  });

  it('shows the filter text and only matching rows', async () => {
    const output = await renderHelp('command entry');
    expect(output).toContain('filter: command entry');
    expect(output).toContain('Open command entry');
    expect(output).not.toContain('[↑ / ↓]');
    expect(output).not.toContain('type to filter');
  });

  it('shows one no-match line and keeps the dialog height', async () => {
    const lines = (text: string) => text.split('\n').filter((line) => line.trim() !== '').length;
    const empty = await renderHelp('zzzz');
    expect(empty).toContain('no keybinding matches "zzzz"');
    expect(lines(empty)).toBe(lines(await renderHelp('')));
  });

  it('keeps a 200-char filter on one truncated line', async () => {
    const output = await renderHelp('q'.repeat(200), { columns: 60, rows: 30 });
    const filterLines = output.split('\n').filter((line) => line.includes('filter: '));
    expect(filterLines).toHaveLength(1);
    expect(filterLines[0]).toContain('…');
    for (const line of output.split('\n')) expect(Array.from(line).length).toBeLessThanOrEqual(60);
  });

  it('reopens with an empty filter', async () => {
    const store = createAppStore();
    store.getState().openHelp();
    store.getState().setHelpFilter('x');
    store.getState().closeHelp();
    store.getState().openHelp();
    const output = await renderToString(<KeybindingHelp useStore={store} visibleLines={5} />);
    expect(output).toContain('type to filter');
  });
});
