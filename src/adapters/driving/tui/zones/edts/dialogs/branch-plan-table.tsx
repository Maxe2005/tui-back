// tui/zones/edts/dialogs/branch-plan-table: the per-service branch-plan table shared by the create
// wizard's Step 3 and the switch resolution dialog — `PanelTitle` (accent + `▶` when focused) and
// `BranchPlanTable<Row>`, a dim header then a height-bounded BoundedList, one line per row with
// cells joined by ` │ `. Every cell is capped to BRANCH_MAX_WIDTH so no column can push the table
// past the modal; a cell without its own color takes the row color.
import { Box, Text } from 'ink';
import { BoundedList } from '../../../shared/components/bounded-list.js';
import { colors } from '../../../shared/theme/theme.js';
import { BRANCH_MAX_WIDTH, truncateBranchLabel } from '../edts-zone.logic.js';

export function PanelTitle({ text, focused }: { text: string; focused: boolean }) {
  return (
    <Text color={focused ? colors.accent : colors.text} bold={focused} wrap="truncate-end">
      {focused ? '▶ ' : '  '}
      {text}
    </Text>
  );
}

export interface BranchPlanCell {
  text: string;
  color?: string;
}

export interface BranchPlanTableProps<Row> {
  headers: readonly string[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  cells: (row: Row) => readonly BranchPlanCell[];
  cursor: number;
  focused: boolean;
  maxVisibleRows: number;
  labels: { moreAbove: string; moreBelow: string };
}

export function truncateCell(text: string): string {
  return truncateBranchLabel(text, BRANCH_MAX_WIDTH);
}

// Base, target and status: the table never has more columns than its headers.
const MAX_TABLE_COLUMNS = 6;

export function BranchPlanTable<Row>({ headers, rows, rowKey, cells, cursor, focused, maxVisibleRows, labels }: BranchPlanTableProps<Row>) {
  const rendered = rows.map((row) => cells(row).map((entry) => ({ ...entry, text: truncateCell(entry.text) })));
  const last = headers.length - 1;
  const widths = headers.map((header, column) =>
    column === last ? 0 : Math.max(header.length, ...rendered.map((row) => row[column]?.text.length ?? 0)),
  );
  const pad = (text: string, column: number) => (column === last ? text : text.padEnd(widths[column] ?? 0));
  const indexed = rows.map((row, index) => ({ row, index }));
  return (
    <Box flexDirection="column">
      <Text color={colors['text-dim']} wrap="truncate-end">
        {'  '}
        {headers.map((header, column) => pad(header, column)).join(' │ ')}
      </Text>
      <BoundedList
        items={indexed}
        maxVisibleRows={maxVisibleRows}
        cursorIndex={cursor}
        moreAboveLabel={labels.moreAbove}
        moreBelowLabel={labels.moreBelow}
        renderItem={({ row, index }) => {
          const selected = focused && index === cursor;
          const rowColor = selected ? colors.accent : colors.text;
          const rowCells = rendered[index] ?? [];
          return (
            <Text key={rowKey(row)} wrap="truncate-end">
              <Text color={colors.accent}>{selected ? '› ' : '  '}</Text>
              {rowCells.slice(0, MAX_TABLE_COLUMNS).map((entry, column) => (
                <Text key={column} wrap="truncate-end">
                  {column > 0 ? <Text color={rowColor}> │ </Text> : null}
                  <Text color={entry.color ?? rowColor} wrap="truncate-end">{pad(entry.text, column)}</Text>
                </Text>
              ))}
            </Text>
          );
        }}
      />
    </Box>
  );
}
