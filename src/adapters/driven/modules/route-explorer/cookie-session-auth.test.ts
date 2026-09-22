// adapters/driven/modules/route-explorer/cookie-session-auth: unit tests against a stub
// fetch (AD-13) — no live auth route. Covers Set-Cookie parsing, the TTL-minus-skew cache,
// and every auth-endpoint-failed row. The cookie value itself is asserted only inside the
// in-memory Result, never logged anywhere.
import { describe, expect, it, vi } from 'vitest';
import { createCookieSessionAuth } from './cookie-session-auth.js';

function authResponse(cookies: string[], status = 200): Response {
  const headers = new Headers();
  for (const cookie of cookies) {
    headers.append('set-cookie', cookie);
  }
  return new Response('ok', { status, headers });
}

function stubFetch(responses: Array<Response | Error>): {
  fetchFn: typeof fetch;
  urls: string[];
} {
  const urls: string[] = [];
  const queue = [...responses];
  const fetchFn = (async (input: string | URL | Request) => {
    urls.push(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
    const next = queue.shift();
    if (next instanceof Error) {
      throw next;
    }
    if (next === undefined) {
      throw new Error('stub fetch queue exhausted');
    }
    return next;
  }) as typeof fetch;
  return { fetchFn, urls };
}

describe('cookie-session-auth (story 6.2)', () => {
  it('calls GET {baseUrl}{authPath} and carries the Set-Cookie pair as the Cookie value', async () => {
    const { fetchFn, urls } = stubFetch([authResponse(['sid=abc; Path=/; HttpOnly'])]);
    const auth = createCookieSessionAuth({ fetchFn });

    const result = await auth.getSession({ baseUrl: 'http://localhost:3000' });

    expect(urls).toEqual(['http://localhost:3000/auth/me']);
    expect(result).toEqual({ ok: true, data: { cookie: 'sid=abc' } });
  });

  it('joins several Set-Cookie pairs into one Cookie header, dropping attributes', async () => {
    const { fetchFn } = stubFetch([authResponse(['a=1; Path=/', 'b=2; Path=/; HttpOnly'])]);
    const auth = createCookieSessionAuth({ fetchFn });

    const result = await auth.getSession({ baseUrl: 'http://localhost:3000' });

    expect(result).toEqual({ ok: true, data: { cookie: 'a=1; b=2' } });
  });

  it('honors a manifest-configured authPath', async () => {
    const { fetchFn, urls } = stubFetch([authResponse(['sid=abc; Path=/'])]);
    const auth = createCookieSessionAuth({ fetchFn });

    const result = await auth.getSession({ baseUrl: 'http://localhost:3000/', authPath: '/login/dev' });

    expect(urls).toEqual(['http://localhost:3000/login/dev']);
    expect(result).toEqual({ ok: true, data: { cookie: 'sid=abc' } });
  });

  it('caches the session so a second fire needs no new auth call', async () => {
    const { fetchFn, urls } = stubFetch([authResponse(['sid=abc; Path=/'])]);
    const auth = createCookieSessionAuth({ fetchFn });
    const config = { baseUrl: 'http://localhost:3000' };

    expect(await auth.getSession(config)).toEqual({ ok: true, data: { cookie: 'sid=abc' } });
    expect(await auth.getSession(config)).toEqual({ ok: true, data: { cookie: 'sid=abc' } });
    expect(urls).toHaveLength(1);
  });

  it('re-authenticates silently once the cached session is older than TTL minus 30s skew', async () => {
    let now = 1_000_000;
    const { fetchFn, urls } = stubFetch([
      authResponse(['sid=first; Path=/']),
      authResponse(['sid=second; Path=/']),
    ]);
    const auth = createCookieSessionAuth({ fetchFn, now: () => now });
    const config = { baseUrl: 'http://localhost:3000', sessionTtlSec: 60 };

    expect(await auth.getSession(config)).toEqual({ ok: true, data: { cookie: 'sid=first' } });
    now += 29_000;
    expect(await auth.getSession(config)).toEqual({ ok: true, data: { cookie: 'sid=first' } });
    expect(urls).toHaveLength(1);
    now += 2000;
    expect(await auth.getSession(config)).toEqual({ ok: true, data: { cookie: 'sid=second' } });
    expect(urls).toHaveLength(2);
  });

  it('forceRefresh bypasses a still-fresh cache entry', async () => {
    const { fetchFn, urls } = stubFetch([
      authResponse(['sid=first; Path=/']),
      authResponse(['sid=second; Path=/']),
    ]);
    const auth = createCookieSessionAuth({ fetchFn });
    const config = { baseUrl: 'http://localhost:3000' };

    expect(await auth.getSession(config)).toEqual({ ok: true, data: { cookie: 'sid=first' } });
    expect(await auth.getSession(config, { forceRefresh: true })).toEqual({
      ok: true,
      data: { cookie: 'sid=second' },
    });
    expect(urls).toHaveLength(2);
  });

  it('keeps per-baseUrl cache entries so two repos do not share a session', async () => {
    const { fetchFn, urls } = stubFetch([
      authResponse(['sid=a; Path=/']),
      authResponse(['sid=b; Path=/']),
    ]);
    const auth = createCookieSessionAuth({ fetchFn });

    expect(await auth.getSession({ baseUrl: 'http://a:3000' })).toEqual({
      ok: true,
      data: { cookie: 'sid=a' },
    });
    expect(await auth.getSession({ baseUrl: 'http://b:3000' })).toEqual({
      ok: true,
      data: { cookie: 'sid=b' },
    });
    expect(await auth.getSession({ baseUrl: 'http://a:3000' })).toEqual({
      ok: true,
      data: { cookie: 'sid=a' },
    });
    expect(urls).toHaveLength(2);
  });

  it('returns auth-endpoint-failed with the reason for a non-2xx auth answer', async () => {
    const fetchFn = vi.fn(async () => new Response('denied', { status: 500 }));
    const auth = createCookieSessionAuth({ fetchFn: fetchFn as typeof fetch });

    const result = await auth.getSession({ baseUrl: 'http://localhost:3000' });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'auth-endpoint-failed',
        message: 'Session acquisition failed for http://localhost:3000/auth/me: HTTP 500',
        details: { reason: 'HTTP 500' },
      },
    });
  });

  it('returns auth-endpoint-failed (never throws) when the fetch itself fails', async () => {
    const { fetchFn } = stubFetch([new Error('connection refused')]);
    const auth = createCookieSessionAuth({ fetchFn });

    const result = await auth.getSession({ baseUrl: 'http://localhost:3000' });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'auth-endpoint-failed',
        message: 'Session acquisition failed for http://localhost:3000/auth/me: connection refused',
        details: { reason: 'connection refused' },
      },
    });
  });

  it('returns auth-endpoint-failed when the auth answer carries no Set-Cookie', async () => {
    const { fetchFn } = stubFetch([new Response('ok', { status: 200 })]);
    const auth = createCookieSessionAuth({ fetchFn });

    const result = await auth.getSession({ baseUrl: 'http://localhost:3000' });

    expect(result).toMatchObject({ ok: false, error: { code: 'auth-endpoint-failed' } });
    if (!result.ok) {
      expect(result.error.details).toEqual({ reason: 'missing Set-Cookie' });
    }
  });

  it('never caches a failure — the next call retries the endpoint', async () => {
    const { fetchFn, urls } = stubFetch([
      new Error('connection refused'),
      authResponse(['sid=abc; Path=/']),
    ]);
    const auth = createCookieSessionAuth({ fetchFn });
    const config = { baseUrl: 'http://localhost:3000' };

    expect(await auth.getSession(config)).toMatchObject({ ok: false, error: { code: 'auth-endpoint-failed' } });
    expect(await auth.getSession(config)).toEqual({ ok: true, data: { cookie: 'sid=abc' } });
    expect(urls).toHaveLength(2);
  });

  it('returns auth-endpoint-failed without any network call when baseUrl is missing', async () => {
    const fetchFn = vi.fn(async () => authResponse(['sid=abc; Path=/']));
    const auth = createCookieSessionAuth({ fetchFn: fetchFn as typeof fetch });

    const result = await auth.getSession({});

    expect(result).toMatchObject({ ok: false, error: { code: 'auth-endpoint-failed' } });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('judges expiry against the TTL stored at acquisition, not the current config', async () => {
    let now = 1_000_000;
    const { fetchFn, urls } = stubFetch([
      authResponse(['sid=first; Path=/']),
      authResponse(['sid=second; Path=/']),
    ]);
    const auth = createCookieSessionAuth({ fetchFn, now: () => now });

    expect(await auth.getSession({ baseUrl: 'http://localhost:3000', sessionTtlSec: 60 })).toEqual({
      ok: true,
      data: { cookie: 'sid=first' },
    });
    // 31s later the 60s-TTL entry (30s skew) is stale even though the new config claims 3600s.
    now += 31_000;
    expect(await auth.getSession({ baseUrl: 'http://localhost:3000', sessionTtlSec: 3600 })).toEqual({
      ok: true,
      data: { cookie: 'sid=second' },
    });
    expect(urls).toHaveLength(2);
  });

  it('keeps a short-TTL session cached instead of re-authenticating every call', async () => {
    let now = 1_000_000;
    const { fetchFn, urls } = stubFetch([authResponse(['sid=abc; Path=/'])]);
    const auth = createCookieSessionAuth({ fetchFn, now: () => now });
    const config = { baseUrl: 'http://localhost:3000', sessionTtlSec: 5 };

    expect(await auth.getSession(config)).toEqual({ ok: true, data: { cookie: 'sid=abc' } });
    now += 500;
    expect(await auth.getSession(config)).toEqual({ ok: true, data: { cookie: 'sid=abc' } });
    expect(urls).toHaveLength(1);
  });

  it('issues one /auth/me request for two concurrent getSession calls on an empty cache', async () => {
    let release: ((response: Response) => void) | undefined;
    const urls: string[] = [];
    const fetchFn = (async (input: string | URL | Request) => {
      urls.push(typeof input === 'string' ? input : input.toString());
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    }) as typeof fetch;
    const auth = createCookieSessionAuth({ fetchFn });
    const config = { baseUrl: 'http://localhost:3000' };

    const first = auth.getSession(config);
    const second = auth.getSession(config);
    release?.(authResponse(['sid=shared; Path=/']));

    expect(await first).toEqual({ ok: true, data: { cookie: 'sid=shared' } });
    expect(await second).toEqual({ ok: true, data: { cookie: 'sid=shared' } });
    expect(urls).toHaveLength(1);
  });
});
