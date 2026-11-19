// tui/store/slices: the Logs slice's panes — service selection in both lists, the ad hoc
// fullscreen target, and each pane's stream lifecycle (subscribe, unsubscribe, load older,
// clear, scroll offset, stop-all).
import { clearLogs, loadOlderLogs, subscribeLogs, unsubscribeLogs } from '../../../../../core/logs/use-cases.js';
import { hasContainer } from '../../../../../core/service-status/index.js';
import { resolvePostLoadScrollOffset } from '../../zones/logs/logs-zone.logic.js';
import type { LogsHealthHelpers } from './logs-slice.health.js';
import {
  emptyPane,
  recordProbeOnly,
  withoutPaneSettings,
  type LogsSlice,
  type LogsSliceContext,
  type LogsSliceGet,
  type LogsSliceSet,
} from './logs-slice.types.js';

export function createLogsPaneActions(
  ctx: LogsSliceContext,
  set: LogsSliceSet,
  get: LogsSliceGet,
  health: LogsHealthHelpers,
): Pick<
  LogsSlice,
  | 'logsEdtSelected'
  | 'logsOtherSelected'
  | 'logsFullscreenTarget'
  | 'logsFullscreenServiceName'
  | 'logsPanes'
  | 'toggleLogsEdtSelection'
  | 'toggleLogsOtherSelection'
  | 'selectAllLogsEdtServices'
  | 'deselectAllLogsEdtServices'
  | 'selectAllLogsOtherServices'
  | 'deselectAllLogsOtherServices'
  | 'openLogsFullscreen'
  | 'closeLogsFullscreen'
  | 'subscribeLogsPane'
  | 'unsubscribeLogsPane'
  | 'loadOlderLogsPane'
  | 'clearLogsPane'
  | 'setLogsPaneScrollOffset'
  | 'stopAllLogsPanes'
> {
  const { deps, logsManager, healthPollTimers, paneHealthInFlight, probeOnlyRows } = ctx;
  const { startHealthPolling, stopHealthPolling } = health;
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

  return {
    logsEdtSelected: [],
    logsOtherSelected: [],
    logsFullscreenTarget: null,
    logsFullscreenServiceName: null,
    logsPanes: {},

    toggleLogsEdtSelection: (repoPath) =>
      set((state) =>
        state.logsEdtSelected.includes(repoPath)
          ? {
              logsEdtSelected: state.logsEdtSelected.filter((candidate) => candidate !== repoPath),
              ...withoutPaneSettings(state, [repoPath]),
            }
          : { logsEdtSelected: [...state.logsEdtSelected, repoPath] },
      ),
    toggleLogsOtherSelection: (repoPath) =>
      set((state) =>
        state.logsOtherSelected.includes(repoPath)
          ? {
              logsOtherSelected: state.logsOtherSelected.filter((candidate) => candidate !== repoPath),
              ...withoutPaneSettings(state, [repoPath]),
            }
          : { logsOtherSelected: [...state.logsOtherSelected, repoPath] },
      ),
    selectAllLogsEdtServices: (repoPaths) =>
      set((state) => ({
        logsEdtSelected: [...repoPaths],
        ...withoutPaneSettings(state, state.logsEdtSelected.filter((path) => !repoPaths.includes(path))),
      })),
    deselectAllLogsEdtServices: () =>
      set((state) => ({ logsEdtSelected: [], ...withoutPaneSettings(state, state.logsEdtSelected) })),
    selectAllLogsOtherServices: (repoPaths) =>
      set((state) => ({
        logsOtherSelected: [...repoPaths],
        ...withoutPaneSettings(state, state.logsOtherSelected.filter((path) => !repoPaths.includes(path))),
      })),
    deselectAllLogsOtherServices: () =>
      set((state) => ({ logsOtherSelected: [], ...withoutPaneSettings(state, state.logsOtherSelected) })),
    openLogsFullscreen: (repoPath, serviceName) => set({ logsFullscreenTarget: repoPath, logsFullscreenServiceName: serviceName }),
    // An ad hoc preview of an unselected service leaves no per-service settings behind, like a
    // deselected one.
    closeLogsFullscreen: () =>
      set((state) => {
        const target = state.logsFullscreenTarget;
        const selected = target !== null && (state.logsEdtSelected.includes(target) || state.logsOtherSelected.includes(target));
        return {
          logsFullscreenTarget: null,
          logsFullscreenServiceName: null,
          ...(target !== null && !selected ? withoutPaneSettings(state, [target]) : {}),
        };
      }),

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
        startHealthPolling(repoPath);
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
        // Health polling starts with the subscription (per pane, on subscribe plus
        // a ~5s interval). Idempotent — a second subscribe for an already-polling pane (e.g.
        // fullscreen opened on an already-selected row) never starts a second timer.
        startHealthPolling(repoPath);
        return;
      }
      if (!hasContainer(manifestResult.data)) {
        // No Docker runtime for this service — the pane degrades explicitly (no
        // subscription, no docker call), and the zone renders it with no restart control.
        // Only a declared, probed `healthUrl` keeps a health timer, for its real up/down.
        recordProbeOnly(ctx, repoPath, manifestResult.data);
        const probeOnly = probeOnlyRows.has(repoPath);
        set((state) => {
          const current = state.logsPanes[repoPath] ?? emptyPane(repoPath, service);
          return {
            logsPanes: {
              ...state.logsPanes,
              [repoPath]: { ...current, noContainer: true, ...(probeOnly ? {} : { health: 'no-container' as const }) },
            },
          };
        });
        if (probeOnly) {
          startHealthPolling(repoPath);
        }
        return;
      }
      // Health polling starts with the subscription (per pane, on subscribe plus
      // a ~5s interval). Idempotent — a second subscribe for an already-polling pane (e.g.
      // fullscreen opened on an already-selected row) never starts a second timer.
      startHealthPolling(repoPath);
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
      if (!hasContainer(manifestResult.data)) {
        // No stream exists for this pane, so there is no older history to fetch either. Its
        // health is left to the poll (a probed `healthUrl` still reads up/down).
        set((state) => {
          const current = state.logsPanes[repoPath];
          if (!current || current.noContainer === true) {
            return {};
          }
          return {
            logsPanes: {
              ...state.logsPanes,
              [repoPath]: { ...current, noContainer: true, ...(probeOnlyRows.has(repoPath) ? {} : { health: 'no-container' as const }) },
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
      paneHealthInFlight.releaseAll();
      if (!logsManager) {
        return;
      }
      for (const repoPath of Object.keys(get().logsPanes)) {
        unsubscribeLogs({ manager: logsManager, key: repoPath });
      }
      set({ logsPanes: {} });
    },
  };
}
