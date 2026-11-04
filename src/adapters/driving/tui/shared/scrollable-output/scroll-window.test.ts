import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WRAP,
  adjustScrollOffset,
  computeLineRowCount,
  isAtOldestLine,
  isWrapped,
  resolveFullscreenScrollDirection,
  resolvePaneScrollDirection,
  sliceVisibleWindow,
  toggleAllWrapFlags,
  toggleWrapFlag,
} from './index.js';

const range = (count: number) => Array.from({ length: count }, (_, i) => i);
const rowCost = (width: number, wrap: boolean) => (line: string) => computeLineRowCount(line, width, wrap);

describe('sliceVisibleWindow — I/O matrix', () => {
  it('tail + truncate: the last N lines fill the budget, one row each', () => {
    const lines = range(500).map((i) => `line-${i}`);
    const window = sliceVisibleWindow(lines, 0, 20, rowCost(40, false));
    expect(window).toHaveLength(20);
    expect(window.at(0)).toBe('line-480');
    expect(window.at(-1)).toBe('line-499');
  });

  it('scrolled + wrap: the window ends `offset` lines from the tail, sized by wrapped row cost', () => {
    const lines = range(500).map((i) => `${i}:${'a'.repeat(70)}`); // ~2 rows each at width 40
    const window = sliceVisibleWindow(lines, 10, 20, rowCost(40, true));
    expect(window.at(-1)).toBe(lines[489]);
    const usedRows = window.reduce((sum, line) => sum + computeLineRowCount(line, 40, true), 0);
    expect(usedRows).toBeLessThanOrEqual(20);
    expect(window.length).toBeLessThan(20);
    expect(window.length).toBeGreaterThan(0);
  });

  it('an oversized line under wrap still renders (never a blank window)', () => {
    const lines = ['short', 'x'.repeat(5000)];
    expect(sliceVisibleWindow(lines, 0, 3, rowCost(10, true))).toEqual(['x'.repeat(5000)]);
  });

  it('empty input or a zero budget yields no lines', () => {
    expect(sliceVisibleWindow([], 0, 5)).toEqual([]);
    expect(sliceVisibleWindow(['a'], 0, 0)).toEqual([]);
  });
});

describe('adjustScrollOffset / isAtOldestLine', () => {
  it('clamps between the tail and the oldest line', () => {
    expect(adjustScrollOffset(0, 'down', 10)).toBe(0);
    expect(adjustScrollOffset(0, 'up', 10)).toBe(1);
    expect(adjustScrollOffset(9, 'up', 10)).toBe(9);
    expect(adjustScrollOffset(50, 'down', 10)).toBe(9);
    expect(adjustScrollOffset(3, 'up', 0)).toBe(0);
  });

  it('reports the oldest line, an empty region counting as oldest', () => {
    expect(isAtOldestLine(0, 0)).toBe(true);
    expect(isAtOldestLine(9, 10)).toBe(true);
    expect(isAtOldestLine(8, 10)).toBe(false);
  });
});

describe('scroll key resolution', () => {
  it('grid panes need ctrl, fullscreen does not', () => {
    expect(resolvePaneScrollDirection({ upArrow: true })).toBeNull();
    expect(resolvePaneScrollDirection({ ctrl: true, upArrow: true })).toBe('up');
    expect(resolvePaneScrollDirection({ ctrl: true, downArrow: true })).toBe('down');
    expect(resolveFullscreenScrollDirection({ upArrow: true })).toBe('up');
    expect(resolveFullscreenScrollDirection({ ctrl: true, downArrow: true })).toBe('down');
    expect(resolveFullscreenScrollDirection({})).toBeNull();
  });
});

describe('wrap flags', () => {
  it('defaults to truncate and toggles per key or for every key', () => {
    expect(DEFAULT_WRAP).toBe(false);
    expect(isWrapped({}, 'a')).toBe(false);
    expect(isWrapped({}, null)).toBe(false);
    const one = toggleWrapFlag({}, 'a');
    expect(isWrapped(one, 'a')).toBe(true);
    expect(isWrapped(one, 'b')).toBe(false);
    const all = toggleAllWrapFlags(one, ['a', 'b']);
    expect(all).toEqual({ a: false, b: true });
  });
});
