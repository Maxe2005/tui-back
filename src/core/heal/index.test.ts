import { describe, expect, it, vi } from 'vitest';
import { restartNeedsAttention, type RestartRow } from '../edt/switch-restart.js';
import type { HealthState } from '../ports/docker.js';
import type { EdtRegistryEntry } from '../ports/edt-registry.js';
import type { Manifest } from '../ports/manifest.js';
import { err, ok, type Result } from '../result.js';
import { GROUP_UPDATE_LOCK_KEY, edtUpdateLockKey } from '../scripts/group-update.js';
import { serviceRestartLockKey } from '../scripts/service-restart.js';
import type { ServiceFinalState } from '../service-actions/index.js';
import { HEAL_NOTHING_TO_DO_MESSAGE, planHeal, runHeal, type HealPlan } from './index.js';

// One fake service: its manifest (or a load error), its container state (or a Docker error) and
// its health route answer (absent = no healthUrl).
interface FakeService {
  name: string;
  manifest?: 'unreadable';
  container?: HealthState | 'docker-error' | 'none';
  probe?: 'healthy' | 'failed';
}

const ULID = '01EDT';

function world(services: FakeService[], overrides: { activeUlid?: string | null } = {}) {
  const byPath = new Map(services.map((service) => [`/r/${service.name}`, service]));
  const manifest = {
    load: vi.fn(async (path: string): Promise<Result<Manifest>> => {
      const service = byPath.get(path);
      if (service === undefined || service.manifest === 'unreadable') {
        return err('manifest-invalid', `bad manifest at ${path}`);
      }
      return ok({
        service: service.name,
        sharedBranch: 'development',
        modules: {},
        ...(service.container === 'none' ? {} : { container: `${service.name}-c` }),
        ...(service.probe === undefined ? {} : { healthUrl: `http://${service.name}/health` }),
      });
    }),
  };
  const docker = {
    getContainerHealth: vi.fn(async (container: string): Promise<Result<HealthState>> => {
      const service = services.find((candidate) => `${candidate.name}-c` === container);
      if (service?.container === 'docker-error') {
        return err('docker-unavailable', 'docker down');
      }
      return ok((service?.container ?? 'up') as HealthState);
    }),
  };
  const healthProbe = {
    probe: vi.fn(async (url: string) => {
      const service = services.find((candidate) => url === `http://${candidate.name}/health`);
      return ok(service?.probe === 'healthy' ? { healthy: true, status: 200 } : { healthy: false, reason: 'HTTP 503' });
    }),
  };
  const edt: EdtRegistryEntry = {
    ulid: ULID,
    topic: 'feature-x',
    createdAt: '2026-01-01T00:00:00.000Z',
    status: 'active',
    members: services.map((service) => ({ service: service.name, repoPath: `/r/${service.name}`, branch: 'feature-x' })),
  };
  const activeUlid = overrides.activeUlid === undefined ? ULID : overrides.activeUlid;
  return {
    manifest,
    docker,
    healthProbe,
    state: { readActiveEdt: vi.fn(async () => ok(activeUlid)) },
    edtRegistry: { list: vi.fn(async () => ok([edt])) },
  };
}

function actions(overrides: { restart?: (path: string, mode: string) => Promise<unknown>; verify?: (path: string) => Promise<unknown> } = {}) {
  return {
    restart: vi.fn(overrides.restart ?? (async () => ok({}))) as never,
    verifyService: vi.fn(overrides.verify ?? (async () => ok({ state: 'functional' as ServiceFinalState }))) as never,
  };
}

function freeLock(held: readonly string[] = []) {
  return {
    acquire: vi.fn(async () => err('unused', 'unused')),
    peek: vi.fn(async (key: string) => ok({ locked: held.includes(key) })),
  };
}

async function plan(services: FakeService[]): Promise<HealPlan> {
  const planned = await planHeal(world(services));
  if (!planned.ok) throw new Error(planned.error.message);
  return planned.data;
}

const reasons = (rows: readonly RestartRow[]) => rows.map((row) => [row.service, row.phase, row.skipReason]);

describe('planHeal', () => {
  it('targets down and unhealthy services that declare a container, skipping the rest with a reason', async () => {
    const planned = await plan([
      { name: 'down', container: 'down' },
      { name: 'stuck', container: 'up', probe: 'failed' },
      { name: 'healthy', container: 'up', probe: 'healthy' },
      { name: 'plain', container: 'up' },
      { name: 'booting', container: 'restarting' },
      { name: 'mismatch', container: 'down', probe: 'healthy' },
      { name: 'lib', container: 'none' },
      { name: 'route-only', container: 'none', probe: 'failed' },
      { name: 'broken', manifest: 'unreadable' },
      { name: 'blind', container: 'docker-error', probe: 'failed' },
    ]);
    expect(planned.edt).toEqual({ ulid: ULID, topic: 'feature-x' });
    expect(reasons(planned.rows)).toEqual([
      ['down', 'pending', undefined],
      ['stuck', 'pending', undefined],
      ['healthy', 'skipped', 'up'],
      ['plain', 'skipped', 'up'],
      ['booting', 'skipped', 'already restarting'],
      ['mismatch', 'skipped', 'inconsistent'],
      ['lib', 'skipped', 'no container'],
      ['route-only', 'skipped', 'no container'],
      ['broken', 'skipped', 'status unknown'],
      ['blind', 'skipped', 'status unknown'],
    ]);
    const detailOf = (service: string) => planned.rows.find((row) => row.service === service)?.detail;
    expect(detailOf('broken')).toBe('bad manifest at /r/broken');
    expect(detailOf('blind')).toBe('docker down');
    expect(detailOf('healthy')).toBeUndefined();
  });

  it('skips a member with a blank repoPath as status unknown, never resolving nor probing it', async () => {
    const deps = world([{ name: 'api', container: 'down' }]);
    const entries = await deps.edtRegistry.list();
    if (!entries.ok) throw new Error('unreachable');
    const entry = entries.data[0] as EdtRegistryEntry;
    deps.edtRegistry.list.mockResolvedValueOnce(ok([{ ...entry, members: [...entry.members, { service: 'ghost', repoPath: '  ', branch: 'feature-x' }] }]) as never);
    const planned = await planHeal(deps);
    expect(planned.ok && planned.data.rows[1]).toEqual({
      service: 'ghost',
      repoPath: '  ',
      phase: 'skipped',
      skipReason: 'status unknown',
      detail: 'blank repoPath in the EDT registry',
    });
    expect(deps.manifest.load).toHaveBeenCalledTimes(1);
    expect(deps.manifest.load).toHaveBeenCalledWith('/r/api');
  });

  it('is err no-active-edt when no EDT is active or the active ulid is unknown', async () => {
    for (const activeUlid of [null, 'unknown']) {
      const planned = await planHeal(world([{ name: 'api', container: 'down' }], { activeUlid }));
      expect(!planned.ok && planned.error.code).toBe('no-active-edt');
    }
  });

  it('passes a state or registry read error through', async () => {
    const deps = world([]);
    deps.state.readActiveEdt.mockResolvedValueOnce(err('state-corrupt', 'bad state') as never);
    const planned = await planHeal(deps);
    expect(!planned.ok && planned.error.code).toBe('state-corrupt');
  });

  it('never rejects when a port throws: the member is status unknown', async () => {
    const deps = world([{ name: 'api', container: 'down' }]);
    deps.manifest.load.mockRejectedValueOnce(new Error('disk gone'));
    const planned = await planHeal(deps);
    expect(planned.ok && reasons(planned.data.rows)).toEqual([['api', 'skipped', 'status unknown']]);
    expect(planned.ok && planned.data.rows[0]?.detail).toBe('disk gone');
  });
});

describe('runHeal', () => {
  it('restarts and verifies the targets, keeping skipped rows', async () => {
    const planned = await plan([
      { name: 'api', container: 'down' },
      { name: 'web', container: 'up', probe: 'healthy' },
    ]);
    const serviceActions = actions();
    const report = await runHeal({ plan: planned, mode: 'simple', concurrency: 3, serviceActions, lock: freeLock() });
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.data.edt).toEqual({ ulid: ULID, topic: 'feature-x' });
    expect(report.data.mode).toBe('simple');
    expect(reasons(report.data.rows)).toEqual([
      ['api', 'functional', undefined],
      ['web', 'skipped', 'up'],
    ]);
    expect(report.data.message).toBeUndefined();
    expect(serviceActions.restart).toHaveBeenCalledWith('/r/api', 'simple');
    expect(serviceActions.verifyService).toHaveBeenCalledWith('/r/api');
  });

  it('restarts two down targets sequentially at concurrency 1, streaming every phase', async () => {
    const planned = await plan([
      { name: 'a', container: 'down' },
      { name: 'b', container: 'down' },
    ]);
    const seen: [string, string][] = [];
    let inFlight = 0;
    let peak = 0;
    const serviceActions = actions({
      restart: async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((done) => setTimeout(done, 2));
        inFlight -= 1;
        return ok({});
      },
    });
    await runHeal({ plan: planned, mode: 'clean', concurrency: 1, serviceActions, lock: freeLock(), onPhase: (row) => seen.push([row.service, row.phase]) });
    expect(peak).toBe(1);
    expect(seen).toEqual([
      ['a', 'pending'],
      ['b', 'pending'],
      ['a', 'restarting'],
      ['a', 'verifying'],
      ['a', 'functional'],
      ['b', 'restarting'],
      ['b', 'verifying'],
      ['b', 'functional'],
    ]);
    expect(serviceActions.restart).toHaveBeenCalledWith('/r/a', 'clean');
  });

  it('reports every service is up and restarts nothing when there is no target', async () => {
    const planned = await plan([
      { name: 'api', container: 'up', probe: 'healthy' },
      { name: 'lib', container: 'none' },
    ]);
    const serviceActions = actions();
    const report = await runHeal({ plan: planned, mode: 'simple', concurrency: 1, serviceActions, lock: freeLock() });
    expect(report.ok && report.data.message).toBe(HEAL_NOTHING_TO_DO_MESSAGE);
    expect(report.ok && report.data.summary).toMatchObject({ skipped: 2 });
    expect(serviceActions.restart).not.toHaveBeenCalled();
  });

  it.each([
    ['group update', GROUP_UPDATE_LOCK_KEY],
    ['EDT update/switch', edtUpdateLockKey(ULID)],
    ['service restart', serviceRestartLockKey('/r/api')],
  ])('fails a blocked row with "%s in progress" while the others still run', async (name, key) => {
    const planned = await plan([
      { name: 'api', container: 'down' },
      { name: 'web', container: 'down' },
    ]);
    // A global lock blocks every row; the per-service lock only its own row.
    const perService = name === 'service restart';
    const lock = freeLock([key]);
    const serviceActions = actions();
    const report = await runHeal({ plan: planned, mode: 'simple', concurrency: 2, serviceActions, lock });
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    const api = report.data.rows.find((row) => row.service === 'api');
    expect(api).toMatchObject({ phase: 'failed', detail: `${name} in progress` });
    const web = report.data.rows.find((row) => row.service === 'web');
    if (perService) {
      expect(web).toMatchObject({ phase: 'functional' });
      expect(serviceActions.restart).toHaveBeenCalledTimes(1);
    } else {
      expect(web).toMatchObject({ phase: 'failed', detail: `${name} in progress` });
      expect(serviceActions.restart).not.toHaveBeenCalled();
    }
  });

  it('fails a row whose restart errors, with its message', async () => {
    const planned = await plan([{ name: 'api', container: 'down' }]);
    const report = await runHeal({
      plan: planned,
      mode: 'simple',
      concurrency: 1,
      serviceActions: actions({ restart: async () => err('container-restart-failed', 'docker said no') }),
      lock: freeLock(),
    });
    expect(report.ok && report.data.rows[0]).toMatchObject({ phase: 'failed', detail: 'docker said no' });
    expect(report.ok && report.data.summary.failed).toBe(1);
  });

  it.each(['down', 'unhealthy'] as const)('keeps a %s verification outcome as the row state', async (state) => {
    const planned = await plan([{ name: 'api', container: 'down' }]);
    const report = await runHeal({
      plan: planned,
      mode: 'simple',
      concurrency: 1,
      serviceActions: actions({ verify: async () => ok({ state, detail: 'still bad' }) }),
      lock: freeLock(),
    });
    expect(report.ok && report.data.rows[0]).toMatchObject({ phase: state, detail: 'still bad' });
  });

  it('keeps a target that ends restarting as restarting, which does not need attention', async () => {
    const planned = await plan([{ name: 'api', container: 'down' }]);
    const report = await runHeal({
      plan: planned,
      mode: 'simple',
      concurrency: 1,
      serviceActions: actions({ verify: async () => ok({ state: 'restarting', detail: 'still restarting' }) }),
      lock: freeLock(),
    });
    expect(report.ok && report.data.rows[0]).toMatchObject({ phase: 'restarting' });
    expect(report.ok && restartNeedsAttention(report.data.summary)).toBe(false);
  });

  it('survives a throwing onPhase observer', async () => {
    const planned = await plan([{ name: 'api', container: 'down' }]);
    const report = await runHeal({
      plan: planned,
      mode: 'simple',
      concurrency: 1,
      serviceActions: actions(),
      lock: freeLock(),
      onPhase: () => {
        throw new Error('observer');
      },
    });
    expect(report.ok && report.data.summary.functional).toBe(1);
  });

  it('rejects an unknown mode without restarting anything', async () => {
    const planned = await plan([{ name: 'api', container: 'down' }]);
    const serviceActions = actions();
    const report = await runHeal({ plan: planned, mode: 'none' as never, concurrency: 1, serviceActions, lock: freeLock() });
    expect(!report.ok && report.error.code).toBe('invalid-argument');
    expect(serviceActions.restart).not.toHaveBeenCalled();
  });
});
