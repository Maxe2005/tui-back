// tui/shared/components/bounded-list: the shared scrollable-window primitive. Any list that
// can outgrow the terminal renders through it: Ink's diff-render desyncs from the real cursor
// and corrupts painted lines when content exceeds the terminal's rows. `maxVisibleRows` is a
// total budget including the dim "more above/below" lines; `cursorIndex` keeps a selected row
// visible. Scroll state is never owned here — callers recompute it from useWindowSize().
import { Box, Text } from 'ink';
import type { ReactNode } from 'react';
import { colors } from '../theme/theme.js';

export function clampBoundedOffset(offset: number, maxOffset: number): number {
  const safeOffset = Number.isFinite(offset) ? Math.floor(offset) : 0;
  const safeMax = Number.isFinite(maxOffset) ? Math.max(0, Math.floor(maxOffset)) : 0;
  if (safeOffset < 0) return 0;
  if (safeOffset > safeMax) return safeMax;
  return safeOffset;
}

export function resolveBoundedWindow<T>(
  items: readonly T[],
  scrollOffset: number,
  visibleLines: number,
): { visible: readonly T[]; scrollOffset: number } {
  const safeLines = Number.isFinite(visibleLines) ? Math.max(0, Math.floor(visibleLines)) : 0;
  const maxOffset = Math.max(0, items.length - safeLines);
  const offset = clampBoundedOffset(scrollOffset, maxOffset);
  return {
    visible: items.slice(offset, offset + safeLines),
    scrollOffset: offset,
  };
}

export type BoundedListVisibility<T> = {
  visible: readonly T[];
  scrollOffset: number;
  hasMoreAbove: boolean;
  hasMoreBelow: boolean;
};

// The component's own windowing on top of resolveBoundedWindow: `maxVisibleRows` is a *total*
// row budget (items + indicator lines), not an item-only count.
//
//
// Two passes, then an affordability guard: `rawOffset` is recomputed against whichever
// `itemRows` is actually used (so the window keeps `cursorIndex`), and an indicator only gets a
// row that is still left once `visible.length` is settled. That guarantees
// `visible.length + (hasMoreAbove?1:0) + (hasMoreBelow?1:0) <= maxVisibleRows` for every
// `maxVisibleRows >= 0`, including the extreme 1/2-row budgets.
export function resolveBoundedVisibility<T>(
  items: readonly T[],
  maxVisibleRows: number,
  cursorIndex: number | undefined,
): BoundedListVisibility<T> {
  const totalBudget = Number.isFinite(maxVisibleRows) ? Math.max(0, Math.floor(maxVisibleRows)) : 0;
  if (items.length <= totalBudget) {
    return { visible: items, scrollOffset: 0, hasMoreAbove: false, hasMoreBelow: false };
  }
  if (totalBudget <= 0) {
    // No room for content or an indicator at all — never overshoot a zero (or negative,
    // already clamped to zero) budget.
    return { visible: [], scrollOffset: 0, hasMoreAbove: false, hasMoreBelow: false };
  }

  // First pass: reserve exactly 1 row for the indicator that's always needed once we're
  // overflowing (there's always at least one truncated end).
  let itemRows = Math.max(1, totalBudget - 1);
  let rawOffset = cursorIndex !== undefined ? cursorIndex - Math.floor(itemRows / 2) : 0;
  let window = resolveBoundedWindow(items, rawOffset, itemRows);

  // Second pass: the window needs indicators on *both* ends (cursor-follow pushed it away from
  // the true top) — reserve a second row too, shrinking all the way to 0 content rows if the
  // budget is that tight. `rawOffset` is recomputed against the smaller `itemRows` so the
  // window still centers on (and keeps) `cursorIndex`, rather than drifting away from it.
  const firstPassNeedsBoth = window.scrollOffset > 0 && window.scrollOffset + window.visible.length < items.length;
  if (firstPassNeedsBoth && itemRows > 0) {
    itemRows = itemRows - 1;
    rawOffset = cursorIndex !== undefined ? cursorIndex - Math.floor(itemRows / 2) : 0;
    window = resolveBoundedWindow(items, rawOffset, itemRows);
  }

  const wantsAbove = window.scrollOffset > 0;
  const wantsBelow = window.scrollOffset + window.visible.length < items.length;
  // Final affordability guard: caps the indicators actually shown to whatever's left of the
  // budget after content, regardless of how `itemRows` above was chosen — this is the step that
  // actually enforces the invariant for every budget, including the extreme `maxVisibleRows`
  // 1/2 cases where even the single row reserved above doesn't leave room for a second
  // indicator (content wins over chrome at that extreme; "below" is favored over "above" when
  // only one of the two fits).
  let indicatorRowsLeft = Math.max(0, totalBudget - window.visible.length);
  let hasMoreBelow = false;
  let hasMoreAbove = false;
  if (wantsBelow && indicatorRowsLeft > 0) {
    hasMoreBelow = true;
    indicatorRowsLeft -= 1;
  }
  if (wantsAbove && indicatorRowsLeft > 0) {
    hasMoreAbove = true;
    indicatorRowsLeft -= 1;
  }

  return {
    visible: window.visible,
    scrollOffset: window.scrollOffset,
    hasMoreAbove,
    hasMoreBelow,
  };
}

export type BoundedListProps<T> = {
  items: readonly T[];
  // Total row budget for this list, indicator lines included — callers derive it live from
  // useWindowSize() so it follows every resize.
  maxVisibleRows: number;
  // Renders one row; the returned element carries its own `key` (every existing call site
  // already keys its rows this way — e.g. `<Box key={service.path} ...>`).
  renderItem: (item: T, index: number) => ReactNode;
  // The row that must stay visible (a list's own selection cursor) — omitted for a list with
  // no such concept (a static hints panel), which then always anchors to the top.
  cursorIndex?: number;
  moreAboveLabel?: string;
  moreBelowLabel?: string;
};

export function BoundedList<T>({
  items,
  maxVisibleRows,
  renderItem,
  cursorIndex,
  moreAboveLabel = 'more above',
  moreBelowLabel = 'more below',
}: BoundedListProps<T>) {
  const { visible, scrollOffset, hasMoreAbove, hasMoreBelow } = resolveBoundedVisibility(items, maxVisibleRows, cursorIndex);
  return (
    <Box flexDirection="column">
      {hasMoreAbove ? <Text color={colors['text-dim']}>▲ {moreAboveLabel}</Text> : null}
      {visible.map((item, index) => renderItem(item, scrollOffset + index))}
      {hasMoreBelow ? <Text color={colors['text-dim']}>▼ {moreBelowLabel}</Text> : null}
    </Box>
  );
}
