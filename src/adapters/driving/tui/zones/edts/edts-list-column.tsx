// tui/zones/edts: edts-list-column — the left column: the EDTS selector, the issues line and the
// EDT SERVICES / OTHER SERVICES lists, as nested ZoneLayouts (boundary 1 / boundary 2).
import { Box, Text } from 'ink';
import { BoundedList } from '../../shared/components/bounded-list.js';
import { DimAnnotation } from '../../shared/components/feedback/dim-annotation.js';
import { formatHint, formatHints } from '../../shared/components/dialogs/hints.js';
import { ListRow } from '../../shared/components/list-row.js';
import { StateLine } from '../../shared/components/feedback/state-line.js';
import { ZoneLayout } from '../../shared/components/zone-layout.js';
import { colors, spacing } from '../../shared/theme/theme.js';
import { formatEdtRowMeta, formatServiceMeta } from './edts-zone.logic.js';
import type { EdtsZoneCtx } from './edts-zone.ctx.js';

export function EdtsListColumn({ c }: { c: EdtsZoneCtx }) {
  const {
    paneFocus,
    edtsLoading,
    edtsStatus,
    edtsRows,
    userEdtCount,
    focusedIsSystem,
    focusedIsActive,
    clampedEdtsSelected,
    activeEdtUlid,
    dialogOpen,
    loading,
    status,
    issuesSummary,
    issuesSeverity,
    focusedEdt,
    edtServices,
    otherServices,
    clampedEdtServicesSelected,
    clampedOtherServicesSelected,
    edtServicesMaxVisibleRows,
    otherServicesMaxVisibleRows,
    useStore,
  } = c;
  return (
    <Box flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden" paddingX={spacing['pane-padding-x']}>
      {/* The list column's 3 fixed-but-movable regions — EDTS, EDT SERVICES, OTHER
          SERVICES — are nested ZoneLayouts: boundary 1 splits EDTS vs. the rest; boundary 2
          splits the rest into EDT SERVICES vs. OTHER SERVICES. */}
      <ZoneLayout
        zoneId="edts"
        boundary={1}
        useStore={useStore}
        first={
        <>
        <Text color={paneFocus === 'edts' ? colors.accent : colors['text-dim']}>EDTS</Text>
        {edtsLoading ? <StateLine kind="loading" subject="EDTs" /> : null}
        {edtsStatus === 'error' ? <StateLine kind="error" subject="EDTs" retry /> : null}
        {!edtsLoading && edtsStatus !== 'error' && userEdtCount === 0 ? (
          <StateLine kind="empty" subject="EDTs" />
        ) : null}
        <BoundedList
          items={edtsRows}
          chromeRows={4}
          cursorIndex={clampedEdtsSelected}
          renderItem={(entry, index) => (
          <ListRow
            key={entry.ulid}
            label={entry.topic}
            meta={formatEdtRowMeta(entry)}
            selected={paneFocus === 'edts' && index === clampedEdtsSelected}
            // `emphasized` marks the row at `clampedEdtsSelected` — the index `focusedEdt`
            // (below) is read from, whose membership drives the EDT SERVICES/OTHER SERVICES
            // split — so it persists across all three panes' focus, unlike `selected`.
            emphasized={index === clampedEdtsSelected}
            // `active`: the tool-wide active EDT's row, a discreet suffix rather than
            // accent+bold — decoupled from `emphasized`, so it can land on the same or a
            // different row.
            active={entry.ulid === activeEdtUlid}
          />
          )}
        />
        {!dialogOpen ? (
          <DimAnnotation
            text={formatHints([
              ['Enter', focusedIsSystem ? (focusedIsActive ? 'read-only' : 'switch') : 'switch/modify'],
              ...(focusedIsSystem ? ([['f', 'fast-forward']] as const) : []),
              ['Tab', 'focus'],
            ])}
          />
        ) : null}
        </>
        }
        second={
        <>
        {/* The services list is split into two Tab-cyclable panes, partitioned against the
            *selected* EDT's membership — a "No EDT selected" note stands in for EDT
            SERVICES when no EDT is focused. */}
        {/* issuesSummary counts unreachable/error services across the whole list, so it
            shows once here, above both groups, never nested under one where a flagged
            service in the other would go unreported. */}
        {loading ? <StateLine kind="loading" subject="services" /> : null}
        {status === 'error' ? <StateLine kind="error" subject="services" retry /> : null}
        {/* Colored by severity (not the uniform dim gray of other DimAnnotation lines) so a
            listing problem is noticed, not skimmed past — plus a details hint into the
            read-only issues dialog. */}
        {issuesSummary ? (
          <Box paddingLeft={2}>
            <Text color={issuesSeverity === 'error' ? colors.error : colors.warning} bold wrap="truncate-end">
              {issuesSeverity === 'error' ? '✖' : '▲'} {issuesSummary}
              {!dialogOpen ? `  ${formatHint(['i', 'details'])}` : ''}
            </Text>
          </Box>
        ) : null}

        <ZoneLayout
          zoneId="edts"
          boundary={2}
          useStore={useStore}
          first={
          <>
          {focusedEdt !== undefined ? (
            <>
              <Text color={paneFocus === 'edt-services' ? colors.accent : colors['text-dim']}>EDT SERVICES</Text>
              {!loading && status !== 'error' && edtServices.length === 0 ? (
                <StateLine kind="empty" subject="services" text="No services in this EDT." />
              ) : null}
              {/* Bounded to edtServicesMaxVisibleRows — only the rendered window, never the
                  content/selection/action semantics. */}
              <BoundedList
                items={edtServices}
                maxVisibleRows={edtServicesMaxVisibleRows}
                cursorIndex={paneFocus === 'edt-services' ? clampedEdtServicesSelected : undefined}
                renderItem={(service, index) => (
                  <ListRow
                    key={service.path}
                    label={service.service}
                    meta={formatServiceMeta(service)}
                    selected={paneFocus === 'edt-services' && index === clampedEdtServicesSelected}
                  />
                )}
              />
            </>
          ) : (
            <DimAnnotation text="No EDT selected" />
          )}
          </>
          }
          second={
          <>
          <Text color={paneFocus === 'other-services' ? colors.accent : colors['text-dim']}>OTHER SERVICES</Text>
          {!loading && status !== 'error' && otherServices.length === 0 ? (
            <StateLine kind="empty" subject="managed services" text="No managed services found." />
          ) : null}
          {/* Bounded to otherServicesMaxVisibleRows. */}
          <BoundedList
            items={otherServices}
            maxVisibleRows={otherServicesMaxVisibleRows}
            cursorIndex={paneFocus === 'other-services' ? clampedOtherServicesSelected : undefined}
            renderItem={(service, index) => (
              <ListRow
                key={service.path}
                label={service.service}
                meta={formatServiceMeta(service)}
                selected={paneFocus === 'other-services' && index === clampedOtherServicesSelected}
              />
            )}
          />
          </>
          }
        />
        </>
        }
      />
    </Box>
  );
}
