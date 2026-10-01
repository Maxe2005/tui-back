// tui/store/slices: Logs zone state — the selected services in both left-panel lists, the ad
// hoc fullscreen preview target, and the per-pane buffer/error/scroll/health state. The ring
// buffer itself lives in core/logs' LogsManager (one per store, in memory only); `logsPanes`
// is a mirror kept in sync via `onUpdate` so React re-renders, never a second source of truth.
// Also owns the persisted filter-history lists.
import type { StateCreator } from 'zustand';
import { createLogsManager, type LogsManager } from '../../../../../core/logs/index.js';
import { clearLogs, getServiceHealth, loadOlderLogs, restartService, subscribeLogs, unsubscribeLogs } from '../../../../../core/logs/use-cases.js';
import type { HealthState, LogLine } from '../../../../../core/ports/docker.js';
import type { AppState, AppStoreDeps } from '../app-store.js';
import {
  filterHistoryKeyString,
  pushFilterHistoryEntry,
  resolvePostLoadScrollOffset,
  type FilterHistoryKey,
} from '../../zones/logs/logs-zone.logic.js';

export type LogsPaneErrorState = { code: string; message: string } | null;

export type LogsPaneData = {
  repoPath: string;
  service: string;
  lines: LogLine[];
  streamError: LogsPaneErrorState;
  noMoreHistory: boolean;
  // Live Docker health for this pane's container (never persisted — read on poll only) plus
  // whether a developer-triggered `docker restart` is in flight for this pane (gates the R
  // control + the no-op guard). Defaults: `down` (not yet proven up) and `false`.
  health: HealthState;
  restarting: boolean;
  // How many lines back from the tail this pane is currently scrolled — 0 means "pinned to
  // the live tail". Purely local UI state (never mirrored from LogsManager); bumped by
  // loadOlderLogsPane's own successful prepend so the viewport doesn't visually jump.
  scrollOffset: number;
};

function emptyPane(repoPath: string, service: string): LogsPaneData {
  return { repoPath, service, lines: [], streamError: null, noMoreHistory: false, scrollOffset: 0, health: 'down', restarting: false };
}

// Per-pane health poll cadence — on subscribe plus an interval, cleared on unsubscribe. Never
// resubscribes the log stream itself.
export const LOGS_HEALTH_POLL_INTERVAL_MS = 5000;

export type LogsSlice = {
  // repoPaths currently checked in the EDT-members list / the other-services list — any
  // manifest service can be streamed, not only active-EDT members.
  logsEdtSelected: string[];
  logsOtherSelected: string[];
  // Set only for an Enter-on-an-unselected-row ad hoc preview — never added to
  // logsEdtSelected/logsOtherSelected, so closing it never mutates selection.
  logsFullscreenTarget: string | null;
  // The service name to render as this preview's title, captured at the moment fullscreen was
  // opened rather than re-derived via a live `rows.find(...)` lookup — that can miss (e.g. a
  // transient services-list load error while the preview is open) and fall back to a bare
  // "Logs" label right when the user needs the service name most.
  logsFullscreenServiceName: string | null;
  // Keyed by repoPath — one entry per currently-active pane (selected, or the ad hoc
  // fullscreen target). A key with no entry yet (subscribe still in flight) is treated as an
  // empty/loading pane by the zone.
  logsPanes: Record<string, LogsPaneData>;
  toggleLogsEdtSelection: (repoPath: string) => void;
  toggleLogsOtherSelection: (repoPath: string) => void;
  selectAllLogsEdtServices: (repoPaths: readonly string[]) => void;
  deselectAllLogsEdtServices: () => void;
  openLogsFullscreen: (repoPath: string, serviceName: string) => void;
  closeLogsFullscreen: () => void;
  // Resolves repoPath's manifest-declared container and starts (or, if already subscribed,
  // no-ops) a live stream for it — the store action every list-row/pane-becomes-active
  // transition calls (never core/logs directly from a component).
  subscribeLogsPane: (repoPath: string, service: string) => Promise<void>;
  unsubscribeLogsPane: (repoPath: string) => void;
  // Developer-triggered restart for one pane's service (R on a sub-focused grid
  // pane or a fullscreen pane). A call while that pane is already restarting is a no-op —
  // never a second concurrent `docker restart`. After the call resolves, health is re-polled
  // immediately; a failure surfaces inline on the pane while the badge keeps last-known.
  restartLogsPane: (repoPath: string) => Promise<void>;
  loadOlderLogsPane: (repoPath: string) => Promise<void>;
  // Wipes a pane's buffered/displayed lines (a display "clear", like a shell's `clear`) —
  // the stream itself keeps running, so a new line still appears immediately afterward.
  clearLogsPane: (repoPath: string) => void;
  setLogsPaneScrollOffset: (repoPath: string, offset: number) => void;
  // Tears down every currently-active pane's subscription (killing its docker child process,
  // if any). Normal zone-unmount teardown already stops each pane individually; this is the
  // process-level fallback for an abnormal exit (crash, Ctrl+C, SIGTERM) so a `docker logs -f`
  // child is never orphaned — wired into `process.on('exit'|'SIGINT'|'SIGTERM', ...)` in
  // src/bin/tui.ts.
  stopAllLogsPanes: () => void;

  // The filter-history lists, persisted to state.json — keyed by filterHistoryKeyString's flat
  // encoding of a FilterHistoryKey. In the store (not zone-local) so the Settings screen's
  // clear actions and the Logs zone's recall/grid browser share one source of truth, like
  // splitterRatios in navigation-slice.ts.
  filterHistory: Record<string, string[]>;
  // Hydrates filterHistory from state.json once at AppShell mount, mirroring
  // loadSplitterRatios() — a missing/corrupt file (or an unwired store) silently keeps the
  // empty-object default seeded below.
  loadFilterHistory: () => Promise<void>;
  // Called by the Logs zone on a successful filter-editor commit (Enter, compiles, non-empty)
  // — applies pushFilterHistoryEntry to the exact (scope, mode) list `key` identifies and
  // persists the whole map immediately (no separate save step, like setSplitterRatio).
  commitFilterHistoryEntry: (key: FilterHistoryKey, query: string) => void;
  // "Clear global" only touches the two global lists (text + regex).
  clearGlobalFilterHistory: () => void;
  // "Clear this service" only touches that one service's two lists (text + regex) — every
  // other service and the global lists are untouched.
  clearServiceFilterHistory: (repoPath: string) => void;
  // `:reset` (histories category): empties the in-memory map, bumps the version (so no
  // in-flight load re-applies stale disk data), and resolves only once every already-queued
  // writeFilterHistory has landed — so the reset's own disk write can't be overwritten by a
  // save that was still pending when it ran.
  clearFilterHistoryAndDrainSaves: () => Promise<void>;
};

export function createLogsSlice(deps?: AppStoreDeps): StateCreator<AppState, [], [], LogsSlice> {
  // One manager per store instance — never recreated per-render. `deps` is optional so an
  // unwired `createAppStore()` (tests included) keeps working.
  const logsManager: LogsManager | null = deps ? createLogsManager(deps.docker) : null;

  // Mirrors navigation-slice.ts's splitterRatiosSaveChain/splitterRatiosVersion pair —
  // serializes writeFilterHistory calls so concurrent commits/clears land on disk in request
  // order, and guards loadFilterHistory against overwriting a newer live change with a stale
  // on-disk snapshot it started reading before that change landed.
  let filterHistorySaveChain: Promise<void> = Promise.resolve();
  let filterHistoryVersion = 0;
  // `filterHistoryVersion` alone only protects a *stale read* from clobbering a *newer write*
  // — it does nothing for a write that fires while the first loadFilterHistory() (AppShell's
  // mount-time hydration) is still in flight. Without this, a commit or clear would apply its
  // change to the still-empty pre-load map and persist it wholesale — discarding every other
  // scope/service's history on disk. Set for the duration of the one in-flight load; each of
  // the three mutators awaits it (a no-op when null, so the common case stays synchronous and
  // optimistic) before reading `get().filterHistory`.
  let filterHistoryLoadPromise: Promise<void> | null = null;

  // One poll timer per subscribed pane (keyed by repoPath) — started on subscribe,
  // cleared on unsubscribe/stopAll. Never resubscribes the log stream itself.
  const healthPollTimers = new Map<string, ReturnType<typeof setInterval>>();

  function persistFilterHistory(next: Record<string, string[]>): void {
    if (!deps) {
      return;
    }
    const run = async () => {
      await deps.state.writeFilterHistory(next);
    };
    filterHistorySaveChain = filterHistorySaveChain.then(run, run);
  }

  return (set, get) => {
    // Shared by loadOlderLogsPane and subscribeLogsPane's startWithHistory fetch — both "fetch
    // the next bufferSize older lines and prepend them" over an already-subscribed key,
    // differing only in when they're invoked (a manual scrollback-to-oldest vs. right after a
    // fresh subscription).
    async function loadOlder(repoPath: string, container: string): Promise<void> {
      const pane = get().logsPanes[repoPath];
      if (!pane || !logsManager) {
        return;
      }
      const beforeCount = pane.lines.length;
      const result = await loadOlderLogs({ manager: logsManager, key: repoPath, container });
      const entry = logsManager.getEntry(repoPath);
      set((state) => {
        const current = state.logsPanes[repoPath];
        if (!current) {
          return {};
        }
        const appended = result.ok ? result.data.appended : 0;
        return {
          logsPanes: {
            ...state.logsPanes,
            [repoPath]: {
              ...current,
              lines: entry.lines,
              noMoreHistory: entry.noMoreHistory,
              // Preserves the visible viewport for a pane that already had visible lines — or,
              // for a pane that started genuinely empty, pins to the newest of the just-fetched
              // history instead (see resolvePostLoadScrollOffset).
              scrollOffset: resolvePostLoadScrollOffset(current.scrollOffset, beforeCount, appended, entry.lines.length),
            },
          },
        };
      });
    }

    // One poll cycle for a single pane — resolves the manifest-declared container,
    // inspects it, and updates the badge only on success. Any failure (manifest load fails,
    // inspect errors, docker unreachable) keeps last-known health and never crashes the view.
    async function pollPaneHealth(repoPath: string): Promise<void> {
      if (!deps) {
        return;
      }
      if (!get().logsPanes[repoPath]) {
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
        const current = state.logsPanes[repoPath];
        if (!current) {
          return {};
        }
        if (current.health === health) {
          return {};
        }
        return { logsPanes: { ...state.logsPanes, [repoPath]: { ...current, health } } };
      });
    }

    function startHealthPolling(repoPath: string): void {
      if (!deps) {
        return;
      }
      if (healthPollTimers.has(repoPath)) {
        return;
      }
      void pollPaneHealth(repoPath);
      const timer = setInterval(() => {
        void pollPaneHealth(repoPath);
      }, LOGS_HEALTH_POLL_INTERVAL_MS);
      // Never keep the process alive for a poll timer alone (tests, abnormal exits).
      const unrefable = timer as unknown as { unref?: () => void };
      if (typeof unrefable.unref === 'function') {
        unrefable.unref();
      }
      healthPollTimers.set(repoPath, timer);
    }

    function stopHealthPolling(repoPath: string): void {
      const timer = healthPollTimers.get(repoPath);
      if (timer !== undefined) {
        clearInterval(timer);
        healthPollTimers.delete(repoPath);
      }
    }

    return {
      logsEdtSelected: [],
      logsOtherSelected: [],
      logsFullscreenTarget: null,
      logsFullscreenServiceName: null,
      logsPanes: {},

      toggleLogsEdtSelection: (repoPath) =>
        set((state) => ({
          logsEdtSelected: state.logsEdtSelected.includes(repoPath)
            ? state.logsEdtSelected.filter((candidate) => candidate !== repoPath)
            : [...state.logsEdtSelected, repoPath],
        })),
      toggleLogsOtherSelection: (repoPath) =>
        set((state) => ({
          logsOtherSelected: state.logsOtherSelected.includes(repoPath)
            ? state.logsOtherSelected.filter((candidate) => candidate !== repoPath)
            : [...state.logsOtherSelected, repoPath],
        })),
      selectAllLogsEdtServices: (repoPaths) => set({ logsEdtSelected: [...repoPaths] }),
      deselectAllLogsEdtServices: () => set({ logsEdtSelected: [] }),
      openLogsFullscreen: (repoPath, serviceName) => set({ logsFullscreenTarget: repoPath, logsFullscreenServiceName: serviceName }),
      closeLogsFullscreen: () => set({ logsFullscreenTarget: null, logsFullscreenServiceName: null }),

      subscribeLogsPane: async (repoPath, service) => {
        if (!deps || !logsManager) {
          return;
        }
        set((state) => ({
          logsPanes: { ...state.logsPanes, [repoPath]: state.logsPanes[repoPath] ?? emptyPane(repoPath, service) },
        }));
        // Health polling starts with the subscription (per pane, on subscribe plus
        // a ~5s interval). Idempotent — a second subscribe for an already-polling pane (e.g.
        // fullscreen opened on an already-selected row) never starts a second timer.
        startHealthPolling(repoPath);
        if (logsManager.isSubscribed(repoPath)) {
          // Already streaming (e.g. a fullscreen preview opened on an already-selected row) —
          // nothing new to start.
          return;
        }
        const manifestResult = await deps.manifest.load(repoPath);
        if (!manifestResult.ok) {
          set((state) => ({
            logsPanes: {
              ...state.logsPanes,
              [repoPath]: {
                ...(state.logsPanes[repoPath] ?? emptyPane(repoPath, service)),
                streamError: { code: manifestResult.error.code, message: manifestResult.error.message },
              },
            },
          }));
          return;
        }
        const bufferSize = get().settings.logs.bufferSize;
        const mirror = () => {
          const entry = logsManager.getEntry(repoPath);
          set((state) => ({
            logsPanes: {
              ...state.logsPanes,
              [repoPath]: {
                ...(state.logsPanes[repoPath] ?? emptyPane(repoPath, service)),
                lines: entry.lines,
                streamError: entry.streamError,
                noMoreHistory: entry.noMoreHistory,
              },
            },
          }));
        };
        const result = subscribeLogs({
          manager: logsManager,
          key: repoPath,
          container: manifestResult.data.container,
          bufferSize,
          onUpdate: mirror,
        });
        if (!result.ok) {
          set((state) => ({
            logsPanes: {
              ...state.logsPanes,
              [repoPath]: { ...(state.logsPanes[repoPath] ?? emptyPane(repoPath, service)), streamError: result.error },
            },
          }));
          return;
        }
        // Reflects whatever the manager already knows synchronously (in practice still empty
        // for a brand-new subscription, but keeps this action total/idempotent either way).
        mirror();
        // "Start streaming with the most recent history" opts a fresh subscription into the
        // same fetch a manual scrollback-to-oldest (Ctrl+Up in the grid, Up/Down in fullscreen)
        // would trigger, instead of leaving the pane empty until the live tail produces a line.
        // Only reachable past the `isSubscribed` early-return above, so re-selecting an
        // already-streaming pane (or opening fullscreen on one) never re-fetches history.
        if (get().settings.logs.startWithHistory) {
          await loadOlder(repoPath, manifestResult.data.container);
        }
      },

      restartLogsPane: async (repoPath) => {
        if (!deps || !logsManager) {
          return;
        }
        const pane = get().logsPanes[repoPath];
        if (!pane) {
          return;
        }
        // A call while that pane is already restarting is a no-op — never a second
        // concurrent `docker restart`.
        if (pane.restarting) {
          return;
        }
        set((state) => {
          const current = state.logsPanes[repoPath];
          if (!current || current.restarting) {
            return {};
          }
          return { logsPanes: { ...state.logsPanes, [repoPath]: { ...current, restarting: true } } };
        });
        const manifestResult = await deps.manifest.load(repoPath);
        if (!manifestResult.ok) {
          set((state) => {
            const current = state.logsPanes[repoPath];
            if (!current) {
              return {};
            }
            return {
              logsPanes: {
                ...state.logsPanes,
                [repoPath]: {
                  ...current,
                  restarting: false,
                  streamError: { code: manifestResult.error.code, message: manifestResult.error.message },
                },
              },
            };
          });
          return;
        }
        const restartResult = await restartService({ docker: deps.docker, container: manifestResult.data.container });
        if (!restartResult.ok) {
          // Failure surfaces inline on the pane; the badge keeps last-known health.
          set((state) => {
            const current = state.logsPanes[repoPath];
            if (!current) {
              return {};
            }
            return {
              logsPanes: {
                ...state.logsPanes,
                [repoPath]: { ...current, restarting: false, streamError: restartResult.error },
              },
            };
          });
          return;
        }
        set((state) => {
          const current = state.logsPanes[repoPath];
          if (!current) {
            return {};
          }
          return { logsPanes: { ...state.logsPanes, [repoPath]: { ...current, restarting: false } } };
        });
        // After the restart call resolves, health is re-polled immediately so the badge
        // reflects the new state.
        await pollPaneHealth(repoPath);
      },

      unsubscribeLogsPane: (repoPath) => {
        // The poll timer is cleared on unsubscribe — polling never outlives the pane.
        stopHealthPolling(repoPath);
        if (!logsManager) {
          return;
        }
        unsubscribeLogs({ manager: logsManager, key: repoPath });
        set((state) => {
          if (!(repoPath in state.logsPanes)) {
            return {};
          }
          const next = { ...state.logsPanes };
          delete next[repoPath];
          return { logsPanes: next };
        });
      },

      loadOlderLogsPane: async (repoPath) => {
        if (!deps || !logsManager) {
          return;
        }
        const pane = get().logsPanes[repoPath];
        if (!pane) {
          return;
        }
        const manifestResult = await deps.manifest.load(repoPath);
        if (!manifestResult.ok) {
          // Surface the failure like every other manifest-load failure in this file — a bare
          // return would leave every later scroll-to-edge silently no-oping.
          set((state) => {
            const current = state.logsPanes[repoPath];
            if (!current) {
              return {};
            }
            return {
              logsPanes: {
                ...state.logsPanes,
                [repoPath]: { ...current, streamError: { code: manifestResult.error.code, message: manifestResult.error.message } },
              },
            };
          });
          return;
        }
        await loadOlder(repoPath, manifestResult.data.container);
      },

      clearLogsPane: (repoPath) => {
        if (!logsManager) {
          return;
        }
        clearLogs({ manager: logsManager, key: repoPath });
        set((state) => {
          const current = state.logsPanes[repoPath];
          if (!current) {
            return {};
          }
          return { logsPanes: { ...state.logsPanes, [repoPath]: { ...current, lines: [], noMoreHistory: false, scrollOffset: 0 } } };
        });
      },

      setLogsPaneScrollOffset: (repoPath, offset) =>
        set((state) => {
          const current = state.logsPanes[repoPath];
          if (!current) {
            return {};
          }
          const clamped = Math.min(Math.max(offset, 0), Math.max(current.lines.length - 1, 0));
          return { logsPanes: { ...state.logsPanes, [repoPath]: { ...current, scrollOffset: clamped } } };
        }),

      stopAllLogsPanes: () => {
        for (const repoPath of [...healthPollTimers.keys()]) {
          stopHealthPolling(repoPath);
        }
        if (!logsManager) {
          return;
        }
        for (const repoPath of Object.keys(get().logsPanes)) {
          unsubscribeLogs({ manager: logsManager, key: repoPath });
        }
        set({ logsPanes: {} });
      },

      filterHistory: {},
      loadFilterHistory: async () => {
        if (!deps) {
          return;
        }
        // Captured before the await (like loadSplitterRatios): a commit/clear landing while this
        // read is in flight bumps the version, and the stale result below must never clobber
        // that newer live value.
        const startVersion = filterHistoryVersion;
        const promise = (async () => {
          const result = await deps.state.readFilterHistory();
          if (filterHistoryVersion !== startVersion) {
            return;
          }
          if (!result.ok || result.data === null) {
            // A genuine I/O error, or nothing persisted yet: keep the empty-object default
            // seeded above — every list simply starts empty.
            return;
          }
          set({ filterHistory: result.data });
        })();
        // Published *before* awaiting, and only cleared once this exact call settles — a
        // commit/clear that checks `filterHistoryLoadPromise` meanwhile sees this in-flight read
        // and waits for it, rather than racing ahead on the still-empty pre-load map.
        filterHistoryLoadPromise = promise;
        try {
          await promise;
        } finally {
          if (filterHistoryLoadPromise === promise) {
            filterHistoryLoadPromise = null;
          }
        }
      },
      commitFilterHistoryEntry: (key, query) => {
        const run = async () => {
          // Never read/persist `filterHistory` while the initial hydration is still in flight —
          // awaiting here (a no-op when nothing is in flight) guarantees `get().filterHistory`
          // below reflects whatever was on disk before this commit's read-modify-write.
          if (filterHistoryLoadPromise) {
            await filterHistoryLoadPromise;
          }
          filterHistoryVersion += 1;
          const historyKey = filterHistoryKeyString(key);
          const maxSize = get().settings.logs.filterHistorySize;
          const dedupEverywhere = get().settings.logs.filterHistoryDedup;
          set((state) => ({
            filterHistory: {
              ...state.filterHistory,
              [historyKey]: pushFilterHistoryEntry(state.filterHistory[historyKey] ?? [], query, maxSize, dedupEverywhere),
            },
          }));
          // Applies to the live store synchronously above, before persistence even starts —
          // same "no separate save step" convention as setSplitterRatio.
          persistFilterHistory(get().filterHistory);
        };
        void run();
      },
      clearGlobalFilterHistory: () => {
        const run = async () => {
          if (filterHistoryLoadPromise) {
            await filterHistoryLoadPromise;
          }
          filterHistoryVersion += 1;
          set((state) => {
            const next = { ...state.filterHistory };
            delete next[filterHistoryKeyString({ scope: 'global', repoPath: null, mode: 'text' })];
            delete next[filterHistoryKeyString({ scope: 'global', repoPath: null, mode: 'regex' })];
            return { filterHistory: next };
          });
          persistFilterHistory(get().filterHistory);
        };
        void run();
      },
      clearFilterHistoryAndDrainSaves: async () => {
        if (filterHistoryLoadPromise) {
          await filterHistoryLoadPromise;
        }
        filterHistoryVersion += 1;
        set({ filterHistory: {} });
        // A mutator's `run` may itself queue a new save while we wait — loop until the chain
        // stops growing.
        let pending: Promise<void>;
        do {
          pending = filterHistorySaveChain;
          await pending;
        } while (pending !== filterHistorySaveChain);
      },
      clearServiceFilterHistory: (repoPath) => {
        const run = async () => {
          if (filterHistoryLoadPromise) {
            await filterHistoryLoadPromise;
          }
          filterHistoryVersion += 1;
          set((state) => {
            const next = { ...state.filterHistory };
            delete next[filterHistoryKeyString({ scope: 'pane', repoPath, mode: 'text' })];
            delete next[filterHistoryKeyString({ scope: 'pane', repoPath, mode: 'regex' })];
            return { filterHistory: next };
          });
          persistFilterHistory(get().filterHistory);
        };
        void run();
      },
    };
  };
}
