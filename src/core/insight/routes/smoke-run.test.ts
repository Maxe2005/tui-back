import { describe, expect, it } from 'vitest';
import { err, ok } from '../../result.js';
import type { Route } from '../../ports/modules/route-scanner.js';
import { defaultSmokeDraft, smokeRunFavorites, smokeRunFailed, type SmokeRowUpdate, type SmokeRunDeps } from './smoke-run.js';

const REPO = '/repos/a';
const fav = (method: string, path: string, repoPath = REPO) => ({ repoPath, method, path });

function setup(opts: {
  favorites?: ReturnType<typeof fav>[];
  routes?: Route[];
  respond?: (method: string, url: string) => Response | Error;
}) {
  const favorites = opts.favorites ?? [];
  const routes = opts.routes ?? [];
  const calls: Array<{ method: string; url: string; body?: string }> = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const deps = {
    edtRegistry: { list: async () => ok([{ ulid: 'A', topic: 't', createdAt: 'x', status: 'active', members: [], favoriteRoutes: favorites }]) },
    state: { readActiveEdt: async () => ok('A') },
    manifest: { load: async () => ok({ modules: { 'route-explorer': { baseUrl: 'http://x' } } }) },
    scanner: { scan: async () => ok(routes) },
    auth: { getSession: async () => ok({ cookie: 'sid=1' }) },
    fetchFn: async (url: string, init: RequestInit) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight -= 1;
      calls.push({ method: String(init.method), url: String(url), ...(typeof init.body === 'string' ? { body: init.body } : {}) });
      const out = opts.respond?.(String(init.method), String(url)) ?? new Response('{"a":1}', { status: 200 });
      if (out instanceof Error) throw out;
      return out;
    },
  } as unknown as SmokeRunDeps;
  return { deps, calls, maxInFlight: () => maxInFlight };
}

describe('defaultSmokeDraft', () => {
  it('fills path params from examples, body only off GET/HEAD', () => {
    const route: Route = {
      method: 'POST',
      path: '/o/{id}',
      parameters: [{ name: 'id', in: 'path', required: true, example: 'a b' }],
      bodyExample: { x: 1 },
    };
    expect(defaultSmokeDraft('POST', '/o/{id}', route)).toEqual({ path: '/o/a%20b', body: { x: 1 }, missing: [] });
    expect(defaultSmokeDraft('GET', '/o/{id}', route)).toEqual({ path: '/o/a%20b', missing: [] });
    expect(defaultSmokeDraft('GET', '/o/{id}', undefined).missing).toEqual(['id']);
  });
});

describe('smokeRunFavorites', () => {
  it('fires healthy GET favorites and summarises', async () => {
    const { deps, calls } = setup({
      favorites: [fav('GET', '/a'), fav('GET', '/b')],
      routes: [{ method: 'GET', path: '/a' }, { method: 'GET', path: '/b' }],
    });
    const result = await smokeRunFavorites(deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.rows.map((r) => r.outcome)).toEqual(['ok', 'ok']);
    expect(result.data.rows[0]).toMatchObject({ status: 200, size: 7 });
    expect(result.data.summary).toMatchObject({ ok: 2, skipped: 0 });
    expect(calls).toHaveLength(2);
    expect(smokeRunFailed(result.data)).toBe(false);
  });

  it('skips stale, mutating and missing-param favorites without sending', async () => {
    const { deps, calls } = setup({
      favorites: [fav('GET', '/gone'), fav('POST', '/p'), fav('GET', '/o/{id}')],
      routes: [{ method: 'POST', path: '/p' }, { method: 'GET', path: '/o/{id}' }],
    });
    const result = await smokeRunFavorites(deps);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.rows.map((r) => r.reason)).toEqual(['stale', 'skipped (mutating)', 'missing params: id']);
    expect(result.data.rows.every((r) => r.outcome === 'skipped')).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('fires mutating routes with the default body when included', async () => {
    const { deps, calls } = setup({
      favorites: [fav('POST', '/p')],
      routes: [{ method: 'POST', path: '/p', bodyExample: { n: 1 } }],
    });
    const result = await smokeRunFavorites(deps, { includeMutating: true });
    expect(result.ok && result.data.rows[0]?.outcome).toBe('ok');
    expect(calls[0]).toMatchObject({ method: 'POST', body: '{"n":1}' });
  });

  it('maps statuses and errors to outcomes; one failure never stops the others', async () => {
    const paths = ['/ok', '/c', '/s', '/u', '/f', '/d'];
    const { deps } = setup({
      favorites: paths.map((p) => fav('GET', p)),
      routes: paths.map((p) => ({ method: 'GET', path: p })),
      respond: (_m, url) => {
        if (url.endsWith('/c')) return new Response('', { status: 404 });
        if (url.endsWith('/s')) return new Response('', { status: 503 });
        if (url.endsWith('/u')) return new Response('', { status: 401 });
        if (url.endsWith('/f')) return new Response('', { status: 403 });
        if (url.endsWith('/d')) return new Error('ECONNREFUSED');
        return new Response('ok', { status: 200 });
      },
    });
    const result = await smokeRunFavorites(deps);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.rows.map((r) => r.outcome)).toEqual([
      'ok', 'client-error', 'server-error', 'auth-error', 'auth-error', 'network-error',
    ]);
    expect(result.data.rows[5]).toMatchObject({ errorCode: 'request-failed' });
    expect(result.data.rows[3]).toMatchObject({ errorCode: 'auth-unauthorized' });
    expect(smokeRunFailed(result.data)).toBe(true);
  });

  it('never runs two requests at once on one repo, even with high concurrency', async () => {
    const paths = ['/a', '/b', '/c', '/d'];
    const { deps, maxInFlight } = setup({
      favorites: paths.map((p) => fav('GET', p)),
      routes: paths.map((p) => ({ method: 'GET', path: p })),
    });
    await smokeRunFavorites(deps, { concurrency: 8 });
    expect(maxInFlight()).toBe(1);
  });

  it('filters by repo, returns empty rows for no favorites, rejects an unknown EDT', async () => {
    const { deps, calls } = setup({
      favorites: [fav('GET', '/a'), fav('GET', '/a', '/repos/b')],
      routes: [{ method: 'GET', path: '/a' }],
    });
    const filtered = await smokeRunFavorites(deps, { repo: '/repos/b' });
    expect(filtered.ok && filtered.data.rows).toHaveLength(1);
    expect(calls).toHaveLength(1);
    const unknown = await smokeRunFavorites(deps, { edt: 'nope' });
    expect(unknown).toMatchObject({ ok: false, error: { code: 'edt-not-found' } });
    const empty = await smokeRunFavorites(setup({}).deps);
    expect(empty).toEqual(ok({ rows: [], summary: { ok: 0, 'client-error': 0, 'server-error': 0, 'auth-error': 0, 'network-error': 0, skipped: 0 } }));
  });

  it('emits pending → firing → done per row and cancels unstarted rows on abort', async () => {
    const controller = new AbortController();
    const { deps, calls } = setup({
      favorites: [fav('GET', '/a'), fav('GET', '/b')],
      routes: [{ method: 'GET', path: '/a' }, { method: 'GET', path: '/b' }],
    });
    const events: string[] = [];
    const result = await smokeRunFavorites(deps, {
      signal: controller.signal,
      onRow: (index: number, update: SmokeRowUpdate) => {
        events.push(`${index}:${update.phase}`);
        if (index === 0 && update.phase === 'done') controller.abort();
      },
    });
    if (!result.ok) throw new Error('expected ok');
    expect(events.slice(0, 2)).toEqual(['0:pending', '1:pending']);
    expect(events).toContain('0:firing');
    expect(result.data.rows.map((r) => r.outcome)).toEqual(['ok', 'skipped']);
    expect(result.data.rows[1]?.reason).toBe('cancelled');
    expect(calls).toHaveLength(1);
  });

  it('uses a caller-supplied draft', async () => {
    const { deps, calls } = setup({
      favorites: [fav('GET', '/o/{id}')],
      routes: [{ method: 'GET', path: '/o/{id}' }],
    });
    await smokeRunFavorites(deps, { drafts: () => ({ path: '/o/9', query: { q: '1' } }) });
    expect(calls[0]?.url).toBe('http://x/o/9?q=1');
  });

  it('surfaces a fire error from an unactivated repo as a network-error row', async () => {
    const { deps } = setup({ favorites: [fav('GET', '/a')], routes: [{ method: 'GET', path: '/a' }] });
    (deps.manifest as { load: unknown }).load = async () => err('manifest-not-found', 'x');
    const result = await smokeRunFavorites(deps);
    expect(result.ok && result.data.rows[0]).toMatchObject({ outcome: 'network-error', errorCode: 'manifest-not-found' });
  });

  it('treats a lower-case stored method as mutating and never sends it without the flag', async () => {
    const { deps, calls } = setup({ favorites: [fav('post', '/a')], routes: [{ method: 'POST', path: '/a' }] });
    const result = await smokeRunFavorites(deps, {});
    expect(result).toMatchObject({ ok: true, data: { rows: [{ outcome: 'skipped', reason: 'skipped (mutating)' }] } });
    expect(calls).toHaveLength(0);
  });

  it('never rejects when the drafts callback throws: falls back to the default draft', async () => {
    const { deps, calls } = setup({ favorites: [fav('GET', '/a')], routes: [{ method: 'GET', path: '/a' }] });
    const result = await smokeRunFavorites(deps, {
      drafts: () => {
        throw new Error('boom');
      },
    });
    expect(result).toMatchObject({ ok: true, data: { rows: [{ outcome: 'ok' }] } });
    expect(calls).toHaveLength(1);
  });
});
