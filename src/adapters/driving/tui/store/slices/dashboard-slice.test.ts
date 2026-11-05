// tui/store/slices/dashboard-slice: section statuses, independence of the two loads and the
// unwired degradation, against the real section builders over fake ports.
import { describe, expect, it, vi } from 'vitest';
import { err, ok } from '../../../../../core/result.js';
import type { DockerPort } from '../../../../../core/ports/docker.js';
import type { EdtRegistryPort } from '../../../../../core/ports/edt-registry.js';
import type { GitPort } from '../../../../../core/ports/git.js';
import type { ManifestPort } from '../../../../../core/ports/manifest.js';
import type { RegistryPort } from '../../../../../core/ports/registry.js';
import type { StatePort } from '../../../../../core/ports/state.js';
import { createAppStore, type AppStoreDeps } from '../app-store.js';

function fakeDeps(overrides: Partial<Record<'registry' | 'edtRegistry' | 'state' | 'manifest' | 'healthProbe', unknown>> = {}): AppStoreDeps {
  return {
    registry: { list: vi.fn(async () => ok(['/r/a'])), exists: vi.fn(async () => ok(true)) } as unknown as RegistryPort,
    manifest: { load: vi.fn(async () => ok({ service: 'a', sharedBranch: 'development', modules: {} })) } as unknown as ManifestPort,
    git: {
      currentBranch: vi.fn(async () => ok('feat/x')),
      aheadBehind: vi.fn(async () => ok({ ahead: 0, behind: 0 })),
      hasUncommittedChanges: vi.fn(async () => ok(false)),
      isMergeInProgress: vi.fn(async () => ok(false)),
      isRebaseInProgress: vi.fn(async () => ok(false)),
    } as unknown as GitPort,
    docker: { getContainerHealth: vi.fn(async () => ok('up')) } as unknown as DockerPort,
    edtRegistry: { list: vi.fn(async () => ok([])) } as unknown as EdtRegistryPort,
    state: { readActiveEdt: vi.fn(async () => ok(null)) } as unknown as StatePort,
    ...overrides,
  } as unknown as AppStoreDeps;
}

describe('dashboard slice', () => {
  it('fills both sections and stamps the update time', async () => {
    const store = createAppStore(fakeDeps());
    const pending = store.getState().loadDashboard();
    expect(store.getState().dashboardServicesStatus).toBe('loading');
    expect(store.getState().dashboardRegistryStatus).toBe('loading');
    await pending;
    const state = store.getState();
    expect(state.dashboardServicesStatus).toBe('ready');
    expect(state.dashboardServices?.status).toBe('no-active-edt');
    expect(state.dashboardRegistry?.repoCount).toBe(1);
    expect(state.dashboardUpdatedAt).not.toBeNull();
  });

  it('reads the live health-check toggle at each refresh: a disabled service is never probed (story 9.11)', async () => {
    const probe = vi.fn(async () => ok({ healthy: false, reason: 'HTTP 503' }));
    const store = createAppStore(
      fakeDeps({
        manifest: { load: async () => ok({ service: 'a', container: 'a', healthUrl: 'http://a/h', sharedBranch: 'development', modules: {} }) },
        healthProbe: { probe },
        edtRegistry: {
          list: async () => ok([{ ulid: 'e1', topic: 't', createdAt: '', status: 'active', members: [{ service: 'a', repoPath: '/r/a', branch: 'feat/x' }] }]),
        },
        state: { readActiveEdt: async () => ok('e1') },
      }),
    );
    await store.getState().loadDashboard();
    expect(store.getState().dashboardServices?.services[0]?.status).toMatchObject({ ok: true, value: { state: 'unhealthy' } });
    expect(probe).toHaveBeenCalledTimes(1);

    store.setState((state) => ({ settings: { ...state.settings, services: { healthCheckDisabled: ['a'] } } }));
    await store.getState().loadDashboard();
    expect(store.getState().dashboardServices?.services[0]?.status).toEqual({
      ok: true,
      value: { state: 'up', verified: false, container: 'up', healthCheck: 'disabled' },
    });
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('carries the drift of the members and of the other managed services', async () => {
    const store = createAppStore(
      fakeDeps({
        registry: { list: async () => ok(['/r/a', '/r/o']), exists: async () => ok(true) },
        edtRegistry: {
          list: async () => ok([{ ulid: 'e1', topic: 't', createdAt: '', status: 'active', members: [{ service: 'a', repoPath: '/r/a', branch: 'feat/y' }] }]),
        },
        state: { readActiveEdt: async () => ok('e1') },
      }),
    );
    await store.getState().loadDashboard();
    const services = store.getState().dashboardServices;
    expect(services?.services[0]).toMatchObject({ branch: 'feat/x', expectedBranch: 'feat/y', drift: 'drifted' });
    expect(services?.others).toEqual([{ service: 'a', path: '/r/o', branch: 'feat/x', expectedBranch: 'development', drift: 'drifted' }]);
  });

  it('fails one section without touching the other', async () => {
    const store = createAppStore(fakeDeps({ edtRegistry: { list: async () => err('edt-error', 'x') } }));
    await store.getState().loadDashboard();
    expect(store.getState().dashboardServicesStatus).toBe('error');
    expect(store.getState().dashboardRegistryStatus).toBe('ready');
  });

  it('ignores a refresh while a load is in flight', async () => {
    const deps = fakeDeps();
    const store = createAppStore(deps);
    const first = store.getState().loadDashboard();
    await store.getState().loadDashboard();
    await first;
    expect(deps.registry.list).toHaveBeenCalledTimes(1);
  });

  it('re-runs once after a queued call when the active EDT changes mid-load', async () => {
    const deps = fakeDeps();
    const store = createAppStore(deps);
    const first = store.getState().loadDashboard();
    await store.getState().loadDashboard({ queueIfBusy: true });
    await first;
    expect(deps.registry.list).toHaveBeenCalledTimes(2);
  });

  it('turns a throwing builder into a section error instead of a stuck spinner, then recovers on reload', async () => {
    let fail = true;
    const store = createAppStore(
      fakeDeps({
        edtRegistry: {
          list: async () => {
            if (fail) {
              throw new Error('boom');
            }
            return ok([]);
          },
        },
      }),
    );
    await store.getState().loadDashboard();
    expect(store.getState().dashboardServicesStatus).toBe('error');
    expect(store.getState().dashboardRegistryStatus).toBe('ready');
    fail = false;
    await store.getState().loadDashboard();
    expect(store.getState().dashboardServicesStatus).toBe('ready');
  });

  it('stamps the update time only for sections that loaded', async () => {
    const failing = createAppStore(fakeDeps({ edtRegistry: { list: async () => err('edt-error', 'x') }, registry: { list: async () => err('registry-error', 'x'), exists: async () => ok(true) } }));
    await failing.getState().loadDashboard();
    expect(failing.getState().dashboardUpdatedAt).toBeNull();
    const unwired = createAppStore();
    await unwired.getState().loadDashboard();
    expect(unwired.getState().dashboardUpdatedAt).toBeNull();
  });

  it('wires the Docker port into the service-action registry, so the container terminal reads live health', async () => {
    const getContainerHealth = vi.fn(async () => ok('down'));
    const store = createAppStore({
      ...fakeDeps(),
      manifest: { load: vi.fn(async () => ok({ service: 'a', container: 'api', sharedBranch: 'development', modules: {} })) },
      docker: { getContainerHealth } as unknown as DockerPort,
      container: { restart: vi.fn(async () => ok(undefined)) },
      restart: { run: vi.fn(async () => ok({ output: '' })) },
      editor: { launch: vi.fn(() => ok(undefined)) },
      lock: { acquire: vi.fn(), peek: vi.fn(async () => ok({ locked: false })) },
    } as unknown as AppStoreDeps);
    await store.getState().loadDashboardServiceActions('/r/a');
    const actions = store.getState().dashboardServiceActions['/r/a'];
    expect(actions?.map((a) => a.id)).toEqual(['open-in-ide', 'restart-simple', 'restart-clean', 'terminal-service', 'terminal-container']);
    expect(actions?.map((a) => a.availability)).toEqual([
      { available: true },
      { available: true },
      { available: false, reason: 'no clean recipe' },
      { available: true },
      { available: false, reason: 'container not running' },
    ]);
    expect(getContainerHealth).toHaveBeenCalledWith('api');
  });

  describe('terminal actions', () => {
    function terminalStore(health: 'up' | 'down') {
      const shell = { run: vi.fn() };
      const store = createAppStore({
        ...fakeDeps(),
        manifest: { load: vi.fn(async () => ok({ service: 'a', container: 'api', sharedBranch: 'development', modules: {} })) },
        docker: { getContainerHealth: vi.fn(async () => ok(health)) } as unknown as DockerPort,
        container: { restart: vi.fn(async () => ok(undefined)) },
        restart: { run: vi.fn(async () => ok({ output: '' })) },
        editor: { launch: vi.fn(() => ok(undefined)) },
        lock: { acquire: vi.fn(), peek: vi.fn(async () => ok({ locked: false })) },
        shell,
      } as unknown as AppStoreDeps);
      return store;
    }

    it('opens the service terminal on the row, named after its service', async () => {
      const store = terminalStore('up');
      store.setState({ dashboardServices: { services: [{ service: 'svc-a', path: '/r/a' }] } as never });
      await store.getState().runDashboardServiceAction('/r/a', 'terminal-service');
      expect(store.getState()).toMatchObject({
        terminalOpen: true,
        terminalReady: true,
        terminalTarget: { kind: 'service', repoPath: '/r/a', label: 'svc-a' },
      });
      // Opening a terminal is not a running row action.
      expect(store.getState().dashboardActionState['/r/a']?.running ?? null).toBeNull();
    });

    it('opens the container terminal on the manifest container when the registry lists it available', async () => {
      const store = terminalStore('up');
      await store.getState().runDashboardServiceAction('/r/a', 'terminal-container');
      expect(store.getState().terminalTarget).toEqual({ kind: 'container', repoPath: '/r/a', label: 'api' });
    });

    it('labels an unlisted row after its repo directory, or the whole path when that is empty', async () => {
      const store = terminalStore('up');
      await store.getState().runDashboardServiceAction('/r/a', 'terminal-service');
      expect(store.getState().terminalTarget?.label).toBe('a');
      store.getState().closeTerminal();
      await store.getState().runDashboardServiceAction('/', 'terminal-service');
      expect(store.getState().terminalTarget?.label).toBe('/');
    });

    it('opens nothing when the fresh availability says the container is not running', async () => {
      const store = terminalStore('down');
      await store.getState().runDashboardServiceAction('/r/a', 'terminal-container');
      expect(store.getState().terminalOpen).toBe(false);
    });
  });

  it('degrades to an error state when the ports are unwired', async () => {
    const store = createAppStore();
    await store.getState().loadDashboard();
    expect(store.getState().dashboardServicesStatus).toBe('error');
    expect(store.getState().dashboardRegistryStatus).toBe('error');
  });
});
