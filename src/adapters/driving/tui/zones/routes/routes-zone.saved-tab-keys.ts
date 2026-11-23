// tui/zones/routes: routes-zone.saved-tab-keys — Saved sub-tab keys: route-scoped quick re-fire. `/` focuses the filter (the input owns every key while filtering),
// arrows/`j`/`k` move, `Enter` loads into Request, `d` deletes through the confirm, `r` reloads the library,
// `Esc` clears the filter first, then returns to the list.
import type { Key } from 'ink';
import type { RoutesZoneCtx } from './routes-zone.ctx.js';
import {
  clampPickListCursor,
  handleFilterablePickListKey,
  matchPickItemsBySubstring,
} from '../../shared/components/pickers/filterable-pick-list.js';

export function handleSavedTabKey(c: RoutesZoneCtx, input: string, key: Key): void {
  const {
    refreshSavedRequests, savedTabState, setSavedTabState, setSavedTabDeleteConfirm, savedTabItems,
    loadSavedIntoRequest, closePane,
  } = c;
  // One definition: any non-empty query (even whitespace-only) means filtering,
  // so navigation/delete keys stay literal filter text.
  const savedTabFiltering = savedTabState.query !== '';
  if (key.escape === true) {
    if (savedTabFiltering) {
      setSavedTabState((previous) => ({ ...previous, query: '', queryCursor: 0, cursor: 0 }));
      return;
    }
    closePane();
    return;
  }
  // `/` focuses the filter without entering the slash itself; a slash typed while
  // already filtering is literal filter text.
  if (input === '/' && !savedTabFiltering) {
    return;
  }
  if ((input === 'j' || input === 'k') && !savedTabFiltering) {
    const matches = matchPickItemsBySubstring(savedTabState.query, savedTabItems);
    const from = clampPickListCursor(savedTabState.cursor, matches.length);
    const next = input === 'j' ? from + 1 : from - 1;
    setSavedTabState((previous) => ({ ...previous, cursor: clampPickListCursor(next, matches.length) }));
    return;
  }
  if ((input === 'd' || input === 'D') && !savedTabFiltering) {
    const matches = matchPickItemsBySubstring(savedTabState.query, savedTabItems);
    const at = matches[clampPickListCursor(savedTabState.cursor, matches.length)];
    if (at !== undefined) {
      setSavedTabDeleteConfirm({ name: at.value.name });
    }
    return;
  }
  if ((input === 'r' || input === 'R') && !savedTabFiltering) {
    void refreshSavedRequests();
    return;
  }
  if (key.return === true) {
    const matches = matchPickItemsBySubstring(savedTabState.query, savedTabItems);
    const at = matches[clampPickListCursor(savedTabState.cursor, matches.length)];
    if (at === undefined) {
      return;
    }
    void loadSavedIntoRequest(at.value.name);
    return;
  }
  const outcome = handleFilterablePickListKey(savedTabState, savedTabItems, input, key);
  if (outcome.type === 'update') {
    setSavedTabState(outcome.state);
    return;
  }
  if (outcome.type === 'cancel') {
    if (savedTabFiltering) {
      setSavedTabState((previous) => ({ ...previous, query: '', queryCursor: 0, cursor: 0 }));
    } else {
      closePane();
    }
    return;
  }
  // `select` via the shared reducer can only happen on arrows/typing paths here
  // (Enter is handled above to also switch tabs); treat it like an Enter load.
  if (outcome.type === 'select') {
    void loadSavedIntoRequest(outcome.item.value.name);
    return;
  }
  return;
}
