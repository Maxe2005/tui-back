// tui/zones/routes/response tab: the Routes right pane's Response tab for the pane route's last
// fire outcome — a spinner while firing, the distinct (auth-aware) error rendering, or
// `status · duration · size` above the tree/raw/empty view the zone hands in. Stateless; the
// zone owns the tree keys and measures `areaRef`.
import type { ReactNode } from 'react';
import { Box, Text, type DOMElement } from 'ink';
import { DetailPane } from '../../shared/components/detail-pane.js';
import { formatHint } from '../../shared/components/hints.js';
import { StateLine } from '../../shared/components/state-line.js';
import { colors } from '../../shared/theme/theme.js';
import type { RouteResponse } from '../../store/slices/routes-slice.js';
import { formatFireError, formatFireStatus } from './routes-zone.logic.js';

export function RoutesResponseTab({
  response,
  focused,
  areaRef,
  children,
}: {
  response: RouteResponse | undefined;
  // Ctrl+R only works from the focused pane (UX-DR7: never hint an inert key).
  focused: boolean;
  areaRef: { current: DOMElement | null };
  children: ReactNode;
}) {
  if (response === undefined) {
    return <StateLine kind="empty" subject="response" text={focused ? `No response yet — ${formatHint(['Ctrl+R', 'fire'])}` : undefined} />;
  }
  if (response.status === 'firing') {
    return (
      <StateLine kind="loading" verb="Firing" subject="" />
    );
  }
  if (response.status === 'error') {
    return <Text color={colors.error} wrap="truncate-end">{formatFireError(response.error.code, response.error.message)}</Text>;
  }
  return (
    <Box flexDirection="column" flexGrow={1} flexBasis={0} minHeight={0} overflow="hidden">
      <DetailPane title="Response">{formatFireStatus(response.result)}</DetailPane>
      <Box ref={areaRef} flexDirection="column" flexGrow={1} flexBasis={0} minHeight={0} overflow="hidden">
        {children}
      </Box>
    </Box>
  );
}
