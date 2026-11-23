// tui/zones/routes: routes-zone.favorites-keys — the Favorites pane's keys while it holds focus (arrows/`j`/`k` move, `Enter` opens the route's Request step,
// `*`/`d` remove, `Esc`/Tab back to the list) and the shared `*` toggle used by the list and the right pane.
import type { Key } from 'ink';
import type { RoutesZoneCtx } from '../routes-zone.ctx.js';
import { resolveFocusStep } from '../../../shared/keys/focus-navigation.js';
import { moveFavoriteCursor, resolveFavoriteSelection, resolveFavoritesPaneRows } from '../logic/routes-favorites.logic.js';
import { nextListFocus } from '../logic/routes-recent.logic.js';
import { resolveRoutesDirection } from '../logic/routes-zone.logic.js';

// Toggles one route's favorite flag; the pane updates at once (the store refreshes its cache),
// a failure only shows a notice and changes nothing.
export function toggleRouteFavorite(c: RoutesZoneCtx, method: string, path: string, repoPath?: string): void {
  const { toggleFavoriteRoute, setFavNotice } = c;
  void toggleFavoriteRoute(method, path, repoPath).then(
    (result) => setFavNotice(result.ok ? null : `not saved: ${result.error.message}`),
    (error: unknown) => setFavNotice(`not saved: ${error instanceof Error ? error.message : String(error)}`),
  );
}

// Where the next/previous Tab stop lands from a list-side focus; rendered panes only.
export function stepListFocus(c: RoutesZoneCtx, current: 'list' | 'favorites' | 'recent', direction: 'next' | 'back') {
  const rows = resolveFavoritesPaneRows(c.windowSize.rows, c.favorites.length, c.recents.length);
  return nextListFocus(current, direction, { favorites: rows.total > 0, recent: rows.recent.total > 0 });
}

export function handleFavoritesKey(c: RoutesZoneCtx, input: string, key: Key): void {
  const {
    favorites, clampedFavCursor, setFavCursor, setFavNotice, setPaneFocus, routes, visibleRoutes, setSelected, setFilter,
    openPaneForRoute, reFireRoute,
  } = c;
  if (key.escape === true) {
    setFavNotice(null);
    setPaneFocus('list');
    return;
  }
  const step = resolveFocusStep(input, key, 'tab');
  if (step !== null) {
    setFavNotice(null);
    setPaneFocus(stepListFocus(c, 'favorites', step));
    return;
  }
  if (key.ctrl === true && (input === 'r' || input === 'R')) {
    const row = favorites[clampedFavCursor];
    if (row === undefined) {
      return;
    }
    if (row.stale) {
      setFavNotice('stale: no longer discovered, * removes it');
      return;
    }
    const target = resolveFavoriteSelection(routes, visibleRoutes, row);
    if (target === undefined) {
      setFavNotice('not in the route list');
      return;
    }
    setFavNotice(null);
    if (target.clearFilter) {
      setFilter({ value: '', cursor: 0 });
    }
    setSelected(target.index);
    reFireRoute(target.route);
    return;
  }
  if (key.ctrl === true || key.meta === true) {
    return;
  }
  const direction = resolveRoutesDirection(key) ?? (input === 'j' ? 'down' : input === 'k' ? 'up' : null);
  if (direction !== null) {
    setFavNotice(null);
    setFavCursor(moveFavoriteCursor(clampedFavCursor, direction, favorites.length));
    return;
  }
  const focused = favorites[clampedFavCursor];
  if (focused === undefined) {
    return;
  }
  if (input === '*' || input === 'd' || input === 'D') {
    toggleRouteFavorite(c, focused.method, focused.path, focused.repoPath);
    return;
  }
  if (key.return === true) {
    if (focused.stale) {
      setFavNotice('stale: no longer discovered, * removes it');
      return;
    }
    const target = resolveFavoriteSelection(routes, visibleRoutes, focused);
    if (target === undefined) {
      setFavNotice('not in the route list');
      return;
    }
    setFavNotice(null);
    if (target.clearFilter) {
      setFilter({ value: '', cursor: 0 });
    }
    setSelected(target.index);
    openPaneForRoute(target.route);
  }
}
