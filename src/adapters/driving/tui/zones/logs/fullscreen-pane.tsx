// tui/zones/logs: the single-pane fullscreen preview — extracted from logs-zone.tsx (refactor).
// Purely presentational, mirroring LogsPaneView's own split: all keystroke handling stays in
// LogsZone's own useInput (Code Map: never a component-owned useInput here).
import { Box, Text } from 'ink';
import { DimAnnotation } from '../../shared/components/dim-annotation.js';
import { StatusBadge } from '../../shared/components/status-badge.js';
import { useElementSize } from '../../shared/hooks/use-element-size.js';
import { colors, spacing } from '../../shared/theme/theme.js';
import type { LogsPaneData } from '../../store/app-store.js';
import {
  computeLineRowCount,
  formatLogFilterSpec,
  formatLogLine,
  healthBadgeState,
  isDefaultLogFilterSpec,
  resolveEffectiveLines,
  sliceVisibleWindow,
  type LogFilterSpec,
  type VisibilityFlags,
} from './logs-zone.logic.js';

export function FullscreenPane({
  repoPath,
  serviceName,
  pane,
  visibility,
  wrapLines,
  visibleLines,
  contentWidth,
  globalFilter,
  engaged,
  ownFilter,
}: {
  repoPath: string;
  // Captured directly at the point fullscreen was opened (store's logsFullscreenServiceName)
  // rather than re-derived via a live `rows.find(...)` lookup, which can miss (e.g. a
  // transient services-list load error while the preview is open) and silently fall back to a
  // bare "Logs" label right when the user needs the service name most (review fix).
  serviceName: string | null;
  pane: LogsPaneData | undefined;
  visibility: VisibilityFlags;
  wrapLines: boolean;
  visibleLines: number;
  contentWidth: number;
  globalFilter: LogFilterSpec;
  engaged: boolean;
  ownFilter: LogFilterSpec | null;
}) {
  const [contentRef, measuredSize] = useElementSize();
  const rowBudget = measuredSize !== null ? measuredSize.height : visibleLines;
  const resolvedContentWidth = measuredSize !== null ? Math.max(measuredSize.width, 1) : contentWidth;
  const lines = resolveEffectiveLines(pane, visibility, globalFilter, engaged, ownFilter);
  const windowLines = sliceVisibleWindow(lines, pane?.scrollOffset ?? 0, rowBudget, (line) =>
    computeLineRowCount(formatLogLine(line, visibility.showTimestamps), resolvedContentWidth, wrapLines),
  );
  // A pane with buffered lines that the current stdout/stderr/story-5.2 filters happen to
  // hide entirely must read differently from "no lines have arrived yet" — otherwise a user
  // who toggled off both stdout and stderr, or set an aggressive filter, is misleadingly told
  // the stream itself is empty (review fix, story 5.1; extended to the new filter layer).
  const allLinesHiddenByFilters = (pane?.lines.length ?? 0) > 0 && lines.length === 0;
  return (
    <Box flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden" paddingX={spacing['pane-padding-x']}>
      <Box flexDirection="row">
        <Box flexGrow={1} minWidth={0}>
          <Text color={colors.accent} bold>
            {serviceName ?? 'Logs'}
          </Text>
        </Box>
        {/* Story 5.3: inline health badge + restart disabled state, mirroring the grid pane
            header above. */}
        <Box marginLeft={1}>
          <StatusBadge state={healthBadgeState(pane?.health ?? 'down')} />
          <Text color={colors['text-dim']}> {pane?.health ?? 'down'}</Text>
        </Box>
        {pane?.restarting || (pane?.health ?? 'down') === 'restarting' ? (
          <Text color={colors['text-dim']}> [R] restarting…</Text>
        ) : (
          <Text color={colors['text-dim']}> [R] restart</Text>
        )}
      </Box>
      {pane?.streamError ? <DimAnnotation text={pane.streamError.message} /> : null}
      {pane?.noMoreHistory && (pane?.scrollOffset ?? 0) > 0 ? <DimAnnotation text="no more history" /> : null}
      {!engaged ? (
        <DimAnnotation text="global filter: off" />
      ) : !isDefaultLogFilterSpec(globalFilter) ? (
        <DimAnnotation text={`global filter: ${formatLogFilterSpec(globalFilter)}`} />
      ) : null}
      {ownFilter !== null ? <DimAnnotation text={`pane filter: ${formatLogFilterSpec(ownFilter)}`} /> : null}
      <Box ref={contentRef} flexDirection="column" flexGrow={1} minHeight={0}>
        {windowLines.length === 0 && !pane?.streamError ? (
          <Text color={colors['text-dim']}>{allLinesHiddenByFilters ? 'All lines hidden by filters' : 'Waiting for logs…'}</Text>
        ) : null}
        {windowLines.map((line, index) => (
          <Text key={index} color={line.stream === 'stderr' ? colors.error : colors.text} wrap={wrapLines ? 'wrap' : 'truncate-end'}>
            {formatLogLine(line, visibility.showTimestamps)}
          </Text>
        ))}
      </Box>
      <DimAnnotation text="[Esc] back  [↑/↓] scroll  [c] clear  [t/o/p] toggle timestamps/stdout/stderr  [w] wrap/truncate  [R] restart" />
      <DimAnnotation text="[/] global filter  [f] pane filter  [g] toggle global engagement" />
    </Box>
  );
}
