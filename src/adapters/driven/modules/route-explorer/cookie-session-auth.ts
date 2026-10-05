// adapters/driven/modules/route-explorer/cookie-session-auth: the `route-explorer` DevAuthPort.
// The service owns token issuance: `GET {baseUrl}{authPath}` (default `/auth/me`) yields a
// `Set-Cookie` the module caches per baseUrl + authPath for `sessionTtlSec` (default 300)
// minus a refresh skew. Endpoint non-2xx, network failure or a missing `Set-Cookie` is
// `auth-endpoint-failed` with `details.reason`, never a throw; the cookie is never logged.
import { err, ok, type Result } from '../../../../core/result.js';
import type { DevAuthOptions, DevAuthSession, DevAuthPort } from '../../../../core/ports/dev-auth.js';

const DEFAULT_AUTH_PATH = '/auth/me';
const DEFAULT_SESSION_TTL_SEC = 300;
const MAX_SKEW_SEC = 30;
const AUTH_TIMEOUT_MS = 8000;

export interface CookieSessionAuthOptions {
  fetchFn?: typeof fetch;
  now?: () => number;
}

interface CachedSession {
  cookie: string;
  acquiredAt: number;
  // The TTL from the config in force when the session was acquired — expiry is always
  // judged against this stored value, never the current call's config, so a mid-session
  // manifest edit cannot stretch or shrink a live entry.
  ttlSec: number;
}

// Short TTLs degrade gracefully instead of never hitting cache: the session stays valid
// for at least 1s, and the refresh skew shrinks to (ttl - 1)s capped at 30s (a 1s TTL
// refreshes every call; the 300s default keeps the full 30s skew).
function isFresh(cached: CachedSession, nowMs: number): boolean {
  const effectiveTtlSec = Math.max(1, cached.ttlSec);
  const skewSec = Math.min(MAX_SKEW_SEC, Math.max(cached.ttlSec - 1, 0));
  return cached.acquiredAt + (effectiveTtlSec - skewSec) * 1000 > nowMs;
}

function configString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function sessionTtlSec(config: Record<string, unknown>): number {
  const value = config['sessionTtlSec'];
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)) && Number(value) > 0) {
    return Number(value);
  }
  return DEFAULT_SESSION_TTL_SEC;
}

// Every Set-Cookie's `name=value` pair (before the first `;`) joined into one Cookie
// header value; attributes (Path, HttpOnly, Expires, …) never travel back to the server.
function parseSetCookiesToHeader(values: string[]): string | undefined {
  const pairs: string[] = [];
  for (const value of values) {
    const separator = value.indexOf(';');
    const pair = (separator === -1 ? value : value.slice(0, separator)).trim();
    if (pair !== '') {
      pairs.push(pair);
    }
  }
  return pairs.length > 0 ? pairs.join('; ') : undefined;
}

function readSetCookies(headers: Headers): string[] {
  // Node's undici Headers exposes every Set-Cookie separately via getSetCookie() — always
  // preferred, since a joined value cannot be split back reliably (Expires dates contain
  // commas and some servers emit several cookies). The single-value fallback below therefore
  // only supports single-cookie auth answers.
  const getSetCookie = (headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
  if (typeof getSetCookie === 'function') {
    return getSetCookie.call(headers);
  }
  const single = headers.get('set-cookie');
  return single === null ? [] : [single];
}

export function createCookieSessionAuth(options: CookieSessionAuthOptions = {}): DevAuthPort {
  const cache = new Map<string, CachedSession>();
  // In-flight acquisitions keyed like the cache: two concurrent getSession calls with an
  // empty cache join one /auth/me request instead of issuing two (last-write-wins on the
  // settled cache is acceptable, duplicate calls are not). Entries live only until their
  // own fetch settles — never beyond, so failures are retried by the next call.
  const inflight = new Map<string, Promise<Result<DevAuthSession>>>();
  const now = options.now ?? Date.now;
  const fetchFn =
    options.fetchFn ?? ((input: string | URL | Request, init?: RequestInit) => globalThis.fetch(input, init));

  async function acquireSession(url: string, cacheKey: string, ttlSec: number): Promise<Result<DevAuthSession>> {
    let response: Response;
    try {
      response = await fetchFn(url, { signal: AbortSignal.timeout(AUTH_TIMEOUT_MS) });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return err('auth-endpoint-failed', `Session acquisition failed for ${url}: ${reason}`, { reason });
    }
    if (!response.ok) {
      return err('auth-endpoint-failed', `Session acquisition failed for ${url}: HTTP ${response.status}`, {
        reason: `HTTP ${response.status}`,
      });
    }
    const cookie = parseSetCookiesToHeader(readSetCookies(response.headers));
    if (cookie === undefined) {
      return err('auth-endpoint-failed', `Session acquisition failed for ${url}: no Set-Cookie in the auth response`, {
        reason: 'missing Set-Cookie',
      });
    }
    cache.set(cacheKey, { cookie, acquiredAt: now(), ttlSec });
    return ok({ cookie });
  }

  return {
    async getSession(
      config: Record<string, unknown>,
      opts: DevAuthOptions = {},
    ): Promise<Result<DevAuthSession>> {
      try {
        const cfg = config ?? {};
        const baseUrl = configString(cfg['baseUrl']);
        if (baseUrl === undefined) {
          return err(
            'auth-endpoint-failed',
            'Session acquisition failed: the route-explorer module has no baseUrl',
            { reason: 'missing baseUrl' },
          );
        }
        const rawAuthPath = configString(cfg['authPath']) ?? DEFAULT_AUTH_PATH;
        const authPath = rawAuthPath.startsWith('/') ? rawAuthPath : `/${rawAuthPath}`;
        const base = baseUrl.replace(/\/+$/, '');
        const url = `${base}${authPath}`;
        const cacheKey = `${base}${authPath}`;
        const ttlSec = sessionTtlSec(cfg);

        if (opts.forceRefresh !== true) {
          const cached = cache.get(cacheKey);
          if (cached !== undefined && isFresh(cached, now())) {
            return ok({ cookie: cached.cookie });
          }
        }

        const ongoing = inflight.get(cacheKey);
        if (ongoing !== undefined) {
          return ongoing;
        }
        const pending = acquireSession(url, cacheKey, ttlSec);
        inflight.set(cacheKey, pending);
        try {
          return await pending;
        } finally {
          inflight.delete(cacheKey);
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return err('auth-endpoint-failed', `Session acquisition failed: ${reason}`, { reason });
      }
    },
  };
}
