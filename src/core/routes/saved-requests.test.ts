// core/routes/saved-requests: unit tests against a fake port + stub fetch — no real sqlite,
// no live servers. Covers the save/overwrite/save-as matrix, stale advisory flags, the
// fire-time hard gate, unknown names and cookie hygiene.
import { describe, expect, it, vi } from 'vitest';
import { err, ok, type Result } from '../result.js';
import type { DevAuthPort } from '../ports/dev-auth.js';
import type { Manifest, ManifestPort } from '../ports/manifest.js';
import type { Route, RouteScannerPort } from '../ports/route-scanner.js';
import type { SavedRequest, SavedRequestInput, SavedRequestPort } from '../ports/saved-request.js';
import { deleteSavedRequest, fireSavedRequest, listSavedRequests, overwriteSavedRequest, saveRequest } from './saved-requests.js';

function manifestOk(modules: Manifest['modules'] = { 'route-explorer': { baseUrl: 'http://localhost:3000' } }): ManifestPort {
  return { load: async () => ok({ service: 'gw', container: 'gw', sharedBranch: 'development', modules }) };
}

function scannerOk(routes: Route[] = [{ method: 'GET', path: '/users' }]): RouteScannerPort {
  return { scan: async () => ok(routes) };
}

function authOk(cookie = 'sid=abc'): DevAuthPort {
  return { getSession: async () => ok({ cookie }) };
}

function fakeStore(seed: SavedRequest[] = []): SavedRequestPort & { rows: Map<string, SavedRequest> } {
  const rows = new Map(seed.map((item) => [item.name, { ...item }]));
  return {
    rows,
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

function seedInput(overrides: Partial<SavedRequestInput> = {}): SavedRequestInput {
  return { name: 'list-users', repoPath: '/repos/gateway', method: 'GET', path: '/users', ...overrides };
}

function jsonResponse(status: number, body: string): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/plain' } });
}

describe('saveRequest', () => {
  it('saves a fresh name with an id and timestamps', async () => {
    const store = fakeStore();
    const result = await saveRequest({ store }, seedInput());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
      expect(result.data.createdAt).not.toBe('');
      expect(result.data.updatedAt).toBe(result.data.createdAt);
    }
  });

  it('rejects a colliding name with duplicate-request-name and keeps the original', async () => {
    const store = fakeStore();
    expect((await saveRequest({ store }, seedInput())).ok).toBe(true);
    const second = await saveRequest({ store }, seedInput({ method: 'POST' }));
    expect(second).toMatchObject({ ok: false, error: { code: 'duplicate-request-name' } });
    const kept = await store.get('list-users');
    expect(kept).toMatchObject({ ok: true, data: { method: 'GET' } });
  });

  it('rejects a missing or blank name before touching the store', async () => {
    const save = vi.fn(async (request: SavedRequest) => ok(request));
    const store: SavedRequestPort = { ...fakeStore(), save };
    expect(await saveRequest({ store }, seedInput({ name: '' }))).toMatchObject({ ok: false, error: { code: 'missing-argument' } });
    expect(await saveRequest({ store }, seedInput({ name: '   ' }))).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
    expect(save).not.toHaveBeenCalled();
  });

  it('drops empty query/header values and never persists cookie material', async () => {
    const store = fakeStore();
    const result = await saveRequest(
      { store },
      seedInput({
        query: { q: 'x', empty: '  ' },
        headers: { 'X-Trace': 't1', Cookie: 'sid=forged', 'Set-Cookie': 'sid=other', blank: '' },
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.query).toEqual({ q: 'x' });
      expect(result.data.headers).toEqual({ 'X-Trace': 't1' });
    }
  });
});

describe('overwriteSavedRequest', () => {
  it('updates the original in place, keeping the id and bumping updatedAt', async () => {
    const store = fakeStore();
    const first = await saveRequest({ store }, seedInput({ query: { q: 'a' } }));
    expect(first.ok).toBe(true);
    const before = first.ok ? first.data : null;
    const result = await overwriteSavedRequest({ store }, 'list-users', seedInput({ query: { q: 'b' } }));
    expect(result.ok).toBe(true);
    if (result.ok && before !== null) {
      expect(result.data.id).toBe(before.id);
      expect(result.data.query).toEqual({ q: 'b' });
    }
  });

  it('fails with saved-request-not-found for an unknown name', async () => {
    expect(await overwriteSavedRequest({ store: fakeStore() }, 'missing', seedInput())).toMatchObject({
      ok: false,
      error: { code: 'saved-request-not-found' },
    });
  });
});

describe('deleteSavedRequest', () => {
  it('removes the record; a second remove reports saved-request-not-found', async () => {
    const store = fakeStore();
    await saveRequest({ store }, seedInput());
    expect(await deleteSavedRequest({ store }, 'list-users')).toEqual({ ok: true, data: undefined });
    expect(await deleteSavedRequest({ store }, 'list-users')).toMatchObject({ ok: false, error: { code: 'saved-request-not-found' } });
  });
});

describe('listSavedRequests', () => {
  function stored(name: string, path: string, repoPath = '/repos/gateway'): SavedRequest {
    return { id: `id-${name}`, name, repoPath, method: 'GET', path, createdAt: '2026-10-06T00:00:00.000Z', updatedAt: '2026-10-06T00:00:00.000Z' };
  }

  it('flags a request stale when a rescan dropped its route, never auto-deleting it', async () => {
    const store = fakeStore([stored('gone', '/vanished'), stored('kept', '/users')]);
    const result = await listSavedRequests({ store, manifest: manifestOk(), scanner: scannerOk() });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.requests.find((item) => item.name === 'gone')).toMatchObject({ stale: true });
      expect(result.data.requests.find((item) => item.name === 'kept')).toMatchObject({ stale: false });
      expect(await store.get('gone')).toMatchObject({ ok: true });
    }
  });

  it('matches a concrete saved path against a templated route (the fire-time rule)', async () => {
    const store = fakeStore([stored('one-user', '/users/42')]);
    const scanner = scannerOk([{ method: 'GET', path: '/users/{id}' }]);
    const result = await listSavedRequests({ store, manifest: manifestOk(), scanner });
    expect(result).toMatchObject({ ok: true, data: { requests: [{ name: 'one-user', stale: false }] } });
  });

  it('fails open (stale false) when the scan itself fails, leaving the hard gate to fire time', async () => {
    const store = fakeStore([stored('maybe', '/users')]);
    const scanner: RouteScannerPort = { scan: async () => err('route-scan-failed', 'bad spec') };
    const result = await listSavedRequests({ store, manifest: manifestOk(), scanner });
    expect(result).toMatchObject({ ok: true, data: { requests: [{ name: 'maybe', stale: false }] } });
  });

  it('filters by repoPath when asked', async () => {
    const store = fakeStore([stored('a', '/users', '/repos/a'), stored('b', '/users', '/repos/b')]);
    const result = await listSavedRequests({ store }, { repoPath: '/repos/b' });
    expect(result).toMatchObject({ ok: true, data: { requests: [{ name: 'b' }] } });
  });
});

describe('fireSavedRequest', () => {
  function stored(name = 'list-users', overrides: Partial<SavedRequest> = {}): SavedRequest {
    return {
      id: 'id-1',
      name,
      repoPath: '/repos/gateway',
      method: 'GET',
      path: '/users',
      createdAt: '2026-10-06T00:00:00.000Z',
      updatedAt: '2026-10-06T00:00:00.000Z',
      ...overrides,
    };
  }

  function deps(store: SavedRequestPort, fetchFn?: typeof fetch) {
    return { store, manifest: manifestOk(), scanner: scannerOk(), auth: authOk(), ...(fetchFn === undefined ? {} : { fetchFn }) };
  }

  it('fires the saved method + path with the session cookie', async () => {
    const calls: string[] = [];
    const fetchFn = (async (input: string | URL | Request) => {
      calls.push(String(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url));
      return jsonResponse(200, 'ok');
    }) as typeof fetch;
    const store = fakeStore([stored()]);
    const result = await fireSavedRequest(deps(store, fetchFn), 'list-users');
    expect(result).toMatchObject({ ok: true, data: { status: 200 } });
    expect(calls).toEqual(['http://localhost:3000/users']);
  });

  it('rejects a stale request at fire time with unknown-route, sending nothing', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, 'ok'));
    const store = fakeStore([stored('gone', { path: '/vanished' })]);
    const result = await fireSavedRequest(deps(store, fetchFn as unknown as typeof fetch), 'gone');
    expect(result).toMatchObject({ ok: false, error: { code: 'unknown-route' } });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(await store.get('gone')).toMatchObject({ ok: true });
  });

  it('reports saved-request-not-found for an unknown name without firing', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, 'ok'));
    const result = await fireSavedRequest(deps(fakeStore(), fetchFn as unknown as typeof fetch), 'missing');
    expect(result).toMatchObject({ ok: false, error: { code: 'saved-request-not-found' } });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('applies CLI overrides on top of the saved record', async () => {
    let seenUrl = '';
    const fetchFn = (async (input: string | URL | Request) => {
      seenUrl = String(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
      return jsonResponse(200, 'ok');
    }) as typeof fetch;
    const store = fakeStore([stored('filtered', { query: { q: 'saved' } })]);
    const result = await fireSavedRequest(deps(store, fetchFn), 'filtered', { query: { page: '2' } });
    expect(result.ok).toBe(true);
    expect(seenUrl).toBe('http://localhost:3000/users?q=saved&page=2');
  });

  it('persists overrides back on --overwrite and creates a new record on --save-as', async () => {
    const fetchFn = (async () => jsonResponse(200, 'ok')) as typeof fetch;
    const store = fakeStore([stored('base', { query: { q: 'a' } })]);
    const overwritten = await fireSavedRequest(deps(store, fetchFn), 'base', { query: { q: 'b' } }, { overwrite: true });
    expect(overwritten.ok).toBe(true);
    expect(await store.get('base')).toMatchObject({ ok: true, data: { query: { q: 'b' } } });

    const savedAs = await fireSavedRequest(deps(store, fetchFn), 'base', { query: { q: 'c' } }, { saveAs: 'base-copy' });
    expect(savedAs.ok).toBe(true);
    expect(await store.get('base-copy')).toMatchObject({ ok: true, data: { query: { q: 'c' } } });
    expect(await store.get('base')).toMatchObject({ ok: true, data: { query: { q: 'b' } } });
  });

  it('rejects a colliding --save-as with duplicate-request-name before firing', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, 'ok'));
    const store = fakeStore([stored('base'), stored('taken')]);
    const result = await fireSavedRequest(deps(store, fetchFn as unknown as typeof fetch), 'base', {}, { saveAs: 'taken' });
    expect(result).toMatchObject({ ok: false, error: { code: 'duplicate-request-name' } });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('rejects --overwrite together with --save-as as invalid-argument', async () => {
    const store = fakeStore([stored()]);
    const result = await fireSavedRequest(deps(store), 'list-users', {}, { overwrite: true, saveAs: 'other' });
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
  });

  it('passes the store failure through verbatim', async () => {
    const broken: SavedRequestPort = {
      ...fakeStore(),
      get: async () => err('saved-request-store-error', 'disk full'),
    };
    const result = await fireSavedRequest(deps(broken), 'list-users');
    expect(result).toMatchObject({ ok: false, error: { code: 'saved-request-store-error' } });
  });
});

describe('name trimming', () => {
  it('stores and looks up names trimmed, so " x " is the same record as "x"', async () => {
    const store = fakeStore();
    const saved = await saveRequest({ store }, seedInput({ name: '  spaced  ' }));
    expect(saved).toMatchObject({ ok: true, data: { name: 'spaced' } });
    expect(await store.get('spaced')).toMatchObject({ ok: true });
    expect(await deleteSavedRequest({ store }, '  spaced  ')).toEqual({ ok: true, data: undefined });
    expect(await store.get('spaced')).toMatchObject({ ok: false, error: { code: 'saved-request-not-found' } });
  });

  it('overwrite and fire resolve padded names to the stored record', async () => {
    const store = fakeStore();
    await saveRequest({ store }, seedInput({ name: 'target' }));
    expect((await overwriteSavedRequest({ store }, '  target  ', seedInput({ name: 'other' }))).ok).toBe(true);
    expect(await store.get('target')).toMatchObject({ ok: true, data: { name: 'target' } });
  });
});

describe('listSavedRequests filters', () => {
  it('rejects a non-string repoPath with invalid-argument instead of throwing', async () => {
    const store = fakeStore();
    const result = await listSavedRequests({ store }, { repoPath: 42 as unknown as string });
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
  });

  it('fails open with stale:false when the manifest cannot even be loaded', async () => {
    const stored: SavedRequest = {
      id: 'id-1',
      name: 'kept',
      repoPath: '/repos/gateway',
      method: 'GET',
      path: '/users',
      createdAt: '2026-10-06T00:00:00.000Z',
      updatedAt: '2026-10-06T00:00:00.000Z',
    };
    const store = fakeStore([stored]);
    const manifest: ManifestPort = { load: async () => err('manifest-not-found', 'no manifest') };
    const result = await listSavedRequests({ store, manifest, scanner: scannerOk() });
    expect(result).toMatchObject({ ok: true, data: { requests: [{ name: 'kept', stale: false }] } });
  });

  it('flags per repo: repo A keeps the route while repo B drops it', async () => {
    const a: SavedRequest = {
      id: 'id-a',
      name: 'a-users',
      repoPath: '/repos/a',
      method: 'GET',
      path: '/users',
      createdAt: '2026-10-06T00:00:00.000Z',
      updatedAt: '2026-10-06T00:00:00.000Z',
    };
    const b: SavedRequest = { ...a, id: 'id-b', name: 'b-users', repoPath: '/repos/b' };
    const store = fakeStore([a, b]);
    const manifest: ManifestPort = {
      load: async () => ok({ service: 'gw', container: 'gw', sharedBranch: 'development', modules: { 'route-explorer': { baseUrl: 'http://x' } } }),
    };
    const scanner: RouteScannerPort = {
      scan: async (repoPath: string) =>
        repoPath === '/repos/a' ? ok([{ method: 'GET', path: '/users' }]) : ok([{ method: 'GET', path: '/other' }]),
    };
    const result = await listSavedRequests({ store, manifest, scanner });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.requests.find((item) => item.name === 'a-users')).toMatchObject({ stale: false });
      expect(result.data.requests.find((item) => item.name === 'b-users')).toMatchObject({ stale: true });
    }
  });
});

describe('sanitize and merge defenses', () => {
  it('skips non-string query/header entries instead of throwing', async () => {
    const store = fakeStore();
    const result = await saveRequest(
      { store },
      seedInput({ query: { q: 'x', bad: 42 as unknown as string }, headers: { 'X-T': 't', odd: null as unknown as string } }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.query).toEqual({ q: 'x' });
      expect(result.data.headers).toEqual({ 'X-T': 't' });
    }
  });

  it('an override header wins case-insensitively without duplicating the saved one', async () => {
    const seen: Array<Record<string, string> | undefined> = [];
    const fetchFn = (async (_input: string | URL | Request, init?: RequestInit) => {
      seen.push(init?.headers === undefined ? undefined : Object.fromEntries(new Headers(init.headers).entries()));
      return jsonResponse(200, 'ok');
    }) as typeof fetch;
    const stored: SavedRequest = {
      id: 'id-1',
      name: 'cased',
      repoPath: '/repos/gateway',
      method: 'GET',
      path: '/users',
      headers: { 'X-Trace': 'saved' },
      createdAt: '2026-10-06T00:00:00.000Z',
      updatedAt: '2026-10-06T00:00:00.000Z',
    };
    const store = fakeStore([stored]);
    const result = await fireSavedRequest(
      { store, manifest: manifestOk(), scanner: scannerOk(), auth: authOk(), fetchFn },
      'cased',
      { headers: { 'x-trace': 'override' } },
    );
    expect(result.ok).toBe(true);
    expect(seen[0]?.['x-trace']).toBe('override');
    expect(Object.keys(seen[0] ?? {}).filter((key) => key.toLowerCase() === 'x-trace')).toHaveLength(1);
  });
});

describe('fireSavedRequest persist-back', () => {
  function storedRecord(overrides: Partial<SavedRequest> = {}): SavedRequest {
    return {
      id: 'id-1',
      name: 'with-body',
      repoPath: '/repos/gateway',
      method: 'POST',
      path: '/users',
      bodyText: '{"a":1}',
      contentType: 'application/json',
      treeState: { selected: 3 },
      createdAt: '2026-10-06T00:00:00.000Z',
      updatedAt: '2026-10-06T00:00:00.000Z',
      ...overrides,
    };
  }

  function postDeps(store: SavedRequestPort) {
    return {
      store,
      manifest: manifestOk(),
      scanner: scannerOk([{ method: 'POST', path: '/users' }]),
      auth: authOk(),
      fetchFn: (async () => jsonResponse(200, 'ok')) as typeof fetch,
    };
  }

  it('an overridden body is stored as JSON with a JSON content type and the tree state carried', async () => {
    const store = fakeStore([storedRecord({ contentType: 'application/merge-patch+json' })]);
    const result = await fireSavedRequest(postDeps(store), 'with-body', { body: { b: 2 } }, { overwrite: true });
    expect(result.ok).toBe(true);
    expect(await store.get('with-body')).toMatchObject({
      ok: true,
      data: { bodyText: '{"b":2}', contentType: 'application/json', treeState: { selected: 3 } },
    });
  });

  it('a save-as-new carries the tree state and the overridden JSON content type', async () => {
    const store = fakeStore([storedRecord()]);
    const result = await fireSavedRequest(postDeps(store), 'with-body', { body: { b: 2 } }, { saveAs: 'copy' });
    expect(result.ok).toBe(true);
    expect(await store.get('copy')).toMatchObject({
      ok: true,
      data: { bodyText: '{"b":2}', contentType: 'application/json', treeState: { selected: 3 } },
    });
  });

  it('reports the fire outcome in the error details when the follow-up persist fails', async () => {
    const broken: SavedRequestPort = {
      ...fakeStore([storedRecord()]),
      overwrite: async () => err('saved-request-store-error', 'disk full', { reason: 'ENOSPC' }),
    };
    const result = await fireSavedRequest(postDeps(broken), 'with-body', { query: { q: '2' } }, { overwrite: true });
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'saved-request-store-error',
        message: 'disk full',
        details: { reason: 'ENOSPC', fired: true, status: 200 },
      },
    });
  });
});

describe('fireSavedRequest content-type hygiene', () => {
  it('drops a leftover content type when the persisted body is empty', async () => {
    const stored: SavedRequest = {
      id: 'id-1',
      name: 'typeless',
      repoPath: '/repos/gateway',
      method: 'GET',
      path: '/users',
      contentType: 'application/json',
      createdAt: '2026-10-06T00:00:00.000Z',
      updatedAt: '2026-10-06T00:00:00.000Z',
    };
    const store = fakeStore([stored]);
    const result = await fireSavedRequest(
      {
        store,
        manifest: manifestOk(),
        scanner: scannerOk(),
        auth: authOk(),
        fetchFn: (async () => jsonResponse(200, 'ok')) as typeof fetch,
      },
      'typeless',
      {},
      { overwrite: true },
    );
    expect(result.ok).toBe(true);
    const reloaded = await store.get('typeless');
    expect(reloaded.ok).toBe(true);
    if (reloaded.ok) {
      expect(reloaded.data.bodyText).toBeUndefined();
      expect(reloaded.data.contentType).toBeUndefined();
    }
  });
});
