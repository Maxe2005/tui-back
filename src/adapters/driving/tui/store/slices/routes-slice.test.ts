// tui/store/slices/routes-slice: store-level tests for repo-target resolution, the
// failure-vs-empty distinction, per-route fires, tree states and body drafts, against fake
// ports. The zone's render tests cover the visible states.
import { describe, expect, it, vi, afterEach } from 'vitest';
import { err, ok } from '../../../../../core/result.js';
import type { DevAuthPort } from '../../../../../core/ports/dev-auth.js';
import type { EdtRegistryEntry, EdtRegistryPort } from '../../../../../core/ports/edt-registry.js';
import type { LockPort } from '../../../../../core/ports/lock.js';
import type { Manifest, ManifestPort } from '../../../../../core/ports/manifest.js';
import type { RegistryPort } from '../../../../../core/ports/registry.js';
import type { Route, RouteScannerPort } from '../../../../../core/ports/route-scanner.js';
import type { SavedRequest, SavedRequestPort } from '../../../../../core/ports/saved-request.js';
import type { StatePort } from '../../../../../core/ports/state.js';
import { createAppStore, type AppStoreDeps } from '../app-store.js';

function manifestFor(service: string, modules: Manifest['modules']): Manifest {
  return { service, container: service, sharedBranch: 'development', modules };
}

function fakeDeps(overrides: Partial<AppStoreDeps> = {}): AppStoreDeps {
  const registry: RegistryPort = {
    list: vi.fn(async () => ok(['/repos/gateway'])),
    add: vi.fn(async () => ok(undefined)),
    remove: vi.fn(async () => ok(undefined)),
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

describe('routes slice', () => {
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
      remove: vi.fn(async () => ok(undefined)),
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
      remove: vi.fn(async () => ok(undefined)),
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

// Fire coverage against the per-route `responses` map (`fireRoute(routeKey, method, path,
// options?)`).
describe('routes slice fireRoute', () => {
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

  it('fires a route into its fired response with status + duration + body and switches to Response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"id":1}', { status: 201 })));
    const store = await loadedStore();

    await store.getState().fireRoute('GET /users', 'GET', '/users');

    const response = store.getState().responses['GET /users'];
    expect(response).toMatchObject({ status: 'fired', result: { status: 201, body: '{"id":1}' } });
    expect(store.getState().routesPaneTab).toBe('response');
  });

  it('sends the options (body, query, headers) through the use-case', async () => {
    const fetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const scanner: RouteScannerPort = { scan: vi.fn(async () => ok([{ method: 'PATCH', path: '/users/{id}' }] as Route[])) };
    const store = await loadedStore({ scanner });

    await store.getState().fireRoute('PATCH /users/{id}', 'PATCH', '/users/7', { body: { a: 1 }, query: { q: 'x' }, headers: { 'X-T': '1' } });

    expect(store.getState().responses['PATCH /users/{id}']).toMatchObject({ status: 'fired' });
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe('http://localhost:3000/users/7?q=x');
    expect(init?.body).toBe('{"a":1}');
    expect(new Headers(init?.headers).get('x-t')).toBe('1');
  });

  it('degrades to an explicit error on an unwired store, never throwing', async () => {
    const store = createAppStore();

    await store.getState().fireRoute('GET /users', 'GET', '/users');

    expect(store.getState().responses['GET /users']).toMatchObject({ status: 'error', error: { code: 'store-not-wired' } });
  });

  it('degrades to an explicit error when no dev auth is wired', async () => {
    const store = createAppStore(fakeDeps({ manifest: manifestWithBaseUrl(), auth: undefined }));

    await store.getState().fireRoute('GET /users', 'GET', '/users');

    expect(store.getState().responses['GET /users']).toMatchObject({ status: 'error', error: { code: 'store-not-wired' } });
  });

  it('rejects with missing-argument when no routes repo was ever loaded', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200 })));
    const store = createAppStore(fakeDeps({ manifest: manifestWithBaseUrl() }));

    await store.getState().fireRoute('GET /users', 'GET', '/users');

    expect(store.getState().responses['GET /users']).toMatchObject({ status: 'error', error: { code: 'missing-argument' } });
  });

  it('surfaces an auth-endpoint failure as the route error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200 })));
    const auth: DevAuthPort = {
      getSession: vi.fn(async () => err('auth-endpoint-failed', 'auth down', { reason: 'HTTP 500' })),
    };
    const store = await loadedStore({ auth });

    await store.getState().fireRoute('GET /users', 'GET', '/users');

    expect(store.getState().responses['GET /users']).toMatchObject({ status: 'error', error: { code: 'auth-endpoint-failed' } });
  });

  it('surfaces a 403 as the distinct auth-forbidden, never as a generic failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('denied', { status: 403 })));
    const store = await loadedStore();

    await store.getState().fireRoute('GET /users', 'GET', '/users');

    expect(store.getState().responses['GET /users']).toMatchObject({ status: 'error', error: { code: 'auth-forbidden' } });
  });

  it('surfaces an unknown route without firing', async () => {
    const fetch = vi.fn(async () => new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const store = await loadedStore();

    await store.getState().fireRoute('DELETE /users', 'DELETE', '/users');

    expect(store.getState().responses['DELETE /users']).toMatchObject({ status: 'error', error: { code: 'unknown-route' } });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('ignores a second fire of the same route while one is in flight, issuing no new fetch or auth call', async () => {
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

    const first = store.getState().fireRoute('GET /users', 'GET', '/users');
    expect(store.getState().responses['GET /users']).toEqual({ status: 'firing' });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await store.getState().fireRoute('GET /users', 'GET', '/users');

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(getSession).toHaveBeenCalledTimes(1);

    release?.(new Response('ok', { status: 200 }));
    await first;

    expect(store.getState().responses['GET /users']).toMatchObject({ status: 'fired', result: { status: 200 } });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(getSession).toHaveBeenCalledTimes(1);
  });

  it('maps a throwing port to a request-failed error instead of staying stuck in firing', async () => {
    const scanner: RouteScannerPort = { scan: vi.fn(async () => ok([{ method: 'GET', path: '/users' }] as Route[])) };
    const store = await loadedStore({ scanner });
    scanner.scan = vi.fn(async () => {
      throw new Error('scanner exploded');
    });

    await store.getState().fireRoute('GET /users', 'GET', '/users');

    expect(store.getState().responses['GET /users']).toMatchObject({ status: 'error', error: { code: 'request-failed' } });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200 })));
    scanner.scan = vi.fn(async () => ok([{ method: 'GET', path: '/users' }] as Route[]));
    await store.getState().fireRoute('GET /users', 'GET', '/users');
    expect(store.getState().responses['GET /users']).toMatchObject({ status: 'fired' });
  });

  it('keeps refusing a duplicate fire even after the firing entry was pruned, and shows Response', async () => {
    let release: ((response: Response) => void) | undefined;
    const fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetch);
    const store = await loadedStore();
    const inFlight = store.getState().fireRoute('GET /users', 'GET', '/users');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    store.setState({ responses: {}, routesPaneTab: 'request' });

    await store.getState().fireRoute('GET /users', 'GET', '/users');

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(store.getState().routesPaneTab).toBe('response');
    release?.(new Response('ok', { status: 200 }));
    await inFlight;
  });

  it('degrades to an explicit error when the scanner is unwired even with auth present, firing nothing', async () => {
    const fetch = vi.fn(async () => new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const store = createAppStore(fakeDeps({ manifest: manifestWithBaseUrl(), scanner: undefined }));

    await store.getState().fireRoute('GET /users', 'GET', '/users');

    expect(store.getState().responses['GET /users']).toMatchObject({ status: 'error', error: { code: 'store-not-wired' } });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps responses and drafts across a same-repo reload (every zone remount)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200 })));
    const store = await loadedStore();
    store.getState().ensureRequestDraft('GET /users', { params: [], query: [{ name: 'q', value: 'x', required: false }], headers: [] });
    store.getState().setRoutesPaneFocus('detail');

    await store.getState().fireRoute('GET /users', 'GET', '/users');
    await store.getState().loadRoutes();

    const state = store.getState();
    expect(state.responses['GET /users']).toMatchObject({ status: 'fired' });
    expect(state.requestDrafts['GET /users']?.query).toHaveLength(1);
    expect(state.routesPaneFocus).toBe('detail');
  });

  it('drops drafts, responses and body drafts and refocuses the list on a reload onto another repo', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200 })));
    const repos = ['/repos/gateway'];
    const registry: RegistryPort = {
      list: vi.fn(async () => ok([...repos])),
      add: vi.fn(async () => ok(undefined)),
      remove: vi.fn(async () => ok(undefined)),
      exists: vi.fn(async () => ok(true)),
      scan: vi.fn(async () => ok({ candidates: [], skipped: [] })),
      reset: vi.fn(async () => ok({ path: '/x', backupPath: null })),
    };
    const store = await loadedStore({ registry });
    store.getState().ensureRequestDraft('GET /users', { params: [], query: [], headers: [] });
    store.getState().ensureBodyDraft('GET /users', { a: 1 });
    store.getState().setRoutesPaneFocus('detail');
    await store.getState().fireRoute('GET /users', 'GET', '/users');

    repos.splice(0, 1, '/repos/other');
    await store.getState().loadRoutes();

    const state = store.getState();
    expect(state.routesRepoPath).toBe('/repos/other');
    expect(state.responses).toEqual({});
    expect(state.requestDrafts).toEqual({});
    expect(state.bodyDrafts).toEqual({});
    expect(state.bodyEditErrors).toEqual({});
    expect(state.routesPaneFocus).toBe('list');
    expect(state.routesPaneTab).toBe('request');
  });

  it('never resurrects a response that lands after a repo switch, even one switched back (A → B → A)', async () => {
    let release: ((response: Response) => void) | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            release = resolve;
          }),
      ),
    );
    const repos = ['/repos/gateway'];
    const registry: RegistryPort = {
      list: vi.fn(async () => ok([...repos])),
      add: vi.fn(async () => ok(undefined)),
      remove: vi.fn(async () => ok(undefined)),
      exists: vi.fn(async () => ok(true)),
      scan: vi.fn(async () => ok({ candidates: [], skipped: [] })),
      reset: vi.fn(async () => ok({ path: '/x', backupPath: null })),
    };
    const store = await loadedStore({ registry });
    const inFlight = store.getState().fireRoute('GET /users', 'GET', '/users');
    await vi.waitFor(() => expect(release).toBeDefined());

    repos.splice(0, 1, '/repos/other');
    await store.getState().loadRoutes();
    repos.splice(0, 1, '/repos/gateway');
    await store.getState().loadRoutes();
    expect(store.getState().routesRepoPath).toBe('/repos/gateway');
    release?.(new Response('late', { status: 200 }));
    await inFlight;

    expect(store.getState().responses).toEqual({});
  });

  it('isolates responses per route', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('denied', { status: 403 })));
    const scanner: RouteScannerPort = {
      scan: vi.fn(async () => ok([{ method: 'GET', path: '/users' }, { method: 'POST', path: '/users' }] as Route[])),
    };
    const store = await loadedStore({ scanner });

    await store.getState().fireRoute('GET /users', 'GET', '/users');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200 })));
    await store.getState().fireRoute('POST /users', 'POST', '/users');

    expect(store.getState().responses['GET /users']).toMatchObject({ status: 'error' });
    expect(store.getState().responses['POST /users']).toMatchObject({ status: 'fired' });
  });

  it('prunes responses and request drafts past the 50 most-recently-touched routes', () => {
    const store = createAppStore();
    for (let index = 0; index < 52; index += 1) {
      store.getState().ensureRequestDraft(`GET /r-${index}`, { params: [], query: [], headers: [] });
    }
    expect(Object.keys(store.getState().requestDrafts)).toHaveLength(50);
    expect(store.getState().requestDrafts['GET /r-0']).toBeUndefined();
    store.getState().ensureRequestDraft('GET /r-2', { params: [{ name: 'x', value: '', required: true }], query: [], headers: [] });
    // A second ensure keeps the existing draft (no reseed) and re-touches it.
    expect(store.getState().requestDrafts['GET /r-2']?.params).toEqual([]);
    expect(Object.keys(store.getState().requestDrafts).at(-1)).toBe('GET /r-2');
  });

  it('prunes responses past the 50 most-recently-fired routes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200 })));
    const routes = Array.from({ length: 52 }, (_, index) => ({ method: 'GET', path: `/r-${index}` }));
    const store = await loadedStore({ scanner: { scan: vi.fn(async () => ok(routes as Route[])) } });

    for (const route of routes) {
      await store.getState().fireRoute(`GET ${route.path}`, 'GET', route.path);
    }

    const responses = store.getState().responses;
    expect(Object.keys(responses)).toHaveLength(50);
    expect(responses['GET /r-0']).toBeUndefined();
    expect(responses['GET /r-1']).toBeUndefined();
    expect(responses['GET /r-51']).toMatchObject({ status: 'fired' });
  });

  it('updates a request draft immutably', () => {
    const store = createAppStore();
    store.getState().ensureRequestDraft('GET /u', { params: [], query: [], headers: [] });
    const before = store.getState().requestDrafts['GET /u'];
    store.getState().updateRequestDraft('GET /u', (previous) => ({ ...previous, headers: [{ name: 'A', value: '1', required: false }] }));
    expect(before?.headers).toEqual([]);
    expect(store.getState().requestDrafts['GET /u']?.headers).toHaveLength(1);
  });
});

describe('routes slice jsonTreeStates', () => {
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

  it('starts with no tree state, no response, the list focused on the Request tab', () => {
    const store = createAppStore(fakeDeps());
    expect(store.getState().jsonTreeStates).toEqual({});
    expect(store.getState().responses).toEqual({});
    expect(store.getState().routesPaneFocus).toBe('list');
    expect(store.getState().routesPaneTab).toBe('request');
  });

  it('keys the tree state on a successful fire', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"id":1}', { status: 200 })));
    const store = await loadedStore();

    await store.getState().fireRoute('GET /users', 'GET', '/users');

    expect(store.getState().jsonTreeStates['GET /users']).toEqual({
      foldedPaths: [],
      hiddenKeys: [],
      onlyKeys: [],
      hideNulls: false,
      selected: 0,
    });
  });

  it('keeps prior key rules and folds on a re-fire of the same route', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"id":1}', { status: 200 })));
    const store = await loadedStore();

    await store.getState().fireRoute('GET /users', 'GET', '/users');
    store.getState().updateJsonTreeState('GET /users', (previous) => ({
      ...previous,
      foldedPaths: ['data'],
      hiddenKeys: ['tags'],
      selected: 3,
    }));

    await store.getState().fireRoute('GET /users', 'GET', '/users');

    expect(store.getState().jsonTreeStates['GET /users']).toMatchObject({
      foldedPaths: ['data'],
      hiddenKeys: ['tags'],
      selected: 3,
    });
  });

  it('starts a different route with fresh tree state (per-route isolation)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200 })));
    const scanner: RouteScannerPort = {
      scan: vi.fn(async () => ok([{ method: 'GET', path: '/users' }, { method: 'POST', path: '/users' }] as Route[])),
    };
    const store = await loadedStore({ scanner });

    await store.getState().fireRoute('GET /users', 'GET', '/users');
    store.getState().updateJsonTreeState('GET /users', (previous) => ({ ...previous, hiddenKeys: ['tags'] }));
    await store.getState().fireRoute('POST /users', 'POST', '/users');

    expect(store.getState().jsonTreeStates['GET /users']).toMatchObject({ hiddenKeys: ['tags'] });
    expect(store.getState().jsonTreeStates['POST /users']).toMatchObject({ hiddenKeys: [] });
  });

  it('keeps tree states across a routes reload', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200 })));
    const store = await loadedStore();

    await store.getState().fireRoute('GET /users', 'GET', '/users');
    store.getState().updateJsonTreeState('GET /users', (previous) => ({ ...previous, hiddenKeys: ['tags'] }));

    await store.getState().loadRoutes();

    expect(store.getState().jsonTreeStates['GET /users']).toMatchObject({ hiddenKeys: ['tags'] });
  });

  it('prunes tree states past the 50 most-recently-touched entries', async () => {
    const store = createAppStore(fakeDeps());
    for (let index = 0; index < 52; index += 1) {
      store.getState().updateJsonTreeState(`GET /r-${index}`, (previous) => previous);
    }
    const states = store.getState().jsonTreeStates;
    expect(Object.keys(states)).toHaveLength(50);
    expect(states['GET /r-0']).toBeUndefined();
    expect(states['GET /r-1']).toBeUndefined();
    expect(states['GET /r-51']).toBeDefined();
  });

  it('re-touching a route keeps it past the prune (recency, not insertion)', async () => {
    const store = createAppStore(fakeDeps());
    for (let index = 0; index < 50; index += 1) {
      store.getState().updateJsonTreeState(`GET /r-${index}`, (previous) => previous);
    }
    store.getState().updateJsonTreeState('GET /r-0', (previous) => previous);
    store.getState().updateJsonTreeState('GET /fresh', (previous) => previous);
    const states = store.getState().jsonTreeStates;
    expect(Object.keys(states)).toHaveLength(50);
    expect(states['GET /r-0']).toBeDefined();
    expect(states['GET /r-1']).toBeUndefined();
    expect(states['GET /fresh']).toBeDefined();
  });
});

describe('routes slice bodyDrafts', () => {
  it('starts with no drafts and no edit errors', () => {
    const store = createAppStore(fakeDeps());
    expect(store.getState().bodyDrafts).toEqual({});
    expect(store.getState().bodyEditErrors).toEqual({});
  });

  it('seeds lazily from the bodyExample on first open and never mutates it afterwards', () => {
    const store = createAppStore(fakeDeps());
    const seed = { name: 'ada', tags: ['x'] };
    store.getState().ensureBodyDraft('POST /users', seed);
    expect(store.getState().bodyDrafts['POST /users']).toEqual({ name: 'ada', tags: ['x'] });
    store.getState().updateBodyDraft('POST /users', () => ({ name: 'grace', tags: ['x'] }));
    expect(store.getState().bodyDrafts['POST /users']).toEqual({ name: 'grace', tags: ['x'] });
    expect(seed).toEqual({ name: 'ada', tags: ['x'] });
  });

  it('keeps the seeded draft on a second open (no reseed)', () => {
    const store = createAppStore(fakeDeps());
    store.getState().ensureBodyDraft('POST /users', { v: 1 });
    store.getState().updateBodyDraft('POST /users', () => ({ v: 2 }));
    store.getState().ensureBodyDraft('POST /users', { v: 1 });
    expect(store.getState().bodyDrafts['POST /users']).toEqual({ v: 2 });
  });

  it('isolates drafts per route', () => {
    const store = createAppStore(fakeDeps());
    store.getState().ensureBodyDraft('POST /a', { v: 1 });
    store.getState().ensureBodyDraft('POST /b', { v: 2 });
    store.getState().updateBodyDraft('POST /a', () => ({ v: 10 }));
    expect(store.getState().bodyDrafts['POST /a']).toEqual({ v: 10 });
    expect(store.getState().bodyDrafts['POST /b']).toEqual({ v: 2 });
  });

  it('tracks per-path errors and clears them individually or wholesale', () => {
    const store = createAppStore(fakeDeps());
    store.getState().ensureBodyDraft('POST /users', { age: 36 });
    store.getState().setBodyEditError('POST /users', 'age', { reason: 'expected a number, got "x"', kind: 'number' });
    expect(store.getState().bodyEditErrors['POST /users']).toEqual({ age: { reason: 'expected a number, got "x"', kind: 'number' } });
    store.getState().setBodyEditError('POST /users', 'age', null);
    expect(store.getState().bodyEditErrors['POST /users']).toEqual({});
    store.getState().setBodyEditError('POST /users', 'age', { reason: 'bad', kind: 'string' });
    store.getState().setBodyEditErrors('POST /users', {});
    expect(store.getState().bodyEditErrors['POST /users']).toEqual({});
  });

  it('prunes drafts past the 50 most-recently-touched entries with errors aligned', () => {
    const store = createAppStore(fakeDeps());
    for (let index = 0; index < 52; index += 1) {
      store.getState().ensureBodyDraft(`POST /r-${index}`, { index });
    }
    const drafts = store.getState().bodyDrafts;
    expect(Object.keys(drafts)).toHaveLength(50);
    expect(drafts['POST /r-0']).toBeUndefined();
    expect(drafts['POST /r-51']).toBeDefined();
    expect(store.getState().bodyEditErrors['POST /r-0']).toBeUndefined();
  });

  it('re-touching a draft keeps it past the prune', () => {
    const store = createAppStore(fakeDeps());
    for (let index = 0; index < 50; index += 1) {
      store.getState().ensureBodyDraft(`POST /r-${index}`, { index });
    }
    store.getState().updateBodyDraft('POST /r-0', (previous) => previous);
    store.getState().ensureBodyDraft('POST /fresh', {});
    const drafts = store.getState().bodyDrafts;
    expect(Object.keys(drafts)).toHaveLength(50);
    expect(drafts['POST /r-0']).toBeDefined();
    expect(drafts['POST /r-1']).toBeUndefined();
  });

  it('preserves drafts and errors across a successful routes reload', async () => {
    const scanner: RouteScannerPort = { scan: vi.fn(async () => ok([{ method: 'POST', path: '/users' }] as Route[])) };
    const manifest: ManifestPort = {
      load: vi.fn(async () => ok(manifestFor('gateway', { 'route-explorer': {} }))),
    };
    const store = createAppStore(fakeDeps({ scanner, manifest }));
    await store.getState().loadRoutes();
    store.getState().ensureBodyDraft('POST /users', { v: 1 });
    store.getState().setBodyEditError('POST /users', 'v', { reason: 'bad', kind: 'number' });
    await store.getState().loadRoutes();
    expect(store.getState().bodyDrafts['POST /users']).toEqual({ v: 1 });
    expect(store.getState().bodyEditErrors['POST /users']).toEqual({ v: { reason: 'bad', kind: 'number' } });
  });
});

describe('routes slice saved requests', () => {
  function fakeSavedRequests(seed: SavedRequest[] = []): SavedRequestPort {
    const rows = new Map(seed.map((item) => [item.name, { ...item }]));
    return {
      save: async (request) => {
        if (rows.has(request.name)) {
          return err('duplicate-request-name', `A request named "${request.name}" already exists`);
        }
        rows.set(request.name, { ...request });
        return ok({ ...request });
      },
      overwrite: async (name, request) => {
        const existing = rows.get(name);
        if (existing === undefined) {
          return err('saved-request-not-found', `No saved request named "${name}"`);
        }
        const next = { ...request, id: existing.id, createdAt: existing.createdAt, name };
        rows.set(name, next);
        return ok({ ...next });
      },
      get: async (name) => {
        const found = rows.get(name);
        return found === undefined ? err('saved-request-not-found', `No saved request named "${name}"`) : ok({ ...found });
      },
      list: async () => ok([...rows.values()].map((item) => ({ ...item }))),
      remove: async (name) => (rows.delete(name) ? ok(undefined) : err('saved-request-not-found', `No saved request named "${name}"`)),
    };
  }

  function manifestWithRoutes(): ManifestPort {
    return { load: vi.fn(async () => ok(manifestFor('gateway', { 'route-explorer': {} }))) };
  }

  async function loadedStore(savedRequests: SavedRequestPort) {
    const store = createAppStore(fakeDeps({ manifest: manifestWithRoutes(), savedRequests }));
    await store.getState().loadRoutes();
    expect(store.getState().routesStatus).toBe('ready');
    return store;
  }

  it('starts with no origins and no cached library', () => {
    const store = createAppStore(fakeDeps());
    expect(store.getState().draftOrigins).toEqual({});
    expect(store.getState().savedRequests).toBeNull();
    expect(store.getState().savedRequestsError).toBeNull();
  });

  it('saves the live draft and links the route origin to the new record', async () => {
    const store = await loadedStore(fakeSavedRequests());
    store.getState().ensureRequestDraft('GET /users', { params: [], query: [{ name: 'q', value: 'x', required: false }], headers: [] });

    const result = await store.getState().saveRequestDraft('list-users', 'GET /users');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(store.getState().draftOrigins['GET /users']).toBe(result.data.id);
      expect(result.data.query).toEqual({ q: 'x' });
    }
  });

  it('rejects a colliding name without overwriting, then overwrites through the flag', async () => {
    const store = await loadedStore(fakeSavedRequests());
    store.getState().ensureRequestDraft('GET /users', { params: [], query: [], headers: [] });
    expect((await store.getState().saveRequestDraft('taken', 'GET /users')).ok).toBe(true);

    store.getState().updateRequestDraft('GET /users', (previous) => ({
      ...previous,
      query: [{ name: 'q', value: 'v2', required: false }],
    }));
    const collision = await store.getState().saveRequestDraft('taken', 'GET /users');
    expect(collision).toMatchObject({ ok: false, error: { code: 'duplicate-request-name' } });

    const overwritten = await store.getState().saveRequestDraft('taken', 'GET /users', { overwrite: true });
    expect(overwritten.ok).toBe(true);
    if (overwritten.ok) {
      expect(overwritten.data.query).toEqual({ q: 'v2' });
    }
  });

  it('degrades to store-not-wired when no saved-request store was injected', async () => {
    const store = createAppStore(fakeDeps({ manifest: manifestWithRoutes() }));
    await store.getState().loadRoutes();

    expect(await store.getState().saveRequestDraft('x', 'GET /users')).toMatchObject({
      ok: false,
      error: { code: 'store-not-wired' },
    });
    expect(await store.getState().loadSavedRequest('x')).toMatchObject({ ok: false, error: { code: 'store-not-wired' } });
    expect(await store.getState().deleteSavedRequest('x')).toMatchObject({ ok: false, error: { code: 'store-not-wired' } });

    await store.getState().refreshSavedRequests();
    expect(store.getState().savedRequestsError).toMatchObject({ code: 'store-not-wired' });
  });

  it('loads a record back into the draft, the body draft, the tree state and the origin link', async () => {
    const seed: SavedRequest = {
      id: 'id-1',
      name: 'filtered',
      repoPath: '/repos/gateway',
      method: 'GET',
      path: '/users',
      query: { q: 'saved' },
      headers: { 'X-Trace': 't1' },
      createdAt: '2026-10-06T00:00:00.000Z',
      updatedAt: '2026-10-06T00:00:00.000Z',
    };
    const store = await loadedStore(fakeSavedRequests([seed]));

    const result = await store.getState().loadSavedRequest('filtered');

    expect(result).toEqual({ ok: true, data: undefined });
    expect(store.getState().requestDrafts['GET /users']?.query).toEqual([{ name: 'q', value: 'saved', required: false }]);
    expect(store.getState().requestDrafts['GET /users']?.headers).toEqual([{ name: 'X-Trace', value: 't1', required: false }]);
    expect(store.getState().draftOrigins['GET /users']).toBe('id-1');
  });

  it('reports saved-request-not-found when loading or deleting an unknown name', async () => {
    const store = await loadedStore(fakeSavedRequests());

    expect(await store.getState().loadSavedRequest('missing')).toMatchObject({
      ok: false,
      error: { code: 'saved-request-not-found' },
    });
    expect(await store.getState().deleteSavedRequest('missing')).toMatchObject({
      ok: false,
      error: { code: 'saved-request-not-found' },
    });
  });

  it('delete unlinks every draft origin pointing at the removed record', async () => {
    const seed: SavedRequest = {
      id: 'id-9',
      name: 'old',
      repoPath: '/repos/gateway',
      method: 'GET',
      path: '/users',
      createdAt: '2026-10-06T00:00:00.000Z',
      updatedAt: '2026-10-06T00:00:00.000Z',
    };
    const store = await loadedStore(fakeSavedRequests([seed]));
    await store.getState().loadSavedRequest('old');
    expect(store.getState().draftOrigins['GET /users']).toBe('id-9');

    expect(await store.getState().deleteSavedRequest('old')).toEqual({ ok: true, data: undefined });
    expect(store.getState().draftOrigins).toEqual({});
  });

  it('refreshes the library cache with advisory stale flags', async () => {
    const seed: SavedRequest = {
      id: 'id-1',
      name: 'gone',
      repoPath: '/repos/gateway',
      method: 'GET',
      path: '/vanished',
      createdAt: '2026-10-06T00:00:00.000Z',
      updatedAt: '2026-10-06T00:00:00.000Z',
    };
    const store = await loadedStore(fakeSavedRequests([seed]));

    await store.getState().refreshSavedRequests();

    expect(store.getState().savedRequestsError).toBeNull();
    expect(store.getState().savedRequests).toMatchObject([{ name: 'gone', stale: true }]);
  });

  it('keeps origins across a same-repo reload and drops them on a repo switch', async () => {
    const repos = ['/repos/gateway'];
    const registry: RegistryPort = {
      list: vi.fn(async () => ok([...repos])),
      add: vi.fn(async () => ok(undefined)),
      remove: vi.fn(async () => ok(undefined)),
      exists: vi.fn(async () => ok(true)),
      scan: vi.fn(async () => ok({ candidates: [], skipped: [] })),
      reset: vi.fn(async () => ok({ path: '/x', backupPath: null })),
    };
    const store = createAppStore(fakeDeps({ manifest: manifestWithRoutes(), savedRequests: fakeSavedRequests(), registry }));
    await store.getState().loadRoutes();
    expect(store.getState().routesStatus).toBe('ready');
    store.getState().ensureRequestDraft('GET /users', { params: [], query: [], headers: [] });
    await store.getState().saveRequestDraft('keep-me', 'GET /users');

    await store.getState().loadRoutes();
    expect(store.getState().draftOrigins['GET /users']).toBeDefined();

    repos.splice(0, 1, '/repos/other');
    await store.getState().loadRoutes();
    expect(store.getState().draftOrigins).toEqual({});
  });

  it('prunes origins past the 50 most-recently-touched routes', async () => {
    const store = await loadedStore(fakeSavedRequests());
    for (let index = 0; index < 52; index += 1) {
      store.getState().ensureRequestDraft(`GET /r-${index}`, { params: [], query: [], headers: [] });
      const saved = await store.getState().saveRequestDraft(`req-${index}`, `GET /r-${index}`);
      expect(saved.ok).toBe(true);
    }
    const origins = store.getState().draftOrigins;
    expect(Object.keys(origins)).toHaveLength(50);
    expect(origins['GET /r-0']).toBeUndefined();
    expect(origins['GET /r-1']).toBeUndefined();
    expect(origins['GET /r-51']).toBeDefined();
  });
});

describe('routes slice saved-request cache and guards', () => {
  function fakeSavedRequests(seed: SavedRequest[] = []): SavedRequestPort {
    const rows = new Map(seed.map((item) => [item.name, { ...item }]));
    return {
      save: async (request) => {
        if (rows.has(request.name)) {
          return err('duplicate-request-name', `A request named "${request.name}" already exists`);
        }
        rows.set(request.name, { ...request });
        return ok({ ...request });
      },
      overwrite: async (name, request) => {
        const existing = rows.get(name);
        if (existing === undefined) {
          return err('saved-request-not-found', `No saved request named "${name}"`);
        }
        const next = { ...request, id: existing.id, createdAt: existing.createdAt, name };
        rows.set(name, next);
        return ok({ ...next });
      },
      get: async (name) => {
        const found = rows.get(name);
        return found === undefined ? err('saved-request-not-found', `No saved request named "${name}"`) : ok({ ...found });
      },
      list: async () => ok([...rows.values()].map((item) => ({ ...item }))),
      remove: async (name) => (rows.delete(name) ? ok(undefined) : err('saved-request-not-found', `No saved request named "${name}"`)),
    };
  }

  function manifestWithRoutes(): ManifestPort {
    return { load: vi.fn(async () => ok(manifestFor('gateway', { 'route-explorer': {} }))) };
  }

  async function loadedStore(savedRequests: SavedRequestPort) {
    const store = createAppStore(fakeDeps({ manifest: manifestWithRoutes(), savedRequests }));
    await store.getState().loadRoutes();
    expect(store.getState().routesStatus).toBe('ready');
    return store;
  }

  function seedCache(store: ReturnType<typeof createAppStore>) {
    store.setState({
      savedRequests: [
        {
          id: 'id-cached',
          name: 'cached',
          repoPath: '/repos/gateway',
          method: 'GET',
          path: '/users',
          query: { q: 'old' },
          createdAt: '2026-10-06T00:00:00.000Z',
          updatedAt: '2026-10-06T00:00:00.000Z',
          stale: false,
        },
      ],
    });
  }

  it('appends a fresh save to the picker cache without a refresh', async () => {
    const store = await loadedStore(fakeSavedRequests());
    seedCache(store);
    store.getState().ensureRequestDraft('GET /users', { params: [], query: [], headers: [] });

    expect((await store.getState().saveRequestDraft('brand-new', 'GET /users')).ok).toBe(true);

    const names = (store.getState().savedRequests ?? []).map((item) => item.name);
    expect(names).toEqual(['cached', 'brand-new']);
  });

  it('replaces the same-name cache entry on overwrite', async () => {
    const seed: SavedRequest = {
      id: 'id-1',
      name: 'cached',
      repoPath: '/repos/gateway',
      method: 'GET',
      path: '/users',
      query: { q: 'old' },
      createdAt: '2026-10-06T00:00:00.000Z',
      updatedAt: '2026-10-06T00:00:00.000Z',
    };
    const store = await loadedStore(fakeSavedRequests([seed]));
    seedCache(store);
    store.getState().ensureRequestDraft('GET /users', {
      params: [],
      query: [{ name: 'q', value: 'new', required: false }],
      headers: [],
    });

    expect((await store.getState().saveRequestDraft('cached', 'GET /users', { overwrite: true })).ok).toBe(true);

    expect(store.getState().savedRequests).toMatchObject([{ name: 'cached', query: { q: 'new' }, stale: false }]);
  });

  it('rejects a corrupt body without touching the live drafts', async () => {
    const seed: SavedRequest = {
      id: 'id-1',
      name: 'broken-body',
      repoPath: '/repos/gateway',
      method: 'GET',
      path: '/users',
      bodyText: '{ nope',
      createdAt: '2026-10-06T00:00:00.000Z',
      updatedAt: '2026-10-06T00:00:00.000Z',
    };
    const store = await loadedStore(fakeSavedRequests([seed]));
    const before = store.getState().requestDrafts;

    const result = await store.getState().loadSavedRequest('broken-body');

    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
    expect(store.getState().requestDrafts).toBe(before);
    expect(store.getState().draftOrigins).toEqual({});
  });

  it('rejects an unrecognized tree state without touching the live drafts', async () => {
    const seed: SavedRequest = {
      id: 'id-1',
      name: 'broken-tree',
      repoPath: '/repos/gateway',
      method: 'GET',
      path: '/users',
      treeState: { bogus: true },
      createdAt: '2026-10-06T00:00:00.000Z',
      updatedAt: '2026-10-06T00:00:00.000Z',
    };
    const store = await loadedStore(fakeSavedRequests([seed]));
    store.getState().ensureRequestDraft('GET /users', { params: [], query: [], headers: [] });
    const before = store.getState().requestDrafts['GET /users'];

    const result = await store.getState().loadSavedRequest('broken-tree');

    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
    expect(store.getState().requestDrafts['GET /users']).toBe(before);
    expect(store.getState().draftOrigins).toEqual({});
  });

  it('rejects blank names and trims padded ones on load and delete', async () => {
    const seed: SavedRequest = {
      id: 'id-1',
      name: 'padded',
      repoPath: '/repos/gateway',
      method: 'GET',
      path: '/users',
      createdAt: '2026-10-06T00:00:00.000Z',
      updatedAt: '2026-10-06T00:00:00.000Z',
    };
    const store = await loadedStore(fakeSavedRequests([seed]));

    expect(await store.getState().loadSavedRequest('   ')).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
    expect(await store.getState().deleteSavedRequest('')).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
    expect((await store.getState().loadSavedRequest('  padded  ')).ok).toBe(true);
    expect((await store.getState().deleteSavedRequest('  padded  ')).ok).toBe(true);
  });
});
