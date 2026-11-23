// tui/zones/routes: routes-zone.favorites-keys — the Favorites pane's keys while it holds focus (arrows/`j`/`k` move, `Enter` opens the route's Request step,
// `*`/`d` remove, `Esc`/Tab back to the list) and the shared `*` toggle used by the list and the right pane.
import type { Key } from 'ink';
import type { RoutesZoneCtx } from '../routes-zone.ctx.js';
import { resolveFocusStep } from '../../../shared/keys/focus-navigation.js';
import { moveFavoriteCursor, resolveFavoriteSelection } from '../logic/routes-favorites.logic.js';
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

export function handleFavoritesKey(c: RoutesZoneCtx, input: string, key: Key): void {
  const {
    favorites, clampedFavCursor, setFavCursor, setFavNotice, setPaneFocus, routes, visibleRoutes, setSelected, setFilter,
    openPaneForRoute,
  } = c;
  if (key.escape === true || resolveFocusStep(input, key, 'tab') !== null) {
    setFavNotice(null);
    setPaneFocus('list');
    return;
  }
  if (key.ctrl === true || key.meta === true) {
    return;
  }
  const direction = resolveRoutesDirection(key) ?? (input === 'j' ? 'down' : input === 'k' ? 'up' : null);
  if (direction !== null) {
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
