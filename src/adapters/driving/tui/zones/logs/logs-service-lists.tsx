// tui/zones/logs: logs-service-lists — the Logs zone's left pane: the active-EDT and other-services
// checkbox lists with health badges, the info-only no-container section and the legend hints.
import { Box, Text } from 'ink';
import { BoundedList } from '../../shared/components/bounded-list.js';
import { CheckboxListItem } from '../../shared/components/checkbox-list-item.js';
import { DimAnnotation } from '../../shared/components/dim-annotation.js';
import { formatHint } from '../../shared/components/hints.js';
import { STATUS_BADGES, StatusBadge } from '../../shared/components/status-badge.js';
import { colors, spacing } from '../../shared/theme/theme.js';
import { logsLegendHints, formatHealthLabel, healthBadgeState } from './logs-zone.logic.js';
import { StateLine } from '../../shared/components/state-line.js';
import type { LogsZoneCtx } from './logs-zone.ctx.js';

// The info-only list of services without a container never takes more than this.
const WITHOUT_CONTAINER_MAX_ROWS = 5;

export function LogsServiceLists({ c }: { c: LogsZoneCtx }) {
  const { actionsMenu, activePanes, clampedEdtCursor, clampedOtherCursor, displayHealthFor, edtListMaxVisibleRows, edtServices, filterEditor, focusedEdt, hintsMaxVisibleRows, logsEdtSelected, logsListedHealth, logsOtherSelected, otherListMaxVisibleRows, otherServices, paneFocus, rows, servicesStatus, visibility, withoutContainerServices } = c;
  return (
    <Box flexDirection="column" flexGrow={1} paddingX={spacing['pane-padding-x']} minHeight={0} overflow="hidden">
      <Text color={paneFocus === 'edt-list' ? colors.accent : colors['text-dim']}>ACTIVE EDT MEMBERS</Text>
      {servicesStatus === 'loading' && rows.length === 0 ? <StateLine kind="loading" subject="services" /> : null}
      {servicesStatus === 'error' ? <StateLine kind="error" subject="services" retry={activePanes.length === 0} /> : null}
      {focusedEdt === undefined ? <StateLine kind="empty" subject="EDT" text="No active EDT." /> : null}
      {focusedEdt !== undefined && edtServices.length === 0 && servicesStatus !== 'error' ? (
        <StateLine kind="empty" subject="services" text="No services in the active EDT." />
      ) : null}
      {/* Bounded to edtListMaxVisibleRows, following the cursor only while this list owns
          focus — otherwise the window anchors to the top. */}
      <BoundedList
        items={edtServices}
        maxVisibleRows={edtListMaxVisibleRows}
        cursorIndex={paneFocus === 'edt-list' ? clampedEdtCursor : undefined}
        renderItem={(service, index) => {
          const displayHealth = displayHealthFor(service.path);
          return (
            <Box key={service.path} flexDirection="row">
              <Text color={colors.accent} wrap="truncate-end">{paneFocus === 'edt-list' && index === clampedEdtCursor ? '›' : ' '}</Text>
              <CheckboxListItem label={service.service} state={logsEdtSelected.includes(service.path) ? 'checked' : 'unchecked'} />
              <Box marginLeft={1}>
                <Box flexShrink={0}><StatusBadge state={healthBadgeState(displayHealth)} /></Box>
                <Text color={colors['text-dim']} wrap="truncate-end">{` ${formatHealthLabel(displayHealth)}`}</Text>
              </Box>
            </Box>
          );
        }}
      />

      <Text color={paneFocus === 'other-list' ? colors.accent : colors['text-dim']}>OTHER SERVICES</Text>
      {otherServices.length === 0 && servicesStatus !== 'loading' && servicesStatus !== 'error' ? (
        <StateLine kind="empty" subject="services" text="No other managed services." />
      ) : null}
      <BoundedList
        items={otherServices}
        maxVisibleRows={otherListMaxVisibleRows}
        cursorIndex={paneFocus === 'other-list' ? clampedOtherCursor : undefined}
        renderItem={(service, index) => {
          const displayHealth = displayHealthFor(service.path);
          return (
            <Box key={service.path} flexDirection="row">
              <Text color={colors.accent} wrap="truncate-end">{paneFocus === 'other-list' && index === clampedOtherCursor ? '›' : ' '}</Text>
              <CheckboxListItem label={service.service} state={logsOtherSelected.includes(service.path) ? 'checked' : 'unchecked'} />
              <Box marginLeft={1}>
                <Box flexShrink={0}><StatusBadge state={healthBadgeState(displayHealth)} /></Box>
                <Text color={colors['text-dim']} wrap="truncate-end">{` ${formatHealthLabel(displayHealth)}`}</Text>
              </Box>
            </Box>
          );
        }}
      />

      {/* Info-only: every registry service whose manifest declares no container, from
          either membership list. No cursor, no checkbox, no Tab stop, no Ctrl+A —
          presence resolves async in the store, so this appears once known. */}
      {withoutContainerServices.length > 0 ? (
        <Box flexDirection="column" marginTop={spacing['section-gap']}>
          <Text color={colors['text-dim']}>SERVICES WITHOUT CONTAINER</Text>
          <BoundedList
            items={withoutContainerServices}
            maxVisibleRows={WITHOUT_CONTAINER_MAX_ROWS}
            renderItem={(service) => {
              // A container-less service declaring a `healthUrl` still gets its real
              // up/down status (AD-23), labelled in its badge's tone; the others read as
              // a dim no container.
              const health = logsListedHealth[service.path] ?? 'no-container';
              return (
                <Box key={service.path} flexDirection="row">
                  <Text color={colors['text-dim']} wrap="truncate-end"> {service.service}</Text>
                  <Box marginLeft={1}>
                    <Box flexShrink={0}><StatusBadge state={healthBadgeState(health)} /></Box>
                    <Text color={health === 'no-container' ? colors['text-dim'] : STATUS_BADGES[healthBadgeState(health)].color} wrap="truncate-end"> {formatHealthLabel(health)}</Text>
                  </Box>
                </Box>
              );
            }}
          />
        </Box>
      ) : null}

      {/* Hidden while the filter editor is open: every hint here is a services-list or
          editor-opening key, all inert once the editor captures input. Rendered anyway,
          this block plus the editor (a sibling below, Ink has no absolute positioning)
          overflows the terminal and Ink's diff-render corrupts painted lines. Also bounded
          (hintsMaxVisibleRows), since the lists above can push it past the terminal's
          rows even with the editor closed. */}
      {filterEditor === null && actionsMenu === null ? (
        <Box flexDirection="column" marginTop={spacing['section-gap']}>
          <BoundedList
            items={logsLegendHints(visibility).map(formatHint)}
            maxVisibleRows={hintsMaxVisibleRows}
            renderItem={(text, index) => <DimAnnotation key={index} text={text} />}
          />
        </Box>
      ) : null}
    </Box>
  );
}
