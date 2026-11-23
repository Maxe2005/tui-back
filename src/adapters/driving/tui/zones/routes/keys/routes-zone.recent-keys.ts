// tui/zones/routes: routes-zone.recent-keys — the Recent section's keys while it holds focus (arrows/`j`/`k` move,
// `Enter` opens the route's Request step without firing, `Ctrl+R` re-fires its draft, `Esc` back to the list, Tab cycles).
import type { Key } from 'ink';
import type { RoutesZoneCtx } from '../routes-zone.ctx.js';
import { resolveFocusStep } from '../../../shared/keys/focus-navigation.js';
import { resolveFavoriteSelection } from '../logic/routes-favorites.logic.js';
import { moveRecentCursor } from '../logic/routes-recent.logic.js';
import { resolveRoutesDirection } from '../logic/routes-zone.logic.js';
import { stepListFocus } from './routes-zone.favorites-keys.js';

export function handleRecentKey(c: RoutesZoneCtx, input: string, key: Key): void {
  const {
    recents, clampedRecentCursor, setRecentCursor, setFavNotice, setPaneFocus, routes, visibleRoutes, setSelected,
    setFilter, openPaneForRoute, reFireRoute,
  } = c;
  if (key.escape === true) {
    setFavNotice(null);
    setPaneFocus('list');
    return;
  }
  const step = resolveFocusStep(input, key, 'tab');
  if (step !== null) {
    setFavNotice(null);
    setPaneFocus(stepListFocus(c, 'recent', step));
    return;
  }
  const reFire = key.ctrl === true && (input === 'r' || input === 'R');
  if (!reFire && (key.ctrl === true || key.meta === true)) {
    return;
  }
  const direction = reFire ? null : (resolveRoutesDirection(key) ?? (input === 'j' ? 'down' : input === 'k' ? 'up' : null));
  if (direction !== null) {
    setFavNotice(null);
    setRecentCursor(moveRecentCursor(clampedRecentCursor, direction, recents.length));
    return;
  }
  const focused = recents[clampedRecentCursor];
  if (focused === undefined || (!reFire && key.return !== true)) {
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
  if (reFire) {
    reFireRoute(target.route);
  } else {
    openPaneForRoute(target.route);
  }
}
