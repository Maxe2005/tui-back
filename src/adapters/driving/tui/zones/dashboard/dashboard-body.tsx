// tui/zones/dashboard: the sections under the banner. Services and registry health each carry
// their own StateLine (spinner / error + retry) so one failing or slow load never blanks the other.
// The services table is the list pane; the focused row's reason and actions are the detail pane.
import { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import type { DashboardService } from '../../../../../core/dashboard/snapshot.js';
import { useAppStore, type AppStore } from '../../store/app-store.js';
import { BoundedList } from '../../shared/components/bounded-list.js';
import { DimAnnotation } from '../../shared/components/dim-annotation.js';
import { formatHint } from '../../shared/components/hints.js';
import { ServiceActionsRow } from '../../shared/components/service-actions-row.js';
import { StateLine } from '../../shared/components/state-line.js';
import { StatusBadge } from '../../shared/components/status-badge.js';
import { ClampedParagraph, TruncatedText } from '../../shared/components/truncated-text.js';
import { ZoneLayout } from '../../shared/components/zone-layout.js';
import { colors, spacing } from '../../shared/theme/theme.js';
import { STATUS_BADGES } from '../../shared/components/status-badge.js';
import {
  aheadBehindLabel,
  branchLabel,
  containerLabel,
  disableWhileRunning,
  formatRegistrySummary,
  formatUpdatedAgo,
  issueMarker,
  reasonLine,
} from './dashboard.logic.js';

export const NO_ACTIVE_EDT_MESSAGE = 'No active EDT.';
export const NO_ACTIVE_EDT_HINT = `Press ${formatHint(['e', 'EDTs'])} to create or choose one.`;
// Rows the zone prints besides the service rows: banner (2), EDT line, registry line, updated
// line and one spare for a "more below" indicator.
const BODY_CHROME_ROWS = 7;

function ServiceRow({ service, focused }: { service: DashboardService; focused: boolean }) {
  const container = containerLabel(service.container);
  const marker = issueMarker(service);
  return (
    <Box>
      <Text wrap="truncate-end" color={focused ? STATUS_BADGES.selection.color : colors['text-dim']}>{focused ? STATUS_BADGES.selection.glyph : ' '}</Text>
      <Text wrap="truncate-end" color={colors.warning}>{marker}</Text>
      <StatusBadge state={container.badge} />
      <Box marginLeft={spacing['glyph-gap']} flexShrink={1}>
        <TruncatedText color={focused ? colors.accent : colors.text}>
          {[service.service, container.text, branchLabel(service), aheadBehindLabel(service.divergence)].join('  ')}
        </TruncatedText>
      </Box>
    </Box>
  );
}

function ServiceDetail({ service, useStore }: { service: DashboardService; useStore: AppStore }) {
  const actions = useStore((state) => state.dashboardServiceActions[service.path]);
  const actionState = useStore((state) => state.dashboardActionState[service.path]);
  const reason = reasonLine(service);
  const running = actionState?.running ?? null;
  const shown = disableWhileRunning(actions ?? [], running !== null);
  const why = shown.flatMap((action) => (action.availability.available ? [] : [`${action.key}: ${action.availability.reason}`])).join(' · ');
  return (
    <Box flexDirection="column" paddingX={spacing['pane-padding-x']}>
      <TruncatedText color={colors['text-dim']}>{service.service}</TruncatedText>
      {reason === null ? <DimAnnotation text="No issue." /> : <TruncatedText color={colors.warning}>{reason}</TruncatedText>}
      {actions === undefined ? (
        <DimAnnotation text="Actions unavailable." />
      ) : (
        <ServiceActionsRow actions={shown} />
      )}
      {/* The one-line row clips on a narrow pane, so the reasons are also spelled out below it. */}
      {why === '' ? null : <ClampedParagraph color={colors['text-dim']} maxLines={2}>{why}</ClampedParagraph>}
      {running !== null ? (
        <TruncatedText color={colors.info}>{running.text}</TruncatedText>
      ) : actionState?.result != null ? (
        <TruncatedText color={actionState.result.ok ? colors.success : colors.error}>{actionState.result.text}</TruncatedText>
      ) : null}
    </Box>
  );
}

function focusedIndex(cursor: number, length: number): number {
  return Math.min(Math.max(cursor, 0), Math.max(length - 1, 0));
}

export function DashboardBody({ useStore = useAppStore, cursor = 0 }: { useStore?: AppStore; cursor?: number }) {
  const servicesStatus = useStore((state) => state.dashboardServicesStatus);
  const services = useStore((state) => state.dashboardServices);
  const registryStatus = useStore((state) => state.dashboardRegistryStatus);
  const registry = useStore((state) => state.dashboardRegistry);
  const updatedAt = useStore((state) => state.dashboardUpdatedAt);
  // The clock only re-renders the "updated Ns ago" line; it never reloads data.
  const [now, setNow] = useState(() => Date.now());
  const ticking = updatedAt !== null;
  useEffect(() => {
    if (!ticking) {
      return undefined;
    }
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);

  const loading = servicesStatus === 'loading' || registryStatus === 'loading';
  return (
    <Box flexDirection="column" paddingX={spacing['pane-padding-x']}>
      {servicesStatus === 'idle' || servicesStatus === 'loading' ? (
        <StateLine kind="loading" subject="services" />
      ) : servicesStatus === 'error' || services === null ? (
        <StateLine kind="error" subject="services" retry />
      ) : services.status === 'no-active-edt' || services.edt === null ? (
        <Box flexDirection="column">
          <TruncatedText color={colors.text}>{NO_ACTIVE_EDT_MESSAGE}</TruncatedText>
          <DimAnnotation text={NO_ACTIVE_EDT_HINT} />
        </Box>
      ) : (
        <Box flexDirection="column" flexGrow={1} minHeight={0}>
          <TruncatedText color={colors.text}>{`EDT ${services.edt.topic} · ${services.edt.serviceCount} services`}</TruncatedText>
          {services.services.length === 0 ? (
            <DimAnnotation text="This EDT has no services." />
          ) : (
            <ZoneLayout
              zoneId="dashboard"
              useStore={useStore}
              first={
                <BoundedList
                  items={services.services}
                  chromeRows={BODY_CHROME_ROWS}
                  cursorIndex={focusedIndex(cursor, services.services.length)}
                  renderItem={(service, index) => (
                    <ServiceRow key={service.path} service={service} focused={index === focusedIndex(cursor, services.services.length)} />
                  )}
                />
              }
              second={<ServiceDetail service={services.services[focusedIndex(cursor, services.services.length)] ?? services.services[0]!} useStore={useStore} />}
            />
          )}
        </Box>
      )}
      {registryStatus === 'idle' || registryStatus === 'loading' ? (
        <StateLine kind="loading" subject="repo health" />
      ) : registryStatus === 'error' || registry === null ? (
        <StateLine kind="error" subject="repo health" retry />
      ) : (
        <TruncatedText color={colors['text-dim']}>{formatRegistrySummary(registry)}</TruncatedText>
      )}
      {!loading && updatedAt !== null ? <TruncatedText color={colors['text-dim']}>{formatUpdatedAgo(now, updatedAt)}</TruncatedText> : null}
    </Box>
  );
}
