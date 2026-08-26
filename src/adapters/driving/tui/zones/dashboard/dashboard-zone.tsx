// tui/zones/dashboard: story 2.11 adds the "no repos registered yet" prompt, checked before
// any other Dashboard content (Boundaries: "checked before any other Dashboard content").
// The registry.list() emptiness check re-runs on mount (it unmounts/remounts on every zone
// switch, same convention as edts-zone.tsx's mount-effect load) *and* whenever the registry
// screen's open/close flag flips — the common flow is opening the registry screen from
// Dashboard and closing it again without ever switching zones, which would never remount
// DashboardZone at all, so a mount-only check would leave the prompt showing a stale
// pre-registration snapshot (AC3: "reflects the current registry state ... never a stale
// cached one").
//
// Design Notes (spec): the epics.md AC describes this chaining before Story 2.1/UX-DR19's
// "no EDT yet" state, but that state isn't built yet — Dashboard still falls through to the
// generic ZonePlaceholder when the registry is non-empty, left untouched here.
import { useEffect } from 'react';
import { Box, Text } from 'ink';
import { useAppStore, type AppStore } from '../../store/app-store.js';
import { DimAnnotation } from '../../shared/components/dim-annotation.js';
import { ZonePlaceholder } from '../../shared/components/index.js';
import { colors, spacing } from '../../shared/theme/theme.js';
import { LaunchBanner } from './launch-banner.js';

export const EMPTY_REGISTRY_MESSAGE = 'No repos registered yet.';
export const EMPTY_REGISTRY_HINT = 'Press [:] to scan a root path and register repos.';
// review patch: a registry.list() failure (e.g. a corrupt registry.yaml) was previously
// completely invisible — registryEmptyStatus flipped to 'error' but nothing in DashboardZone
// rendered a branch for it, so it silently fell through to whatever registryEmpty last was.
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
      <LaunchBanner />
      {registryEmptyStatus === 'error' ? (
        <Box flexDirection="column" paddingX={spacing['pane-padding-x']}>
          <Text color={colors.error}>{REGISTRY_CHECK_ERROR_MESSAGE}</Text>
        </Box>
      ) : registryEmpty === true ? (
        <Box flexDirection="column" paddingX={spacing['pane-padding-x']}>
          <Text color={colors.text}>{EMPTY_REGISTRY_MESSAGE}</Text>
          <DimAnnotation text={EMPTY_REGISTRY_HINT} />
        </Box>
      ) : (
        <ZonePlaceholder zoneId="dashboard" useStore={useStore} />
      )}
    </Box>
  );
}
