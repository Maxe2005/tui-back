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
import { BoundedList } from '../../shared/components/bounded-list.js';
import { formatFilterActionTarget, formatLogRule, MAX_LOG_FILTER_RULES, historyEntryLabel, type FilterEditorState, type LogFilterScope } from './logs-zone.logic.js';
import { StateLine } from '../../shared/components/state-line.js';

// The filter-history grid browser's column gap — mirrors command-bar.tsx's grid spacing since
// this grid renders inside the same kind of ModalDialog.
const HISTORY_GRID_COLUMN_GAP = 1;

export function LogFilterEditor({
  editor,
  filterScope,
  rulesMaxVisibleRows,
  serviceName,
  history,
  gridMaxRows,
  gridCursor,
  gridScrollOffset,
  gridAvailableWidth,
  gridAvailableHeight,
}: {
  editor: FilterEditorState;
  // The scope's committed state — what the rule list shows.
  filterScope: LogFilterScope;
  rulesMaxVisibleRows: number;
  serviceName: string | null;
  history: string[];
  gridMaxRows: number;
  gridCursor: GridCursor | null;
  gridScrollOffset: number;
  gridAvailableWidth: number;
  gridAvailableHeight: number;
}) {
  const baseTitle = editor.scope === 'global' ? 'GLOBAL LOG FILTER' : `PANE LOG FILTER — ${serviceName ?? 'unknown'}`;
  const title = editor.view === 'list' ? `${baseTitle} — RULES` : `${baseTitle} — ${editor.ruleIndex === null ? 'NEW RULE' : `RULE ${editor.ruleIndex + 1}`}`;
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
  // layoutCommandGrid windows the history grid to the available width and height.
  const visibleColumns = gridLayout?.columns ?? [];
  if (editor.view === 'list') {
    const cursor = Math.min(editor.listCursor, Math.max(filterScope.rules.length - 1, 0));
    return (
      <ModalDialog title={title} open>
        <Text color={colors.text} wrap="truncate-end">
          Level: {filterScope.level ?? 'ALL'}  Rules: {filterScope.rules.length}/{MAX_LOG_FILTER_RULES}
        </Text>
        {filterScope.rules.length === 0 ? (
          <StateLine kind="empty" subject="rules" text="No rules — press a to add one." />
        ) : (
          <BoundedList
            items={filterScope.rules}
            maxVisibleRows={rulesMaxVisibleRows}
            cursorIndex={cursor}
            renderItem={(rule, index) => (
              <Text
                key={index}
                color={index === cursor ? colors.accent : rule.enabled ? colors.text : colors['text-dim']}
                wrap="truncate-end"
              >
                {index === cursor ? '› ' : '  '}
                {index + 1}. {formatLogRule(rule)}
              </Text>
            )}
          />
        )}
        {editor.confirmClear ? <Text color={colors.warning} wrap="truncate-end">Clear all {filterScope.rules.length} rules? (y/Enter = yes, Esc = keep)</Text> : null}
        {editor.notice !== null ? <DimAnnotation text={editor.notice} /> : null}
      </ModalDialog>
    );
  }
  return (
    <ModalDialog title={title} open>
      <TextInputLine
        label={editor.mode === 'regex' ? 'Regex' : 'Text'}
        value={editor.query}
        cursor={editor.cursor}
        focused={gridCursor === null}
      />
      <Text color={colors.text} wrap="truncate-end">
        Filter: {formatFilterActionTarget(editor.action, editor.target)}
      </Text>
      {editor.error !== null ? <DimAnnotation text={editor.error} /> : null}
      {gridCursor !== null && gridLayout !== null ? (
        history.length === 0 ? (
          <StateLine kind="empty" subject="history for this filter" />
        ) : (
          <>
            {gridLayout.truncated.top ? <Text color={colors['text-dim']}>▲ more above</Text> : null}
            <Box flexDirection="row">
              {gridLayout.truncated.left ? <Text color={colors['text-dim']}>… </Text> : null}
              {visibleColumns.map((visibleColumn, columnIndex) => {
                const absoluteColumn = gridLayout.scrollOffset + columnIndex;
                const width = columnDisplayWidth(fullHistoryColumns[absoluteColumn] ?? visibleColumn, historyEntryLabel);
                return (
                  <Box key={absoluteColumn} flexDirection="column" marginRight={HISTORY_GRID_COLUMN_GAP}>
                    {visibleColumn.map((entry, rowIndex) => {
                      const absoluteRow = gridLayout.rowScrollOffset + rowIndex;
                      const isCursor = gridCursor.column === absoluteColumn && gridCursor.row === absoluteRow;
                      return (
                        <Text key={`${absoluteColumn}-${absoluteRow}`} color={isCursor ? colors.accent : colors['text-dim']} wrap="truncate-end">
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
    </ModalDialog>
  );
}
