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
import { JsonEmptyState, JsonRawFallback, JsonTree } from '../../shared/components/json-tree/json-tree.js';
import {
  addHiddenKey,
  addOnlyKey,
  classifyResponseBody,
  clampTreeSelection,
  clearTreeRules,
  countActiveRules,
  countJsonNodes,
  createDefaultJsonTreeState,
  findParentIndex,
  flattenJson,
  foldNextDepthLevel,
  listActiveRules,
  moveTreeSelection,
  removeActiveRule,
  resolveTreeKeyAction,
  resolveTreeListBudget,
  resolveTreePanelKeyAction,
  toggleFoldPath,
  toggleHideNulls,
  unfoldNextDepthLevel,
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
  const treeActive = treeFocused && classification !== null;
  const listHint = filterEditing ? '[enter] apply  [esc] clear' : '[enter] fire  [/ f] filter  [home/end] jump';
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
            {fireStatus === 'fired' && fireResult ? (
              <DetailPane title="Response">{formatFireStatus(fireResult)}</DetailPane>
            ) : null}
            {fireStatus === 'fired' && fireResult && classification !== null ? (
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
