// tui/zones/dashboard: the fixed launch banner, then the registry-error / empty-registry prompt
// (checked first) or the snapshot sections. The registry check re-runs on mount and whenever the
// registry screen's open flag flips (the zone never remounts); the snapshot loads on mount and
// on `R`, and re-loads when the active EDT changes. Overlays make the zone inert.
import { useEffect } from 'react';
import { Box, Text } from 'ink';
import { useAppStore, type AppStore } from '../../store/app-store.js';
import { DimAnnotation } from '../../shared/components/dim-annotation.js';
import { useInput } from '../../shared/hooks/use-input.js';
import { useZoneInputActive } from '../../shared/hooks/use-zone-input-active.js';
import { colors, spacing } from '../../shared/theme/theme.js';
import { DashboardBody } from './dashboard-body.js';
import { resolveDashboardBody } from './dashboard.logic.js';
import { LaunchBanner } from './launch-banner.js';
import { ClampedParagraph } from '../../shared/components/truncated-text.js';

export const EMPTY_REGISTRY_MESSAGE = 'No repos registered yet.';
export const EMPTY_REGISTRY_HINT = 'Press [:] to scan a root path and register repos.';
// A registry.list() failure (e.g. a corrupt registry.yaml) renders its own error branch rather
// than silently falling through to whatever registryEmpty last was.
export const REGISTRY_CHECK_ERROR_MESSAGE = 'Failed to check the repo registry.';

export function DashboardZone({
  useStore = useAppStore,
}: {
  useStore?: AppStore;
}) {
  const registryEmpty = useStore((state) => state.registryEmpty);
  const registryEmptyStatus = useStore((state) => state.registryEmptyStatus);
  const registryScreenOpen = useStore((state) => state.registryScreenOpen);
  const checkRegistryEmpty = useStore((state) => state.checkRegistryEmpty);
  const loadDashboard = useStore((state) => state.loadDashboard);
  const activeEdt = useStore((state) => state.activeEdt);
  const zoneInputActive = useZoneInputActive(useStore);

  useEffect(() => {
    void checkRegistryEmpty();
  }, [registryScreenOpen, checkRegistryEmpty]);

  useEffect(() => {
    void loadDashboard();
  }, [activeEdt, loadDashboard]);

  useInput(
    (input) => {
      if (input === 'R') {
        void loadDashboard();
      }
    },
    { isActive: zoneInputActive },
  );

  const body = resolveDashboardBody(registryEmpty, registryEmptyStatus);

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Rendered unconditionally — the banner is permanent on every Dashboard render, above
          whatever content follows. */}
      <LaunchBanner />
      {body === 'registry-error' ? (
        <Box flexDirection="column" paddingX={spacing['pane-padding-x']}>
          <ClampedParagraph color={colors.error} maxLines={4}>{`${REGISTRY_CHECK_ERROR_MESSAGE}`}</ClampedParagraph>
        </Box>
      ) : body === 'empty-registry' ? (
        <Box flexDirection="column" paddingX={spacing['pane-padding-x']}>
          <ClampedParagraph color={colors.text} maxLines={4}>{`${EMPTY_REGISTRY_MESSAGE}`}</ClampedParagraph>
          <DimAnnotation text={EMPTY_REGISTRY_HINT} />
        </Box>
      ) : (
        <DashboardBody useStore={useStore} />
      )}
    </Box>
  );
}
