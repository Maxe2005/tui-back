// tui/store/slices: EDT domain state — the registry's entries, the flat per-service
// branch/divergence listing, the create/switch/modify/delete/activate use-cases (called
// in-process, never via the CLI), the branch-picker's capabilities, and the per-EDT action
// log. A StateCreator factory combined with the other slices into the one Zustand store.
import type { StateCreator } from 'zustand';
import {
  createEdt as createEdtUseCase,
  listCreateCandidateBranches as listCreateCandidateBranchesUseCase,
  type CreateBranchOptions,
  type CreateCandidateBranches,
  type CreateEdtData,
  type MemberBranchPlan,
} from '../../../../../core/edt/create.js';
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

// The default base branch — one shared constant so edts-zone.tsx's initialCreateDialog() and
// the store can never drift apart.
export const DEFAULT_BASE_BRANCH = 'development';

// The canonical "reuse each current branch" value for `branchOptions` callers (the create
// wizard sends `memberPlans` instead).
export const NO_BRANCH_CREATION: CreateBranchOptions = { create: false, base: DEFAULT_BASE_BRANCH, mode: 'grouped', names: {} };

export type CreateEdtParams = {
  topic: string;
  members: string[];
  // Exactly one of the two branch strategies is expected (core rejects a call carrying
  // neither with invalid-argument; `memberPlans` wins when both are set):
  //   - `branchOptions`: one CreateBranchOptions for every member — the CLI-shaped path, e.g.
  //     NO_BRANCH_CREATION above for "reuse each current branch".
  //   - `memberPlans` (used by the create wizard): one plan per member repoPath, built from the
  //     wizard's Step 3 rows.
  branchOptions?: CreateBranchOptions;
  memberPlans?: Record<string, MemberBranchPlan>;
};

// `overwrite` holds the at-risk paths the developer confirmed discarding, per repoPath.
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
  // The EDTs zone's branch/divergence listing (FR-9). `edtsBranches` is null only before the
  // first successful load; a successful (possibly empty) load always replaces it with an array,
  // never leaves a stale one in place mid-refresh. `edtsBranchesStatus` reflects only the
  // in-flight request ('loading') or its failure ('error') — a successful load returns to
  // 'idle', with `edtsBranches` (not the status) carrying the "loaded" signal.
  edtsBranches: ServiceBranchDivergence[] | null;
  edtsBranchesStatus: 'idle' | 'loading' | 'error';
  edtsBranchesError: string | null;
  // listEdtBranchesDivergence's `unreachable`/`errors`, so a registry-listing problem (a stat
  // failure, an unreachable registered path) is visible in the TUI as in `tui-back edts`.
  // Populated alongside `edtsBranches` on every successful load; like `edtsBranches`, left as
  // the last successfully-loaded value on a failed reload (the zone gates display on
  // `edtsBranchesStatus !== 'error'`, same as it does for the row list).
  edtsUnreachable: string[];
  edtsErrors: BranchDivergenceEntryError[];
  loadEdtsBranches: () => Promise<void>;
  // The EDT registry's own entries (ulid/topic/status/members) — the EDT selector's data
  // source, distinct from the flat per-service `edtsBranches` above. A failed reload clears
  // `edts` to an empty array: never show stale rows under an error banner.
  edts: EdtRegistryEntry[] | null;
  edtsStatus: 'idle' | 'loading' | 'error';
  edtsError: string | null;
  // The store's cached read of state.json's active-EDT pointer (AD-10), populated by
  // loadEdts() and refreshed by a successful switchEdt() — never continuously re-synced via
  // fs.watch/poll while the TUI is open (see deferred-work.md). Used by the EDTs zone to tell
  // which selector row is the active EDT (never `EdtRegistryEntry.status`, which create.ts sets
  // to 'active' for every brand-new entry — not an exclusive "the one active EDT" flag).
  loadEdts: () => Promise<void>;
  // The zone-owned dialogs call these core use-cases in-process (AD-2), with the same call
  // shape as the CLI's runEdtCreate/runEdtSwitch/runEdtModify. An unwired store degrades to an
  // explicit error Result rather than throwing.
  createEdt: (params: CreateEdtParams) => Promise<Result<CreateEdtData>>;
  // The first EDT's explicit activation (wizard Step 4) — core/edt/activate.ts. `blocked`
  // changes nothing; `activated` updates the cached active pointer like switchEdt.
  activateEdt: (params: ActivateEdtRequest) => Promise<Result<ActivateEdtData>>;
  switchEdt: (params: SwitchEdtParams) => Promise<Result<SwitchActiveEdtData>>;
  // The switch dirty-repo seam — mirrors UpdateSlice's updateBlocker/resolveUpdateBlocker.
  // Non-null while switchActiveEdt is paused inside switchEdt: core raises it only when a
  // state-2/3 repo (outside the outgoing EDT) is dirty, and waits for a
  // SwitchDirtyReposChoice. While set, the switch dialog renders its resolution view (its
  // draft lives in the dialog state, never here or in core) and calls resolveSwitchDirtyRepos
  // with `{ kind: 'proceed', resolutions }` or `{ kind: 'cancel' }`.
  switchDirtyRepos: SwitchDirtyRepo[] | null;
  resolveSwitchDirtyRepos: (choice: SwitchDirtyReposChoice) => void;
  modifyEdt: (params: ModifyEdtParams) => Promise<Result<ModifyEdtData>>;
  // Same call shape as createEdt/switchEdt/modifyEdt — the delete dialog's confirm calls
  // core/edt/delete.ts's deleteEdt in-process (AD-2), never via the CLI.
  deleteEdt: (params: DeleteEdtParams) => Promise<Result<DeleteEdtData>>;
  // The delete-confirm dialog's per-member merge/clean status, through a core export (the TUI
  // never calls deps.git/manifest directly). Never fails outright: a per-member read failure
  // folds into that member's statusError. `edtUlid` is the EDT being deleted — needed for the
  // `tui-back:<edtUlid>` tagged-stash check.
  resolveMemberDeleteStatuses: (edtUlid: string, members: readonly EdtMember[]) => Promise<MemberDeleteStatus[]>;
  // The branch-picker's capabilities, wrapping core/edt/modify.ts's exports (never `deps.git`
  // directly). `renameBranch` backs the picker's row rename when adding a member, where
  // modifyEdt's `renameBranches` cannot apply (no existing membership to resolve `oldName`).
  listBranches: (repoPath: string) => Promise<Result<string[]>>;
  // The create wizard's Step 3 per-service lists (local + remote-tracking refs), wrapping
  // core/edt/create.ts's listCreateCandidateBranches — never fetches.
  listCreateBranches: (repoPath: string) => Promise<Result<CreateCandidateBranches>>;
  createMemberBranch: (repoPath: string, branchName: string, baseBranch: string) => Promise<Result<void>>;
  renameBranch: (repoPath: string, oldName: string, newName: string) => Promise<Result<void>>;
  // EDT action state for the detail pane — tracks the in-progress action and loads the action
  // log per EDT.
  currentEdtAction: EdtActionState | null;
  setCurrentEdtAction: (action: EdtActionState | null) => void;
  edtActionLog: EdtActionLogEntry[];
  edtActionLogStatus: 'idle' | 'loading' | 'error';
  loadEdtActionLog: (ulid: string) => Promise<void>;
  // EDT command dialog openers — thin store-level wrappers so commands can trigger the same
  // dialogs edts-zone.tsx owns.
  openEdtCreateDialog: () => void;
  openEdtSwitchDialog: (fullQuery: string) => void;
  openEdtModifyDialog: (fullQuery: string) => void;
  openEdtDeleteDialog: (fullQuery: string) => void;
  // `edt-create-from [topic]` — opens the creation wizard seeded from a root EDT.
  openEdtCreateFromDialog: (fullQuery: string) => void;
  // Logs an EDT action to the per-EDT SQLite action_log table.
  logEdtAction: (ulid: string, actionType: string, outcome: 'success' | 'failed', detail: string) => Promise<void>;
};

export function createEdtSlice(deps?: AppStoreDeps): StateCreator<AppState, [], [], EdtSlice> {
  // The pending seam promise's resolver — installed when switchActiveEdt raises a dirty-repo
  // preview, consumed when the dialog dispatches its choice. Held in closure, never in Zustand
  // state (mirrors UpdateSlice's own pendingBlockerResolve).
  let pendingSwitchDirtyResolve: ((choice: SwitchDirtyReposChoice) => void) | null = null;
  return (set, get) => ({
    activeEdt: null,
    setActiveEdt: (edt) => set({ activeEdt: edt }),
    edtsBranches: null,
    edtsBranchesStatus: 'idle',
    edtsBranchesError: null,
    edtsUnreachable: [],
    edtsErrors: [],
    loadEdtsBranches: async () => {
      // A no-op-with-signal guard, not a throw: an unwired store (tests included) must stay
      // usable — it just can never actually load.
      if (!deps) {
        set({ edtsBranchesStatus: 'error', edtsBranchesError: NO_DEPS_ERROR });
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
      // A `state.json` read failure is unrelated to whether the EDT registry loaded — don't
      // discard a good `edts` list (including a genuinely-empty one, which auto-opens the
      // create prompt) just because the active-EDT pointer read failed alongside it. Degrade
      // only the pointer, to "no active EDT known".
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
        // A create never touches state.json's active pointer — activation only happens through
        // the wizard's Step 4 (activateEdt for the first EDT, or switchEdt). A new EDT is a
        // fresh set of active-EDT members: reload gated-tab visibility so a carrying member
        // flips its tab immediately. Fire-and-forget: never blocks the create flow's result.
        void get().loadTabVisibility();
      }
      return result;
    },
    activateEdt: async (params) => {
      if (!deps) {
        return { ok: false, error: { code: 'store-not-wired', message: NO_DEPS_ERROR } };
      }
      const result = await activateEdtUseCase({
        edtRegistry: deps.edtRegistry,
        edtRegistryResourceKey: deps.edtRegistryResourceKey,
        registry: deps.registry,
        manifest: deps.manifest,
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
      try {
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
          // The TUI backs the dirty-repo seam — core pauses the switch (before any git write)
          // on the batch of dirty repos and waits here while the switch dialog's resolution
          // view collects the developer's choice. No explicit dirtyResolutions: the seam is the
          // TUI's only resolution source.
          onDirtyReposBeforeSwitch: async (dirty) => {
            set({ switchDirtyRepos: dirty });
            return new Promise<SwitchDirtyReposChoice>((resolve) => {
              pendingSwitchDirtyResolve = resolve;
            });
          },
        });
        if (result.ok) {
          // Success updates the store's cached active-EDT pointer immediately — a direct
          // consequence of this switch, not a continuous fs.watch/poll re-sync.
          set({ activeEdt: result.data.ulid });
          // Switching the active EDT swaps its whole member set — reload
          // gated-tab visibility so a newly (in)active member's tab flips immediately.
          void get().loadTabVisibility();
        }
        return result;
      } finally {
        // A run that threw (or resolved) while a preview was still raised must not leave the
        // dialog stuck waiting forever — mirrors UpdateSlice's own defensive cleanup.
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
        // A member add/remove may target the active EDT — reload gated-tab visibility so the
        // tab bar reflects the new membership immediately. Cheap and always correct even when
        // the modified EDT wasn't the active one.
        void get().loadTabVisibility();
      }
      return result;
    },
    // Note: unlike createEdt/switchEdt/modifyEdt, a successful delete never targets the active
    // EDT (rejected upfront by the use-case itself) and never adds/removes an active member —
    // so there is nothing for loadTabVisibility to recompute here.
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
    renameBranch: async (repoPath, oldName, newName) => {
      if (!deps) {
        return { ok: false, error: { code: 'store-not-wired', message: NO_DEPS_ERROR } };
      }
      return renameMemberBranchUseCase({ git: deps.git, repoPath, oldName, newName });
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
    // EDT command dialog openers - delegate to the edts-zone dialog state machines
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
}
