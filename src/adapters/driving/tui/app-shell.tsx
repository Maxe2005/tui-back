import { useEffect } from 'react';
import { Box, useInput } from 'ink';
import { Footer } from './shared/components/footer.js';
import { KeybindingHelp } from './shared/components/keybinding-help.js';
import { TopBar } from './shared/components/top-bar.js';
import { ZoneTabBar } from './shared/components/zone-tab-bar.js';
import { useAppStore, type AppStore } from './store/app-store.js';
import { getZoneScreen } from './zones/index.js';

export function shouldOpenHelp(input: string): boolean {
  return input === '?';
}

export function shouldCloseHelp(
  input: string,
  key: { escape?: boolean },
): boolean {
  return input === '?' || key.escape === true;
}

export function resolveHelpDispatch(
  input: string,
  key: { escape?: boolean },
  helpOpen: boolean,
  openHelp: () => void,
  closeHelp: () => void,
): void {
  if (helpOpen) {
    if (shouldCloseHelp(input, key)) {
      closeHelp();
    }
  } else if (shouldOpenHelp(input)) {
    openHelp();
  }
}

export function AppShell({
  useStore = useAppStore,
}: {
  useStore?: AppStore;
}) {
  const activeZone = useStore((state) => state.activeZone);
  const activeEdt = useStore((state) => state.activeEdt);
  const zoneEvents = useStore((state) => state.zoneEvents);
  const ZoneScreen = getZoneScreen(activeZone);

  useEffect(() => {
    if (activeZone !== 'dashboard' && !useStore.getState().launchBannerShown) {
      useStore.getState().markLaunchBannerShown();
    }
  }, [activeZone, useStore]);

  useInput((input, key) => {
    const state = useStore.getState();
    resolveHelpDispatch(
      input,
      key,
      state.helpOpen,
      state.openHelp,
      state.closeHelp,
    );
  });

  return (
    <Box flexDirection="column">
      <TopBar activeEdt={activeEdt} />
      <ZoneTabBar activeZone={activeZone} events={zoneEvents} />
      <ZoneScreen useStore={useStore} />
      <KeybindingHelp useStore={useStore} />
      <Footer />
    </Box>
  );
}