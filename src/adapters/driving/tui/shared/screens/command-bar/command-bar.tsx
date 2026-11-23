// tui/shared/command-bar: the `:` command-entry bar with shell-style Tab completion — Tab
// completes a single match or a longer shared prefix; a second Tab at the maximal prefix (or
// Tab on empty input) reveals a column-major, arrow-navigable command grid. Its own useInput
// handles everything; AppShell only mounts/unmounts it via `commandBarOpen`. Every key decision
// is a pure, unit-tested function because renderToString's fake stdin never emits keys.
import { useState } from 'react';
import { Box, Text, type Key } from 'ink';
import { useInput } from '../../hooks/use-input.js';
import {
  resolveHistoryBrowseDown,
  resolveHistoryBrowseUp,
  resolveSnapBackBase,
  type HistoryBrowseState,
} from '../../input-history/index.js';
import { useBounds } from '../../bounds/bounds-context.js';
import { ModalDialog } from '../../components/dialogs/modal-dialog.js';
import { colors } from '../../theme/theme.js';
import { useAppStore, type AppStore } from '../../../store/app-store.js';
import { useFooterContext } from '../../hooks/use-footer-context.js';
import {
  COMMANDS,
  matchCommands,
  findExactCommand,
  runCommand as runCommandInZone,
  type Command,
} from '../../../commands/commands.js';
import { StateLine } from '../../components/feedback/state-line.js';
import {
  GridCursor,
  TabPressState,
  backspaceCommandQuery,
  columnDisplayWidth,
  commandAtGridCursor,
  groupCommandsByColumn,
  layoutCommandGrid,
  moveGridCursorHorizontal,
  moveGridCursorVertical,
  resolveGridHorizontalDirection,
  resolveGridVerticalDirection,
  resolveTabPress,
  typeCommandQueryChar,
  GRID_COLUMN_GAP,
  MIN_GRID_WIDTH,
  MODAL_CHROME_WIDTH,
} from './command-grid.logic.js';

export * from './command-grid.logic.js';
// The single Enter-dispatch entry point. The command name is the query's first
// whitespace-separated token (case-insensitive) so commands that take an argument
// (`edt-switch <topic>`, `update-service <name>`) dispatch on their name while the run itself
// receives the full query. The zone switch is delegated to commands.ts's runCommand. Returns
// true when a command ran, false when nothing matched (the caller shows the unknown-command
// message).
export function runCommand(
  useStore: AppStore,
  fullQuery: string,
  commands: readonly Command[] = COMMANDS,
): boolean {
  const name = fullQuery.trim().split(/\s+/)[0] ?? '';
  if (name === '') {
    return false;
  }
  const exact = findExactCommand(name, commands);
  if (!exact) {
    return false;
  }
  // A synchronously throwing command must never escape the Enter handler into Ink —
  // the command was recognized, so the bar still closes as today.
  try {
    runCommandInZone(exact, useStore, fullQuery);
  } catch {
    // Recognized but failed: swallow the throw, the bar still closes.
  }
  return true;
}

export type CommandBarProps = {
  useStore?: AppStore;
  onClose: () => void;
};

export function CommandBar({ useStore = useAppStore, onClose }: CommandBarProps) {
  // Read live from the store (the settings screen's Command Palette tab).
  const configuredGridMaxRows = useStore((state) => state.settings.commandPalette.gridMaxRows);
  // Frame (6) + input line + one message line + one spare row.
  const bounds = useBounds();
  const gridMaxRows = Math.max(1, Math.min(configuredGridMaxRows, bounds.rows - 9));
  useFooterContext('command-bar', 'command', useStore);
  // The persisted recall list, most recent first.
  const commandHistory = useStore((state) => state.commandHistory);
  const commitCommandHistoryEntry = useStore((state) => state.commitCommandHistoryEntry);
  const [query, setQuery] = useState('');
  // Non-null while ↑/↓ are recalling history — `query` then shows the recalled entry and
  // `browsing.savedDraft` holds the draft to restore (the shared input-history primitive).
  const [browsing, setBrowsing] = useState<HistoryBrowseState | null>(null);
  const [unknownCommand, setUnknownCommand] = useState(false);
  const [pending, setPending] = useState<TabPressState | null>(null);
  // Whether the grid has been revealed at all this session (Tab on empty input, or a resolved
  // double-Tab). Actual visibility also needs 2+ live matches — see `gridVisible` below (the
  // grid re-filters live and hides once only one match remains).
  const [gridShown, setGridShown] = useState(false);
  const [focus, setFocus] = useState<'input' | 'grid'>('input');
  const [rawGridCursor, setGridCursor] = useState<GridCursor>({ column: 0, row: 0 });
  const [scrollOffset, setScrollOffset] = useState(0);

  const matches = matchCommands(query, COMMANDS);
  const gridVisible = gridShown && matches.length > 1;

  const terminalColumns = bounds.columns;
  const availableWidth = Math.max(terminalColumns - MODAL_CHROME_WIDTH, MIN_GRID_WIDTH);
  const allColumns = groupCommandsByColumn(matches, gridMaxRows);
  // A resize can change the column heights (gridMaxRows follows the bounds): keep the cursor on a real cell.
  const cursorColumn = Math.max(0, Math.min(rawGridCursor.column, allColumns.length - 1));
  const gridCursor: GridCursor = {
    column: cursorColumn,
    row: Math.max(0, Math.min(rawGridCursor.row, (allColumns[cursorColumn]?.length ?? 1) - 1)),
  };
  const layout = layoutCommandGrid(matches, gridMaxRows, availableWidth, (command) => command.name, scrollOffset);

  // layoutCommandGrid already windows the grid to the terminal's width and the configured rows.
  const visibleColumns = layout.columns;

  const openGridAtOrigin = () => {
    setGridShown(true);
    setGridCursor({ column: 0, row: 0 });
    setScrollOffset(0);
    setPending(null);
  };

  // Shared exit path back to the input from grid focus, used by both "any printable
  // character" and backspace: focus returns to the input and the grid collapses entirely — a
  // fresh Tab is required to bring it back.
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

      // Tab has no meaning while browsing the grid. Ink already reports empty `input` for Tab
      // (parse-keypress.js's `nonAlphanumericKeys`), so the printable-char branch below would
      // be a no-op anyway — this guard makes that explicit rather than relying on an upstream
      // detail.
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

    // focus === 'input'. Any key other than Tab discards a pending double-Tab state.
    if (!key.tab && pending !== null) {
      setPending(null);
    }

    if (key.return) {
      // Runs the displayed query — a recalled command runs as shown. Only a recognized command
      // is recorded, so an unknown one never enters the history.
      if (runCommand(useStore, query)) {
        commitCommandHistoryEntry(query.trim());
        onClose();
      } else {
        setUnknownCommand(true);
      }
      return;
    }

    if (key.tab) {
      // Tab adopts a recalled entry as the new draft (browsing ends) and then behaves as usual
      // on that text.
      setBrowsing(null);
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

    if (key.upArrow) {
      const result = resolveHistoryBrowseUp(query, browsing, commandHistory);
      setQuery(result.query);
      setBrowsing(result.browsing);
      setUnknownCommand(false);
      return;
    }

    if (key.downArrow) {
      if (browsing !== null) {
        const result = resolveHistoryBrowseDown(browsing, commandHistory);
        setQuery(result.query);
        setBrowsing(result.browsing);
        setUnknownCommand(false);
        return;
      }
      if (gridVisible) {
        setFocus('grid');
        setGridCursor({ column: 0, row: 0 });
        setScrollOffset(0);
      }
      return;
    }

    // Backspace / a printable character while browsing snap back to the draft with the
    // keystroke applied on top of it, rather than editing the recalled entry in place.
    const { base } = resolveSnapBackBase(query, query.length, browsing);

    if (key.backspace || key.delete) {
      setQuery(backspaceCommandQuery(base));
      setBrowsing(null);
      setUnknownCommand(false);
      return;
    }

    const nextQuery = typeCommandQueryChar(base, input, key);
    if (nextQuery !== base) {
      setQuery(nextQuery);
      setBrowsing(null);
      setUnknownCommand(false);
    }
  });

  return (
    <ModalDialog title="COMMAND" open>
      <Box flexDirection="column">
        <Text color={colors.text} wrap="truncate-start">
          :<Text color={colors.accent}>{query}</Text>
          <Text color={colors['text-dim']}>█</Text>
        </Text>

        {unknownCommand ? (
          <Text color={colors.error}>Unknown command.</Text>
        ) : null}

        {gridShown && matches.length === 0 ? (
          <StateLine kind="empty" subject="commands" text="No matching command." />
        ) : null}

        {gridVisible ? (
          <Box flexDirection="row">
            {layout.truncated.left ? <Text color={colors['text-dim']}>… </Text> : null}
            {visibleColumns.map((visibleColumn, columnIndex) => {
              const absoluteColumn = layout.scrollOffset + columnIndex;
              const width = columnDisplayWidth(visibleColumn, (command) => command.name);
              return (
                <Box key={absoluteColumn} flexDirection="column" marginRight={GRID_COLUMN_GAP}>
                  {visibleColumn.map((command, rowIndex) => {
                    const isCursor =
                      focus === 'grid' && gridCursor.column === absoluteColumn && gridCursor.row === rowIndex;
                    return (
                      <Text key={command.name} color={isCursor ? colors.accent : colors['text-dim']} wrap="truncate-end">
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
