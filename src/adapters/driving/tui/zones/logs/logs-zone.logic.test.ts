import { describe, expect, it } from 'vitest';
import type { LogLine } from '../../../../../core/ports/docker.js';
import {
  DEFAULT_VISIBILITY_FLAGS,
  adjustScrollOffset,
  computeGridLayout,
  cycleLogsPaneFocus,
  filterVisibleLines,
  formatLogLine,
  isAtOldestLine,
  movePaneSubFocus,
  reindexPaneSubFocus,
  resolvePaneScrollDirection,
  resolveSelectAllAction,
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
    expect(isAtOldestLine(0, 0)).toBe(false);
  });
});

describe('resolvePaneScrollDirection', () => {
  it('requires ctrl — plain arrows are not a pane scroll', () => {
    expect(resolvePaneScrollDirection({ upArrow: true })).toBeNull();
    expect(resolvePaneScrollDirection({ ctrl: true, upArrow: true })).toBe('up');
    expect(resolvePaneScrollDirection({ ctrl: true, downArrow: true })).toBe('down');
  });

  it('returns null for ctrl + a non-arrow key', () => {
    expect(resolvePaneScrollDirection({ ctrl: true })).toBeNull();
  });
});

describe('resolveSelectAllAction', () => {
  it('Ctrl+A (no shift) is select-all', () => {
    expect(resolveSelectAllAction('a', { ctrl: true })).toBe('select-all');
  });

  it('Ctrl+Shift+A is deselect-all', () => {
    expect(resolveSelectAllAction('a', { ctrl: true, shift: true })).toBe('deselect-all');
    // Ink reports the shifted letter's own case too — still recognized regardless of case.
    expect(resolveSelectAllAction('A', { ctrl: true, shift: true })).toBe('deselect-all');
  });

  it('is null without ctrl, or for a different letter', () => {
    expect(resolveSelectAllAction('a', {})).toBeNull();
    expect(resolveSelectAllAction('b', { ctrl: true })).toBeNull();
  });
});

describe('resolveVisibilityToggleKey / toggleVisibilityFlag', () => {
  it('maps t/o/e to their own toggle, and anything else to null', () => {
    expect(resolveVisibilityToggleKey('t')).toBe('timestamp');
    expect(resolveVisibilityToggleKey('o')).toBe('stdout');
    expect(resolveVisibilityToggleKey('e')).toBe('stderr');
    expect(resolveVisibilityToggleKey('x')).toBeNull();
  });

  it('toggles only the targeted flag, independently of the others', () => {
    const flipped = toggleVisibilityFlag(DEFAULT_VISIBILITY_FLAGS, 'stdout');
    expect(flipped).toEqual({ showTimestamps: true, showStdout: false, showStderr: true });

    const flippedAgain = toggleVisibilityFlag(flipped, 'stdout');
    expect(flippedAgain).toEqual(DEFAULT_VISIBILITY_FLAGS);
  });
});

describe('filterVisibleLines', () => {
  const lines: LogLine[] = [
    { timestamp: 't1', stream: 'stdout', text: 'out' },
    { timestamp: 't2', stream: 'stderr', text: 'err' },
  ];

  it('drops stdout lines when showStdout is false', () => {
    expect(filterVisibleLines(lines, { showTimestamps: true, showStdout: false, showStderr: true })).toEqual([lines[1]]);
  });

  it('drops stderr lines when showStderr is false', () => {
    expect(filterVisibleLines(lines, { showTimestamps: true, showStdout: true, showStderr: false })).toEqual([lines[0]]);
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
});
