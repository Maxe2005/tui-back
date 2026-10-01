// core/routes/fire-request: unit tests against fake ports + a stub fetchFn (AD-13) — no
// real manifests, no live servers. Covers the spec's I/O & Edge-Case Matrix row by row.
// The stub fetchFn is the story's only network seam: it serves both the fire itself (the
// auth module is faked here; its own stub-fetch coverage lives in
// cookie-session-auth.test.ts).
import { describe, expect, it, vi } from 'vitest';
import { err, ok, type Result } from '../result.js';
import type { DevAuthPort, DevAuthSession } from '../ports/dev-auth.js';
import type { Manifest, ManifestPort } from '../ports/manifest.js';
import type { Route, RouteScannerPort } from '../ports/route-scanner.js';
import { fireRequest } from './fire-request.js';

function manifestWithModules(modules: Manifest['modules']): Manifest {
  return {
    service: 'api-gateway',
    container: 'api-gateway',
    sharedBranch: 'development',
    modules,
  };
}

const CONFIG = { baseUrl: 'http://localhost:3000' };

function fakeManifest(load: ManifestPort['load']): ManifestPort {
  return { load };
}

function manifestOk(modules: Manifest['modules'] = { 'route-explorer': CONFIG }): ManifestPort {
  return fakeManifest(async () => ok(manifestWithModules(modules)));
}

function fakeScanner(scan: RouteScannerPort['scan']): RouteScannerPort {
  return { scan };
}

const ROUTES: Route[] = [
  { method: 'POST', path: '/api/orders' },
  { method: 'GET', path: '/api/orders' },
];

function scannerOk(routes: Route[] = ROUTES): RouteScannerPort {
  return fakeScanner(async () => ok(routes));
}

function fakeAuth(getSession: DevAuthPort['getSession']): DevAuthPort {
  return { getSession };
}

function authOk(cookie = 'sid=abc'): DevAuthPort {
  return fakeAuth(async () => ok({ cookie }));
}

function jsonResponse(status: number, body: string): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/plain' } });
}

function stubFetch(responses: Array<Response | Error>): {
  fetchFn: typeof fetch;
  calls: Array<{ url: string; method: string; cookie: string | null }>;
} {
  const calls: Array<{ url: string; method: string; cookie: string | null }> = [];
  const queue = [...responses];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const headers = new Headers(init?.headers);
    calls.push({ url, method: init?.method ?? 'GET', cookie: headers.get('cookie') });
    const next = queue.shift();
    if (next instanceof Error) {
      throw next;
    }
    if (next === undefined) {
      throw new Error('stub fetch queue exhausted');
    }
    return next;
  }) as typeof fetch;
  return { fetchFn, calls };
}

describe('fireRequest (story 6.2 I/O matrix)', () => {
  it('fires the discovered method + path with the session cookie, returning status + duration + body', async () => {
    const { fetchFn, calls } = stubFetch([jsonResponse(200, '{"id":1}')]);

    const result = await fireRequest(
      { manifest: manifestOk(), scanner: scannerOk(), auth: authOk('sid=abc'), fetchFn },
      '/repos/gateway',
      'POST',
      '/api/orders',
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.status).toBe(200);
      expect(typeof result.data.durationMs).toBe('number');
      expect(result.data.body).toBe('{"id":1}');
    }
    expect(calls).toEqual([{ url: 'http://localhost:3000/api/orders', method: 'POST', cookie: 'sid=abc' }]);
  });

  it('returns non-auth 4xx/5xx as data, not as errors', async () => {
    for (const status of [404, 422, 500]) {
      const { fetchFn } = stubFetch([jsonResponse(status, 'boom')]);

      const result = await fireRequest(
        { manifest: manifestOk(), scanner: scannerOk(), auth: authOk(), fetchFn },
        '/repos/gateway',
        'GET',
        '/api/orders',
      );

      expect(result).toMatchObject({ ok: true, data: { status, body: 'boom' } });
    }
  });

  it('rejects with route-exploration-not-activated (never an empty result) when the manifest lacks route-explorer', async () => {
    const scan = vi.fn(async (): Promise<Result<Route[]>> => ok(ROUTES));
    const getSession = vi.fn(async (): Promise<Result<DevAuthSession>> => ok({ cookie: 'sid=abc' }));
    const { fetchFn, calls } = stubFetch([jsonResponse(200, 'ok')]);

    const result = await fireRequest(
      { manifest: manifestOk({}), scanner: fakeScanner(scan), auth: fakeAuth(getSession), fetchFn },
      '/repos/plain',
      'POST',
      '/api/orders',
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'route-exploration-not-activated' } });
    expect(scan).not.toHaveBeenCalled();
    expect(getSession).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it('rejects with missing-base-url before any network call when the module config has no baseUrl', async () => {
    const getSession = vi.fn(async (): Promise<Result<DevAuthSession>> => ok({ cookie: 'sid=abc' }));
    const { fetchFn, calls } = stubFetch([jsonResponse(200, 'ok')]);

    const result = await fireRequest(
      { manifest: manifestOk({ 'route-explorer': {} }), scanner: scannerOk(), auth: fakeAuth(getSession), fetchFn },
      '/repos/gateway',
      'POST',
      '/api/orders',
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'missing-base-url' } });
    expect(getSession).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it('rejects with unknown-route (never fired silently) when method + path is absent from a fresh scan', async () => {
    const getSession = vi.fn(async (): Promise<Result<DevAuthSession>> => ok({ cookie: 'sid=abc' }));
    const { fetchFn, calls } = stubFetch([jsonResponse(200, 'ok')]);

    const result = await fireRequest(
      { manifest: manifestOk(), scanner: scannerOk(), auth: fakeAuth(getSession), fetchFn },
      '/repos/gateway',
      'DELETE',
      '/api/orders',
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'unknown-route' } });
    expect(getSession).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it('passes a scanner failure through verbatim as route-scan-failed', async () => {
    const getSession = vi.fn(async (): Promise<Result<DevAuthSession>> => ok({ cookie: 'sid=abc' }));
    const { fetchFn, calls } = stubFetch([jsonResponse(200, 'ok')]);

    const result = await fireRequest(
      {
        manifest: manifestOk(),
        scanner: fakeScanner(async () => err('route-scan-failed', 'bad spec', { reason: 'bad spec' })),
        auth: fakeAuth(getSession),
        fetchFn,
      },
      '/repos/gateway',
      'POST',
      '/api/orders',
    );

    expect(result).toEqual({
      ok: false,
      error: { code: 'route-scan-failed', message: 'bad spec', details: { reason: 'bad spec' } },
    });
    expect(getSession).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it('propagates manifest load failures verbatim (e.g. manifest-not-found)', async () => {
    const { fetchFn, calls } = stubFetch([jsonResponse(200, 'ok')]);

    const result = await fireRequest(
      {
        manifest: fakeManifest(async () => err('manifest-not-found', 'no manifest')),
        scanner: scannerOk(),
        auth: authOk(),
        fetchFn,
      },
      '/repos/gone',
      'POST',
      '/api/orders',
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'manifest-not-found' } });
    expect(calls).toHaveLength(0);
  });

  it('retries once with a fresh cookie after a 401 and returns the retried result', async () => {
    const getSession = vi.fn(async (_config: Record<string, unknown>, opts?: { forceRefresh?: boolean }) =>
      ok({ cookie: opts?.forceRefresh === true ? 'sid=fresh' : 'sid=stale' }),
    );
    const { fetchFn, calls } = stubFetch([jsonResponse(401, 'expired'), jsonResponse(200, 'retried')]);

    const result = await fireRequest(
      { manifest: manifestOk(), scanner: scannerOk(), auth: fakeAuth(getSession), fetchFn },
      '/repos/gateway',
      'POST',
      '/api/orders',
    );

    expect(result).toMatchObject({ ok: true, data: { status: 200, body: 'retried' } });
    expect(calls.map((call) => call.cookie)).toEqual(['sid=stale', 'sid=fresh']);
    expect(getSession).toHaveBeenCalledTimes(2);
    expect(getSession).toHaveBeenNthCalledWith(2, CONFIG, { forceRefresh: true });
  });

  it('returns auth-unauthorized after 2 consecutive re-auths still answer 401, with no further retries', async () => {
    const getSession = vi.fn(async () => ok({ cookie: 'sid=abc' }));
    const { fetchFn, calls } = stubFetch([
      jsonResponse(401, 'expired'),
      jsonResponse(401, 'expired'),
      jsonResponse(401, 'expired'),
    ]);

    const result = await fireRequest(
      { manifest: manifestOk(), scanner: scannerOk(), auth: fakeAuth(getSession), fetchFn },
      '/repos/gateway',
      'POST',
      '/api/orders',
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'auth-unauthorized' } });
    expect(calls).toHaveLength(3);
    expect(getSession).toHaveBeenCalledTimes(3);
  });

  it('passes an auth-endpoint failure through with no fire attempted', async () => {
    const { fetchFn, calls } = stubFetch([jsonResponse(200, 'ok')]);

    const result = await fireRequest(
      {
        manifest: manifestOk(),
        scanner: scannerOk(),
        auth: fakeAuth(async () => err('auth-endpoint-failed', 'auth down', { reason: 'HTTP 500' })),
        fetchFn,
      },
      '/repos/gateway',
      'POST',
      '/api/orders',
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'auth-endpoint-failed' } });
    expect(calls).toHaveLength(0);
  });

  it('passes a re-auth failure through instead of retrying the fire', async () => {
    const getSession = vi.fn(async (_config: Record<string, unknown>, opts?: { forceRefresh?: boolean }) =>
      opts?.forceRefresh === true
        ? err('auth-endpoint-failed', 'auth down', { reason: 'HTTP 500' })
        : ok({ cookie: 'sid=stale' }),
    );
    const { fetchFn, calls } = stubFetch([jsonResponse(401, 'expired')]);

    const result = await fireRequest(
      { manifest: manifestOk(), scanner: scannerOk(), auth: fakeAuth(getSession), fetchFn },
      '/repos/gateway',
      'POST',
      '/api/orders',
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'auth-endpoint-failed' } });
    expect(calls).toHaveLength(1);
  });

  it('maps a 403 to the distinct auth-forbidden with no retry', async () => {
    const getSession = vi.fn(async () => ok({ cookie: 'sid=abc' }));
    const { fetchFn, calls } = stubFetch([jsonResponse(403, 'denied')]);

    const result = await fireRequest(
      { manifest: manifestOk(), scanner: scannerOk(), auth: fakeAuth(getSession), fetchFn },
      '/repos/gateway',
      'POST',
      '/api/orders',
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'auth-forbidden' } });
    expect(calls).toHaveLength(1);
    expect(getSession).toHaveBeenCalledTimes(1);
  });

  it('maps a throwing fetch to request-failed with the reason, never throwing', async () => {
    const { fetchFn } = stubFetch([new Error('connection refused')]);

    const result = await fireRequest(
      { manifest: manifestOk(), scanner: scannerOk(), auth: authOk(), fetchFn },
      '/repos/gateway',
      'POST',
      '/api/orders',
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'request-failed',
        message: 'Request failed for POST /api/orders: connection refused',
        details: { reason: 'connection refused' },
      },
    });
  });

  it('caps the text body at 64KB', async () => {
    const { fetchFn } = stubFetch([jsonResponse(200, 'x'.repeat(100 * 1024))]);

    const result = await fireRequest(
      { manifest: manifestOk(), scanner: scannerOk(), auth: authOk(), fetchFn },
      '/repos/gateway',
      'GET',
      '/api/orders',
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.body).toHaveLength(64 * 1024);
    }
  });

  it('rejects an empty repoPath with missing-argument before touching any port', async () => {
    const load = vi.fn(async (): Promise<Result<Manifest>> => ok(manifestWithModules({ 'route-explorer': CONFIG })));
    const scan = vi.fn(async (): Promise<Result<Route[]>> => ok(ROUTES));
    const getSession = vi.fn(async (): Promise<Result<DevAuthSession>> => ok({ cookie: 'sid=abc' }));
    const { fetchFn, calls } = stubFetch([jsonResponse(200, 'ok')]);

    const result = await fireRequest(
      { manifest: fakeManifest(load), scanner: fakeScanner(scan), auth: fakeAuth(getSession), fetchFn },
      '   ',
      'POST',
      '/api/orders',
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'missing-argument' } });
    expect(load).not.toHaveBeenCalled();
    expect(scan).not.toHaveBeenCalled();
    expect(getSession).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it('matches a lowercase/mixed-case method against the discovered uppercase route and sends the normalized method', async () => {
    const { fetchFn, calls } = stubFetch([jsonResponse(200, 'ok')]);

    const result = await fireRequest(
      { manifest: manifestOk(), scanner: scannerOk(), auth: authOk(), fetchFn },
      '/repos/gateway',
      'post',
      '/api/orders',
    );

    expect(result).toMatchObject({ ok: true, data: { status: 200 } });
    expect(calls).toEqual([{ url: 'http://localhost:3000/api/orders', method: 'POST', cookie: 'sid=abc' }]);
  });

  it('tolerates a single trailing slash on the fired path, firing the discovered route as-is', async () => {
    const { fetchFn, calls } = stubFetch([jsonResponse(200, 'ok')]);

    const result = await fireRequest(
      { manifest: manifestOk(), scanner: scannerOk(), auth: authOk(), fetchFn },
      '/repos/gateway',
      'POST',
      '/api/orders/',
    );

    expect(result).toMatchObject({ ok: true, data: { status: 200 } });
    expect(calls).toEqual([{ url: 'http://localhost:3000/api/orders', method: 'POST', cookie: 'sid=abc' }]);
  });

  it('trims a padded repoPath once and uses it for manifest load and scan', async () => {
    const load = vi.fn(async (): Promise<Result<Manifest>> => ok(manifestWithModules({ 'route-explorer': CONFIG })));
    const scan = vi.fn(async (): Promise<Result<Route[]>> => ok(ROUTES));
    const { fetchFn } = stubFetch([jsonResponse(200, 'ok')]);

    const result = await fireRequest(
      { manifest: fakeManifest(load), scanner: fakeScanner(scan), auth: authOk(), fetchFn },
      '  /repos/gateway  ',
      'POST',
      '/api/orders',
    );

    expect(result).toMatchObject({ ok: true, data: { status: 200 } });
    expect(load).toHaveBeenCalledWith('/repos/gateway');
    expect(scan).toHaveBeenCalledWith('/repos/gateway', expect.anything());
  });

  it('rejects an empty method or path with invalid-argument before touching any port', async () => {
    const load = vi.fn(async (): Promise<Result<Manifest>> => ok(manifestWithModules({ 'route-explorer': CONFIG })));
    const { fetchFn } = stubFetch([jsonResponse(200, 'ok')]);

    for (const [method, path] of [['', '/api/orders'], ['POST', '   ']] as Array<[string, string]>) {
      const result = await fireRequest(
        { manifest: fakeManifest(load), scanner: scannerOk(), auth: authOk(), fetchFn },
        '/repos/gateway',
        method,
        path,
      );

      expect(result).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
    }
    expect(load).not.toHaveBeenCalled();
  });
});

// Story 6.9: the request workbench's optional trailing options (body/query/headers) and
// the concrete-path-against-template route match. A separate recording stub keeps the
// 6.2 `stubFetch` (and its exact `calls` assertions above) untouched.
function recordingFetch(response: Response): {
  fetchFn: typeof fetch;
  calls: Array<{ url: string; method: string; headers: Headers; body: unknown }>;
} {
  const calls: Array<{ url: string; method: string; headers: Headers; body: unknown }> = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, method: init?.method ?? 'GET', headers: new Headers(init?.headers), body: init?.body });
    return response;
  }) as typeof fetch;
  return { fetchFn, calls };
}

const TEMPLATED_ROUTES: Route[] = [
  { method: 'GET', path: '/users/{id}' },
  { method: 'GET', path: '/users/me' },
  { method: 'PATCH', path: '/users/{id}' },
  { method: 'GET', path: '/health' },
];

describe('fireRequest options (story 6.9)', () => {
  it('serializes a JSON body with an inferred application/json content type', async () => {
    const { fetchFn, calls } = recordingFetch(jsonResponse(201, 'ok'));

    const result = await fireRequest(
      { manifest: manifestOk(), scanner: scannerOk(), auth: authOk('sid=abc'), fetchFn },
      '/repos/gateway',
      'POST',
      '/api/orders',
      { body: { qty: 2, tags: ['a'] } },
    );

    expect(result).toMatchObject({ ok: true, data: { status: 201 } });
    expect(calls[0].body).toBe('{"qty":2,"tags":["a"]}');
    expect(calls[0].headers.get('content-type')).toBe('application/json');
    expect(calls[0].headers.get('cookie')).toBe('sid=abc');
  });

  it('keeps a caller content-type header instead of inferring one', async () => {
    const { fetchFn, calls } = recordingFetch(jsonResponse(200, 'ok'));

    await fireRequest(
      { manifest: manifestOk(), scanner: scannerOk(), auth: authOk(), fetchFn },
      '/repos/gateway',
      'POST',
      '/api/orders',
      { body: { a: 1 }, headers: { 'content-type': 'application/merge-patch+json' } },
    );

    expect(calls[0].headers.get('content-type')).toBe('application/merge-patch+json');
  });

  it('rejects a body on GET/HEAD with invalid-argument before any network call', async () => {
    for (const method of ['GET', 'head']) {
      const { fetchFn, calls } = recordingFetch(jsonResponse(200, 'ok'));
      const getSession = vi.fn(async () => ok({ cookie: 'sid=abc' }));

      const result = await fireRequest(
        { manifest: manifestOk(), scanner: scannerOk([{ method: 'GET', path: '/api/orders' }, { method: 'HEAD', path: '/api/orders' }]), auth: fakeAuth(getSession), fetchFn },
        '/repos/gateway',
        method,
        '/api/orders',
        { body: { a: 1 } },
      );

      expect(result).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
      expect(calls).toEqual([]);
      expect(getSession).not.toHaveBeenCalled();
    }
  });

  it('drops a caller cookie header (any case): the auth session cookie always wins and is never leaked', async () => {
    const { fetchFn, calls } = recordingFetch(jsonResponse(200, 'ok'));

    await fireRequest(
      { manifest: manifestOk(), scanner: scannerOk(), auth: authOk('sid=real'), fetchFn },
      '/repos/gateway',
      'GET',
      '/api/orders',
      { headers: { COOKIE: 'sid=forged', 'X-Trace': 't1' } },
    );

    expect(calls[0].headers.get('cookie')).toBe('sid=real');
    expect(calls[0].headers.get('x-trace')).toBe('t1');
  });

  it('appends the query URL-encoded and sends no body/content-type without a body', async () => {
    const { fetchFn, calls } = recordingFetch(jsonResponse(200, 'ok'));

    await fireRequest(
      { manifest: manifestOk(), scanner: scannerOk(), auth: authOk(), fetchFn },
      '/repos/gateway',
      'GET',
      '/api/orders',
      { query: { q: 'a b&c', page: '2' } },
    );

    expect(calls[0].url).toBe('http://localhost:3000/api/orders?q=a+b%26c&page=2');
    expect(calls[0].body).toBeUndefined();
    expect(calls[0].headers.get('content-type')).toBeNull();
  });

  it('fires a concrete path against a templated route', async () => {
    const { fetchFn, calls } = recordingFetch(jsonResponse(200, 'ok'));

    const result = await fireRequest(
      { manifest: manifestOk(), scanner: scannerOk(TEMPLATED_ROUTES), auth: authOk(), fetchFn },
      '/repos/gateway',
      'PATCH',
      '/users/42',
      { body: { name: 'x' } },
    );

    expect(result.ok).toBe(true);
    expect(calls[0].url).toBe('http://localhost:3000/users/42');
  });

  it('prefers an exact route over a template, and rejects a segment-count mismatch or an empty segment', async () => {
    const { fetchFn, calls } = recordingFetch(jsonResponse(200, 'ok'));
    const deps = { manifest: manifestOk(), scanner: scannerOk(TEMPLATED_ROUTES), auth: authOk(), fetchFn };

    expect((await fireRequest(deps, '/repos/gateway', 'GET', '/users/me')).ok).toBe(true);
    expect(calls[0].url).toBe('http://localhost:3000/users/me');
    expect(await fireRequest(deps, '/repos/gateway', 'GET', '/users/42/extra')).toMatchObject({ ok: false, error: { code: 'unknown-route' } });
    expect(await fireRequest(deps, '/repos/gateway', 'GET', '/users//')).toMatchObject({ ok: false, error: { code: 'unknown-route' } });
    expect(await fireRequest(deps, '/repos/gateway', 'POST', '/users/42')).toMatchObject({ ok: false, error: { code: 'unknown-route' } });
  });
});
