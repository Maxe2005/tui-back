// core/routes/fire-request: fires a discovered route with dev-mode auth handled automatically.
// Flow: manifest gate → `missing-base-url` → fresh route-exists check (`unknown-route`) →
// session cookie from the DevAuthPort → fetch with an 8s timeout, re-authing on 401 (at most 2
// re-auths, then `auth-unauthorized`); 403 is `auth-forbidden`; any other status is data. The
// session cookie never appears in any message or details, and wins over a caller `cookie`.
import { ROUTES_MODULE_ID } from '../edt/resolve-tab-visibility.js';
import type { DevAuthPort } from '../ports/dev-auth.js';
import type { ManifestPort } from '../ports/manifest.js';
import type { RouteScannerPort } from '../ports/route-scanner.js';
import { err, ok, type Result } from '../result.js';

export interface FireResult {
  status: number;
  durationMs: number;
  body: string;
}

export interface FireRequestOptions {
  body?: unknown;
  query?: Record<string, string>;
  headers?: Record<string, string>;
}

export interface FireRequestDeps {
  manifest: ManifestPort;
  scanner: RouteScannerPort;
  auth: DevAuthPort;
  fetchFn?: typeof fetch;
}

const FIRE_REQUEST_USAGE =
  "tui-back fire-request <repoPath> <METHOD> <path> [--body <json>] [--query name=value]... [--header 'Name: value']...";
const FIRE_TIMEOUT_MS = 8000;
const MAX_CONSECUTIVE_RE_AUTHS = 2;
const MAX_BODY_CHARS = 64 * 1024;

function configString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return path.startsWith('/') ? `${base}${path}` : `${base}/${path}`;
}

// A single trailing slash is tolerated when matching the fired path against scanned
// routes (`/api/orders/` fires the discovered `/api/orders`); the root `/` is never
// stripped. Query strings travel separately (`options.query`), never inside `path`.
function stripSingleTrailingSlash(value: string): string {
  return value.length > 1 && value.endsWith('/') ? value.slice(0, -1) : value;
}

// A templated segment matches one non-empty concrete segment: `{id}` alone, or mixed with
// literal text (`{name}.json`, `v{version}`); every other segment must match literally.
// Segment counts must agree, and `.`/`..` never fill a param (URL normalization would fire
// a different endpoint). Returns the number of param segments (specificity), or null.
const TEMPLATE_PARAM = /\{[^/{}]+\}/g;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchTemplate(template: string, concrete: string): number | null {
  const templateSegments = template.split('/');
  const concreteSegments = concrete.split('/');
  if (templateSegments.length !== concreteSegments.length) {
    return null;
  }
  let params = 0;
  for (const [index, segment] of templateSegments.entries()) {
    const candidate = concreteSegments[index] ?? '';
    if (!segment.includes('{')) {
      if (segment !== candidate) {
        return null;
      }
      continue;
    }
    if (candidate === '' || candidate === '.' || candidate === '..') {
      return null;
    }
    const pattern = segment
      .split(TEMPLATE_PARAM)
      .map(escapeRegExp)
      .join('[^/]+');
    if (!new RegExp(`^${pattern}$`).test(candidate)) {
      return null;
    }
    params += 1;
  }
  return params;
}

function buildQueryString(query: Record<string, string> | undefined): string {
  if (query === undefined) {
    return '';
  }
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    params.append(name, value);
  }
  const encoded = params.toString();
  return encoded === '' ? '' : `?${encoded}`;
}

function buildHeaders(cookie: string, headers: Record<string, string> | undefined, hasBody: boolean): Record<string, string> {
  const built: Record<string, string> = {};
  let hasContentType = false;
  for (const [name, value] of Object.entries(headers ?? {})) {
    const lower = name.toLowerCase();
    if (lower === 'cookie') {
      continue;
    }
    if (lower === 'content-type') {
      hasContentType = true;
    }
    built[name] = value;
  }
  if (hasBody && !hasContentType) {
    built['Content-Type'] = 'application/json';
  }
  built['Cookie'] = cookie;
  return built;
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function fireRequest(
  deps: FireRequestDeps,
  repoPath: string,
  method: string,
  path: string,
  options: FireRequestOptions = {},
): Promise<Result<FireResult>> {
  if (typeof repoPath !== 'string' || repoPath.trim() === '') {
    return err('missing-argument', `Usage: ${FIRE_REQUEST_USAGE}`);
  }
  if (typeof method !== 'string' || method.trim() === '' || typeof path !== 'string' || path.trim() === '') {
    return err('invalid-argument', `Usage: ${FIRE_REQUEST_USAGE}`);
  }
  const trimmedRepoPath = repoPath.trim();

  const loaded = await deps.manifest.load(trimmedRepoPath);
  if (!loaded.ok) {
    return loaded;
  }

  const config = loaded.data.modules[ROUTES_MODULE_ID];
  if (config == null) {
    return err(
      'route-exploration-not-activated',
      `No route list for this repo: ${trimmedRepoPath} does not activate the ${ROUTES_MODULE_ID} module`,
    );
  }

  const baseUrl = configString(config['baseUrl']);
  if (baseUrl === undefined) {
    return err(
      'missing-base-url',
      `No baseUrl for this repo: ${trimmedRepoPath} activates the ${ROUTES_MODULE_ID} module without a baseUrl`,
    );
  }

  const normalizedMethod = method.trim().toUpperCase();
  const normalizedPath = stripSingleTrailingSlash(path.trim());
  if (/[?#]/.test(normalizedPath)) {
    return err('invalid-argument', `The path must not carry a query or fragment (${normalizedPath}): pass the query separately`);
  }
  const hasBody = options.body !== undefined;
  if (hasBody && (normalizedMethod === 'GET' || normalizedMethod === 'HEAD')) {
    return err('invalid-argument', `A ${normalizedMethod} request cannot carry a body`);
  }
  let serializedBody: string | undefined;
  if (hasBody) {
    try {
      serializedBody = JSON.stringify(options.body) as string | undefined;
    } catch (error) {
      return err('invalid-argument', `The request body is not serializable as JSON: ${reasonOf(error)}`);
    }
    if (serializedBody === undefined) {
      return err('invalid-argument', 'The request body is not serializable as JSON');
    }
  }

  const scanned = await deps.scanner.scan(trimmedRepoPath, config);
  if (!scanned.ok) {
    return scanned;
  }
  const sameMethod = scanned.data.filter((route) => route.method.toUpperCase() === normalizedMethod);
  const exact = sameMethod.find((route) => stripSingleTrailingSlash(route.path) === normalizedPath);
  // Several templates may match: the most specific (fewest param segments) wins.
  let templated: (typeof sameMethod)[number] | undefined;
  let templatedParams = Number.POSITIVE_INFINITY;
  if (exact === undefined) {
    for (const route of sameMethod) {
      const params = matchTemplate(stripSingleTrailingSlash(route.path), normalizedPath);
      if (params !== null && params < templatedParams) {
        templated = route;
        templatedParams = params;
      }
    }
  }
  const matched = exact ?? templated;
  if (matched === undefined) {
    return err(
      'unknown-route',
      `Unknown route: ${normalizedMethod} ${normalizedPath} is not among the discovered routes for ${trimmedRepoPath}`,
    );
  }
  // An exact match fires the discovered route as-is (canonical path, no input slash
  // remnants); a templated match fires the caller's concrete path.
  const firedPath = exact !== undefined ? matched.path : normalizedPath;

  const session = await deps.auth.getSession(config);
  if (!session.ok) {
    return session;
  }
  let cookie = session.data.cookie;

  const fetchFn = deps.fetchFn ?? ((input: string | URL | Request, init?: RequestInit) => globalThis.fetch(input, init));
  const url = `${joinUrl(baseUrl, firedPath)}${buildQueryString(options.query)}`;
  // Retry budget: 1 initial try + up to MAX_CONSECUTIVE_RE_AUTHS re-auth retries (each a
  // force-refreshed session followed by one more fetch) = at most 3 fetches per fire.
  // A failed re-auth passes through immediately; a 401 past the budget stands as
  // `auth-unauthorized`. durationMs covers every attempt including re-auth latency.
  const firedAt = Date.now();
  let reAuths = 0;
  for (;;) {
    let response: Response;
    try {
      response = await fetchFn(url, {
        method: normalizedMethod,
        headers: buildHeaders(cookie, options.headers, hasBody),
        ...(serializedBody !== undefined ? { body: serializedBody } : {}),
        signal: AbortSignal.timeout(FIRE_TIMEOUT_MS),
      });
    } catch (error) {
      const reason = reasonOf(error);
      return err('request-failed', `Request failed for ${normalizedMethod} ${firedPath}: ${reason}`, {
        reason,
      });
    }
    if (response.status === 401 && reAuths < MAX_CONSECUTIVE_RE_AUTHS) {
      const refreshed = await deps.auth.getSession(config, { forceRefresh: true });
      if (!refreshed.ok) {
        return refreshed;
      }
      cookie = refreshed.data.cookie;
      reAuths += 1;
      continue;
    }
    if (response.status === 401) {
      return err(
        'auth-unauthorized',
        `Authentication failed for ${normalizedMethod} ${firedPath}: the session was rejected (401) after re-authentication`,
      );
    }
    if (response.status === 403) {
      return err(
        'auth-forbidden',
        `Access forbidden for ${normalizedMethod} ${firedPath}: the session lacks permission (403)`,
      );
    }
    let body: string;
    try {
      const text = await response.text();
      body = text.length > MAX_BODY_CHARS ? text.slice(0, MAX_BODY_CHARS) : text;
    } catch (error) {
      const reason = reasonOf(error);
      return err('request-failed', `Request failed for ${normalizedMethod} ${firedPath}: ${reason}`, {
        reason,
      });
    }
    return ok({ status: response.status, durationMs: Date.now() - firedAt, body });
  }
}
