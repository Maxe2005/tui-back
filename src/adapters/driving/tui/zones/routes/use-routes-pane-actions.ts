// tui/zones/routes: use-routes-pane-actions — save prompt / saved picker openers, pane transients reset, open/close/fire of the right pane and request-row confirms.
import type { RoutesBaseCtx } from './use-routes-derived.js';
import {
  addRequestRow,
  buildFireRequest,
  defaultRequestSection,
  type RequestDraft,
  type RequestRowSection,
  type RequestSection,
  resolveFireBlock,
  seedRequestDraft,
  setRequestRowValue,
} from './routes-request.logic.js';
import { canEditRouteBody, firstEditError, routeKeyFor, seedBodyDraft } from '../../shared/components/json-tree/model.js';
import { createFilterablePickListState } from '../../shared/components/pickers/filterable-pick-list.js';

export function useRoutesPaneActions(c: RoutesBaseCtx) {
  const {
    useStore, fireRoute, ensureRequestDraft, updateRequestDraft, setPaneFocus, setPaneTab, ensureBodyDraft,
    draftOrigins, savedRequests, refreshSavedRequests, saveRequestDraft, loadSavedRequest,
    setFilterPanelOpen, setPanelCursor, setSection, setRowCursor, rowEdit, setRowEdit, rowAddPrompt,
    setRowAddPrompt, setFireBlock, savePrompt, setSavePrompt, setOverwriteConfirm, setSaveNotice,
    setPickerOpen, setPickerState, setPickerError, setSavedTabState, setSavedTabError,
    setSavedTabDeleteConfirm, setScalarEdit, setAddPrompt, setRawEditor, paneRoute, paneRouteKey,
    paneHasBody,
  } = c;
  const openSavePrompt = () => {
    setSaveNotice(null);
    const originId = paneRouteKey === null ? undefined : draftOrigins[paneRouteKey];
    const prefill =
      originId === undefined ? '' : (savedRequests?.find((item) => item.id === originId)?.name ?? '');
    setSavePrompt({ input: { value: prefill, cursor: prefill.length }, error: null, duplicate: false });
  };

  // Enter saves under the prompt's name; a colliding name stays in the prompt with an inline
  // collision error until Ctrl+O overwrites through the destructive confirm.
  const attemptSave = (overwrite: boolean) => {
    if (savePrompt === null || paneRouteKey === null) {
      return;
    }
    const routeKey = paneRouteKey;
    const name = savePrompt.input.value;
    const input = savePrompt.input;
    void (async () => {
      const result = await saveRequestDraft(name, routeKey, overwrite ? { overwrite: true } : undefined);
      if (result.ok) {
        setSavePrompt(null);
        setOverwriteConfirm(null);
        setSaveNotice(`Saved "${result.data.name}"`);
        void refreshSavedRequests();
      } else if (result.error.code === 'duplicate-request-name' && !overwrite) {
        setSavePrompt({ input, error: `"${name}" is already used — [ctrl+o] overwrite`, duplicate: true });
      } else {
        setSavePrompt({ input, error: result.error.message, duplicate: false });
      }
    })();
  };

  const openPicker = () => {
    setPickerState(createFilterablePickListState());
    setPickerError(null);
    setPickerOpen(true);
    void refreshSavedRequests();
  };

  const resetPaneTransients = () => {
    setScalarEdit(null);
    setAddPrompt(null);
    setRawEditor(null);
    setRowEdit(null);
    setRowAddPrompt(null);
    setFilterPanelOpen(false);
    setPanelCursor(0);
    setSavedTabState(createFilterablePickListState());
    setSavedTabError(null);
    setSavedTabDeleteConfirm(null);
  };

  // Loads one route-scoped row into the Request tab: shared by the Saved tab's Enter
  // and shared-reducer select paths. A failure stays on Saved with the inline error.
  const loadSavedIntoRequest = async (targetName: string) => {
    const loaded = await loadSavedRequest(targetName);
    if (!loaded.ok) {
      setSavedTabError(loaded.error.message);
      return;
    }
    setSavedTabError(null);
    resetPaneTransients();
    setSection('params');
    setRowCursor(0);
    setFireBlock(null);
    setSaveNotice(null);
    setPaneTab('request');
    setPaneFocus('detail');
  };

  // `Enter` (or `e`, straight to Body) moves the focus into the pane on its Request tab, seeding
  // the route's drafts lazily. Nothing is fired.
  const openPaneForRoute = (route: NonNullable<typeof paneRoute>, forcedSection?: RequestSection) => {
    const key = routeKeyFor(route.method, route.path);
    const seed = seedRequestDraft(route);
    ensureRequestDraft(key, seed);
    if (canEditRouteBody(route)) {
      ensureBodyDraft(key, seedBodyDraft(route));
    }
    const draft = useStore.getState().requestDrafts[key] ?? seed;
    resetPaneTransients();
    setSection(forcedSection ?? defaultRequestSection(route, draft));
    setRowCursor(0);
    setFireBlock(null);
    setPaneTab('request');
    setPaneFocus('detail');
  };

  const closePane = () => {
    resetPaneTransients();
    setPaneFocus('list');
  };

  // Ctrl+R: fire the pane route's live draft, or show why it cannot go (nothing sent).
  const firePaneRoute = () => {
    if (paneRoute === null || paneRouteKey === null) {
      return;
    }
    const live = useStore.getState();
    const draft = live.requestDrafts[paneRouteKey] ?? seedRequestDraft(paneRoute);
    const bodyDraft = Object.prototype.hasOwnProperty.call(live.bodyDrafts, paneRouteKey)
      ? live.bodyDrafts[paneRouteKey]
      : seedBodyDraft(paneRoute);
    const bodyError = paneHasBody ? firstEditError(live.bodyEditErrors[paneRouteKey] ?? {}) : null;
    const block = resolveFireBlock(draft, bodyError);
    if (block !== null) {
      setFireBlock(block);
      setPaneTab('request');
      return;
    }
    setFireBlock(null);
    setSaveNotice(null);
    setFilterPanelOpen(false);
    setPanelCursor(0);
    const request = buildFireRequest(paneRoute, draft, bodyDraft);
    void fireRoute(
      paneRouteKey,
      paneRoute.method,
      request.path,
      Object.keys(request.options).length === 0 ? undefined : request.options,
    );
  };

  const rowsOf = (draft: RequestDraft | null, rowSection: RequestRowSection) => (draft === null ? [] : draft[rowSection]);

  const confirmRowEdit = () => {
    if (rowEdit === null || paneRouteKey === null) {
      return;
    }
    const { section: rowSection, index, input } = rowEdit;
    updateRequestDraft(paneRouteKey, (previous) => ({ ...previous, [rowSection]: setRequestRowValue(previous[rowSection], index, input.value) }));
    setFireBlock(null);
    setRowEdit(null);
  };

  const confirmRowAdd = () => {
    if (rowAddPrompt === null || paneRouteKey === null || paneRoute === null) {
      return;
    }
    const rowSection = rowAddPrompt.section;
    const current = useStore.getState().requestDrafts[paneRouteKey] ?? seedRequestDraft(paneRoute);
    const result = addRequestRow(current[rowSection], rowAddPrompt.input.value, rowSection === 'headers');
    if (!result.ok) {
      setRowAddPrompt({ ...rowAddPrompt, error: result.reason });
      return;
    }
    updateRequestDraft(paneRouteKey, (previous) => ({ ...previous, [rowSection]: result.rows }));
    setRowCursor(result.rows.length - 1);
    setRowAddPrompt(null);
  };
  return {
    openSavePrompt, attemptSave, openPicker, resetPaneTransients, loadSavedIntoRequest, openPaneForRoute,
    closePane, firePaneRoute, rowsOf, confirmRowEdit, confirmRowAdd,
  };
}

export type RoutesPaneActions = ReturnType<typeof useRoutesPaneActions>;
