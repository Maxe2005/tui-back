// tui/zones/routes/logic: unit tests for story 6.1's pure Routes helpers — the
// useInput callback itself is never invoked by any test (renderToString's fake stdin never
// emits a keypress), so selection behavior is only verifiable through these functions.
import { describe, expect, it } from 'vitest';
import {
  formatFireError,
  filterRoutes,
  formatFireResult,
  formatFireStatus,
  formatRouteDetail,
  formatRouteRow,
  moveRoutesSelection,
  resolveEnterFireTarget,
  resolveRoutesDirection,
} from './routes-zone.logic.js';

describe('resolveRoutesDirection', () => {
  it('maps Down/Up arrows to down/up and nothing else to null', () => {
    expect(resolveRoutesDirection({ downArrow: true })).toBe('down');
    expect(resolveRoutesDirection({ upArrow: true })).toBe('up');
    expect(resolveRoutesDirection({})).toBeNull();
    expect(resolveRoutesDirection({ upArrow: false, downArrow: false })).toBeNull();
  });
});

describe('moveRoutesSelection', () => {
  it('moves within bounds and clamps at both ends', () => {
    expect(moveRoutesSelection(0, 'down', 3)).toBe(1);
    expect(moveRoutesSelection(1, 'up', 3)).toBe(0);
    expect(moveRoutesSelection(2, 'down', 3)).toBe(2);
    expect(moveRoutesSelection(0, 'up', 3)).toBe(0);
  });

  it('stays at zero for an empty list', () => {
    expect(moveRoutesSelection(0, 'down', 0)).toBe(0);
  });
});

describe('formatRouteRow', () => {
  it('renders only METHOD + path — the summary never rides in the list row', () => {
    expect(formatRouteRow({ method: 'GET', path: '/users', summary: 'List users' })).toEqual({ label: 'GET /users' });
    expect(formatRouteRow({ method: 'DELETE', path: '/users/:id' })).toEqual({ label: 'DELETE /users/:id' });
  });
});

describe('filterRoutes', () => {
  const routes = [
    { method: 'GET', path: '/users/{id}', summary: 'Fetch a user' },
    { method: 'POST', path: '/users' },
    { method: 'GET', path: '/orders' },
  ];

  it('returns every route for an empty or blank query', () => {
    expect(filterRoutes(routes, '')).toEqual(routes);
    expect(filterRoutes(routes, '   ')).toEqual(routes);
  });

  it('matches case-insensitively on the method and the path', () => {
    expect(filterRoutes(routes, 'post')).toEqual([routes[1]]);
    expect(filterRoutes(routes, 'ORDERS')).toEqual([routes[2]]);
  });

  it('requires every whitespace-separated term to match', () => {
    expect(filterRoutes(routes, 'get user')).toEqual([routes[0]]);
    expect(filterRoutes(routes, 'get zzz')).toEqual([]);
  });

  it('does not match on the hidden summary', () => {
    expect(filterRoutes(routes, 'fetch')).toEqual([]);
  });
});

describe('formatRouteDetail', () => {
  it('joins method, path, and summary into one Text-safe string', () => {
    expect(formatRouteDetail({ method: 'POST', path: '/users', summary: 'Create a user' })).toBe(
      'POST /users\n\nCreate a user',
    );
  });

  it('names the missing summary instead of rendering blank', () => {
    expect(formatRouteDetail({ method: 'GET', path: '/health' })).toContain('No summary available.');
  });
});

describe('formatFireResult (story 6.2)', () => {
  it('joins status, duration, and body into one Text-safe string', () => {
    expect(formatFireResult({ status: 200, durationMs: 42, body: '{"id":1}' })).toBe('200 · 42ms\n\n{"id":1}');
  });
});

describe('formatFireStatus (story 6.7)', () => {
  it('keeps the status line while the body dump moves into the JsonTree', () => {
    expect(formatFireStatus({ status: 200, durationMs: 42, body: '{"id":1}' })).toBe('200 · 42ms · 8 B');
    // Story 6.9: a body at core's cap marks the size as a lower bound.
    expect(formatFireStatus({ status: 200, durationMs: 1, body: 'x'.repeat(64 * 1024) })).toBe('200 · 1ms · ≥64.0 KB');
  });
});

describe('formatFireError (story 6.2)', () => {
  it('renders auth failures distinctly from generic failures', () => {
    expect(formatFireError('auth-unauthorized', 'rejected')).toContain('Auth failed');
    expect(formatFireError('auth-forbidden', 'denied')).toContain('Access forbidden');
    expect(formatFireError('auth-endpoint-failed', 'down')).toContain('Dev auth is unreachable');
  });

  it('renders non-auth fire errors human-friendly instead of raw', () => {
    expect(formatFireError('missing-base-url', 'no baseUrl')).toContain('No dev server configured');
    expect(formatFireError('unknown-route', 'no such route')).toContain('Unknown route');
    expect(formatFireError('route-scan-failed', 'bad spec')).toContain('Route scan failed');
    expect(formatFireError('request-failed', 'refused')).toContain('Request failed');
    expect(formatFireError('manifest-not-found', 'gone')).toContain('Manifest problem');
  });

  it('passes any other error message through untouched', () => {
    expect(formatFireError('internal-error', 'boom')).toBe('boom');
  });
});

describe('resolveEnterFireTarget (story 6.2 review)', () => {
  const routes = [
    { method: 'GET', path: '/users' },
    { method: 'POST', path: '/users' },
  ];

  it('returns the selected route to fire with its method + path', () => {
    expect(resolveEnterFireTarget(routes, 1)).toEqual({ method: 'POST', path: '/users' });
  });

  it('clamps a stale cursor onto the last route', () => {
    expect(resolveEnterFireTarget(routes, 99)).toEqual({ method: 'POST', path: '/users' });
  });

  it('returns undefined for an empty or missing list, so Enter fires nothing', () => {
    expect(resolveEnterFireTarget([], 0)).toBeUndefined();
    expect(resolveEnterFireTarget(null, 0)).toBeUndefined();
    expect(resolveEnterFireTarget(undefined, 0)).toBeUndefined();
  });
});
