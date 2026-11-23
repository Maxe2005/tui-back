// tui/zones/routes: routes-list-pane — the left pane: route count header, repo path, inline filter and the bounded route list.
import { Box, Text } from 'ink';
import type { RoutesZoneCtx } from './routes-zone.ctx.js';
import { BoundedList } from '../../shared/components/bounded-list.js';
import { DimAnnotation } from '../../shared/components/feedback/dim-annotation.js';
import { ListRow } from '../../shared/components/list-row.js';
import { StateLine } from '../../shared/components/feedback/state-line.js';
import { TextInputLine } from '../../shared/components/inputs/text-input-line.js';
import { colors, spacing } from '../../shared/theme/theme.js';
import { formatRouteRow } from './routes-zone.logic.js';

export function RoutesListPane({
  routes,
  visibleRoutes,
  routesRepoPath,
  filter,
  filterEditing,
  filterActive,
  listAreaRef,
  maxVisibleRows,
  clamped,
}: {
  routes: NonNullable<RoutesZoneCtx['routes']>;
  visibleRoutes: RoutesZoneCtx['visibleRoutes'];
  routesRepoPath: RoutesZoneCtx['routesRepoPath'];
  filter: RoutesZoneCtx['filter'];
  filterEditing: boolean;
  filterActive: boolean;
  listAreaRef: RoutesZoneCtx['listAreaRef'];
  maxVisibleRows: number;
  clamped: number;
}) {
  return (
      <Box flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden" paddingX={spacing['pane-padding-x']}>
        <Text color={colors['text-dim']} wrap="truncate-end">
          ROUTES{filterActive || routes.length !== visibleRoutes.length ? ` (${visibleRoutes.length}/${routes.length})` : ` (${routes.length})`}
        </Text>
        {routesRepoPath ? <DimAnnotation text={routesRepoPath} /> : null}
        {filterEditing ? (
          // TextInputLine's box grows (flexGrow) to measure its width; in this column pane that
          // would also grow vertically and eat half the free height, so wrap it to keep one row.
          <Box flexShrink={0}>
            <TextInputLine label="Filter" value={filter.value} cursor={filter.cursor} focused />
          </Box>
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
  );
}
