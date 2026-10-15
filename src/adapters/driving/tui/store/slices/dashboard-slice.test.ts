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

function fakeDeps(overrides: Partial<Record<'registry' | 'edtRegistry' | 'state', unknown>> = {}): AppStoreDeps {
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

  it('degrades to an error state when the ports are unwired', async () => {
    const store = createAppStore();
    await store.getState().loadDashboard();
    expect(store.getState().dashboardServicesStatus).toBe('error');
    expect(store.getState().dashboardRegistryStatus).toBe('error');
  });
});

describe('dashboard slice service actions', () => {
  function actionDeps(restartRun = vi.fn(async (_p: string, _c: string) => ok({ output: '' }))): AppStoreDeps {
    const base = fakeDeps() as unknown as Record<string, unknown>;
    return {
      ...base,
      manifest: { load: vi.fn(async () => ok({ service: 'a', sharedBranch: 'development', modules: {}, container: 'a', restartCommands: ['x', 'y'] })) },
      container: { restart: vi.fn(async () => ok(undefined)) },
      restart: { run: restartRun },
      editor: { launch: vi.fn(() => ok(undefined)) },
      lock: {
        acquire: vi.fn(async () => ok({ release: async () => ok(undefined) })),
        peek: vi.fn(async () => ok({ locked: false })),
      },
    } as unknown as AppStoreDeps;
  }

  it('loads the registry actions for a row', async () => {
    const store = createAppStore(actionDeps());
    await store.getState().loadDashboardServiceActions('/r/a');
    expect(store.getState().dashboardServiceActions['/r/a']?.map((a) => a.id)).toEqual(['open-in-ide', 'restart-simple', 'restart-clean']);
  });

  it('shows recipe progress while a clean restart runs, then the result', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const run = vi.fn(async (_p: string, command: string) => {
      if (command === 'y') {
        await gate;
      }
      return ok({ output: '' });
    });
    const store = createAppStore(actionDeps(run));
    await store.getState().loadDashboardServiceActions('/r/a');
    const pending = store.getState().runDashboardServiceAction('/r/a', 'restart-clean');
    await vi.waitFor(() => expect(store.getState().dashboardActionState['/r/a']?.running?.text).toBe('Clean restart — recipe step 2/2'));
    // A second run on the same row is ignored while one is in flight.
    await store.getState().runDashboardServiceAction('/r/a', 'restart-simple');
    release();
    await pending;
    expect(store.getState().dashboardActionState['/r/a']).toEqual({ running: null, result: { ok: true, text: 'Clean restart done' } });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('reports a failed restart inline', async () => {
    const store = createAppStore(actionDeps(vi.fn(async () => err('restart-failed', 'boom'))));
    await store.getState().loadDashboardServiceActions('/r/a');
    await store.getState().runDashboardServiceAction('/r/a', 'restart-clean');
    expect(store.getState().dashboardActionState['/r/a']?.result).toEqual({ ok: false, text: 'Repo /r/a restart "x" failed: boom' });
  });

  it('does not run an unavailable action', async () => {
    const deps = actionDeps() as unknown as { lock: { peek: ReturnType<typeof vi.fn> }; container: { restart: ReturnType<typeof vi.fn> } };
    deps.lock.peek = vi.fn(async (key: string) => ok({ locked: key === 'group-update' }));
    const store = createAppStore(deps as unknown as AppStoreDeps);
    await store.getState().loadDashboardServiceActions('/r/a');
    expect(store.getState().dashboardServiceActions['/r/a']?.[1]?.availability).toEqual({ available: false, reason: 'group update' });
    await store.getState().runDashboardServiceAction('/r/a', 'restart-simple');
    expect(deps.container.restart).not.toHaveBeenCalled();
  });

  it('degrades without restart ports: open reports through the editor, restart errors inline', async () => {
    const launch = vi.fn(() => err('editor-failed', 'no editor'));
    const store = createAppStore({ ...(fakeDeps() as unknown as Record<string, unknown>), editor: { launch } } as unknown as AppStoreDeps);
    await store.getState().runDashboardServiceAction('/r/a', 'open-in-ide');
    expect(store.getState().dashboardActionState['/r/a']?.result).toEqual({ ok: false, text: 'no editor' });
    await store.getState().runDashboardServiceAction('/r/a', 'restart-simple');
    expect(store.getState().dashboardActionState['/r/a']?.result?.ok).toBe(false);
    await store.getState().loadDashboardServiceActions('/r/a');
    expect(store.getState().dashboardServiceActions['/r/a']).toBeUndefined();
  });

  it('openServiceInZone switches to Logs and records the pending focus until cleared', () => {
    const store = createAppStore(fakeDeps());
    store.getState().openServiceInZone('/r/a');
    expect(store.getState().activeZone).toBe('logs');
    expect(store.getState().pendingServiceFocus).toBe('/r/a');
    store.getState().clearPendingServiceFocus();
    expect(store.getState().pendingServiceFocus).toBeNull();
  });
});
