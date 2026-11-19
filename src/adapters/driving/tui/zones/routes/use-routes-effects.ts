// tui/zones/routes: use-routes-effects — the zone's lifecycle effects (input capture, initial load, per-route and per-repo resets), declared in their original order.
import { useEffect, useRef } from 'react';
import type { RoutesBaseCtx } from './use-routes-derived.js';
import type { RoutesPaneActions } from './use-routes-pane-actions.js';
import { createFilterablePickListState } from '../../shared/components/filterable-pick-list.js';

export function useRoutesEffects(c: RoutesBaseCtx & RoutesPaneActions) {
  const {
    routesRepoPath, loadRoutes, paneTab, savedRequests, refreshSavedRequests, setZoneInputCaptured,
    setSelected, storeSetFilter, filterEditing, setFilterEditing, setFilterPanelOpen, setPanelCursor,
    setRowEdit, setRowAddPrompt, setFireBlock, savePrompt, setSavePrompt, overwriteConfirm,
    setOverwriteConfirm, setSaveNotice, pickerOpen, pickerDeleteConfirm, setSavedTabState, setSavedTabError,
    savedTabDeleteConfirm, setSavedTabDeleteConfirm, setScalarEdit, setAddPrompt, setRawEditor, paneFocused,
    paneRoute, paneRouteKey, firedRouteKey, closePane,
  } = c;
  useEffect(() => {
    setZoneInputCaptured(
      filterEditing ||
        paneFocused ||
        savePrompt !== null ||
        pickerOpen ||
        overwriteConfirm !== null ||
        pickerDeleteConfirm !== null ||
        savedTabDeleteConfirm !== null,
    );
  }, [filterEditing, paneFocused, savePrompt, pickerOpen, overwriteConfirm, pickerDeleteConfirm, savedTabDeleteConfirm, setZoneInputCaptured]);
  useEffect(() => () => setZoneInputCaptured(false), [setZoneInputCaptured]);

  useEffect(() => {
    void loadRoutes();
    // Deliberately fires once on mount only — a re-render never re-triggers a fetch of its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A fresh fire (or another route/tab) gets a closed panel; the persisted rules/folds
  // come from the slice.
  useEffect(() => {
    setFilterPanelOpen(false);
    setPanelCursor(0);
  }, [firedRouteKey, paneRouteKey, paneTab]);

  // Open inline editors belong to one route: a pane route change (e.g. a reload that
  // reorders the list under the cursor) drops them so nothing is confirmed into another
  // route's draft at a stale index.
  const previousPaneRouteKey = useRef(paneRouteKey);
  useEffect(() => {
    if (previousPaneRouteKey.current !== paneRouteKey) {
      setScalarEdit(null);
      setAddPrompt(null);
      setRawEditor(null);
      setRowEdit(null);
      setRowAddPrompt(null);
      setFireBlock(null);
      setSavePrompt(null);
      setOverwriteConfirm(null);
      setSaveNotice(null);
      setSavedTabState(createFilterablePickListState());
      setSavedTabError(null);
      setSavedTabDeleteConfirm(null);
    }
    previousPaneRouteKey.current = paneRouteKey;
  }, [paneRouteKey]);

  // The Saved tab needs its rows: entering it (or switching route onto it) with an
  // unloaded cache triggers one load. A failed load stays visible as the store error
  // until the next visit or a manual `r` retry — the effect never refires off the error
  // itself, so a failure cannot loop.
  useEffect(() => {
    if (paneTab === 'saved' && savedRequests === null) {
      void refreshSavedRequests();
    }
    // savedRequestsError deliberately excluded: a failure must not retrigger by itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneTab, paneRouteKey, savedRequests, refreshSavedRequests]);

  // The pane follows its route: a reload that drops the route hands focus back to the
  // list (its drafts stay in the store under the same key).
  useEffect(() => {
    if (paneFocused && paneRoute === null) {
      closePane();
    }
    // closePane is a render-local helper over stable setters — not an effect dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneFocused, paneRoute]);

  // Arrowing onto a different repo's list must never leave the cursor on an unrelated row
  // (mirrors edts-zone.tsx's own cursor reset when the focused EDT changes).
  // The filter survives tab switches (store-held), so it is only dropped when the list really
  // switches to another repo — never on (re)mount, where the repo path is unchanged.
  const previousRepoPath = useRef(routesRepoPath);
  useEffect(() => {
    if (previousRepoPath.current !== null && previousRepoPath.current !== routesRepoPath) {
      setSelected(0);
      storeSetFilter({ value: '', cursor: 0 });
      setFilterEditing(false);
    }
    previousRepoPath.current = routesRepoPath;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routesRepoPath]);
}
