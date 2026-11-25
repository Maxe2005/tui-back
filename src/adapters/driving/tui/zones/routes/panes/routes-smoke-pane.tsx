// tui/zones/routes: routes-smoke-pane — the smoke run's bounded live table in the Favorites pane's slot: a header
// (progress + state), the all-outcomes summary line, then one windowed row per favorite (glyph + colour, then the status/reason so a narrow pane clips the path, not the outcome).
import { Box, Text } from 'ink';
import { BoundedList } from '../../../shared/components/lists/bounded-list.js';
import { colors } from '../../../shared/theme/theme.js';
import {
  formatSmokeRow,
  formatSmokeSummaryLines,
  resolveSmokeBodyRows,
  smokeBadge,
  smokeHeader,
  summarizeSmokeRows,
  type SmokeTableRow,
} from '../logic/routes-smoke.logic.js';

export function RoutesSmokePane({
  rows,
  running,
  error,
  cursor,
  focused,
  notice,
  totalRows,
  bodyRows,
}: {
  rows: readonly SmokeTableRow[];
  running: boolean;
  error: string | null;
  cursor: number;
  focused: boolean;
  notice: string | null;
  // Fixed row budget of the whole pane (header included) and of its body.
  totalRows: number;
  bodyRows: number;
}) {
  if (totalRows <= 0) {
    return null;
  }
  const budget = resolveSmokeBodyRows(bodyRows);
  const visibleSummaryLines = formatSmokeSummaryLines(summarizeSmokeRows(rows), budget.summary);
  return (
    <Box flexDirection="column" flexShrink={0} height={totalRows} overflow="hidden">
      <Box flexShrink={0}>
        <Text color={focused ? colors.accent : colors['text-dim']} wrap="truncate-end">
          {smokeHeader(rows, running, error)}
        </Text>
      </Box>
      {notice !== null && budget.table > 0 ? (
        <Box flexShrink={0}>
          <Text color={colors.warning} wrap="truncate-end">{notice}</Text>
        </Box>
      ) : null}
      {budget.summary > 0 ? (
        <Box flexDirection="column" flexShrink={0}>
          {visibleSummaryLines.map((line) => (
            <Text key={line} color={colors.text} wrap="truncate-end">
              {line}
            </Text>
          ))}
        </Box>
      ) : null}
      {budget.table > (notice !== null ? 1 : 0) ? (
        <BoundedList
          items={rows}
          maxVisibleRows={notice !== null && budget.table > 0 ? budget.table - 1 : budget.table}
          cursorIndex={cursor}
          renderItem={(entry, index) => {
            const badge = smokeBadge(entry);
            const { label, meta } = formatSmokeRow(entry);
            const selected = focused && index === cursor;
            return (
              <Box key={`${entry.repoPath} ${entry.method} ${entry.path}`} flexShrink={0}>
                <Text wrap="truncate-end">
                  <Text wrap="truncate-end" color={colors.accent}>{selected ? '› ' : '  '}</Text>
                  <Text wrap="truncate-end" color={badge.color}>{badge.glyph}</Text>
                  <Text wrap="truncate-end" color={colors['text-dim']}>{` ${meta}  `}</Text>
                  <Text wrap="truncate-end" color={selected ? colors.accent : colors.text}>{label}</Text>
                </Text>
              </Box>
            );
          }}
        />
      ) : null}
    </Box>
  );
}
