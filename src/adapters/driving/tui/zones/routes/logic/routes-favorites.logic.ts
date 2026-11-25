// tui/zones/routes/logic: the Favorites pane's pure logic — repo filtering, identity, row label,
// cursor movement, height budget and favorite -> list-route resolution. Kept out of the zone so
// every keystroke outcome is unit-testable without Ink.
import { resolve } from 'node:path';
import type { FavoriteWithStale } from '../../../../../../core/insight/routes/favorites.js';
import type { Route } from '../../../../../../core/ports/modules/route-scanner.js';
import { ROUTES_FAVORITES_MAX_BODY_ROWS, ROUTES_LIST_CHROME_ROWS, ROUTES_MIN_LIST_ROWS } from '../routes-zone.constants.js';
import { moveRoutesSelection, type RoutesSelectionDirection } from './routes-zone.logic.js';

export const FAVORITES_TEACHING_LINE = 'press * on a route to add it';

// One trailing slash is not part of a route's identity (same rule as the core favorites).
function normalizePath(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

function samePath(a: string, b: string): boolean {
  return normalizePath(a) === normalizePath(b);
}

function sameRepo(a: string, b: string): boolean {
  return resolve(a) === resolve(b);
}

// Only the favorites of the displayed repo are listed; null/unknown repo lists nothing.
export function visibleFavorites(
  favorites: readonly FavoriteWithStale[] | null | undefined,
  repoPath: string | null,
): FavoriteWithStale[] {
  if (favorites === null || favorites === undefined || repoPath === null) {
    return [];
  }
  return favorites.filter((favorite) => sameRepo(favorite.repoPath, repoPath));
}

export function isFavorite(
  favorites: readonly FavoriteWithStale[] | null | undefined,
  repoPath: string | null,
  method: string,
  path: string,
): boolean {
  return visibleFavorites(favorites, repoPath).some(
    (favorite) => favorite.method === method.toUpperCase() && samePath(favorite.path, path),
  );
}

// `METHOD path  summary` (summary from the discovered route, when there is one). A stale
// favorite has no route to take a summary from and carries a dim `stale` suffix.
export function formatFavoriteRow(
  favorite: FavoriteWithStale,
  routes: readonly Route[] | null | undefined,
): { label: string; meta?: string; stale: boolean } {
  const route = (routes ?? []).find((candidate) => candidate.method === favorite.method && samePath(candidate.path, favorite.path));
  const summary = route?.summary?.replace(/\s+/g, ' ').trim();
  const base = `${favorite.method} ${favorite.path}`;
  const label = summary !== undefined && summary !== '' ? `${base}  ${summary}` : base;
  return favorite.stale ? { label: base, meta: 'stale', stale: true } : { label, stale: false };
}

export function clampFavoriteCursor(cursor: number, length: number): number {
  return length === 0 ? 0 : Math.min(Math.max(cursor, 0), length - 1);
}

export function moveFavoriteCursor(current: number, direction: RoutesSelectionDirection, length: number): number {
  return moveRoutesSelection(clampFavoriteCursor(current, length), direction, length);
}

// The pane's row budget on a terminal of `windowRows` rows: `total` rows (header included) and the
// `body` rows of its BoundedList / teaching line. The list below keeps at least
// ROUTES_MIN_LIST_ROWS rows; with no spare room the pane shrinks to its header line, then to nothing.
// The Recent section below it (`recent`, 0 rows when `recentCount` is 0) only gets what the
// favorites leave: it shrinks first, then disappears; favorites keep priority.
export function resolveFavoritesPaneRows(
  windowRows: number,
  favoriteCount: number,
  recentCount = 0,
  maxBodyRows = ROUTES_FAVORITES_MAX_BODY_ROWS,
): { total: number; body: number; recent: { total: number; body: number } } {
  const none = { total: 0, body: 0 };
  const spare = Math.floor(windowRows) - ROUTES_LIST_CHROME_ROWS - ROUTES_MIN_LIST_ROWS;
  if (!(spare >= 1)) {
    return { ...none, recent: none };
  }
  const body = Math.min(maxBodyRows, Math.max(favoriteCount, 1), spare - 1);
  const total = body + 1;
  const remaining = spare - total;
  if (recentCount <= 0 || remaining < 2) {
    return { total, body, recent: none };
  }
  const recentBody = Math.min(ROUTES_FAVORITES_MAX_BODY_ROWS, recentCount, remaining - 1);
  return { total, body, recent: { total: recentBody + 1, body: recentBody } };
}

export type FavoriteSelection = {
  route: Route;
  // Index of the route in the list that will be displayed once `clearFilter` is applied.
  index: number;
  clearFilter: boolean;
};

// Where `Enter` on a favorite lands: its row in the (filtered) list, or — when the filter hides
// it — in the full list with the filter cleared. Undefined when the route is not discovered
// (a stale favorite).
export function resolveFavoriteSelection(
  routes: readonly Route[] | null | undefined,
  visibleRoutes: readonly Route[],
  favorite: Pick<FavoriteWithStale, 'method' | 'path'>,
): FavoriteSelection | undefined {
  const matches = (route: Route) => route.method === favorite.method && samePath(route.path, favorite.path);
  const visibleIndex = visibleRoutes.findIndex(matches);
  if (visibleIndex !== -1) {
    return { route: visibleRoutes[visibleIndex] as Route, index: visibleIndex, clearFilter: false };
  }
  const all = routes ?? [];
  const index = all.findIndex(matches);
  return index === -1 ? undefined : { route: all[index] as Route, index, clearFilter: true };
}
