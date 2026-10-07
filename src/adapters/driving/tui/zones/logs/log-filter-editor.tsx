// tui/zones/logs: the filter-editor modal — one shared component and validation for both the
// `/` (global) and `f` (pane) editors. Purely presentational; all keystroke handling lives in
// LogsZone's useInput.
import { Box, Text } from 'ink';
import {
  columnDisplayWidth,
  groupCommandsByColumn,
  layoutCommandGrid,
  type GridCursor,
} from '../../shared/command-bar.js';
import { DimAnnotation } from '../../shared/components/dim-annotation.js';
import { ModalDialog } from '../../shared/components/modal-dialog.js';
import { TextInputLine } from '../../shared/components/text-input-line.js';
import { colors } from '../../shared/theme/theme.js';
import { historyEntryLabel, type FilterEditorState } from './logs-zone.logic.js';

// The filter-history grid browser's column gap — mirrors command-bar.tsx's grid spacing since
// this grid renders inside the same kind of ModalDialog.
const HISTORY_GRID_COLUMN_GAP = 1;

export function LogFilterEditor({
  editor,
  serviceName,
  history,
  gridMaxRows,
  gridCursor,
  gridScrollOffset,
  gridAvailableWidth,
  gridAvailableHeight,
}: {
  editor: FilterEditorState;
  serviceName: string | null;
  history: string[];
  gridMaxRows: number;
  gridCursor: GridCursor | null;
  gridScrollOffset: number;
  gridAvailableWidth: number;
  gridAvailableHeight: number;
}) {
  const title = editor.scope === 'global' ? 'GLOBAL LOG FILTER' : `PANE LOG FILTER — ${serviceName ?? 'unknown'}`;
  // The history grid browser — reuses command-bar.tsx's generic grid primitives over plain query
  // strings (`getLabel = historyEntryLabel`, the identity function) with its own small JSX loop.
  // A `verticalWindow` paginates it vertically like its horizontal truncation, centered on the
  // highlighted cell's row so it never scrolls out of view.
  const gridLayout =
    gridCursor !== null
      ? layoutCommandGrid(history, gridMaxRows, gridAvailableWidth, historyEntryLabel, gridScrollOffset, {
          maxVisibleRows: gridAvailableHeight,
          cursorRow: gridCursor.row,
        })
      : null;
  // Each column's width comes from the full, unsliced column (the same grouping `useInput`'s
  // row/cursor math reads), never the vertically sliced `gridLayout.columns` — otherwise the
  // widest entry scrolling out of view would shrink the column and misalign the padding.
  const fullHistoryColumns = gridCursor !== null ? groupCommandsByColumn(history, gridMaxRows) : [];
  return (
    <ModalDialog title={title} open>
      <TextInputLine
        label={editor.mode === 'regex' ? 'Regex' : 'Text'}
        value={editor.query}
        cursor={editor.cursor}
        focused={gridCursor === null}
      />
      <Text color={colors.text}>Level: {editor.level ?? 'ALL'}</Text>
      {editor.error !== null ? <DimAnnotation text={editor.error} /> : null}
      {gridCursor !== null && gridLayout !== null ? (
        history.length === 0 ? (
          <DimAnnotation text="No history for this filter yet." />
        ) : (
          <>
            {gridLayout.truncated.top ? <Text color={colors['text-dim']}>▲ more above</Text> : null}
            <Box flexDirection="row">
              {gridLayout.truncated.left ? <Text color={colors['text-dim']}>… </Text> : null}
              {gridLayout.columns.map((column, columnIndex) => {
                const absoluteColumn = gridLayout.scrollOffset + columnIndex;
                const width = columnDisplayWidth(fullHistoryColumns[absoluteColumn] ?? column, historyEntryLabel);
                return (
                  <Box key={absoluteColumn} flexDirection="column" marginRight={HISTORY_GRID_COLUMN_GAP}>
                    {column.map((entry, rowIndex) => {
                      const absoluteRow = gridLayout.rowScrollOffset + rowIndex;
                      const isCursor = gridCursor.column === absoluteColumn && gridCursor.row === absoluteRow;
                      return (
                        <Text key={`${absoluteColumn}-${absoluteRow}`} color={isCursor ? colors.accent : colors['text-dim']}>
                          {isCursor ? '› ' : '  '}
                          {entry.padEnd(width)}
                        </Text>
                      );
                    })}
                  </Box>
                );
              })}
              {gridLayout.truncated.right ? <Text color={colors['text-dim']}> …</Text> : null}
            </Box>
            {gridLayout.truncated.bottom ? <Text color={colors['text-dim']}>▼ more below</Text> : null}
          </>
        )
      ) : null}
      <DimAnnotation
        text={
          gridCursor !== null
            ? '[↑/↓/←/→] browse history  [Enter] recall  [Esc] close'
            : '[Tab] text/regex  [Ctrl+←/→] level  [↑/↓] history  [Enter/Esc] done'
        }
      />
    </ModalDialog>
  );
}
