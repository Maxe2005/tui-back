import { useEffect, useState } from 'react';
import { Box, useWindowSize } from 'ink';
import type { ResolveTabVisibilityData } from '../../../core/edt/resolve-tab-visibility.js';
import { CommandBar } from './shared/command-bar.js';
import { BoundsProvider } from './shared/bounds/bounds-context.js';
import { SHELL_FIXED_ROWS, formatTooSmallMessage, isTerminalTooSmall } from './shared/bounds/bounds.js';
import { ClampedParagraph, TruncatedText } from './shared/components/truncated-text.js';
import { Footer, footerRowsFor, useFooterItems } from './shared/components/footer.js';
import { InputGate, useInput } from './shared/hooks/use-input.js';
import { KeybindingHelp } from './shared/components/keybinding-help.js';
import { TopBar } from './shared/components/top-bar.js';
import { ZoneTabBar } from './shared/components/zone-tab-bar.js';
import { RepoRegistryScreen } from './shared/repo-registry-screen.js';
import { ResetScreen } from './shared/reset-screen.js';
import { SettingsScreen } from './shared/settings-screen.js';
import { useFooterContext } from './shared/hooks/use-footer-context.js';
import { resolveFocusStep } from './shared/keys/focus-navigation.js';
import { colors } from './shared/theme/theme.js';
import { useAppStore, type AppStore, type AppState } from './store/app-store.js';
import { getZoneScreen } from './zones/index.js';
import { ALL_ZONE_IDS, ZONES, nextZoneId, resolveReachableZones, zoneGatedStatus, type ZoneId } from './zones/zones.js';
import { boundaryOrientation, hasResizableBoundary } from './zones/zone-layouts.js';

// The Ctrl+W keyboard resize-mode's per-keypress step: ~12 positions across the
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

// `reachable` defaults to every zone. A mnemonic whose zone isn't in `reachable` (it's
// currently `omitted`) resolves to null and does nothing; a `disabled` zone stays reachable and
// is landed on as normal.
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

// `Left`/`Right` directly switch the active zone to the previous/next zone in `ZONES` order,
// wrapping at the ends — no mode to enter first, gated exactly like `shouldSwitchZone`'s
// mnemonic dispatch. `reachable` is forwarded to `nextZoneId`.
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

// Ctrl+W engages resize-mode in any zone whose layout declares at least one boundary — a no-op
// in a single-pane zone. Ink delivers a ctrl+letter combo as `input === '<letter>'` with `key.ctrl: true` (see ink's
// parse-keypress.js), never a distinct `key` flag of its own.
export function shouldEnterResizeMode(
  input: string,
  key: { ctrl?: boolean },
  activeZone: ZoneId,
): boolean {
  return key.ctrl === true && input === 'w' && hasResizableBoundary(activeZone);
}

// The arrow axis follows the boundary's declared orientation: `←`/`→` for a vertical boundary,
// `↑`/`↓` for a horizontal one.
export function isVerticalResizeBoundary(zone: ZoneId, boundaryIndex: number): boolean {
  return boundaryOrientation(zone, boundaryIndex) === 'vertical';
}

// Returns the signed step to apply to the targeted boundary's ratio, or null when the
// keypress doesn't move it (letting the caller fall through to Tab/Enter/Esc handling).
export function resolveResizeStep(
  key: { upArrow?: boolean; downArrow?: boolean; leftArrow?: boolean; rightArrow?: boolean },
  zone: ZoneId,
  targetBoundary: number,
): number | null {
  if (isVerticalResizeBoundary(zone, targetBoundary)) {
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

// Enter or Esc both exit resize-mode with no separate save step — every boundary move was
// already applied and persisted live.
export function shouldExitResizeMode(key: { return?: boolean; escape?: boolean }): boolean {
  return key.return === true || key.escape === true;
}

// The active zone falling to `omitted` (a registry change removed the only carrying repo while
// that gated zone was active) has no explanatory message to show in place — unlike a mere
// disable, it forces navigation back to Dashboard.
export function shouldFallbackToDashboard(
  activeZone: ZoneId,
  tabVisibility: ResolveTabVisibilityData,
): boolean {
  return zoneGatedStatus(activeZone, tabVisibility) === 'omitted';
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
  const updateRunning = useStore((state) => state.updateStatus === 'running');
  const updateIncidents = useStore((state) => state.incidents.length);
  const setActiveZone = useStore((state) => state.setActiveZone);
  const helpOpen = useStore((state) => state.helpOpen);
  const openHelp = useStore((state) => state.openHelp);
  const closeHelp = useStore((state) => state.closeHelp);
  // The registry screen's open/close flag lives in the store (not local AppShell state) so
  // both the `registry` command and Dashboard's empty-registry prompt can trigger it.
  const registryScreenOpen = useStore((state) => state.registryScreenOpen);
  const closeRegistryScreen = useStore((state) => state.closeRegistryScreen);
  // Lives in the store so a mounted zone screen can gate its own `useInput` with
  // `{ isActive: !commandBarOpen }` — Ink dispatches every keypress to every mounted
  // `useInput` hook regardless of z-order, so a zone's key handling would otherwise fire
  // underneath the bar (see EdtsZone).
  const commandBarOpen = useStore((state) => state.commandBarOpen);
  const openCommandBar = useStore((state) => state.openCommandBar);
  const closeCommandBar = useStore((state) => state.closeCommandBar);
  // The `:settings` screen's open/close flag. Esc is not handled here: `closeSettingsScreen`
  // is SettingsScreen's own `onClose`, since only that component knows whether a tab's group
  // list is drilled in (Esc steps back rather than closing).
  const settingsScreenOpen = useStore((state) => state.settingsScreenOpen);
  const closeSettingsScreen = useStore((state) => state.closeSettingsScreen);
  const loadSettings = useStore((state) => state.loadSettings);
  // `:reset` overlay: same store-level open flag + self-contained Esc/onClose pattern as the
  // settings screen above. `resetNotice` is the one-line reason shown when `:reset` was
  // refused (a run or EDT action in progress) — no overlay opens in that case.
  const resetScreenOpen = useStore((state) => state.resetScreenOpen);
  const closeResetScreen = useStore((state) => state.closeResetScreen);
  const resetNotice = useStore((state) => state.resetNotice);
  // Manifest-gated Routes/shared-types tab visibility — loaded on mount and reloaded on
  // registry-screen close / active-EDT membership change (see the effect below and
  // app-store.ts's createEdt/switchEdt/modifyEdt).
  const tabVisibility = useStore((state) => state.tabVisibility);
  const loadTabVisibility = useStore((state) => state.loadTabVisibility);
  // Loaded once at mount so the EDTs zone's persisted boundary ratios are live before it ever
  // renders, whichever zone is visited first.
  const loadSplitterRatios = useStore((state) => state.loadSplitterRatios);
  // Same mount-once idiom — the Logs zone's filter editor and the Settings screen's Logs tab
  // both read `store.filterHistory` unconditionally, so the persisted lists must be live before
  // either is ever opened.
  const loadFilterHistory = useStore((state) => state.loadFilterHistory);
  const loadCommandHistory = useStore((state) => state.loadCommandHistory);
  const ZoneScreen = getZoneScreen(activeZone);
  const { rows, columns } = useWindowSize();
  const footerItems = useFooterItems(activeZone, useStore);
  const quitRequested = useStore((state) => state.quitRequested);

  // A single effect keyed on `registryScreenOpen` both fires the mount-time load (it starts
  // false) and reloads whenever the registry screen closes (registering may show/hide a gated
  // tab). loadTabVisibility() no-ops a call that lands while a prior one is in flight, so this
  // never races.
  useEffect(() => {
    void loadTabVisibility();
  }, [registryScreenOpen, loadTabVisibility]);

  // Load `edts` once at mount so the top bar's active-EDT topic label is correct whichever
  // zone renders first — EdtsZone still reloads whenever that zone is visited.
  useEffect(() => {
    void loadEdts();
    // Deliberately fires once on mount only, mirroring EdtsZone's own mount-once idiom.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Loaded once at app mount, whether or not the settings screen is ever opened —
  // command-bar.tsx and edts-zone.tsx read `store.settings` unconditionally, so the persisted
  // values (not the defaults) must be live before either renders.
  useEffect(() => {
    void loadSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Loaded once at app mount — the EDTs zone reads `store.splitterRatios` unconditionally, so
  // the persisted ratios (not the built-in defaults) must be live before it renders.
  useEffect(() => {
    void loadSplitterRatios();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Loaded once at app mount, same idiom as loadSplitterRatios above.
  useEffect(() => {
    void loadFilterHistory();
    void loadCommandHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The active zone going `omitted` has no explanatory message to swap to in place — unlike a
  // mere disable, force a fallback to Dashboard.
  useEffect(() => {
    if (shouldFallbackToDashboard(activeZone, tabVisibility)) {
      setActiveZone('dashboard');
    }
  }, [activeZone, tabVisibility, setActiveZone]);

  // `q` can't reach onQuit while a zone dialog has captured input (see the zoneInputCaptured
  // gate below) — a captured dialog with no cancel target of its own (the EDTs zone's forced
  // create prompt on an empty registry) calls `requestQuit()` instead. onQuit is only in scope
  // here, at the composition root's boundary, so this effect is the handoff.
  useEffect(() => {
    if (quitRequested) {
      onQuit();
    }
  }, [quitRequested, onQuit]);

  useInput((input, key) => {
    if (isTerminalTooSmall(columns, rows)) {
      return;
    }
    const state = useStore.getState();

    // An open help panel is the sole consumer of keys, so it can always be closed — even when a
    // zone dialog captured input after it opened (the zones are inert behind it meanwhile).
    if (state.helpOpen) {
      resolveHelpDispatch(input, key, state.helpOpen, openHelp, closeHelp);
      return;
    }

    // A zone-owned dialog/form sets zoneInputCaptured while it owns the keystroke — no global
    // shortcut, `?` help included, may fire while it's set. The focused Routes right pane
    // counts as captured straight from the store: the zone's own zoneInputCaptured effect lands
    // one render later, and a keypress in between must not switch zones (or quit) mid-edit.
    if (state.zoneInputCaptured || (state.activeZone === 'routes' && state.routesPaneFocus === 'detail')) {
      return;
    }

    // Ctrl+W resize-mode. Entering and dispatching within it both sit under the same overlay
    // exclusion as the zone-switch block below; entering additionally requires the active zone
    // to declare a boundary (shouldEnterResizeMode), and the Logs fullscreen preview has none.
    if (!helpOpen && !registryScreenOpen && !commandBarOpen && !settingsScreenOpen && !resetScreenOpen) {
      if (state.resizeMode !== null) {
        const boundaryStep = resolveFocusStep(input, key, 'tab');
        if (boundaryStep !== null) {
          state.cycleResizeTargetBoundary(boundaryStep);
          return;
        }
        if (shouldExitResizeMode(key)) {
          state.exitResizeMode();
          return;
        }
        const step = resolveResizeStep(key, state.resizeMode.zone, state.resizeMode.targetBoundary);
        if (step !== null) {
          const zoneRatios = state.splitterRatios[state.resizeMode.zone];
          const current = zoneRatios[state.resizeMode.targetBoundary];
          void state.setSplitterRatio(state.resizeMode.zone, state.resizeMode.targetBoundary, current + step);
        }
        // Every other key is inert while resize-mode owns input — Tab/arrows/Enter/Esc are its
        // only live bindings.
        return;
      }

      if (shouldEnterResizeMode(input, key, activeZone) && !(activeZone === 'logs' && state.logsFullscreenTarget !== null)) {
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

    // resizeMode gates this block too: while it's active, arrows resize the targeted boundary
    // (handled above) instead of switching zones. The resizeMode !== null branch above already
    // returned, so this is defensive against future reordering.
    if (
      !helpOpen &&
      !registryScreenOpen &&
      !commandBarOpen &&
      !settingsScreenOpen &&
      !resetScreenOpen &&
      state.resizeMode === null
    ) {
      // The reachable-zone set (every zone minus whichever gated tab is currently 'omitted')
      // gates both the mnemonic and the arrow-nav dispatch below — an omitted tab is never
      // landed on either way; a disabled one stays reachable.
      const reachable = resolveReachableZones(state.tabVisibility);
      const zoneId = shouldSwitchZone(input, reachable);
      if (zoneId) {
        setActiveZone(zoneId);
        return;
      }

      // While the Logs zone's pane grid owns Left/Right/Up/Down for sub-focus movement, this
      // global Left/Right zone-switch stays inert — Ink dispatches to every mounted `useInput`
      // hook, so the zone would otherwise switch out from under the pane grid. The Routes right
      // pane needs no gate here: while focused it sets zoneInputCaptured (returned above).
      const arrowZoneId = state.logsPaneGridArrowsActive ? null : resolveZoneArrowSwitch(key, activeZone, reachable);
      if (arrowZoneId) {
        setActiveZone(arrowZoneId);
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

    // Esc always closes the registry screen, regardless of its internal phase (no partial
    // back-navigation between phases).
    if (registryScreenOpen && key.escape === true) {
      closeRegistryScreen();
    }

    // The settings screen handles its own Esc (see `onClose` below): only it knows whether a
    // group is drilled in (Esc steps back) or not (Esc closes).
  });

  // The zone, its dialogs and drafts stay mounted (hidden) while the too-small screen shows, so a
  // transient shrink loses no state; InputGate keeps every handler inert meanwhile.
  const tooSmall = isTerminalTooSmall(columns, rows);

  // The command bar sits outside the zone region so it and the footer always stay visible; it
  // gets all but a few rows of the region, and the zone region (everything else) shrinks and
  // clips. The footer's real height (its wrapped hints, capped) is reserved, not assumed to be 1.
  const regionRows = Math.max(1, rows - SHELL_FIXED_ROWS - footerRowsFor(footerItems, columns));
  const commandBarRows = Math.max(3, regionRows - 4);
  const zoneRows = commandBarOpen ? Math.max(1, regionRows - commandBarRows) : regionRows;
  return (
    <InputGate disabled={tooSmall}>
      {tooSmall ? (
        <Box flexDirection="column" height={rows} overflow="hidden">
          <ClampedParagraph color={colors.warning} maxLines={rows} width={columns}>
            {formatTooSmallMessage(columns, rows)}
          </ClampedParagraph>
        </Box>
      ) : null}
      <Box flexDirection="column" height={rows} overflow="hidden" display={tooSmall ? 'none' : 'flex'}>
        <TopBar activeEdt={activeEdt} edts={edts} />
        <ZoneTabBar activeZone={activeZone} events={zoneEvents} tabVisibility={tabVisibility} updateRunning={updateRunning} updateIncidents={updateIncidents} />
        <Box flexDirection="column" flexGrow={1} flexShrink={1} minHeight={0} overflow="hidden">
          <BoundsProvider columns={columns} rows={zoneRows}>
            <ZoneScreen useStore={useStore} />
            <KeybindingHelp useStore={useStore} />
            {registryScreenOpen && <RepoRegistryScreen useStore={useStore} />}
            {settingsScreenOpen && <SettingsScreen useStore={useStore} onClose={closeSettingsScreen} />}
            {resetScreenOpen && <ResetScreen useStore={useStore} onClose={closeResetScreen} />}
            {resetNotice !== null && <TruncatedText color={colors.warning}>{resetNotice}</TruncatedText>}
          </BoundsProvider>
        </Box>
        {commandBarOpen && (
          <Box flexShrink={0} flexDirection="column" maxHeight={commandBarRows} overflow="hidden">
            <BoundsProvider columns={columns} rows={commandBarRows}>
              <CommandBar useStore={useStore} onClose={closeCommandBar} />
            </BoundsProvider>
          </Box>
        )}
        <Footer zone={activeZone} useStore={useStore} />
      </Box>
    </InputGate>
  );
}
