import { describe, expect, it, vi } from 'vitest';
import type { HealthState } from '../ports/docker.js';
import type { HealthProbeOutcome } from '../ports/health-probe.js';
import type { Manifest } from '../ports/manifest.js';
import { err, ok, type Result } from '../result.js';
import { DEFAULT_PROBE_REASON, STATUS_PROBE_TIMEOUT_MS, combineStatus, isProbeEnabled, resolveServiceStatus, type ServiceStatusDeps } from './index.js';

function deps(
  manifest: Partial<Manifest> | 'broken',
  container: Result<HealthState> | null,
  probe: Result<HealthProbeOutcome> | null,
  wireProbe = true,
): { deps: ServiceStatusDeps; getContainerHealth: ReturnType<typeof vi.fn>; probeFn: ReturnType<typeof vi.fn> } {
  const getContainerHealth = vi.fn(async () => container ?? ok('down' as HealthState));
  const probeFn = vi.fn(async () => probe ?? ok({ healthy: false }));
  return {
    deps: {
      manifest: {
        load: async () =>
          manifest === 'broken' ? err('manifest-invalid', 'bad yaml') : ok({ service: 'api', sharedBranch: 'development', modules: {}, ...manifest } as Manifest),
      },
      docker: { getContainerHealth },
      ...(wireProbe ? { healthProbe: { probe: probeFn } } : {}),
    },
    getContainerHealth,
    probeFn,
  };
}

const WITH_BOTH = { container: 'api', healthUrl: 'http://x/h' };
const HEALTHY = ok({ healthy: true, status: 200 });
const FAILING = ok({ healthy: false, status: 503, reason: 'HTTP 503' });
const DOCKER_DOWN = err('docker-unavailable', 'docker is not running');

describe('resolveServiceStatus (AD-23 matrix)', () => {
  it('healthy: probe 2xx and container up → up, verified', async () => {
    const { deps: d, probeFn } = deps(WITH_BOTH, ok('up'), HEALTHY);
    expect(await resolveServiceStatus(d, '/r')).toEqual({ ok: true, data: { state: 'up', verified: true, container: 'up' } });
    expect(probeFn).toHaveBeenCalledWith('http://x/h', STATUS_PROBE_TIMEOUT_MS);
  });

  it.each(['down', 'restarting'] as const)('route up, container %s → inconsistent', async (state) => {
    const result = await resolveServiceStatus(deps(WITH_BOTH, ok(state), HEALTHY).deps, '/r');
    expect(result).toEqual({ ok: true, data: { state: 'inconsistent', verified: true, container: state } });
  });

  it('docker outage: probe 2xx and Docker error → up, verified, container error carried, never inconsistent', async () => {
    const result = await resolveServiceStatus(deps(WITH_BOTH, DOCKER_DOWN, HEALTHY).deps, '/r');
    expect(result).toEqual({
      ok: true,
      data: { state: 'up', verified: true, container: null, containerError: { code: 'docker-unavailable', message: 'docker is not running' } },
    });
  });

  it('stuck: probe non-2xx with the container up → unhealthy with the probe reason', async () => {
    const result = await resolveServiceStatus(deps(WITH_BOTH, ok('up'), FAILING).deps, '/r');
    expect(result).toEqual({ ok: true, data: { state: 'unhealthy', verified: true, container: 'up', probeReason: 'HTTP 503' } });
  });

  it('stuck: a probe timeout (no reason given) still carries a reason', async () => {
    const result = await resolveServiceStatus(deps(WITH_BOTH, ok('up'), ok({ healthy: false })).deps, '/r');
    expect(result.ok && result.data.state).toBe('unhealthy');
    expect(result.ok && result.data.probeReason).toBeTruthy();
  });

  it.each(['down', 'restarting'] as const)('probe fails, container %s → %s', async (state) => {
    const result = await resolveServiceStatus(deps(WITH_BOTH, ok(state), FAILING).deps, '/r');
    expect(result).toEqual({ ok: true, data: { state, verified: true, container: state, probeReason: 'HTTP 503' } });
  });

  it('both fail: probe fails and Docker errors → err (Docker error) with the probe reason in details', async () => {
    const result = await resolveServiceStatus(deps(WITH_BOTH, DOCKER_DOWN, FAILING).deps, '/r');
    expect(result).toEqual({
      ok: false,
      error: { code: 'docker-unavailable', message: 'docker is not running', details: { probeReason: 'HTTP 503' } },
    });
  });

  it('container-less with health: 2xx → up verified, failing → down', async () => {
    const up = deps({ healthUrl: 'http://x/h' }, null, HEALTHY);
    expect(await resolveServiceStatus(up.deps, '/r')).toEqual({ ok: true, data: { state: 'up', verified: true, container: 'no-container' } });
    expect(up.getContainerHealth).not.toHaveBeenCalled();
    const down = await resolveServiceStatus(deps({ healthUrl: 'http://x/h' }, null, FAILING).deps, '/r');
    expect(down).toEqual({ ok: true, data: { state: 'down', verified: true, container: 'no-container', probeReason: 'HTTP 503' } });
  });

  it.each(['up', 'down', 'restarting'] as const)('no healthUrl: container %s → same state, unverified, no probe', async (state) => {
    const { deps: d, probeFn } = deps({ container: 'api' }, ok(state), HEALTHY);
    expect(await resolveServiceStatus(d, '/r')).toEqual({ ok: true, data: { state, verified: false, container: state } });
    expect(probeFn).not.toHaveBeenCalled();
  });

  it('no healthUrl and a Docker error → err', async () => {
    const result = await resolveServiceStatus(deps({ container: 'api' }, DOCKER_DOWN, null).deps, '/r');
    expect(!result.ok && result.error.code).toBe('docker-unavailable');
  });

  it('nothing declared → no-container', async () => {
    const result = await resolveServiceStatus(deps({}, null, null).deps, '/r');
    expect(result).toEqual({ ok: true, data: { state: 'no-container', verified: false, container: 'no-container' } });
  });

  it('manifest unreadable → err (manifest error)', async () => {
    const result = await resolveServiceStatus(deps('broken', ok('up'), HEALTHY).deps, '/r');
    expect(!result.ok && result.error.code).toBe('manifest-invalid');
  });

  it('probe not wired behaves as if no healthUrl were declared', async () => {
    const result = await resolveServiceStatus(deps(WITH_BOTH, ok('up'), HEALTHY, false).deps, '/r');
    expect(result).toEqual({ ok: true, data: { state: 'up', verified: false, container: 'up' } });
  });

  it('treats a blank healthUrl or container as undeclared', async () => {
    const result = await resolveServiceStatus(deps({ container: '  ', healthUrl: ' ' }, ok('up'), HEALTHY).deps, '/r');
    expect(result.ok && result.data.state).toBe('no-container');
  });

  it('never rejects when a port throws', async () => {
    const d: ServiceStatusDeps = {
      manifest: { load: async () => ok({ service: 'api', sharedBranch: 'd', modules: {}, ...WITH_BOTH }) },
      docker: { getContainerHealth: async () => { throw new Error('boom'); } },
      healthProbe: { probe: async () => { throw new Error('net'); } },
    };
    const result = await resolveServiceStatus(d, '/r');
    expect(!result.ok && result.error.message).toBe('boom');
    const thrownManifest = await resolveServiceStatus({ ...d, manifest: { load: async () => { throw new Error('io'); } } }, '/r');
    expect(!thrownManifest.ok && thrownManifest.error.message).toBe('io');
  });

  it.each([
    ['a blank reason', ok({ healthy: false, reason: '   ' })],
    ['an empty reason', ok({ healthy: false, reason: '' })],
    ['a blank error message', err('probe-error', ' ')],
  ] as const)('falls back to the default probe reason for %s', async (_label, probe) => {
    const result = await resolveServiceStatus(deps(WITH_BOTH, ok('up'), probe).deps, '/r');
    expect(result.ok && result.data.probeReason).toBe(DEFAULT_PROBE_REASON);
  });

  it('rejects a blank repoPath', async () => {
    const result = await resolveServiceStatus(deps(WITH_BOTH, ok('up'), HEALTHY).deps, ' ');
    expect(!result.ok && result.error.code).toBe('invalid-argument');
  });
});

describe('resolveServiceStatus — per-service health check toggle (story 9.11)', () => {
  const disabled = (d: ServiceStatusDeps, names: string[] = ['api']): ServiceStatusDeps => ({
    ...d,
    isHealthCheckEnabled: (manifest) => !names.includes(manifest.service),
  });

  it('disabled, container up → up, unverified, healthCheck disabled, probe never called', async () => {
    const { deps: d, probeFn } = deps(WITH_BOTH, ok('up'), FAILING);
    expect(await resolveServiceStatus(disabled(d), '/r')).toEqual({
      ok: true,
      data: { state: 'up', verified: false, container: 'up', healthCheck: 'disabled' },
    });
    expect(probeFn).not.toHaveBeenCalled();
  });

  it.each(['down', 'restarting'] as const)('disabled, container %s → %s, healthCheck disabled, no probe', async (state) => {
    const { deps: d, probeFn } = deps(WITH_BOTH, ok(state), HEALTHY);
    expect(await resolveServiceStatus(disabled(d), '/r')).toEqual({
      ok: true,
      data: { state, verified: false, container: state, healthCheck: 'disabled' },
    });
    expect(probeFn).not.toHaveBeenCalled();
  });

  it('disabled, container-less → no-container, healthCheck disabled, no probe', async () => {
    const { deps: d, probeFn } = deps({ healthUrl: 'http://x/h' }, null, HEALTHY);
    expect(await resolveServiceStatus(disabled(d), '/r')).toEqual({
      ok: true,
      data: { state: 'no-container', verified: false, container: 'no-container', healthCheck: 'disabled' },
    });
    expect(probeFn).not.toHaveBeenCalled();
  });

  it('disabled without a healthUrl → unchanged no-healthUrl result, no healthCheck field', async () => {
    const { deps: d, probeFn } = deps({ container: 'api' }, ok('up'), HEALTHY);
    expect(await resolveServiceStatus(disabled(d), '/r')).toEqual({ ok: true, data: { state: 'up', verified: false, container: 'up' } });
    expect(probeFn).not.toHaveBeenCalled();
  });

  it('disabled with a Docker error → err, as for a service without healthUrl', async () => {
    const { deps: d, probeFn } = deps(WITH_BOTH, DOCKER_DOWN, HEALTHY);
    const result = await resolveServiceStatus(disabled(d), '/r');
    expect(!result.ok && result.error.code).toBe('docker-unavailable');
    expect(probeFn).not.toHaveBeenCalled();
  });

  it('a service not in the list resolves exactly as before', async () => {
    const { deps: d, probeFn } = deps(WITH_BOTH, ok('up'), FAILING);
    expect(await resolveServiceStatus(disabled(d, ['other']), '/r')).toEqual({
      ok: true,
      data: { state: 'unhealthy', verified: true, container: 'up', probeReason: 'HTTP 503' },
    });
    expect(probeFn).toHaveBeenCalledTimes(1);
  });

  it('isProbeEnabled: absent dep = enabled, a throwing dep = enabled', () => {
    const manifest = { service: 'api', sharedBranch: 'd', modules: {} } as Manifest;
    expect(isProbeEnabled({}, manifest)).toBe(true);
    expect(isProbeEnabled({ isHealthCheckEnabled: () => false }, manifest)).toBe(false);
    expect(isProbeEnabled({ isHealthCheckEnabled: () => { throw new Error('x'); } }, manifest)).toBe(true);
  });
});

describe('combineStatus', () => {
  it('is pure and table-driven', () => {
    expect(combineStatus({ kind: 'none' }, { kind: 'none' })).toEqual({ ok: true, data: { state: 'no-container', verified: false, container: 'no-container' } });
    expect(combineStatus({ kind: 'healthy' }, { kind: 'state', state: 'restarting' })).toEqual({
      ok: true,
      data: { state: 'inconsistent', verified: true, container: 'restarting' },
    });
    expect(combineStatus({ kind: 'failed', reason: 'timeout' }, { kind: 'state', state: 'up' })).toEqual({
      ok: true,
      data: { state: 'unhealthy', verified: true, container: 'up', probeReason: 'timeout' },
    });
  });
});
