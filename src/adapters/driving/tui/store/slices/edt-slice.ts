// tui/store/slices: EDT domain state — registry entries, per-service branch/divergence,
// EDT use-cases (in-process), branch-picker capabilities, and per-EDT action log.
// Combined with other slices into the one Zustand store.
import type { StateCreator } from 'zustand';
import {
  createEdt as createEdtUseCase,
  listCreateCandidateBranches as listCreateCandidateBranchesUseCase,
  type CreateBranchOptions,
  type CreateCandidateBranches,
  type CreateEdtData,
  type MemberBranchPlan,
} from '../../../../../core/edt/create.js';
import {
  listSwitchRestartRepos,
  isChangedSwitchOutcome,
  restartAfterSwitch,
  type RestartReport,
  type RestartRow,
  type SwitchRestartRunMode,
} from '../../../../../core/edt/switch-restart.js';
import { createServiceActions, type ServiceActions } from '../../../../../core/service-actions/index.js';
import { activateEdt as activateEdtUseCase, type ActivateEdtData } from '../../../../../core/edt/activate.js';
import {
  switchActiveEdt as switchActiveEdtUseCase,
  type SwitchActiveEdtData,
  type SwitchDirtyRepo,
  type SwitchDirtyReposChoice,
} from '../../../../../core/edt/switch.js';
import {
  modifyEdt as modifyEdtUseCase,
  createMemberBranch as createMemberBranchUseCase,
  renameMemberBranch as renameMemberBranchUseCase,
  listMemberBranches as listMemberBranchesUseCase,
  type ModifyEdtData,
} from '../../../../../core/edt/modify.js';
import { listEdtBranchesDivergence, type BranchDivergenceEntryError, type ServiceBranchDivergence } from '../../../../../core/edt/list.js';
import {
  deleteEdt as deleteEdtUseCase,
  resolveMemberDeleteStatuses as resolveMemberDeleteStatusesUseCase,
  type DeleteEdtData,
  type MemberDeleteStatus,
  type MemberDisposition,
} from '../../../../../core/edt/delete.js';
import type { EdtMember, EdtRegistryEntry, EdtRegistryPort } from '../../../../../core/ports/edt-registry.js';
import type { Result } from '../../../../../core/result.js';
import type { AppState, AppStoreDeps } from '../app-store.js';

const NO_DEPS_ERROR = 'No ports wired into the TUI store';

// The default base branch — shared constant to prevent drift between store and zone.
export const DEFAULT_BASE_BRANCH = 'development';

// The canonical "reuse each current branch" value for `branchOptions` callers (the create
// wizard sends `memberPlans` instead).
export const NO_BRANCH_CREATION: CreateBranchOptions = { create: false, base: DEFAULT_BASE_BRANCH, mode: 'grouped', names: {} };

// Activating or switching the active EDT rewrites every member's branch and the active pointer,
// so it must never run underneath a group update. Creating an EDT stays allowed (it does not
// touch the active pointer), only its activation step is refused.
export const UPDATE_IN_PROGRESS_CODE = 'update-in-progress';
export const UPDATE_IN_PROGRESS_MESSAGE =
  'A group update is in progress — wait for it to finish before activating or switching an EDT.';

// A restart run (post-switch, standalone, or a group update) is in flight — see the exclusion
// notes on `runSwitchRestart`.
export const SWITCH_RESTART_IN_PROGRESS_CODE = 'switch-restart-in-progress';
export const SWITCH_RESTART_IN_PROGRESS_MESSAGE =
  'A post-switch service restart is in progress — wait for it to finish before starting an update, a switch or another restart.';

// The live post-switch restart run, read by the switch dialog's report view. `rows` are in run
// order while `running` (stable positions for live updates) and non-green first once `done`.
export const UPDATE_RUNNING_RESTART_MESSAGE =
  'A group update is in progress — wait for it to finish before restarting services after a switch.';

export type SwitchRestartState = {
  topic: string;
  mode: Exclude<SwitchRestartRunMode, 'none'>;
  status: 'running' | 'done' | 'error';
  rows: RestartRow[];
  report: RestartReport | null;
  error: string | null;
};

export type CreateEdtParams = {
  topic: string;
  members: string[];
  // Exactly one branch strategy required: branchOptions (CLI-shaped) or memberPlans (wizard).
  // memberPlans takes precedence when both are present.
  branchOptions?: CreateBranchOptions;
  memberPlans?: Record<string, MemberBranchPlan>;
};

// `overwrite`: at-risk paths confirmed for discarding, per repoPath.
export type ActivateEdtRequest = {
  topic: string;
  overwrite?: Record<string, string[]>;
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
  // Mirrors setBranches's shape — see core/edt/modify.ts's ModifyEdtParams for the full
  // semantics (always renames a member's own currently-registered branch).
  renameBranches?: Array<{ repoPath: string; newName: string }>;
};

// Mirrors ModifyEdtParams' own shape.
export type DeleteEdtParams = {
  topic: string;
  dispositions: Record<string, MemberDisposition>;
};

// EDT action state for in-progress actions shown in the detail pane.
export type EdtActionState = {
  // 'create-from' — the create wizard seeded from a root EDT (target = its topic, or
  // 'select EDT' when the quick-pick must choose it).
  type: 'create' | 'create-from' | 'switch' | 'modify' | 'delete';
  // EDT topic (for create-from: the root EDT's topic), "new EDT" for create, or 'select EDT'
  // when no topic was given (switch/modify/delete/create-from open the quick-pick).
  target: string;
  startedAt: string; // ISO timestamp
};

// EDT action log entry (matches the action_log table schema).
export type EdtActionLogEntry = {
  id: string; // ULID
  timestamp: string; // ISO timestamp
  actionType: string; // 'create' | 'switch' | 'modify'
  outcome: 'success' | 'failed';
  detail: string;
};

export type EdtSlice = {
  activeEdt: string | null;
  setActiveEdt: (edt: string | null) => void;
  // The EDTs zone's branch/divergence listing (FR-9). `edtsBranches` is null before first load;
  // successful load replaces it with array (never leaves stale mid-refresh).
  // `edtsBranchesStatus` reflects request state ('loading'/'error'); successful load → 'idle'.
  edtsBranches: ServiceBranchDivergence[] | null;
  edtsBranchesStatus: 'idle' | 'loading' | 'error';
  edtsBranchesError: string | null;
  // Unreachable paths and errors from listEdtBranchesDivergence; populated alongside
  // edtsBranches on successful load; retained as last-successful on failed reload.
  edtsUnreachable: string[];
  edtsErrors: BranchDivergenceEntryError[];
  loadEdtsBranches: () => Promise<void>;
  // EDT registry entries (ulid/topic/status/members) — EDT selector's data source.
  // Distinct from flat per-service edtsBranches. Failed reload → empty array (no stale rows).
  edts: EdtRegistryEntry[] | null;
  edtsStatus: 'idle' | 'loading' | 'error';
  edtsError: string | null;
  // Cached active-EDT pointer from state.json (AD-10). Populated by loadEdts(),
  // refreshed by successful switchEdt(). Not continuously synced via fs.watch/poll.
  // Used by EDTs zone to identify active EDT selector row.
  loadEdts: () => Promise<void>;
  // Zone-owned dialogs call core use-cases in-process (AD-2) with same shape as CLI.
  // Unwired store → explicit error Result (no throw).
  createEdt: (params: CreateEdtParams) => Promise<Result<CreateEdtData>>;
  // First EDT's explicit activation (wizard Step 4). `blocked` changes nothing;
  // `activated` updates cached active pointer like switchEdt.
  activateEdt: (params: ActivateEdtRequest) => Promise<Result<ActivateEdtData>>;
  switchEdt: (params: SwitchEdtParams) => Promise<Result<SwitchActiveEdtData>>;
  // The optional post-switch restart phase (FR-37): a second call after a successful switchEdt,
  // never part of it. `null` until a run starts; kept after it ends so the report survives
  // leaving the zone, until clearSwitchRestart. Starting one while an update, another restart
  // run or a standalone restart is in flight is rejected — and, while it runs, update starts,
  // switches and standalone restarts on its services are rejected too (both directions).
  switchRestart: SwitchRestartState | null;
  runSwitchRestart: (params: {
    topic: string;
    mode: Exclude<SwitchRestartRunMode, 'none'>;
    results: SwitchActiveEdtData['results'];
  }) => Promise<Result<RestartReport>>;
  clearSwitchRestart: () => void;
  // Switch dirty-repo seam: non-null while switchActiveEdt paused inside switchEdt.
  // Core raises only when state-2/3 repo (outside outgoing EDT) is dirty.
  // Awaits SwitchDirtyReposChoice; switch dialog renders resolution view.
  switchDirtyRepos: SwitchDirtyRepo[] | null;
  resolveSwitchDirtyRepos: (choice: SwitchDirtyReposChoice) => void;
  modifyEdt: (params: ModifyEdtParams) => Promise<Result<ModifyEdtData>>;
  // Delete dialog's confirm calls core/edt/delete.ts's deleteEdt in-process (AD-2).
  deleteEdt: (params: DeleteEdtParams) => Promise<Result<DeleteEdtData>>;
  // Delete-confirm dialog's per-member merge/clean status via core export.
  // Never fails outright: per-member read failure folds into statusError.
  // edtUlid needed for `tui-back:<edtUlid>` tagged-stash check.
  resolveMemberDeleteStatuses: (edtUlid: string, members: readonly EdtMember[]) => Promise<MemberDeleteStatus[]>;
  // Branch-picker capabilities wrapping core/edt/modify.ts's exports.
  // renameBranch backs picker's row rename when adding member (where modifyEdt's
  // renameBranches cannot apply due to no existing membership).
  listBranches: (repoPath: string) => Promise<Result<string[]>>;
  // Create wizard's Step 3 per-service lists (local + remote-tracking refs).
  // Wraps core/edt/create.ts's listCreateCandidateBranches — never fetches.
  listCreateBranches: (repoPath: string) => Promise<Result<CreateCandidateBranches>>;
  createMemberBranch: (repoPath: string, branchName: string, baseBranch: string) => Promise<Result<void>>;
  renameBranch: (repoPath: string, oldName: string, newName: string, edtId?: string) => Promise<Result<void>>;
  // EDT action state for detail pane — tracks in-progress action and loads action log per EDT.
  currentEdtAction: EdtActionState | null;
  setCurrentEdtAction: (action: EdtActionState | null) => void;
  edtActionLog: EdtActionLogEntry[];
  edtActionLogStatus: 'idle' | 'loading' | 'error';
  loadEdtActionLog: (ulid: string) => Promise<void>;
  // EDT command dialog openers — thin store-level wrappers.
  // Delegates to edts-zone dialog state machines.
  openEdtCreateDialog: () => void;
  openEdtSwitchDialog: (fullQuery: string) => void;
  openEdtModifyDialog: (fullQuery: string) => void;
  openEdtDeleteDialog: (fullQuery: string) => void;
  // `edt-create-from [topic]` — opens creation wizard seeded from root EDT.
  openEdtCreateFromDialog: (fullQuery: string) => void;
  // Logs EDT action to per-EDT SQLite action_log table.
  logEdtAction: (ulid: string, actionType: string, outcome: 'success' | 'failed', detail: string) => Promise<void>;
};

export function createEdtSlice(deps?: AppStoreDeps): StateCreator<AppState, [], [], EdtSlice> {
  // The pending seam promise's resolver — installed when switchActiveEdt raises a dirty-repo
  // preview, consumed when the dialog dispatches its choice.
  let pendingSwitchDirtyResolve: ((choice: SwitchDirtyReposChoice) => void) | null = null;
  // Built once from the injected ports (same registry the Logs zone uses); absent when the
  // restart ports are not wired — runSwitchRestart then reports an explicit error.
  const serviceActions: ServiceActions | null =
    deps?.container && deps.restart && deps.editor
      ? createServiceActions({
          manifest: deps.manifest,
          container: deps.container,
          restart: deps.restart,
          editor: deps.editor,
          lock: deps.lock,
          docker: deps.docker,
          healthProbe: deps.healthProbe,
          // Late-bound: the registry is built before the store exists, and the toggle is read
          // live at each verification so a :settings change applies without a restart.
          isHealthCheckEnabled: (manifest) => !(getState?.().settings.services.healthCheckDisabled.includes(manifest.service) ?? false),
        })
      : null;
  let getState: (() => AppState) | null = null;
  const createState: StateCreator<AppState, [], [], EdtSlice> = (set, get) => ({
    activeEdt: null,
    setActiveEdt: (edt) => set({ activeEdt: edt }),
    edtsBranches: null,
    edtsBranchesStatus: 'idle',
    edtsBranchesError: null,
    edtsUnreachable: [],
    edtsErrors: [],
    loadEdtsBranches: async () => {
      // A no-op-with-signal guard: unwired store (tests) must stay usable but never load.
      if (!deps) {
        set({ edtsBranchesStatus: 'error', edtsBranchesError: NO_DEPS_ERROR });
        return;
      }
      // Avoid duplicate concurrent fetch (effect re-firing) racing this one.
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
        // Never show stale rows under error banner — edts cleared, not last-successful.
        set({ edtsStatus: 'error', edtsError: listed.error.message, edts: [] });
        return;
      }
      // state.json read failure unrelated to EDT registry load — don't discard good edts list
      // (including genuinely-empty, which auto-opens create prompt) just because active-EDT
      // pointer read failed alongside it. Degrade only pointer to "no active EDT known".
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
        branchOptions: params.branchOptions,
        memberPlans: params.memberPlans,
      });
      if (result.ok) {
        // Create never touches state.json's active pointer — activation only through
        // wizard's Step 4 (activateEdt for first EDT, or switchEdt). New EDT is fresh set
        // of active-EDT members: reload gated-tab visibility so carrying member flips tab.
        // Fire-and-forget: never blocks create flow's result.
        void get().loadTabVisibility();
      }
      return result;
    },
    activateEdt: async (params) => {
      if (!deps) {
        return { ok: false, error: { code: 'store-not-wired', message: NO_DEPS_ERROR } };
      }
      if (get().updateStatus === 'running') {
        return { ok: false, error: { code: UPDATE_IN_PROGRESS_CODE, message: UPDATE_IN_PROGRESS_MESSAGE } };
      }
      const result = await activateEdtUseCase({
        edtRegistry: deps.edtRegistry,
        edtRegistryResourceKey: deps.edtRegistryResourceKey,
        registry: deps.registry,
        manifest: deps.manifest,
        manifestCarry: deps.manifestCarry,
        git: deps.git,
        lock: deps.lock,
        state: deps.state,
        topic: params.topic,
        overwrite: params.overwrite,
      });
      if (result.ok && result.data.status === 'activated') {
        set({ activeEdt: result.data.ulid });
        void get().loadTabVisibility();
      }
      return result;
    },
    switchRestart: null,
    clearSwitchRestart: () => {
      // A running run owns its state until it ends.
      if (get().switchRestart?.status !== 'running') {
        set({ switchRestart: null });
      }
    },
    runSwitchRestart: async ({ topic, mode, results }) => {
      if (!deps || serviceActions === null) {
        return { ok: false, error: { code: 'store-not-wired', message: NO_DEPS_ERROR } };
      }
      const rejected = (message: string): Result<RestartReport> => ({
        ok: false,
        error: { code: SWITCH_RESTART_IN_PROGRESS_CODE, message },
      });
      if (get().switchRestart?.status === 'running') {
        return rejected(SWITCH_RESTART_IN_PROGRESS_MESSAGE);
      }
      if (get().updateStatus === 'running') {
        return rejected(UPDATE_RUNNING_RESTART_MESSAGE);
      }
      if (Object.keys(get().serviceRestartInFlight).length > 0) {
        return rejected('A service restart is already in progress — wait for it to finish before restarting services after a switch.');
      }
      // Claimed before the first await so two interleaved starts cannot both pass the guards above.
      set({ switchRestart: { topic, mode, status: 'running', rows: [], report: null, error: null } });
      const repos = await listSwitchRestartRepos({ registry: deps.registry, manifest: deps.manifest });
      if (!repos.ok) {
        set({ switchRestart: { topic, mode, status: 'error', rows: [], report: null, error: repos.error.message } });
        return repos;
      }
      // Marks every target as restarting in the shared in-flight map, so a group update or a
      // standalone restart on the same services is refused until the run ends.
      const changed = new Set(results.filter((row) => isChangedSwitchOutcome(row.outcome)).map((row) => row.service));
      const inFlightPaths = repos.data.filter((repo) => repo.hasContainer && changed.has(repo.service)).map((repo) => repo.repoPath);
      set({
        serviceRestartInFlight: { ...get().serviceRestartInFlight, ...Object.fromEntries(inFlightPaths.map((path) => [path, 'restart' as const])) },
      });
      const liveRows = new Map<string, RestartRow>();
      let outcome: Result<RestartReport>;
      try {
        outcome = await restartAfterSwitch({
          results,
          repos: repos.data,
          mode,
          concurrency: get().settings.update.concurrency,
          serviceActions,
          onPhase: (row) => {
            liveRows.set(row.repoPath, row);
            const current = get().switchRestart;
            if (current?.status === 'running') {
              set({ switchRestart: { ...current, rows: [...liveRows.values()] } });
            }
          },
        });
      } catch (error) {
        outcome = { ok: false, error: { code: 'switch-restart-failed', message: error instanceof Error ? error.message : String(error) } };
      }
      const remaining = { ...get().serviceRestartInFlight };
      for (const path of inFlightPaths) {
        delete remaining[path];
      }
      set({
        serviceRestartInFlight: remaining,
        switchRestart: outcome.ok
          ? { topic, mode, status: 'done', rows: outcome.data.rows, report: outcome.data, error: null }
          : { topic, mode, status: 'error', rows: [...liveRows.values()], report: null, error: outcome.error.message },
      });
      return outcome;
    },
    switchDirtyRepos: null,
    resolveSwitchDirtyRepos: (choice) => {
      const resolve = pendingSwitchDirtyResolve;
      pendingSwitchDirtyResolve = null;
      set({ switchDirtyRepos: null });
      resolve?.(choice);
    },
    switchEdt: async (params) => {
      if (!deps) {
        return { ok: false, error: { code: 'store-not-wired', message: NO_DEPS_ERROR } };
      }
      if (get().updateStatus === 'running') {
        return { ok: false, error: { code: UPDATE_IN_PROGRESS_CODE, message: UPDATE_IN_PROGRESS_MESSAGE } };
      }
      if (get().switchRestart?.status === 'running') {
        return { ok: false, error: { code: SWITCH_RESTART_IN_PROGRESS_CODE, message: SWITCH_RESTART_IN_PROGRESS_MESSAGE } };
      }
      try {
        const result = await switchActiveEdtUseCase({
          edtRegistry: deps.edtRegistry,
          edtRegistryResourceKey: deps.edtRegistryResourceKey,
          registry: deps.registry,
          manifest: deps.manifest,
          manifestCarry: deps.manifestCarry,
          git: deps.git,
          lock: deps.lock,
          state: deps.state,
          topic: params.topic,
          force: params.force,
          // TUI backs dirty-repo seam: core pauses switch (pre-git write) on dirty repos batch
          // and waits here while switch dialog's resolution view collects developer's choice.
          // No explicit dirtyResolutions: seam is TUI's only resolution source.
          onDirtyReposBeforeSwitch: async (dirty) => {
            set({ switchDirtyRepos: dirty });
            return new Promise<SwitchDirtyReposChoice>((resolve) => {
              pendingSwitchDirtyResolve = resolve;
            });
          },
        });
        if (result.ok) {
          // Success updates store's cached active-EDT pointer immediately — direct consequence
          // of this switch, not continuous fs.watch/poll re-sync.
          set({ activeEdt: result.data.ulid });
          // Switching active EDT swaps whole member set — reload gated-tab visibility so
          // newly (in)active member's tab flips immediately.
          void get().loadTabVisibility();
        }
        return result;
      } finally {
        // Run that threw/resolved while preview raised must not leave dialog stuck waiting —
        // mirrors UpdateSlice's defensive cleanup.
        pendingSwitchDirtyResolve = null;
        if (get().switchDirtyRepos !== null) {
          set({ switchDirtyRepos: null });
        }
      }
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
        renameBranches: params.renameBranches,
      });
      if (result.ok) {
        // Member add/remove may target active EDT — reload gated-tab visibility so tab bar
        // reflects new membership immediately. Cheap and always correct even when modified EDT
        // wasn't active one.
        void get().loadTabVisibility();
      }
      return result;
    },
    // Unlike createEdt/switchEdt/modifyEdt, successful delete never targets active EDT
    // (rejected upfront by use-case) and never adds/removes active member — nothing for
    // loadTabVisibility to recompute here.
    deleteEdt: async (params) => {
      if (!deps) {
        return { ok: false, error: { code: 'store-not-wired', message: NO_DEPS_ERROR } };
      }
      return deleteEdtUseCase({
        edtRegistry: deps.edtRegistry,
        edtRegistryResourceKey: deps.edtRegistryResourceKey,
        manifest: deps.manifest,
        git: deps.git,
        lock: deps.lock,
        state: deps.state,
        edtsBaseDir: deps.edtsBaseDir,
        topic: params.topic,
        dispositions: params.dispositions,
      });
    },
    resolveMemberDeleteStatuses: async (edtUlid, members) => {
      if (!deps) {
        return [];
      }
      return resolveMemberDeleteStatusesUseCase(deps.git, deps.manifest, edtUlid, members);
    },
    listBranches: async (repoPath) => {
      if (!deps) {
        return { ok: false, error: { code: 'store-not-wired', message: NO_DEPS_ERROR } };
      }
      return listMemberBranchesUseCase(deps.git, repoPath);
    },
    listCreateBranches: async (repoPath) => {
      if (!deps) {
        return { ok: false, error: { code: 'store-not-wired', message: NO_DEPS_ERROR } };
      }
      return listCreateCandidateBranchesUseCase(deps.git, repoPath);
    },
    createMemberBranch: async (repoPath, branchName, baseBranch) => {
      if (!deps) {
        return { ok: false, error: { code: 'store-not-wired', message: NO_DEPS_ERROR } };
      }
      return createMemberBranchUseCase({ git: deps.git, repoPath, branchName, baseBranch });
    },
    renameBranch: async (repoPath, oldName, newName, edtId) => {
      if (!deps) {
        return { ok: false, error: { code: 'store-not-wired', message: NO_DEPS_ERROR } };
      }
      return renameMemberBranchUseCase({ git: deps.git, repoPath, oldName, newName, edtId });
    },
    // EDT action state for detail pane
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
    // EDT command dialog openers — thin store-level wrappers.
    // Delegates to edts-zone dialog state machines.
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
    openEdtDeleteDialog: (fullQuery: string) => {
      // Parse optional topic from query: "edt-delete [topic]"
      const parts = fullQuery.trim().split(/\s+/);
      const topic = parts.length > 1 ? parts.slice(1).join(' ') : null;
      set({ currentEdtAction: { type: 'delete', target: topic ?? 'select EDT', startedAt: new Date().toISOString() } });
      // The edts-zone will handle opening the pre-targeted delete-confirm dialog, enforcing
      // the reject-if-active check at open time.
    },
    // Mirrors openEdtDeleteDialog — the edts-zone resolves the root EDT (found → seeded wizard,
    // not found → create-from quick-pick with an inline error, no topic → create-from
    // quick-pick).
    openEdtCreateFromDialog: (fullQuery: string) => {
      // Parse optional topic from query: "edt-create-from [topic]"
      const parts = fullQuery.trim().split(/\s+/);
      const topic = parts.length > 1 ? parts.slice(1).join(' ') : null;
      set({ currentEdtAction: { type: 'create-from', target: topic ?? 'select EDT', startedAt: new Date().toISOString() } });
    },
    // Log EDT action to per-EDT SQLite
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
  });
  return (set, get, api) => {
    getState = get;
    return createState(set, get, api);
  };
}
