// tui/zones/routes: story 6.1 builds the real Routes content over story 2.13's
// `disabled`-status explanatory message (kept as-is below): a resizable list/detail split
// of the repo's discovered routes (list rows reuse the shared ListRow, rendered through
// BoundedList), driven by the store's routes slice (core/routes/list-routes.ts in-process,
// AD-2). Scan-in-progress shows the shared Spinner (first frame ⣾); scan-failure,
// genuinely-empty, and not-activated are three visibly distinct states — a failure is
// never rendered as an empty list. Pure formatting/selection logic lives in
// routes-zone.logic.ts; this file holds the Ink component only.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useInput, useWindowSize } from 'ink';
import { jumpSelection, resolveSelectionJump } from '../edts/edts-zone.logic.js';
import { useAppStore, type AppStore } from '../../store/app-store.js';
import { BoundedList } from '../../shared/components/bounded-list.js';
import { DetailPane } from '../../shared/components/detail-pane.js';
import { DimAnnotation } from '../../shared/components/dim-annotation.js';
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
  formatFireResult,
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
  const windowSize = useWindowSize();
  const [listAreaRef, listAreaSize] = useElementSize();

  useEffect(() => {
    setZoneInputCaptured(filterEditing);
  }, [filterEditing, setZoneInputCaptured]);
  useEffect(() => () => setZoneInputCaptured(false), [setZoneInputCaptured]);

  const visibleRoutes = useMemo(() => filterRoutes(routes ?? [], filter.value), [routes, filter.value]);

  useEffect(() => {
    void loadRoutes();
    // Deliberately fires once on mount only — a re-render never re-triggers a fetch of its
    // own (Design Notes: "refreshed on-demand ... not cached indefinitely").
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      if (input === '/') {
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
            <DimAnnotation text={filterEditing ? '[enter] apply  [esc] clear' : '[enter] fire  [/] filter  [home/end] jump'} />
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
              <DetailPane title="Response">{formatFireResult(fireResult)}</DetailPane>
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
