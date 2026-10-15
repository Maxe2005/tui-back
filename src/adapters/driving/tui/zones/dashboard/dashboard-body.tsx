// tui/zones/dashboard: the sections under the banner. Services and registry health each carry
// their own StateLine (spinner / error + retry) so one failing or slow load never blanks the other;
// a probed field that failed prints its own marker on the row.
import { useEffect, useState } from 'react';
import { Box } from 'ink';
import type { DashboardService } from '../../../../../core/dashboard/snapshot.js';
import { useAppStore, type AppStore } from '../../store/app-store.js';
import { BoundedList } from '../../shared/components/bounded-list.js';
import { DimAnnotation } from '../../shared/components/dim-annotation.js';
import { formatHint } from '../../shared/components/hints.js';
import { StateLine } from '../../shared/components/state-line.js';
import { StatusBadge } from '../../shared/components/status-badge.js';
import { TruncatedText } from '../../shared/components/truncated-text.js';
import { colors, spacing } from '../../shared/theme/theme.js';
import { branchLabel, containerLabel, formatRegistrySummary, formatUpdatedAgo, workingTreeLabel } from './dashboard.logic.js';

export const NO_ACTIVE_EDT_MESSAGE = 'No active EDT.';
export const NO_ACTIVE_EDT_HINT = `Press ${formatHint(['e', 'EDTs'])} to create or choose one.`;
// Rows the zone prints besides the service rows: banner (2), EDT line, registry line, updated
// line and one spare for a "more below" indicator.
const BODY_CHROME_ROWS = 7;

function ServiceRow({ service }: { service: DashboardService }) {
  const container = containerLabel(service.container);
  const tree = workingTreeLabel(service.workingTree);
  return (
    <Box>
      <StatusBadge state={container.badge} />
      <Box marginLeft={spacing['glyph-gap']} flexShrink={1}>
        <TruncatedText color={colors.text}>
          {[service.service, container.text, branchLabel(service), ...(tree === null ? [] : [tree])].join(' · ')}
        </TruncatedText>
      </Box>
    </Box>
  );
}

export function DashboardBody({ useStore = useAppStore }: { useStore?: AppStore }) {
  const servicesStatus = useStore((state) => state.dashboardServicesStatus);
  const services = useStore((state) => state.dashboardServices);
  const registryStatus = useStore((state) => state.dashboardRegistryStatus);
  const registry = useStore((state) => state.dashboardRegistry);
  const updatedAt = useStore((state) => state.dashboardUpdatedAt);
  // The clock only re-renders the "updated Ns ago" line; it never reloads data.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

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
        <Box flexDirection="column">
          <TruncatedText color={colors.text}>{`EDT ${services.edt.topic} · ${services.edt.serviceCount} services`}</TruncatedText>
          <BoundedList
            items={services.services}
            chromeRows={BODY_CHROME_ROWS}
            renderItem={(service) => <ServiceRow key={service.path} service={service} />}
          />
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
