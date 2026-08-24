import { create } from 'zustand';
import type { UseBoundStore, StoreApi } from 'zustand';
import {
  listEdtBranchesDivergence,
  type BranchDivergenceEntryError,
  type ServiceBranchDivergence,
} from '../../../../core/edt/list.js';
import type { EdtRegistryPort } from '../../../../core/ports/edt-registry.js';
import type { GitPort } from '../../../../core/ports/git.js';
import type { LockPort } from '../../../../core/ports/lock.js';
import type { ManifestPort } from '../../../../core/ports/manifest.js';
import type { RegistryPort, ScanResult } from '../../../../core/ports/registry.js';
import type { StatePort } from '../../../../core/ports/state.js';
import { registerRepo } from '../../../../core/scripts/register.js';
import { scanRepos } from '../../../../core/scripts/scan.js';
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
  // Story 2.11: the repo registry screen's register step reuses Story 1.5's registerRepo
  // use-case as-is (AD-2), which needs both a LockPort and a resource key for its
  // withActionLock call — mirrors src/bin/main.ts:39-44's CLI composition root.
  lock: LockPort;
  registryResourceKey: string;
};

// Story 2.11: a per-path register outcome, classified by snapshotting registry.list()
// before registering and diffing against it — registerRepo/registry.add are idempotent and
// never signal new-vs-existing on their own (see adapters/driven/registry/index.ts:78-98).
export type RegistryOutcome = 'registered' | 'already-registered' | 'failed';

export type RegistryRegisterResult = {
  path: string;
  outcome: RegistryOutcome;
  detail?: string;
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
  // Story 2.11: repo registry screen — reachable via the `:` command palette and
  // auto-offered from Dashboard's empty-registry prompt (a single store-level open/close
  // flag, not local AppShell state, so both call sites can trigger it).
  registryScreenOpen: boolean;
  openRegistryScreen: () => void;
  closeRegistryScreen: () => void;
  // Bumped by resetRegistryScreen (and therefore by openRegistryScreen, which always calls
  // it) — scanRegistryRoot/registerRegistryCandidates/checkRegistryEmpty each capture this at
  // the start of their async work and no-op their terminal `set()` if it has moved on by the
  // time they resolve, so a stale in-flight call from a superseded session (screen closed and
  // reopened, or reset, while the call was still pending) can never overwrite fresher state.
  registrySessionId: number;
  // Dashboard's "no repos registered yet" prompt (checked before any other Dashboard
  // content). null = not yet checked — Dashboard falls back to its existing content rather
  // than assuming empty. dashboard-zone.tsx re-checks on mount and again whenever
  // registryScreenOpen flips, so the prompt never reflects a stale cached registry state
  // after the registry screen closes (whether or not that closing also switched zones).
  registryEmpty: boolean | null;
  registryEmptyStatus: 'idle' | 'loading' | 'error';
  checkRegistryEmpty: () => Promise<void>;
  // registryScanResult: null = not scanned yet this screen session; a `candidates: []`
  // result is the distinct "nothing found" state (never conflated with
  // registryScanStatus === 'error', a genuine scan failure e.g. root not found).
  registryScanStatus: 'idle' | 'loading' | 'error';
  registryScanError: string | null;
  registryScanResult: ScanResult | null;
  scanRegistryRoot: (root: string) => Promise<void>;
  // registryRegisterResults: null = not registered yet this screen session; populated once,
  // one entry per selected path, in the order registration was attempted.
  registryRegisterStatus: 'idle' | 'loading';
  registryRegisterResults: RegistryRegisterResult[] | null;
  registerRegistryCandidates: (paths: string[]) => Promise<void>;
  // Clears scan/register state back to a fresh root-input session — called once on every
  // registry-screen mount so a closed-then-reopened screen (or a second, later `:` open)
  // never shows a stale phase/result from the prior session.
  resetRegistryScreen: () => void;
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
    registryScreenOpen: false,
    // Resets scan/register state as part of opening (not a component mount effect) so the
    // reset is atomic with becoming visible — a render seeded with a specific phase's state
    // is never raced by a separate post-mount reset back to root-input.
    openRegistryScreen: () => {
      get().resetRegistryScreen();
      set({ registryScreenOpen: true });
    },
    closeRegistryScreen: () => set({ registryScreenOpen: false }),
    registrySessionId: 0,
    registryEmpty: null,
    registryEmptyStatus: 'idle',
    checkRegistryEmpty: async () => {
      if (!deps) {
        // Deliberately a true no-op — unlike loadEdtsBranches/scanRegistryRoot/
        // registerRegistryCandidates, whose `!deps` path surfaces an explicit error status.
        // Dashboard is the app's always-mounted default zone and calls this on every mount,
        // so treating "store not wired" (a test-scaffolding-only condition — bin/tui.ts's
        // composition root always wires deps) as a genuine registry.list() failure would
        // paint a permanent bogus error banner over Dashboard for every incidental,
        // registry-unrelated test using a bare createAppStore(). registryEmptyStatus stays
        // whatever it already was; a real listing failure (deps wired, list() erroring) is
        // still handled below and does flip to 'error'.
        return;
      }
      const sessionId = get().registrySessionId;
      set({ registryEmptyStatus: 'loading' });
      const result = await deps.registry.list();
      if (get().registrySessionId !== sessionId) {
        // Superseded by a reset/reopen while this listing was in flight — never let a stale
        // result land on top of whatever the current session has already resolved.
        return;
      }
      if (result.ok) {
        set({ registryEmpty: result.data.length === 0, registryEmptyStatus: 'idle' });
      } else {
        // Never keep a stale resolved value once the check itself has failed — a listing
        // failure (e.g. corrupt registry.yaml) must be visibly distinct, not silently masked
        // by whatever registryEmpty last happened to be.
        set({ registryEmpty: null, registryEmptyStatus: 'error' });
      }
    },
    registryScanStatus: 'idle',
    registryScanError: null,
    registryScanResult: null,
    scanRegistryRoot: async (root) => {
      if (!deps) {
        set({ registryScanStatus: 'error', registryScanError: 'No ports wired into the TUI store' });
        return;
      }
      const sessionId = get().registrySessionId;
      set({
        registryScanStatus: 'loading',
        registryScanError: null,
        registryScanResult: null,
        // A fresh scan starts a fresh session — any prior register results are stale once
        // the candidate list they refer to is about to be replaced.
        registryRegisterStatus: 'idle',
        registryRegisterResults: null,
      });
      const result = await scanRepos(deps.registry, root);
      if (get().registrySessionId !== sessionId) {
        return;
      }
      if (result.ok) {
        set({ registryScanStatus: 'idle', registryScanResult: result.data });
      } else {
        set({ registryScanStatus: 'error', registryScanError: result.error.message, registryScanResult: null });
      }
    },
    registryRegisterStatus: 'idle',
    registryRegisterResults: null,
    registerRegistryCandidates: async (paths) => {
      if (!deps) {
        set({
          registryRegisterStatus: 'idle',
          registryRegisterResults: paths.map((path) => ({
            path,
            outcome: 'failed' as const,
            detail: 'No ports wired into the TUI store',
          })),
        });
        return;
      }
      const sessionId = get().registrySessionId;
      set({ registryRegisterStatus: 'loading' });
      // Design Notes: registerRepo/registry.add are idempotent and never signal
      // new-vs-existing — classify by snapshotting registry.list() *before* registering,
      // then diffing each canonicalized outcome against that snapshot.
      const before = await deps.registry.list();
      if (!before.ok) {
        // A failed snapshot must never be silently treated as an empty registry — that would
        // misclassify every already-registered selected path as "registered" instead of
        // surfacing the real error.
        if (get().registrySessionId === sessionId) {
          set({
            registryRegisterStatus: 'idle',
            registryRegisterResults: paths.map((path) => ({
              path,
              outcome: 'failed' as const,
              detail: before.error.message,
            })),
          });
        }
        return;
      }
      const beforePaths = new Set(before.data);
      const results: RegistryRegisterResult[] = [];
      for (const path of paths) {
        const registered = await registerRepo(deps.registry, deps.lock, deps.registryResourceKey, path);
        if (!registered.ok) {
          // A failed path never blocks the remaining selected paths from being attempted.
          results.push({ path, outcome: 'failed', detail: registered.error.message });
          continue;
        }
        const canonicalPath = registered.data.path;
        results.push({
          path: canonicalPath,
          outcome: beforePaths.has(canonicalPath) ? 'already-registered' : 'registered',
        });
      }
      if (get().registrySessionId !== sessionId) {
        return;
      }
      set({ registryRegisterStatus: 'idle', registryRegisterResults: results });
    },
    resetRegistryScreen: () =>
      set((state) => ({
        registrySessionId: state.registrySessionId + 1,
        registryScanStatus: 'idle',
        registryScanError: null,
        registryScanResult: null,
        registryRegisterStatus: 'idle',
        registryRegisterResults: null,
      })),
  }));
}

export const useAppStore = createAppStore();

