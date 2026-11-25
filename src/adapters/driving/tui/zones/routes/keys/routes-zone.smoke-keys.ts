// tui/zones/routes: routes-zone.smoke-keys — the smoke run's keys: `t` (from the Favorites pane or the table) starts a run,
// the mutating confirm (Enter includes them, Esc runs the safe ones only) and the table's own keys while it replaces the
// Favorites list (arrows/`j`/`k` move, `Enter` opens the row's route, `Esc` cancels a run in flight or closes the table, Tab leaves).
import type { Key } from 'ink';
import type { RoutesZoneCtx } from '../routes-zone.ctx.js';
import { resolveFocusStep } from '../../../shared/keys/focus-navigation.js';
import { moveFavoriteCursor, resolveFavoriteSelection } from '../logic/routes-favorites.logic.js';
import { nextListFocus } from '../logic/routes-recent.logic.js';
import { formatSmokeRow, mutatingFavoriteLabels, resolveTopPaneRows } from '../logic/routes-smoke.logic.js';
import { resolveRoutesDirection } from '../logic/routes-zone.logic.js';

function launchSmokeRun(c: RoutesZoneCtx, includeMutating: boolean): void {
  const { startSmokeRun, setFavNotice, setSmokeCursor } = c;
  setFavNotice(null);
  setSmokeCursor(0);
  void startSmokeRun(includeMutating).then(
    (result) => {
      if (!result.ok) {
        setFavNotice(result.error.message);
      }
    },
    (error: unknown) => setFavNotice(error instanceof Error ? error.message : String(error)),
  );
}

// `t`: starts a run over the displayed repo's favorites. Rejected (notice) while one is in flight,
// and with no favorites; mutating favorites first go through the confirm dialog.
export function requestSmokeRun(c: RoutesZoneCtx): void {
  const { useStore, favorites, setFavNotice, setSmokeConfirm } = c;
  if (useStore.getState().smoke?.running === true) {
    setFavNotice('smoke run already in progress');
    return;
  }
  if (favorites.length === 0) {
    setFavNotice('no favorites');
    return;
  }
  const mutating = mutatingFavoriteLabels(favorites);
  if (mutating.length > 0) {
    setFavNotice(null);
    setSmokeConfirm({ routes: mutating });
    return;
  }
  launchSmokeRun(c, false);
}

// The mutating confirm owns every key: Enter fires the listed routes too, Esc runs the safe ones only.
export function handleSmokeConfirmKey(c: RoutesZoneCtx, _input: string, key: Key): void {
  const { setSmokeConfirm } = c;
  if (key.return === true) {
    setSmokeConfirm(null);
    launchSmokeRun(c, true);
    return;
  }
  if (key.escape === true) {
    setSmokeConfirm(null);
    launchSmokeRun(c, false);
  }
}

// `Enter` on a row: a fired row opens its route on Response with that fire's response kept as the
// route's last one; a skipped / errored / unfinished row opens Request with a notice saying why.
function openSmokeRow(c: RoutesZoneCtx): void {
  const { smokeRows, clampedSmokeCursor, routes, visibleRoutes, setSelected, setFilter, openPaneForRoute, setPaneTab, keepSmokeResponse, setFavNotice } = c;
  const entry = smokeRows[clampedSmokeCursor];
  if (entry === undefined) {
    return;
  }
  const target = resolveFavoriteSelection(routes, visibleRoutes, entry);
  if (target === undefined) {
    setFavNotice('not in the route list');
    return;
  }
  if (target.clearFilter) {
    setFilter({ value: '', cursor: 0 });
  }
  setSelected(target.index);
  if (entry.response !== undefined && keepSmokeResponse(clampedSmokeCursor)) {
    setFavNotice(null);
    openPaneForRoute(target.route);
    setPaneTab('response');
    return;
  }
  openPaneForRoute(target.route);
  setFavNotice(`no response: ${formatSmokeRow(entry).meta}`);
}

export function handleSmokeKey(c: RoutesZoneCtx, input: string, key: Key): void {
  const { smoke, smokeRows, clampedSmokeCursor, setSmokeCursor, setFavNotice, setPaneFocus, cancelSmokeRun, closeSmoke, windowSize, favorites, recents } = c;
  if (key.escape === true) {
    setFavNotice(null);
    if (smoke?.running === true) {
      cancelSmokeRun();
    } else {
      closeSmoke();
    }
    return;
  }
  const step = resolveFocusStep(input, key, 'tab');
  if (step !== null) {
    setFavNotice(null);
    const rows = resolveTopPaneRows(windowSize.rows, favorites.length, recents.length, smokeRows.length);
    setPaneFocus(nextListFocus('favorites', step, { favorites: rows.total > 0, recent: rows.recent.total > 0 }));
    return;
  }
  if (key.ctrl === true || key.meta === true) {
    return;
  }
  if (input === 't' || input === 'T') {
    requestSmokeRun(c);
    return;
  }
  const direction = resolveRoutesDirection(key) ?? (input === 'j' ? 'down' : input === 'k' ? 'up' : null);
  if (direction !== null) {
    setFavNotice(null);
    setSmokeCursor(moveFavoriteCursor(clampedSmokeCursor, direction, smokeRows.length));
    return;
  }
  if (key.return === true) {
    openSmokeRow(c);
  }
}
