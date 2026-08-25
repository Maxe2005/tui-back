import { create } from 'zustand';
import type { UseBoundStore, StoreApi } from 'zustand';
import {
  createEdt as createEdtUseCase,
  type CreateBranchOptions,
  type CreateEdtData,
} from '../../../../core/edt/create.js';
import {
  switchActiveEdt as switchActiveEdtUseCase,
  type SwitchActiveEdtData,
} from '../../../../core/edt/switch.js';
import {
  modifyEdt as modifyEdtUseCase,
  type ModifyEdtData,
} from '../../../../core/edt/modify.js';
import {
  listEdtBranchesDivergence,
  type BranchDivergenceEntryError,
  type ServiceBranchDivergence,
} from '../../../../core/edt/list.js';
import type { EdtRegistryEntry, EdtRegistryPort } from '../../../../core/ports/edt-registry.js';
import type { GitPort } from '../../../../core/ports/git.js';
import type { LockPort } from '../../../../core/ports/lock.js';
import type { ManifestPort } from '../../../../core/ports/manifest.js';
import type { RegistryPort, ScanResult } from '../../../../core/ports/registry.js';
import type { StatePort } from '../../../../core/ports/state.js';
import type { Result } from '../../../../core/result.js';
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
// Story 2.9 extends the deps with `lock`/`edtRegistryResourceKey`/`edtsBaseDir` — the same
// three createEdt/switchActiveEdt/modifyEdt need alongside the pre-existing five, closing the
// composition-root gap (src/bin/tui.ts previously built these for nothing, since no store
// action consumed them).
export type AppStoreDeps = {
  registry: RegistryPort;
  manifest: ManifestPort;
  git: GitPort;
  edtRegistry: EdtRegistryPort;
  state: StatePort;
  lock: LockPort;
  edtRegistryResourceKey: string;
  edtsBaseDir: string;
  registryResourceKey: string;
};

export type CreateEdtParams = {
  topic: string;
  members: string[];
};

export type SwitchEdtParams = {
  topic: string;
  force?: boolean;
};

export type ModifyEdtParams = {
  topic: string;
  addMembers: string[];
  removeMembers: string[];
  setBranches: Array<{ repoPath: string; branch: string }>;
  renameTo?: string;
};

const NO_DEPS_ERROR = 'No ports wired into the TUI store';

// Story 2.9: no branch-creation UI in the EDTs zone's create form (AC1 scopes it to topic +
// member selection only — branch-creation naming/mode was Story 2.2's separate concern, not
// reintroduced here). Every member reuses its existing current branch, gated the same way
// the branch-creation-disabled CLI path already is (core/edt/create.ts's
// resolveMemberBranch).
const NO_BRANCH_CREATION: CreateBranchOptions = { create: false, base: 'development', mode: 'grouped', names: {} 
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
  // Story 2.9: the EDT registry's own entries (ulid/topic/status/members) — the EDT
  // selector's data source. Distinct from `edtsBranches` above, which is the flat
  // per-service branch/divergence list (Story 2.6) and carries no per-EDT grouping.
  // Mirrors edtsBranches' own "never show stale rows under an error banner" rule: a failed
  // reload clears `edts` to an empty array rather than leaving a stale list in place.
  edts: EdtRegistryEntry[] | null;
  edtsStatus: 'idle' | 'loading' | 'error';
  edtsError: string | null;
  // The store's cached read of state.json's active-EDT pointer (AD-10), populated by
  // loadEdts() and refreshed by a successful switchEdt() — never continuously re-synced via
  // fs.watch/poll while the TUI is open (that AD-10 half is explicitly out of this story's
  // scope; see deferred-work.md). Used by the EDTs zone to tell which selector row is the
  // currently active EDT (never `EdtRegistryEntry.status`, which create.ts always sets to
  // 'active' for a brand-new entry regardless of any other EDT's own status — not an
  // exclusive "the one active EDT" flag on its own).
  loadEdts: () => Promise<void>;
  // Story 2.9: the zone-owned dialogs (create/switch/modify) call these three core
  // use-cases in-process (AD-2), never by shelling out to the CLI — the same ones
  // `runEdtCreate`/`runEdtSwitch`/`runEdtModify` (src/adapters/driving/cli/subcommands.ts)
  // wrap, mirroring that call shape exactly. Deps are closed over the same way
  // loadEdtsBranches' are; an unwired store degrades to an explicit error Result rather than
  // throwing (every pre-2.9 `createAppStore()` call, including tests, stays usable).
  createEdt: (params: CreateEdtParams) => Promise<Result<CreateEdtData>>;
  switchEdt: (params: SwitchEdtParams) => Promise<Result<SwitchActiveEdtData>>;
  modifyEdt: (params: ModifyEdtParams) => Promise<Result<ModifyEdtData>>;
  // Story 2.9: set by a zone while one of its own dialogs/forms has captured keyboard input
  // (create/switch-confirm/modify/branch-edit) — gates AppShell's global shortcuts (`?`,
  // zone mnemonics, `/`, `:`, `q`) so a typed character (including `?`) never leaks through
  // to a global dispatch while a text field or checklist owns the keystroke.
  zoneInputCaptured: boolean;
  setZoneInputCaptured: (value: boolean) => void;
  // Review patch (story 2.9): `q` is unreachable while `zoneInputCaptured` is set (it must
  // be typable into a text field), so a zone whose captured dialog has no cancel target of
  // its own — the EDTs zone's AC1 create prompt when the registry is still genuinely empty,
  // where Escape has nothing meaningful to cancel back to either — needs another way to ask
  // the composition root to quit. `requestQuit()` flips this flag; AppShell's own effect (the
  // only place `onQuit` is in scope) observes it and calls `onQuit()`, mirroring how the
  // zone-input-capture handoff between a zone and AppShell already works.
  quitRequested: boolean;
  requestQuit: () => void;
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
    edts: null,
    edtsStatus: 'idle',
    edtsError: null,
    loadEdts: async () => {
      if (!deps) {
        set({ edtsStatus: 'error', edtsError: NO_DEPS_ERROR });
        return;
      }
      if (get().edtsStatus === 'loading') {
        return;
      }
      set({ edtsStatus: 'loading', edtsError: null });
      const listed = await deps.edtRegistry.list();
      if (!listed.ok) {
        // Mirrors edtsBranches' own rule: never show stale rows under an error banner —
        // `edts` is cleared, not left at its last-successful value.
        set({ edtsStatus: 'error', edtsError: listed.error.message, edts: [] });
        return;
      }
      // Review patch (story 2.9): a `state.json` read failure is a separate, unrelated
      // concern from whether the EDT registry itself loaded — don't discard a perfectly
      // good `edts` list (including a genuinely-empty one AC1 depends on to auto-open the
      // create prompt) just because the active-EDT pointer read failed alongside it.
      // Degrade only the pointer, to "no active EDT known", rather than the whole load.
      const activeUlid = await deps.state.readActiveEdt();
      set({
        edts: listed.data,
        edtsStatus: 'idle',
        edtsError: null,
        activeEdt: activeUlid.ok ? activeUlid.data : null,
      });
    },
    createEdt: async (params) => {
      if (!deps) {
        return { ok: false, error: { code: 'store-not-wired', message: NO_DEPS_ERROR } };
      }
      const result = await createEdtUseCase({
        edtsBaseDir: deps.edtsBaseDir,
        manifest: deps.manifest,
        edtRegistry: deps.edtRegistry,
        lock: deps.lock,
        edtRegistryResourceKey: deps.edtRegistryResourceKey,
        registry: deps.registry,
        git: deps.git,
        topic: params.topic,
        members: params.members,
        branchOptions: NO_BRANCH_CREATION,
      });
      if (result.ok) {
        // Review patch (story 2.9): unlike switchEdt, createEdt itself never writes
        // state.json's active-EDT pointer (create.ts only sets the registry entry's own
        // `status: 'active'`, not an exclusive flag — see the `edts` field comment above).
        // The TUI's create dialog is only ever reachable via AC1's zero-EDT prompt today
        // (a second EDT is CLI-only, see deferred-work.md), so every TUI-driven create is
        // the first EDT and should become the active one — exactly as if the user had
        // immediately switched to it. Best-effort: if the state.json write fails, the EDT
        // is still created successfully; the active pointer just stays whatever it was.
        const wroteActive = await deps.state.writeActiveEdt(result.data.ulid);
        if (wroteActive.ok) {
          set({ activeEdt: result.data.ulid });
        }
      }
      return result;
    },
    switchEdt: async (params) => {
      if (!deps) {
        return { ok: false, error: { code: 'store-not-wired', message: NO_DEPS_ERROR } };
      }
      const result = await switchActiveEdtUseCase({
        edtRegistry: deps.edtRegistry,
        edtRegistryResourceKey: deps.edtRegistryResourceKey,
        registry: deps.registry,
        manifest: deps.manifest,
        git: deps.git,
        lock: deps.lock,
        state: deps.state,
        topic: params.topic,
        force: params.force,
      });
      if (result.ok) {
        // Success updates the store's cached active-EDT pointer immediately — a direct
        // consequence of this TUI-driven switch, not the continuous fs.watch/poll re-sync
        // AD-10 also describes (that half stays out of this story's scope).
        set({ activeEdt: result.data.ulid });
      }
      return result;
    },
    modifyEdt: async (params) => {
      if (!deps) {
        return { ok: false, error: { code: 'store-not-wired', message: NO_DEPS_ERROR } };
      }
      return modifyEdtUseCase({
        edtRegistry: deps.edtRegistry,
        edtRegistryResourceKey: deps.edtRegistryResourceKey,
        registry: deps.registry,
        manifest: deps.manifest,
        git: deps.git,
        lock: deps.lock,
        topic: params.topic,
        addMembers: params.addMembers,
        removeMembers: params.removeMembers,
        setBranches: params.setBranches,
        renameTo: params.renameTo,
      });
    },
    zoneInputCaptured: false,
    setZoneInputCaptured: (value) => set({ zoneInputCaptured: value }),
    quitRequested: false,
    requestQuit: () => set({ quitRequested: true }),
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

