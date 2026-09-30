// tui/zones/logs: the filter-editor modal — extracted from logs-zone.tsx (refactor). Story 5.2:
// renders whichever scope's editor is open — one shared component/validation for both `/`
// (global) and `f` (pane), per Boundaries ("Both editors share one component and validation").
// Purely presentational, mirroring ModalDialog's other call sites — all the actual keystroke
// handling lives in LogsZone's own useInput (Code Map: never a component-owned useInput here,
// same convention as BranchPicker/TextInputLine).
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

// Story 5.4: the filter-history grid browser's own column-gap — mirrors command-bar.tsx's own
// grid spacing since this grid renders inside the same LogFilterEditor ModalDialog.
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
  // Story 5.4: the history grid browser — reuses command-bar.tsx's generalized grid primitives
  // over plain query strings (`getLabel = historyEntryLabel`, i.e. the identity function)
  // rather than a shared visual component (Code Map: "with its own small JSX loop").
  // Story 5.5 (OVERFLOW_HISTORY_GRID): a `verticalWindow` is now also passed — the grid gains
  // vertical pagination the same way it already had horizontal truncation/scroll, centered on
  // the highlighted cell's own row so it never scrolls out of view.
  const gridLayout =
    gridCursor !== null
      ? layoutCommandGrid(history, gridMaxRows, gridAvailableWidth, historyEntryLabel, gridScrollOffset, {
          maxVisibleRows: gridAvailableHeight,
          cursorRow: gridCursor.row,
        })
      : null;
  // Review fix: each column's width used to be computed from `gridLayout.columns` — already
  // vertically sliced — so the widest entry could scroll out of the visible window and shrink
  // the column, misaligning padding against the pre-5.5 stable width as the user scrolls
  // vertically. Widths are the full, unsliced column's own (mirrors `groupCommandsByColumn`'s
  // own column-major grouping, same source `useInput`'s row/cursor math already reads).
  const fullHistoryColumns = gridCursor !== null ? groupCommandsByColumn(history, gridMaxRows) : [];
  return (
    <ModalDialog title={title} onConfirm={() => {}} onCancel={() => {}} open>
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
