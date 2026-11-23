// tui/zones/routes: routes-zone.overlay-keys — key handlers of the modal overlays (overwrite / delete confirms, save-name prompt, saved picker). Each owns every key while open;
// the dispatcher in use-routes-input.ts tests them in the original priority order.
import type { Key } from 'ink';
import type { RoutesZoneCtx } from '../routes-zone.ctx.js';
import {
  clampPickListCursor,
  handleFilterablePickListKey,
  matchPickItemsBySubstring,
} from '../../../shared/components/pickers/filterable-pick-list.js';
import { nextTextInputValue } from '../../../shared/components/inputs/text-edit.js';
import { resolveRouteIndex } from '../routes-request.logic.js';
import { routeKeyFor } from '../../../shared/components/json-tree/model.js';

// The destructive overwrite confirm owns every key: Enter overwrites, Esc backs out to the name
// prompt, nothing else acts.
export function handleOverwriteConfirmKey(c: RoutesZoneCtx, input: string, key: Key): void {
  const { setOverwriteConfirm, attemptSave } = c;
  if (key.escape === true) {
    setOverwriteConfirm(null);
    return;
  }
  if (key.return === true) {
    attemptSave(true);
    return;
  }
  return;
}

// The stale-row delete confirm owns every key the same way.
export function handlePickerDeleteConfirmKey(c: RoutesZoneCtx, pickerDeleteConfirm: NonNullable<RoutesZoneCtx['pickerDeleteConfirm']>, input: string, key: Key): void {
  const { refreshSavedRequests, deleteSavedRequest, setPickerError, setPickerDeleteConfirm } = c;
  if (key.escape === true) {
    setPickerDeleteConfirm(null);
    return;
  }
  if (key.return === true) {
    const target = pickerDeleteConfirm.name;
    void (async () => {
      const result = await deleteSavedRequest(target);
      setPickerDeleteConfirm(null);
      if (!result.ok) {
        setPickerError(result.error.message);
      } else {
        // The row is gone: drop any error line naming it (e.g. the stale-block note).
        setPickerError(null);
      }
      void refreshSavedRequests();
    })();
    return;
  }
  return;
}

// The Saved sub-tab's delete confirm: Enter deletes the route-scoped row, Esc backs out to the tab.
export function handleSavedTabDeleteConfirmKey(c: RoutesZoneCtx, savedTabDeleteConfirm: NonNullable<RoutesZoneCtx['savedTabDeleteConfirm']>, input: string, key: Key): void {
  const {
    useStore, refreshSavedRequests, deleteSavedRequest, savedTabState, setSavedTabState, setSavedTabError,
    setSavedTabDeleteConfirm, paneRouteKey,
  } = c;
  if (key.escape === true) {
    setSavedTabDeleteConfirm(null);
    return;
  }
  if (key.return === true) {
    const target = savedTabDeleteConfirm.name;
    const query = savedTabState.query;
    const routeKey = paneRouteKey;
    void (async () => {
      const result = await deleteSavedRequest(target);
      setSavedTabDeleteConfirm(null);
      if (!result.ok) {
        setSavedTabError(result.error.message);
      } else {
        setSavedTabError(null);
      }
      await refreshSavedRequests();
      // Re-clamp against the refreshed match list: the pre-delete length can leave
      // the cursor past the end when the last row goes.
      const live = useStore.getState().savedRequests ?? [];
      const liveItems = live
        .filter((request) => routeKey !== null && routeKeyFor(request.method, request.path) === routeKey)
        .map((request) => ({ key: request.id, label: request.name, value: request }));
      const liveMatches = matchPickItemsBySubstring(query, liveItems);
      setSavedTabState((previous) => ({ ...previous, cursor: clampPickListCursor(previous.cursor, liveMatches.length) }));
    })();
    return;
  }
  return;
}

// The inline name prompt owns every key: Enter saves (a colliding name stays put with an inline
// error until Ctrl+O), Esc closes, arrows/tab never leave the field. Ctrl+O is offered only for a
// confirmed duplicate — any other error re-saves with Enter.
export function handleSavePromptKey(c: RoutesZoneCtx, savePrompt: NonNullable<RoutesZoneCtx['savePrompt']>, input: string, key: Key): void {
  const { setSavePrompt, setOverwriteConfirm, attemptSave } = c;
  if (key.escape === true) {
    setSavePrompt(null);
    return;
  }
  if (key.ctrl === true && (input === 'o' || input === 'O')) {
    if (savePrompt.duplicate) {
      setOverwriteConfirm({ name: savePrompt.input.value });
    }
    return;
  }
  if (key.return === true) {
    attemptSave(false);
    return;
  }
  if (key.upArrow === true || key.downArrow === true || key.tab === true) {
    return;
  }
  if (key.ctrl === true || key.meta === true) {
    return;
  }
  // Editing restarts the attempt: a stale collision error never follows a new name.
  setSavePrompt((previous) =>
    previous === null
      ? previous
      : { input: nextTextInputValue(previous.input, input, key), error: null, duplicate: false },
  );
  return;
}

// The saved picker owns every key while open: Esc closes, `d` on a stale row (with an empty filter —
// while filtering, the input owns every key) asks to delete it, Enter loads a fresh row (a stale row
// is blocked with an error line), and everything else filters. Loading first moves the list cursor
// onto the saved request's route — the pane always reflects the cursor — clearing the list filter
// when it hides that route; a route from another repo cannot load here and stays in the picker
// with an error line.
export function handlePickerKey(c: RoutesZoneCtx, input: string, key: Key): void {
  const {
    routes, setPaneFocus, setPaneTab, loadSavedRequest, setSelected, setFilter, setSection, setRowCursor,
    setFireBlock, setSaveNotice, setPickerOpen, pickerState, setPickerState, setPickerError,
    setPickerDeleteConfirm, visibleRoutes, savedItems, resetPaneTransients,
  } = c;
  if (key.escape === true) {
    setPickerOpen(false);
    return;
  }
  if ((input === 'd' || input === 'D') && key.ctrl !== true && key.meta !== true && pickerState.query.trim() === '') {
    const matches = matchPickItemsBySubstring(pickerState.query, savedItems);
    const at = matches[clampPickListCursor(pickerState.cursor, matches.length)];
    if (at !== undefined && at.value.stale) {
      setPickerDeleteConfirm({ name: at.value.name });
    }
    return;
  }
  const outcome = handleFilterablePickListKey(pickerState, savedItems, input, key);
  if (outcome.type === 'update') {
    setPickerState(outcome.state);
    return;
  }
  if (outcome.type === 'cancel') {
    setPickerOpen(false);
    return;
  }
  if (outcome.item.value.stale) {
    setPickerError(`"${outcome.item.value.name}" is stale — press d to delete it`);
    return;
  }
  const targetName = outcome.item.value.name;
  const savedTarget = outcome.item.value;
  const visibleAt = resolveRouteIndex(visibleRoutes, savedTarget.method, savedTarget.path);
  if (visibleAt === null) {
    const unfilteredAt = resolveRouteIndex(routes ?? [], savedTarget.method, savedTarget.path);
    if (unfilteredAt === null) {
      setPickerError(`"${targetName}" targets ${savedTarget.repoPath}, not this repo — switch repo to load it`);
      return;
    }
    setFilter({ value: '', cursor: 0 });
    setSelected(unfilteredAt);
  } else {
    setSelected(visibleAt);
  }
  setPickerOpen(false);
  void (async () => {
    const loaded = await loadSavedRequest(targetName);
    if (!loaded.ok) {
      setPickerError(loaded.error.message);
      setPickerOpen(true);
      return;
    }
    resetPaneTransients();
    setSection('params');
    setRowCursor(0);
    setFireBlock(null);
    setSaveNotice(null);
    setPaneTab('request');
    setPaneFocus('detail');
  })();
  return;
}
