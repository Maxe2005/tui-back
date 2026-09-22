// tui/zones/routes: story 6.1 builds the real Routes content over story 2.13's
// `disabled`-status explanatory message (kept as-is below): a resizable list/detail split
// of the repo's discovered routes (list rows reuse the shared ListRow, rendered through
// BoundedList), driven by the store's routes slice (core/routes/list-routes.ts in-process,
// AD-2). Scan-in-progress shows the shared Spinner (first frame ⣾); scan-failure,
// genuinely-empty, and not-activated are three visibly distinct states — a failure is
// never rendered as an empty list. Pure formatting/selection logic lives in
// routes-zone.logic.ts; this file holds the Ink component only.
import { useEffect, useState } from 'react';
import { Box, Text, useInput, useWindowSize } from 'ink';
import { useAppStore, type AppStore } from '../../store/app-store.js';
import { BoundedList } from '../../shared/components/bounded-list.js';
import { DetailPane } from '../../shared/components/detail-pane.js';
import { DimAnnotation } from '../../shared/components/dim-annotation.js';
import { ListDetailSplit } from '../../shared/components/list-detail-split.js';
import { ListRow } from '../../shared/components/list-row.js';
import { Spinner } from '../../shared/components/spinner.js';
import { colors, spacing } from '../../shared/theme/theme.js';
import {
  formatRouteDetail,
  formatRouteRow,
  moveRoutesSelection,
  resolveRoutesDirection,
} from './routes-zone.logic.js';

// Same unbounded-list guard as the Logs/EDTs zones (story 5.5): a rough terminal-chrome
// budget subtracted from the raw window size before the route list's own BoundedList ever
// sees it ("an approximation is fine here").
const ROUTES_LIST_CHROME_ROWS = 8;

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

  const [selected, setSelected] = useState(0);
  const windowSize = useWindowSize();

  useEffect(() => {
    void loadRoutes();
    // Deliberately fires once on mount only — a re-render never re-triggers a fetch of its
    // own (Design Notes: "refreshed on-demand ... not cached indefinitely").
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Arrowing onto a different repo's list must never leave the cursor on an unrelated row
  // (mirrors edts-zone.tsx's own cursor reset when the focused EDT changes).
  useEffect(() => {
    setSelected(0);
  }, [routesRepoPath]);

  useInput(
    (_input, key) => {
      const direction = resolveRoutesDirection(key);
      if (direction !== null) {
        setSelected((prev) => moveRoutesSelection(prev, direction, routes?.length ?? 0));
      }
    },
    { isActive: !commandBarOpen && !registryScreenOpen && !settingsScreenOpen && !resizeMode },
  );

  if (status === 'disabled') {
    return (
      <Box flexDirection="column" flexGrow={1} backgroundColor={colors.surface} paddingX={spacing['pane-padding-x']}>
        <Text color={colors.text}>{formatRoutesDisabledMessage(carryingServices)}</Text>
      </Box>
    );
  }

  if (routesStatus === 'error' && routesError?.code === 'route-exploration-not-activated') {
    return (
      <Box flexDirection="column" flexGrow={1} backgroundColor={colors.surface} paddingX={spacing['pane-padding-x']}>
        <Text color={colors['text-dim']}>ROUTES</Text>
        <Text color={colors.text}>No route list for this repo.</Text>
        <DimAnnotation text={routesError.message} />
      </Box>
    );
  }

  if (routesStatus === 'error') {
    return (
      <Box flexDirection="column" flexGrow={1} backgroundColor={colors.surface} paddingX={spacing['pane-padding-x']}>
        <Text color={colors['text-dim']}>ROUTES</Text>
        <Text color={colors.error}>{routesError ? routesError.message : 'Route scan failed.'}</Text>
      </Box>
    );
  }

  if (routesStatus !== 'ready' || routes === null) {
    return (
      <Box flexDirection="column" flexGrow={1} backgroundColor={colors.surface} paddingX={spacing['pane-padding-x']}>
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
      <Box flexDirection="column" flexGrow={1} backgroundColor={colors.surface} paddingX={spacing['pane-padding-x']}>
        <Text color={colors['text-dim']}>ROUTES</Text>
        <Text color={colors.text}>No routes discovered for this repo.</Text>
      </Box>
    );
  }

  const clamped = routes.length === 0 ? 0 : Math.min(selected, routes.length - 1);
  const focused = routes[clamped];
  const maxVisibleRows = Math.max(windowSize.rows - ROUTES_LIST_CHROME_ROWS, 4);

  return (
    <Box flexDirection="column" flexGrow={1} backgroundColor={colors.surface}>
      <ListDetailSplit
        ratio={ratio}
        listSplitterTargeted={resizeMode?.zone === 'routes' && resizeMode.targetBoundary === 0}
        list={
          <Box flexDirection="column" paddingX={spacing['pane-padding-x']}>
            <Text color={colors['text-dim']}>ROUTES</Text>
            {routesRepoPath ? <DimAnnotation text={routesRepoPath} /> : null}
            <BoundedList
              items={routes}
              maxVisibleRows={maxVisibleRows}
              cursorIndex={clamped}
              renderItem={(route, index) => {
                const row = formatRouteRow(route);
                return <ListRow key={`${route.method} ${route.path}`} label={row.label} meta={row.meta} selected={index === clamped} />;
              }}
            />
          </Box>
        }
        detail={
          <Box flexDirection="column" paddingX={spacing['pane-padding-x']}>
            {focused ? <DetailPane title="Route">{formatRouteDetail(focused)}</DetailPane> : null}
          </Box>
        }
      />
    </Box>
  );
}
