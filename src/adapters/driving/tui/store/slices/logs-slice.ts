// tui/store/slices: Logs zone domain state (story 5.1) — which services are selected in each
// of the two left-panel lists, the ad hoc fullscreen preview target, and the live per-pane
// buffer/error/scroll state every subscribed service mirrors from core/logs' LogsManager.
// Extracted the same way every other domain slice is (see app-store.ts's header) — a
// StateCreator factory combined with the other slices into one Zustand store (AD-10).
//
// The actual ring buffer lives in core/logs' LogsManager (AD-11: in memory only, never on
// disk) — this slice's `logsPanes` is a mirror kept in sync via `onUpdate` callbacks so React
// re-renders on a new line/error, never a second source of truth for the lines themselves.
// One LogsManager instance is created per store (closed over here, mirrors
// navigation-slice.ts's own private `splitterRatiosSaveChain` closure variable), wrapping the
// single DockerPort wired into AppStoreDeps.
import type { StateCreator } from 'zustand';
import { createLogsManager, type LogsManager } from '../../../../../core/logs/index.js';
import { clearLogs, loadOlderLogs, subscribeLogs, unsubscribeLogs } from '../../../../../core/logs/use-cases.js';
import type { LogLine } from '../../../../../core/ports/docker.js';
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
  // How many lines back from the tail this pane is currently scrolled — 0 means "pinned to
  // the live tail". Purely local UI state (never mirrored from LogsManager); bumped by
  // loadOlderLogsPane's own successful prepend so the viewport doesn't visually jump (I/O
  // matrix SCROLLBACK_RELOAD: "scroll position preserved").
  scrollOffset: number;
};

function emptyPane(repoPath: string, service: string): LogsPaneData {
  return { repoPath, service, lines: [], streamError: null, noMoreHistory: false, scrollOffset: 0 };
}

export type LogsSlice = {
  // repoPaths currently checked in the EDT-members list / the other-services list — both
  // equally streamable (Boundaries: "Any manifest service can be streamed, not only
  // active-EDT members").
  logsEdtSelected: string[];
  logsOtherSelected: string[];
  // Set only for an Enter-on-an-unselected-row ad hoc preview (I/O matrix FULLSCREEN_PREVIEW)
  // — never added to logsEdtSelected/logsOtherSelected, so closing it never mutates selection.
  logsFullscreenTarget: string | null;
  // The service name to render as this preview's title, captured at the moment fullscreen was
  // opened (from whichever list row/pane the keypress fired on) rather than re-derived later
  // via a live `rows.find(...)` lookup — the latter can miss (e.g. a transient services-list
  // load error while the preview is open) and silently fall back to a bare "Logs" label right
  // when the user needs the service name most (review fix).
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
  loadOlderLogsPane: (repoPath: string) => Promise<void>;
  // Wipes a pane's buffered/displayed lines (a display "clear", like a shell's `clear`) —
  // the stream itself keeps running, so a new line still appears immediately afterward.
  clearLogsPane: (repoPath: string) => void;
  setLogsPaneScrollOffset: (repoPath: string, offset: number) => void;
  // Tears down every currently-active pane's subscription (killing its docker child process,
  // if any). Normal zone-unmount teardown already stops each pane individually; this is the
  // process-level fallback for an abnormal exit (crash, Ctrl+C, SIGTERM) so a `docker logs -f`
  // child is never orphaned — wired into `process.on('exit'|'SIGINT'|'SIGTERM', ...)` in
  // src/bin/tui.ts (review fix).
  stopAllLogsPanes: () => void;

  // Story 5.4: the filter-history lists, persisted to state.json (StatePort.readFilterHistory/
  // writeFilterHistory) — keyed by filterHistoryKeyString's flat encoding of a FilterHistoryKey.
  // Lives here (not zone-local state) so the Settings screen's clear actions and the Logs
  // zone's arrow-recall/grid browser both read/mutate one source of truth (Design Notes) —
  // mirrors why splitterRatios lives in navigation-slice.ts rather than being zone-local.
  filterHistory: Record<string, string[]>;
  // Hydrates filterHistory from state.json once at AppShell mount, mirroring
  // loadSplitterRatios() — a missing/corrupt file (or an unwired store) silently keeps the
  // empty-object default already seeded below (RESTART_PERSIST's own "empty history, never a
  // crash" edge case).
  loadFilterHistory: () => Promise<void>;
  // Story 5.4 (I/O matrix HISTORY_PUSH/DEDUP_TOP): called by the Logs zone on a successful
  // filter-editor commit (Enter, compiles, non-empty) — applies pushFilterHistoryEntry to the
  // exact (scope, mode) list `key` identifies and persists the whole map immediately (no
  // separate save step, mirroring setSplitterRatio's own convention).
  commitFilterHistoryEntry: (key: FilterHistoryKey, query: string) => void;
  // Story 5.4 (Boundaries): "clear global" only touches the two global lists (text + regex).
  clearGlobalFilterHistory: () => void;
  // Story 5.4 (Boundaries, I/O matrix CLEAR_SERVICE): "clear this service" only touches that
  // one service's two lists (text + regex) — every other service and the global lists are
  // untouched.
  clearServiceFilterHistory: (repoPath: string) => void;
};

export function createLogsSlice(deps?: AppStoreDeps): StateCreator<AppState, [], [], LogsSlice> {
  // One manager per store instance — never recreated per-render, mirrors every other slice's
  // "closure captured once, at store-creation time" convention. `deps` is optional so every
  // pre-5.1 `createAppStore()` call (tests included) keeps working unwired.
  const logsManager: LogsManager | null = deps ? createLogsManager(deps.docker) : null;

  // Story 5.4: mirrors navigation-slice.ts's own splitterRatiosSaveChain/splitterRatiosVersion
  // pair exactly — serializes writeFilterHistory calls so concurrent commits/clears land on
  // disk in the order they were requested, and guards loadFilterHistory against overwriting a
  // newer live change with a stale on-disk snapshot it started reading before that change
  // landed.
  let filterHistorySaveChain: Promise<void> = Promise.resolve();
  let filterHistoryVersion = 0;
  // Review fix: `filterHistoryVersion` alone only protects a *stale read* from clobbering a
  // *newer write* — it does nothing for a write that fires while the very first
  // loadFilterHistory() (AppShell's mount-time hydration) is still in flight. Without this,
  // commitFilterHistoryEntry/clearGlobalFilterHistory/clearServiceFilterHistory would read the
  // still-empty pre-load `filterHistory` map, apply their change to it, and persist that
  // incomplete map wholesale — permanently discarding every other scope/service's history
  // already on disk. Set for the duration of the one in-flight load; each of the three
  // mutators awaits it (a no-op when null, so the common "no load in flight" case stays fully
  // synchronous/optimistic, same as before this fix) before ever reading `get().filterHistory`.
  let filterHistoryLoadPromise: Promise<void> | null = null;

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
    // Shared by loadOlderLogsPane and subscribeLogsPane's own startWithHistory fetch
    // (Settings tab, story 5.1 review fix) — both are "fetch the next bufferSize older lines
    // and prepend them" over an already-subscribed key, differing only in when they're
    // invoked (a manual scrollback-to-oldest vs. automatically right after a fresh
    // subscription).
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
              // Preserves the visible viewport (I/O matrix: "scroll position preserved") for a
              // pane that already had visible lines — or, for a pane that started genuinely
              // empty, pins to the newest of the just-fetched history instead (review fix; see
              // resolvePostLoadScrollOffset's own header).
              scrollOffset: resolvePostLoadScrollOffset(current.scrollOffset, beforeCount, appended, entry.lines.length),
            },
          },
        };
      });
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
        // Settings tab, story 5.1 review fix: "start streaming with the most recent history"
        // opts a fresh subscription into the exact same fetch a manual scrollback-to-oldest
        // (Ctrl+Up in the grid, Up/Down in fullscreen) would trigger, instead of leaving the
        // pane on a genuinely empty buffer until the live tail produces its first new line.
        // Only reachable here, past the `isSubscribed` early-return above, so re-selecting an
        // already-streaming pane (or opening fullscreen on one) never re-fetches history.
        if (get().settings.logs.startWithHistory) {
          await loadOlder(repoPath, manifestResult.data.container);
        }
      },

      unsubscribeLogsPane: (repoPath) => {
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
          // Previously a bare `return` — zero feedback, and every subsequent scroll-to-edge kept
          // silently no-oping the same way forever. Surfaces the failure the same way every other
          // manifest-load failure in this file does (review fix).
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
        // Review-fix convention (mirrors loadSplitterRatios): captured before the await — a
        // commitFilterHistoryEntry/clear call landing while this read is still in flight bumps
        // the version, and the stale result below must never clobber that newer live value.
        const startVersion = filterHistoryVersion;
        const promise = (async () => {
          const result = await deps.state.readFilterHistory();
          if (filterHistoryVersion !== startVersion) {
            return;
          }
          if (!result.ok || result.data === null) {
            // A genuine I/O error, or a fresh/pre-5.4 machine with nothing persisted yet: keep
            // the empty-object default already seeded above (RESTART_PERSIST's "never a
            // crash" edge case — every list simply starts empty).
            return;
          }
          set({ filterHistory: result.data });
        })();
        // Review fix: published *before* awaiting, and only cleared once this exact call
        // settles — a commit/clear that checks `filterHistoryLoadPromise` between now and
        // then sees this in-flight read and waits for it, rather than racing ahead on the
        // still-empty pre-load map.
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
          // Review fix: never read/persist `filterHistory` while the initial hydration is
          // still in flight — awaiting here (a no-op when nothing is in flight, keeping the
          // common case fully synchronous/optimistic) guarantees `get().filterHistory` below
          // already reflects whatever was on disk before this commit's own read-modify-write.
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
