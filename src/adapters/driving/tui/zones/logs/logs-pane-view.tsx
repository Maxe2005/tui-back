// tui/zones/logs: a single grid pane's rendering. Purely presentational — all keystroke handling
// stays in LogsZone's useInput.
import { Box, Text } from 'ink';
import type { ServiceBranchDivergence } from '../../../../../core/edt/list.js';
import { DimAnnotation } from '../../shared/components/dim-annotation.js';
import { StatusBadge } from '../../shared/components/status-badge.js';
import { useElementSize } from '../../shared/hooks/use-element-size.js';
import { colors } from '../../shared/theme/theme.js';
import type { LogsPaneData } from '../../store/app-store.js';
import {
  computeLineRowCount,
  formatHealthLabel,
  formatLogFilterSpec,
  formatLogLine,
  healthBadgeState,
  isDefaultLogFilterSpec,
  isRestartingDisplay,
  resolveEffectiveLines,
  sliceVisibleWindow,
  type LogFilterSpec,
  type VisibilityFlags,
} from './logs-zone.logic.js';

export function LogsPaneView({
  service,
  pane,
  visibility,
  wrapLines,
  visibleLines,
  contentWidth,
  focused,
  globalFilter,
  engaged,
  ownFilter,
}: {
  service: ServiceBranchDivergence;
  pane: LogsPaneData | undefined;
  visibility: VisibilityFlags;
  wrapLines: boolean;
  visibleLines: number;
  contentWidth: number;
  focused: boolean;
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
  // A pane whose buffered lines the stdout/stderr toggles or filters hide entirely must read
  // differently from "no lines have arrived yet" — otherwise a user who toggled off both streams,
  // or set an aggressive filter, is misleadingly told the stream itself is empty.
  const allLinesHiddenByFilters = (pane?.lines.length ?? 0) > 0 && lines.length === 0;
  // A manifest without `container` has no stream at all — the badge goes dim (never down)
  // and the restart control is absent entirely. A requested restart reads explicitly until
  // the re-verifying poll lands, never as the bare state.
  const paneHealth = pane?.health ?? 'down';
  const displayHealth = isRestartingDisplay(pane?.restarting ?? false, paneHealth) ? 'restarting' : paneHealth;
  const noContainer = paneHealth === 'no-container';
  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      flexBasis={0}
      minHeight={0}
      minWidth={0}
      overflow="hidden"
      borderStyle="single"
      borderColor={focused ? colors.accent : colors.border}
      paddingX={1}
    >
      {/* Always bold (not just when sub-focused) so a service name stands out from its own log
          text at a glance, in a grid where several panes are visible at once. */}
      <Box flexDirection="row">
        <Box flexGrow={1} minWidth={0}>
          <Text bold color={focused ? colors.accent : colors.text} wrap="truncate-end">
            {service.service}
          </Text>
        </Box>
        {/* Inline health badge next to the service's logs (glyph+color paired) + the restart
            control's disabled state while restarting. */}
        <Box marginLeft={1}>
          <StatusBadge state={healthBadgeState(displayHealth)} />
          <Text color={colors['text-dim']}> {formatHealthLabel(displayHealth)}</Text>
        </Box>
        {noContainer ? null : displayHealth === 'restarting' ? (
          <Text color={colors['text-dim']}> [R] restart requested — re-verifying…</Text>
        ) : (
          <Text color={colors['text-dim']}> [R]</Text>
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
      <Box ref={contentRef} flexDirection="column" flexGrow={1} minHeight={0} minWidth={0}>
        {windowLines.length === 0 && !pane?.streamError ? (
          <Text color={colors['text-dim']}>
            {noContainer ? 'No container — no logs' : allLinesHiddenByFilters ? 'All lines hidden by filters' : 'Waiting for logs…'}
          </Text>
        ) : null}
        {windowLines.map((line, index) => (
          <Text key={index} color={line.stream === 'stderr' ? colors.error : colors.text} wrap={wrapLines ? 'wrap' : 'truncate-end'}>
            {formatLogLine(line, visibility.showTimestamps)}
          </Text>
        ))}
      </Box>
    </Box>
  );
}
