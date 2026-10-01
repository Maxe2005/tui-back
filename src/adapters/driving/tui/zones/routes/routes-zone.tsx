// tui/zones/routes: story 6.1 builds the real Routes content over story 2.13's
// `disabled`-status explanatory message (kept as-is below): a resizable list/detail split
// of the repo's discovered routes (list rows reuse the shared ListRow, rendered through
// BoundedList), driven by the store's routes slice (core/routes/list-routes.ts in-process,
// AD-2). Scan-in-progress shows the shared Spinner (first frame ⣾); scan-failure,
// genuinely-empty, and not-activated are three visibly distinct states — a failure is
// never rendered as an empty list. Pure formatting/selection logic lives in
// routes-zone.logic.ts; this file holds the Ink component only.
//
// Story 6.2: Enter fires the selected route; the detail pane shows the fired response.
// Story 6.7: a fired JSON body renders as a navigable JsonTree (fold, depth levels,
// session key filters) with per-route session state from the slice; firing focuses the
// tree (its keys own the keyboard while focused), Esc returns focus to the list.
// Non-JSON bodies fall back to scrollable raw text with their reason, empty bodies to an
// explicit empty state — never a partial tree. The tree lives in the detail Box next to
// (never inside) DetailPane, which keeps the status line.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useInput, useWindowSize } from 'ink';
import { jumpSelection, resolveSelectionJump } from '../edts/edts-zone.logic.js';
import { useAppStore, type AppStore } from '../../store/app-store.js';
import { BoundedList } from '../../shared/components/bounded-list.js';
import { DetailPane } from '../../shared/components/detail-pane.js';
import { DimAnnotation } from '../../shared/components/dim-annotation.js';
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
  seedBodyDraft,
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
import { ListDetailSplit } from '../../shared/components/list-detail-split.js';
import { ListRow } from '../../shared/components/list-row.js';
import { Spinner } from '../../shared/components/spinner.js';
import { nextTextInputValue, type TextInputState } from '../../shared/components/text-edit.js';
import { TextInputLine } from '../../shared/components/text-input-line.js';
import { useElementSize } from '../../shared/hooks/use-element-size.js';
import { colors, spacing } from '../../shared/theme/theme.js';
import {
  filterRoutes,
  formatFireError,
  formatFireStatus,
  formatRouteDetail,
  formatRouteRow,
  moveRoutesSelection,
  resolveEnterFireTarget,
  resolveRoutesDirection,
} from './routes-zone.logic.js';

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
  const ratio = useStore((state) => state.splitterRatios.routes[0]);
  const resizeMode = useStore((state) => state.resizeMode);
  const commandBarOpen = useStore((state) => state.commandBarOpen);
  const registryScreenOpen = useStore((state) => state.registryScreenOpen);
  const settingsScreenOpen = useStore((state) => state.settingsScreenOpen);
  const routes = useStore((state) => state.routes);
  const routesStatus = useStore((state) => state.routesStatus);
  const routesError = useStore((state) => state.routesError);
  const routesRepoPath = useStore((state) => state.routesRepoPath);
  const loadRoutes = useStore((state) => state.loadRoutes);
  const fireStatus = useStore((state) => state.fireStatus);
  const fireResult = useStore((state) => state.fireResult);
  const fireError = useStore((state) => state.fireError);
  const fireRoute = useStore((state) => state.fireRoute);
  const jsonTreeStates = useStore((state) => state.jsonTreeStates);
  const firedRouteKey = useStore((state) => state.firedRouteKey);
  const treeFocused = useStore((state) => state.treeFocused);
  const setTreeFocused = useStore((state) => state.setTreeFocused);
  const updateJsonTreeState = useStore((state) => state.updateJsonTreeState);
  const bodyDrafts = useStore((state) => state.bodyDrafts);
  const bodyEditErrors = useStore((state) => state.bodyEditErrors);
  const ensureBodyDraft = useStore((state) => state.ensureBodyDraft);
  const updateBodyDraft = useStore((state) => state.updateBodyDraft);
  const setBodyEditError = useStore((state) => state.setBodyEditError);
  const setBodyEditErrors = useStore((state) => state.setBodyEditErrors);

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
  // Story 6.8: the request-body editor — which route is being edited (detail pane shows
  // the editor while open) plus its transient inline/raw UI. Drafts, folds, and filters
  // live in the store (per-route, session-only), so a revisit restores them together;
  // only the open editor + its text buffers are zone-local.
  const [editorRouteKey, setEditorRouteKey] = useState<string | null>(null);
  const [scalarEdit, setScalarEdit] = useState<{ path: string; kind: JsonScalarKind; input: TextInputState } | null>(null);
  const [addPrompt, setAddPrompt] = useState<{ parentPath: string; input: TextInputState; error: string | null } | null>(null);
  const [rawEditor, setRawEditor] = useState<{ input: TextInputState; error: string | null } | null>(null);
  const windowSize = useWindowSize();
  const [listAreaRef, listAreaSize] = useElementSize();
  const [responseAreaRef, responseAreaSize] = useElementSize();

  useEffect(() => {
    setZoneInputCaptured(filterEditing);
  }, [filterEditing, setZoneInputCaptured]);
  useEffect(() => () => setZoneInputCaptured(false), [setZoneInputCaptured]);

  const visibleRoutes = useMemo(() => filterRoutes(routes ?? [], filter.value), [routes, filter.value]);

  // The fired body, classified in the driving adapter (never core): JSON becomes the
  // navigable tree, anything else its raw/empty fallback.
  const classification = useMemo(
    () => (fireStatus === 'fired' && fireResult !== null ? classifyResponseBody(fireResult.body) : null),
    [fireStatus, fireResult],
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

  // Story 6.8: the editor draft + its tree frame. The draft is the store's per-route
  // `bodyDrafts` entry (`undefined` = empty, press `r`); folds/filters/selection reuse
  // the route's existing `jsonTreeStates` entry, so body, filters, and folds restore
  // together on revisit. Hidden lines are purely visual — still sent.
  const editorRoute = useMemo(
    () => (editorRouteKey === null ? null : ((routes ?? []).find((route) => routeKeyFor(route.method, route.path) === editorRouteKey) ?? null)),
    [editorRouteKey, routes],
  );
  const editorHasDraft = editorRouteKey !== null && Object.prototype.hasOwnProperty.call(bodyDrafts, editorRouteKey);
  const editorDraft: unknown = editorRouteKey !== null && editorHasDraft ? bodyDrafts[editorRouteKey] : undefined;
  const editorTreeState: JsonTreeState = useMemo(
    () => (editorRouteKey !== null ? (jsonTreeStates[editorRouteKey] ?? createDefaultJsonTreeState()) : createDefaultJsonTreeState()),
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
  const editorViewport = resolveTreeListBudget(treeTotalBudget, filterPanelOpen, editorRuleList.length);
  const editorOpen = editorRouteKey !== null && editorRoute !== null;

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

  // Story 6.8 editor plumbing. Drafts and error maps are read live from the store at
  // apply time (never the render closure), so two composed updates in one tick compute
  // from the latest state instead of a stale draft.
  const amendEditorTreeState = (recipe: (live: JsonTreeState) => JsonTreeState | null) => {
    if (editorRouteKey === null) {
      return;
    }
    const key = editorRouteKey;
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

  const closeEditor = () => {
    setEditorRouteKey(null);
    setScalarEdit(null);
    setAddPrompt(null);
    setRawEditor(null);
  };

  const openEditorForRoute = (route: { method: string; path: string; bodyExample?: unknown; bodyContentType?: string }) => {
    if (!canEditRouteBody(route)) {
      return;
    }
    const key = routeKeyFor(route.method, route.path);
    ensureBodyDraft(key, seedBodyDraft(route));
    setEditorRouteKey(key);
    setScalarEdit(null);
    setAddPrompt(null);
    setRawEditor(null);
    setFilterPanelOpen(false);
    setPanelCursor(0);
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
    // Deliberately fires once on mount only — a re-render never re-triggers a fetch of its
    // own (Design Notes: "refreshed on-demand ... not cached indefinitely").
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A fresh fire gets a closed panel; the persisted rules/folds come from the slice.
  useEffect(() => {
    setFilterPanelOpen(false);
    setPanelCursor(0);
  }, [firedRouteKey]);

  // The editor follows its route: a reload that drops the route closes the editor
  // (its draft/error map stay in the store under the same key).
  useEffect(() => {
    if (editorRouteKey !== null && editorRoute === null) {
      closeEditor();
    }
    // closeEditor is a render-local helper over stable setters — not an effect dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorRouteKey, editorRoute]);

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
      // Story 6.8: while the body editor is open it owns the keyboard — every list
      // binding (including Enter-fire) stays inert, and the 6.7 response tree never
      // sees these keypresses. Esc unwinds inline/raw editors first, the rules panel
      // next, and the editor itself last (the 6.7 panel rule).
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
        if (key.escape === true) {
          setFilterPanelOpen(false);
          if (!filterPanelOpen) {
            closeEditor();
          }
          return;
        }
        if (filterPanelOpen) {
          // Same auto-owning rule list as the 6.7 response panel, over the editor's
          // own folds/filters (revisit restores them together with the draft).
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
      // Story 6.7: while the response tree holds focus it owns the keyboard — every list
      // binding below stays inert (list behavior is unchanged the moment Esc returns
      // focus). Esc itself closes the filter panel first, unfocuses second.
      if (treeFocused && classification !== null) {
        if (key.escape === true) {
          setFilterPanelOpen(false);
          if (!filterPanelOpen) {
            setTreeFocused(false);
          }
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
      // Story 6.8: `e` opens the body editor for the focused route when it carries a
      // body (an example or any content type — non-JSON starts empty); routes with
      // neither stay inert with no hint. List Enter-fire below still sends no body.
      if (input === 'e' || input === 'E') {
        const target = resolveEnterFireTarget(visibleRoutes, selected);
        if (target !== undefined) {
          openEditorForRoute(target);
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
      if (key.escape === true && filter.value !== '') {
        setFilter({ value: '', cursor: 0 });
        setSelected(0);
        return;
      }
      // Story 6.2: Enter fires the selected route (`[enter] fire`) — no body/header
      // customization, no saving (Story 6.3 territory); the fire uses the discovered
      // method + path as-is.
      if (key.return === true) {
        const target = resolveEnterFireTarget(visibleRoutes, selected);
        if (target !== undefined) {
          void fireRoute(target.method, target.path);
        }
        return;
      }
      const jump = resolveSelectionJump({ ...key, upArrow: false, downArrow: false, tab: false });
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
        <Text color={colors['text-dim']}>ROUTES</Text>
        <Text color={colors.text}>No route list for this repo.</Text>
        <DimAnnotation text={routesError.message} />
      </Box>
    );
  }

  if (routesStatus === 'error') {
    return (
      <Box flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden" backgroundColor={colors.surface} paddingX={spacing['pane-padding-x']}>
        <Text color={colors['text-dim']}>ROUTES</Text>
        <Text color={colors.error}>{routesError ? routesError.message : 'Route scan failed.'}</Text>
      </Box>
    );
  }

  if (routesStatus !== 'ready' || routes === null) {
    return (
      <Box flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden" backgroundColor={colors.surface} paddingX={spacing['pane-padding-x']}>
        <Text color={colors['text-dim']}>ROUTES</Text>
        <Box flexDirection="row">
          <Spinner />
          <Text color={colors['text-dim']}> Loading routes…</Text>
        </Box>
      </Box>
    );
  }

  if (routes.length === 0) {
    return (
      <Box flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden" backgroundColor={colors.surface} paddingX={spacing['pane-padding-x']}>
        <Text color={colors['text-dim']}>ROUTES</Text>
        <Text color={colors.text}>No routes discovered for this repo.</Text>
      </Box>
    );
  }

  const clamped = visibleRoutes.length === 0 ? 0 : Math.min(selected, visibleRoutes.length - 1);
  const focused = visibleRoutes[clamped];
  // Live, measured budget of the flex-bound list area (it sits between the pane's header and
  // hint lines), so the BoundedList — indicator rows included — always fits exactly.
  const maxVisibleRows = listAreaSize !== null ? listAreaSize.height : Math.max(windowSize.rows - ROUTES_LIST_CHROME_ROWS, 3);
  const filterActive = filter.value !== '';
  const treeActive = treeFocused && classification !== null && !editorOpen;
  const focusedEditable = focused !== undefined && canEditRouteBody(focused) && !editorOpen;
  const listHint = filterEditing
    ? '[enter] apply  [esc] clear'
    : focusedEditable
      ? '[enter] fire  [/ f] filter  [e] edit body  [home/end] jump'
      : '[enter] fire  [/ f] filter  [home/end] jump';
  // The right pane owns its own shortcut line at its bottom while the tree holds focus;
  // the list pane keeps list-only hints.
  const treeHint = !treeActive
    ? null
    : classification?.kind === 'raw'
      ? '[esc] list · [↑↓] scroll'
      : classification?.kind === 'empty'
        ? '[esc] list'
        : filterPanelOpen
          ? '[esc/f] close · [↑↓] select · [space] remove · [1-9] remove · [n] nulls · [c] clear'
          : '[esc] list · [↑↓] move · [←→] fold · [h/H] filter · [f] rules · [+/-] level';
  // Story 6.8: footer hints reflect editor focus — the sub-editor owns its line while
  // open, the tree mode lists the edit keys. `[a]` only shows when an add target exists
  // (UX-DR7: never hint an inert key — scalar roots and empty drafts take `r`).
  const editorSelectedRow = editorOpen ? editorRows[clampedEditorSelected] : undefined;
  const editorCanAdd =
    editorSelectedRow !== undefined && editorDraft !== undefined && resolveAddParentPath(editorDraft, editorSelectedRow.path) !== null;
  const editorHint: string | null = !editorOpen
    ? null
    : rawEditor !== null
      ? '[esc] done · [enter] newline'
      : scalarEdit !== null || addPrompt !== null
        ? '[enter] confirm · [esc] cancel'
        : filterPanelOpen
          ? '[esc/f] close · [↑↓] select · [space] remove · [1-9] remove · [n] nulls · [c] clear'
          : `[esc] list · [enter] edit · ${editorCanAdd ? '[a] add · ' : ''}[d] delete · [t] type · [r] raw · [←→] fold · [h/H] filter`;

  return (
    <Box flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden" backgroundColor={colors.surface}>
      <ListDetailSplit
        ratio={ratio}
        listSplitterTargeted={resizeMode?.zone === 'routes' && resizeMode.targetBoundary === 0}
        list={
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
                <Text color={colors['text-dim']}>No routes match the filter.</Text>
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
            <DimAnnotation text={listHint} />
          </Box>
        }
        detail={
          <Box flexDirection="column" minHeight={0} overflow="hidden" paddingX={spacing['pane-padding-x']}>
            {focused ? <DetailPane title="Route">{formatRouteDetail(focused)}</DetailPane> : null}
            {fireStatus === 'firing' ? (
              <Box flexDirection="row">
                <Spinner />
                <Text color={colors['text-dim']}> Firing…</Text>
              </Box>
            ) : null}
            {editorOpen && editorRoute ? (
              <Box flexDirection="column" flexGrow={1} flexBasis={0} minHeight={0} overflow="hidden">
                <Text color={colors['text-dim']} wrap="truncate-end">
                  {`REQUEST BODY — ${editorRoute.method} ${editorRoute.path}`}
                </Text>
                <Box ref={responseAreaRef} flexDirection="column" flexGrow={1} flexBasis={0} minHeight={0} overflow="hidden">
                  {rawEditor !== null ? (
                    <JsonRawEditor input={rawEditor.input} error={rawEditor.error} maxVisibleRows={treeTotalBudget} />
                  ) : (
                    <JsonTreeEditor
                      rows={editorRows}
                      selected={clampedEditorSelected}
                      hiddenCount={editorHiddenCount}
                      rules={editorRuleList}
                      hideNulls={editorTreeState.hideNulls}
                      panelOpen={filterPanelOpen}
                      panelCursor={clampedEditorPanelCursor}
                      maxVisibleRows={treeTotalBudget}
                      bodyEmpty={editorDraft === undefined}
                      editErrors={editorErrors}
                      firstError={editorFirstError}
                      editingPath={scalarEdit?.path ?? null}
                      editInput={scalarEdit?.input ?? null}
                      editLabel={scalarEdit !== null ? editLabelFor(scalarEdit.path) : 'Edit value'}
                      addPrompt={addPrompt}
                    />
                  )}
                </Box>
                {editorHint !== null ? <DimAnnotation text={editorHint} /> : null}
              </Box>
            ) : null}
            {!editorOpen && fireStatus === 'fired' && fireResult ? (
              <DetailPane title="Response">{formatFireStatus(fireResult)}</DetailPane>
            ) : null}
            {!editorOpen && fireStatus === 'fired' && fireResult && classification !== null ? (
              <Box flexDirection="column" flexGrow={1} flexBasis={0} minHeight={0} overflow="hidden">
                <Box ref={responseAreaRef} flexDirection="column" flexGrow={1} flexBasis={0} minHeight={0} overflow="hidden">
                  {classification.kind === 'json' && treeValue !== undefined ? (
                    <JsonTree
                      rows={treeRows}
                      selected={clampedTreeSelected}
                      hiddenCount={treeHiddenCount}
                      activeRuleCount={treeActiveRuleCount}
                      rules={treeRuleList}
                      hideNulls={treeState.hideNulls}
                      panelOpen={filterPanelOpen}
                      panelCursor={clampedPanelCursor}
                      maxVisibleRows={treeTotalBudget}
                    />
                  ) : classification.kind === 'raw' ? (
                    <JsonRawFallback reason={classification.reason} lines={rawLines} selected={clampedRawSelected} maxVisibleRows={treeTotalBudget} />
                  ) : classification.kind === 'empty' ? (
                    <JsonEmptyState emptyKind={classification.emptyKind} />
                  ) : null}
                </Box>
                {treeHint !== null ? <DimAnnotation text={treeHint} /> : null}
              </Box>
            ) : null}
            {fireStatus === 'error' && fireError ? (
              <Text color={colors.error}>{formatFireError(fireError.code, fireError.message)}</Text>
            ) : null}
          </Box>
        }
      />
    </Box>
  );
}
