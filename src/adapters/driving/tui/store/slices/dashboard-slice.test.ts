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

  it('stores the focused service and clears it when the service vanishes on reload', async () => {
    const store = createAppStore(fakeDeps());
    store.getState().focusDashboardService('svc-a');
    expect(store.getState().dashboardFocusedService).toBe('svc-a');
    await store.getState().loadDashboard();
    expect(store.getState().dashboardFocusedService).toBeNull();
  });
});
