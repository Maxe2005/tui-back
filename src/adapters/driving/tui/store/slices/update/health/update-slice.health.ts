// tui/store/slices: the Update slice's service-health polling (one shared timer for every
// tracked service, independent of the Logs zone's per-pane polling).
import { healthCheckEnabledFrom } from '../../../../../../../core/ports/storage/settings.js';
import { resolveServiceStatus } from '../../../../../../../core/runtime/service-status/index.js';
import {
  UPDATE_HEALTH_POLL_INTERVAL_MS,
  type UpdateSlice,
  type UpdateSliceContext,
  type UpdateSliceGet,
  type UpdateSliceSet,
} from '../update-slice.types.js';

export function createUpdateHealthActions(
  ctx: UpdateSliceContext,
  set: UpdateSliceSet,
  get: UpdateSliceGet,
): Pick<UpdateSlice, 'updateServiceHealth' | 'startUpdateHealthPolling' | 'stopUpdateHealthPolling'> {
  const { deps, healthInFlight } = ctx;
  // One poll cycle for a single service — resolves its health-first status through
  // core/service-status, updating the badge only on success. Like logs-slice.ts's
  // pollPaneHealth, any failure (manifest load fails, Docker and the probe both fail) keeps
  // last-known health and never crashes the view. A tick for a repo whose previous poll (probe
  // included) is still awaiting is skipped.
  async function pollServiceHealth(repoPath: string): Promise<void> {
    if (!deps) {
      return;
    }
    const token = healthInFlight.begin(repoPath);
    if (token === null) {
      return;
    }
    try {
      const status = await resolveServiceStatus(
        {
          manifest: deps.manifest,
          docker: deps.docker,
          ...(deps.healthProbe === undefined ? {} : { healthProbe: deps.healthProbe }),
          // Read at every poll, so a :settings toggle applies at the next tick.
          isHealthCheckEnabled: healthCheckEnabledFrom(() => get().settings),
        },
        repoPath,
      );
      // A repo no longer polled (stopped, or retargeted away) keeps no late write.
      if (!status.ok || !ctx.pollingRepoPaths.includes(repoPath) || !healthInFlight.isCurrent(repoPath, token)) {
        return;
      }
      const health = status.data.state;
      set((state) => {
        if (state.updateServiceHealth[repoPath] === health) {
          return {};
        }
        return { updateServiceHealth: { ...state.updateServiceHealth, [repoPath]: health } };
      });
    } finally {
      healthInFlight.end(repoPath, token);
    }
  }

  function pollAll(repoPaths: readonly string[]): void {
    for (const repoPath of repoPaths) {
      void pollServiceHealth(repoPath);
    }
  }

  return {
    updateServiceHealth: {},
    startUpdateHealthPolling: (repoPaths) => {
      for (const path of ctx.pollingRepoPaths) {
        if (!repoPaths.includes(path)) {
          healthInFlight.release(path);
        }
      }
      ctx.pollingRepoPaths = [...repoPaths];
      pollAll(ctx.pollingRepoPaths);
      if (ctx.healthPollTimer !== null) {
        clearInterval(ctx.healthPollTimer);
      }
      ctx.healthPollTimer = setInterval(() => {
        pollAll(ctx.pollingRepoPaths);
      }, UPDATE_HEALTH_POLL_INTERVAL_MS);
      // Never keep the process alive for a poll timer alone (tests, abnormal exits) —
      // mirrors logs-slice.health.ts's own startHealthPolling.
      const unrefable = ctx.healthPollTimer as unknown as { unref?: () => void };
      if (typeof unrefable.unref === 'function') {
        unrefable.unref();
      }
    },
    stopUpdateHealthPolling: () => {
      if (ctx.healthPollTimer !== null) {
        clearInterval(ctx.healthPollTimer);
        ctx.healthPollTimer = null;
      }
      ctx.pollingRepoPaths = [];
      healthInFlight.releaseAll();
    },
  };
}
