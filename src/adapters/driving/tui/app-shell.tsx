import { Box } from 'ink';
import type { UseBoundStore, StoreApi } from 'zustand';
import { Footer } from './shared/components/footer.js';
import { TopBar } from './shared/components/top-bar.js';
import { ZoneTabBar } from './shared/components/zone-tab-bar.js';
import { useAppStore, type AppState } from './store/app-store.js';
import { getZoneScreen } from './zones/index.js';

export type AppStore = UseBoundStore<StoreApi<AppState>>;

export function AppShell({
  useStore = useAppStore,
}: {
  useStore?: AppStore;
}) {
  const activeZone = useStore((state) => state.activeZone);
  const activeEdt = useStore((state) => state.activeEdt);
  const zoneEvents = useStore((state) => state.zoneEvents);
  const ZoneScreen = getZoneScreen(activeZone);
  return (
    <Box flexDirection="column">
      <TopBar activeEdt={activeEdt} />
      <ZoneTabBar activeZone={activeZone} events={zoneEvents} />
      <ZoneScreen />
      <Footer />
    </Box>
  );
}