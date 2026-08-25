import { useEffect, useState } from 'react';
import { Box, Text, useInput, useWindowSize } from 'ink';
import { Footer } from './shared/components/footer.js';
import { KeybindingHelp } from './shared/components/keybinding-help.js';
import { ModalDialog } from './shared/components/modal-dialog.js';
import { TopBar } from './shared/components/top-bar.js';
import { ZoneTabBar } from './shared/components/zone-tab-bar.js';
import { RepoRegistryScreen } from './shared/repo-registry-screen.js';
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
  // Story 2.11: the registry screen's open/close flag lives in the store (not local AppShell
  // state) so both the `:` command palette below and Dashboard's empty-registry prompt can
  // trigger it.
  const registryScreenOpen = useStore((state) => state.registryScreenOpen);
  const openRegistryScreen = useStore((state) => state.openRegistryScreen);
  const closeRegistryScreen = useStore((state) => state.closeRegistryScreen);
  const ZoneScreen = getZoneScreen(activeZone);
  const { rows } = useWindowSize();
  const quitRequested = useStore((state) => state.quitRequested);

  const [filterOpen, setFilterOpen] = useState(false);

  useEffect(() => {
    if (activeZone !== 'dashboard' && !useStore.getState().launchBannerShown) {
      useStore.getState().markLaunchBannerShown();
    }
  }, [activeZone, useStore]);

  // Review patch (story 2.9): `q` can't reach onQuit while a zone dialog has captured
  // input (see the zoneInputCaptured gate below) — a zone whose captured dialog has no
  // cancel target of its own (the EDTs zone's forced, genuinely-empty-registry create
  // prompt) calls `requestQuit()` instead. onQuit is only in scope here, at the
  // composition root's boundary, so this effect is the handoff.
  useEffect(() => {
    if (quitRequested) {
      onQuit();
    }
  }, [quitRequested, onQuit]);

  useInput((input, key) => {
    const state = useStore.getState();

    // Story 2.9: a zone-owned dialog/form (e.g. the EDTs zone's create/switch/modify
    // flows) sets zoneInputCaptured while it owns the keystroke — every global shortcut,
    // including `?` help, must not fire while it's set, the same way it's already gated
    // for the zone-mnemonic/filter/command dispatch below.
    if (state.zoneInputCaptured) {
      return;
    }

    // Skip help dispatch entirely while the registry screen is open — it owns free-text
    // keystroke capture (the root-path field), so `?` typed there must land as a literal
    // character, never also pop the keybinding-help modal on top of the overlay. Mirrors how
    // the registry screen's own Esc-close below is gated on registryScreenOpen.
    if (!registryScreenOpen) {
      resolveHelpDispatch(input, key, state.helpOpen, openHelp, closeHelp);
    }

    if (!helpOpen && !filterOpen && !registryScreenOpen) {
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
        openRegistryScreen();
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

    // Esc always closes the registry screen, regardless of its internal phase (Boundaries:
    // "closed via Esc, or after a register run" — no partial back-navigation between phases).
    if (registryScreenOpen && key.escape === true) {
      closeRegistryScreen();
    }
  });

  return (
    <Box flexDirection="column" height={rows} overflow="hidden">
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
      {registryScreenOpen && <RepoRegistryScreen useStore={useStore} />}
      <Footer />
    </Box>
  );
}