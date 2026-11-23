// tui/store/slices: the Logs slice's health polling — the per-pane poll (started with a
// subscription) and the shared listed-row poll with its container-presence cache. Never
// resubscribes a log stream.
import { healthCheckEnabledFrom } from '../../../../../../core/ports/storage/settings.js';
import { hasContainer, resolveManifestStatus, type ServiceStatusState } from '../../../../../../core/runtime/service-status/index.js';
import {
  LOGS_HEALTH_POLL_INTERVAL_MS,
  LOGS_LISTED_HEALTH_POLL_INTERVAL_MS,
  recordProbeOnly,
  type LogsPaneData,
  type LogsSlice,
  type LogsSliceContext,
  type LogsSliceGet,
  type LogsSliceSet,
} from './logs-slice.types.js';

// The per-pane polling helpers the panes and actions sub-creators call.
export interface LogsHealthHelpers {
  pollPaneHealth: (repoPath: string) => Promise<void>;
  startHealthPolling: (repoPath: string) => void;
  stopHealthPolling: (repoPath: string) => void;
}

export function createLogsHealth(
  ctx: LogsSliceContext,
  set: LogsSliceSet,
  get: LogsSliceGet,
): {
  helpers: LogsHealthHelpers;
  actions: Pick<
    LogsSlice,
    | 'logsNoContainer'
    | 'logsListedHealth'
    | 'resolveLogsContainerPresence'
    | 'startLogsListedHealthPolling'
    | 'stopLogsListedHealthPolling'
  >;
} {
  const { deps, healthPollTimers, paneHealthInFlight, listedHealthInFlight, probeOnlyRows, pendingPresence } = ctx;
  // The status resolver's ports, plus the live per-service health-check toggle — read at
  // every poll, so a change in :settings applies at the next tick.
  const statusPorts = deps
    ? {
        docker: deps.docker,
        ...(deps.healthProbe === undefined ? {} : { healthProbe: deps.healthProbe }),
        isHealthCheckEnabled: healthCheckEnabledFrom(() => get().settings),
      }
    : null;

  // One poll cycle for a single pane — resolves the service's health-first status through
  // core/service-status and updates the badge only on success. Any failure (manifest load
  // fails, Docker and the probe both fail) keeps last-known health and never crashes the view.
  // A manifest without `container` marks the pane container-less; unless it declares a probed
  // `healthUrl` (then it gets a real up/down) it records no-container, stops its own timer and
  // never reaches Docker. Skipped while the previous cycle for this repo is still awaiting.
  async function pollPaneHealth(repoPath: string): Promise<void> {
    if (!deps || !statusPorts || !get().logsPanes[repoPath]) {
      return;
    }
    const token = paneHealthInFlight.begin(repoPath);
    if (token === null) {
      return;
    }
    const patchPane = (patch: Partial<LogsPaneData>) =>
      set((state) => {
        const current = state.logsPanes[repoPath];
        if (!current || (Object.keys(patch) as Array<keyof LogsPaneData>).every((key) => current[key] === patch[key])) {
          return {};
        }
        return { logsPanes: { ...state.logsPanes, [repoPath]: { ...current, ...patch } } };
      });
    try {
      const manifestResult = await deps.manifest.load(repoPath);
      if (!manifestResult.ok || !paneHealthInFlight.isCurrent(repoPath, token)) {
        return;
      }
      recordProbeOnly(ctx, repoPath, manifestResult.data);
      const containerLess = !hasContainer(manifestResult.data);
      if (containerLess && !probeOnlyRows.has(repoPath)) {
        clearPaneTimer(repoPath);
        patchPane({ health: 'no-container', noContainer: true });
        return;
      }
      const status = await resolveManifestStatus(statusPorts, manifestResult.data);
      if (!status.ok || !paneHealthInFlight.isCurrent(repoPath, token)) {
        return;
      }
      patchPane(containerLess ? { health: status.data.state, noContainer: true } : { health: status.data.state });
    } catch {
      // A port that rejects (against its contract) is a failed poll: keep last-known health.
    } finally {
      paneHealthInFlight.end(repoPath, token);
    }
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

  function clearPaneTimer(repoPath: string): void {
    const timer = healthPollTimers.get(repoPath);
    if (timer !== undefined) {
      clearInterval(timer);
      healthPollTimers.delete(repoPath);
    }
  }

  // Stops a pane's poll: its timer, and its in-flight entry so a late result is dropped.
  function stopHealthPolling(repoPath: string): void {
    clearPaneTimer(repoPath);
    paneHealthInFlight.release(repoPath);
  }

  // Resolves one row's container presence without blocking — cached, so a repeated call
  // for an already-known row never reloads its manifest. A failed load leaves the row
  // absent (unknown), never recorded as either answer.
  async function resolveContainerPresence(repoPath: string): Promise<void> {
    if (!deps) {
      return;
    }
    if (repoPath in get().logsNoContainer || pendingPresence.has(repoPath)) {
      return;
    }
    pendingPresence.add(repoPath);
    try {
      const manifestResult = await deps.manifest.load(repoPath);
      if (!manifestResult.ok) {
        return;
      }
      // Keyed idempotent write: even a superseded resolve records this path's current
      // manifest truth, and the next polling retarget prunes rows that left the list.
      const withoutContainer = !hasContainer(manifestResult.data);
      recordProbeOnly(ctx, repoPath, manifestResult.data);
      set((state) => {
        if (state.logsNoContainer[repoPath] === withoutContainer) {
          return {};
        }
        return { logsNoContainer: { ...state.logsNoContainer, [repoPath]: withoutContainer } };
      });
    } finally {
      pendingPresence.delete(repoPath);
    }
  }

  // One poll cycle for a single listed row — like pollPaneHealth above, but writing the
  // row-health map instead of a pane entry, so badges render for rows that were never
  // subscribed. A manifest without `container` records its presence and, unless it declares a
  // probed `healthUrl`, the no-container health without reaching Docker. Any failure keeps
  // last-known health and never crashes; a tick for a repo still awaiting is skipped.
  async function pollListedRowHealth(repoPath: string): Promise<void> {
    if (!deps || !statusPorts) {
      return;
    }
    // A positively-resolved container-less row with no probed route never reloads its
    // manifest here — the presence cache already answered.
    if (get().logsNoContainer[repoPath] === true && !probeOnlyRows.has(repoPath)) {
      set((state) => {
        if (state.logsListedHealth[repoPath] === 'no-container') {
          return {};
        }
        return { logsListedHealth: { ...state.logsListedHealth, [repoPath]: 'no-container' as const } };
      });
      return;
    }
    const token = listedHealthInFlight.begin(repoPath);
    if (token === null) {
      return;
    }
    try {
      const manifestResult = await deps.manifest.load(repoPath);
      if (!manifestResult.ok) {
        return;
      }
      if (!ctx.listedPollingRepoPaths.includes(repoPath) || !listedHealthInFlight.isCurrent(repoPath, token)) {
        return;
      }
      recordProbeOnly(ctx, repoPath, manifestResult.data);
      const withoutContainer = !hasContainer(manifestResult.data);
      set((state) => {
        if (state.logsNoContainer[repoPath] === withoutContainer) {
          return {};
        }
        return { logsNoContainer: { ...state.logsNoContainer, [repoPath]: withoutContainer } };
      });
      const status = await resolveManifestStatus(statusPorts, manifestResult.data);
      if (!status.ok) {
        return;
      }
      if (!ctx.listedPollingRepoPaths.includes(repoPath) || !listedHealthInFlight.isCurrent(repoPath, token)) {
        return;
      }
      const health = status.data.state;
      set((state) => {
        if (state.logsListedHealth[repoPath] === health) {
          return {};
        }
        return { logsListedHealth: { ...state.logsListedHealth, [repoPath]: health } };
      });
    } catch {
      // A port that rejects (against its contract) is a failed poll: keep last-known health.
    } finally {
      listedHealthInFlight.end(repoPath, token);
    }
  }

  function pollAllListed(repoPaths: readonly string[]): void {
    for (const repoPath of repoPaths) {
      void pollListedRowHealth(repoPath);
    }
  }

  return {
    helpers: { pollPaneHealth, startHealthPolling, stopHealthPolling },
    actions: {
      logsNoContainer: {},
      logsListedHealth: {},
      resolveLogsContainerPresence: (repoPaths) => {
        for (const repoPath of repoPaths) {
          void resolveContainerPresence(repoPath);
        }
      },
      startLogsListedHealthPolling: (repoPaths) => {
        const wanted = new Set(repoPaths);
        // Rows leaving the list release their in-flight poll (its late result is dropped) and
        // their probe-only mark, like the two maps below.
        for (const path of ctx.listedPollingRepoPaths) {
          if (!wanted.has(path)) {
            listedHealthInFlight.release(path);
          }
        }
        for (const path of [...probeOnlyRows]) {
          if (!wanted.has(path)) {
            probeOnlyRows.delete(path);
          }
        }
        ctx.listedPollingRepoPaths = [...repoPaths];
        // Stale rows (renamed/unregistered since the last retarget) leave both maps so
        // a removed service can neither badge nor resurface from cache.
        set((state) => {
          const logsNoContainer: Record<string, boolean> = {};
          const logsListedHealth: Record<string, ServiceStatusState> = {};
          for (const path of Object.keys(state.logsNoContainer)) {
            if (wanted.has(path)) {
              logsNoContainer[path] = state.logsNoContainer[path];
            }
          }
          for (const path of Object.keys(state.logsListedHealth)) {
            if (wanted.has(path)) {
              logsListedHealth[path] = state.logsListedHealth[path];
            }
          }
          return { logsNoContainer, logsListedHealth };
        });
        if (ctx.listedPollingRepoPaths.length === 0) {
          if (ctx.listedHealthPollTimer !== null) {
            clearInterval(ctx.listedHealthPollTimer);
            ctx.listedHealthPollTimer = null;
          }
          return;
        }
        pollAllListed(ctx.listedPollingRepoPaths);
        if (ctx.listedHealthPollTimer !== null) {
          clearInterval(ctx.listedHealthPollTimer);
        }
        ctx.listedHealthPollTimer = setInterval(() => {
          pollAllListed(ctx.listedPollingRepoPaths);
        }, LOGS_LISTED_HEALTH_POLL_INTERVAL_MS);
        const unrefable = ctx.listedHealthPollTimer as unknown as { unref?: () => void };
        if (typeof unrefable.unref === 'function') {
          unrefable.unref();
        }
      },
      stopLogsListedHealthPolling: () => {
        if (ctx.listedHealthPollTimer !== null) {
          clearInterval(ctx.listedHealthPollTimer);
          ctx.listedHealthPollTimer = null;
        }
        ctx.listedPollingRepoPaths = [];
        listedHealthInFlight.releaseAll();
      },
    },
  };
}
