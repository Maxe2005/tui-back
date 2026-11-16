// tui/zones/logs: the single-pane fullscreen preview. Purely presentational — all keystroke
// handling stays in LogsZone's useInput.
import { Box, Text } from 'ink';
import { DimAnnotation } from '../../shared/components/dim-annotation.js';
import { formatHint } from '../../shared/components/hints.js';
import { StatusBadge } from '../../shared/components/status-badge.js';
import { FullscreenFrame } from '../../shared/components/fullscreen-frame.js';
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
  restartMode = 'simple',
}: {
  repoPath: string;
  // Captured when fullscreen was opened (store's logsFullscreenServiceName) rather than
  // re-derived via a live `rows.find(...)` lookup, which can miss (e.g. a transient services-list
  // load error while the preview is open) and fall back to a bare "Logs" label right when the
  // user needs the service name most.
  serviceName: string | null;
  pane: LogsPaneData | undefined;
  visibility: VisibilityFlags;
  wrapLines: boolean;
  visibleLines: number;
  contentWidth: number;
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
  const paneHealth = pane?.health ?? 'down';
  const displayHealth = isRestartingDisplay(pane?.restarting ?? false, paneHealth) ? 'restarting' : paneHealth;
  const noContainer = paneHealth === 'no-container' || pane?.noContainer === true;
  return (
    <FullscreenFrame>
      <Box flexDirection="row">
        <Box flexGrow={1} minWidth={0}>
          <Text color={colors.accent} bold wrap="truncate-end">
            {serviceName ?? 'Logs'}
          </Text>
        </Box>
        {/* Inline health badge + restart disabled state, mirroring the grid pane header. A
            manifest without `container` shows the dim no-container state with no restart
            control at all. */}
        <Box marginLeft={1}>
          <Box flexShrink={0}><StatusBadge state={healthBadgeState(displayHealth)} /></Box>
          <Text color={colors['text-dim']} wrap="truncate-end"> {formatHealthLabel(displayHealth)}</Text>
        </Box>
        {noContainer ? null : displayHealth === 'restarting' ? (
          <Text color={colors['text-dim']} wrap="truncate-end"> {formatHint(['R', 'restart requested — re-verifying…'])}</Text>
        ) : (
          <Text color={colors['text-dim']} wrap="truncate-end"> {formatHint(['R', restartHintVerb(restartMode)])}</Text>
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
    </FullscreenFrame>
  );
}
