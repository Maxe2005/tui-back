// tui/store/slices/realign-slice: the slice runs the real core realignServices against fake
// ports, so these verify the wiring — candidates, presets seeded from settings, live rows, the
// restart phase, the busy path and the dashboard refresh — not the use-case itself.
import { describe, expect, it, vi } from 'vitest';
import { err, ok } from '../../../../../core/result.js';
import type { DockerPort } from '../../../../../core/ports/docker.js';
import type { EdtRegistryPort } from '../../../../../core/ports/edt-registry.js';
import type { GitPort } from '../../../../../core/ports/git.js';
import type { LockPort } from '../../../../../core/ports/lock.js';
import type { ManifestPort } from '../../../../../core/ports/manifest.js';
import type { RegistryPort } from '../../../../../core/ports/registry.js';
import { DEFAULT_SETTINGS, type SettingsPort } from '../../../../../core/ports/settings.js';
import type { StatePort } from '../../../../../core/ports/state.js';
import { createAppStore, type AppStoreDeps } from '../app-store.js';
import { applyRealignRow, matchingPreset, presetSelection } from './realign-slice.js';

// a, b: drifted members; c: drifted other (no container); d: other whose branch cannot be read.
const BRANCHES: Record<string, string> = { '/repo/a': 'development', '/repo/b': 'development', '/repo/c': 'feat/x' };

function fakeDeps(overrides: { checkout?: GitPort['checkout']; lock?: LockPort; git?: Partial<GitPort>; withHealthProbe?: boolean } = {}) {
  const checkout = vi.fn(overrides.checkout ?? (async () => ok(undefined)));
  const registry = {
    list: vi.fn(async () => ok(['/repo/a', '/repo/b', '/repo/c', '/repo/d'])),
    exists: vi.fn(async () => ok(true)),
  } as unknown as RegistryPort;
  const manifest: ManifestPort = {
    load: vi.fn(async (repoPath: string) => {
      const name = repoPath.split('/').pop();
      return ok({ service: `svc-${name}`, ...(name === 'c' ? {} : { container: `ctr-${name}` }), sharedBranch: 'development', modules: {} });
    }),
  };
  const git = {
    currentBranch: vi.fn(async (path: string) => (BRANCHES[path] !== undefined ? ok(BRANCHES[path]) : err('git-error', 'unreadable'))),
    isMergeInProgress: vi.fn(async () => ok(false)),
    isRebaseInProgress: vi.fn(async () => ok(false)),
    hasUnmergedPaths: vi.fn(async () => ok(false)),
    hasUncommittedChanges: vi.fn(async () => ok(false)),
    listDirtyPaths: vi.fn(async () => ok([])),
    assertAllowedBranch: vi.fn(async () => ok(undefined)),
    branchExistsLocally: vi.fn(async () => ok(true)),
    fetch: vi.fn(async () => ok(undefined)),
    checkout,
    ...overrides.git,
  } as unknown as GitPort;
  const edtRegistry = {
    list: vi.fn(async () =>
      ok([
        {
          ulid: 'e1',
          topic: 'demo',
          createdAt: '2026-11-01T00:00:00.000Z',
          status: 'active' as const,
          members: [
            { service: 'svc-a', repoPath: '/repo/a', branch: 'feat/a' },
            { service: 'svc-b', repoPath: '/repo/b', branch: 'feat/b' },
          ],
        },
      ]),
    ),
    logAction: vi.fn(async () => ok(undefined)),
  } as unknown as EdtRegistryPort;
  const state = { readActiveEdt: vi.fn(async () => ok('e1')) } as unknown as StatePort;
  const lock: LockPort = overrides.lock ?? {
    acquire: vi.fn(async () => ok({ release: vi.fn(async () => ok(undefined)) })),
    peek: vi.fn(async () => ok({ locked: false })),
  };
  const settings: SettingsPort = { load: vi.fn(async () => ok({ settings: DEFAULT_SETTINGS, warning: null })), save: vi.fn(async () => ok(undefined)) };
  const docker = { getContainerHealth: vi.fn(async () => ok('up' as const)) } as unknown as DockerPort;
  const containerRestart = vi.fn(async () => ok(undefined));
  const deps: AppStoreDeps = {
    registry,
    manifest,
    manifestCarry: { capture: async () => ({ ok: true, data: { kind: 'absent' } }), restore: async () => ({ ok: true, data: undefined }) },
    git,
    edtRegistry,
    state,
    lock,
    edtRegistryResourceKey: '/cfg/edts.yaml',
    edtsBaseDir: '/data/edts',
    registryResourceKey: '/cfg/registry.yaml',
    settings,
    docker,
    container: { restart: containerRestart },
    restart: { run: vi.fn(async () => ok({ output: '' })) },
    editor: { launch: vi.fn(() => ok(undefined)) },
    ...(overrides.withHealthProbe === false ? {} : { healthProbe: { probe: vi.fn(async () => ok({ healthy: true, status: 200 })) } }),
  };
  return { deps, checkout, containerRestart };
}

async function openLoaded(store: ReturnType<typeof createAppStore>) {
  store.getState().openRealignScreen();
  await vi.waitFor(() => expect(store.getState().realignCandidates?.status).toBe('ready'));
}

describe('realign slice', () => {
  it('lists only drifted services, members first, with the edt preset from settings', async () => {
    const store = createAppStore(fakeDeps().deps);
    await openLoaded(store);
    const rows = store.getState().realignCandidates?.rows ?? [];
    expect(rows.map((row) => [row.service, row.kind])).toEqual([
      ['svc-a', 'member'],
      ['svc-b', 'member'],
      ['svc-c', 'other'],
    ]);
    expect(store.getState().realignDraft).toEqual({ cursor: 0, selected: ['/repo/a', '/repo/b'], restartMode: 'none' });
  });

  it('seeds the preset and restart selector from the live settings on open', async () => {
    const store = createAppStore(fakeDeps().deps);
    store.setState({ settings: { ...DEFAULT_SETTINGS, realign: { defaultScope: 'all', restartMode: 'clean' } } });
    await openLoaded(store);
    expect(store.getState().realignDraft.selected).toEqual(['/repo/a', '/repo/b', '/repo/c']);
    expect(store.getState().realignDraft.restartMode).toBe('clean');
  });

  it('presets act on listed rows; Space toggles a row; the restart choice never reaches the settings', async () => {
    const { deps } = fakeDeps();
    const store = createAppStore(deps);
    await openLoaded(store);
    store.getState().applyRealignPreset('all');
    expect(store.getState().realignDraft.selected).toHaveLength(3);
    store.getState().applyRealignPreset('none');
    expect(store.getState().realignDraft.selected).toEqual([]);
    store.getState().toggleRealignRow('/repo/c');
    expect(store.getState().realignDraft.selected).toEqual(['/repo/c']);
    store.getState().cycleRealignRestartMode(1);
    expect(store.getState().realignDraft.restartMode).toBe('simple');
    expect(store.getState().settings.realign.restartMode).toBe('none');
    expect(deps.settings.save).not.toHaveBeenCalled();
  });

  it('runs the selection with scope none, finalises live rows and refreshes the dashboard', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((done) => {
      release = done;
    });
    const { deps, checkout } = fakeDeps({ checkout: async () => { await gate; return ok(undefined); } });
    const store = createAppStore(deps);
    const loadDashboard = vi.fn(async () => {});
    await openLoaded(store);
    store.setState({ loadDashboard });

    const run = store.getState().runRealign();
    expect(store.getState().realignRun?.rows.map((row) => row.status)).toEqual(['realigning', 'pending']);
    expect(store.getState().realignRun?.status).toBe('running');
    store.getState().closeRealignScreen();
    expect(store.getState().realignScreenOpen).toBe(true);

    release();
    await run;
    expect(checkout).toHaveBeenCalledWith('/repo/a', 'feat/a');
    expect(checkout).toHaveBeenCalledWith('/repo/b', 'feat/b');
    expect(store.getState().realignRun).toMatchObject({ status: 'done', error: null });
    expect(store.getState().realignRun?.rows.map((row) => [row.service, row.status])).toEqual([
      ['svc-a', 'realigned'],
      ['svc-b', 'realigned'],
    ]);
    expect(loadDashboard).toHaveBeenCalledWith({ queueIfBusy: true });
  });

  it('restarts the realigned services, skipping the container-less one', async () => {
    const { deps, containerRestart } = fakeDeps();
    const store = createAppStore(deps);
    await openLoaded(store);
    store.getState().applyRealignPreset('all');
    store.getState().cycleRealignRestartMode(1);
    await store.getState().runRealign();
    const run = store.getState().realignRun;
    expect(run?.status).toBe('done');
    expect(containerRestart).toHaveBeenCalledWith('ctr-a');
    expect(run?.restartRows.find((row) => row.service === 'svc-c')).toMatchObject({ phase: 'skipped', skipReason: 'no container' });
    expect(store.getState().serviceRestartInFlight).toEqual({});
  });

  it('verifies a service whose health check is disabled without probing it', async () => {
    const { deps } = fakeDeps();
    const probe = vi.fn(async () => ok({ healthy: false, status: 503, reason: 'HTTP 503' }));
    const store = createAppStore({
      ...deps,
      healthProbe: { probe },
      manifest: {
        load: async (repoPath: string) => {
          const name = repoPath.split('/').pop();
          return ok({ service: `svc-${name}`, ...(name === 'c' ? {} : { container: `ctr-${name}` }), healthUrl: 'http://x/h', sharedBranch: 'development', modules: {} });
        },
      },
    });
    store.setState({ settings: { ...DEFAULT_SETTINGS, services: { healthCheckDisabled: ['svc-a', 'svc-b'] } } });
    await openLoaded(store);
    store.getState().applyRealignPreset('edt');
    store.getState().cycleRealignRestartMode(1);
    await store.getState().runRealign();
    const run = store.getState().realignRun;
    expect(run?.restartRows.find((row) => row.service === 'svc-a')).toMatchObject({ phase: 'up-unverified' });
    expect(probe).not.toHaveBeenCalled();
  });

  it('shows the lock error as the run error and touches nothing', async () => {
    const { deps, checkout } = fakeDeps({
      lock: { acquire: vi.fn(async () => err('action-in-progress', 'busy')), peek: vi.fn(async () => ok({ locked: true })) },
    });
    const store = createAppStore(deps);
    await openLoaded(store);
    await store.getState().runRealign();
    expect(store.getState().realignRun).toMatchObject({ status: 'error', rows: [] });
    expect(store.getState().realignRun?.error).toContain('Cannot realign');
    expect(checkout).not.toHaveBeenCalled();
    store.getState().closeRealignScreen();
    expect(store.getState().realignScreenOpen).toBe(false);
  });

  it('keeps the rows finished before a run error', async () => {
    const { deps } = fakeDeps();
    const store = createAppStore(deps);
    await openLoaded(store);
    // Throws inside the locked run once every row has finished (the action-log write).
    Object.defineProperty(deps.edtRegistry, 'logAction', {
      get() {
        throw new Error('action log unreadable');
      },
    });
    await store.getState().runRealign();
    const run = store.getState().realignRun;
    expect(run).toMatchObject({ status: 'error', error: 'action log unreadable' });
    expect(run?.rows.map((row) => [row.service, row.status])).toEqual([
      ['svc-a', 'realigned'],
      ['svc-b', 'realigned'],
    ]);
  });

  it.each([
    ['the health-probe port is not wired', { withHealthProbe: false }, {}, 'health-probe'],
    ['a standalone service restart is in flight', {}, { serviceRestartInFlight: { '/repo/z': 'restart' as const } }, 'already in progress'],
    ['a post-switch restart is running', {}, { switchRestart: { topic: 't', mode: 'simple' as const, status: 'running' as const, rows: [], report: null, error: null } }, 'already in progress'],
  ])('refuses a restart run when %s, touching nothing', async (_name, depsOverrides, state, message) => {
    const { deps, checkout } = fakeDeps(depsOverrides);
    const store = createAppStore(deps);
    await openLoaded(store);
    store.getState().cycleRealignRestartMode(1);
    store.setState(state);
    await store.getState().runRealign();
    expect(store.getState().realignRun).toMatchObject({ status: 'error', rows: [] });
    expect(store.getState().realignRun?.error).toContain(message);
    expect(store.getState().realignRun?.error).not.toContain('editor');
    expect(checkout).not.toHaveBeenCalled();
  });

  it('reads the preset scope at open, not when the candidates land', async () => {
    const store = createAppStore(fakeDeps().deps);
    store.getState().openRealignScreen();
    store.setState({ settings: { ...DEFAULT_SETTINGS, realign: { defaultScope: 'all', restartMode: 'clean' } } });
    await vi.waitFor(() => expect(store.getState().realignCandidates?.status).toBe('ready'));
    expect(store.getState().realignDraft).toMatchObject({ selected: ['/repo/a', '/repo/b'], restartMode: 'none' });
  });

  it('does nothing on an empty selection', async () => {
    const { deps, checkout } = fakeDeps();
    const store = createAppStore(deps);
    await openLoaded(store);
    store.getState().applyRealignPreset('none');
    await store.getState().runRealign();
    expect(store.getState().realignRun).toBeNull();
    expect(checkout).not.toHaveBeenCalled();
  });

  it('reports a candidates load failure as an error', async () => {
    const { deps } = fakeDeps();
    deps.registry.list = vi.fn(async () => err('registry-read-error', 'registry.yaml unreadable'));
    const store = createAppStore(deps);
    store.getState().openRealignScreen();
    await vi.waitFor(() => expect(store.getState().realignCandidates?.status).toBe('error'));
    expect(store.getState().realignCandidates?.error).toBe('registry.yaml unreadable');
  });

  it('degrades to an error without ports', async () => {
    const store = createAppStore();
    store.getState().openRealignScreen();
    await vi.waitFor(() => expect(store.getState().realignCandidates?.status).toBe('error'));
  });
});

describe('realign selection helpers', () => {
  const rows = [
    { kind: 'member' as const, service: 'a', path: '/a', branch: 'x', expectedBranch: 'y', drift: 'drifted' as const },
    { kind: 'other' as const, service: 'b', path: '/b', branch: 'x', expectedBranch: 'y', drift: 'drifted' as const },
  ];

  it('maps presets to rows and back', () => {
    expect(presetSelection(rows, 'edt')).toEqual(['/a']);
    expect(matchingPreset(rows, ['/a', '/b'])).toBe('all');
    expect(matchingPreset(rows, [])).toBe('none');
    expect(matchingPreset(rows, ['/b'])).toBeNull();
  });

  it('drops a row matching no open row instead of relabelling another service', () => {
    const live = [
      { service: 'a', path: '/a', status: 'realigned' as const },
      { service: 'b', path: '/b', status: 'realigning' as const },
    ];
    expect(applyRealignRow(live, { service: 'a', outcome: 'failed' })).toEqual(live);
    expect(applyRealignRow(live, { service: 'zz', outcome: 'skipped' })).toEqual(live);
  });

  it('finalises a row and promotes the next pending one', () => {
    const live = [
      { service: 'a', path: '/a', status: 'realigning' as const },
      { service: 'b', path: '/b', status: 'pending' as const },
    ];
    expect(applyRealignRow(live, { service: 'a', outcome: 'skipped', detail: { code: 'c', message: 'm' } })).toEqual([
      { service: 'a', path: '/a', status: 'skipped', detail: { code: 'c', message: 'm' } },
      { service: 'b', path: '/b', status: 'realigning' },
    ]);
  });
});
