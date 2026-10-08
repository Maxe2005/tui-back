import { describe, expect, it } from 'vitest';
import {
  MIN_PANE_COLUMNS,
  MIN_TERMINAL_COLUMNS,
  MIN_TERMINAL_ROWS,
  formatTooSmallMessage,
  isTerminalTooSmall,
  resolvePaneSplit,
} from './bounds.js';

describe('terminal minimum', () => {
  it('flags either dimension below the named constants', () => {
    expect(isTerminalTooSmall(MIN_TERMINAL_COLUMNS, MIN_TERMINAL_ROWS)).toBe(false);
    expect(isTerminalTooSmall(MIN_TERMINAL_COLUMNS - 1, 40)).toBe(true);
    expect(isTerminalTooSmall(120, MIN_TERMINAL_ROWS - 1)).toBe(true);
  });

  it('names the need and the current size', () => {
    expect(formatTooSmallMessage(30, 8)).toBe('Terminal too small — need at least 40×12 (now 30×8)');
  });
});

describe('resolvePaneSplit', () => {
  it('leaves the ratio untouched when both panes clear the minimum', () => {
    expect(resolvePaneSplit(120, 0.4, MIN_PANE_COLUMNS).adjustedRatio).toBeNull();
  });

  it('lifts a sliver pane to the minimum', () => {
    const split = resolvePaneSplit(40, 0.2, MIN_PANE_COLUMNS);
    expect(split.first).toBe(MIN_PANE_COLUMNS);
    expect(split.first + split.second).toBe(39);
  });

  it('splits evenly when the total cannot hold two minimums', () => {
    const split = resolvePaneSplit(20, 0.8, MIN_PANE_COLUMNS);
    expect(split.first + split.second).toBe(19);
    expect(Math.abs(split.first - split.second)).toBeLessThanOrEqual(1);
  });
});
