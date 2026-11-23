// tui/zones/routes/logic: routes-favorites.logic unit tests.
import { describe, expect, it } from 'vitest';
import type { FavoriteWithStale } from '../../../../../../core/insight/routes/favorites.js';
import type { Route } from '../../../../../../core/ports/modules/route-scanner.js';
import {
  clampFavoriteCursor,
  formatFavoriteRow,
  isFavorite,
  moveFavoriteCursor,
  resolveFavoriteSelection,
  resolveFavoritesPaneRows,
  visibleFavorites,
} from './routes-favorites.logic.js';

const fav = (repoPath: string, method: string, path: string, stale = false): FavoriteWithStale => ({ repoPath, method, path, stale });
const routes: Route[] = [
  { method: 'GET', path: '/users', summary: 'List users' },
  { method: 'POST', path: '/users' },
  { method: 'GET', path: '/orders' },
];

describe('visibleFavorites / isFavorite', () => {
  const favorites = [fav('/repos/a', 'GET', '/users'), fav('/repos/b', 'GET', '/users')];
  it('lists only the displayed repo favorites', () => {
    expect(visibleFavorites(favorites, '/repos/a')).toEqual([favorites[0]]);
    expect(visibleFavorites(favorites, '/repos/a/')).toEqual([favorites[0]]);
    expect(visibleFavorites(favorites, null)).toEqual([]);
    expect(visibleFavorites(null, '/repos/a')).toEqual([]);
  });
  it('matches identity on repo, method and path (one trailing slash ignored)', () => {
    expect(isFavorite(favorites, '/repos/a', 'get', '/users/')).toBe(true);
    expect(isFavorite(favorites, '/repos/a', 'POST', '/users')).toBe(false);
    expect(isFavorite(favorites, '/repos/c', 'GET', '/users')).toBe(false);
  });
});

describe('formatFavoriteRow', () => {
  it('shows METHOD path and the route summary', () => {
    expect(formatFavoriteRow(fav('/repos/a', 'GET', '/users'), routes)).toEqual({ label: 'GET /users  List users', stale: false });
    expect(formatFavoriteRow(fav('/repos/a', 'POST', '/users'), routes)).toEqual({ label: 'POST /users', stale: false });
  });
  it('marks a stale favorite with a dim suffix', () => {
    expect(formatFavoriteRow(fav('/repos/a', 'GET', '/gone', true), routes)).toEqual({ label: 'GET /gone', meta: 'stale', stale: true });
  });
});

describe('cursor', () => {
  it('clamps and moves within bounds', () => {
    expect(clampFavoriteCursor(5, 3)).toBe(2);
    expect(clampFavoriteCursor(-1, 3)).toBe(0);
    expect(clampFavoriteCursor(2, 0)).toBe(0);
    expect(moveFavoriteCursor(0, 'up', 3)).toBe(0);
    expect(moveFavoriteCursor(1, 'down', 3)).toBe(2);
    expect(moveFavoriteCursor(2, 'down', 3)).toBe(2);
    expect(moveFavoriteCursor(7, 'up', 3)).toBe(1);
  });
});

describe('resolveFavoritesPaneRows', () => {
  it('caps the pane on a tall terminal and fits the favorites count', () => {
    expect(resolveFavoritesPaneRows(60, 20)).toEqual({ total: 6, body: 5, recent: { total: 0, body: 0 } });
    expect(resolveFavoritesPaneRows(60, 2)).toEqual({ total: 3, body: 2, recent: { total: 0, body: 0 } });
    expect(resolveFavoritesPaneRows(60, 0)).toEqual({ total: 2, body: 1, recent: { total: 0, body: 0 } });
  });
  it('gives the Recent section only what the favorites leave, shrinking it first', () => {
    expect(resolveFavoritesPaneRows(60, 2, 20)).toEqual({ total: 3, body: 2, recent: { total: 6, body: 5 } });
    expect(resolveFavoritesPaneRows(60, 2, 2)).toEqual({ total: 3, body: 2, recent: { total: 3, body: 2 } });
    // spare = 22 - 9 - 4 = 9: favorites keep their 6 rows, recent gets the remaining 3.
    expect(resolveFavoritesPaneRows(22, 20, 4)).toEqual({ total: 6, body: 5, recent: { total: 3, body: 2 } });
    expect(resolveFavoritesPaneRows(19, 20, 4)).toEqual({ total: 6, body: 5, recent: { total: 0, body: 0 } });
  });
  it('shrinks to the header, then to nothing, so the list keeps its minimum rows', () => {
    expect(resolveFavoritesPaneRows(14, 3)).toEqual({ total: 1, body: 0, recent: { total: 0, body: 0 } });
    expect(resolveFavoritesPaneRows(15, 3)).toEqual({ total: 2, body: 1, recent: { total: 0, body: 0 } });
    expect(resolveFavoritesPaneRows(13, 3)).toEqual({ total: 0, body: 0, recent: { total: 0, body: 0 } });
    expect(resolveFavoritesPaneRows(5, 3)).toEqual({ total: 0, body: 0, recent: { total: 0, body: 0 } });
  });
});

describe('resolveFavoriteSelection', () => {
  it('finds the favorite in the visible list', () => {
    const visible = [routes[1] as Route, routes[0] as Route];
    expect(resolveFavoriteSelection(routes, visible, fav('/r', 'GET', '/users'))).toEqual({ route: routes[0], index: 1, clearFilter: false });
  });
  it('clears the filter when it hides the favorite', () => {
    expect(resolveFavoriteSelection(routes, [routes[1] as Route], fav('/r', 'GET', '/orders'))).toEqual({
      route: routes[2],
      index: 2,
      clearFilter: true,
    });
  });
  it('is undefined for a route that is no longer discovered', () => {
    expect(resolveFavoriteSelection(routes, routes, fav('/r', 'GET', '/gone', true))).toBeUndefined();
  });
});
