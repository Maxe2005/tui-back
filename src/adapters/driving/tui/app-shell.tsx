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
import { ResetScreen } from './shared/reset-screen.js';
import { SettingsScreen } from './shared/settings-screen.js';
import { colors } from './shared/theme/theme.js';
import { useAppStore, type AppStore, type AppState } from './store/app-store.js';
import { getZoneScreen } from './zones/index.js';
import { ALL_ZONE_IDS, ZONES, nextZoneId, resolveReachableZones, zoneGatedStatus, type ZoneId } from './zones/zones.js';

// Story 2.21: the Ctrl+W keyboard resize-mode's per-keypress step — an implementation choice
// (Design Notes: "pick something responsive"), ~12 positions across the
// MIN_LIST_RATIO..MAX_LIST_RATIO (0.2..0.8) clamp range.
export const RESIZE_STEP = 0.05;

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

// Story 2.21: Ctrl+W engages resize-mode only while the EDTs zone is active (Boundaries:
// "Ctrl+W engages resize-mode only while the EDT zone is active — a no-op elsewhere"). Ink
// delivers a ctrl+letter combo as `input === '<letter>'` with `key.ctrl: true` (confirmed
// against ink's own parse-keypress.js), never a distinct `key` flag of its own.
export function shouldEnterResizeMode(
  input: string,
  key: { ctrl?: boolean },
  activeZone: ZoneId,
): boolean {
  return key.ctrl === true && input === 'w' && activeZone === 'edts';
}

// Story 2.21: boundary 0 is always the vertical list<->detail split (Design Notes) — every
// other boundary (1, 2, ... for a future multi-boundary zone) is one of that zone's own
// horizontal sub-splits. Arrow-key axis follows the boundary's own orientation: `←`/`→` for
// the vertical boundary, `↑`/`↓` for a horizontal one (AC: "on a horizontal boundary, ↑/↓
// moves it ... on the vertical boundary, ←/→ does likewise").
export function isVerticalResizeBoundary(boundaryIndex: number): boolean {
  return boundaryIndex === 0;
}

// Returns the signed step to apply to the targeted boundary's ratio, or null when the
// keypress doesn't move it (letting the caller fall through to Tab/Enter/Esc handling).
export function resolveResizeStep(
  key: { upArrow?: boolean; downArrow?: boolean; leftArrow?: boolean; rightArrow?: boolean },
  targetBoundary: number,
): number | null {
  if (isVerticalResizeBoundary(targetBoundary)) {
    if (key.leftArrow) {
      return -RESIZE_STEP;
    }
    if (key.rightArrow) {
      return RESIZE_STEP;
    }
    return null;
  }
  if (key.upArrow) {
    return -RESIZE_STEP;
  }
  if (key.downArrow) {
    return RESIZE_STEP;
  }
  return null;
}

// Enter or Esc both exit resize-mode with no separate save step (AC: "Enter or Esc exits with
// no separate save step") — every boundary move already applied/persisted live as it happened.
export function shouldExitResizeMode(key: { return?: boolean; escape?: boolean }): boolean {
  return key.return === true || key.escape === true;
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
  return input === 'q' && !state.runInProgress && state.settings.general.quitShortcutEnabled;
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
  // `:reset` overlay: same store-level open flag + self-contained Esc/onClose pattern as the
  // settings screen above. `resetNotice` is the one-line reason shown when `:reset` was
  // refused (a run or EDT action in progress) — no overlay opens in that case.
  const resetScreenOpen = useStore((state) => state.resetScreenOpen);
  const closeResetScreen = useStore((state) => state.closeResetScreen);
  const resetNotice = useStore((state) => state.resetNotice);
  // Story 2.13: manifest-gated Routes/shared-types tab visibility — loaded once on mount and
  // reloaded on registry-screen close / active-EDT membership change (see the effect below
  // and app-store.ts's createEdt/switchEdt/modifyEdt).
  const tabVisibility = useStore((state) => state.tabVisibility);
  const loadTabVisibility = useStore((state) => state.loadTabVisibility);
  // Story 2.21: loaded once at mount (mirrors loadSettings' own mount-once idiom below) so the
  // EDTs zone's persisted boundary ratios are live before it ever renders, independent of
  // whether the EDTs zone is the first one visited.
  const loadSplitterRatios = useStore((state) => state.loadSplitterRatios);
  // Story 5.4: same mount-once idiom — the Logs zone's filter editor and the Settings screen's
  // Logs tab both read `store.filterHistory` unconditionally (arrow-recall/grid-browse and the
  // clear actions), so the persisted lists must be live before either is ever opened
  // (RESTART_PERSIST: "loaded from state.json on the next filter-editor open").
  const loadFilterHistory = useStore((state) => state.loadFilterHistory);
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

  // Story 2.21 (I/O matrix "App restart after a boundary move"): loaded once at app mount,
  // same mount-once idiom as loadSettings above — the EDTs zone reads `store.splitterRatios`
  // unconditionally, so the persisted ratios (not the built-in defaults) must be live before
  // it ever renders.
  useEffect(() => {
    void loadSplitterRatios();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Story 5.4 (I/O matrix RESTART_PERSIST): loaded once at app mount, same mount-once idiom as
  // loadSplitterRatios above.
  useEffect(() => {
    void loadFilterHistory();
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
    // Story 6.9: the focused Routes right pane counts as captured straight from the store —
    // the zone's own zoneInputCaptured effect lands one render later, and a keypress in
    // between must not switch zones (or quit) mid-edit.
    if (state.zoneInputCaptured || (state.activeZone === 'routes' && state.routesPaneFocus === 'detail')) {
      return;
    }

    // Story 2.21: Ctrl+W resize-mode. Entering and dispatching within it both live under the
    // same overlay exclusion as the zone-switch block below (Boundaries: "Ctrl+W under any
    // overlay ... no-op"); entering additionally requires the EDTs zone to be active
    // (shouldEnterResizeMode).
    if (!helpOpen && !filterOpen && !registryScreenOpen && !commandBarOpen && !settingsScreenOpen && !resetScreenOpen) {
      if (state.resizeMode !== null) {
        if (key.tab) {
          state.cycleResizeTargetBoundary();
          return;
        }
        if (shouldExitResizeMode(key)) {
          state.exitResizeMode();
          return;
        }
        const step = resolveResizeStep(key, state.resizeMode.targetBoundary);
        if (step !== null) {
          const zoneRatios = state.splitterRatios[state.resizeMode.zone];
          const current = zoneRatios[state.resizeMode.targetBoundary];
          void state.setSplitterRatio(state.resizeMode.zone, state.resizeMode.targetBoundary, current + step);
        }
        // Every other key is inert while resize-mode owns input — Tab/arrows/Enter/Esc are
        // its only live bindings (AC: "the targeted boundary recolors to accent, and same-key
        // global shortcuts go inert").
        return;
      }

      if (shouldEnterResizeMode(input, key, activeZone)) {
        state.enterResizeMode(activeZone);
        return;
      }
    }

    // Skip help dispatch entirely while the registry screen, the command bar, or the settings
    // screen is open — each owns its own keystroke capture (the registry's root-path field,
    // the bar's command query, the settings screen's tab/value navigation), so `?` typed there
    // must land as a literal character (or, for settings, simply not open help on top of it),
    // never also pop the keybinding-help modal on top of the overlay. Mirrors how the registry
    // screen's own Esc-close below is gated on registryScreenOpen.
    if (!registryScreenOpen && !commandBarOpen && !settingsScreenOpen && !resetScreenOpen) {
      resolveHelpDispatch(input, key, state.helpOpen, openHelp, closeHelp);
    }

    // Story 2.21 (deferred-work.md, tracked_by this story): resizeMode gates this block too —
    // while it's active, arrows resize the targeted boundary (handled above) rather than
    // switching zones, and every other shortcut here goes inert alongside it. In practice
    // this is always true by the time execution reaches here (the resizeMode !== null branch
    // above already returned), but the explicit check keeps this block's own guard
    // self-documenting/defensive against future reordering.
    if (
      !helpOpen &&
      !filterOpen &&
      !registryScreenOpen &&
      !commandBarOpen &&
      !settingsScreenOpen &&
      !resetScreenOpen &&
      state.resizeMode === null
    ) {
      // Story 2.13: the reachable-zone set (every zone minus whichever gated tab is
      // currently 'omitted') gates both the mnemonic and the arrow-nav dispatch below —
      // an omitted tab is never landed on either way; a disabled one stays reachable.
      const reachable = resolveReachableZones(state.tabVisibility);
      const zoneId = shouldSwitchZone(input, reachable);
      if (zoneId) {
        setActiveZone(zoneId);
        return;
      }

      // Story 5.1 fix: while the Logs zone's pane grid owns Left/Right/Up/Down for sub-focus
      // movement, this global Left/Right zone-switch must stay inert — otherwise every
      // mounted `useInput` hook (Ink dispatches to all of them, not just the topmost) fires
      // on the same keypress and the zone switches out from under the pane grid before its
      // own handler's `setSubFocus` even matters.
      // Story 6.7/6.9: the Routes right pane needs no gate here — while it holds focus it
      // sets zoneInputCaptured (returned above), so its arrows never switch zones.
      const arrowZoneId = state.logsPaneGridArrowsActive ? null : resolveZoneArrowSwitch(key, activeZone, reachable);
      if (arrowZoneId) {
        setActiveZone(arrowZoneId);
        return;
      }

      // The Routes zone likewise owns `/` (its inline route filter).
      // Story 5.2: the Logs zone owns `/` itself (its own global-filter editor) while it's
      // the active zone — without this guard, this app-wide filter stub would also fire on
      // the same keystroke (Ink dispatches to every mounted `useInput` hook), the same
      // double-dispatch hazard already solved for arrow keys via `logsPaneGridArrowsActive`.
      if (activeZone !== 'logs' && activeZone !== 'routes' && shouldOpenFilter(input)) {
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
      {resetScreenOpen && <ResetScreen useStore={useStore} onClose={closeResetScreen} />}
      {resetNotice !== null && <Text color={colors.warning}>{resetNotice}</Text>}
      {commandBarOpen && (
        <CommandBar useStore={useStore} onClose={closeCommandBar} />
      )}
      <Footer />
    </Box>
  );
}