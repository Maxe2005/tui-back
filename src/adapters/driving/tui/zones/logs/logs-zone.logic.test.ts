import { describe, expect, it } from 'vitest';
import type { LogLine } from '../../../../../core/ports/docker.js';
import {
  DEFAULT_VISIBILITY_FLAGS,
  adjustScrollOffset,
  computeGridLayout,
  computeLineRowCount,
  cycleLogsPaneFocus,
  filterVisibleLines,
  formatLogLine,
  isAtOldestLine,
  isSelectAllKey,
  movePaneSubFocus,
  reindexPaneSubFocus,
  resolveFullscreenScrollDirection,
  resolvePaneScrollDirection,
  resolvePostLoadScrollOffset,
  resolveSelectAllToggle,
  resolveVisibilityToggleKey,
  sliceVisibleWindow,
  toggleVisibilityFlag,
} from './logs-zone.logic.js';

describe('cycleLogsPaneFocus', () => {
  it('cycles edt-list -> other-list -> panes -> edt-list', () => {
    expect(cycleLogsPaneFocus('edt-list')).toBe('other-list');
    expect(cycleLogsPaneFocus('other-list')).toBe('panes');
    expect(cycleLogsPaneFocus('panes')).toBe('edt-list');
  });
});

describe('computeGridLayout', () => {
  it('returns a 0x0 layout for zero panes', () => {
    expect(computeGridLayout(0, 100, 40)).toEqual({ rows: 0, cols: 0, cellWidth: 0, cellHeight: 0 });
  });

  it('picks a 1x1 grid for a single pane', () => {
    expect(computeGridLayout(1, 100, 40)).toEqual({ rows: 1, cols: 1, cellWidth: 100, cellHeight: 40 });
  });

  it('picks the squarest grid — ceil(sqrt(n)) columns', () => {
    // 2 panes -> ceil(sqrt(2)) = 2 cols, ceil(2/2) = 1 row
    expect(computeGridLayout(2, 100, 40)).toMatchObject({ cols: 2, rows: 1 });
    // 3 panes -> ceil(sqrt(3)) = 2 cols, ceil(3/2) = 2 rows
    expect(computeGridLayout(3, 100, 40)).toMatchObject({ cols: 2, rows: 2 });
    // 4 panes -> 2x2
    expect(computeGridLayout(4, 100, 40)).toMatchObject({ cols: 2, rows: 2 });
    // 5 panes -> ceil(sqrt(5)) = 3 cols, ceil(5/3) = 2 rows
    expect(computeGridLayout(5, 100, 40)).toMatchObject({ cols: 3, rows: 2 });
  });

  it('divides available width/height evenly across cols/rows, flooring to a whole cell', () => {
    const layout = computeGridLayout(4, 101, 41);
    expect(layout).toEqual({ rows: 2, cols: 2, cellWidth: 50, cellHeight: 20 });
  });

  it('never returns a cell smaller than 1, even for a pathological non-positive width/height', () => {
    expect(computeGridLayout(4, 0, 0)).toEqual({ rows: 2, cols: 2, cellWidth: 1, cellHeight: 1 });
    expect(computeGridLayout(4, -10, -10)).toEqual({ rows: 2, cols: 2, cellWidth: 1, cellHeight: 1 });
  });
});

describe('movePaneSubFocus', () => {
  // A 2x2 grid: [0 1]
  //             [2 3]
  it('moves right/left/up/down within a full grid', () => {
    expect(movePaneSubFocus(0, 'right', 2, 4)).toBe(1);
    expect(movePaneSubFocus(1, 'down', 2, 4)).toBe(3);
    expect(movePaneSubFocus(3, 'left', 2, 4)).toBe(2);
    expect(movePaneSubFocus(2, 'up', 2, 4)).toBe(0);
  });

  it('clamps at every edge — never wraps', () => {
    expect(movePaneSubFocus(0, 'left', 2, 4)).toBe(0);
    expect(movePaneSubFocus(0, 'up', 2, 4)).toBe(0);
    expect(movePaneSubFocus(1, 'right', 2, 4)).toBe(1);
    expect(movePaneSubFocus(3, 'down', 2, 4)).toBe(3);
  });

  it('clamps onto the last real pane on a short trailing grid row (3 panes in a 2-col grid)', () => {
    // Grid: [0 1]
    //       [2  ] (row 1 only has index 2)
    expect(movePaneSubFocus(0, 'down', 2, 3)).toBe(2);
    // Moving right from index 2 (only pane on its row) has nowhere real to land at col 1.
    expect(movePaneSubFocus(2, 'right', 2, 3)).toBe(2);
  });

  it('returns 0 for zero panes', () => {
    expect(movePaneSubFocus(0, 'right', 2, 0)).toBe(0);
  });
});

describe('reindexPaneSubFocus', () => {
  it('keeps the same index when it is still in range', () => {
    expect(reindexPaneSubFocus(1, 3)).toBe(1);
  });

  it('clamps down to the new last pane when the old index is now out of range', () => {
    expect(reindexPaneSubFocus(2, 1)).toBe(0);
    expect(reindexPaneSubFocus(5, 3)).toBe(2);
  });

  it('returns 0 when every pane is gone', () => {
    expect(reindexPaneSubFocus(2, 0)).toBe(0);
  });
});

describe('adjustScrollOffset / isAtOldestLine', () => {
  it('scrolling up increases the offset, capped at lineCount - 1', () => {
    expect(adjustScrollOffset(0, 'up', 5)).toBe(1);
    expect(adjustScrollOffset(4, 'up', 5)).toBe(4);
  });

  it('scrolling down decreases the offset, floored at 0', () => {
    expect(adjustScrollOffset(2, 'down', 5)).toBe(1);
    expect(adjustScrollOffset(0, 'down', 5)).toBe(0);
  });

  it('returns 0 for an empty buffer', () => {
    expect(adjustScrollOffset(3, 'up', 0)).toBe(0);
  });

  it('isAtOldestLine is true once the offset reaches lineCount - 1', () => {
    expect(isAtOldestLine(4, 5)).toBe(true);
    expect(isAtOldestLine(3, 5)).toBe(false);
  });

  it('isAtOldestLine is true for a genuinely empty pane too — its normal starting state, and the case that must still trigger the first scrollback fetch (review fix)', () => {
    expect(isAtOldestLine(0, 0)).toBe(true);
  });
});

describe('resolvePostLoadScrollOffset', () => {
  it('preserves the visible viewport when the pane already had lines before the fetch', () => {
    // 3 lines were on screen (offset 2 into a 3-line buffer); 4 older lines get prepended —
    // offset must grow by exactly the prepended count so the same lines stay in view.
    expect(resolvePostLoadScrollOffset(2, 3, 4, 7)).toBe(6);
  });

  it('falls back to the buffer-length delta when appended undercounts a live line that arrived mid-fetch', () => {
    expect(resolvePostLoadScrollOffset(1, 2, 1, 5)).toBe(4);
  });

  it('pins to 0 (the newest fetched line) when the pane started genuinely empty, instead of overshooting past every line just loaded', () => {
    expect(resolvePostLoadScrollOffset(0, 0, 4, 4)).toBe(0);
  });
});

describe('resolvePaneScrollDirection', () => {
  it('requires ctrl — plain arrows are not a pane scroll (the grid view: bare arrows already move sub-focus between panes)', () => {
    expect(resolvePaneScrollDirection({ upArrow: true })).toBeNull();
    expect(resolvePaneScrollDirection({ ctrl: true, upArrow: true })).toBe('up');
    expect(resolvePaneScrollDirection({ ctrl: true, downArrow: true })).toBe('down');
  });

  it('returns null for ctrl + a non-arrow key', () => {
    expect(resolvePaneScrollDirection({ ctrl: true })).toBeNull();
  });
});

describe('resolveFullscreenScrollDirection', () => {
  it('accepts a bare arrow — fullscreen has no sub-focus grid to disambiguate from (review fix)', () => {
    expect(resolveFullscreenScrollDirection({ upArrow: true })).toBe('up');
    expect(resolveFullscreenScrollDirection({ downArrow: true })).toBe('down');
  });

  it('also accepts Ctrl+arrow, so existing muscle memory keeps working', () => {
    expect(resolveFullscreenScrollDirection({ upArrow: true, ctrl: true })).toBe('up');
  });

  it('returns null for a non-arrow key', () => {
    expect(resolveFullscreenScrollDirection({})).toBeNull();
  });
});

describe('isSelectAllKey', () => {
  it('is true for Ctrl+A, case-insensitively', () => {
    expect(isSelectAllKey('a', { ctrl: true })).toBe(true);
    expect(isSelectAllKey('A', { ctrl: true })).toBe(true);
  });

  it('is false without ctrl, or for a different letter', () => {
    expect(isSelectAllKey('a', {})).toBe(false);
    expect(isSelectAllKey('b', { ctrl: true })).toBe(false);
  });
});

describe('resolveSelectAllToggle', () => {
  // Review fix, user-reported: Ctrl+Shift+A (the old, separate deselect-all shortcut) is
  // unreachable on virtually every real terminal — Ctrl+letter combos never carry shift
  // information at the byte level. One shortcut now does both, based on current selection.
  it('resolves to select-all when not everything is currently selected', () => {
    expect(resolveSelectAllToggle(['/a', '/b'], [])).toBe('select-all');
    expect(resolveSelectAllToggle(['/a', '/b'], ['/a'])).toBe('select-all');
  });

  it('resolves to deselect-all once every listed path is already selected', () => {
    expect(resolveSelectAllToggle(['/a', '/b'], ['/a', '/b'])).toBe('deselect-all');
    // Extra, unrelated selections elsewhere don't prevent this — only the listed paths matter.
    expect(resolveSelectAllToggle(['/a', '/b'], ['/a', '/b', '/c'])).toBe('deselect-all');
  });

  it('resolves to select-all (a harmless no-op) for an empty list', () => {
    expect(resolveSelectAllToggle([], [])).toBe('select-all');
  });
});

describe('resolveVisibilityToggleKey / toggleVisibilityFlag', () => {
  it('maps t/o/p/w to their own toggle, and anything else (including the old "e" binding) to null', () => {
    expect(resolveVisibilityToggleKey('t')).toBe('timestamp');
    expect(resolveVisibilityToggleKey('o')).toBe('stdout');
    expect(resolveVisibilityToggleKey('p')).toBe('stderr');
    expect(resolveVisibilityToggleKey('w')).toBe('wrap');
    // 'e' was freed up (review fix) — it collided with the Edts zone's own tab mnemonic.
    expect(resolveVisibilityToggleKey('e')).toBeNull();
    expect(resolveVisibilityToggleKey('x')).toBeNull();
  });

  it('toggles only the targeted flag, independently of the others', () => {
    const flipped = toggleVisibilityFlag(DEFAULT_VISIBILITY_FLAGS, 'stdout');
    expect(flipped).toEqual({ showTimestamps: true, showStdout: false, showStderr: true, wrapLines: false });

    const flippedAgain = toggleVisibilityFlag(flipped, 'stdout');
    expect(flippedAgain).toEqual(DEFAULT_VISIBILITY_FLAGS);
  });

  it('toggles wrapLines independently of the show* flags', () => {
    const flipped = toggleVisibilityFlag(DEFAULT_VISIBILITY_FLAGS, 'wrap');
    expect(flipped).toEqual({ showTimestamps: true, showStdout: true, showStderr: true, wrapLines: true });
  });
});

describe('filterVisibleLines', () => {
  const lines: LogLine[] = [
    { timestamp: 't1', stream: 'stdout', text: 'out' },
    { timestamp: 't2', stream: 'stderr', text: 'err' },
  ];

  it('drops stdout lines when showStdout is false', () => {
    expect(filterVisibleLines(lines, { showTimestamps: true, showStdout: false, showStderr: true, wrapLines: false })).toEqual([lines[1]]);
  });

  it('drops stderr lines when showStderr is false', () => {
    expect(filterVisibleLines(lines, { showTimestamps: true, showStdout: true, showStderr: false, wrapLines: false })).toEqual([lines[0]]);
  });

  it('keeps everything when both are shown', () => {
    expect(filterVisibleLines(lines, DEFAULT_VISIBILITY_FLAGS)).toEqual(lines);
  });
});

describe('formatLogLine', () => {
  it('prefixes the timestamp when showTimestamps is true, omits it otherwise', () => {
    const line: LogLine = { timestamp: '2026-01-01T00:00:00.000Z', stream: 'stdout', text: 'hello' };
    expect(formatLogLine(line, true)).toBe('[2026-01-01T00:00:00.000Z] hello');
    expect(formatLogLine(line, false)).toBe('hello');
  });
});

describe('sliceVisibleWindow', () => {
  const values = [1, 2, 3, 4, 5];

  it('returns the last visibleCount values when offset is 0 (pinned to the tail)', () => {
    expect(sliceVisibleWindow(values, 0, 2)).toEqual([4, 5]);
  });

  it('shifts the window back by offset lines', () => {
    expect(sliceVisibleWindow(values, 2, 2)).toEqual([2, 3]);
  });

  it('never returns fewer than what is available at the buffer start', () => {
    expect(sliceVisibleWindow(values, 4, 3)).toEqual([1]);
  });

  it('returns an empty array for an empty buffer or a non-positive visibleCount', () => {
    expect(sliceVisibleWindow([], 0, 5)).toEqual([]);
    expect(sliceVisibleWindow(values, 0, 0)).toEqual([]);
  });

  it('packs more short (1-row) lines into the same row budget than long (multi-row) ones — the fix for "w" leaving a blank gap', () => {
    // 5 short lines, each costing 1 row: a 4-row budget fits 4 of them.
    const shortRowCost = () => 1;
    expect(sliceVisibleWindow(values, 0, 4, shortRowCost)).toEqual([2, 3, 4, 5]);

    // Same 5 lines, but each now costs 2 rows (e.g. wrapped): the same 4-row budget only fits 2.
    const longRowCost = () => 2;
    expect(sliceVisibleWindow(values, 0, 4, longRowCost)).toEqual([4, 5]);
  });

  it('still renders the single oldest line even when its own row cost alone exceeds the budget', () => {
    expect(sliceVisibleWindow(values, 0, 1, () => 5)).toEqual([5]);
  });
});

describe('computeLineRowCount', () => {
  it('always costs exactly 1 row when wrap is off, regardless of length', () => {
    expect(computeLineRowCount('a'.repeat(200), 40, false)).toBe(1);
    expect(computeLineRowCount('', 40, false)).toBe(1);
  });

  it('costs ceil(length / width) rows when wrap is on', () => {
    expect(computeLineRowCount('a'.repeat(80), 40, true)).toBe(2);
    expect(computeLineRowCount('a'.repeat(81), 40, true)).toBe(3);
    expect(computeLineRowCount('short', 40, true)).toBe(1);
  });

  it('floors at 1 row even for an empty line under wrap', () => {
    expect(computeLineRowCount('', 40, true)).toBe(1);
  });
});
