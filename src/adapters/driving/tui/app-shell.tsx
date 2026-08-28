import { useEffect, useState } from 'react';
import { Box, Text, useInput, useWindowSize } from 'ink';
import type { ResolveTabVisibilityData } from '../../../core/edt/resolve-tab-visibility.js';
import { CommandBar } from './shared/command-bar.js';
import { Footer } from './shared/components/footer.js';
import { KeybindingHelp } from './shared/components/keybinding-help.js';
import { ModalDialog } from './shared/components/modal-dialog.js';
import { TopBar } from './shared/components/top-bar.js';
import { ZoneTabBar } from './shared/components/zone-tab-bar.js';
import { RepoRegistryScreen } from './shared/repo-registry-screen.js';
import { SettingsScreen } from './shared/settings-screen.js';
import { useAppStore, type AppStore, type AppState } from './store/app-store.js';
import { getZoneScreen } from './zones/index.js';
import { ALL_ZONE_IDS, ZONES, nextZoneId, resolveReachableZones, zoneGatedStatus, type ZoneId } from './zones/zones.js';

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

// Story 2.13 adds the optional `reachable` param (defaults to every zone, preserving the
// pre-2.13 behavior every existing call site relies on): a mnemonic whose zone isn't in
// `reachable` (i.e. it's currently `omitted`) resolves to null — the mnemonic does nothing,
// same as it never existed. A `disabled` zone stays in `reachable` and is landed on as
// normal.
export function shouldSwitchZone(
  input: string,
  reachable: ReadonlySet<ZoneId> = ALL_ZONE_IDS,
): ZoneId | null {
  const zone = ZONES.find((z) => z.mnemonic === input);
  if (zone === undefined || !reachable.has(zone.id)) {
    return null;
  }
  return zone.id;
}

// Story 2.12: `Left`/`Right` directly switch the active zone to the previous/next zone in
// `ZONES` order, wrapping at the ends — no mode to enter first, gated exactly like
// `shouldSwitchZone`'s mnemonic dispatch (same `if` block, same early-return guards).
// Story 2.13 adds the optional `reachable` param, forwarded straight to `nextZoneId` (same
// default-preserving behavior as `shouldSwitchZone` above).
export function resolveZoneArrowSwitch(
  key: { leftArrow?: boolean; rightArrow?: boolean },
  activeZone: ZoneId,
  reachable: ReadonlySet<ZoneId> = ALL_ZONE_IDS,
): ZoneId | null {
  if (key.leftArrow) {
    return nextZoneId(activeZone, -1, reachable);
  }
  if (key.rightArrow) {
    return nextZoneId(activeZone, 1, reachable);
  }
  return null;
}

// Story 2.13: the active zone falling to `omitted` (a registry change removed the only
// carrying repo while that gated zone was active) has no explanatory-message content to
// fall back to in place — unlike a mere disable, this one forces navigation back to
// Dashboard (Boundaries: "Active tab going omitted -> AppShell falls back to dashboard").
export function shouldFallbackToDashboard(
  activeZone: ZoneId,
  tabVisibility: ResolveTabVisibilityData,
): boolean {
  return zoneGatedStatus(activeZone, tabVisibility) === 'omitted';
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
  const edts = useStore((state) => state.edts);
  const loadEdts = useStore((state) => state.loadEdts);
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
  // Story 2.19: the `:settings` screen's open/close flag — mirrors registryScreenOpen for the
  // store-level open flag and the global-shortcut skip below, but (amended 2026-08-28) Esc no
  // longer closes it centrally here — `closeSettingsScreen` is instead passed down as
  // SettingsScreen's own `onClose` prop, since only that component knows whether the EDTs
  // tab's group-list is drilled in (Esc should step back, not close).
  const settingsScreenOpen = useStore((state) => state.settingsScreenOpen);
  const closeSettingsScreen = useStore((state) => state.closeSettingsScreen);
  const loadSettings = useStore((state) => state.loadSettings);
  // Story 2.13: manifest-gated Routes/shared-types tab visibility — loaded once on mount and
  // reloaded on registry-screen close / active-EDT membership change (see the effect below
  // and app-store.ts's createEdt/switchEdt/modifyEdt).
  const tabVisibility = useStore((state) => state.tabVisibility);
  const loadTabVisibility = useStore((state) => state.loadTabVisibility);
  const ZoneScreen = getZoneScreen(activeZone);
  const { rows } = useWindowSize();
  const quitRequested = useStore((state) => state.quitRequested);

  const [filterOpen, setFilterOpen] = useState(false);

  // Story 2.13: mirrors dashboard-zone.tsx's own checkRegistryEmpty effect idiom — a single
  // effect keyed on `registryScreenOpen` both fires the mount-time load (it runs once on
  // mount, `registryScreenOpen` starting false) and reloads whenever the registry screen
  // closes (Story 2.11: registering may newly show/hide a gated tab). loadTabVisibility()
  // itself no-ops a call that lands while a prior one is still in flight, so this never races.
  useEffect(() => {
    void loadTabVisibility();
  }, [registryScreenOpen, loadTabVisibility]);

  // Story 2.20: load `edts` once at mount so the top bar's active-EDT topic label is
  // correct regardless of which zone renders first — EdtsZone's own mount-time
  // `loadEdts()` call is untouched and still reloads fresh whenever that zone is visited.
  useEffect(() => {
    void loadEdts();
    // Deliberately fires once on mount only, mirroring EdtsZone's own mount-once idiom.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Story 2.19 (AC3, I/O matrix "Restart"): loaded once at app mount, independent of whether
  // the settings screen is ever opened — command-bar.tsx and edts-zone.tsx both read
  // `store.settings` unconditionally, so the persisted values (not the defaults) must be live
  // before either of them ever renders.
  useEffect(() => {
    void loadSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Story 2.13 (Boundaries): the active zone going `omitted` has no explanatory-message
  // content to swap to in place — unlike a mere disable, force a fallback to Dashboard.
  useEffect(() => {
    if (shouldFallbackToDashboard(activeZone, tabVisibility)) {
      setActiveZone('dashboard');
    }
  }, [activeZone, tabVisibility, setActiveZone]);

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

    // Skip help dispatch entirely while the registry screen, the command bar, or the settings
    // screen is open — each owns its own keystroke capture (the registry's root-path field,
    // the bar's command query, the settings screen's tab/value navigation), so `?` typed there
    // must land as a literal character (or, for settings, simply not open help on top of it),
    // never also pop the keybinding-help modal on top of the overlay. Mirrors how the registry
    // screen's own Esc-close below is gated on registryScreenOpen.
    if (!registryScreenOpen && !commandBarOpen && !settingsScreenOpen) {
      resolveHelpDispatch(input, key, state.helpOpen, openHelp, closeHelp);
    }

    if (!helpOpen && !filterOpen && !registryScreenOpen && !commandBarOpen && !settingsScreenOpen) {
      // Story 2.13: the reachable-zone set (every zone minus whichever gated tab is
      // currently 'omitted') gates both the mnemonic and the arrow-nav dispatch below —
      // an omitted tab is never landed on either way; a disabled one stays reachable.
      const reachable = resolveReachableZones(state.tabVisibility);
      const zoneId = shouldSwitchZone(input, reachable);
      if (zoneId) {
        setActiveZone(zoneId);
        return;
      }

      const arrowZoneId = resolveZoneArrowSwitch(key, activeZone, reachable);
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

    // Story 2.19 (amended 2026-08-28): Esc-close for the settings screen is no longer
    // centralized here — it moved to SettingsScreen's own self-contained useInput (mirrors
    // command-bar.tsx's own `onClose` pattern), because only that component knows whether the
    // EDTs tab currently has a group drilled in (Esc should step back a level, not close the
    // whole screen) or not (Esc should close). `closeSettingsScreen` is passed down as
    // `onClose` below instead.
  });

  return (
    <Box flexDirection="column" height={rows} overflow="hidden">
      <TopBar activeEdt={activeEdt} edts={edts} />
      <ZoneTabBar activeZone={activeZone} events={zoneEvents} tabVisibility={tabVisibility} />
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
      {settingsScreenOpen && <SettingsScreen useStore={useStore} onClose={closeSettingsScreen} />}
      {commandBarOpen && (
        <CommandBar useStore={useStore} onClose={closeCommandBar} />
      )}
      <Footer />
    </Box>
  );
}