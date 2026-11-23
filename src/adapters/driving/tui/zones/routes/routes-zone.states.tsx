// tui/zones/routes: routes-zone.states — the Routes zone's non-ready screens (disabled, route list unavailable, loading, empty).
import type { ReactNode } from 'react';
import { Box, Text } from 'ink';
import type { AppStore } from '../../store/app-store.js';
import { ClampedParagraph } from '../../shared/components/display/truncated-text.js';
import { FooterContext } from '../../shared/components/chrome/footer-context.js';
import { colors, spacing } from '../../shared/theme/theme.js';
import { routesFooterContext, UNAVAILABLE_FOOTER_INPUT } from './routes-zone.logic.js';

export function formatRoutesDisabledMessage(carryingServices: string[]): string {
  const list = carryingServices.join(', ');
  return `None of your active EDT's services carry routes. Repos with routes: ${list}.`;
}

export function RoutesDisabledView({ carryingServices }: { carryingServices: string[] }) {
  return (
    <Box flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden" backgroundColor={colors.surface} paddingX={spacing['pane-padding-x']}>
      <ClampedParagraph color={colors.text} maxLines={4}>{`${formatRoutesDisabledMessage(carryingServices)}`}</ClampedParagraph>
    </Box>
  );
}

// Shell of every non-ready state: the footer context, the ROUTES header and the state line(s).
export function RoutesNoticeView({
  filterEditing,
  paneFocused,
  useStore,
  children,
}: {
  filterEditing: boolean;
  paneFocused: boolean;
  useStore: AppStore;
  children: ReactNode;
}) {
  return (
    <Box flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden" backgroundColor={colors.surface} paddingX={spacing['pane-padding-x']}>
      <FooterContext owner="routes" id={routesFooterContext({ ...UNAVAILABLE_FOOTER_INPUT, filterEditing, paneFocused })} useStore={useStore} />
      <Text color={colors['text-dim']}>ROUTES</Text>
      {children}
    </Box>
  );
}
