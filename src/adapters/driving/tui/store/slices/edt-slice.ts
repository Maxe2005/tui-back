// tui/store/slices: EDT domain state — the registry's own entries, the flat per-service
// branch/divergence listing (story 2.6), the create/switch/modify use-cases (AD-2, called
// in-process, never via the CLI), the shared branch-picker's two capabilities (story 2.26),
// and the per-EDT action log (story 2.15). Extracted from app-store.ts (see that file's
// header for why) — a StateCreator factory combined with the other slices into one Zustand
// store (AD-10: still exactly one store/one hook).
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

// Story 2.22 review fix: the default base branch was a second, independent 'development'
// literal in edts-zone.tsx's initialCreateDialog() — one shared, exported constant so the
// two can never drift out of sync.
export const DEFAULT_BASE_BRANCH = 'development';

// Story 2.9: introduced when the EDTs zone's create form had no branch-creation UI (AC1
// scoped it to topic + member selection only). Story 2.22 adds the mandatory branch-setup
// step, so this is no longer the store's own unconditional default — it's now the exact
// value the zone itself passes through `createEdt`'s `branchOptions` param for the
// zero-member case. Story 2.37: the create wizard now sends `memberPlans` instead, so this
// only remains the canonical "reuse each current branch" value for `branchOptions` callers.
export const NO_BRANCH_CREATION: CreateBranchOptions = { create: false, base: DEFAULT_BASE_BRANCH, mode: 'grouped', names: {} };

export type CreateEdtParams = {
  topic: string;
  members: string[];
  // Exactly one of the two branch strategies is expected (core rejects a call carrying
  // neither with invalid-argument; `memberPlans` wins when both are set):
  //   - `branchOptions` (Stories 2.22/2.27): one CreateBranchOptions for every member — the
  //     CLI-shaped path, e.g. NO_BRANCH_CREATION above for "reuse each current branch".
  //   - `memberPlans` (Story 2.35, used by the create wizard since Story 2.37): one plan per
  //     member repoPath, built from the wizard's Step 3 rows.
  branchOptions?: CreateBranchOptions;
  memberPlans?: Record<string, MemberBranchPlan>;
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
  // Story 2.26: mirrors setBranches's shape — see core/edt/modify.ts's ModifyEdtParams for the
  // full semantics (always renames a member's own currently-registered branch).
  renameBranches?: Array<{ repoPath: string; newName: string }>;
};

// Story 2.29: mirrors ModifyEdtParams' own shape.
export type DeleteEdtParams = {
  topic: string;
  dispositions: Record<string, MemberDisposition>;
};

// Story 2.15: EDT action state for in-progress actions shown in the detail pane.
export type EdtActionState = {
  type: 'create' | 'switch' | 'modify' | 'delete';
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

export type EdtSlice = {
  activeEdt: string | null;
  setActiveEdt: (edt: string | null) => void;
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
  // The switch dirty-repo seam — mirrors UpdateSlice's updateBlocker/resolveUpdateBlocker
  // (story 3.4). Non-null while switchActiveEdt is paused inside switchEdt: story 2.39 raises
  // it only when a state-2/3 repo (outside the outgoing EDT) is dirty, and waits for a
  // SwitchDirtyReposChoice (`cancel`, or `proceed` with per-repo adopt/discard resolutions).
  // While this is set the switch dialog renders story 2.41's resolution view (global strategy,
  // per-service overrides, discard confirmation — its draft lives in the dialog state, never
  // here or in core) and calls resolveSwitchDirtyRepos to resume the paused core call with
  // `{ kind: 'proceed', resolutions }` or `{ kind: 'cancel' }`.
  switchDirtyRepos: SwitchDirtyRepo[] | null;
  resolveSwitchDirtyRepos: (choice: SwitchDirtyReposChoice) => void;
  modifyEdt: (params: ModifyEdtParams) => Promise<Result<ModifyEdtData>>;
  // Story 2.29: mirrors createEdt/switchEdt/modifyEdt's own call shape — the delete dialog's
  // confirm calls core/edt/delete.ts's deleteEdt in-process (AD-2), never via the CLI.
  deleteEdt: (params: DeleteEdtParams) => Promise<Result<DeleteEdtData>>;
  // Story 2.29: the delete-confirm dialog's per-member merge/clean status fetch (mirrors
  // listMemberBranches' thin-wrapper precedent — deps.git/manifest are never called directly
  // from the TUI layer, only through a core export). Never fails outright: a per-member read
  // failure folds into that member's own statusError field instead (core/edt/delete.ts).
  // `edtUlid` is the target EDT's own ulid (the one being deleted) — needed for the
  // corrected clean-detection's `tui-back:<edtUlid>` tagged-stash check (Design Notes).
  resolveMemberDeleteStatuses: (edtUlid: string, members: readonly EdtMember[]) => Promise<MemberDeleteStatus[]>;
  // Story 2.26: the shared branch-picker's own two capabilities, wrapping core/edt/modify.ts's
  // listMemberBranches/createMemberBranch exports (never `deps.git` directly — Design Notes).
  // `renameBranch` backs the picker's Pick-existing row-rename pre-step at Add-to-EDT, the one
  // entry point where modifyEdt's own `renameBranches` param structurally cannot apply (no
  // existing membership to resolve `oldName` from).
  listBranches: (repoPath: string) => Promise<Result<string[]>>;
  // Story 2.37: the create wizard's Step 3 per-service lists (local + remote-tracking refs),
  // wrapping core/edt/create.ts's listCreateCandidateBranches — never fetches.
  listCreateBranches: (repoPath: string) => Promise<Result<CreateCandidateBranches>>;
  createMemberBranch: (repoPath: string, branchName: string, baseBranch: string) => Promise<Result<void>>;
  renameBranch: (repoPath: string, oldName: string, newName: string) => Promise<Result<void>>;
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
  openEdtDeleteDialog: (fullQuery: string) => void;
  // Story 2.15: logs an EDT action to the per-EDT SQLite action_log table.
  logEdtAction: (ulid: string, actionType: string, outcome: 'success' | 'failed', detail: string) => Promise<void>;
};

export function createEdtSlice(deps?: AppStoreDeps): StateCreator<AppState, [], [], EdtSlice> {
  // Bug fix: the pending seam promise's resolver — installed when switchActiveEdt raises a
  // dirty-repo preview, consumed when the dialog dispatches its choice. Held in closure,
  // never in Zustand state (mirrors UpdateSlice's own pendingBlockerResolve).
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
      // A no-op-with-signal guard, not a throw: an unwired store (every pre-2.6 `createAppStore()`
      // call, including tests) must stay usable — it just can never actually load.
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
        branchOptions: params.branchOptions,
        memberPlans: params.memberPlans,
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
          // The TUI backs the dirty-repo seam — core pauses the switch (before any git
          // write) on the batch of dirty repos and waits here while the switch dialog's
          // resolution view (story 2.41) collects the developer's choice. No explicit dirtyResolutions: the seam
          // is the TUI's only resolution source.
          onDirtyReposBeforeSwitch: async (dirty) => {
            set({ switchDirtyRepos: dirty });
            return new Promise<SwitchDirtyReposChoice>((resolve) => {
              pendingSwitchDirtyResolve = resolve;
            });
          },
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
        // Story 2.13: a member add/remove may target the active EDT — reload gated-tab
        // visibility so the tab bar reflects the new membership immediately (Boundaries:
        // "active EDT membership changes ... tab bar updates immediately"). Cheap and
        // always-correct even when the modified EDT wasn't the active one (the recomputed
        // status is then identical to what it already was).
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
    openEdtDeleteDialog: (fullQuery: string) => {
      // Parse optional topic from query: "edt-delete [topic]"
      const parts = fullQuery.trim().split(/\s+/);
      const topic = parts.length > 1 ? parts.slice(1).join(' ') : null;
      set({ currentEdtAction: { type: 'delete', target: topic ?? 'select EDT', startedAt: new Date().toISOString() } });
      // The edts-zone will handle opening the pre-targeted delete-confirm dialog, enforcing
      // the reject-if-active check at open time.
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
  });
}
