// tui/zones/routes: routes-favorites-pane — the bounded Favorites pane above the route list: the active EDT's favorites
// of the displayed repo (`METHOD path` + summary; stale ones dimmed with a `stale` suffix), or a teaching line when empty.
import { Box, Text } from 'ink';
import type { FavoriteWithStale } from '../../../../../../core/insight/routes/favorites.js';
import type { Route } from '../../../../../../core/ports/modules/route-scanner.js';
import { BoundedList } from '../../../shared/components/lists/bounded-list.js';
import { ListRow } from '../../../shared/components/lists/list-row.js';
import { colors } from '../../../shared/theme/theme.js';
import { FAVORITES_TEACHING_LINE, formatFavoriteRow } from '../logic/routes-favorites.logic.js';

export function RoutesFavoritesPane({
  favorites,
  routes,
  cursor,
  focused,
  notice,
  loadError,
  totalRows,
  bodyRows,
}: {
  favorites: readonly FavoriteWithStale[];
  routes: readonly Route[] | null;
  cursor: number;
  focused: boolean;
  notice: string | null;
  // The favorites could not be loaded: shown instead of the (misleading) empty teaching line.
  loadError: string | null;
  // Fixed row budget of the whole pane (header included) and of its body.
  totalRows: number;
  bodyRows: number;
}) {
  if (totalRows <= 0) {
    return null;
  }
  return (
    <Box flexDirection="column" flexShrink={0} height={totalRows} overflow="hidden">
      <Box flexShrink={0}>
        <Text color={focused ? colors.accent : colors['text-dim']} wrap="truncate-end">
          {`FAVORITES (${favorites.length})${notice === null ? '' : ` — ${notice}`}`}
        </Text>
      </Box>
      {bodyRows > 0 ? (
        favorites.length === 0 ? (
          <Box flexShrink={0}>
            <Text color={loadError === null ? colors['text-dim'] : colors.error} wrap="truncate-end">
              {loadError === null ? FAVORITES_TEACHING_LINE : `could not load: ${loadError}`}
            </Text>
          </Box>
        ) : (
          <BoundedList
            items={favorites}
            maxVisibleRows={bodyRows}
            cursorIndex={cursor}
            renderItem={(favorite, index) => {
              const row = formatFavoriteRow(favorite, routes);
              return (
                <ListRow
                  key={`${favorite.repoPath} ${favorite.method} ${favorite.path}`}
                  label={row.label}
                  {...(row.meta === undefined ? {} : { meta: row.meta })}
                  dim={row.stale}
                  selected={focused && index === cursor}
                />
              );
            }}
          />
        )
      ) : null}
    </Box>
  );
}
