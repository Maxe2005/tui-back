// tui/store/slices: cross-zone navigation/chrome state — active zone, per-zone splitter
// ratios, Ctrl+W resize-mode, gated-tab visibility, and the small app-shell-level UI flags
// (help, run-in-progress, zone-input-capture, quit-request, the `:` command bar). Extracted
// from app-store.ts (see that file's header for why) — a StateCreator factory combined with
// the other slices into one Zustand store (AD-10: still exactly one store/one hook).
import type { StateCreator } from 'zustand';
import { resolveTabVisibility, DEFAULT_TAB_VISIBILITY, type ResolveTabVisibilityData } from '../../../../../core/edt/resolve-tab-visibility.js';
import { DEFAULT_LIST_RATIO, clampListRatio } from '../../shared/components/list-detail-split.js';
import { ZONES, type ZoneId } from '../../zones/zones.js';
import type { AppState, AppStoreDeps } from '../app-store.js';

export type ZoneEvents = Record<ZoneId, number>;
// Story 2.21: widened from a single ratio per zone to an array of per-boundary ratios — every
// zone has exactly one boundary (its list<->detail split) except the EDTs zone, which has
// three (see edts-zone.tsx's Design Notes: list<->detail, EDTS<->rest, EDT SERVICES<->OTHER
// SERVICES). A zone's own array length is the authoritative "how many boundaries does this
// zone have" signal — `emptyRatios()`, `loadSplitterRatios`, and `cycleResizeTargetBoundary`
// all read it off the array rather than a second hard-coded constant.
export type ZoneRatios = Record<ZoneId, number[]>;
// Story 2.21: the Ctrl+W keyboard resize-mode's single source of truth (Boundaries: "one
// store flag ... so AppShell's global gate and EdtsZone's own useInput check the same
// source"). `zone` is always 'edts' today — Ctrl+W only ever engages while the EDTs zone is
// active — kept generic so a future zone can reuse the mechanism without a shape change.
export type ResizeMode = { zone: ZoneId; targetBoundary: number } | null;

const NO_DEPS_ERROR = 'No ports wired into the TUI store';

function emptyEvents(): ZoneEvents {
  return Object.fromEntries(ZONES.map((zone) => [zone.id, 0])) as ZoneEvents;
}

// Story 2.21: every zone gets a single-entry default array (its one list<->detail boundary)
// except the EDTs zone, whose list column has 3 fixed-but-movable boundaries (Design Notes).
function emptyRatios(): ZoneRatios {
  return Object.fromEntries(
    ZONES.map((zone) => [zone.id, zone.id === 'edts' ? [DEFAULT_LIST_RATIO, DEFAULT_LIST_RATIO, DEFAULT_LIST_RATIO] : [DEFAULT_LIST_RATIO]]),
  ) as ZoneRatios;
}

export type NavigationSlice = {
  activeZone: ZoneId;
  setActiveZone: (zone: ZoneId) => void;
  zoneEvents: ZoneEvents;
  addZoneEvent: (zone: ZoneId) => void;
  splitterRatios: ZoneRatios;
  // Story 2.21: `boundaryIndex` selects which of that zone's own splitterRatios entries moves
  // (0 is every zone's list<->detail split; 1/2 also exist for the EDTs zone's own two
  // sub-splits). Persists via StatePort.writeSplitterRatios immediately — no separate save
  // step — chained like updateSettings' settingsSaveChain so concurrent moves land on disk in
  // the order they were requested rather than racing.
  setSplitterRatio: (zone: ZoneId, boundaryIndex: number, ratio: number) => Promise<void>;
  // Story 2.21: hydrates splitterRatios from state.json once at AppShell mount, mirroring
  // loadSettings(). A missing/corrupt file, or a persisted zone whose array length doesn't
  // match that zone's own boundary count, silently keeps that zone's built-in default
  // (Boundaries: "fall back to that zone's default silently").
  loadSplitterRatios: () => Promise<void>;
  resizeMode: ResizeMode;
  enterResizeMode: (zone: ZoneId) => void;
  exitResizeMode: () => void;
  // Cycles the active resize-mode's targetBoundary across however many boundaries its zone
  // has (splitterRatios[zone].length) — a no-op while resizeMode is null.
  cycleResizeTargetBoundary: () => void;
  helpOpen: boolean;
  openHelp: () => void;
  closeHelp: () => void;
  runInProgress: boolean;
  setRunInProgress: (value: boolean) => void;
  // Story 2.13: per-gated-zone tab visibility (Routes/shared-types). Defaults to 'enabled'
  // for both — the Boundaries' "default reachable state" before the first load resolves, so
  // AppShell never shows a shell-wide spinner or a flash-then-hide on mount. Loaded once on
  // mount (mirrors the EDT slice's own mount-effect idiom) and reloaded on registry-screen
  // close (Story 2.11) and active-EDT membership change (createEdt/switchEdt/modifyEdt each
  // fire-and-forget a reload on success) — never blocks AppShell's render.
  tabVisibility: ResolveTabVisibilityData;
  tabVisibilityStatus: 'idle' | 'loading' | 'error';
  tabVisibilityError: string | null;
  loadTabVisibility: () => Promise<void>;
  // Story 2.9: set by a zone while one of its own dialogs/forms has captured keyboard input
  // (create/switch-confirm/modify/branch-edit) — gates AppShell's global shortcuts (`?`,
  // zone mnemonics, `/`, `:`, `q`) so a typed character (including `?`) never leaks through
  // to a global dispatch while a text field or checklist owns the keystroke.
  zoneInputCaptured: boolean;
  setZoneInputCaptured: (value: boolean) => void;
  // Story 5.1 fix: unlike zoneInputCaptured (a full dialog capture that also blocks `?`/`/`/
  // `:`/`q`), the Logs zone's pane grid only needs Left/Right/Up/Down themselves to stop
  // meaning "switch zone" while sub-focus is moving between panes — every other global
  // shortcut (including other zones' mnemonics) must keep working. Set by LogsZone whenever
  // its own pane-focus state is 'panes' (see logs-zone.tsx); gates only
  // `resolveZoneArrowSwitch`'s dispatch in AppShell, nothing else.
  logsPaneGridArrowsActive: boolean;
  setLogsPaneGridArrowsActive: (value: boolean) => void;
  // Review patch (story 2.9): `q` is unreachable while `zoneInputCaptured` is set (it must
  // be typable into a text field), so a zone whose captured dialog has no cancel target of
  // its own — the EDTs zone's AC1 create prompt when the registry is still genuinely empty,
  // where Escape has nothing meaningful to cancel back to either — needs another way to ask
  // the composition root to quit. `requestQuit()` flips this flag; AppShell's own effect (the
  // only place `onQuit` is in scope) observes it and calls `onQuit()`, mirroring how the
  // zone-input-capture handoff between a zone and AppShell already works.
  quitRequested: boolean;
  requestQuit: () => void;
  // Story 2.14: the `:` command-entry bar's open/close flag. Lives in the store (like
  // registryScreenOpen, not local AppShell state as originally sketched) so a mounted zone
  // screen can read it too and gate its own `useInput` with `{ isActive: !commandBarOpen }`
  // — Ink dispatches every keypress to every mounted `useInput` hook regardless of z-order,
  // so without this a zone's own key handling (e.g. EdtsZone's Tab/Enter) would silently
  // fire underneath the bar (Spec Change Log, story 2.14 review finding).
  commandBarOpen: boolean;
  openCommandBar: () => void;
  closeCommandBar: () => void;
};

export function createNavigationSlice(deps?: AppStoreDeps): StateCreator<AppState, [], [], NavigationSlice> {
  // Story 2.21: serializes setSplitterRatio's persistence calls the same way settingsSaveChain
  // (settings-slice.ts) does for updateSettings — each write chains onto the previous one so
  // concurrent boundary moves (e.g. holding an arrow key) hit disk in the order they were
  // requested. Private to this slice instance (one per createAppStore() call, same lifetime
  // as it had inlined in the old single-file store).
  let splitterRatiosSaveChain: Promise<void> = Promise.resolve();
  // Review fix (story 2.21): a monotonic counter bumped on every setSplitterRatio call so a
  // slower, in-flight loadSplitterRatios (the AppShell mount-time load) can detect that a
  // newer live boundary move has landed since it started and skip clobbering it with the
  // stale value it read from disk.
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
        if (boundaryIndex < 0 || boundaryIndex >= zoneRatios.length) {
          // Out-of-range boundary index (e.g. a stale resizeMode after a zone's boundary
          // count somehow shrank): never write a sparse/invalid array.
          return {};
        }
        const nextZoneRatios = zoneRatios.map((value, index) => (index === boundaryIndex ? clampListRatio(ratio) : value));
        return { splitterRatios: { ...state.splitterRatios, [zone]: nextZoneRatios } };
      });
      // Applies to the live store synchronously above, before persistence even starts
      // (Boundaries: "every boundary move applies live and persists immediately — no separate
      // save step"). An unwired store (every pre-2.21 `createAppStore()` test call) just can't
      // persist, exactly like updateSettings' own `!deps` early return.
      if (!deps) {
        return;
      }
      const next = get().splitterRatios;
      const run = async () => {
        // Write failures are never surfaced back to the caller — the live move already
        // applied (Boundaries I/O matrix: "Write failure: move still applies live").
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
      // Review fix (story 2.21): captured before the await, mirroring loadSettings' own
      // settingsVersion guard — if a setSplitterRatio call lands (bumping the version) while
      // this read is still in flight, the result below is stale and must never overwrite the
      // newer live value with whatever was on disk before that move happened.
      const startVersion = splitterRatiosVersion;
      const result = await deps.state.readSplitterRatios();
      if (splitterRatiosVersion !== startVersion) {
        return;
      }
      if (!result.ok || result.data === null) {
        // A genuine I/O error, or a fresh/pre-2.21 machine with nothing persisted yet: keep
        // the built-in defaults already seeded into `splitterRatios` above.
        return;
      }
      const persisted = result.data;
      set((state) => {
        const next: ZoneRatios = { ...state.splitterRatios };
        for (const zone of ZONES) {
          const candidate = persisted[zone.id];
          const boundaryCount = state.splitterRatios[zone.id].length;
          // A wrong-length array for this zone falls back to its own default silently
          // (Boundaries I/O matrix: "That zone falls back to its default array only") — every
          // other zone's ratios are unaffected.
          if (Array.isArray(candidate) && candidate.length === boundaryCount) {
            next[zone.id] = candidate.map((value) => clampListRatio(value));
          }
        }
        return { splitterRatios: next };
      });
    },
    resizeMode: null,
    enterResizeMode: (zone) => set({ resizeMode: { zone, targetBoundary: 0 } }),
    exitResizeMode: () => set({ resizeMode: null }),
    cycleResizeTargetBoundary: () =>
      set((state) => {
        if (state.resizeMode === null) {
          return {};
        }
        const boundaryCount = state.splitterRatios[state.resizeMode.zone].length;
        return {
          resizeMode: {
            zone: state.resizeMode.zone,
            targetBoundary: (state.resizeMode.targetBoundary + 1) % boundaryCount,
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
