import { create } from 'zustand';
import type { UseBoundStore, StoreApi } from 'zustand';
import { ulid as generateUlid } from 'ulid';
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
import {
  resolveTabVisibility,
  DEFAULT_TAB_VISIBILITY,
  type ResolveTabVisibilityData,
} from '../../../../core/edt/resolve-tab-visibility.js';
import type { EdtRegistryEntry, EdtRegistryPort } from '../../../../core/ports/edt-registry.js';
import type { GitPort } from '../../../../core/ports/git.js';
import type { LockPort } from '../../../../core/ports/lock.js';
import type { ManifestPort } from '../../../../core/ports/manifest.js';
import type { RegistryPort, ScanResult } from '../../../../core/ports/registry.js';
import { DEFAULT_SETTINGS, type Settings, type SettingsPort } from '../../../../core/ports/settings.js';
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
  // Story 2.19: the settings screen's persistence port (zod-validated settings.yaml).
  settings: SettingsPort;
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

// Story 2.15: EDT action state for in-progress actions shown in the detail pane.
export type EdtActionState = {
  type: 'create' | 'switch' | 'modify';
  target: string; // EDT topic or "new EDT" for create
  startedAt: string; // ISO timestamp
};

// Story 2.15: EDT action log entry (matches the action_log table schema).
export type EdtActionLogEntry = {
  id: string; // ULID
  timestamp: string; // ISO timestamp
  actionType: string; // 'create' | 'switch' | 'modify'
  outcome: 'success' | 'failed';
  detail: string;
};

// Story 2.19: a partial update accepted by updateSettings — each present top-level key
// shallow-merges into that whole sub-object's existing fields, e.g.
// `{ commandPalette: { gridMaxRows: 10 } }` or `{ edts: { hiddenActionHints: [...] } }` (the
// latter leaves `edts.hiddenActionTypes` untouched, and vice versa) — see updateSettings'
// `{ ...current.edts, ...partial.edts }` spread below. Deliberately `Partial` one level deeper
// than a plain `Partial<Settings>` would give (each sub-object's own fields are individually
// optional too) — that's the whole point: a caller only ever supplies the one field it's
// changing, never the sub-object's other, untouched field. Never a deep-merge below this one
// level, though — the two sub-objects each stay flat.
export type SettingsUpdate = {
  commandPalette?: Partial<Settings['commandPalette']>;
  edts?: Partial<Settings['edts']>;
};

export type AppState = {
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
  activeEdt: string | null;
  setActiveEdt: (edt: string | null) => void;
  helpOpen: boolean;
  openHelp: () => void;
  closeHelp: () => void;
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
  // Story 2.13: per-gated-zone tab visibility (Routes/shared-types). Defaults to 'enabled'
  // for both — the Boundaries' "default reachable state" before the first load resolves, so
  // AppShell never shows a shell-wide spinner or a flash-then-hide on mount. Loaded once on
  // mount (mirrors the EDT slice's own mount-effect idiom) and reloaded on registry-screen
  // close (Story 2.11) and active-EDT membership change (createEdt/switchEdt/modifyEdt below
  // each fire-and-forget a reload on success) — never blocks AppShell's render.
  tabVisibility: ResolveTabVisibilityData;
  tabVisibilityStatus: 'idle' | 'loading' | 'error';
  tabVisibilityError: string | null;
  loadTabVisibility: () => Promise<void>;
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
  // Story 2.11: repo registry screen — reachable exclusively via the `registry` command
  // inside Story 2.14's `:` command bar, and auto-offered from Dashboard's empty-registry
  // prompt (a single store-level open/close flag, not local AppShell state, so both call
  // sites can trigger it).
  registryScreenOpen: boolean;
  openRegistryScreen: () => void;
  closeRegistryScreen: () => void;
  // Story 2.14: the `:` command-entry bar's open/close flag. Lives in the store (like
  // registryScreenOpen, not local AppShell state as originally sketched) so a mounted zone
  // screen can read it too and gate its own `useInput` with `{ isActive: !commandBarOpen }`
  // — Ink dispatches every keypress to every mounted `useInput` hook regardless of z-order,
  // so without this a zone's own key handling (e.g. EdtsZone's Tab/Enter) would silently
  // fire underneath the bar (Spec Change Log, story 2.14 review finding).
  commandBarOpen: boolean;
  openCommandBar: () => void;
  closeCommandBar: () => void;
  // Story 2.19: the `:settings` screen — reachable exclusively via the `settings` command
  // inside the `:` command bar (mirrors registryScreenOpen's triplet exactly; never a raw
  // keypress). `settings` is the live, applied value every consumer (command-bar.tsx,
  // edts-zone.tsx) reads — seeded with DEFAULT_SETTINGS until loadSettings() resolves, so an
  // unwired store (every pre-2.19 `createAppStore()` test call) stays usable. `settingsWarning`
  // carries a corrupt/invalid settings.yaml's non-blocking field-naming message, cleared once
  // the screen closes.
  settings: Settings;
  settingsWarning: string | null;
  settingsScreenOpen: boolean;
  loadSettings: () => Promise<void>;
  updateSettings: (partial: SettingsUpdate) => Promise<void>;
  openSettingsScreen: () => void;
  closeSettingsScreen: () => void;
  // Story 2.15: EDT action state for the detail pane — tracks in-progress action and
  // loads action log per-EDT.
  currentEdtAction: EdtActionState | null;
  setCurrentEdtAction: (action: EdtActionState | null) => void;
  edtActionLog: EdtActionLogEntry[];
  edtActionLogStatus: 'idle' | 'loading' | 'error';
  loadEdtActionLog: (ulid: string) => Promise<void>;
  // Story 2.15: EDT command dialog openers — delegate to the same dialog state machines
  // from edts-zone.tsx. These are thin store-level wrappers so commands can trigger them.
  openEdtCreateDialog: () => void;
  openEdtSwitchDialog: (fullQuery: string) => void;
  openEdtModifyDialog: (fullQuery: string) => void;
  // Story 2.15: logs an EDT action to the per-EDT SQLite action_log table.
  logEdtAction: (ulid: string, actionType: string, outcome: 'success' | 'failed', detail: string) => Promise<void>;
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

// Story 2.21: every zone gets a single-entry default array (its one list<->detail boundary)
// except the EDTs zone, whose list column has 3 fixed-but-movable boundaries (Design Notes).
function emptyRatios(): ZoneRatios {
  return Object.fromEntries(
    ZONES.map((zone) => [
      zone.id,
      zone.id === 'edts' ? [DEFAULT_LIST_RATIO, DEFAULT_LIST_RATIO, DEFAULT_LIST_RATIO] : [DEFAULT_LIST_RATIO],
    ]),
  ) as ZoneRatios;
}

export function createAppStore(deps?: AppStoreDeps) {
  // Story 2.19 patch: settingsSaveChain serializes updateSettings' persistence calls so
  // concurrent updates hit disk in the order they were requested (each save chains onto the
  // previous one) rather than racing; settingsVersion is a monotonic counter bumped on every
  // updateSettings call so a slower, in-flight loadSettings can detect a newer update has
  // landed since it started and skip clobbering it.
  let settingsSaveChain: Promise<void> = Promise.resolve();
  let settingsVersion = 0;
  // Story 2.21: serializes setSplitterRatio's persistence calls the same way settingsSaveChain
  // does for updateSettings — each write chains onto the previous one so concurrent boundary
  // moves (e.g. holding an arrow key) hit disk in the order they were requested.
  let splitterRatiosSaveChain: Promise<void> = Promise.resolve();
  // Review fix (story 2.21): mirrors settingsVersion above — a monotonic counter bumped on
  // every setSplitterRatio call so a slower, in-flight loadSplitterRatios (the AppShell
  // mount-time load) can detect that a newer live boundary move has landed since it started
  // and skip clobbering it with the stale value it read from disk.
  let splitterRatiosVersion = 0;
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
    setSplitterRatio: async (zone, boundaryIndex, ratio) => {
      splitterRatiosVersion += 1;
      set((state) => {
        const zoneRatios = state.splitterRatios[zone];
        if (boundaryIndex < 0 || boundaryIndex >= zoneRatios.length) {
          // Out-of-range boundary index (e.g. a stale resizeMode after a zone's boundary
          // count somehow shrank): never write a sparse/invalid array.
          return {};
        }
        const nextZoneRatios = zoneRatios.map((value, index) =>
          index === boundaryIndex ? clampListRatio(ratio) : value,
        );
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
    activeEdt: null,
    setActiveEdt: (edt) => set({ activeEdt: edt }),
    helpOpen: false,
    openHelp: () => set({ helpOpen: true }),
    closeHelp: () => set({ helpOpen: false }),
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
        // Story 2.13: a newly-created EDT is a fresh set of active-EDT members — reload
        // gated-tab visibility so a carrying member just added flips its tab enabled
        // immediately. Fire-and-forget: never blocks the create flow's own result.
        void get().loadTabVisibility();
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
        // Story 2.13: switching the active EDT swaps its whole member set — reload
        // gated-tab visibility so a newly (in)active member's tab flips immediately.
        void get().loadTabVisibility();
      }
      return result;
    },
    modifyEdt: async (params) => {
      if (!deps) {
        return { ok: false, error: { code: 'store-not-wired', message: NO_DEPS_ERROR } };
      }
      const result = await modifyEdtUseCase({
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
      if (result.ok) {
        // Story 2.13: a member add/remove may target the active EDT — reload gated-tab
        // visibility so the tab bar reflects the new membership immediately (Boundaries:
        // "active EDT membership changes ... tab bar updates immediately"). Cheap and
        // always-correct even when the modified EDT wasn't the active one (the recomputed
        // status is then identical to what it already was).
        void get().loadTabVisibility();
      }
      return result;
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
    commandBarOpen: false,
    openCommandBar: () => set({ commandBarOpen: true }),
    closeCommandBar: () => set({ commandBarOpen: false }),
    settings: DEFAULT_SETTINGS,
    settingsWarning: null,
    settingsScreenOpen: false,
    loadSettings: async () => {
      if (!deps) {
        return;
      }
      // Capture the version before awaiting: if an updateSettings call lands while this load
      // is still in flight, settingsVersion will have moved on and this stale result must not
      // clobber the newer value with whatever was read from disk before that update happened.
      const startVersion = settingsVersion;
      const result = await deps.settings.load();
      if (settingsVersion !== startVersion) {
        return;
      }
      if (result.ok) {
        set({ settings: result.data.settings, settingsWarning: result.data.warning });
      } else {
        // A genuine I/O error (not the corrupt/invalid-file path, which is always `ok`):
        // keep whatever settings were last in effect rather than silently resetting to
        // defaults, and surface the failure the same way a corrupt file's warning would.
        set({ settingsWarning: result.error.message });
      }
    },
    updateSettings: async (partial) => {
      settingsVersion += 1;
      const current = get().settings;
      const next: Settings = {
        commandPalette: { ...current.commandPalette, ...partial.commandPalette },
        edts: { ...current.edts, ...partial.edts },
      };
      // Optimistic: applies to the live store immediately, before persistence even starts
      // (Boundaries: "every change applies to the live store and persists to disk
      // immediately, no separate save step").
      set({ settings: next });
      if (!deps) {
        return;
      }
      // Chain onto the pending save so concurrent updateSettings calls persist to disk in the
      // order they were requested, instead of racing (a slower earlier save landing after a
      // faster later one would leave stale data on disk).
      const run = async () => {
        const result = await deps.settings.save(next);
        if (!result.ok) {
          set({ settingsWarning: result.error.message });
        } else {
          set({ settingsWarning: null });
        }
      };
      const chained = settingsSaveChain.then(run, run);
      settingsSaveChain = chained;
      await chained;
    },
    // No reload-on-open here (unlike openRegistryScreen's resetRegistryScreen): `settings` is
    // loaded once at app mount (AppShell's mount effect, mirroring loadEdts/loadTabVisibility)
    // and kept live thereafter by updateSettings' own optimistic set — command-bar.tsx and
    // edts-zone.tsx read it whether or not this screen has ever been opened.
    openSettingsScreen: () => set({ settingsScreenOpen: true }),
    // Clears settingsWarning too: closing acknowledges the warning, so reopening the screen
    // (or a later screen action) doesn't keep showing a stale message the developer already saw.
    closeSettingsScreen: () => set({ settingsScreenOpen: false, settingsWarning: null }),
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
    // Story 2.15: EDT action state for detail pane
    currentEdtAction: null,
    setCurrentEdtAction: (action) => set({ currentEdtAction: action }),
    edtActionLog: [],
    edtActionLogStatus: 'idle',
    loadEdtActionLog: async (ulid: string) => {
      if (!deps) {
        set({ edtActionLogStatus: 'error' });
        return;
      }
      if (get().edtActionLogStatus === 'loading') {
        return;
      }
      set({ edtActionLogStatus: 'loading' });
      // Use the EDT registry port's getActionLog if available
      const edtRegistry = deps.edtRegistry as EdtRegistryPort & {
        getActionLog?: (ulid: string, limit?: number) => Promise<Result<EdtActionLogEntry[]>>;
      };
      if (typeof edtRegistry.getActionLog === 'function') {
        const result = await edtRegistry.getActionLog(ulid, 5);
        if (result.ok) {
          set({ edtActionLog: result.data, edtActionLogStatus: 'idle' });
        } else {
          set({ edtActionLogStatus: 'error', edtActionLog: [] });
        }
      } else {
        set({ edtActionLog: [], edtActionLogStatus: 'idle' });
      }
    },
    // Story 2.15: EDT command dialog openers - delegate to the edts-zone dialog state machines
    // These are thin store-level wrappers so commands can trigger the same dialogs
    openEdtCreateDialog: () => {
      // The edts-zone component manages its own dialog state locally.
      // We set a flag that the zone can read to auto-open the create dialog.
      set({ currentEdtAction: { type: 'create', target: 'new EDT', startedAt: new Date().toISOString() } });
      // The actual dialog opening is handled by the edts-zone's useEffect watching this state
    },
    openEdtSwitchDialog: (fullQuery: string) => {
      // Parse optional topic from query: "edt-switch [topic]"
      const parts = fullQuery.trim().split(/\s+/);
      const topic = parts.length > 1 ? parts.slice(1).join(' ') : null;
      set({ currentEdtAction: { type: 'switch', target: topic ?? 'select EDT', startedAt: new Date().toISOString() } });
      // The edts-zone will handle showing the quick-pick or pre-targeted switch-confirm
    },
    openEdtModifyDialog: (fullQuery: string) => {
      // Parse optional topic from query: "edt-modify [topic]"
      const parts = fullQuery.trim().split(/\s+/);
      const topic = parts.length > 1 ? parts.slice(1).join(' ') : null;
      set({ currentEdtAction: { type: 'modify', target: topic ?? 'select EDT', startedAt: new Date().toISOString() } });
      // The edts-zone will handle showing the quick-pick or pre-targeted modify dialog
    },
    // Story 2.15: log EDT action to per-EDT SQLite
    logEdtAction: async (ulid: string, actionType: string, outcome: 'success' | 'failed', detail: string) => {
      if (!deps) return;
      const edtRegistry = deps.edtRegistry as EdtRegistryPort & {
        logAction?: (ulid: string, actionType: string, outcome: string, detail: string) => Promise<Result<void>>;
      };
      if (typeof edtRegistry.logAction === 'function') {
        await edtRegistry.logAction(ulid, actionType, outcome, detail);
      }
      // Clear current action state after logging
      set({ currentEdtAction: null });
      // Reload action log for the current EDT if it matches
      const activeEdt = get().activeEdt;
      if (activeEdt === ulid) {
        await get().loadEdtActionLog(ulid);
      }
    },
  }));
}

export const useAppStore = createAppStore();

