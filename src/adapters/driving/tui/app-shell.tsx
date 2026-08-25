import { useEffect, useState } from 'react';
import { Box, Text, useInput, useWindowSize } from 'ink';
import { CommandBar } from './shared/command-bar.js';
import { Footer } from './shared/components/footer.js';
import { KeybindingHelp } from './shared/components/keybinding-help.js';
import { ModalDialog } from './shared/components/modal-dialog.js';
import { TopBar } from './shared/components/top-bar.js';
import { ZoneTabBar } from './shared/components/zone-tab-bar.js';
import { RepoRegistryScreen } from './shared/repo-registry-screen.js';
import { useAppStore, type AppStore, type AppState } from './store/app-store.js';
import { getZoneScreen } from './zones/index.js';
import { ZONES, nextZoneId, type ZoneId } from './zones/zones.js';

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

// Story 2.12: `Left`/`Right` directly switch the active zone to the previous/next zone in
// `ZONES` order, wrapping at the ends — no mode to enter first, gated exactly like
// `shouldSwitchZone`'s mnemonic dispatch (same `if` block, same early-return guards).
export function resolveZoneArrowSwitch(
  key: { leftArrow?: boolean; rightArrow?: boolean },
  activeZone: ZoneId,
): ZoneId | null {
  if (key.leftArrow) {
    return nextZoneId(activeZone, -1);
  }
  if (key.rightArrow) {
    return nextZoneId(activeZone, 1);
  }
  return null;
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
  // state) so both the `registry` command inside Story 2.14's command bar and Dashboard's
  // empty-registry prompt can trigger it.
  const registryScreenOpen = useStore((state) => state.registryScreenOpen);
  const closeRegistryScreen = useStore((state) => state.closeRegistryScreen);
  // Story 2.14: lives in the store (like registryScreenOpen, not local AppShell state as
  // originally sketched) so a mounted zone screen can also read it and gate its own
  // `useInput` with `{ isActive: !commandBarOpen }` — Ink dispatches every keypress to every
  // mounted `useInput` hook regardless of z-order, so without this a zone's own key handling
  // would silently fire underneath the bar (see EdtsZone).
  const commandBarOpen = useStore((state) => state.commandBarOpen);
  const openCommandBar = useStore((state) => state.openCommandBar);
  const closeCommandBar = useStore((state) => state.closeCommandBar);
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

    // Skip help dispatch entirely while the registry screen or the command bar is open — both
    // own free-text keystroke capture (the registry's root-path field, the bar's command
    // query), so `?` typed there must land as a literal character, never also pop the
    // keybinding-help modal on top of the overlay. Mirrors how the registry screen's own
    // Esc-close below is gated on registryScreenOpen.
    if (!registryScreenOpen && !commandBarOpen) {
      resolveHelpDispatch(input, key, state.helpOpen, openHelp, closeHelp);
    }

    if (!helpOpen && !filterOpen && !registryScreenOpen && !commandBarOpen) {
      const zoneId = shouldSwitchZone(input);
      if (zoneId) {
        setActiveZone(zoneId);
        return;
      }

      const arrowZoneId = resolveZoneArrowSwitch(key, activeZone);
      if (arrowZoneId) {
        setActiveZone(arrowZoneId);
        return;
      }

      if (shouldOpenFilter(input)) {
        setFilterOpen(true);
        return;
      }

      if (shouldOpenCommand(input)) {
        openCommandBar();
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
      {commandBarOpen && (
        <CommandBar useStore={useStore} onClose={closeCommandBar} />
      )}
      <Footer />
    </Box>
  );
}