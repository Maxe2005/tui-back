// tui/zones/routes: routes-recent-section — the bounded Recent section under the favorites: the routes fired this
// session for the displayed repo, newest first, `METHOD path` + `status · duration` (or the error code).
import { Box, Text } from 'ink';
import type { RecentRoute } from '../../../store/slices/workspace/routes-slice.js';
import { BoundedList } from '../../../shared/components/lists/bounded-list.js';
import { ListRow } from '../../../shared/components/lists/list-row.js';
import { colors } from '../../../shared/theme/theme.js';
import { formatRecentRow } from '../logic/routes-recent.logic.js';

export function RoutesRecentSection({
  recents,
  cursor,
  focused,
  totalRows,
  bodyRows,
}: {
  recents: readonly RecentRoute[];
  cursor: number;
  focused: boolean;
  // Fixed row budget of the whole section (header included) and of its body.
  totalRows: number;
  bodyRows: number;
}) {
  if (totalRows <= 0 || recents.length === 0) {
    return null;
  }
  return (
    <Box flexDirection="column" flexShrink={0} height={totalRows} overflow="hidden">
      <Box flexShrink={0}>
        <Text color={focused ? colors.accent : colors['text-dim']} wrap="truncate-end">{`RECENT (${recents.length})`}</Text>
      </Box>
      {bodyRows > 0 ? (
        <BoundedList
          items={recents}
          maxVisibleRows={bodyRows}
          cursorIndex={cursor}
          renderItem={(recent, index) => {
            const row = formatRecentRow(recent);
            return (
              <ListRow
                key={`${recent.repoPath} ${recent.method} ${recent.path}`}
                label={row.label}
                meta={row.meta}
                selected={focused && index === cursor}
              />
            );
          }}
        />
      ) : null}
    </Box>
  );
}
