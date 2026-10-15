// tui/shared/components/bounded-list: unit coverage for the shared scrollable-window primitive
// — the pure clamp/window helpers, the indicator-aware windowing on top of them, and the
// <BoundedList> component's rendered output.
import { describe, it, expect } from 'vitest';
import { Text } from 'ink';
import {
  BoundedList,
  capOlder,
  clampBoundedOffset,
  resolveBlockWindow,
  resolveBoundedVisibility,
  resolveBoundedWindow,
} from './bounded-list.js';
import { renderToString } from './render-to-string.js';

describe('clampBoundedOffset', () => {
  it('clamps negative and non-finite offsets to 0', () => {
    expect(clampBoundedOffset(-3, 10)).toBe(0);
    expect(clampBoundedOffset(Number.NaN, 10)).toBe(0);
    expect(clampBoundedOffset(Number.POSITIVE_INFINITY, 10)).toBe(0);
  });

  it('clamps offsets above the max to the max', () => {
    expect(clampBoundedOffset(12, 10)).toBe(10);
    expect(clampBoundedOffset(10, 10)).toBe(10);
  });

  it('clamps the max offset itself when non-finite or negative', () => {
    expect(clampBoundedOffset(5, Number.NaN)).toBe(0);
    expect(clampBoundedOffset(5, -1)).toBe(0);
  });
});

describe('resolveBoundedWindow', () => {
  const items = Array.from({ length: 20 }, (_, i) => `item-${i}`);

  it('resolves the visible slice for the given offset and line count', () => {
    const window = resolveBoundedWindow(items, 0, 5);
    expect(window.visible).toEqual(['item-0', 'item-1', 'item-2', 'item-3', 'item-4']);
    expect(window.scrollOffset).toBe(0);
  });

  it('clamps an out-of-range offset to the last full window', () => {
    const window = resolveBoundedWindow(items, 100, 5);
    expect(window.scrollOffset).toBe(15);
    expect(window.visible).toEqual(['item-15', 'item-16', 'item-17', 'item-18', 'item-19']);
  });
});

describe('resolveBoundedVisibility (NO_OVERFLOW / OVERFLOW)', () => {
  it('NO_OVERFLOW: renders every item with no indicator when everything already fits', () => {
    const items = ['a', 'b', 'c'];
    const result = resolveBoundedVisibility(items, 5, undefined);
    expect(result).toEqual({ visible: items, scrollOffset: 0, hasMoreAbove: false, hasMoreBelow: false });
  });

  it('OVERFLOW: anchors to the top with a "more below" indicator when there is no cursor to follow', () => {
    const items = Array.from({ length: 10 }, (_, i) => `item-${i}`);
    const result = resolveBoundedVisibility(items, 5, undefined);
    expect(result.hasMoreAbove).toBe(false);
    expect(result.hasMoreBelow).toBe(true);
    expect(result.visible).toEqual(['item-0', 'item-1', 'item-2', 'item-3']);
  });

  it('never renders more total rows (items + indicators) than the given budget', () => {
    const items = Array.from({ length: 50 }, (_, i) => `item-${i}`);
    for (const cursorIndex of [0, 5, 24, 49, undefined]) {
      const result = resolveBoundedVisibility(items, 6, cursorIndex);
      const totalRows = result.visible.length + (result.hasMoreAbove ? 1 : 0) + (result.hasMoreBelow ? 1 : 0);
      expect(totalRows).toBeLessThanOrEqual(6);
    }
  });

  // At the extreme end of the budget (1 or 2 total rows) the window must never show content
  // plus both indicators. Reachable via logs-zone.test.tsx's overflow test, where the hints
  // panel's budget computes to exactly 1. Asserted with and without a cursorIndex to follow
  // (without one the window anchors to the top, so only a "more below" indicator is ever
  // needed; with one it can land in the middle, where both directions are truncated).
  it('never exceeds a maxVisibleRows: 1 budget, with or without a cursorIndex', () => {
    const items = Array.from({ length: 20 }, (_, i) => `item-${i}`);
    for (const cursorIndex of [undefined, 0, 10, 19]) {
      const result = resolveBoundedVisibility(items, 1, cursorIndex);
      const totalRows = result.visible.length + (result.hasMoreAbove ? 1 : 0) + (result.hasMoreBelow ? 1 : 0);
      expect(totalRows).toBeLessThanOrEqual(1);
    }
  });

  it('never exceeds a maxVisibleRows: 2 budget, with or without a cursorIndex', () => {
    const items = Array.from({ length: 20 }, (_, i) => `item-${i}`);
    for (const cursorIndex of [undefined, 0, 10, 19]) {
      const result = resolveBoundedVisibility(items, 2, cursorIndex);
      const totalRows = result.visible.length + (result.hasMoreAbove ? 1 : 0) + (result.hasMoreBelow ? 1 : 0);
      expect(totalRows).toBeLessThanOrEqual(2);
    }
  });

  it('at maxVisibleRows: 1 with no cursorIndex, shows the first item with no indicator (content wins over chrome)', () => {
    const items = Array.from({ length: 20 }, (_, i) => `item-${i}`);
    const result = resolveBoundedVisibility(items, 1, undefined);
    expect(result.visible).toEqual(['item-0']);
    expect(result.hasMoreAbove).toBe(false);
    expect(result.hasMoreBelow).toBe(false);
  });

  it('keeps cursorIndex inside the visible window even after the second-pass budget shrink', () => {
    // The window must still contain cursorIndex after shrinking for a second indicator (e.g.
    // cursorIndex: 5 against an 8-item list, budget 3, must not render only item-4).
    const items = Array.from({ length: 8 }, (_, i) => `item-${i}`);
    const result = resolveBoundedVisibility(items, 3, 5);
    expect(result.visible).toContain('item-5');
  });

  it('centers the window on cursorIndex once scrolled, keeping the cursor row visible', () => {
    const items = Array.from({ length: 30 }, (_, i) => `item-${i}`);
    const result = resolveBoundedVisibility(items, 10, 15);
    const cursorPosition = result.scrollOffset;
    expect(15).toBeGreaterThanOrEqual(cursorPosition);
    expect(15).toBeLessThan(cursorPosition + result.visible.length);
    expect(result.hasMoreAbove).toBe(true);
  });

  it('shows a "more above" indicator only once scrolled past the first item', () => {
    const items = Array.from({ length: 10 }, (_, i) => `item-${i}`);
    expect(resolveBoundedVisibility(items, 5, 0).hasMoreAbove).toBe(false);
    expect(resolveBoundedVisibility(items, 5, 9).hasMoreAbove).toBe(true);
  });

  it('shows a "more below" indicator only while the last item is out of view', () => {
    const items = Array.from({ length: 10 }, (_, i) => `item-${i}`);
    expect(resolveBoundedVisibility(items, 10, 0).hasMoreBelow).toBe(false);
    expect(resolveBoundedVisibility(items, 5, 0).hasMoreBelow).toBe(true);
  });
});

describe('<BoundedList> rendering', () => {
  it('NO_OVERFLOW: renders every row and no indicator line when nothing overflows', async () => {
    const output = await renderToString(
      <BoundedList items={['alpha', 'beta', 'gamma']} maxVisibleRows={10} renderItem={(item) => <Text key={item}>{item}</Text>} />,
    );
    expect(output).toContain('alpha');
    expect(output).toContain('beta');
    expect(output).toContain('gamma');
    expect(output).not.toContain('more above');
    expect(output).not.toContain('more below');
  });

  it('OVERFLOW: hides rows past the budget and shows a "more below" indicator', async () => {
    const items = Array.from({ length: 10 }, (_, i) => `item-${i}`);
    const output = await renderToString(
      <BoundedList items={items} maxVisibleRows={4} renderItem={(item) => <Text key={item}>{item}</Text>} />,
    );
    expect(output).toContain('item-0');
    expect(output).not.toContain('item-9');
    expect(output).toContain('more below');
    expect(output).not.toContain('more above');
  });

  it('shows a "more above" indicator once the window is scrolled by following cursorIndex', async () => {
    const items = Array.from({ length: 10 }, (_, i) => `item-${i}`);
    const output = await renderToString(
      <BoundedList items={items} maxVisibleRows={4} cursorIndex={9} renderItem={(item) => <Text key={item}>{item}</Text>} />,
    );
    expect(output).toContain('item-9');
    expect(output).toContain('more above');
  });
});

describe('block window and older-hidden cap', () => {
  it('capOlder keeps the newest entries and counts the rest', () => {
    expect(capOlder([1, 2, 3, 4, 5], 2)).toEqual({ items: [4, 5], hidden: 3 });
    expect(capOlder([1], 5)).toEqual({ items: [1], hidden: 0 });
  });

  it('resolveBlockWindow never exceeds the budget, indicators included', () => {
    const heights = [3, 1, 2, 5, 1, 1, 4];
    for (let budget = 0; budget <= 20; budget += 1) {
      for (let cursor = 0; cursor < heights.length; cursor += 1) {
        const w = resolveBlockWindow(heights, budget, cursor);
        const shown = Math.min(heights.slice(w.start, w.end).reduce((a, b) => a + b, 0), w.contentRows);
        const used = shown + (w.hasAbove ? 1 : 0) + (w.hasBelow ? 1 : 0);
        expect(used).toBeLessThanOrEqual(Math.max(budget, 0));
        if (budget > 0) expect(w.end).toBeGreaterThan(w.start);
        if (w.start > 0 && budget > 2) expect(w.hasAbove).toBe(true);
        if (w.end < heights.length && budget > 1) expect(w.hasBelow).toBe(true);
      }
    }
  });

  it('keeps the cursor block visible when it fits', () => {
    const w = resolveBlockWindow([2, 2, 2, 2, 2, 2], 7, 4);
    expect(w.start).toBeLessThanOrEqual(4);
    expect(w.end).toBeGreaterThan(4);
  });

  it('still shows a cursor block taller than the budget, clipped, with indicators', () => {
    const w = resolveBlockWindow([2, 20, 2], 6, 1);
    expect(w.start).toBe(1);
    expect(w.end).toBe(2);
    expect(w.hasAbove).toBe(true);
    expect(w.hasBelow).toBe(true);
    expect(w.contentRows).toBe(4);
  });
});
