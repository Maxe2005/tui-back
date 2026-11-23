// tui/zones/routes: use-routes-state — the Routes zone's store selectors, zone-local `useState`s and measured element sizes, in their original call order.
import { useState } from 'react';
import { useWindowSize } from 'ink';
import type { AppStore } from '../../store/app-store.js';
import type { JsonScalarKind } from '../../shared/components/json-tree/model.js';
import type { RequestRowSection, RequestSection } from './routes-request.logic.js';
import type { TextInputState } from '../../shared/components/inputs/text-edit.js';
import { createFilterablePickListState, type FilterablePickListState } from '../../shared/components/filterable-pick-list.js';
import { useElementSize } from '../../shared/hooks/use-element-size.js';

export function useRoutesState(useStore: AppStore) {
  const status = useStore((state) => state.tabVisibility.routes.status);
  const carryingServices = useStore((state) => state.tabVisibility.routes.carryingServices);
  const routes = useStore((state) => state.routes);
  const routesStatus = useStore((state) => state.routesStatus);
  const routesError = useStore((state) => state.routesError);
  const routesRepoPath = useStore((state) => state.routesRepoPath);
  const loadRoutes = useStore((state) => state.loadRoutes);
  const fireRoute = useStore((state) => state.fireRoute);
  const responses = useStore((state) => state.responses);
  const requestDrafts = useStore((state) => state.requestDrafts);
  const ensureRequestDraft = useStore((state) => state.ensureRequestDraft);
  const updateRequestDraft = useStore((state) => state.updateRequestDraft);
  const paneFocus = useStore((state) => state.routesPaneFocus);
  const setPaneFocus = useStore((state) => state.setRoutesPaneFocus);
  const paneTab = useStore((state) => state.routesPaneTab);
  const setPaneTab = useStore((state) => state.setRoutesPaneTab);
  const jsonTreeStates = useStore((state) => state.jsonTreeStates);
  const updateJsonTreeState = useStore((state) => state.updateJsonTreeState);
  const bodyDrafts = useStore((state) => state.bodyDrafts);
  const bodyEditErrors = useStore((state) => state.bodyEditErrors);
  const ensureBodyDraft = useStore((state) => state.ensureBodyDraft);
  const updateBodyDraft = useStore((state) => state.updateBodyDraft);
  const setBodyEditError = useStore((state) => state.setBodyEditError);
  const setBodyEditErrors = useStore((state) => state.setBodyEditErrors);
  const draftOrigins = useStore((state) => state.draftOrigins);
  const savedRequests = useStore((state) => state.savedRequests);
  const savedRequestsError = useStore((state) => state.savedRequestsError);
  const refreshSavedRequests = useStore((state) => state.refreshSavedRequests);
  const saveRequestDraft = useStore((state) => state.saveRequestDraft);
  const loadSavedRequest = useStore((state) => state.loadSavedRequest);
  const deleteSavedRequest = useStore((state) => state.deleteSavedRequest);

  const setZoneInputCaptured = useStore((state) => state.setZoneInputCaptured);

  // Held in the store like the filter, so the cursor survives tab switches.
  const selected = useStore((state) => state.routesSelected);
  const storeSetSelected = useStore((state) => state.setRoutesSelected);
  const setSelected = (next: number | ((prev: number) => number)) =>
    storeSetSelected(typeof next === 'function' ? next(selected) : next);
  // The route filter: `filter` is the applied query; `filterEditing` is true while the inline
  // input owns the keyboard (captured from AppShell's global shortcuts, like the Logs zone's
  // filter editor) so typing `q`, `:`, `?` or digits lands as text instead of firing them.
  const filter = useStore((state) => state.routesFilter);
  const storeSetFilter = useStore((state) => state.setRoutesFilter);
  const setFilter = (next: TextInputState | ((prev: TextInputState) => TextInputState)) =>
    storeSetFilter(typeof next === 'function' ? next(filter) : next);
  const [filterEditing, setFilterEditing] = useState(false);
  // The filter-rules panel is transient UI (open/closed + rule cursor), unlike the rules
  // themselves — zone-local, reset on every fire, never in the store. Opening the panel
  // auto-focuses the rule list: arrows act immediately, no activation keypress needed.
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [panelCursor, setPanelCursor] = useState(0);
  // The Request tab's transient UI — active section, row cursor, inline row editors and the
  // last fire-block reason. Drafts live in the store (per route).
  const [section, setSection] = useState<RequestSection>('params');
  const [rowCursor, setRowCursor] = useState(0);
  const [rowEdit, setRowEdit] = useState<{ section: RequestRowSection; index: number; input: TextInputState } | null>(null);
  const [rowAddPrompt, setRowAddPrompt] = useState<{ section: 'query' | 'headers'; input: TextInputState; error: string | null } | null>(null);
  const [fireBlock, setFireBlock] = useState<string | null>(null);
  // The saved-request library UI. `savePrompt` is the Request tab's inline name prompt
  // (prefilled with the origin name when the draft came from a saved request);
  // `overwriteConfirm` is the destructive-overwrite confirm behind Ctrl+O (UX-DR36);
  // the picker is the list's `FilterablePickList` reload dialog with stale rows dimmed and
  // blocked, plus its own `d`-to-delete confirm. Any open prompt owns every key.
  const [savePrompt, setSavePrompt] = useState<{ input: TextInputState; error: string | null; duplicate: boolean } | null>(null);
  const [overwriteConfirm, setOverwriteConfirm] = useState<{ name: string } | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerState, setPickerState] = useState<FilterablePickListState>(() => createFilterablePickListState());
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [pickerDeleteConfirm, setPickerDeleteConfirm] = useState<{ name: string } | null>(null);
  // The Saved sub-tab's zone-local pick state (filter + cursor), its inline error line and its
  // `d`-to-delete confirm. Route-scoped: reset on every route change like the other pane
  // transients, never autofocused.
  const [savedTabState, setSavedTabState] = useState<FilterablePickListState>(() => createFilterablePickListState());
  const [savedTabError, setSavedTabError] = useState<string | null>(null);
  const [savedTabDeleteConfirm, setSavedTabDeleteConfirm] = useState<{ name: string } | null>(null);
  // The request-body editor's transient inline/raw UI. Drafts, folds and filters live in the
  // store (per route, session-only), so a revisit restores them together; only the text
  // buffers are zone-local.
  const [scalarEdit, setScalarEdit] = useState<{ path: string; kind: JsonScalarKind; input: TextInputState } | null>(null);
  const [addPrompt, setAddPrompt] = useState<{ parentPath: string; input: TextInputState; error: string | null } | null>(null);
  const [rawEditor, setRawEditor] = useState<{ input: TextInputState; error: string | null } | null>(null);
  const windowSize = useWindowSize();
  // Dragging the splitter (Ctrl+W) re-renders only ZoneLayout, but the panes' content reflows
  // (the repo path wraps or unwraps, changing the list's height). Subscribing here makes this
  // zone re-render too, so useElementSize re-measures instead of keeping a stale list budget.
  useStore((state) => state.splitterRatios.routes);
  const [listAreaRef, listAreaSize] = useElementSize();
  const [responseAreaRef, responseAreaSize] = useElementSize();
  const [bodyAreaRef, bodyAreaSize] = useElementSize();

  const paneFocused = paneFocus === 'detail';
  return {
    useStore, status, carryingServices, routes, routesStatus, routesError, routesRepoPath, loadRoutes,
    fireRoute, responses, requestDrafts, ensureRequestDraft, updateRequestDraft, paneFocus, setPaneFocus,
    paneTab, setPaneTab, jsonTreeStates, updateJsonTreeState, bodyDrafts, bodyEditErrors, ensureBodyDraft,
    updateBodyDraft, setBodyEditError, setBodyEditErrors, draftOrigins, savedRequests, savedRequestsError,
    refreshSavedRequests, saveRequestDraft, loadSavedRequest, deleteSavedRequest, setZoneInputCaptured,
    selected, storeSetSelected, setSelected, filter, storeSetFilter, setFilter, filterEditing,
    setFilterEditing, filterPanelOpen, setFilterPanelOpen, panelCursor, setPanelCursor, section, setSection,
    rowCursor, setRowCursor, rowEdit, setRowEdit, rowAddPrompt, setRowAddPrompt, fireBlock, setFireBlock,
    savePrompt, setSavePrompt, overwriteConfirm, setOverwriteConfirm, saveNotice, setSaveNotice, pickerOpen,
    setPickerOpen, pickerState, setPickerState, pickerError, setPickerError, pickerDeleteConfirm,
    setPickerDeleteConfirm, savedTabState, setSavedTabState, savedTabError, setSavedTabError,
    savedTabDeleteConfirm, setSavedTabDeleteConfirm, scalarEdit, setScalarEdit, addPrompt, setAddPrompt,
    rawEditor, setRawEditor, windowSize, listAreaRef, listAreaSize, responseAreaRef, responseAreaSize,
    bodyAreaRef, bodyAreaSize, paneFocused,
  };
}

export type RoutesState = ReturnType<typeof useRoutesState>;
