// tui/zones/update: update-service-list-column — the zone's left column: the SERVICES header, the
// loading / error / empty state lines and the members / others BoundedLists (two panes resizable
// through boundary 1), each row carrying exactly one status glyph.
import { resolve as resolvePath } from 'node:path';
import { Box, Text } from 'ink';
import { BoundedList, ListRow, StatusBadge, ZoneLayout } from '../../shared/components/index.js';
import { StateLine } from '../../shared/components/feedback/state-line.js';
import { colors, spacing } from '../../shared/theme/theme.js';
import { formatServiceMeta } from '../edts/edts-zone.logic.js';
import { UPDATE_MEMBERS_HEADER, UPDATE_OTHERS_HEADER, deriveUpdateServiceStatus, updateStatusText } from './update-zone.logic.js';
import type { UpdateZoneCtx } from './update-zone.ctx.js';

export function UpdateServiceListColumn({ c }: { c: UpdateZoneCtx }) {
  const {
    useStore, servicesStatus, rows, updateStatus, recapActive, cursorInMembers, panes, paneRows, clampedServiceCursor,
    updateServiceHealth, lastServiceOutcomes, isRowTargeted, serviceRestartInFlight, liveServicePhase, awaitingServices, serviceRows,
  } = c;
  const renderServiceRow = (row: (typeof serviceRows)[number], index: number) => {
    const health = updateServiceHealth[row.path] ?? 'down';
    const lastOutcome = lastServiceOutcomes[row.service];
    const isTargeted = isRowTargeted(row);
    // The coarse standalone-restart flag (the in-flight map holds this service's resolved
    // repoPath) and the live phase, which refines the glyph to `migrating`.
    const isRestarting = serviceRestartInFlight[resolvePath(row.path)] !== undefined;
    const status = deriveUpdateServiceStatus(health, lastOutcome?.outcome, isTargeted, isRestarting, liveServicePhase[row.service], awaitingServices.has(row.service));
    const statusText = updateStatusText(status);
    return (
      <Box key={row.path} flexDirection="row">
        <StatusBadge state={status} />
        {statusText === null ? null : (
          <Box marginLeft={1} flexShrink={0}>
            <Text color={status === 'no-container' ? colors['text-dim'] : colors.warning} wrap="truncate-end">{statusText}</Text>
          </Box>
        )}
        <Box marginLeft={1} flexGrow={1} minWidth={0}>
          <ListRow label={row.service} meta={formatServiceMeta(row)} selected={!recapActive && index === clampedServiceCursor} />
        </Box>
      </Box>
    );
  };

  return (
    <Box flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden" paddingX={spacing['pane-padding-x']}>
      <Text color={colors['text-dim']}>SERVICES</Text>
      {servicesStatus === 'loading' && rows.length === 0 ? <StateLine kind="loading" subject="services" /> : null}
      {servicesStatus === 'error' ? <StateLine kind="error" subject="services" retry={updateStatus !== 'running'} /> : null}
      {rows.length === 0 && servicesStatus !== 'loading' && servicesStatus !== 'error' ? (
        <StateLine kind="empty" subject="managed services" text="No managed services found." />
      ) : null}
      {/* Two distinct panes like the EDTs zone's, resizable through boundary 1. Every row
          always carries exactly one glyph from the closed
          up/down/restarting/updating/migrating/error set — never blank, never bridged
          through a generic state. */}
      <ZoneLayout
        zoneId="update"
        boundary={1}
        useStore={useStore}
        first={
          <>
            <Text color={!recapActive && cursorInMembers ? colors.accent : colors['text-dim']} wrap="truncate-end">{UPDATE_MEMBERS_HEADER}</Text>
            {panes.members.length === 0 ? <Text color={colors['text-dim']}>No services in this EDT.</Text> : null}
            <BoundedList
              items={panes.members}
              maxVisibleRows={paneRows.members}
              cursorIndex={cursorInMembers ? clampedServiceCursor : undefined}
              renderItem={(row, index) => renderServiceRow(row, index)}
            />
          </>
        }
        second={
          <>
            <Text color={!recapActive && !cursorInMembers ? colors.accent : colors['text-dim']} wrap="truncate-end">{UPDATE_OTHERS_HEADER}</Text>
            {panes.others.length === 0 ? <Text color={colors['text-dim']}>No other services.</Text> : null}
            <BoundedList
              items={panes.others}
              maxVisibleRows={paneRows.others}
              cursorIndex={cursorInMembers ? undefined : clampedServiceCursor - panes.members.length}
              renderItem={(row, index) => renderServiceRow(row, panes.members.length + index)}
            />
          </>
        }
      />
    </Box>
  );
}
