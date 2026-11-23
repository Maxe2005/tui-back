import { describe, expect, it, vi } from 'vitest';
import { ok, err } from '../../../../../../../core/result.js';
import type { DockerPort } from '../../../../../../../core/ports/runtime/docker.js';
import type { ManifestPort } from '../../../../../../../core/ports/vcs/manifest.js';
import { createAppStore } from '../../../app-store.js';
import { UPDATE_HEALTH_POLL_INTERVAL_MS } from '../update-slice.js';
import { fakeDeps } from '../update-slice.test-support.js';

// The Update zone's own service-list health poll, tested against fake ports like the logs
// slice's poll, but through startUpdateHealthPolling/stopUpdateHealthPolling/
// updateServiceHealth — this poll is owned by the Update zone and shares nothing with the
// Logs zone's.
describe('update slice: service health polling', () => {
  // A real setTimeout macrotask flush, not fake timers — lets every pending microtask from
  // startUpdateHealthPolling's fire-and-forget pollServiceHealth chain (manifest.load then
  // getContainerHealth, each a resolved-async mock) settle before assertions run.
  async function flushPolls(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  function fakeDocker(getContainerHealth: DockerPort['getContainerHealth']): DockerPort {
    return {
      streamLogs: vi.fn(() => () => {}),
      fetchLogsBefore: vi.fn(async () => ok([])),
      getContainerHealth,
      restartContainer: vi.fn(async () => ok(undefined)),
    };
  }

  it('startUpdateHealthPolling polls every given repoPath\'s container health and reflects it on updateServiceHealth', async () => {
    const getContainerHealth = vi.fn(async () => ok('up' as const));
    const store = createAppStore(fakeDeps({ docker: fakeDocker(getContainerHealth) }));

    store.getState().startUpdateHealthPolling(['/repo/a']);
    await flushPolls();

    expect(getContainerHealth).toHaveBeenCalledWith('ctr-a');
    expect(store.getState().updateServiceHealth['/repo/a']).toBe('up');
  });

  it('polls every given repoPath independently, keyed by its own repoPath', async () => {
    const getContainerHealth = vi.fn(async (container: string) => ok(container === 'ctr-a' ? ('up' as const) : ('down' as const)));
    const store = createAppStore(fakeDeps({ docker: fakeDocker(getContainerHealth) }));

    store.getState().startUpdateHealthPolling(['/repo/a', '/repo/b']);
    await flushPolls();

    expect(store.getState().updateServiceHealth['/repo/a']).toBe('up');
    expect(store.getState().updateServiceHealth['/repo/b']).toBe('down');
  });

  it('manifest.load failing during a health poll leaves updateServiceHealth untouched (silent no-op)', async () => {
    vi.useFakeTimers();
    try {
      const manifestLoad = vi.fn(async (repoPath: string) =>
        ok({
          service: `svc-${repoPath.split('/').pop()}`,
          container: `ctr-${repoPath.split('/').pop()}`,
          migrationCommand: 'npm run migration:run',
          sharedBranch: 'development',
          modules: {},
        }),
      );
      const manifest: ManifestPort = { load: manifestLoad };
      const getContainerHealth = vi.fn(async () => ok('up' as const));
      const store = createAppStore(fakeDeps({ docker: fakeDocker(getContainerHealth), manifest }));

      store.getState().startUpdateHealthPolling(['/repo/a']);
      await vi.advanceTimersByTimeAsync(0);
      // First drive the badge to a known non-default state — asserting the default `'down'`
      // below would also pass vacuously if the failing poll simply never ran.
      expect(store.getState().updateServiceHealth['/repo/a']).toBe('up');

      manifestLoad.mockImplementation(async () => err('manifest-not-found', 'gone'));
      const callsBefore = getContainerHealth.mock.calls.length;
      await vi.advanceTimersByTimeAsync(UPDATE_HEALTH_POLL_INTERVAL_MS);
      await vi.advanceTimersByTimeAsync(0);

      // The poll bailed before ever reaching the docker adapter — no inspect, no crash, and
      // the last-known value is kept (never cleared/reset).
      expect(getContainerHealth.mock.calls.length).toBe(callsBefore);
      expect(store.getState().updateServiceHealth['/repo/a']).toBe('up');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a getServiceHealth/getContainerHealth failure leaves updateServiceHealth untouched (silent no-op, same as manifest-load failure)', async () => {
    vi.useFakeTimers();
    try {
      const getContainerHealth = vi.fn(async () => ok('up' as const));
      const store = createAppStore(fakeDeps({ docker: fakeDocker(getContainerHealth) }));

      store.getState().startUpdateHealthPolling(['/repo/a']);
      await vi.advanceTimersByTimeAsync(0);
      expect(store.getState().updateServiceHealth['/repo/a']).toBe('up');

      getContainerHealth.mockImplementation(async () => err('docker-unavailable', 'daemon down'));
      const callsBefore = getContainerHealth.mock.calls.length;
      await vi.advanceTimersByTimeAsync(UPDATE_HEALTH_POLL_INTERVAL_MS);
      await vi.advanceTimersByTimeAsync(0);

      // The failing poll really ran (guards a vacuous pass where the assertion below would
      // hold simply because no second poll happened yet) and the value kept last-known.
      expect(getContainerHealth.mock.calls.length).toBeGreaterThan(callsBefore);
      expect(store.getState().updateServiceHealth['/repo/a']).toBe('up');
    } finally {
      vi.useRealTimers();
    }
  });

  it('polls repeat on the configured interval and stop entirely once stopUpdateHealthPolling is called', async () => {
    vi.useFakeTimers();
    try {
      const getContainerHealth = vi.fn(async () => ok('up' as const));
      const store = createAppStore(fakeDeps({ docker: fakeDocker(getContainerHealth) }));

      store.getState().startUpdateHealthPolling(['/repo/a']);
      await vi.advanceTimersByTimeAsync(0);
      const afterStart = getContainerHealth.mock.calls.length;
      expect(afterStart).toBeGreaterThanOrEqual(1);

      await vi.advanceTimersByTimeAsync(UPDATE_HEALTH_POLL_INTERVAL_MS);
      expect(getContainerHealth.mock.calls.length).toBeGreaterThan(afterStart);

      const afterInterval = getContainerHealth.mock.calls.length;
      store.getState().stopUpdateHealthPolling();
      await vi.advanceTimersByTimeAsync(UPDATE_HEALTH_POLL_INTERVAL_MS * 4);

      // No further polls fire once stopped — the timer never outlives the zone.
      expect(getContainerHealth.mock.calls.length).toBe(afterInterval);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a manifest without container records no-container and never polls docker for the service', async () => {
    const manifest: ManifestPort = {
      load: vi.fn(async (repoPath: string) =>
        ok({
          service: `svc-${repoPath.split('/').pop()}`,
          sharedBranch: 'development',
          modules: {},
        }),
      ),
    };
    const getContainerHealth = vi.fn(async () => ok('up' as const));
    const store = createAppStore(fakeDeps({ docker: fakeDocker(getContainerHealth), manifest }));

    store.getState().startUpdateHealthPolling(['/repo/a']);
    await flushPolls();

    expect(getContainerHealth).not.toHaveBeenCalled();
    expect(store.getState().updateServiceHealth['/repo/a']).toBe('no-container');
  });

  it('startUpdateHealthPolling on an unwired store is a no-op, never a throw', () => {
    const store = createAppStore();

    expect(() => store.getState().startUpdateHealthPolling(['/repo/a'])).not.toThrow();
    expect(store.getState().updateServiceHealth).toEqual({});
  });

  function manifestWithHealth(): ManifestPort {
    return {
      load: vi.fn(async (repoPath: string) =>
        ok({ service: `svc-${repoPath.split('/').pop()}`, container: `ctr-${repoPath.split('/').pop()}`, healthUrl: 'http://svc/health', sharedBranch: 'development', modules: {} }),
      ),
    };
  }

  it('resolves health-first: a running container whose route fails reads unhealthy', async () => {
    const probe = vi.fn(async () => ok({ healthy: false, reason: 'timeout' }));
    const store = createAppStore(fakeDeps({ docker: fakeDocker(vi.fn(async () => ok('up' as const))), manifest: manifestWithHealth(), healthProbe: { probe } }));

    store.getState().startUpdateHealthPolling(['/repo/a']);
    await flushPolls();

    expect(probe).toHaveBeenCalledWith('http://svc/health', expect.any(Number));
    expect(store.getState().updateServiceHealth['/repo/a']).toBe('unhealthy');
    store.getState().stopUpdateHealthPolling();
  });

  it('never probes a service whose health check is disabled', async () => {
    const probe = vi.fn(async () => ok({ healthy: false, reason: 'timeout' }));
    const store = createAppStore(fakeDeps({ docker: fakeDocker(vi.fn(async () => ok('up' as const))), manifest: manifestWithHealth(), healthProbe: { probe } }));
    store.setState((state) => ({ settings: { ...state.settings, services: { healthCheckDisabled: ['svc-a'] } } }));

    store.getState().startUpdateHealthPolling(['/repo/a']);
    await flushPolls();

    expect(probe).not.toHaveBeenCalled();
    expect(store.getState().updateServiceHealth['/repo/a']).toBe('up');
    store.getState().stopUpdateHealthPolling();
  });

  it('a container-less service declaring a healthUrl gets a real up/down, without Docker', async () => {
    const getContainerHealth = vi.fn(async () => ok('up' as const));
    const manifest: ManifestPort = {
      load: vi.fn(async () => ok({ service: 'svc-lib', healthUrl: 'http://lib/health', sharedBranch: 'development', modules: {} })),
    };
    const store = createAppStore(
      fakeDeps({ docker: fakeDocker(getContainerHealth), manifest, healthProbe: { probe: async () => ok({ healthy: false, reason: 'timeout' }) } }),
    );

    store.getState().startUpdateHealthPolling(['/repo/lib']);
    await flushPolls();

    expect(store.getState().updateServiceHealth['/repo/lib']).toBe('down');
    expect(getContainerHealth).not.toHaveBeenCalled();
    store.getState().stopUpdateHealthPolling();
  });

  it('drops a poll settling after its repo stopped being polled, and never blocks a restarted poll', async () => {
    vi.useFakeTimers();
    try {
      const releases: Array<() => void> = [];
      const probe = vi.fn(
        () =>
          new Promise<ReturnType<typeof ok<{ healthy: boolean }>>>((resolve) => {
            releases.push(() => resolve(ok({ healthy: true })));
          }),
      );
      const store = createAppStore(fakeDeps({ docker: fakeDocker(vi.fn(async () => ok('up' as const))), manifest: manifestWithHealth(), healthProbe: { probe } }));
      store.getState().startUpdateHealthPolling(['/repo/a']);
      await vi.advanceTimersByTimeAsync(0);
      store.getState().stopUpdateHealthPolling();
      releases[0]!();
      await vi.advanceTimersByTimeAsync(0);
      expect(store.getState().updateServiceHealth['/repo/a']).toBeUndefined();

      // Retargeted away: the late result is dropped too.
      store.getState().startUpdateHealthPolling(['/repo/a']);
      await vi.advanceTimersByTimeAsync(0);
      store.getState().startUpdateHealthPolling(['/repo/b']);
      await vi.advanceTimersByTimeAsync(0);
      releases[1]!();
      await vi.advanceTimersByTimeAsync(0);
      expect(store.getState().updateServiceHealth['/repo/a']).toBeUndefined();
      store.getState().stopUpdateHealthPolling();
    } finally {
      vi.useRealTimers();
    }
  });

  it('releases the guard after a rejected poll, so the next tick polls again', async () => {
    vi.useFakeTimers();
    try {
      const load = vi.fn(async (): Promise<never> => {
        throw new Error('io');
      });
      const store = createAppStore(fakeDeps({ manifest: { load } }));
      store.getState().startUpdateHealthPolling(['/repo/a']);
      await vi.advanceTimersByTimeAsync(0);
      expect(load).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(UPDATE_HEALTH_POLL_INTERVAL_MS);
      expect(load).toHaveBeenCalledTimes(2);
      store.getState().stopUpdateHealthPolling();
    } finally {
      vi.useRealTimers();
    }
  });

  it('skips a tick while the previous probe for that repo is still awaiting', async () => {
    vi.useFakeTimers();
    try {
      const probe = vi.fn(() => new Promise<never>(() => {}));
      const store = createAppStore(fakeDeps({ docker: fakeDocker(vi.fn(async () => ok('up' as const))), manifest: manifestWithHealth(), healthProbe: { probe } }));
      store.setState({ updateServiceHealth: { '/repo/a': 'up' } });

      store.getState().startUpdateHealthPolling(['/repo/a']);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(UPDATE_HEALTH_POLL_INTERVAL_MS * 3);

      expect(probe).toHaveBeenCalledTimes(1);
      expect(store.getState().updateServiceHealth['/repo/a']).toBe('up');
      store.getState().stopUpdateHealthPolling();
    } finally {
      vi.useRealTimers();
    }
  });
});
