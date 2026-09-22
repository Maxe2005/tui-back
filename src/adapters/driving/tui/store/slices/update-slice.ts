// tui/store/slices: the Update zone's group-update run state (story 3.1). Calls the same
// core/scripts/group-update.ts use-case the CLI's `tui-back update` wraps, in-process
// (AD-2, never by shelling out to the CLI). Extracted as a slice factory combined with the
// other slices into the one Zustand store (AD-10).
import type { StateCreator } from 'zustand';
import {
  groupUpdate as groupUpdateUseCase,
  markGroupUpdateInterrupted as markGroupUpdateInterruptedUseCase,
  type GroupUpdateRepoResult,
  type GroupUpdateScope,
  type UpdateBlocker,
  type UpdateBlockerChoice,
} from '../../../../../core/scripts/group-update.js';
import { getServiceHealth } from '../../../../../core/logs/use-cases.js';
import type { HealthState } from '../../../../../core/ports/docker.js';
import { mergeLastServiceOutcomes } from '../../zones/update/update-zone.logic.js';
import type { AppState, AppStoreDeps } from '../app-store.js';

export type UpdateRunStatus = 'idle' | 'running' | 'done' | 'error';

// Story 3.6: the Update zone's own health-poll cadence — independent of Logs zone's
// LOGS_HEALTH_POLL_INTERVAL_MS (Never: "no shared subscription"), same 5s cadence by
// convention rather than by coupling.
export const UPDATE_HEALTH_POLL_INTERVAL_MS = 5000;

export type UpdateSlice = {
  // The last (or in-flight) run: `updateResults`/`updateNote` carry a `done` run's outcome
  // (the idle render shows the last outcome, the zero-member no-op message, or the
  // interrupted re-run offer derived from `edts`); `updateError`/`updateErrorCode` carry a
  // top-level `error` run's failure (e.g. no-active-edt, update-already-running).
  updateStatus: UpdateRunStatus;
  updateResults: GroupUpdateRepoResult[];
  updateNote: string | null;
  updateTopic: string | null;
  updateError: string | null;
  updateErrorCode: string | null;
  // The EDT ulid the current/last run targeted — captured at run start so
  // markUpdateInterrupted() marks the run's own EDT even if the active pointer moved.
  // An all-repos run targets no EDT: `updateUlid` is `'all'` and `updateScope` is `'all'`.
  updateUlid: string | null;
  updateScope: GroupUpdateScope | null;
  // Story 3.4: the currently raised resolution blocker (null when no repo is waiting).
  // Core's `onUpdateBlocker` seam sets this and waits; the Update zone renders the bounded
  // four-choice modal menu over it, and this dispatch carries the developer's choice back
  // to the waiting run. Every git write still goes through the core use-case (AD-1) — the
  // driving side owns only menu rendering and the editor process.
  updateBlocker: UpdateBlocker | null;
  resolveUpdateBlocker: (choice: UpdateBlockerChoice) => void;
  // Starts the core use-case in-process. A no-op-with-signal guard, not a throw, when the
  // store is unwired; a second call while a run is already in flight reports
  // `update-already-running` so double-Enter gives feedback instead of silence.
  // `scope` defaults to `'edt'` (bare update); `'all'` runs the all-repos maintenance mode.
  runGroupUpdate: (scope?: GroupUpdateScope) => Promise<void>;
  // Marks the run's EDT `interrupted` after an abandoned run (quit-mid-run confirmation)
  // and refreshes `edts` so the next idle render offers a re-run — but only while a run
  // is actually in flight: a quit-confirm racing completion must never mark a healthy,
  // already-finished EDT interrupted. Never throws when unwired or when no run ever
  // targeted an EDT.
  markUpdateInterrupted: () => Promise<void>;
  clearUpdate: () => void;

  // Story 3.6: live per-service container health for the Update zone's always-visible
  // service list — keyed by repoPath, independent of Logs zone's own `logsPanes[*].health`
  // (Never: "no shared subscription"). A repoPath with no entry yet (poll still in flight,
  // or never started) is treated as `down` by the zone (matches Logs zone's own
  // emptyPane default, and the I/O matrix's "glyph falls back to down until the first
  // health poll resolves").
  updateServiceHealth: Record<string, HealthState>;
  // Story 3.6: the last completed run's per-service outcome, keyed by `service` (results
  // carry no repoPath) — merged, never wholesale-replaced, by runGroupUpdate's success
  // branch below, so a partial-scope run never drops another service's earlier outcome.
  lastServiceOutcomes: Record<string, GroupUpdateRepoResult>;
  // Starts (or restarts, on a changed service list) a one-shot-then-interval poll of every
  // given repoPath's container health — mirrors logs-slice.ts's pollPaneHealth/
  // startHealthPolling pattern, but one poll cycle covers every service in `edtsBranches`
  // at once rather than one timer per pane (Code Map: "polls every service ... on
  // mount/unmount, independent of Logs zone's pane subscriptions").
  startUpdateHealthPolling: (repoPaths: readonly string[]) => void;
  stopUpdateHealthPolling: () => void;
};

export function createUpdateSlice(deps?: AppStoreDeps): StateCreator<AppState, [], [], UpdateSlice> {
  // Story 3.4: the pending seam promise's resolver — installed when core raises a blocker,
  // consumed when the zone menu dispatches a choice. Held in closure, never in Zustand
  // state (a function is non-serializable, and set() replacements must not drop it).
  let pendingBlockerResolve: ((choice: UpdateBlockerChoice) => void) | null = null;
  // Story 3.6: one shared poll timer for every currently-tracked service (not one per
  // repoPath, unlike logs-slice.ts) — restarted whenever the tracked list changes so a
  // service that appears/disappears from `edtsBranches` is picked up without leaking a
  // stale timer. Held in closure, mirrors logs-slice.ts's own healthPollTimers convention.
  let healthPollTimer: ReturnType<typeof setInterval> | null = null;
  let pollingRepoPaths: readonly string[] = [];
  return (set, get) => {
    // Story 3.6: one poll cycle for a single service — resolves its manifest-declared
    // container and inspects it, updating the badge only on success. Mirrors
    // logs-slice.ts's own pollPaneHealth: any failure (manifest load fails, inspect
    // errors, docker unreachable) keeps last-known health and never crashes the view (I/O
    // matrix: "silent per-poll no-op, mirrors existing Logs-zone precedent").
    async function pollServiceHealth(repoPath: string): Promise<void> {
      if (!deps) {
        return;
      }
      const manifestResult = await deps.manifest.load(repoPath);
      if (!manifestResult.ok) {
        return;
      }
      const healthResult = await getServiceHealth({ docker: deps.docker, container: manifestResult.data.container });
      if (!healthResult.ok) {
        return;
      }
      const health = healthResult.data;
      set((state) => {
        if (state.updateServiceHealth[repoPath] === health) {
          return {};
        }
        return { updateServiceHealth: { ...state.updateServiceHealth, [repoPath]: health } };
      });
    }

    function pollAll(repoPaths: readonly string[]): void {
      for (const repoPath of repoPaths) {
        void pollServiceHealth(repoPath);
      }
    }

    return {
      updateStatus: 'idle',
      updateResults: [],
      updateNote: null,
      updateTopic: null,
      updateError: null,
      updateErrorCode: null,
      updateUlid: null,
      updateScope: null,
      updateBlocker: null,
      resolveUpdateBlocker: (choice: UpdateBlockerChoice) => {
        const resolve = pendingBlockerResolve;
        pendingBlockerResolve = null;
        set({ updateBlocker: null });
        resolve?.(choice);
      },
      runGroupUpdate: async (scope: GroupUpdateScope = 'edt') => {
        if (!deps || !deps.container || !deps.migration) {
          set({
            updateStatus: 'error',
            updateError: 'No ports wired into the TUI store',
            updateErrorCode: 'store-not-wired',
          });
          return;
        }
        if (get().updateStatus === 'running') {
          set({
            updateStatus: 'error',
            updateError: 'A group update is already in progress — wait for it to finish before starting another.',
            updateErrorCode: 'update-already-running',
          });
          return;
        }
        set({
          updateStatus: 'running',
          updateResults: [],
          updateNote: null,
          updateTopic: null,
          updateError: null,
          updateErrorCode: null,
          updateUlid: null,
          updateScope: scope,
          updateBlocker: null,
        });
        pendingBlockerResolve = null;
        get().setRunInProgress(true);
        // try/finally: a throwing use-case (a rejecting fake port in tests, a truly
        // unexpected failure in production) must still clear `runInProgress` — otherwise the
        // AppShell `q` gate and every `runInProgress` reader wedge in `running` forever.
        try {
          const result = await groupUpdateUseCase({
            edtRegistry: deps.edtRegistry,
            state: deps.state,
            manifest: deps.manifest,
            git: deps.git,
            container: deps.container,
            migration: deps.migration,
            lock: deps.lock,
            registry: deps.registry,
            scope,
            // Story 3.4: the TUI backs the assisted-resolution seam — core pauses the run on
            // each dirty/conflicted repo and waits here while the zone's modal menu collects
            // the developer's choice (stash / open in editor / cancel repo / cancel run).
            onUpdateBlocker: async (blocker) => {
              set({ updateBlocker: blocker });
              return new Promise<UpdateBlockerChoice>((resolve) => {
                pendingBlockerResolve = resolve;
              });
            },
          });
          if (result.ok) {
            set((state) => ({
              updateStatus: 'done',
              updateResults: result.data.results,
              updateNote: result.data.note ?? null,
              updateTopic: result.data.topic,
              updateUlid: result.data.ulid,
              updateScope: result.data.scope,
              // Story 3.6: merged, never wholesale-replaced — a partial-scope run (a single
              // EDT) must never drop another service's earlier outcome.
              lastServiceOutcomes: mergeLastServiceOutcomes(state.lastServiceOutcomes, result.data.results),
            }));
          } else {
            set({
              updateStatus: 'error',
              updateError: result.error.message,
              updateErrorCode: result.error.code,
            });
          }
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          set({ updateStatus: 'error', updateError: detail, updateErrorCode: 'internal-error' });
        } finally {
          // A run that threw while a blocker was still raised (a rejecting fake port under a
          // test, a truly unexpected failure in production) must not leave the menu raised
          // forever — the choice path already cleared it via resolveUpdateBlocker.
          pendingBlockerResolve = null;
          if (get().updateBlocker !== null) {
            set({ updateBlocker: null });
          }
          get().setRunInProgress(false);
        }
      },
      markUpdateInterrupted: async () => {
        // The run already finished (or never started) — the quit-confirm simply raced
        // completion. Reset the flag and leave the outcome (and the EDT status) alone.
        if (get().updateStatus !== 'running') {
          get().setRunInProgress(false);
          return;
        }
        const ulid = get().updateUlid ?? get().activeEdt;
        // An all-repos run targets no EDT — there is nothing to mark interrupted. Reset to
        // idle (and clear the flag) without touching the EDT registry.
        if (get().updateScope === 'all' || ulid === 'all') {
          get().setRunInProgress(false);
          set({ updateStatus: 'idle' });
          return;
        }
        if (!deps || ulid === null) {
          get().setRunInProgress(false);
          set({ updateStatus: 'idle' });
          return;
        }
        // A setStatus/loadEdts failure surfaces as an error state — never a silent return to
        // `idle` pretending the interruption was recorded.
        try {
          const marked = await markGroupUpdateInterruptedUseCase(deps.edtRegistry, ulid);
          if (!marked.ok) {
            set({ updateStatus: 'error', updateError: marked.error.message, updateErrorCode: marked.error.code });
            return;
          }
          set({ updateStatus: 'idle' });
          // Refresh the registry entries so the next idle render sees the `interrupted`
          // status and offers a re-run (mirrors loadEdts' own mount-effect idiom).
          await get().loadEdts();
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          set({ updateStatus: 'error', updateError: detail, updateErrorCode: 'internal-error' });
        } finally {
          get().setRunInProgress(false);
        }
      },
      clearUpdate: () =>
        set({
          updateStatus: 'idle',
          updateResults: [],
          updateNote: null,
          updateTopic: null,
          updateError: null,
          updateErrorCode: null,
          updateUlid: null,
          updateScope: null,
          updateBlocker: null,
        }),

      updateServiceHealth: {},
      lastServiceOutcomes: {},
      startUpdateHealthPolling: (repoPaths) => {
        pollingRepoPaths = [...repoPaths];
        pollAll(pollingRepoPaths);
        if (healthPollTimer !== null) {
          clearInterval(healthPollTimer);
        }
        healthPollTimer = setInterval(() => {
          pollAll(pollingRepoPaths);
        }, UPDATE_HEALTH_POLL_INTERVAL_MS);
        // Never keep the process alive for a poll timer alone (tests, abnormal exits) —
        // mirrors logs-slice.ts's own startHealthPolling.
        const unrefable = healthPollTimer as unknown as { unref?: () => void };
        if (typeof unrefable.unref === 'function') {
          unrefable.unref();
        }
      },
      stopUpdateHealthPolling: () => {
        if (healthPollTimer !== null) {
          clearInterval(healthPollTimer);
          healthPollTimer = null;
        }
        pollingRepoPaths = [];
      },
    };
  };
}
