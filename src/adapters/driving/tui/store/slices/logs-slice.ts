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
import { resolvePostLoadScrollOffset } from '../../zones/logs/logs-zone.logic.js';

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
};

export function createLogsSlice(deps?: AppStoreDeps): StateCreator<AppState, [], [], LogsSlice> {
  // One manager per store instance — never recreated per-render, mirrors every other slice's
  // "closure captured once, at store-creation time" convention. `deps` is optional so every
  // pre-5.1 `createAppStore()` call (tests included) keeps working unwired.
  const logsManager: LogsManager | null = deps ? createLogsManager(deps.docker) : null;

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
    };
  };
}
