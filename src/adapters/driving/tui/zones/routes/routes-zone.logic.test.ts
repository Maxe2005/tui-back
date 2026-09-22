// tui/zones/routes/logic: unit tests for story 6.1's pure Routes helpers — the
// useInput callback itself is never invoked by any test (renderToString's fake stdin never
// emits a keypress), so selection behavior is only verifiable through these functions.
import { describe, expect, it } from 'vitest';
import {
  formatFireError,
  formatFireResult,
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
  it('renders METHOD + path with the summary as meta', () => {
    expect(formatRouteRow({ method: 'GET', path: '/users', summary: 'List users' })).toEqual({
      label: 'GET /users',
      meta: 'List users',
    });
  });

  it('omits meta when the scanner found no summary', () => {
    expect(formatRouteRow({ method: 'DELETE', path: '/users/:id' })).toEqual({
      label: 'DELETE /users/:id',
    });
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
