// tui/zones/routes: routes-zone.list-keys — key handlers for the route list: the inline filter input while editing, and the list-focused shortcuts (e / f / p / Enter / jumps / arrows).
import type { Key } from 'ink';
import type { RoutesZoneCtx } from '../routes-zone.ctx.js';
import { canEditRouteBody } from '../../../shared/components/json-tree/model.js';
import { jumpSelection, resolveSelectionJump } from '../../../shared/keys/list-cursor.js';
import { moveRoutesSelection, resolveEnterFireTarget, resolveRoutesDirection } from '../logic/routes-zone.logic.js';
import { resolveFocusStep } from '../../../shared/keys/focus-navigation.js';
import { resolveFavoritesPaneRows } from '../logic/routes-favorites.logic.js';
import { toggleRouteFavorite } from './routes-zone.favorites-keys.js';
import { nextTextInputValue } from '../../../shared/components/inputs/text-edit.js';

export function handleFilterEditingKey(c: RoutesZoneCtx, input: string, key: Key): void {
  const { setSelected, filter, setFilter, setFilterEditing, visibleRoutes } = c;
  // Esc drops the filter entirely; Enter keeps it applied and hands the keyboard back
  // to the list (so Enter never fires a route while the input is still open).
  if (key.escape === true) {
    setFilter({ value: '', cursor: 0 });
    setFilterEditing(false);
    setSelected(0);
    return;
  }
  if (key.return === true) {
    setFilterEditing(false);
    return;
  }
  const direction = resolveRoutesDirection(key);
  if (direction !== null) {
    setSelected((prev) => moveRoutesSelection(prev, direction, visibleRoutes.length));
    return;
  }
  const next = nextTextInputValue(filter, input, key);
  if (next.value !== filter.value) {
    setSelected(0);
  }
  setFilter(next);
  return;
}

export function handleListKey(c: RoutesZoneCtx, input: string, key: Key): void {
  const { selected, setSelected, filter, setFilter, setFilterEditing, visibleRoutes, openPicker, openPaneForRoute, setPaneFocus, setFavNotice, windowSize, favorites } = c;
  // `e` opens the pane straight on the Body section for a route that carries a body (an
  // example or any content type — non-JSON starts empty); routes with neither stay inert
  // with no hint.
  if (input === 'e' || input === 'E') {
    const target = resolveEnterFireTarget(visibleRoutes, selected);
    if (target !== undefined && canEditRouteBody(target)) {
      openPaneForRoute(target, 'body');
    }
    return;
  }
  // `f` opens the route filter exactly like `/` (mnemonic: filter) — only on the
  // list: while the response tree holds focus, `f`/`F` belong to its rules panel.
  if (input === '/' || input === 'f') {
    setFilter((prev) => ({ ...prev, cursor: prev.value.length }));
    setFilterEditing(true);
    return;
  }
  // `p` opens the saved-request picker: Enter reloads a fresh row into the Request tab
  // (stale rows render flagged and never load), `d` on a stale row deletes it. Not `s`:
  // that is the shared-types zone mnemonic and switches zone.
  if ((input === 'p' || input === 'P') && key.ctrl !== true && key.meta !== true) {
    openPicker();
    return;
  }
  // `*` toggles the cursor route as a favorite of the active EDT.
  if (input === '*' && key.ctrl !== true && key.meta !== true) {
    const target = resolveEnterFireTarget(visibleRoutes, selected);
    if (target !== undefined) {
      toggleRouteFavorite(c, target.method, target.path);
    }
    return;
  }
  // Tab / Shift+Tab moves the keyboard to the Favorites pane above the list.
  // Inert while the pane is not rendered (small terminal): focus must never land on nothing.
  if (resolveFocusStep(input, key, 'tab') !== null) {
    if (resolveFavoritesPaneRows(windowSize.rows, favorites.length).total === 0) {
      return;
    }
    setFavNotice(null);
    setPaneFocus('favorites');
    return;
  }
  if (key.escape === true && filter.value !== '') {
    setFilter({ value: '', cursor: 0 });
    setSelected(0);
    return;
  }
  // Enter opens the route's Request tab — the request step is mandatory, the list never
  // fires directly.
  if (key.return === true) {
    const target = resolveEnterFireTarget(visibleRoutes, selected);
    if (target !== undefined) {
      openPaneForRoute(target);
    }
    return;
  }
  const jump = resolveSelectionJump(key);
  if (jump !== null) {
    setSelected(jumpSelection(jump, visibleRoutes.length));
    return;
  }
  const direction = resolveRoutesDirection(key);
  if (direction !== null) {
    setSelected((prev) => moveRoutesSelection(prev, direction, visibleRoutes.length));
  }
}
