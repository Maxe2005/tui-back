// tui/zones/routes: routes-list-pane — the left pane: route count header, repo path, inline filter and the bounded route list.
import { Box, Text } from 'ink';
import type { RoutesZoneCtx } from '../routes-zone.ctx.js';
import { BoundedList } from '../../../shared/components/lists/bounded-list.js';
import { DimAnnotation } from '../../../shared/components/feedback/dim-annotation.js';
import { ListRow } from '../../../shared/components/lists/list-row.js';
import { StateLine } from '../../../shared/components/feedback/state-line.js';
import { TextInputLine } from '../../../shared/components/inputs/text-input-line.js';
import { colors, spacing } from '../../../shared/theme/theme.js';
import { RoutesFavoritesPane } from './routes-favorites-pane.js';
import { RoutesSmokePane } from './routes-smoke-pane.js';
import { RoutesRecentSection } from './routes-recent-section.js';
import { resolveFavoritesPaneRows } from '../logic/routes-favorites.logic.js';
import { resolveTopPaneRows } from '../logic/routes-smoke.logic.js';
import { formatRouteRow } from '../logic/routes-zone.logic.js';

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
  favorites,
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
  favorites: Pick<RoutesZoneCtx, 'favorites' | 'clampedFavCursor' | 'favoritesFocused' | 'favNotice' | 'favoriteRoutesError' | 'routes' | 'windowSize' | 'recents' | 'clampedRecentCursor' | 'recentFocused' | 'smokeVisible' | 'smoke' | 'smokeRows' | 'clampedSmokeCursor'>;
}) {
  const smokeShown = favorites.smokeVisible && favorites.smoke !== null;
  const favoriteRows = resolveTopPaneRows(favorites.windowSize.rows, favorites.favorites.length, favorites.recents.length, smokeShown ? favorites.smokeRows.length : null);
  return (
      <Box flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden" paddingX={spacing['pane-padding-x']}>
        {smokeShown && favorites.smoke !== null ? (
          <RoutesSmokePane
            rows={favorites.smokeRows}
            running={favorites.smoke.running}
            error={favorites.smoke.error}
            cursor={favorites.clampedSmokeCursor}
            focused={favorites.favoritesFocused}
            notice={favorites.favNotice}
            totalRows={favoriteRows.total}
            bodyRows={favoriteRows.body}
          />
        ) : (
        <RoutesFavoritesPane
          favorites={favorites.favorites}
          routes={favorites.routes}
          cursor={favorites.clampedFavCursor}
          focused={favorites.favoritesFocused}
          notice={favorites.favNotice}
          loadError={favorites.favoriteRoutesError === null ? null : favorites.favoriteRoutesError.message}
          totalRows={favoriteRows.total}
          bodyRows={favoriteRows.body}
        />
        )}
        <RoutesRecentSection
          recents={favorites.recents}
          cursor={favorites.clampedRecentCursor}
          focused={favorites.recentFocused}
          totalRows={favoriteRows.recent.total}
          bodyRows={favoriteRows.recent.body}
        />
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
