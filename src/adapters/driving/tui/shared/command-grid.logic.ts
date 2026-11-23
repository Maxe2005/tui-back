// tui/shared/command-grid.logic: the command bar's pure logic (no React/Ink components): query
// free-text entry, shell-style Tab completion, and the column-major command grid (grouping,
// width/scroll windowing, cursor movement). Split out of command-bar.tsx so the component only
// wires input and rendering.
import { type Key } from 'ink';
import { type Command } from '../commands/commands.js';
import { resolveBoundedVisibility } from './components/lists/bounded-list.js';


// A second `Tab` at the maximal common prefix must land within this window, on the same
// query, with no intervening key, to reveal the grid.
export const TAB_DOUBLE_PRESS_WINDOW_MS = 500;

// The default grid rows per column, user-overridable from the `:settings` Command Palette tab
// (store.settings.commandPalette.gridMaxRows); DEFAULT_SETTINGS holds the fallback value.

// Layout-only details: the gap rendered between adjacent grid columns and the width reserved
// for a truncation "…" marker on a hidden edge.
export const GRID_COLUMN_GAP = 1;
export const GRID_ELLIPSIS_WIDTH = 1;
// ModalDialog's own chrome (double border + padding on each side) plus a small safety margin,
// subtracted from the terminal's column count to get the grid's actual available width.
export const MODAL_CHROME_WIDTH = 6;
export const MIN_GRID_WIDTH = 10;

// Query free-text entry. Ctrl/meta combos (e.g. Ctrl+W resize-mode, reserved elsewhere in the
// app) and empty-input control keys (Tab/Enter/Esc/backspace — all handled separately by their
// own key flags) are never appended as literal characters. Mirrors
// repo-registry-screen.tsx's typeRootInputChar exactly.
export function typeCommandQueryChar(current: string, input: string, key: Pick<Key, 'ctrl' | 'meta'>): string {
  if (input.length === 0 || key.ctrl || key.meta) {
    return current;
  }
  return current + input;
}

export function backspaceCommandQuery(current: string): string {
  return current.slice(0, -1);
}

// Tab autocompletes only on an unambiguous single match; zero or 2+ matches leave the query
// untouched. Kept as its own pure function so the single-match branch stays directly
// unit-testable; resolveTabPress below delegates to it.
export function resolveTabAutocomplete(query: string, matches: readonly Command[]): string {
  return matches.length === 1 ? matches[0]!.name : query;
}

// Longest prefix shared by every match's name — "" when there are no matches or they share
// nothing. Used both to decide Tab's single-press completion target and, once the query is
// already sitting at that prefix, to detect the double-Tab-to-grid condition below.
export function longestCommonPrefix(matches: readonly Command[]): string {
  if (matches.length === 0) {
    return '';
  }
  let prefix = matches[0]!.name;
  for (const match of matches.slice(1)) {
    let i = 0;
    const max = Math.min(prefix.length, match.name.length);
    while (i < max && prefix[i] === match.name[i]) {
      i++;
    }
    prefix = prefix.slice(0, i);
    if (prefix === '') {
      break;
    }
  }
  return prefix;
}

// A stamped-then-checked value, not a timer: recorded on a Tab press that
// leaves the query unchanged (already at the maximal common prefix), and compared against
// `Date.now()` on the *next* Tab press to detect "same query, within the window".
export type TabPressState = { query: string; at: number };

export type TabResolution =
  | { kind: 'complete'; value: string }
  | { kind: 'show-grid' }
  | { kind: 'pending'; state: TabPressState }
  | { kind: 'noop' };

// Resolves a single Tab press against the current query/matches/pending state. Callers handle
// the empty-query case (Tab on empty input shows the full grid immediately) — this only covers
// a non-empty query (single match / longer common prefix / maximal-prefix first vs second
// press).
export function resolveTabPress(
  query: string,
  matches: readonly Command[],
  pending: TabPressState | null,
  now: number,
): TabResolution {
  if (matches.length === 1) {
    return { kind: 'complete', value: resolveTabAutocomplete(query, matches) };
  }
  if (matches.length === 0) {
    return { kind: 'noop' };
  }

  const prefix = longestCommonPrefix(matches);
  if (prefix.length > query.length) {
    return { kind: 'complete', value: prefix };
  }

  // Already at the maximal common prefix: a second Tab on the same query, within the window,
  // with the pending state still intact (any other key discards it before we ever get here),
  // reveals the grid. Anything else (first press, elapsed window, or a query the caller failed
  // to clear pending for) arms/re-arms the pending state instead.
  const isSecondPress =
    pending !== null &&
    pending.query === query &&
    now >= pending.at &&
    now - pending.at <= TAB_DOUBLE_PRESS_WINDOW_MS;
  if (isSecondPress) {
    return { kind: 'show-grid' };
  }
  return { kind: 'pending', state: { query, at: now } };
}

// Column-major grouping: column 0 holds the first `maxRows` matches, column 1 the next
// `maxRows`, and so on. Generic over `T` (commands, or filter-history query strings).
export function groupCommandsByColumn<T>(matches: readonly T[], maxRows: number): T[][] {
  const rows = Math.max(1, maxRows);
  const columns: T[][] = [];
  for (let i = 0; i < matches.length; i += rows) {
    columns.push(matches.slice(i, i + rows));
  }
  return columns;
}

// `top`/`bottom` are present only when a `verticalWindow` is passed to `layoutCommandGrid`
// (the filter-history grid inside LogFilterEditor); the command palette's `truncated` stays
// `{ left, right }`.
export type GridTruncation = { left: boolean; right: boolean; top?: boolean; bottom?: boolean };

export type CommandGridLayout<T> = {
  // Only the columns that actually fit `availableWidth` from `scrollOffset` onward — every
  // whole column, never a partial one.
  columns: readonly T[][];
  truncated: GridTruncation;
  // The (possibly clamped) horizontal scroll position this layout was actually computed from.
  scrollOffset: number;
  // The (possibly clamped) *vertical* scroll position within each column — 0 and inert unless
  // a `verticalWindow` was requested.
  rowScrollOffset: number;
};

// Requests vertical pagination on top of the horizontal one. `cursorRow` is the highlighted row
// *within whichever column owns the cursor* (an absolute index into that column's full array);
// the window centers on it once the tallest column exceeds `maxVisibleRows`, reusing
// bounded-list.tsx's `resolveBoundedVisibility` (which reserves rows for its indicators)
// rather than a second copy of the same budget/clamp math.
export type GridVerticalWindow = { maxVisibleRows: number; cursorRow: number };

// Exported so the filter-history browser (logs-zone.tsx) reuses the same column-width
// reduction instead of reimplementing it.
export function columnDisplayWidth<T>(column: readonly T[], getLabel: (item: T) => string): number {
  return column.reduce((max, item) => Math.max(max, getLabel(item).length), 0);
}

// Column-major layout + horizontal-scroll truncation: a column is as wide as its longest
// label; when the total exceeds the available width only whole columns that fit render, with a
// `…` marker on each edge that hides columns. `scrollOffset` is component-owned state passed in
// fresh each render, so this stays a stateless projection; the returned `scrollOffset` is the
// clamped value actually used. `getLabel` lets the filter-history grid reuse it over plain
// strings. A horizontal pass (`resolveHorizontalGrid`) runs first, then the optional
// vertical-windowing pass (`applyVerticalWindow`).
export function layoutCommandGrid<T>(
  matches: readonly T[],
  maxRows: number,
  availableWidth: number,
  getLabel: (item: T) => string,
  scrollOffset = 0,
  verticalWindow?: GridVerticalWindow,
): CommandGridLayout<T> {
  const allColumns = groupCommandsByColumn(matches, maxRows);
  const horizontal = resolveHorizontalGrid(allColumns, availableWidth, getLabel, scrollOffset);
  return applyVerticalWindow(horizontal, verticalWindow);
}

type HorizontalGridLayout<T> = {
  columns: readonly T[][];
  truncated: { left: boolean; right: boolean };
  scrollOffset: number;
};

function resolveHorizontalGrid<T>(
  allColumns: readonly T[][],
  availableWidth: number,
  getLabel: (item: T) => string,
  scrollOffset: number,
): HorizontalGridLayout<T> {
  if (allColumns.length === 0) {
    return { columns: [], truncated: { left: false, right: false }, scrollOffset: 0 };
  }

  const widths = allColumns.map((column) => columnDisplayWidth(column, getLabel));
  const totalWidth = widths.reduce((sum, width) => sum + width, 0) + GRID_COLUMN_GAP * (allColumns.length - 1);

  if (totalWidth <= availableWidth) {
    return { columns: allColumns, truncated: { left: false, right: false }, scrollOffset: 0 };
  }

  const maxStart = allColumns.length - 1;
  const start = Math.min(Math.max(scrollOffset, 0), maxStart);
  const leftReserve = start > 0 ? GRID_ELLIPSIS_WIDTH + GRID_COLUMN_GAP : 0;

  const widthFrom = (from: number, to: number): number => {
    let total = 0;
    for (let i = from; i <= to; i++) {
      total += widths[i]! + (i > from ? GRID_COLUMN_GAP : 0);
    }
    return total;
  };

  // Does the remainder from `start` to the last column fit without ever needing a right
  // ellipsis? If so we're at the true tail — no right truncation at all.
  const remainderWidth = widthFrom(start, allColumns.length - 1);
  if (leftReserve + remainderWidth <= availableWidth) {
    return {
      columns: allColumns.slice(start),
      truncated: { left: start > 0, right: false },
      scrollOffset: start,
    };
  }

  // A right ellipsis is unavoidable: reserve its width and greedily fit whole columns.
  const rightReserve = GRID_ELLIPSIS_WIDTH + GRID_COLUMN_GAP;
  const budget = availableWidth - leftReserve - rightReserve;
  let end = start;
  let used = widths[start]!;
  if (used <= budget) {
    for (let i = start + 1; i < allColumns.length; i++) {
      const next = used + GRID_COLUMN_GAP + widths[i]!;
      if (next > budget) {
        break;
      }
      used = next;
      end = i;
    }
  }
  // Never render zero columns, even when a single column can't fit the strict budget.

  return {
    columns: allColumns.slice(start, end + 1),
    truncated: { left: start > 0, right: end < allColumns.length - 1 },
    scrollOffset: start,
  };
}

// Mirrors the horizontal truncation/scroll above, but for rows within each already-selected
// column. A no-op (`rowScrollOffset: 0`) when no `verticalWindow` is requested or every column
// already fits. Reuses bounded-list.tsx's `resolveBoundedVisibility` (over a synthetic row-index
// array standing in for the tallest column), so the indicator lines count toward the budget:
// `columns[*].length + (top?1:0) + (bottom?1:0) <= maxVisibleRows`.
function applyVerticalWindow<T>(
  horizontal: HorizontalGridLayout<T>,
  verticalWindow: GridVerticalWindow | undefined,
): CommandGridLayout<T> {
  if (!verticalWindow) {
    return { ...horizontal, rowScrollOffset: 0 };
  }

  const tallest = horizontal.columns.reduce((max, column) => Math.max(max, column.length), 0);
  const rowIndices = Array.from({ length: tallest }, (_, i) => i);
  const visibility = resolveBoundedVisibility(rowIndices, verticalWindow.maxVisibleRows, verticalWindow.cursorRow);

  return {
    columns: horizontal.columns.map((column) => column.slice(visibility.scrollOffset, visibility.scrollOffset + visibility.visible.length)),
    truncated: { ...horizontal.truncated, top: visibility.hasMoreAbove, bottom: visibility.hasMoreBelow },
    scrollOffset: horizontal.scrollOffset,
    rowScrollOffset: visibility.scrollOffset,
  };
}

export type GridCursor = { column: number; row: number };

// Maps an arrow keypress to the direction moveGridCursorVertical/moveGridCursorHorizontal
// expect. A pure function so a swapped up/down or left/right mapping is unit-testable — the
// real COMMANDS registry rarely spans 2+ columns, so a real-keypress test could miss it.
export function resolveGridVerticalDirection(key: Pick<Key, 'upArrow' | 'downArrow'>): 'up' | 'down' {
  return key.upArrow ? 'up' : 'down';
}

export function resolveGridHorizontalDirection(key: Pick<Key, 'leftArrow' | 'rightArrow'>): 'left' | 'right' {
  return key.leftArrow ? 'left' : 'right';
}

// `Up`/`Down` move within a column, clamped to its row count; `Up` at row 0 returns null,
// signalling "leave the grid, focus back to the input". `Down` always resolves to a cursor —
// clamped, never null.
export function moveGridCursorVertical(
  cursor: GridCursor,
  direction: 'up' | 'down',
  columnLength: number,
): GridCursor | null {
  if (direction === 'up' && cursor.row === 0) {
    return null;
  }
  const next = direction === 'down' ? cursor.row + 1 : cursor.row - 1;
  const clampedLength = Math.max(columnLength, 1);
  return { column: cursor.column, row: Math.min(Math.max(next, 0), clampedLength - 1) };
}

export type GridHorizontalMove = { cursor: GridCursor; scrollOffset: number };

// `Left`/`Right` move to the adjacent column, same row index clamped to that column's length;
// at a hidden-column edge the visible window scrolls by exactly one column so the newly
// entered column stays in view. At the true first/last column this is a no-op (no wrapping).
export function moveGridCursorHorizontal(
  cursor: GridCursor,
  direction: 'left' | 'right',
  columnLengths: readonly number[],
  scrollOffset: number,
  visibleColumnCount: number,
): GridHorizontalMove {
  const totalColumns = columnLengths.length;
  const nextColumn = direction === 'right' ? cursor.column + 1 : cursor.column - 1;
  if (nextColumn < 0 || nextColumn >= totalColumns) {
    return { cursor, scrollOffset };
  }

  const length = columnLengths[nextColumn]!;
  const row = Math.min(cursor.row, Math.max(length - 1, 0));

  let nextScrollOffset = scrollOffset;
  if (nextColumn < scrollOffset) {
    nextScrollOffset = nextColumn;
  } else if (visibleColumnCount > 0 && nextColumn >= scrollOffset + visibleColumnCount) {
    nextScrollOffset = nextColumn - visibleColumnCount + 1;
  }

  return { cursor: { column: nextColumn, row }, scrollOffset: nextScrollOffset };
}

// Resolves the command under an absolute grid cursor position against the full (unsliced)
// column grouping — `cursor.column` is an absolute index, independent of the currently
// scrolled-into-view window.
export function commandAtGridCursor<T>(columns: readonly (readonly T[])[], cursor: GridCursor): T | undefined {
  return columns[cursor.column]?.[cursor.row];
}
