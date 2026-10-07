// tui/store/slices: cross-zone navigation/chrome state — active zone, per-zone splitter
// ratios, Ctrl+W resize-mode, gated-tab visibility, and the small app-shell-level UI flags
// (help, run-in-progress, zone-input-capture, quit-request, the `:` command bar).
import type { StateCreator } from 'zustand';
import { resolveTabVisibility, DEFAULT_TAB_VISIBILITY, type ResolveTabVisibilityData } from '../../../../../core/edt/resolve-tab-visibility.js';
import { boundaryCount, clampBoundaryRatio, defaultZoneRatios, hasResizableBoundary } from '../../zones/zone-layouts.js';
import { ZONES, type ZoneId } from '../../zones/zones.js';
import type { AppState, AppStoreDeps } from '../app-store.js';

export type ZoneEvents = Record<ZoneId, number>;
// One ratio per boundary, per zone. The zone layout specs (zones/zone-layouts.ts) are the
// authoritative boundary count, orientation, default and min/max — never the array length.
export type ZoneRatios = Record<ZoneId, number[]>;
// The Ctrl+W keyboard resize-mode's single source of truth, so AppShell's global gate and
// every zone's own useInput check the same flag.
export type ResizeMode = { zone: ZoneId; targetBoundary: number } | null;

const NO_DEPS_ERROR = 'No ports wired into the TUI store';

function emptyEvents(): ZoneEvents {
  return Object.fromEntries(ZONES.map((zone) => [zone.id, 0])) as ZoneEvents;
}

function emptyRatios(): ZoneRatios {
  return Object.fromEntries(ZONES.map((zone) => [zone.id, defaultZoneRatios(zone.id)])) as ZoneRatios;
}

export type NavigationSlice = {
  activeZone: ZoneId;
  setActiveZone: (zone: ZoneId) => void;
  zoneEvents: ZoneEvents;
  addZoneEvent: (zone: ZoneId) => void;
  splitterRatios: ZoneRatios;
  // `boundaryIndex` selects which of that zone's declared boundaries moves; the ratio is clamped
  // to that boundary's own min/max. Persists via
  // StatePort.writeSplitterRatios immediately — no separate save step — chained like
  // updateSettings' settingsSaveChain so concurrent moves land on disk in request order.
  setSplitterRatio: (zone: ZoneId, boundaryIndex: number, ratio: number) => Promise<void>;
  // Hydrates splitterRatios from state.json once at AppShell mount, mirroring loadSettings().
  // A missing/corrupt file, or a persisted zone whose array length doesn't match that zone's
  // declared boundary count, silently keeps that zone's spec defaults.
  loadSplitterRatios: () => Promise<void>;
  resizeMode: ResizeMode;
  // A no-op for a zone declaring no boundary.
  enterResizeMode: (zone: ZoneId) => void;
  exitResizeMode: () => void;
  // Cycles the active resize-mode's targetBoundary across its zone's declared boundaries — a
  // no-op while resizeMode is null.
  cycleResizeTargetBoundary: () => void;
  helpOpen: boolean;
  openHelp: () => void;
  closeHelp: () => void;
  runInProgress: boolean;
  setRunInProgress: (value: boolean) => void;
  // Per-gated-zone tab visibility (Routes/shared-types). Defaults to 'enabled' for both before
  // the first load resolves, so AppShell never shows a spinner or a flash-then-hide on mount.
  // Loaded once on mount and reloaded on registry-screen close and active-EDT membership
  // change (createEdt/switchEdt/modifyEdt fire-and-forget a reload) — never blocks rendering.
  tabVisibility: ResolveTabVisibilityData;
  tabVisibilityStatus: 'idle' | 'loading' | 'error';
  tabVisibilityError: string | null;
  loadTabVisibility: () => Promise<void>;
  // Set by a zone while one of its dialogs/forms has captured keyboard input — gates
  // AppShell's global shortcuts (`?`, zone mnemonics, `/`, `:`, `q`) so a typed character
  // never leaks through to a global dispatch while a text field or checklist owns the key.
  zoneInputCaptured: boolean;
  setZoneInputCaptured: (value: boolean) => void;
  // Unlike zoneInputCaptured (a full capture that also blocks `?`/`/`/`:`/`q`), the Logs
  // zone's pane grid only needs Left/Right/Up/Down to stop meaning "switch zone" while
  // sub-focus moves between panes — every other global shortcut keeps working. Set by LogsZone
  // while its pane-focus is 'panes'; gates only `resolveZoneArrowSwitch` in AppShell.
  logsPaneGridArrowsActive: boolean;
  setLogsPaneGridArrowsActive: (value: boolean) => void;
  // `q` is unreachable while `zoneInputCaptured` is set (it must be typable into a text
  // field), so a captured dialog with no cancel target of its own — the EDTs zone's create
  // prompt on a genuinely empty registry — needs another way to ask the composition root to
  // quit. `requestQuit()` flips this flag; AppShell's effect (the only place `onQuit` is in
  // scope) observes it and calls `onQuit()`.
  quitRequested: boolean;
  requestQuit: () => void;
  // The `:` command bar's open/close flag. In the store so a mounted zone screen can gate its
  // own `useInput` with `{ isActive: !commandBarOpen }` — Ink dispatches every keypress to
  // every mounted `useInput` hook regardless of z-order, so a zone's own key handling (e.g.
  // EdtsZone's Tab/Enter) would otherwise fire underneath the bar.
  commandBarOpen: boolean;
  openCommandBar: () => void;
  closeCommandBar: () => void;
};

export function createNavigationSlice(deps?: AppStoreDeps): StateCreator<AppState, [], [], NavigationSlice> {
  // Serializes setSplitterRatio's persistence calls like settingsSaveChain does for
  // updateSettings — each write chains onto the previous one so concurrent boundary moves
  // (e.g. holding an arrow key) hit disk in request order. Private to this slice instance.
  let splitterRatiosSaveChain: Promise<void> = Promise.resolve();
  // A monotonic counter bumped on every setSplitterRatio call so a slower, in-flight
  // loadSplitterRatios (the AppShell mount-time load) can detect that a newer live boundary
  // move landed since it started and skip clobbering it with the stale value from disk.
  let splitterRatiosVersion = 0;

  return (set, get) => ({
    activeZone: 'dashboard',
    setActiveZone: (zone) =>
      set((state) => ({
        activeZone: zone,
        zoneEvents: { ...state.zoneEvents, [zone]: 0 },
      })),
    zoneEvents: emptyEvents(),
    addZoneEvent: (zone) =>
      set((state) => ({
        zoneEvents: {
          ...state.zoneEvents,
          [zone]: state.zoneEvents[zone] + 1,
        },
      })),
    splitterRatios: emptyRatios(),
    setSplitterRatio: async (zone, boundaryIndex, ratio) => {
      splitterRatiosVersion += 1;
      set((state) => {
        const zoneRatios = state.splitterRatios[zone];
        if (boundaryIndex < 0 || boundaryIndex >= boundaryCount(zone) || boundaryIndex >= zoneRatios.length) {
          // Out-of-range boundary index (e.g. a stale resizeMode after a zone's boundary
          // count somehow shrank): never write a sparse/invalid array.
          return {};
        }
        const nextZoneRatios = zoneRatios.map((value, index) => (index === boundaryIndex ? clampBoundaryRatio(zone, boundaryIndex, ratio) : value));
        return { splitterRatios: { ...state.splitterRatios, [zone]: nextZoneRatios } };
      });
      // Applies to the live store synchronously above, before persistence even starts — no
      // separate save step. An unwired store just can't persist, like updateSettings' own
      // `!deps` early return.
      if (!deps) {
        return;
      }
      const next = get().splitterRatios;
      const run = async () => {
        // Write failures are never surfaced back to the caller — the live move already
        // applied.
        await deps.state.writeSplitterRatios(next);
      };
      const chained = splitterRatiosSaveChain.then(run, run);
      splitterRatiosSaveChain = chained;
      await chained;
    },
    loadSplitterRatios: async () => {
      if (!deps) {
        return;
      }
      // Captured before the await, like loadSettings' settingsVersion guard — if a
      // setSplitterRatio call lands (bumping the version) while this read is in flight, the
      // result below is stale and must never overwrite the newer live value.
      const startVersion = splitterRatiosVersion;
      const result = await deps.state.readSplitterRatios();
      if (splitterRatiosVersion !== startVersion) {
        return;
      }
      if (!result.ok || result.data === null) {
        // A genuine I/O error, or nothing persisted yet: keep the built-in defaults already
        // seeded into `splitterRatios` above.
        return;
      }
      const persisted = result.data;
      set((state) => {
        const next: ZoneRatios = { ...state.splitterRatios };
        for (const zone of ZONES) {
          const candidate = persisted[zone.id];
          // A wrong-length array for this zone falls back to its own default silently — every
          // other zone's ratios are unaffected.
          if (Array.isArray(candidate) && candidate.length === boundaryCount(zone.id)) {
            next[zone.id] = candidate.map((value, index) => clampBoundaryRatio(zone.id, index, value));
          }
        }
        return { splitterRatios: next };
      });
    },
    resizeMode: null,
    enterResizeMode: (zone) => {
      if (hasResizableBoundary(zone)) {
        set({ resizeMode: { zone, targetBoundary: 0 } });
      }
    },
    exitResizeMode: () => set({ resizeMode: null }),
    cycleResizeTargetBoundary: () =>
      set((state) => {
        if (state.resizeMode === null) {
          return {};
        }
        const count = boundaryCount(state.resizeMode.zone);
        if (count === 0) {
          return { resizeMode: null };
        }
        return {
          resizeMode: {
            zone: state.resizeMode.zone,
            targetBoundary: (state.resizeMode.targetBoundary + 1) % count,
          },
        };
      }),
    helpOpen: false,
    openHelp: () => set({ helpOpen: true }),
    closeHelp: () => set({ helpOpen: false }),
    runInProgress: false,
    setRunInProgress: (value: boolean) => set({ runInProgress: value }),
    tabVisibility: DEFAULT_TAB_VISIBILITY,
    tabVisibilityStatus: 'idle',
    tabVisibilityError: null,
    loadTabVisibility: async () => {
      if (!deps) {
        set({ tabVisibilityStatus: 'error', tabVisibilityError: NO_DEPS_ERROR });
        return;
      }
      if (get().tabVisibilityStatus === 'loading') {
        return;
      }
      set({ tabVisibilityStatus: 'loading', tabVisibilityError: null });
      const result = await resolveTabVisibility({
        registry: deps.registry,
        manifest: deps.manifest,
        edtRegistry: deps.edtRegistry,
        state: deps.state,
      });
      if (result.ok) {
        set({ tabVisibility: result.data, tabVisibilityStatus: 'idle', tabVisibilityError: null });
      } else {
        // Never reset tabVisibility to a hiding/dimming value on a transient load failure —
        // keep whatever was last known-good (or the 'enabled' default on a first-load
        // failure) rather than falsely omitting/disabling a real capability.
        set({ tabVisibilityStatus: 'error', tabVisibilityError: result.error.message });
      }
    },
    zoneInputCaptured: false,
    setZoneInputCaptured: (value) => set({ zoneInputCaptured: value }),
    logsPaneGridArrowsActive: false,
    setLogsPaneGridArrowsActive: (value) => set({ logsPaneGridArrowsActive: value }),
    quitRequested: false,
    requestQuit: () => set({ quitRequested: true }),
    commandBarOpen: false,
    openCommandBar: () => set({ commandBarOpen: true }),
    closeCommandBar: () => set({ commandBarOpen: false }),
  });
}
