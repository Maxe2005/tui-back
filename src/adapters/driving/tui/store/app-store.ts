import { create } from 'zustand';
import type { UseBoundStore, StoreApi } from 'zustand';
import {
  listEdtBranchesDivergence,
  type BranchDivergenceEntryError,
  type ServiceBranchDivergence,
} from '../../../../core/edt/list.js';
import type { EdtRegistryPort } from '../../../../core/ports/edt-registry.js';
import type { GitPort } from '../../../../core/ports/git.js';
import type { ManifestPort } from '../../../../core/ports/manifest.js';
import type { RegistryPort } from '../../../../core/ports/registry.js';
import type { StatePort } from '../../../../core/ports/state.js';
import {
  DEFAULT_LIST_RATIO,
  clampListRatio,
} from '../shared/components/list-detail-split.js';
import { ZONES, type ZoneId } from '../zones/zones.js';

export type AppStore = UseBoundStore<StoreApi<AppState>>;

export type ZoneEvents = Record<ZoneId, number>;
export type ZoneRatios = Record<ZoneId, number>;

// Story 2.6: the ports createAppStore closes over to run core use-cases in-process (AD-2) —
// the same ones src/bin/main.ts's CLI composition root builds, mirrored by src/bin/tui.ts.
// Optional so every pre-existing `createAppStore()` call (tests, and the module-level
// `useAppStore` default below) keeps working unwired; loadEdtsBranches degrades to an
// explicit error state rather than throwing when no deps were supplied.
export type AppStoreDeps = {
  registry: RegistryPort;
  manifest: ManifestPort;
  git: GitPort;
  edtRegistry: EdtRegistryPort;
  state: StatePort;
};

export type AppState = {
  activeZone: ZoneId;
  setActiveZone: (zone: ZoneId) => void;
  zoneEvents: ZoneEvents;
  addZoneEvent: (zone: ZoneId) => void;
  splitterRatios: ZoneRatios;
  setSplitterRatio: (zone: ZoneId, ratio: number) => void;
  activeEdt: string | null;
  setActiveEdt: (edt: string | null) => void;
  helpOpen: boolean;
  openHelp: () => void;
  closeHelp: () => void;
  launchBannerShown: boolean;
  markLaunchBannerShown: () => void;
  runInProgress: boolean;
  setRunInProgress: (value: boolean) => void;
  // Story 2.6 (FR-9): the EDTs zone's branch/divergence listing. `edtsBranches` is null only
  // before the first successful load; a successful (possibly empty) load always replaces it
  // with an array, never leaves a stale one in place mid-refresh (Design Notes: "refreshed
  // on-demand ... not cached indefinitely"). `edtsBranchesStatus` reflects only the in-flight
  // request itself ('loading') or its failure ('error') — a successful load returns to
  // 'idle', with `edtsBranches` (not the status) carrying the "loaded" signal.
  edtsBranches: ServiceBranchDivergence[] | null;
  edtsBranchesStatus: 'idle' | 'loading' | 'error';
  edtsBranchesError: string | null;
  // Review patch: listEdtBranchesDivergence's `unreachable`/`errors` were computed but
  // dropped — only `services` made it into the store, so a real registry-listing problem
  // (a stat failure, an unreachable registered path) was silently invisible in the TUI even
  // though the CLI's `tui-back edts` already surfaces both. Populated alongside
  // `edtsBranches` on every successful load; like `edtsBranches`, left as the last
  // successfully-loaded value on a failed reload (the zone gates display on
  // `edtsBranchesStatus !== 'error'`, same as it does for the row list).
  edtsUnreachable: string[];
  edtsErrors: BranchDivergenceEntryError[];
  loadEdtsBranches: () => Promise<void>;
};

function emptyEvents(): ZoneEvents {
  return Object.fromEntries(ZONES.map((zone) => [zone.id, 0])) as ZoneEvents;
}

function emptyRatios(): ZoneRatios {
  return Object.fromEntries(
    ZONES.map((zone) => [zone.id, DEFAULT_LIST_RATIO]),
  ) as ZoneRatios;
}

export function createAppStore(deps?: AppStoreDeps) {
  return create<AppState>()((set, get) => ({
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
    setSplitterRatio: (zone, ratio) =>
      set((state) => ({
        splitterRatios: {
          ...state.splitterRatios,
          [zone]: clampListRatio(ratio),
        },
      })),
    activeEdt: null,
    setActiveEdt: (edt) => set({ activeEdt: edt }),
    helpOpen: false,
    openHelp: () => set({ helpOpen: true }),
    closeHelp: () => set({ helpOpen: false }),
    launchBannerShown: false,
    markLaunchBannerShown: () => set({ launchBannerShown: true }),
    runInProgress: false,
    setRunInProgress: (value: boolean) => set({ runInProgress: value }),
    edtsBranches: null,
    edtsBranchesStatus: 'idle',
    edtsBranchesError: null,
    edtsUnreachable: [],
    edtsErrors: [],
    loadEdtsBranches: async () => {
      // A no-op-with-signal guard, not a throw: an unwired store (every pre-2.6 `createAppStore()`
      // call, including tests) must stay usable — it just can never actually load.
      if (!deps) {
        set({ edtsBranchesStatus: 'error', edtsBranchesError: 'No ports wired into the TUI store' });
        return;
      }
      // Avoid a duplicate concurrent fetch (e.g. an effect re-firing) racing this one.
      if (get().edtsBranchesStatus === 'loading') {
        return;
      }
      set({ edtsBranchesStatus: 'loading', edtsBranchesError: null });
      const result = await listEdtBranchesDivergence({
        registry: deps.registry,
        manifest: deps.manifest,
        git: deps.git,
        edtRegistry: deps.edtRegistry,
        state: deps.state,
      });
      if (result.ok) {
        set({
          edtsBranches: result.data.services,
          edtsUnreachable: result.data.unreachable,
          edtsErrors: result.data.errors,
          edtsBranchesStatus: 'idle',
          edtsBranchesError: null,
        });
      } else {
        set({ edtsBranchesStatus: 'error', edtsBranchesError: result.error.message });
      }
    },
  }));
}

export const useAppStore = createAppStore();

