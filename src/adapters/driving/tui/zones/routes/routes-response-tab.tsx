// tui/zones/routes/response tab: the Routes right pane's Response tab for the pane route's last
// fire outcome — a spinner while firing, the distinct (auth-aware) error rendering, or
// `status · duration · size` above the tree/raw/empty view the zone hands in. Stateless; the
// zone owns the tree keys and measures `areaRef`.
import type { ReactNode } from 'react';
import { Box, Text, type DOMElement } from 'ink';
import { DetailPane } from '../../shared/components/detail-pane.js';
import { Spinner } from '../../shared/components/spinner.js';
import { StateLine } from '../../shared/components/state-line.js';
import { colors } from '../../shared/theme/theme.js';
import type { RouteResponse } from '../../store/slices/routes-slice.js';
import { formatFireError, formatFireStatus } from './routes-zone.logic.js';

export function RoutesResponseTab({
  response,
  areaRef,
  children,
}: {
  response: RouteResponse | undefined;
  areaRef: { current: DOMElement | null };
  children: ReactNode;
}) {
  if (response === undefined) {
    return <StateLine kind="empty" subject="response" />;
  }
  if (response.status === 'firing') {
    return (
      <Box flexDirection="row">
        <Spinner />
        <Text color={colors['text-dim']}> Firing…</Text>
      </Box>
    );
  }
  if (response.status === 'error') {
    return <Text color={colors.error}>{formatFireError(response.error.code, response.error.message)}</Text>;
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
