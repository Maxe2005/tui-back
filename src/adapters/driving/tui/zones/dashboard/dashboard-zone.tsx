// tui/zones/dashboard: the launch banner plus the "no repos registered yet" prompt, checked
// before any other Dashboard content. The emptiness check re-runs on mount *and* whenever the
// registry screen's open flag flips: opening and closing the registry screen from Dashboard
// never remounts this zone, so a mount-only check would show a stale snapshot. A non-empty
// registry falls through to the generic ZonePlaceholder.
import { useEffect } from 'react';
import { Box, Text } from 'ink';
import { useAppStore, type AppStore } from '../../store/app-store.js';
import { DimAnnotation } from '../../shared/components/dim-annotation.js';
import { ZonePlaceholder } from '../../shared/components/index.js';
import { colors, spacing } from '../../shared/theme/theme.js';
import { LaunchBanner } from './launch-banner.js';

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

  useEffect(() => {
    void checkRegistryEmpty();
  }, [registryScreenOpen, checkRegistryEmpty]);

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Rendered unconditionally — the banner is permanent on every Dashboard render, above
          whatever content follows. */}
      <LaunchBanner />
      {registryEmptyStatus === 'error' ? (
        <Box flexDirection="column" paddingX={spacing['pane-padding-x']}>
          <Text color={colors.error} wrap="truncate-end">{REGISTRY_CHECK_ERROR_MESSAGE}</Text>
        </Box>
      ) : registryEmpty === true ? (
        <Box flexDirection="column" paddingX={spacing['pane-padding-x']}>
          <Text color={colors.text} wrap="truncate-end">{EMPTY_REGISTRY_MESSAGE}</Text>
          <DimAnnotation text={EMPTY_REGISTRY_HINT} />
        </Box>
      ) : (
        <ZonePlaceholder zoneId="dashboard" useStore={useStore} />
      )}
    </Box>
  );
}
