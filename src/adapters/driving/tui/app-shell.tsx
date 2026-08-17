import { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { Footer } from './shared/components/footer.js';
import { KeybindingHelp } from './shared/components/keybinding-help.js';
import { ModalDialog } from './shared/components/modal-dialog.js';
import { TopBar } from './shared/components/top-bar.js';
import { ZoneTabBar } from './shared/components/zone-tab-bar.js';
import { useAppStore, type AppStore, type AppState } from './store/app-store.js';
import { getZoneScreen } from './zones/index.js';
import { ZONES, type ZoneId } from './zones/zones.js';

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

export function shouldSwitchZone(input: string): ZoneId | null {
  const zone = ZONES.find((z) => z.mnemonic === input);
  return zone?.id ?? null;
}

export function shouldOpenFilter(input: string): boolean {
  return input === '/';
}

export function shouldOpenCommand(input: string): boolean {
  return input === ':';
}

export function shouldQuit(input: string, _key: { escape?: boolean }, state: AppState): boolean {
  return input === 'q' && !state.runInProgress;
}

export function AppShell({
  useStore = useAppStore,
  onQuit, // provided by composition root (bin/tui.ts); always present
}: {
  useStore?: AppStore;
  onQuit: () => void;
}) {
  const activeZone = useStore((state) => state.activeZone);
  const activeEdt = useStore((state) => state.activeEdt);
  const zoneEvents = useStore((state) => state.zoneEvents);
  const setActiveZone = useStore((state) => state.setActiveZone);
  const helpOpen = useStore((state) => state.helpOpen);
  const openHelp = useStore((state) => state.openHelp);
  const closeHelp = useStore((state) => state.closeHelp);
  const ZoneScreen = getZoneScreen(activeZone);

  const [filterOpen, setFilterOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);

  useEffect(() => {
    if (activeZone !== 'dashboard' && !useStore.getState().launchBannerShown) {
      useStore.getState().markLaunchBannerShown();
    }
  }, [activeZone, useStore]);

  useInput((input, key) => {
    const state = useStore.getState();

    resolveHelpDispatch(input, key, state.helpOpen, openHelp, closeHelp);

    if (!helpOpen && !filterOpen && !commandOpen) {
      const zoneId = shouldSwitchZone(input);
      if (zoneId) {
        setActiveZone(zoneId);
        return;
      }

      if (shouldOpenFilter(input)) {
        setFilterOpen(true);
        return;
      }

      if (shouldOpenCommand(input)) {
        setCommandOpen(true);
        return;
      }

      if (shouldQuit(input, key, state)) {
        onQuit();
        return;
      }
    }

    if (filterOpen && (input === '?' || key.escape === true)) {
      setFilterOpen(false);
    }

    if (commandOpen && (input === '?' || key.escape === true)) {
      setCommandOpen(false);
    }
  });

  return (
    <Box flexDirection="column">
      <TopBar activeEdt={activeEdt} />
      <ZoneTabBar activeZone={activeZone} events={zoneEvents} />
      <ZoneScreen useStore={useStore} />
      <KeybindingHelp useStore={useStore} />
      {filterOpen && (
        <ModalDialog
          title="FILTER"
          onConfirm={() => {}}
          onCancel={() => setFilterOpen(false)}
          open={true}
        >
          <Text>Filter input — wired in Epic 2+</Text>
        </ModalDialog>
      )}
      {commandOpen && (
        <ModalDialog
          title="COMMAND"
          onConfirm={() => {}}
          onCancel={() => setCommandOpen(false)}
          open={true}
        >
          <Text>Command entry — wired in Epic 2+</Text>
        </ModalDialog>
      )}
      <Footer />
    </Box>
  );
}