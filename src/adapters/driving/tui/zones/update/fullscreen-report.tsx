// tui/zones/update: the full-screen service report. Purely presentational — every keystroke is
// handled by UpdateZone's useInput. Shows the unflattened, uncapped report of one service as a
// windowed, top-anchored scroll view with a position indicator; failed steps carry the error
// colour and glyph (never colour alone).
import { Box, Text } from 'ink';
import { useElementSize } from '../../shared/hooks/use-element-size.js';
import { colors, spacing } from '../../shared/theme/theme.js';
import { formatReportPosition, reportWindow, type ReportLine, type ReportLineKind } from './update-zone.logic.js';

const LINE_COLORS: Record<ReportLineKind, string> = {
  title: colors.text,
  context: colors.text,
  step: colors.text,
  'step-failed': colors.error,
  detail: colors['text-dim'],
  'detail-failed': colors.error,
  issue: colors.warning,
  'issue-resolved': colors['text-dim'],
  heading: colors.accent,
  dim: colors['text-dim'],
};

export function FullscreenReport({
  lines,
  offset,
  wrapLines,
  visibleLines,
  contentWidth,
}: {
  lines: readonly ReportLine[];
  // Top-anchored: the index of the first line visibleRows (clamped to what still fills the pane).
  offset: number;
  wrapLines: boolean;
  // The row/column budget before the first measurement lands; the measured size takes over after.
  visibleLines: number;
  contentWidth: number;
}) {
  const [contentRef, measuredSize] = useElementSize();
  const rowBudget = measuredSize !== null ? measuredSize.height : visibleLines;
  const resolvedWidth = measuredSize !== null ? Math.max(measuredSize.width, 1) : contentWidth;
  const window = reportWindow(lines, offset, rowBudget, resolvedWidth, wrapLines);
  const visibleRows = window.visibleLines;
  return (
    <Box flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden" paddingX={spacing['pane-padding-x']}>
      <Box flexDirection="row">
        <Box flexGrow={1} minWidth={0}>
          <Text color={colors.accent} bold wrap="truncate-end">
            FULL REPORT
          </Text>
        </Box>
        <Box flexShrink={0} marginLeft={1}>
          <Text color={colors['text-dim']} wrap="truncate-end">
            {`${formatReportPosition(window.start, visibleRows.length, lines.length)} · ${wrapLines ? 'wrap' : 'truncate'}`}
          </Text>
        </Box>
      </Box>
      <Box ref={contentRef} flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden">
        {visibleRows.map((line, index) => (
          <Text key={window.start + index} color={LINE_COLORS[line.kind]} bold={line.kind === 'title' || line.kind === 'step-failed'} wrap={wrapLines ? 'wrap' : 'truncate-end'}>
            {line.text}
          </Text>
        ))}
      </Box>
    </Box>
  );
}
