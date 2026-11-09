// tui/zones/logs: a single grid pane's rendering. Purely presentational — all keystroke handling
// stays in LogsZone's useInput.
import { Box, Text } from 'ink';
import type { ServiceBranchDivergence } from '../../../../../core/edt/list.js';
import { DimAnnotation } from '../../shared/components/dim-annotation.js';
import { formatHint } from '../../shared/components/hints.js';
import { StatusBadge } from '../../shared/components/status-badge.js';
import { ScrollableOutput } from '../../shared/components/scrollable-output.js';
import { colors } from '../../shared/theme/theme.js';
import type { RestartMode } from '../../../../../core/service-actions/index.js';
import type { LogsPaneData } from '../../store/app-store.js';
import {
  formatHealthLabel,
  formatLogFilterScope,
  formatLogLine,
  healthBadgeState,
  isDefaultLogFilterScope,
  isRestartingDisplay,
  resolveEffectiveLines,
  restartHintVerb,
  type LogFilterScope,
  type VisibilityFlags,
} from './logs-zone.logic.js';
import { StateLine } from '../../shared/components/state-line.js';

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
  restartMode = 'simple',
}: {
  service: ServiceBranchDivergence;
  pane: LogsPaneData | undefined;
  visibility: VisibilityFlags;
  wrapLines: boolean;
  visibleLines: number;
  contentWidth: number;
  focused: boolean;
  globalFilter: LogFilterScope;
  engaged: boolean;
  ownFilter: LogFilterScope | null;
  restartMode?: RestartMode;
}) {
  const lines = resolveEffectiveLines(pane, visibility, globalFilter, engaged, ownFilter);
  // A pane whose buffered lines the stdout/stderr toggles or filters hide entirely must read
  // differently from "no lines have arrived yet" — otherwise a user who toggled off both streams,
  // or set an aggressive filter, is misleadingly told the stream itself is empty.
  const allLinesHiddenByFilters = (pane?.lines.length ?? 0) > 0 && lines.length === 0;
  // A manifest without `container` has no stream at all — the badge goes dim (never down)
  // and the restart control is absent entirely. A requested restart reads explicitly until
  // the re-verifying poll lands, never as the bare state.
  const paneHealth = pane?.health ?? 'down';
  const displayHealth = isRestartingDisplay(pane?.restarting ?? false, paneHealth) ? 'restarting' : paneHealth;
  const noContainer = paneHealth === 'no-container' || pane?.noContainer === true;
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
          <Box flexShrink={0}><StatusBadge state={healthBadgeState(displayHealth)} /></Box>
          <Text color={colors['text-dim']} wrap="truncate-end">{` ${formatHealthLabel(displayHealth)}`}</Text>
        </Box>
        {noContainer ? null : displayHealth === 'restarting' ? (
          <Text color={colors['text-dim']} wrap="truncate-end">{` ${formatHint(['R', 'restart requested — re-verifying…'])}`}</Text>
        ) : (
          <Text color={colors['text-dim']} wrap="truncate-end">{` ${formatHint(['R', restartHintVerb(restartMode)])}`}</Text>
        )}
      </Box>
      {pane?.streamError ? <DimAnnotation text={pane.streamError.message} /> : null}
      {pane?.notice ? <DimAnnotation text={pane.notice} /> : null}
      {pane?.noMoreHistory && (pane?.scrollOffset ?? 0) > 0 ? <DimAnnotation text="no more history" /> : null}
      {!engaged ? (
        <DimAnnotation text="global filter: off" />
      ) : !isDefaultLogFilterScope(globalFilter) ? (
        <DimAnnotation text={`global filter: ${formatLogFilterScope(globalFilter)}`} />
      ) : null}
      {ownFilter !== null ? <DimAnnotation text={`pane filter: ${formatLogFilterScope(ownFilter)}`} /> : null}
      <ScrollableOutput
        lines={lines}
        offset={pane?.scrollOffset ?? 0}
        wrap={wrapLines}
        fallbackRows={visibleLines}
        fallbackWidth={contentWidth}
        format={(line) => formatLogLine(line, visibility.showTimestamps)}
        color={(line) => (line.stream === 'stderr' ? colors.error : colors.text)}
        placeholder={
          pane?.streamError ? null : noContainer ? (
            <StateLine kind="empty" subject="logs" text="No container — no logs" />
          ) : allLinesHiddenByFilters ? (
            <StateLine kind="empty" subject="lines" text="All lines hidden by filters" />
          ) : (
            <StateLine kind="loading" verb="Waiting for" subject="logs" />
          )
        }
      />
    </Box>
  );
}
