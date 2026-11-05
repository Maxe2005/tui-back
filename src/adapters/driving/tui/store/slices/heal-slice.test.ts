// tui/store/slices/heal-slice: the slice runs the real core planHeal/runHeal against fake ports,
// so these verify the wiring — the plan and its notices, the mode seeded from the settings, live
// rows, the busy guard, closing mid-run and the dashboard refresh — not the use-case itself.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RestartRow } from '../../../../../core/edt/switch-restart.js';
import { HEAL_NOTHING_TO_DO_MESSAGE } from '../../../../../core/heal/index.js';
import type { DockerPort, HealthState } from '../../../../../core/ports/docker.js';
import type { EdtRegistryPort } from '../../../../../core/ports/edt-registry.js';
import type { GitPort } from '../../../../../core/ports/git.js';
import type { LockPort } from '../../../../../core/ports/lock.js';
import type { ManifestPort } from '../../../../../core/ports/manifest.js';
import type { RegistryPort } from '../../../../../core/ports/registry.js';
import { DEFAULT_SETTINGS, type SettingsPort } from '../../../../../core/ports/settings.js';
import type { StatePort } from '../../../../../core/ports/state.js';
import { ok } from '../../../../../core/result.js';
import { createAppStore, type AppStoreDeps } from '../app-store.js';
import { HEAL_BUSY_MESSAGE, HEAL_NOTICE_TIMEOUT_MS, HEAL_UNWIRED_MESSAGE, orderHealPlanRows } from './heal-slice.js';

// Every service declares a container and a healthUrl; `health` is the container state, and the
// route answers 2xx only while the container is up. A restart brings the container up.
function fakeDeps(
  health: Record<string, HealthState>,
  overrides: { activeUlid?: string | null; restartGate?: Promise<void>; withHealthProbe?: boolean } = {},
) {
  const containers = { ...health };
  const names = Object.keys(health);
  const manifest: ManifestPort = {
    load: vi.fn(async (repoPath: string) => {
      const name = repoPath.split('/').pop()!;
      return ok({ service: `svc-${name}`, container: `ctr-${name}`, healthUrl: `http://${name}/health`, sharedBranch: 'development', modules: {} });
    }),
  };
  const docker = {
    getContainerHealth: vi.fn(async (container: string) => ok(containers[container.replace('ctr-', '')] ?? 'up')),
  } as unknown as DockerPort;
  const containerRestart = vi.fn(async (container: string) => {
    await overrides.restartGate;
    containers[container.replace('ctr-', '')] = 'up';
    return ok(undefined);
  });
  const healthProbe = {
    probe: vi.fn(async (url: string) => {
      const name = url.replace('http://', '').replace('/health', '');
      return ok(containers[name] === 'up' ? { healthy: true, status: 200 } : { healthy: false, reason: 'connection refused' });
    }),
  };
  const edtRegistry = {
    list: vi.fn(async () =>
      ok([
        {
          ulid: 'e1',
          topic: 'demo',
          createdAt: '2026-11-01T00:00:00.000Z',
          status: 'active' as const,
          members: names.map((name) => ({ service: `svc-${name}`, repoPath: `/repo/${name}`, branch: 'feat/x' })),
        },
      ]),
    ),
  } as unknown as EdtRegistryPort;
  const state = { readActiveEdt: vi.fn(async () => ok(overrides.activeUlid === undefined ? 'e1' : overrides.activeUlid)) } as unknown as StatePort;
  const lock: LockPort = {
    acquire: vi.fn(async () => ok({ release: vi.fn(async () => ok(undefined)) })),
    peek: vi.fn(async () => ok({ locked: false })),
  };
  const settings: SettingsPort = { load: vi.fn(async () => ok({ settings: DEFAULT_SETTINGS, warning: null })), save: vi.fn(async () => ok(undefined)) };
  const deps: AppStoreDeps = {
    registry: { list: vi.fn(async () => ok(names.map((name) => `/repo/${name}`))), exists: vi.fn(async () => ok(true)) } as unknown as RegistryPort,
    manifest,
    manifestCarry: { capture: async () => ({ ok: true, data: { kind: 'absent' } }), restore: async () => ({ ok: true, data: undefined }) },
    git: {} as GitPort,
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
    ...(overrides.withHealthProbe === false ? {} : { healthProbe }),
  };
  return { deps, containerRestart, settings };
}

function storeWith(deps: AppStoreDeps) {
  const store = createAppStore(deps);
  const loadDashboard = vi.fn(async () => {});
  store.setState({ loadDashboard });
  return { store, loadDashboard };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('heal slice', () => {
  it('opens on the targets then the skipped services, with the mode from settings', async () => {
    const { deps } = fakeDeps({ b: 'up', a: 'down' });
    const { store } = storeWith(deps);
    store.setState({ settings: { ...DEFAULT_SETTINGS, dashboard: { restartMode: 'clean' } } });
    await store.getState().openHeal();
    const { healScreenOpen, healRun } = store.getState();
    expect(healScreenOpen).toBe(true);
    expect(healRun?.status).toBe('confirm');
    expect(healRun?.mode).toBe('clean');
    expect(healRun?.rows.map((row) => [row.service, row.phase, row.skipReason])).toEqual([
      ['svc-a', 'pending', undefined],
      ['svc-b', 'skipped', 'up'],
    ]);
  });

  it('shows a notice and no overlay when every service is up', async () => {
    const { deps } = fakeDeps({ a: 'up', b: 'up' });
    const { store } = storeWith(deps);
    await store.getState().openHeal();
    expect(store.getState()).toMatchObject({ healScreenOpen: false, healRun: null, healNotice: { message: HEAL_NOTHING_TO_DO_MESSAGE } });
  });

  it('shows the plan error as a notice when there is no active EDT', async () => {
    const { deps } = fakeDeps({ a: 'down' }, { activeUlid: null });
    const { store } = storeWith(deps);
    await store.getState().openHeal();
    expect(store.getState().healScreenOpen).toBe(false);
    expect(store.getState().healRun).toBeNull();
    expect(store.getState().healNotice).toMatchObject({ tone: 'error', message: expect.stringContaining('No active EDT') });
  });

  it('refuses without the health-probe port', async () => {
    const { deps } = fakeDeps({ a: 'down' }, { withHealthProbe: false });
    const { store } = storeWith(deps);
    await store.getState().openHeal();
    expect(store.getState()).toMatchObject({ healScreenOpen: false, healNotice: { message: HEAL_UNWIRED_MESSAGE } });
  });

  it('auto-dismisses the notice, and an older timer never clears a newer notice', async () => {
    vi.useFakeTimers();
    const { deps } = fakeDeps({ a: 'up' });
    const { store } = storeWith(deps);
    await store.getState().openHeal();
    vi.advanceTimersByTime(HEAL_NOTICE_TIMEOUT_MS - 10);
    await store.getState().openHeal();
    vi.advanceTimersByTime(20);
    expect(store.getState().healNotice).not.toBeNull();
    vi.advanceTimersByTime(HEAL_NOTICE_TIMEOUT_MS);
    expect(store.getState().healNotice).toBeNull();
  });

  it('refuses with a notice while another restart runs, and ignores H while planning', async () => {
    const { deps } = fakeDeps({ a: 'down' });
    const { store } = storeWith(deps);
    store.setState({ serviceRestartInFlight: { '/repo/x': 'restart' } });
    await store.getState().openHeal();
    expect(store.getState()).toMatchObject({ healScreenOpen: false, healNotice: { message: HEAL_BUSY_MESSAGE, tone: 'warning' } });

    store.setState({ serviceRestartInFlight: {}, switchRestart: { topic: 't', mode: 'simple', status: 'running', rows: [], report: null, error: null } });
    await store.getState().openHeal();
    expect(store.getState().healScreenOpen).toBe(false);

    store.setState({ switchRestart: null });
    const first = store.getState().openHeal();
    expect(store.getState().healRun?.status).toBe('planning');
    await store.getState().openHeal();
    await first;
    expect(deps.state.readActiveEdt).toHaveBeenCalledTimes(1);
  });

  it('toggles the mode between simple and clean without writing the settings', async () => {
    const { deps, settings } = fakeDeps({ a: 'down' });
    const { store } = storeWith(deps);
    await store.getState().openHeal();
    store.getState().toggleHealMode();
    expect(store.getState().healRun?.mode).toBe('clean');
    store.getState().toggleHealMode();
    expect(store.getState().healRun?.mode).toBe('simple');
    expect(store.getState().settings.dashboard.restartMode).toBe('simple');
    expect(settings.save).not.toHaveBeenCalled();
  });

  it('Esc in confirm closes and restarts nothing', async () => {
    const { deps, containerRestart } = fakeDeps({ a: 'down' });
    const { store } = storeWith(deps);
    await store.getState().openHeal();
    store.getState().closeHeal();
    expect(store.getState()).toMatchObject({ healScreenOpen: false, healRun: null });
    expect(containerRestart).not.toHaveBeenCalled();
  });

  it('streams the rows live, marks the targets in flight, then finishes and refreshes once', async () => {
    let release: () => void = () => {};
    const restartGate = new Promise<void>((done) => {
      release = done;
    });
    const { deps, containerRestart } = fakeDeps({ a: 'down', b: 'up', c: 'down' }, { restartGate });
    const { store, loadDashboard } = storeWith(deps);
    await store.getState().openHeal();
    const seen: string[][] = [];
    const unsubscribe = store.subscribe((state) => {
      if (state.healRun?.status === 'running') {
        seen.push(state.healRun.rows.map((row: RestartRow) => `${row.service}:${row.phase}`));
      }
    });
    const run = store.getState().startHeal();
    expect(store.getState().healRun?.status).toBe('running');
    expect(store.getState().serviceRestartInFlight).toEqual({ '/repo/a': 'restart', '/repo/c': 'restart' });
    await vi.waitFor(() => expect(store.getState().healRun?.rows.some((row) => row.phase === 'restarting')).toBe(true));
    release();
    await run;
    unsubscribe();
    expect(seen.flat()).toEqual(expect.arrayContaining(['svc-a:restarting', 'svc-a:verifying']));
    const { healRun } = store.getState();
    expect(healRun?.status).toBe('done');
    expect(healRun?.report?.summary.functional).toBe(2);
    expect(healRun?.rows.map((row) => `${row.service}:${row.phase}`).sort()).toEqual(['svc-a:functional', 'svc-b:skipped', 'svc-c:functional']);
    expect(containerRestart).toHaveBeenCalledTimes(2);
    expect(store.getState().serviceRestartInFlight).toEqual({});
    expect(loadDashboard).toHaveBeenCalledTimes(1);
    expect(loadDashboard).toHaveBeenCalledWith({ queueIfBusy: true });
  });

  it('closing mid-run hides the overlay, the run finishes and blocks a new heal meanwhile', async () => {
    let release: () => void = () => {};
    const restartGate = new Promise<void>((done) => {
      release = done;
    });
    const { deps } = fakeDeps({ a: 'down' }, { restartGate });
    const { store, loadDashboard } = storeWith(deps);
    await store.getState().openHeal();
    const run = store.getState().startHeal();
    store.getState().closeHeal();
    expect(store.getState().healScreenOpen).toBe(false);
    expect(store.getState().healRun?.status).toBe('running');
    await store.getState().openHeal();
    expect(store.getState().healNotice?.message).toBe(HEAL_BUSY_MESSAGE);
    release();
    await run;
    expect(store.getState().healRun?.status).toBe('done');
    expect(store.getState().serviceRestartInFlight).toEqual({});
    expect(loadDashboard).toHaveBeenCalledTimes(1);
  });

  it('lands in the error state when runHeal fails, and Esc then closes', async () => {
    const { deps, containerRestart } = fakeDeps({ a: 'down' });
    const { store, loadDashboard } = storeWith(deps);
    await store.getState().openHeal();
    // An unknown mode is the one input runHeal rejects with an error Result.
    store.setState({ healRun: { ...store.getState().healRun!, mode: 'bogus' as never } });
    await store.getState().startHeal();
    expect(store.getState().healRun).toMatchObject({ status: 'error', error: expect.stringContaining('Unknown restart mode') });
    expect(containerRestart).not.toHaveBeenCalled();
    expect(store.getState().serviceRestartInFlight).toEqual({});
    expect(loadDashboard).toHaveBeenCalledTimes(1);
    store.getState().closeHeal();
    expect(store.getState()).toMatchObject({ healScreenOpen: false, healRun: null });
  });

  it('refuses the run when a restart started while the overlay was open', async () => {
    const { deps, containerRestart } = fakeDeps({ a: 'down' });
    const { store } = storeWith(deps);
    await store.getState().openHeal();
    store.setState({ serviceRestartInFlight: { '/repo/x': 'restart' } });
    await store.getState().startHeal();
    expect(store.getState().healRun).toMatchObject({ status: 'error', error: HEAL_BUSY_MESSAGE });
    expect(containerRestart).not.toHaveBeenCalled();
  });
});

describe('orderHealPlanRows', () => {
  it('puts the targets first, keeping member order in each group', () => {
    const row = (service: string, phase: RestartRow['phase']): RestartRow => ({ service, repoPath: `/r/${service}`, phase });
    expect(orderHealPlanRows([row('a', 'skipped'), row('b', 'pending'), row('c', 'skipped'), row('d', 'pending')]).map((r) => r.service)).toEqual(['b', 'd', 'a', 'c']);
  });
});
