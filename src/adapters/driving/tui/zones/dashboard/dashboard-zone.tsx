import { Box } from 'ink';
import { useAppStore, type AppStore } from '../../store/app-store.js';
import { ZonePlaceholder } from '../../shared/components/index.js';
import { LaunchBanner } from './launch-banner.js';

export function DashboardZone({
  useStore = useAppStore,
}: {
  useStore?: AppStore;
}) {
  const launchBannerShown = useStore((state) => state.launchBannerShown);
  return (
    <Box flexDirection="column" flexGrow={1}>
      {launchBannerShown ? null : <LaunchBanner />}
      <ZonePlaceholder zoneId="dashboard" useStore={useStore} />
    </Box>
  );
}