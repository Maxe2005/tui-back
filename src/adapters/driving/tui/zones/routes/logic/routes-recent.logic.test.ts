// tui/zones/routes/logic: routes-recent.logic unit tests.
import { describe, expect, it } from 'vitest';
import type { RecentRoute } from '../../../store/slices/workspace/routes-slice.js';
import {
  formatRecentRow,
  hasBeenFired,
  MAX_RECENT_ROUTES,
  moveRecentCursor,
  nextListFocus,
  upsertRecentRoute,
  visibleRecents,
} from './routes-recent.logic.js';

const recent = (method: string, path: string, repoPath = '/repos/a', status = 200): RecentRoute => ({
  repoPath,
  method,
  path,
  outcome: { kind: 'status', status, durationMs: 42 },
});

describe('upsertRecentRoute', () => {
  it('puts the newest first and moves a repeated route to the top without duplicate', () => {
    let list = upsertRecentRoute([], recent('GET', '/a'));
    list = upsertRecentRoute(list, recent('GET', '/b'));
    list = upsertRecentRoute(list, recent('GET', '/a', '/repos/a', 500));
    expect(list.map((r) => r.path)).toEqual(['/a', '/b']);
    expect(list[0]?.outcome).toMatchObject({ status: 500 });
  });
  it('keeps the last 10 distinct routes', () => {
    let list: RecentRoute[] = [];
    for (let i = 0; i < 13; i += 1) {
      list = upsertRecentRoute(list, recent('GET', `/r${i}`));
    }
    expect(list).toHaveLength(MAX_RECENT_ROUTES);
    expect(list[0]?.path).toBe('/r12');
    expect(list.at(-1)?.path).toBe('/r3');
  });
});

describe('visibleRecents / formatRecentRow / hasBeenFired', () => {
  it('lists only the displayed repo', () => {
    const list = [recent('GET', '/a'), recent('GET', '/b', '/repos/b')];
    expect(visibleRecents(list, '/repos/a').map((r) => r.path)).toEqual(['/a']);
    expect(visibleRecents(list, null)).toEqual([]);
  });
  it('labels a status outcome and an error outcome', () => {
    expect(formatRecentRow(recent('GET', '/a'))).toEqual({ label: 'GET /a', meta: '200 · 42ms' });
    expect(formatRecentRow({ ...recent('GET', '/a'), outcome: { kind: 'error', code: 'auth-error' } })).toEqual({
      label: 'GET /a',
      meta: 'auth-error',
    });
  });
  it('knows a route fired through its response or its recent row', () => {
    expect(hasBeenFired('GET /a', {}, [], '/repos/a')).toBe(false);
    expect(hasBeenFired('GET /a', { 'GET /a': {} }, [], '/repos/a')).toBe(true);
    expect(hasBeenFired('GET /a', {}, [recent('GET', '/a')], '/repos/a')).toBe(true);
    // The same method/path fired in another repo does not count.
    expect(hasBeenFired('GET /a', {}, [recent('GET', '/a', '/repos/b')], '/repos/a')).toBe(false);
  });
});

describe('moveRecentCursor / nextListFocus', () => {
  it('moves within bounds', () => {
    expect(moveRecentCursor(0, 'down', 3)).toBe(1);
    expect(moveRecentCursor(9, 'up', 3)).toBe(1);
  });
  it('cycles list, favorites, recent, skipping panes that are not rendered', () => {
    const both = { favorites: true, recent: true };
    expect(nextListFocus('list', 'next', both)).toBe('favorites');
    expect(nextListFocus('favorites', 'next', both)).toBe('recent');
    expect(nextListFocus('recent', 'next', both)).toBe('list');
    expect(nextListFocus('list', 'back', both)).toBe('recent');
    expect(nextListFocus('favorites', 'next', { favorites: true, recent: false })).toBe('list');
    expect(nextListFocus('list', 'next', { favorites: false, recent: false })).toBe('list');
    // A current focus that is not rendered falls back to the list.
    expect(nextListFocus('recent', 'next', { favorites: true, recent: false })).toBe('list');
    expect(nextListFocus('favorites', 'back', { favorites: false, recent: true })).toBe('list');
  });
});
