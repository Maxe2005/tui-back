// tui/shared/command-bar: story 2.14's `:` command-entry bar, reworked by story 2.17 into
// shell-style Tab-completion. A `modal-dialog` + text input; nothing else renders until `Tab`
// is pressed. `Tab` on an empty input reveals the full command grid immediately; on a
// non-empty input it completes to a single match, completes to a longer shared prefix across
// 2+ matches, or — once already sitting at that maximal prefix — arms a `TabPressState` that a
// second `Tab` within `TAB_DOUBLE_PRESS_WINDOW_MS` (same query, no intervening key) resolves
// into the grid. The grid is a column-major, arrow-navigable browser (UX-DR30): `Down` from
// the input enters it top-of-first-column, `Up`/`Down` move within a column, `Left`/`Right`
// hop columns (scrolling the visible window by one column at a hidden edge), `Enter` completes
// to the highlighted cell and returns focus to the input, any printable character (or
// backspace — see the spec's "Ask First" resolution) returns to the input and collapses the
// grid, and `Esc` closes the whole bar regardless of which side has focus.
//
// Self-contained `useInput` (mirrors repo-registry-screen.tsx's phase-dispatch shape): typing,
// filtering, Tab-autocomplete/double-Tab-grid, grid navigation, Enter-run/unknown-message, and
// Esc-cancel are all handled here, not routed through AppShell's central useInput callback —
// AppShell only tracks the single `commandBarOpen` boolean that mounts/unmounts this component.
//
// Testability convention (render-to-string.tsx): the shared renderToString harness's fake
// stdin never emits data, so a useInput callback itself is never invoked by any test using
// that harness — every key-handling decision below is a pure, directly-testable function;
// useInput only interprets the raw Ink Key and dispatches the pure result (mirrors
// repo-registry-screen.tsx's typeRootInputChar/backspaceRootInput and
// edts-zone.tsx's resolveSelectionDirection/moveSelection). Real-keypress coverage lives in
// app-shell.interaction.test.tsx, same as Story 2.12's Left/Right coverage.
import { useState } from 'react';
import { Box, Text, useInput, useWindowSize, type Key } from 'ink';
import { ModalDialog } from './components/modal-dialog.js';
import { colors } from './theme/theme.js';
import { useAppStore, type AppStore } from '../store/app-store.js';
import { COMMANDS, matchCommands, findExactCommand, type Command } from '../commands/commands.js';

// A second `Tab` at the maximal common prefix must land within this window, on the same
// query, with no intervening key, to reveal the grid (Boundaries: "TAB_DOUBLE_PRESS_WINDOW_MS
// (500ms, named constant)"). Colocated with its single consumer, mirroring
// adapters/driven/lock/index.ts's ORPHAN_STALE_AGE_MS convention.
export const TAB_DOUBLE_PRESS_WINDOW_MS = 500;

// Story 2.19: the default grid-rows-per-column value, now user-overridable via the
// `:settings` screen's Command Palette tab (store.settings.commandPalette.gridMaxRows) — this
// constant survives only as DEFAULT_SETTINGS.commandPalette.gridMaxRows (core/ports/settings.ts),
// the single source of truth an unwired/pre-first-load store still falls back to.

// Layout-only implementation details (not named by the spec): the gap rendered between
// adjacent grid columns and the width reserved for a truncation "…" marker on a hidden edge.
const GRID_COLUMN_GAP = 1;
const GRID_ELLIPSIS_WIDTH = 1;
// ModalDialog's own chrome (double border + padding on each side) plus a small safety margin,
// subtracted from the terminal's column count to get the grid's actual available width.
const MODAL_CHROME_WIDTH = 6;
const MIN_GRID_WIDTH = 10;

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
// untouched. Extracted as its own pure function (kept exactly as story 2.14 shipped it) so the
// single-match branch stays directly unit-testable; resolveTabPress below delegates to it.
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

// A stamped-then-checked value, not a timer (Design Notes): recorded on a Tab press that
// leaves the query unchanged (already at the maximal common prefix), and compared against
// `Date.now()` on the *next* Tab press to detect "same query, within the window".
export type TabPressState = { query: string; at: number };

export type TabResolution =
  | { kind: 'complete'; value: string }
  | { kind: 'show-grid' }
  | { kind: 'pending'; state: TabPressState }
  | { kind: 'noop' };

// Resolves a single Tab press against the current query/matches/pending state. Callers are
// responsible for the empty-query special case (Boundaries: "Tab on empty input shows the
// full grid immediately, no double-press needed") — this function only covers the non-empty
// I/O matrix rows (single match / longer common prefix / maximal-prefix first vs second press).
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
// `maxRows`, and so on (Boundaries: "column-major, ≤ COMMAND_GRID_MAX_ROWS rows/column").
export function groupCommandsByColumn(
  matches: readonly Command[],
  maxRows: number,
): Command[][] {
  const rows = Math.max(1, maxRows);
  const columns: Command[][] = [];
  for (let i = 0; i < matches.length; i += rows) {
    columns.push(matches.slice(i, i + rows));
  }
  return columns;
}

export type GridTruncation = { left: boolean; right: boolean };

export type CommandGridLayout = {
  // Only the columns that actually fit `availableWidth` from `scrollOffset` onward — every
  // whole column, never a partial one (Boundaries: "only whole columns that fit render").
  columns: readonly Command[][];
  truncated: GridTruncation;
  // The (possibly clamped) scroll position this layout was actually computed from.
  scrollOffset: number;
};

function columnDisplayWidth(column: readonly Command[]): number {
  return column.reduce((max, command) => Math.max(max, command.name.length), 0);
}

// Column-major layout + horizontal-scroll truncation (Boundaries: "column width = its longest
// label; when total width exceeds available width, only whole columns that fit render, with a
// `…` marker on whichever edge(s) hide columns"). `scrollOffset` is state the component owns
// (Design Notes) — passed in fresh each render alongside `matches`/`maxRows`/`availableWidth`
// so this stays a stateless projection; the returned `scrollOffset` is the clamped value the
// layout was actually computed from.
export function layoutCommandGrid(
  matches: readonly Command[],
  maxRows: number,
  availableWidth: number,
  scrollOffset = 0,
): CommandGridLayout {
  const allColumns = groupCommandsByColumn(matches, maxRows);
  if (allColumns.length === 0) {
    return { columns: [], truncated: { left: false, right: false }, scrollOffset: 0 };
  }

  const widths = allColumns.map(columnDisplayWidth);
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

export type GridCursor = { column: number; row: number };

// Maps an arrow keypress to the direction moveGridCursorVertical/moveGridCursorHorizontal
// expect. Extracted from useInput's inline ternaries (review fix, story 2.17) so a swapped
// up/down or left/right mapping is directly unit-testable — the real COMMANDS registry never
// spans 2+ columns, so a swapped left/right ternary in particular would otherwise be
// unreachable by any real-keypress test.
export function resolveGridVerticalDirection(key: Pick<Key, 'upArrow' | 'downArrow'>): 'up' | 'down' {
  return key.upArrow ? 'up' : 'down';
}

export function resolveGridHorizontalDirection(key: Pick<Key, 'leftArrow' | 'rightArrow'>): 'left' | 'right' {
  return key.leftArrow ? 'left' : 'right';
}

// `Up`/`Down` move within a column, clamped to its row count; `Up` at row 0 returns null,
// signalling "leave the grid, focus back to the input" (Boundaries: "Up at row 0 → back to
// input"). `Down` always resolves to a cursor — clamped, never null.
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
// entered column stays in view. At the true first/last column, this is a no-op (Boundaries
// doesn't describe wrapping).
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
export function commandAtGridCursor(
  columns: readonly (readonly Command[])[],
  cursor: GridCursor,
): Command | undefined {
  return columns[cursor.column]?.[cursor.row];
}

export type CommandBarProps = {
  useStore?: AppStore;
  onClose: () => void;
};

export function CommandBar({ useStore = useAppStore, onClose }: CommandBarProps) {
  // Story 2.19: read live from the store (settings screen's Command Palette tab) instead of
  // the retired COMMAND_GRID_MAX_ROWS constant.
  const gridMaxRows = useStore((state) => state.settings.commandPalette.gridMaxRows);
  const [query, setQuery] = useState('');
  const [unknownCommand, setUnknownCommand] = useState(false);
  const [pending, setPending] = useState<TabPressState | null>(null);
  // Whether the grid has been revealed at all this session (Tab on empty input, or a resolved
  // double-Tab). Actual visibility also depends on there still being 2+ live matches — see
  // `gridVisible` below (Boundaries: "re-filter it live ... hiding it again once only one
  // match remains").
  const [gridShown, setGridShown] = useState(false);
  const [focus, setFocus] = useState<'input' | 'grid'>('input');
  const [gridCursor, setGridCursor] = useState<GridCursor>({ column: 0, row: 0 });
  const [scrollOffset, setScrollOffset] = useState(0);

  const matches = matchCommands(query, COMMANDS);
  const gridVisible = gridShown && matches.length > 1;

  const { columns: terminalColumns } = useWindowSize();
  const availableWidth = Math.max(terminalColumns - MODAL_CHROME_WIDTH, MIN_GRID_WIDTH);
  const allColumns = groupCommandsByColumn(matches, gridMaxRows);
  const layout = layoutCommandGrid(matches, gridMaxRows, availableWidth, scrollOffset);

  const openGridAtOrigin = () => {
    setGridShown(true);
    setGridCursor({ column: 0, row: 0 });
    setScrollOffset(0);
    setPending(null);
  };

  // Shared exit path back to the input from grid focus, used by both "any printable
  // character" and (per the spec's Ask-First resolution) backspace: focus returns to the
  // input and the grid collapses entirely — a fresh Tab is required to bring it back.
  const exitGridToInput = () => {
    setFocus('input');
    setGridShown(false);
    setUnknownCommand(false);
  };

  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }

    if (focus === 'grid') {
      if (key.return) {
        const command = commandAtGridCursor(allColumns, gridCursor);
        if (command) {
          setQuery(command.name);
        }
        setFocus('input');
        return;
      }

      if (key.upArrow || key.downArrow) {
        const columnLength = allColumns[gridCursor.column]?.length ?? 0;
        const next = moveGridCursorVertical(gridCursor, resolveGridVerticalDirection(key), columnLength);
        if (next === null) {
          setFocus('input');
        } else {
          setGridCursor(next);
        }
        return;
      }

      if (key.leftArrow || key.rightArrow) {
        const columnLengths = allColumns.map((column) => column.length);
        const { cursor, scrollOffset: nextScrollOffset } = moveGridCursorHorizontal(
          gridCursor,
          resolveGridHorizontalDirection(key),
          columnLengths,
          layout.scrollOffset,
          layout.columns.length,
        );
        setGridCursor(cursor);
        setScrollOffset(nextScrollOffset);
        return;
      }

      if (key.backspace || key.delete) {
        exitGridToInput();
        setQuery((current) => backspaceCommandQuery(current));
        return;
      }

      // Tab has no defined meaning while browsing the grid (Boundaries only enumerates
      // Up/Down/Left/Right/Enter/printable/Esc). Ink already reports empty `input` for Tab
      // (parse-keypress.js's `nonAlphanumericKeys`), so falling through to the printable-char
      // branch below is already a no-op in practice — this guard makes that explicit rather
      // than relying on an un-asserted upstream detail (review fix), matching the conservative
      // no-op already used at grid edges (Left/Right at the first/last column).
      if (key.tab) {
        return;
      }

      const nextQuery = typeCommandQueryChar(query, input, key);
      if (nextQuery !== query) {
        exitGridToInput();
        setQuery(nextQuery);
      }
      return;
    }

    // focus === 'input'. Any key other than Tab discards a pending double-Tab state
    // (Boundaries: "any other key ... discards the pending state").
    if (!key.tab && pending !== null) {
      setPending(null);
    }

    if (key.return) {
      const exact = findExactCommand(query, COMMANDS);
      if (exact) {
        exact.run(useStore, query);
        onClose();
      } else {
        setUnknownCommand(true);
      }
      return;
    }

    if (key.tab) {
      if (query === '') {
        // Nothing to complete — reveal the full grid immediately, no double-press needed.
        openGridAtOrigin();
        return;
      }

      const resolution = resolveTabPress(query, matches, pending, Date.now());
      if (resolution.kind === 'complete') {
        setQuery(resolution.value);
        setPending(null);
        setUnknownCommand(false);
      } else if (resolution.kind === 'show-grid') {
        openGridAtOrigin();
      } else if (resolution.kind === 'pending') {
        setPending(resolution.state);
      } else {
        setPending(null);
      }
      return;
    }

    if (key.downArrow) {
      if (gridVisible) {
        setFocus('grid');
        setGridCursor({ column: 0, row: 0 });
        setScrollOffset(0);
      }
      return;
    }

    if (key.backspace || key.delete) {
      setQuery((current) => backspaceCommandQuery(current));
      setUnknownCommand(false);
      return;
    }

    const nextQuery = typeCommandQueryChar(query, input, key);
    if (nextQuery !== query) {
      setQuery(nextQuery);
      setUnknownCommand(false);
    }
  });

  return (
    <ModalDialog title="COMMAND" open onConfirm={() => {}} onCancel={onClose}>
      <Box flexDirection="column">
        <Text color={colors.text}>
          :<Text color={colors.accent}>{query}</Text>
          <Text color={colors['text-dim']}>█</Text>
        </Text>

        {unknownCommand ? (
          <Text color={colors.error}>Unknown command.</Text>
        ) : null}

        {gridShown && matches.length === 0 ? (
          <Text color={colors['text-dim']}>No matching command.</Text>
        ) : null}

        {gridVisible ? (
          <Box flexDirection="row">
            {layout.truncated.left ? <Text color={colors['text-dim']}>… </Text> : null}
            {layout.columns.map((column, columnIndex) => {
              const absoluteColumn = layout.scrollOffset + columnIndex;
              const width = columnDisplayWidth(column);
              return (
                <Box key={absoluteColumn} flexDirection="column" marginRight={GRID_COLUMN_GAP}>
                  {column.map((command, rowIndex) => {
                    const isCursor =
                      focus === 'grid' && gridCursor.column === absoluteColumn && gridCursor.row === rowIndex;
                    return (
                      <Text key={command.name} color={isCursor ? colors.accent : colors['text-dim']}>
                        {isCursor ? '› ' : '  '}
                        {command.name.padEnd(width)}
                      </Text>
                    );
                  })}
                </Box>
              );
            })}
            {layout.truncated.right ? <Text color={colors['text-dim']}> …</Text> : null}
          </Box>
        ) : null}
      </Box>
    </ModalDialog>
  );
}
