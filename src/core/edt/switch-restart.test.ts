import { describe, expect, it, vi } from 'vitest';
import { err, ok } from '../result.js';
import type { ServiceFinalState } from '../service-actions/index.js';
import { NO_CLEAN_RECIPE_NOTICE } from '../service-actions/index.js';
import {
  listSwitchRestartRepos,
  orderRestartRows,
  restartAfterSwitch,
  restartNeedsAttention,
  type RestartRow,
  type SwitchRestartRepo,
} from './switch-restart.js';
import type { SwitchEdtRepoResult } from './switch.js';
import { runRestartRows } from './switch-restart.js';

const repos: SwitchRestartRepo[] = [
  { service: 'api', repoPath: '/r/api', hasContainer: true },
  { service: 'web', repoPath: '/r/web', hasContainer: true },
  { service: 'lib', repoPath: '/r/lib', hasContainer: false },
  { service: 'idle', repoPath: '/r/idle', hasContainer: true },
];
const results: SwitchEdtRepoResult[] = [
  { service: 'api', outcome: 'switched' },
  { service: 'web', outcome: 'adopted' },
  { service: 'lib', outcome: 'discarded' },
  { service: 'idle', outcome: 'failed' },
];

function actions(overrides: { restart?: (path: string, mode: string) => Promise<unknown>; verify?: (path: string) => Promise<unknown> } = {}) {
  return {
    restart: vi.fn(overrides.restart ?? (async () => ok({}))) as never,
    verifyService: vi.fn(overrides.verify ?? (async () => ok({ state: 'functional' as ServiceFinalState }))) as never,
  };
}

describe('restartAfterSwitch', () => {
  it('restarts and verifies changed container services, skipping the rest with a reason', async () => {
    const serviceActions = actions();
    const report = await restartAfterSwitch({ results, repos, mode: 'simple', concurrency: 2, serviceActions });
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    const byService = Object.fromEntries(report.data.rows.map((row) => [row.service, row]));
    expect(byService.api).toMatchObject({ phase: 'functional' });
    expect(byService.web).toMatchObject({ phase: 'functional' });
    expect(byService.lib).toMatchObject({ phase: 'skipped', skipReason: 'no container' });
    expect(byService.idle).toMatchObject({ phase: 'skipped', skipReason: 'unchanged' });
    expect(report.data.summary).toEqual({ functional: 2, 'up-unverified': 0, unhealthy: 0, restarting: 0, down: 0, failed: 0, skipped: 2 });
    expect(serviceActions.restart).toHaveBeenCalledTimes(2);
  });

  it('targets only the changedServices override when given, ignoring the switch outcomes', async () => {
    const serviceActions = actions();
    const report = await restartAfterSwitch({ results: [], repos, mode: 'clean', concurrency: 1, serviceActions, changedServices: ['idle', 'lib'] });
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    const byService = Object.fromEntries(report.data.rows.map((row) => [row.service, row]));
    expect(byService.idle).toMatchObject({ phase: 'functional' });
    expect(byService.lib).toMatchObject({ phase: 'skipped', skipReason: 'no container' });
    expect(byService.api).toMatchObject({ phase: 'skipped', skipReason: 'unchanged' });
    expect(byService.web).toMatchObject({ phase: 'skipped', skipReason: 'unchanged' });
    expect(serviceActions.restart).toHaveBeenCalledTimes(1);
    expect(serviceActions.restart).toHaveBeenCalledWith('/r/idle', 'clean');
  });

  it('streams pending → restarting → verifying → final through onPhase', async () => {
    const seen: [string, string][] = [];
    await restartAfterSwitch({
      results: [results[0] as SwitchEdtRepoResult],
      repos: [repos[0] as SwitchRestartRepo],
      mode: 'simple',
      concurrency: 1,
      serviceActions: actions(),
      onPhase: (row) => seen.push([row.service, row.phase]),
    });
    expect(seen).toEqual([['api', 'pending'], ['api', 'restarting'], ['api', 'verifying'], ['api', 'functional']]);
  });

  it('turns a restart error, a verify error and a throwing worker into failed rows, never rejecting', async () => {
    const serviceActions = actions({
      restart: async (path) => {
        if (path === '/r/api') return err('restart-failed', 'boom');
        if (path === '/r/web') throw new Error('kaboom');
        return ok({});
      },
    });
    const report = await restartAfterSwitch({ results, repos, mode: 'simple', concurrency: 3, serviceActions });
    expect(report.ok && report.data.rows.filter((row) => row.phase === 'failed').map((row) => [row.service, row.detail])).toEqual([
      ['api', 'boom'],
      ['web', 'kaboom'],
    ]);
    const verifyFails = await restartAfterSwitch({
      results: [results[0] as SwitchEdtRepoResult],
      repos: [repos[0] as SwitchRestartRepo],
      mode: 'simple',
      concurrency: 1,
      serviceActions: actions({ verify: async () => err('docker-unavailable', 'no docker') }),
    });
    expect(verifyFails.ok && verifyFails.data.rows[0]).toMatchObject({ phase: 'failed', detail: 'no docker' });
  });

  it('carries NO_CLEAN_RECIPE_NOTICE on a clean restart without recipe', async () => {
    const report = await restartAfterSwitch({
      results: [results[0] as SwitchEdtRepoResult],
      repos: [repos[0] as SwitchRestartRepo],
      mode: 'clean',
      concurrency: 1,
      serviceActions: actions({ restart: async () => ok({ notice: NO_CLEAN_RECIPE_NOTICE }) }),
    });
    expect(report.ok && report.data.rows[0]?.detail).toBe(NO_CLEAN_RECIPE_NOTICE);
  });

  it('runs at most `concurrency` restarts at once and never two on the same repoPath', async () => {
    let inFlight = 0;
    let peak = 0;
    const perPath = new Map<string, number>();
    let samePathOverlap = false;
    const many: SwitchRestartRepo[] = [
      ...['a', 'b', 'c', 'd'].map((n) => ({ service: n, repoPath: `/r/${n}`, hasContainer: true })),
      { service: 'a2', repoPath: '/r/a', hasContainer: true },
    ];
    const serviceActions = actions({
      restart: async (path) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        perPath.set(path, (perPath.get(path) ?? 0) + 1);
        if ((perPath.get(path) ?? 0) > 1) samePathOverlap = true;
        await new Promise((done) => setTimeout(done, 5));
        perPath.set(path, (perPath.get(path) ?? 1) - 1);
        inFlight -= 1;
        return ok({});
      },
    });
    await restartAfterSwitch({
      results: many.map((repo) => ({ service: repo.service, outcome: 'switched' as const })),
      repos: many,
      mode: 'simple',
      concurrency: 2,
      serviceActions,
    });
    expect(peak).toBeLessThanOrEqual(2);
    expect(samePathOverlap).toBe(false);
  });

  it('rejects an unknown mode and mode none without touching anything', async () => {
    const serviceActions = actions();
    for (const mode of ['bogus', 'none'] as never[]) {
      const report = await restartAfterSwitch({ results, repos, mode, concurrency: 1, serviceActions });
      expect(!report.ok && report.error.code).toBe('invalid-argument');
    }
    expect(serviceActions.restart).not.toHaveBeenCalled();
  });

  it('survives a throwing onPhase observer', async () => {
    const report = await restartAfterSwitch({
      results: [results[0] as SwitchEdtRepoResult],
      repos: [repos[0] as SwitchRestartRepo],
      mode: 'simple',
      concurrency: 1,
      serviceActions: actions(),
      onPhase: () => {
        throw new Error('observer');
      },
    });
    expect(report.ok && report.data.summary.functional).toBe(1);
  });
});

describe('report helpers', () => {
  it('orders non-green first and flags attention', () => {
    const rows = (['functional', 'skipped', 'down', 'up-unverified', 'failed', 'unhealthy'] as const).map(
      (phase, i): RestartRow => ({ service: `s${i}`, repoPath: `/r/${i}`, phase }),
    );
    expect(orderRestartRows(rows).map((row) => row.phase)).toEqual(['failed', 'down', 'unhealthy', 'up-unverified', 'functional', 'skipped']);
    expect(restartNeedsAttention({ functional: 1, 'up-unverified': 1, unhealthy: 0, restarting: 0, down: 0, failed: 0, skipped: 3 })).toBe(false);
    expect(restartNeedsAttention({ functional: 0, 'up-unverified': 0, unhealthy: 1, restarting: 0, down: 0, failed: 0, skipped: 0 })).toBe(true);
  });

  it('lists managed repos with service name and container presence', async () => {
    const listed = await listSwitchRestartRepos({
      registry: { list: async () => ok(['/r/api', '/r/bad']) } as never,
      manifest: {
        load: async (path: string) =>
          path === '/r/api' ? ok({ service: 'api', container: 'api-c', sharedBranch: 'development', modules: {} }) : err('manifest-invalid', 'bad'),
      },
    });
    expect(listed).toEqual({
      ok: true,
      data: [
        { service: 'api', repoPath: '/r/api', hasContainer: true },
        { service: '/r/bad', repoPath: '/r/bad', hasContainer: false },
      ],
    });
  });
});

describe('runRestartRows', () => {
  const pendingRows: RestartRow[] = [
    { service: 'api', repoPath: '/r/api', phase: 'pending' },
    { service: 'web', repoPath: '/r/web', phase: 'pending' },
    { service: 'lib', repoPath: '/r/lib', phase: 'skipped', skipReason: 'up' },
  ];

  it('restarts and verifies only the pending rows, keeping skipped rows and their reason', async () => {
    const serviceActions = actions();
    const report = await runRestartRows({ rows: pendingRows, mode: 'clean', concurrency: 2, serviceActions });
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.data.mode).toBe('clean');
    expect(report.data.rows.map((row) => [row.service, row.phase, row.skipReason])).toEqual([
      ['api', 'functional', undefined],
      ['web', 'functional', undefined],
      ['lib', 'skipped', 'up'],
    ]);
    expect(serviceActions.restart).toHaveBeenCalledTimes(2);
    expect(serviceActions.restart).toHaveBeenCalledWith('/r/api', 'clean');
    expect(report.data.summary).toMatchObject({ functional: 2, skipped: 1 });
  });

  it('never mutates the rows it was given', async () => {
    const rows = pendingRows.map((row) => ({ ...row }));
    await runRestartRows({ rows, mode: 'simple', concurrency: 1, serviceActions: actions() });
    expect(rows).toEqual(pendingRows);
  });

  it('fails a row whose beforeRestart returns a reason, without restarting it', async () => {
    const serviceActions = actions();
    const seen: [string, string][] = [];
    const report = await runRestartRows({
      rows: pendingRows,
      mode: 'simple',
      concurrency: 1,
      serviceActions,
      onPhase: (row) => seen.push([row.service, row.phase]),
      beforeRestart: async (row) => (row.service === 'api' ? 'group update in progress' : null),
    });
    expect(report.ok && report.data.rows[0]).toMatchObject({ service: 'api', phase: 'failed', detail: 'group update in progress' });
    expect(report.ok && report.data.summary).toMatchObject({ failed: 1, functional: 1, skipped: 1 });
    expect(serviceActions.restart).toHaveBeenCalledTimes(1);
    expect(serviceActions.restart).toHaveBeenCalledWith('/r/web', 'simple');
    expect(seen.filter(([service]) => service === 'api')).toEqual([['api', 'pending'], ['api', 'failed']]);
  });

  it('fails the row when beforeRestart throws, never rejecting', async () => {
    const report = await runRestartRows({
      rows: [pendingRows[0] as RestartRow],
      mode: 'simple',
      concurrency: 1,
      serviceActions: actions(),
      beforeRestart: async () => {
        throw new Error('peek exploded');
      },
    });
    expect(report.ok && report.data.rows[0]).toMatchObject({ phase: 'failed', detail: 'peek exploded' });
  });

  it('rejects a mode other than simple or clean without touching anything', async () => {
    const serviceActions = actions();
    for (const mode of ['none', 'bogus'] as never[]) {
      const report = await runRestartRows({ rows: pendingRows, mode, concurrency: 1, serviceActions });
      expect(!report.ok && report.error.code).toBe('invalid-argument');
    }
    expect(serviceActions.restart).not.toHaveBeenCalled();
  });

  it('runs sequentially at concurrency 1 and streams pending → restarting → verifying → final per target', async () => {
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
      verify: async () => ok({ state: 'down' as ServiceFinalState, detail: 'container is not running' }),
    });
    const report = await runRestartRows({
      rows: pendingRows.slice(0, 2),
      mode: 'simple',
      concurrency: 1,
      serviceActions,
      onPhase: (row) => seen.push([row.service, row.phase]),
    });
    expect(peak).toBe(1);
    expect(seen).toEqual([
      ['api', 'pending'],
      ['web', 'pending'],
      ['api', 'restarting'],
      ['api', 'verifying'],
      ['api', 'down'],
      ['web', 'restarting'],
      ['web', 'verifying'],
      ['web', 'down'],
    ]);
    expect(report.ok && restartNeedsAttention(report.data.summary)).toBe(true);
  });
});
