// tui/store/slices/routes-slice: unit tests for story 6.1's Routes slice — store-level
// coverage of repo-target resolution and the failure-vs-empty distinction, against fake
// ports (AD-13). The zone's own render tests (routes-zone.test.tsx) cover the visible
// states; core's list-routes.test.ts covers the gate itself.
import { describe, expect, it, vi, afterEach } from 'vitest';
import { err, ok } from '../../../../../core/result.js';
import type { DevAuthPort } from '../../../../../core/ports/dev-auth.js';
import type { EdtRegistryEntry, EdtRegistryPort } from '../../../../../core/ports/edt-registry.js';
import type { LockPort } from '../../../../../core/ports/lock.js';
import type { Manifest, ManifestPort } from '../../../../../core/ports/manifest.js';
import type { RegistryPort } from '../../../../../core/ports/registry.js';
import type { Route, RouteScannerPort } from '../../../../../core/ports/route-scanner.js';
import type { StatePort } from '../../../../../core/ports/state.js';
import { createAppStore, type AppStoreDeps } from '../app-store.js';

function manifestFor(service: string, modules: Manifest['modules']): Manifest {
  return { service, container: service, sharedBranch: 'development', modules };
}

function fakeDeps(overrides: Partial<AppStoreDeps> = {}): AppStoreDeps {
  const registry: RegistryPort = {
    list: vi.fn(async () => ok(['/repos/gateway'])),
    add: vi.fn(async () => ok(undefined)),
    exists: vi.fn(async () => ok(true)),
    scan: vi.fn(async () => ok({ candidates: [], skipped: [] })),
    reset: vi.fn(async () => ok({ path: '/x', backupPath: null })),
  };
  const manifest: ManifestPort = {
    load: vi.fn(async () => ok(manifestFor('gateway', { 'route-explorer': {} }))),
  };
  const edtRegistry: EdtRegistryPort = {
    add: vi.fn(async () => ok(undefined)),
    list: vi.fn(async () => ok([] as EdtRegistryEntry[])),
    setStatus: vi.fn(async () => ok(undefined)),
    update: vi.fn(async () => ok(undefined)),
    remove: vi.fn(async () => ok(undefined)),
  };
  const state: StatePort = {
    readActiveEdt: vi.fn(async () => ok(null)),
    writeActiveEdt: vi.fn(async () => ok(undefined)),
    readSplitterRatios: vi.fn(async () => ok(null)),
    writeSplitterRatios: vi.fn(async () => ok(undefined)),
    readFilterHistory: vi.fn(async () => ok(null)),
    writeFilterHistory: vi.fn(async () => ok(undefined)),
  };
  const lock: LockPort = {
    acquire: vi.fn(async () => ok({ release: vi.fn(async () => ok(undefined)) })),
    peek: vi.fn(async () => ok({ locked: false })),
  };
  const scanner: RouteScannerPort = {
    scan: vi.fn(async () => ok([{ method: 'GET', path: '/users' }] as Route[])),
  };
  const auth: DevAuthPort = {
    getSession: vi.fn(async () => ok({ cookie: 'sid=abc' })),
  };
  return {
    registry,
    manifest,
    git: {} as AppStoreDeps['git'],
    edtRegistry,
    state,
    lock,
    registryResourceKey: '/config/registry.yaml',
    edtRegistryResourceKey: '/tmp/edts.yaml',
    edtsBaseDir: '/tmp/edts',
    settings: {} as AppStoreDeps['settings'],
    docker: {} as AppStoreDeps['docker'],
    scanner,
    auth,
    ...overrides,
  };
}

describe('routes slice (story 6.1)', () => {
  it('loads routes for the carrying repo into ready state', async () => {
    const store = createAppStore(fakeDeps());

    await store.getState().loadRoutes();

    const state = store.getState();
    expect(state.routesStatus).toBe('ready');
    expect(state.routesRepoPath).toBe('/repos/gateway');
    expect(state.routes).toEqual([{ method: 'GET', path: '/users' }]);
    expect(state.routesError).toBeNull();
  });

  it('degrades to an explicit error on an unwired store, never throwing', async () => {
    const store = createAppStore();

    await store.getState().loadRoutes();

    expect(store.getState().routesStatus).toBe('error');
    expect(store.getState().routesError).toMatchObject({ code: 'store-not-wired' });
  });

  it('reports route-exploration-not-activated (never an empty list) when no repo carries the module', async () => {
    const manifest: ManifestPort = {
      load: vi.fn(async () => ok(manifestFor('plain', {}))),
    };
    const store = createAppStore(fakeDeps({ manifest }));

    await store.getState().loadRoutes();

    const state = store.getState();
    expect(state.routesStatus).toBe('error');
    expect(state.routesError).toMatchObject({ code: 'route-exploration-not-activated' });
    expect(state.routes).toBeNull();
  });

  it('surfaces a scanner failure as route-scan-failed with its reason', async () => {
    const scanner: RouteScannerPort = {
      scan: vi.fn(async () => err('route-scan-failed', 'no spec', { reason: 'no spec' })),
    };
    const store = createAppStore(fakeDeps({ scanner }));

    await store.getState().loadRoutes();

    const state = store.getState();
    expect(state.routesStatus).toBe('error');
    expect(state.routesError).toMatchObject({ code: 'route-scan-failed' });
    expect(state.routes).toBeNull();
  });

  it('keeps a genuinely-empty scan as ready with [], distinct from any error', async () => {
    const scanner: RouteScannerPort = { scan: vi.fn(async () => ok([])) };
    const store = createAppStore(fakeDeps({ scanner }));

    await store.getState().loadRoutes();

    const state = store.getState();
    expect(state.routesStatus).toBe('ready');
    expect(state.routes).toEqual([]);
    expect(state.routesError).toBeNull();
  });

  it('surfaces a registry failure as error with routes cleared, never stuck in loading', async () => {
    const registry: RegistryPort = {
      list: vi.fn(async () => err('registry-invalid-yaml', 'bad registry')),
      add: vi.fn(async () => ok(undefined)),
      exists: vi.fn(async () => ok(true)),
      scan: vi.fn(async () => ok({ candidates: [], skipped: [] })),
      reset: vi.fn(async () => ok({ path: '/x', backupPath: null })),
    };
    const store = createAppStore(fakeDeps({ registry }));

    await store.getState().loadRoutes();

    const state = store.getState();
    expect(state.routesStatus).toBe('error');
    expect(state.routesError).toMatchObject({ code: 'registry-invalid-yaml' });
    expect(state.routes).toBeNull();
  });

  it('prefers the active EDT member carrying route-explorer over the first carrying repo', async () => {    const registry: RegistryPort = {
      list: vi.fn(async () => ok(['/repos/first', '/repos/member'])),
      add: vi.fn(async () => ok(undefined)),
      exists: vi.fn(async () => ok(true)),
      scan: vi.fn(async () => ok({ candidates: [], skipped: [] })),
      reset: vi.fn(async () => ok({ path: '/x', backupPath: null })),
    };
    const manifest: ManifestPort = {
      load: vi.fn(async (path: string) =>
        ok(manifestFor(path.split('/').pop() ?? path, { 'route-explorer': {} })),
      ),
    };
    const edtRegistry: EdtRegistryPort = {
      add: vi.fn(async () => ok(undefined)),
      list: vi.fn(async () => ok([
        {
          ulid: '01J00000000000000000000000',
          topic: 'demo',
          createdAt: '2026-09-22T00:00:00.000Z',
          status: 'active',
          members: [{ service: 'member', repoPath: '/repos/member', branch: 'feat/x' }],
        },
      ] as EdtRegistryEntry[])),
      setStatus: vi.fn(async () => ok(undefined)),
      update: vi.fn(async () => ok(undefined)),
      remove: vi.fn(async () => ok(undefined)),
    };
    const state: StatePort = {
      readActiveEdt: vi.fn(async () => ok('01J00000000000000000000000')),
      writeActiveEdt: vi.fn(async () => ok(undefined)),
      readSplitterRatios: vi.fn(async () => ok(null)),
      writeSplitterRatios: vi.fn(async () => ok(undefined)),
      readFilterHistory: vi.fn(async () => ok(null)),
      writeFilterHistory: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ registry, manifest, edtRegistry, state }));

    await store.getState().loadRoutes();

    expect(store.getState().routesRepoPath).toBe('/repos/member');
    expect(store.getState().routesStatus).toBe('ready');
  });
});

describe('routes slice fireRoute (story 6.2)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function manifestWithBaseUrl(): ManifestPort {
    return { load: vi.fn(async () => ok(manifestFor('gateway', { 'route-explorer': { baseUrl: 'http://localhost:3000' } }))) };
  }

  async function loadedStore(overrides: Partial<AppStoreDeps> = {}) {
    const store = createAppStore(fakeDeps({ manifest: manifestWithBaseUrl(), ...overrides }));
    await store.getState().loadRoutes();
    expect(store.getState().routesStatus).toBe('ready');
    return store;
  }

  it('fires the selected route into fired state with status + duration + body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"id":1}', { status: 201 })));
    const store = await loadedStore();

    await store.getState().fireRoute('GET', '/users');

    const state = store.getState();
    expect(state.fireStatus).toBe('fired');
    expect(state.fireResult).toMatchObject({ status: 201, body: '{"id":1}' });
    expect(typeof state.fireResult?.durationMs).toBe('number');
    expect(state.fireError).toBeNull();
  });

  it('degrades to an explicit error on an unwired store, never throwing', async () => {
    const store = createAppStore();

    await store.getState().fireRoute('GET', '/users');

    expect(store.getState().fireStatus).toBe('error');
    expect(store.getState().fireError).toMatchObject({ code: 'store-not-wired' });
  });

  it('degrades to an explicit error when no dev auth is wired', async () => {
    const store = createAppStore(fakeDeps({ manifest: manifestWithBaseUrl(), auth: undefined }));

    await store.getState().fireRoute('GET', '/users');

    expect(store.getState().fireStatus).toBe('error');
    expect(store.getState().fireError).toMatchObject({ code: 'store-not-wired' });
  });

  it('rejects with missing-argument when no routes repo was ever loaded', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200 })));
    const store = createAppStore(fakeDeps({ manifest: manifestWithBaseUrl() }));

    await store.getState().fireRoute('GET', '/users');

    expect(store.getState().fireStatus).toBe('error');
    expect(store.getState().fireError).toMatchObject({ code: 'missing-argument' });
  });

  it('surfaces an auth-endpoint failure with the fire result cleared', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200 })));
    const auth: DevAuthPort = {
      getSession: vi.fn(async () => err('auth-endpoint-failed', 'auth down', { reason: 'HTTP 500' })),
    };
    const store = await loadedStore({ auth });

    await store.getState().fireRoute('GET', '/users');

    const state = store.getState();
    expect(state.fireStatus).toBe('error');
    expect(state.fireError).toMatchObject({ code: 'auth-endpoint-failed' });
    expect(state.fireResult).toBeNull();
  });

  it('surfaces a 403 as the distinct auth-forbidden, never as a generic failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('denied', { status: 403 })));
    const store = await loadedStore();

    await store.getState().fireRoute('GET', '/users');

    const state = store.getState();
    expect(state.fireStatus).toBe('error');
    expect(state.fireError).toMatchObject({ code: 'auth-forbidden' });
    expect(state.fireResult).toBeNull();
  });

  it('surfaces an unknown route without firing', async () => {
    const fetch = vi.fn(async () => new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const store = await loadedStore();

    await store.getState().fireRoute('DELETE', '/users');

    expect(store.getState().fireStatus).toBe('error');
    expect(store.getState().fireError).toMatchObject({ code: 'unknown-route' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('ignores a second fire while one is already in flight, issuing no new fetch or auth call', async () => {
    let release: ((response: Response) => void) | undefined;
    const fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetch);
    const getSession = vi.fn(async () => ok({ cookie: 'sid=abc' }));
    const auth: DevAuthPort = { getSession };
    const store = await loadedStore({ auth });

    const first = store.getState().fireRoute('GET', '/users');
    expect(store.getState().fireStatus).toBe('firing');
    // Let the first fire run past the manifest gate, scan, and session into the fetch.
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await store.getState().fireRoute('GET', '/users');

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(getSession).toHaveBeenCalledTimes(1);

    release?.(new Response('ok', { status: 200 }));
    await first;

    const state = store.getState();
    expect(state.fireStatus).toBe('fired');
    expect(state.fireResult).toMatchObject({ status: 200 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(getSession).toHaveBeenCalledTimes(1);
  });

  it('degrades to an explicit error when the scanner is unwired even with auth present, firing nothing', async () => {
    const fetch = vi.fn(async () => new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const store = createAppStore(fakeDeps({ manifest: manifestWithBaseUrl(), scanner: undefined }));

    await store.getState().fireRoute('GET', '/users');

    expect(store.getState().fireStatus).toBe('error');
    expect(store.getState().fireError).toMatchObject({ code: 'store-not-wired' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('clears a previous fire result when routes reload successfully', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200 })));
    const store = await loadedStore();

    await store.getState().fireRoute('GET', '/users');
    expect(store.getState().fireStatus).toBe('fired');

    await store.getState().loadRoutes();

    const state = store.getState();
    expect(state.routesStatus).toBe('ready');
    expect(state.fireStatus).toBe('idle');
    expect(state.fireResult).toBeNull();
    expect(state.fireError).toBeNull();
  });
});
