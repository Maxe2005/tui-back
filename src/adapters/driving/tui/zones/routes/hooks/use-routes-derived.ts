// tui/zones/routes: use-routes-derived — the pane route/draft, saved-picker rows and the response/body-editor tree memos derived from the state layer.
import { useMemo } from 'react';
import type { FilterablePickItem } from '../../../shared/components/pickers/filterable-pick-list.js';
import type { RoutesState } from './use-routes-state.js';
import type { SavedWithStale } from '../../../../../../core/routes/saved-requests.js';
import {
  type BodyEditError,
  canEditRouteBody,
  clampTreeSelection,
  classifyResponseBody,
  countActiveRules,
  countJsonNodes,
  createDefaultJsonTreeState,
  firstEditError,
  flattenJson,
  type JsonTreeState,
  listActiveRules,
  resolveTreeListBudget,
  routeKeyFor,
  seedBodyDraft,
} from '../../../shared/components/json-tree/model.js';
import { RESPONSE_AREA_CHROME_ROWS } from '../routes-zone.constants.js';
import { bodyTreeKey, type RequestDraft, seedRequestDraft } from '../routes-request.logic.js';
import { filterRoutes, resolveEnterFireTarget } from '../routes-zone.logic.js';

export function useRoutesDerived(c: RoutesState) {
  const {
    routes, responses, requestDrafts, paneTab, jsonTreeStates, bodyDrafts, bodyEditErrors, savedRequests,
    selected, filter, filterPanelOpen, panelCursor, section, windowSize, responseAreaSize, bodyAreaSize,
    paneFocused,
  } = c;
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
  const treeActive = treeFocused && classification !== null;
  return {
    visibleRoutes, paneRoute, paneRouteKey, paneResponse, fireResult, firedRouteKey, treeFocused, paneDraft,
    paneHasBody, savedItems, savedTabItems, classification, treeState, treeValue, treeRules, treeRows,
    treeHiddenCount, treeActiveRuleCount, treeRuleList, clampedPanelCursor, clampedTreeSelected, rawLines,
    clampedRawSelected, treeTotalBudget, treeViewport, rawViewport, editorRouteKey, editorRoute,
    editorHasDraft, editorDraft, editorTreeState, editorRules, editorRows, editorHiddenCount, editorRuleList,
    editorErrors, editorFirstError, clampedEditorSelected, clampedEditorPanelCursor, bodyTotalBudget,
    editorViewport, editorOpen, treeActive,
  };
}

export type RoutesDerived = ReturnType<typeof useRoutesDerived>;

export type RoutesBaseCtx = RoutesState & RoutesDerived;
