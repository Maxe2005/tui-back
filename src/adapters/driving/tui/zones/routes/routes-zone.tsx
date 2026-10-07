// tui/zones/routes: the Routes zone — a resizable list/detail split of the repo's discovered
// routes (BoundedList of ListRows) with an inline filter, and a focusable right pane with
// Saved | Request | Response sub-tabs. `Enter` opens the Request tab (the list never fires);
// `Ctrl+R` fires the draft. While the pane holds focus it captures the keyboard from AppShell;
// `Esc` unwinds sub-editors, then Response → Request and Saved → list, then back to the list.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useInput, useWindowSize } from 'ink';
import { useAppStore, type AppStore } from '../../store/app-store.js';
import { ROUTES_PANE_TABS } from '../../store/slices/routes-slice.js';
import { resolveFocusStep } from '../../shared/keys/focus-navigation.js';
import { resolveTabNavKey, stepTab } from '../../shared/keys/tab-navigation.js';
import { BoundedList } from '../../shared/components/bounded-list.js';
import { DetailPane } from '../../shared/components/detail-pane.js';
import { DimAnnotation } from '../../shared/components/dim-annotation.js';
import { FooterContext } from '../../shared/components/footer-context.js';
import { JsonEmptyState, JsonRawFallback, JsonTree, JsonRawEditor, JsonTreeEditor } from '../../shared/components/json-tree/json-tree.js';
import {
  addEntryAtPath,
  addHiddenKey,
  addOnlyKey,
  canEditRouteBody,
  changeTypeAtPath,
  classifyResponseBody,
  clampTreeSelection,
  clearTreeRules,
  countActiveRules,
  countJsonNodes,
  createDefaultJsonTreeState,
  findParentIndex,
  firstEditError,
  seedBodyDraft,
  flattenJson,
  foldNextDepthLevel,
  getValueAtPath,
  listActiveRules,
  moveTreeSelection,
  parseRawJsonBuffer,
  remapErrorsForDelete,
  removeActiveRule,
  removeEntryAtPath,
  resolveAddParentPath,
  resolveTreeKeyAction,
  resolveTreeListBudget,
  resolveTreePanelKeyAction,
  routeKeyFor,
  scalarKindOf,
  setValueAtPath,
  toggleFoldPath,
  toggleHideNulls,
  unfoldNextDepthLevel,
  validateScalarText,
  type BodyEditError,
  type JsonScalarKind,
  type JsonTreeState,
  type TreeKeyAction,
  type TreePanelAction,
} from '../../shared/components/json-tree/model.js';
import { ZoneLayout } from '../../shared/components/zone-layout.js';
import { ListRow } from '../../shared/components/list-row.js';
import { ModalDialog } from '../../shared/components/modal-dialog.js';
import {
  FilterablePickList,
  clampPickListCursor,
  createFilterablePickListState,
  handleFilterablePickListKey,
  matchPickItemsBySubstring,
  type FilterablePickItem,
  type FilterablePickListState,
} from '../../shared/components/filterable-pick-list.js';
import { Spinner } from '../../shared/components/spinner.js';
import { nextTextInputValue, type TextInputState } from '../../shared/components/text-edit.js';
import { TextInputLine } from '../../shared/components/text-input-line.js';
import { useElementSize } from '../../shared/hooks/use-element-size.js';
import { colors, spacing } from '../../shared/theme/theme.js';
import {
  filterRoutes,
  formatRouteDetail,
  formatRouteRow,
  moveRoutesSelection,
  resolveEnterFireTarget,
  routesFooterContext,
  UNAVAILABLE_FOOTER_INPUT,
  resolveRoutesDirection,
} from './routes-zone.logic.js';
import {
  addRequestRow,
  bodyTreeKey,
  buildFireRequest,
  defaultRequestSection,
  nextRequestSection,
  removeRequestRow,
  resolveFireBlock,
  resolveRouteIndex,
  seedRequestDraft,
  setRequestRowValue,
  type RequestDraft,
  type RequestRowSection,
  type RequestSection,
} from './routes-request.logic.js';
import { RoutesPaneTabStrip, RoutesRequestTab } from './routes-request-tab.js';
import { RoutesResponseTab } from './routes-response-tab.js';
import { RoutesSavedTab } from './routes-saved-tab.js';
import type { SavedWithStale } from '../../../../../core/routes/saved-requests.js';
import { formatHints } from '../../shared/components/hints.js';
import { StateLine } from '../../shared/components/state-line.js';
import { jumpSelection, resolveSelectionJump } from '../../shared/keys/list-cursor.js';

// First-paint estimate of the route list's row budget (top bar + tab bar + footer + the
// list pane's own header/filter/hint lines), used only until useElementSize has measured the
// list's real flex-bound area — after that the budget is the measured height, so the list can
// never overrun the tab bar above or the footer below.
const ROUTES_LIST_CHROME_ROWS = 9;
// First-paint estimate of the response tree's total row budget (shell chrome + the route
// detail + the Response header + the right pane's own hint line around the tree's own
// box); the measured box height takes over after mount, like the list above.
const RESPONSE_AREA_CHROME_ROWS = 13;

export function formatRoutesDisabledMessage(carryingServices: string[]): string {
  const list = carryingServices.join(', ');
  return `None of your active EDT's services carry routes. Repos with routes: ${list}.`;
}

export function RoutesZone({ useStore = useAppStore }: { useStore?: AppStore }) {
  const status = useStore((state) => state.tabVisibility.routes.status);
  const carryingServices = useStore((state) => state.tabVisibility.routes.carryingServices);
  const resizeMode = useStore((state) => state.resizeMode);
  const commandBarOpen = useStore((state) => state.commandBarOpen);
  const registryScreenOpen = useStore((state) => state.registryScreenOpen);
  const settingsScreenOpen = useStore((state) => state.settingsScreenOpen);
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
  const [listAreaRef, listAreaSize] = useElementSize();
  const [responseAreaRef, responseAreaSize] = useElementSize();
  const [bodyAreaRef, bodyAreaSize] = useElementSize();

  const paneFocused = paneFocus === 'detail';
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

  const visibleRoutes = useMemo(() => filterRoutes(routes ?? [], filter.value), [routes, filter.value]);

  // The pane always reflects the list cursor's route (the cursor cannot move while the pane
  // holds focus), with its own draft and last response.
  const paneRoute = resolveEnterFireTarget(visibleRoutes, selected) ?? null;
  const paneRouteKey = paneRoute === null ? null : routeKeyFor(paneRoute.method, paneRoute.path);
  const paneResponse = paneRouteKey === null ? undefined : responses[paneRouteKey];
  const fireResult = paneResponse?.status === 'fired' ? paneResponse.result : null;
  const firedRouteKey = paneResponse?.status === 'fired' ? paneRouteKey : null;
  const treeFocused = paneFocused && paneTab === 'response';
  const paneDraft: RequestDraft | null = useMemo(
    () => (paneRoute === null || paneRouteKey === null ? null : (requestDrafts[paneRouteKey] ?? seedRequestDraft(paneRoute))),
    [paneRoute, paneRouteKey, requestDrafts],
  );
  const paneHasBody = paneRoute !== null && canEditRouteBody(paneRoute);

  // The saved picker rows: a stale record carries a dim `stale` suffix in its meta and is
  // blocked at select time (never loaded, never fired — deletion only, through a confirm).
  const savedItems: FilterablePickItem<SavedWithStale>[] = useMemo(
    () =>
      (savedRequests ?? []).map((request) => ({
        key: request.id,
        label: request.name,
        meta: `${request.method} ${request.path}${request.stale ? ' · stale' : ''}`,
        value: request,
      })),
    [savedRequests],
  );

  // The Saved sub-tab rows: only the pane route's requests, matched with the same
  // normalized equality as `resolveRouteIndex`. Route-scoped by construction, so no stale
  // flags, no stale blocking and no repo-mismatch handling here.
  const savedTabItems: FilterablePickItem<SavedWithStale>[] = useMemo(() => {
    if (paneRouteKey === null) {
      return [];
    }
    return (savedRequests ?? [])
      .filter((request) => routeKeyFor(request.method, request.path) === paneRouteKey)
      .map((request) => ({
        key: request.id,
        label: request.name,
        meta: `${request.method} ${request.path}`,
        value: request,
      }));
  }, [savedRequests, paneRouteKey]);

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

  // The fired body, classified in the driving adapter (never core): JSON becomes the
  // navigable tree, anything else its raw/empty fallback.
  const classification = useMemo(
    () => (fireResult !== null ? classifyResponseBody(fireResult.body) : null),
    [fireResult],
  );
  const treeState: JsonTreeState = useMemo(
    () => (firedRouteKey !== null ? (jsonTreeStates[firedRouteKey] ?? createDefaultJsonTreeState()) : createDefaultJsonTreeState()),
    [firedRouteKey, jsonTreeStates],
  );
  const treeValue = classification?.kind === 'json' ? classification.value : undefined;
  const treeRules = useMemo(
    () => ({ hiddenKeys: treeState.hiddenKeys, onlyKeys: treeState.onlyKeys, hideNulls: treeState.hideNulls }),
    [treeState],
  );
  const treeRows = useMemo(
    () => (treeValue === undefined ? [] : flattenJson(treeValue, treeState.foldedPaths, treeRules)),
    [treeValue, treeState.foldedPaths, treeRules],
  );
  const treeHiddenCount = useMemo(
    () => (treeValue === undefined ? 0 : countJsonNodes(treeValue) - treeRows.length),
    [treeValue, treeRows],
  );
  const treeActiveRuleCount = useMemo(() => countActiveRules(treeRules), [treeRules]);
  const treeRuleList = useMemo(() => listActiveRules(treeRules), [treeRules]);
  const clampedPanelCursor = treeRuleList.length === 0 ? 0 : clampTreeSelection(panelCursor, treeRuleList.length);
  const clampedTreeSelected = clampTreeSelection(treeState.selected, treeRows.length);
  const rawLines = useMemo(
    () => (classification?.kind === 'raw' && fireResult !== null ? fireResult.body.split('\n') : []),
    [classification, fireResult],
  );
  const clampedRawSelected = clampTreeSelection(treeState.selected, rawLines.length);
  const treeTotalBudget =
    responseAreaSize !== null ? responseAreaSize.height : Math.max(windowSize.rows - RESPONSE_AREA_CHROME_ROWS, 3);
  const treeViewport = resolveTreeListBudget(treeTotalBudget, filterPanelOpen, treeRuleList.length);
  const rawViewport = resolveTreeListBudget(treeTotalBudget, false, 0);

  // The editor draft + its tree frame. The draft is the store's per-route `bodyDrafts` entry
  // (`undefined` = empty, press `r`); its tree state lives under bodyTreeKey (apart from the
  // response tree), so body, filters and folds restore together on revisit. Hidden lines are
  // purely visual — still sent. Before the pane first opens a route, the preview shows the seed
  // without storing it.
  const editorRouteKey = paneHasBody ? paneRouteKey : null;
  const editorRoute = editorRouteKey === null ? null : paneRoute;
  const editorHasDraft = editorRouteKey !== null && Object.prototype.hasOwnProperty.call(bodyDrafts, editorRouteKey);
  const editorDraft: unknown = useMemo(
    () => (editorRouteKey === null || editorRoute === null ? undefined : editorHasDraft ? bodyDrafts[editorRouteKey] : seedBodyDraft(editorRoute)),
    [editorRouteKey, editorRoute, editorHasDraft, bodyDrafts],
  );
  const editorTreeState: JsonTreeState = useMemo(
    () => (editorRouteKey !== null ? (jsonTreeStates[bodyTreeKey(editorRouteKey)] ?? createDefaultJsonTreeState()) : createDefaultJsonTreeState()),
    [editorRouteKey, jsonTreeStates],
  );
  const editorRules = useMemo(
    () => ({ hiddenKeys: editorTreeState.hiddenKeys, onlyKeys: editorTreeState.onlyKeys, hideNulls: editorTreeState.hideNulls }),
    [editorTreeState],
  );
  const editorRows = useMemo(
    () => (editorDraft === undefined ? [] : flattenJson(editorDraft, editorTreeState.foldedPaths, editorRules)),
    [editorDraft, editorTreeState.foldedPaths, editorRules],
  );
  const editorHiddenCount = useMemo(
    () => (editorDraft === undefined ? 0 : countJsonNodes(editorDraft) - editorRows.length),
    [editorDraft, editorRows],
  );
  const editorRuleList = useMemo(() => listActiveRules(editorRules), [editorRules]);
  const editorErrors: Record<string, BodyEditError> = editorRouteKey !== null ? (bodyEditErrors[editorRouteKey] ?? {}) : {};
  const editorFirstError = useMemo(() => firstEditError(editorErrors), [editorErrors]);
  const clampedEditorSelected = clampTreeSelection(editorTreeState.selected, editorRows.length);
  const clampedEditorPanelCursor = editorRuleList.length === 0 ? 0 : clampTreeSelection(panelCursor, editorRuleList.length);
  // First-paint estimate only (the Params/Query/Headers headers + rows above the Body take
  // roughly 8 more rows than the response view); the measured box takes over after mount.
  const bodyTotalBudget =
    bodyAreaSize !== null ? bodyAreaSize.height : Math.max(windowSize.rows - RESPONSE_AREA_CHROME_ROWS - 8, 3);
  const editorViewport = resolveTreeListBudget(bodyTotalBudget, filterPanelOpen, editorRuleList.length);
  // The body editor owns the keyboard only while its section is active in a focused pane.
  const editorOpen = editorRouteKey !== null && paneFocused && paneTab === 'request' && section === 'body';

  // Apply a (possibly null = no-op) tree-state recipe against the store's live state;
  // recipes always derive rows/rules from the live snapshot they receive, so two rapid
  // keypresses before a re-render compose instead of the second discarding the first.
  const amendTreeState = (recipe: (live: JsonTreeState) => JsonTreeState | null) => {
    if (firedRouteKey === null) {
      return;
    }
    const key = firedRouteKey;
    updateJsonTreeState(key, (live) => recipe(live) ?? live);
  };

  // Rows/rules/selection derived from a state snapshot (render-time or live) against
  // the stable fired value.
  const frameTreeState = (snapshot: JsonTreeState) => {
    const rules = { hiddenKeys: snapshot.hiddenKeys, onlyKeys: snapshot.onlyKeys, hideNulls: snapshot.hideNulls };
    const rows = treeValue === undefined ? [] : flattenJson(treeValue, snapshot.foldedPaths, rules);
    return { rules, rows, selected: clampTreeSelection(snapshot.selected, rows.length) };
  };

  // Clamp the cursor against the post-change rows (hiding/filtering can only shrink them).
  const withClampedSelection = (previous: JsonTreeState, rules: { hiddenKeys: readonly string[]; onlyKeys: readonly string[]; hideNulls: boolean }) => {
    const nextRows = treeValue === undefined ? [] : flattenJson(treeValue, previous.foldedPaths, rules);
    return clampTreeSelection(previous.selected, nextRows.length);
  };

  // Editor plumbing. Drafts and error maps are read live from the store at apply time (never the
  // render closure), so two composed updates in one tick compute from the latest state instead
  // of a stale draft.
  const amendEditorTreeState = (recipe: (live: JsonTreeState) => JsonTreeState | null) => {
    if (editorRouteKey === null) {
      return;
    }
    const key = bodyTreeKey(editorRouteKey);
    updateJsonTreeState(key, (live) => recipe(live) ?? live);
  };

  const frameEditorTreeState = (snapshot: JsonTreeState, draft: unknown) => {
    const rules = { hiddenKeys: snapshot.hiddenKeys, onlyKeys: snapshot.onlyKeys, hideNulls: snapshot.hideNulls };
    const rows = draft === undefined ? [] : flattenJson(draft, snapshot.foldedPaths, rules);
    return { rules, rows, selected: clampTreeSelection(snapshot.selected, rows.length) };
  };

  const editorWithClampedSelection = (previous: JsonTreeState, draft: unknown) => {
    const frame = frameEditorTreeState(previous, draft);
    return clampTreeSelection(previous.selected, frame.rows.length);
  };

  const readEditorDraft = (): unknown => {
    if (editorRouteKey === null) {
      return undefined;
    }
    const live = useStore.getState().bodyDrafts;
    return Object.prototype.hasOwnProperty.call(live, editorRouteKey) ? live[editorRouteKey] : undefined;
  };

  const readEditorErrors = (): Record<string, BodyEditError> => {
    if (editorRouteKey === null) {
      return {};
    }
    return useStore.getState().bodyEditErrors[editorRouteKey] ?? {};
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

  const scalarToEditableText = (value: unknown): string => {
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    return 'null';
  };

  const editLabelFor = (path: string): string => {
    const row = editorRows.find((candidate) => candidate.path === path);
    const key = row?.key ?? (row?.index !== null && row?.index !== undefined ? `[${row.index}]` : null);
    return key === null || key === '' ? 'Edit value' : `Edit ${key}`;
  };

  const confirmScalarEdit = () => {
    if (editorRouteKey === null || scalarEdit === null) {
      return;
    }
    const routeKey = editorRouteKey;
    const { path, kind, input } = scalarEdit;
    const draft = readEditorDraft();
    // An already-errored path re-validates against its pre-error kind (the draft holds
    // a string by now), so fixing the text restores the original kind's value.
    const effectiveKind = readEditorErrors()[path]?.kind ?? kind;
    const checked = validateScalarText(effectiveKind, input.value);
    if (checked.ok) {
      const result = setValueAtPath(draft, path, checked.value);
      if (result.ok) {
        updateBodyDraft(routeKey, () => result.value);
        setBodyEditError(routeKey, path, null);
      }
    } else {
      // Invalid entries stay in the draft as raw text in error color — never coerced.
      const result = setValueAtPath(draft, path, input.value);
      if (result.ok) {
        updateBodyDraft(routeKey, () => result.value);
      }
      setBodyEditError(routeKey, path, { reason: checked.reason, kind: effectiveKind });
    }
    setScalarEdit(null);
  };

  const confirmAddPrompt = () => {
    if (editorRouteKey === null || addPrompt === null) {
      return;
    }
    const routeKey = editorRouteKey;
    const draft = readEditorDraft();
    const result = addEntryAtPath(draft, addPrompt.parentPath, addPrompt.input.value);
    if (!result.ok) {
      // Duplicate/empty names keep the prompt open with the reason inline.
      setAddPrompt({ parentPath: addPrompt.parentPath, input: addPrompt.input, error: result.reason });
      return;
    }
    updateBodyDraft(routeKey, () => result.value);
    amendEditorTreeState((live) => ({ ...live, selected: editorWithClampedSelection(live, result.value) }));
    setAddPrompt(null);
  };

  const leaveRawEditor = () => {
    if (editorRouteKey === null || rawEditor === null) {
      return;
    }
    // An untouched/emptied buffer is a cancel, not a body: parsing `''` would fail and
    // trap the developer (Esc is the only exit), so it closes with nothing written.
    if (rawEditor.input.value.trim() === '') {
      setRawEditor(null);
      return;
    }
    const routeKey = editorRouteKey;
    const parsed = parseRawJsonBuffer(rawEditor.input.value);
    if (!parsed.ok) {
      // Invalid JSON keeps the developer in raw mode with the error + line/column;
      // the previous valid body is preserved (nothing is written). The location leads
      // the message so narrow terminals truncate the JSON error text, never the line.
      setRawEditor({
        input: rawEditor.input,
        error: `(line ${parsed.line}, column ${parsed.column}) ${parsed.reason}`,
      });
      return;
    }
    updateBodyDraft(routeKey, () => parsed.value);
    setBodyEditErrors(routeKey, {});
    amendEditorTreeState((live) => ({ ...live, selected: editorWithClampedSelection(live, parsed.value) }));
    setRawEditor(null);
  };

  const applyEditorTreeAction = (action: TreeKeyAction) => {
    if (editorRouteKey === null) {
      return;
    }
    const routeKey = editorRouteKey;
    if (action === 'toggle-panel') {
      setFilterPanelOpen(true);
      setPanelCursor(0);
      return;
    }
    if (action === 'up' || action === 'down' || action === 'home' || action === 'end' || action === 'page-up' || action === 'page-down') {
      amendEditorTreeState((live) => {
        const draft = readEditorDraft();
        const frame = frameEditorTreeState(live, draft);
        return {
          ...live,
          selected: moveTreeSelection(frame.selected, frame.rows.length, Math.max(editorViewport, 1), action),
        };
      });
      return;
    }
    if (action === 'open-raw') {
      const draft = readEditorDraft();
      const pretty = draft === undefined ? '' : JSON.stringify(draft, null, 2);
      setRawEditor({ input: { value: pretty, cursor: pretty.length }, error: null });
      return;
    }
    const draft = readEditorDraft();
    if (draft === undefined) {
      return;
    }
    switch (action) {
      case 'fold': {
        amendEditorTreeState((live) => {
          const frame = frameEditorTreeState(live, readEditorDraft());
          const row = frame.rows[frame.selected];
          if (row === undefined) {
            return null;
          }
          const isContainer = row.kind === 'object' || row.kind === 'array';
          if (isContainer && !row.folded) {
            const next = toggleFoldPath(live.foldedPaths, row.normalizedPath, true);
            return next === null ? null : { ...live, foldedPaths: next };
          }
          const parent = findParentIndex(frame.rows, frame.selected);
          return parent === null ? null : { ...live, selected: parent };
        });
        return;
      }
      case 'unfold': {
        amendEditorTreeState((live) => {
          const frame = frameEditorTreeState(live, readEditorDraft());
          const row = frame.rows[frame.selected];
          if (row === undefined || !row.folded) {
            return null;
          }
          return { ...live, foldedPaths: live.foldedPaths.filter((path) => path !== row.normalizedPath) };
        });
        return;
      }
      case 'fold-level': {
        const value = draft;
        amendEditorTreeState((live) => ({ ...live, foldedPaths: foldNextDepthLevel(value, live.foldedPaths) }));
        return;
      }
      case 'unfold-level': {
        const value = draft;
        amendEditorTreeState((live) => ({ ...live, foldedPaths: unfoldNextDepthLevel(value, live.foldedPaths) }));
        return;
      }
      case 'hide-key':
      case 'only-key': {
        amendEditorTreeState((live) => {
          const frame = frameEditorTreeState(live, readEditorDraft());
          const row = frame.rows[frame.selected];
          const next = action === 'hide-key' ? addHiddenKey(frame.rules, row?.key ?? null) : addOnlyKey(frame.rules, row?.key ?? null);
          if (next === null) {
            return null;
          }
          return {
            ...live,
            hiddenKeys: [...next.hiddenKeys],
            onlyKeys: [...next.onlyKeys],
            hideNulls: next.hideNulls,
            selected: editorWithClampedSelection({ ...live, hiddenKeys: [...next.hiddenKeys], onlyKeys: [...next.onlyKeys], hideNulls: next.hideNulls }, readEditorDraft()),
          };
        });
        return;
      }
      case 'edit-value': {
        const frame = frameEditorTreeState(editorTreeState, draft);
        const row = frame.rows[frame.selected];
        if (row === undefined || row.kind === 'object' || row.kind === 'array') {
          return;
        }
        const located = getValueAtPath(draft, row.path);
        if (!located.found) {
          return;
        }
        const kind = scalarKindOf(located.value) ?? row.kind;
        if (kind !== 'string' && kind !== 'number' && kind !== 'boolean' && kind !== 'null') {
          return;
        }
        const text = scalarToEditableText(located.value);
        setScalarEdit({ path: row.path, kind, input: { value: text, cursor: text.length } });
        return;
      }
      case 'add-entry': {
        const frame = frameEditorTreeState(editorTreeState, draft);
        const row = frame.rows[frame.selected];
        if (row === undefined) {
          return;
        }
        const parentPath = resolveAddParentPath(draft, row.path);
        if (parentPath === null) {
          return;
        }
        const parent = getValueAtPath(draft, parentPath);
        if (!parent.found) {
          return;
        }
        if (Array.isArray(parent.value)) {
          const result = addEntryAtPath(draft, parentPath);
          if (!result.ok) {
            return;
          }
          // Appending shifts no indices, so sibling errors stay pinned — nothing drops.
          updateBodyDraft(routeKey, () => result.value);
          amendEditorTreeState((live) => ({ ...live, selected: editorWithClampedSelection(live, result.value) }));
          return;
        }
        setAddPrompt({ parentPath, input: { value: '', cursor: 0 }, error: null });
        return;
      }
      case 'delete-entry': {
        const frame = frameEditorTreeState(editorTreeState, draft);
        const row = frame.rows[frame.selected];
        if (row === undefined || row.path === '') {
          return;
        }
        const result = removeEntryAtPath(draft, row.path);
        if (!result.ok) {
          return;
        }
        updateBodyDraft(routeKey, () => result.value);
        // The removed subtree's errors drop; later array siblings remap down by one.
        setBodyEditErrors(routeKey, remapErrorsForDelete(readEditorErrors(), row.path));
        amendEditorTreeState((live) => ({ ...live, selected: editorWithClampedSelection(live, result.value) }));
        return;
      }
      case 'change-type': {
        const frame = frameEditorTreeState(editorTreeState, draft);
        const row = frame.rows[frame.selected];
        if (row === undefined || row.kind === 'object' || row.kind === 'array') {
          return;
        }
        // Re-parse failures fall back to kind string inside the model, so only
        // structural failures (missing path) stay inert here.
        const result = changeTypeAtPath(draft, row.path);
        if (!result.ok) {
          return;
        }
        updateBodyDraft(routeKey, () => result.value);
        setBodyEditError(routeKey, row.path, null);
        return;
      }
    }
  };

  const applyEditorPanelAction = (panelAction: TreePanelAction) => {
    if (panelAction.type === 'close-panel') {
      setFilterPanelOpen(false);
      return;
    }
    if (panelAction.type === 'toggle-nulls') {
      amendEditorTreeState((previous) => {
        const next = toggleHideNulls({ hiddenKeys: previous.hiddenKeys, onlyKeys: previous.onlyKeys, hideNulls: previous.hideNulls });
        return { ...previous, hideNulls: next.hideNulls, selected: editorWithClampedSelection(previous, readEditorDraft()) };
      });
      return;
    }
    if (panelAction.type === 'clear-all') {
      amendEditorTreeState((live) => {
        const next = clearTreeRules(frameEditorTreeState(live, readEditorDraft()).rules);
        if (next === null) {
          return null;
        }
        return {
          ...live,
          hiddenKeys: [...next.hiddenKeys],
          onlyKeys: [...next.onlyKeys],
          hideNulls: next.hideNulls,
          selected: editorWithClampedSelection(live, readEditorDraft()),
        };
      });
      return;
    }
    amendEditorTreeState((live) => {
      const next = removeActiveRule(frameEditorTreeState(live, readEditorDraft()).rules, panelAction.index);
      if (next === null) {
        return null;
      }
      return {
        ...live,
        hiddenKeys: [...next.hiddenKeys],
        onlyKeys: [...next.onlyKeys],
        hideNulls: next.hideNulls,
        selected: editorWithClampedSelection(live, readEditorDraft()),
      };
    });
  };

  const applyTreeAction = (action: TreeKeyAction) => {
    if (action === 'toggle-panel') {
      setFilterPanelOpen(true);
      setPanelCursor(0);
      return;
    }
    if (action === 'up' || action === 'down' || action === 'home' || action === 'end' || action === 'page-up' || action === 'page-down') {
      amendTreeState((live) => {
        const frame = frameTreeState(live);
        return {
          ...live,
          selected: moveTreeSelection(frame.selected, frame.rows.length, Math.max(treeViewport, 1), action),
        };
      });
      return;
    }
    if (treeValue === undefined) {
      return;
    }
    const value = treeValue;
    switch (action) {
      case 'fold': {
        amendTreeState((live) => {
          const frame = frameTreeState(live);
          const row = frame.rows[frame.selected];
          if (row === undefined) {
            return null;
          }
          const isContainer = row.kind === 'object' || row.kind === 'array';
          if (isContainer && !row.folded) {
            const next = toggleFoldPath(live.foldedPaths, row.normalizedPath, true);
            return next === null ? null : { ...live, foldedPaths: next };
          }
          const parent = findParentIndex(frame.rows, frame.selected);
          return parent === null ? null : { ...live, selected: parent };
        });
        return;
      }
      case 'unfold': {
        amendTreeState((live) => {
          const frame = frameTreeState(live);
          const row = frame.rows[frame.selected];
          if (row === undefined || !row.folded) {
            return null;
          }
          return { ...live, foldedPaths: live.foldedPaths.filter((path) => path !== row.normalizedPath) };
        });
        return;
      }
      case 'fold-level': {
        amendTreeState((live) => ({ ...live, foldedPaths: foldNextDepthLevel(value, live.foldedPaths) }));
        return;
      }
      case 'unfold-level': {
        amendTreeState((live) => ({ ...live, foldedPaths: unfoldNextDepthLevel(value, live.foldedPaths) }));
        return;
      }
      case 'hide-key':
      case 'only-key': {
        amendTreeState((live) => {
          const frame = frameTreeState(live);
          const row = frame.rows[frame.selected];
          const next = action === 'hide-key' ? addHiddenKey(frame.rules, row?.key ?? null) : addOnlyKey(frame.rules, row?.key ?? null);
          if (next === null) {
            return null;
          }
          return {
            ...live,
            hiddenKeys: [...next.hiddenKeys],
            onlyKeys: [...next.onlyKeys],
            hideNulls: next.hideNulls,
            selected: withClampedSelection(live, next),
          };
        });
        return;
      }
    }
  };

  const applyTreePanelAction = (panelAction: TreePanelAction) => {
    if (panelAction.type === 'close-panel') {
      setFilterPanelOpen(false);
      return;
    }
    if (panelAction.type === 'toggle-nulls') {
      amendTreeState((previous) => {
        const next = toggleHideNulls({ hiddenKeys: previous.hiddenKeys, onlyKeys: previous.onlyKeys, hideNulls: previous.hideNulls });
        return { ...previous, hideNulls: next.hideNulls, selected: withClampedSelection(previous, next) };
      });
      return;
    }
    if (panelAction.type === 'clear-all') {
      amendTreeState((live) => {
        const next = clearTreeRules(frameTreeState(live).rules);
        if (next === null) {
          return null;
        }
        return {
          ...live,
          hiddenKeys: [...next.hiddenKeys],
          onlyKeys: [...next.onlyKeys],
          hideNulls: next.hideNulls,
          selected: withClampedSelection(live, next),
        };
      });
      return;
    }
    amendTreeState((live) => {
      const next = removeActiveRule(frameTreeState(live).rules, panelAction.index);
      if (next === null) {
        return null;
      }
      return {
        ...live,
        hiddenKeys: [...next.hiddenKeys],
        onlyKeys: [...next.onlyKeys],
        hideNulls: next.hideNulls,
        selected: withClampedSelection(live, next),
      };
    });
  };

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

  useInput(
    (input, key) => {
      // The destructive overwrite confirm owns every key: Enter overwrites, Esc backs out to
      // the name prompt, nothing else acts.
      if (overwriteConfirm !== null) {
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
      if (pickerDeleteConfirm !== null) {
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
      // The Saved sub-tab's delete confirm owns every key the same way: Enter deletes the
      // route-scoped row, Esc backs out to the tab.
      if (savedTabDeleteConfirm !== null) {
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
      // The inline name prompt owns every key: Enter saves (a colliding name stays put with
      // an inline error until Ctrl+O), Esc closes, arrows/tab never leave the field. Ctrl+O
      // is offered only for a confirmed duplicate — any other error re-saves with Enter.
      if (savePrompt !== null) {
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
      // The saved picker owns every key while open: Esc closes, `d` on a stale row (with an
      // empty filter — while filtering, the input owns every key) asks to delete it, Enter
      // loads a fresh row (a stale row is blocked with an error line), and everything else filters.
      // Loading first moves the list cursor onto the saved request's route — the pane always
      // reflects the cursor — clearing the list filter when it hides that route; a route from
      // another repo cannot load here and stays in the picker with an error line.
      if (pickerOpen) {
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
      if (filterEditing) {
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
      // While the right pane holds focus it owns the keyboard (AppShell is captured too). Open
      // sub-editors own every key first; then Ctrl+R fires, Ctrl+→/N and Ctrl+←/P switch
      // sub-tabs (no wrap), and each tab handles the rest.
      if (paneFocused) {
        if (editorOpen) {
          if (rawEditor !== null) {
            if (key.escape === true) {
              leaveRawEditor();
              return;
            }
            if (key.return === true) {
              const cursor = Math.min(Math.max(rawEditor.input.cursor, 0), rawEditor.input.value.length);
              const value = `${rawEditor.input.value.slice(0, cursor)}\n${rawEditor.input.value.slice(cursor)}`;
              setRawEditor({ input: { value, cursor: cursor + 1 }, error: rawEditor.error });
              return;
            }
            if (key.upArrow === true || key.downArrow === true) {
              return;
            }
            setRawEditor((previous) =>
              previous === null ? previous : { input: nextTextInputValue(previous.input, input, key), error: previous.error },
            );
            return;
          }
          if (scalarEdit !== null) {
            if (key.escape === true) {
              setScalarEdit(null);
              return;
            }
            if (key.return === true) {
              confirmScalarEdit();
              return;
            }
            if (key.upArrow === true || key.downArrow === true) {
              return;
            }
            setScalarEdit((previous) =>
              previous === null ? previous : { ...previous, input: nextTextInputValue(previous.input, input, key) },
            );
            return;
          }
          if (addPrompt !== null) {
            if (key.escape === true) {
              setAddPrompt(null);
              return;
            }
            if (key.return === true) {
              confirmAddPrompt();
              return;
            }
            if (key.upArrow === true || key.downArrow === true) {
              return;
            }
            setAddPrompt((previous) =>
              previous === null ? previous : { ...previous, input: nextTextInputValue(previous.input, input, key) },
            );
            return;
          }
        }
        if (rowEdit !== null) {
          if (key.escape === true) {
            setRowEdit(null);
            return;
          }
          if (key.return === true) {
            confirmRowEdit();
            return;
          }
          if (key.upArrow === true || key.downArrow === true || key.tab === true) {
            return;
          }
          setRowEdit((previous) => (previous === null ? previous : { ...previous, input: nextTextInputValue(previous.input, input, key) }));
          return;
        }
        if (rowAddPrompt !== null) {
          if (key.escape === true) {
            setRowAddPrompt(null);
            return;
          }
          if (key.return === true) {
            confirmRowAdd();
            return;
          }
          if (key.upArrow === true || key.downArrow === true || key.tab === true) {
            return;
          }
          setRowAddPrompt((previous) =>
            previous === null ? previous : { ...previous, input: nextTextInputValue(previous.input, input, key) },
          );
          return;
        }
        if (key.ctrl === true && (input === 'r' || input === 'R')) {
          firePaneRoute();
          return;
        }
        const tabNav = resolveTabNavKey(input, key);
        if (tabNav !== null) {
          const nextTab = stepTab(ROUTES_PANE_TABS, paneTab, tabNav);
          if (nextTab !== paneTab) {
            setPaneTab(nextTab);
            setFilterPanelOpen(false);
            setPanelCursor(0);
          }
          return;
        }
        if (key.ctrl === true || key.meta === true) {
          return;
        }
        // `s` saves the draft under a name (prefilled with the origin name when the draft
        // came from a saved request); every inline sub-editor above already owns its keys.
        if ((input === 's' || input === 'S') && paneTab === 'request') {
          openSavePrompt();
          return;
        }
        // Saved sub-tab: route-scoped quick re-fire. `/` focuses the filter (the input owns
        // every key while filtering), arrows/`j`/`k` move, `Enter` loads into Request, `d`
        // deletes through the confirm, `r` reloads the library, `Esc` clears the filter
        // first, then returns to the list.
        if (paneTab === 'saved') {
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
        if (paneTab === 'request') {
          const sectionStep = resolveFocusStep(input, key, 'tab');
          if (sectionStep !== null) {
            setSection((previous) => nextRequestSection(previous, sectionStep));
            setRowCursor(0);
            setFilterPanelOpen(false);
            setPanelCursor(0);
            return;
          }
          if (section === 'body') {
            // Esc closes the editor's rules panel first, then leaves the pane.
            if (key.escape === true) {
              if (filterPanelOpen) {
                setFilterPanelOpen(false);
              } else {
                closePane();
              }
              return;
            }
            if (!editorOpen) {
              return;
            }
            if (filterPanelOpen) {
              // Same auto-owning rule list as the response panel, over the editor's own
              // folds/filters (revisit restores them together with the draft).
              if (key.upArrow === true) {
                setPanelCursor((prev) => clampTreeSelection(prev - 1, editorRuleList.length));
                return;
              }
              if (key.downArrow === true) {
                setPanelCursor((prev) => clampTreeSelection(prev + 1, editorRuleList.length));
                return;
              }
              if (key.home === true) {
                setPanelCursor(0);
                return;
              }
              if (key.end === true) {
                setPanelCursor(Math.max(0, editorRuleList.length - 1));
                return;
              }
              if (input === ' ' || input === 'd' || input === 'D') {
                if (editorRuleList.length > 0) {
                  const at = clampedEditorPanelCursor;
                  amendEditorTreeState((live) => {
                    const next = removeActiveRule(frameEditorTreeState(live, readEditorDraft()).rules, at);
                    if (next === null) {
                      return null;
                    }
                    return {
                      ...live,
                      hiddenKeys: [...next.hiddenKeys],
                      onlyKeys: [...next.onlyKeys],
                      hideNulls: next.hideNulls,
                      selected: editorWithClampedSelection(live, readEditorDraft()),
                    };
                  });
                }
                return;
              }
              const editorPanelAction = resolveTreePanelKeyAction(input, editorRuleList.length);
              if (editorPanelAction === null) {
                return;
              }
              applyEditorPanelAction(editorPanelAction);
              return;
            }
            const editorAction = resolveTreeKeyAction(input, key);
            if (editorAction === null) {
              return;
            }
            applyEditorTreeAction(editorAction);
            return;
          }
          if (key.escape === true) {
            closePane();
            return;
          }
          const rowSection: RequestRowSection = section;
          const rows = rowsOf(paneDraft, rowSection);
          const at = rows.length === 0 ? 0 : Math.min(rowCursor, rows.length - 1);
          const direction = resolveRoutesDirection(key);
          if (direction !== null) {
            setRowCursor(moveRoutesSelection(at, direction, rows.length));
            return;
          }
          if (key.home === true) {
            setRowCursor(0);
            return;
          }
          if (key.end === true) {
            setRowCursor(Math.max(0, rows.length - 1));
            return;
          }
          if (key.return === true) {
            const row = rows[at];
            if (row !== undefined) {
              setRowEdit({ section: rowSection, index: at, input: { value: row.value, cursor: row.value.length } });
            }
            return;
          }
          if (rowSection !== 'params' && (input === 'a' || input === 'A')) {
            setRowAddPrompt({ section: rowSection, input: { value: '', cursor: 0 }, error: null });
            return;
          }
          if (rowSection !== 'params' && (input === 'd' || input === 'D') && rows[at] !== undefined && paneRouteKey !== null) {
            updateRequestDraft(paneRouteKey, (previous) => ({ ...previous, [rowSection]: removeRequestRow(previous[rowSection], at) }));
            setRowCursor(Math.max(0, Math.min(at, rows.length - 2)));
            return;
          }
          return;
        }
        // Response tab: Esc closes the rules panel first, then returns to Request (the draft is
        // intact there); the tree/raw keys follow the tree model.
        if (key.escape === true) {
          if (filterPanelOpen) {
            setFilterPanelOpen(false);
          } else {
            setPaneTab('request');
          }
          return;
        }
        if (classification === null) {
          return;
        }
        if (classification.kind === 'raw') {
          const move = resolveTreeKeyAction(input, key);
          if (move === 'up' || move === 'down' || move === 'home' || move === 'end' || move === 'page-up' || move === 'page-down') {
            amendTreeState((live) => ({
              ...live,
              selected: moveTreeSelection(
                clampTreeSelection(live.selected, rawLines.length),
                rawLines.length,
                Math.max(rawViewport, 1),
                move,
              ),
            }));
          }
          return;
        }
        if (classification.kind === 'empty') {
          return;
        }
        if (filterPanelOpen) {
          // The open panel auto-owns the arrows: the cursor navigates the rule list
          // immediately (no activation keypress), windowed past 10 rows.
          if (key.upArrow === true) {
            setPanelCursor((prev) => clampTreeSelection(prev - 1, treeRuleList.length));
            return;
          }
          if (key.downArrow === true) {
            setPanelCursor((prev) => clampTreeSelection(prev + 1, treeRuleList.length));
            return;
          }
          if (key.home === true) {
            setPanelCursor(0);
            return;
          }
          if (key.end === true) {
            setPanelCursor(Math.max(0, treeRuleList.length - 1));
            return;
          }
          if (input === ' ' || input === 'd' || input === 'D') {
            if (treeRuleList.length > 0) {
              const at = clampedPanelCursor;
              amendTreeState((live) => {
                const next = removeActiveRule(frameTreeState(live).rules, at);
                if (next === null) {
                  return null;
                }
                return {
                  ...live,
                  hiddenKeys: [...next.hiddenKeys],
                  onlyKeys: [...next.onlyKeys],
                  hideNulls: next.hideNulls,
                  selected: withClampedSelection(live, next),
                };
              });
            }
            return;
          }
          const panelAction = resolveTreePanelKeyAction(input, treeRuleList.length);
          if (panelAction === null) {
            return;
          }
          applyTreePanelAction(panelAction);
          return;
        }
        const action = resolveTreeKeyAction(input, key);
        if (action === null) {
          return;
        }
        applyTreeAction(action);
        return;
      }
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
      // `s` opens the saved-request picker: Enter reloads a fresh row into the Request tab
      // (stale rows render flagged and never load), `d` on a stale row deletes it.
      if (input === 's' || input === 'S') {
        openPicker();
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
    },
    { isActive: !commandBarOpen && !registryScreenOpen && !settingsScreenOpen && !resizeMode },
  );

  if (status === 'disabled') {
    return (
      <Box flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden" backgroundColor={colors.surface} paddingX={spacing['pane-padding-x']}>
        <Text color={colors.text}>{formatRoutesDisabledMessage(carryingServices)}</Text>
      </Box>
    );
  }

  if (routesStatus === 'error' && routesError?.code === 'route-exploration-not-activated') {
    return (
      <Box flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden" backgroundColor={colors.surface} paddingX={spacing['pane-padding-x']}>
        <FooterContext owner="routes" id={routesFooterContext({ ...UNAVAILABLE_FOOTER_INPUT, filterEditing, paneFocused })} useStore={useStore} />
        <Text color={colors['text-dim']}>ROUTES</Text>
        <StateLine kind="empty" subject="routes" text="No route list for this repo." />
        <DimAnnotation text={routesError.message} />
      </Box>
    );
  }

  if (routesStatus === 'error') {
    return (
      <Box flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden" backgroundColor={colors.surface} paddingX={spacing['pane-padding-x']}>
        <FooterContext owner="routes" id={routesFooterContext({ ...UNAVAILABLE_FOOTER_INPUT, filterEditing, paneFocused })} useStore={useStore} />
        <Text color={colors['text-dim']}>ROUTES</Text>
        <Text color={colors.error}>{routesError ? routesError.message : 'Route scan failed.'}</Text>
      </Box>
    );
  }

  if (routesStatus !== 'ready' || routes === null) {
    return (
      <Box flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden" backgroundColor={colors.surface} paddingX={spacing['pane-padding-x']}>
        <FooterContext owner="routes" id={routesFooterContext({ ...UNAVAILABLE_FOOTER_INPUT, filterEditing, paneFocused })} useStore={useStore} />
        <Text color={colors['text-dim']}>ROUTES</Text>
        <StateLine kind="loading" subject="routes" />
      </Box>
    );
  }

  if (routes.length === 0) {
    return (
      <Box flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden" backgroundColor={colors.surface} paddingX={spacing['pane-padding-x']}>
        <FooterContext owner="routes" id={routesFooterContext({ ...UNAVAILABLE_FOOTER_INPUT, filterEditing, paneFocused })} useStore={useStore} />
        <Text color={colors['text-dim']}>ROUTES</Text>
        <StateLine kind="empty" subject="routes" text="No routes discovered for this repo." />
      </Box>
    );
  }

  const clamped = visibleRoutes.length === 0 ? 0 : Math.min(selected, visibleRoutes.length - 1);
  const focused = visibleRoutes[clamped];
  // Live, measured budget of the flex-bound list area (it sits between the pane's header and
  // hint lines), so the BoundedList — indicator rows included — always fits exactly.
  const maxVisibleRows = listAreaSize !== null ? listAreaSize.height : Math.max(windowSize.rows - ROUTES_LIST_CHROME_ROWS, 3);
  const filterActive = filter.value !== '';
  const treeActive = treeFocused && classification !== null;
  const focusedEditable = focused !== undefined && canEditRouteBody(focused);
  // The footer reflects editor focus — the sub-editor owns the line while open, the tree mode
  // lists the edit keys. The add key only shows when an add target exists (UX-DR7: never hint an
  // inert key — scalar roots and empty drafts take `r`).
  const editorSelectedRow = editorOpen ? editorRows[clampedEditorSelected] : undefined;
  const editorCanAdd =
    editorSelectedRow !== undefined && editorDraft !== undefined && resolveAddParentPath(editorDraft, editorSelectedRow.path) !== null;
  const rowSectionRows = paneDraft !== null && section !== 'body' ? paneDraft[section] : [];
  const footerContext = routesFooterContext({
    unavailable: false,
    filterEditing,
    paneFocused,
    paneTab,
    saveState: savePrompt === null ? 'none' : savePrompt.duplicate ? 'duplicate' : 'naming',
    savedDeleteConfirm: savedTabDeleteConfirm !== null,
    listEditable: focusedEditable,
    filterPanelOpen,
    responseKind: treeActive ? (classification?.kind ?? null) : null,
    section,
    rowEditing: rowEdit !== null || rowAddPrompt !== null,
    rowCount: rowSectionRows.length,
    editor: { open: editorOpen, raw: rawEditor !== null, editing: scalarEdit !== null || addPrompt !== null, canAdd: editorCanAdd },
  });

  const bodyNode =
    rawEditor !== null && editorOpen ? (
      <JsonRawEditor input={rawEditor.input} error={rawEditor.error} maxVisibleRows={bodyTotalBudget} />
    ) : (
      <JsonTreeEditor
        rows={editorRows}
        selected={clampedEditorSelected}
        hiddenCount={editorHiddenCount}
        rules={editorRuleList}
        hideNulls={editorTreeState.hideNulls}
        panelOpen={editorOpen && filterPanelOpen}
        panelCursor={clampedEditorPanelCursor}
        maxVisibleRows={bodyTotalBudget}
        bodyEmpty={editorDraft === undefined}
        editErrors={editorErrors}
        firstError={editorFirstError}
        editingPath={editorOpen ? (scalarEdit?.path ?? null) : null}
        editInput={editorOpen ? (scalarEdit?.input ?? null) : null}
        editLabel={scalarEdit !== null ? editLabelFor(scalarEdit.path) : 'Edit value'}
        addPrompt={editorOpen ? addPrompt : null}
      />
    );

  const responseNode =
    classification === null || fireResult === null ? null : classification.kind === 'json' && treeValue !== undefined ? (
      <JsonTree
        rows={treeRows}
        selected={clampedTreeSelected}
        hiddenCount={treeHiddenCount}
        activeRuleCount={treeActiveRuleCount}
        rules={treeRuleList}
        hideNulls={treeState.hideNulls}
        panelOpen={treeActive && filterPanelOpen}
        panelCursor={clampedPanelCursor}
        maxVisibleRows={treeTotalBudget}
      />
    ) : classification.kind === 'raw' ? (
      <JsonRawFallback reason={classification.reason} lines={rawLines} selected={clampedRawSelected} maxVisibleRows={treeTotalBudget} />
    ) : classification.kind === 'empty' ? (
      <JsonEmptyState emptyKind={classification.emptyKind} />
    ) : null;

  return (
    <Box flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden" backgroundColor={colors.surface}>
      <FooterContext owner="routes" id={footerContext} useStore={useStore} />
      <ZoneLayout
        zoneId="routes"
        useStore={useStore}
        first={
          <Box flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden" paddingX={spacing['pane-padding-x']}>
            <Text color={colors['text-dim']} wrap="truncate-end">
              ROUTES{filterActive || routes.length !== visibleRoutes.length ? ` (${visibleRoutes.length}/${routes.length})` : ` (${routes.length})`}
            </Text>
            {routesRepoPath ? <DimAnnotation text={routesRepoPath} /> : null}
            {filterEditing ? (
              <TextInputLine label="Filter" value={filter.value} cursor={filter.cursor} focused />
            ) : filterActive ? (
              <Text color={colors.accent} wrap="truncate-end">Filter: {filter.value}</Text>
            ) : null}
            <Box ref={listAreaRef} flexDirection="column" flexGrow={1} flexBasis={0} minHeight={0} overflow="hidden">
              {visibleRoutes.length === 0 ? (
                <StateLine kind="empty" subject="routes" text="No routes match the filter." />
              ) : (
                <BoundedList
                  items={visibleRoutes}
                  maxVisibleRows={maxVisibleRows}
                  cursorIndex={clamped}
                  renderItem={(route, index) => {
                    const row = formatRouteRow(route);
                    return <ListRow key={`${route.method} ${route.path}`} label={row.label} selected={index === clamped} />;
                  }}
                />
              )}
            </Box>
          </Box>
        }
        second={
          <Box flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden" paddingX={spacing['pane-padding-x']}>
            {focused ? <DetailPane title="Route">{formatRouteDetail(focused)}</DetailPane> : null}
            {focused ? <RoutesPaneTabStrip tabs={ROUTES_PANE_TABS} active={paneTab} focused={paneFocused} /> : null}
            {focused && paneTab === 'request' ? (
              <RoutesRequestTab
                draft={paneDraft}
                section={paneFocused ? section : null}
                focused={paneFocused}
                rowCursor={rowCursor}
                rowEdit={rowEdit}
                rowAddPrompt={rowAddPrompt}
                hasBody={paneHasBody}
                fireBlock={paneFocused ? fireBlock : null}
                bodyAreaRef={bodyAreaRef}
                body={bodyNode}
              />
            ) : null}
            {focused && paneTab === 'request' && savePrompt !== null ? (
              <Box flexDirection="column">
                <TextInputLine label="Name" value={savePrompt.input.value} cursor={savePrompt.input.cursor} focused />
                {savePrompt.error !== null ? <Text color={colors.error}>{savePrompt.error}</Text> : null}
              </Box>
            ) : null}
            {focused && paneTab === 'request' && saveNotice !== null && savePrompt === null ? (
              <DimAnnotation text={saveNotice} />
            ) : null}
            {focused && paneTab === 'saved' ? (
              <RoutesSavedTab
                items={savedTabItems}
                pickState={savedTabState}
                error={paneFocused ? (savedTabError ?? savedRequestsError?.message ?? null) : null}
                isLoaded={savedRequests !== null}
              />
            ) : null}
            {focused && paneTab === 'response' ? (
              <RoutesResponseTab response={paneResponse} focused={paneFocused} areaRef={responseAreaRef}>
                {responseNode}
              </RoutesResponseTab>
            ) : null}
          </Box>
        }
      />
      {overwriteConfirm !== null ? (
        <ModalDialog title={`Overwrite "${overwriteConfirm.name}"?`}>
          <Box flexDirection="column">
            <Text color={colors.text}>A saved request named "{overwriteConfirm.name}" already exists. Overwriting replaces it.</Text>
            <Text color={colors.text}>{formatHints([['Enter', 'overwrite'], ['Esc', 'cancel']])}</Text>
          </Box>
        </ModalDialog>
      ) : null}
      {pickerOpen ? (
        <ModalDialog title="Saved requests">
          <Box flexDirection="column">
            {pickerError !== null ? <Text color={colors.error}>{pickerError}</Text> : null}
            {savedRequests === null ? (
              <DimAnnotation text="Loading saved requests…" />
            ) : (
              <FilterablePickList
                label="Filter"
                state={pickerState}
                items={savedItems}
                emptyText="No saved requests yet — press s in the Request tab to save one."
                noMatchText="No saved requests match."
              />
            )}
            <DimAnnotation text={formatHints([['Enter', 'load'], ['Esc', 'close'], ['d', 'delete stale']])} />
          </Box>
        </ModalDialog>
      ) : null}
      {pickerDeleteConfirm !== null ? (
        <ModalDialog title={`Delete "${pickerDeleteConfirm.name}"?`}>
          <Box flexDirection="column">
            <Text color={colors.text}>The stale saved request "{pickerDeleteConfirm.name}" will be removed. This cannot be undone.</Text>
            <Text color={colors.text}>{formatHints([['Enter', 'delete'], ['Esc', 'cancel']])}</Text>
          </Box>
        </ModalDialog>
      ) : null}
      {savedTabDeleteConfirm !== null ? (
        <ModalDialog title={`Delete "${savedTabDeleteConfirm.name}"?`}>
          <Box flexDirection="column">
            <Text color={colors.text}>The saved request "{savedTabDeleteConfirm.name}" will be removed. This cannot be undone.</Text>
            <Text color={colors.text}>{formatHints([['Enter', 'delete'], ['Esc', 'cancel']])}</Text>
          </Box>
        </ModalDialog>
      ) : null}
    </Box>
  );
}
