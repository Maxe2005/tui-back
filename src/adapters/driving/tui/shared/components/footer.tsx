import { Box, Text } from 'ink';
import { hasResizableBoundary } from '../../zones/zone-layouts.js';
import type { ZoneId } from '../../zones/zones.js';
import { focusNavFooterHint, type FocusNavDeclaration } from '../keys/focus-navigation.js';
import { PANE_FOCUS_NAV } from '../../zones/edts/edts-zone.logic.js';
import { LOGS_PANE_FOCUS_NAV } from '../../zones/logs/logs-zone.logic.js';
import { colors, spacing } from '../theme/theme.js';

export const DEFAULT_FOOTER_HINTS = [
  '[↑↓] move',
  '[Home/End] top/bottom',
  '[←→] zone',
  '[/] filter',
  '[:] cmd',
  '[?] help',
  '[q] quit',
  '^W resize',
];

// Zones whose Tab key cycles pane focus, keyed to the same declarations their handlers use.
// Routes has no zone-level declaration (its Tab cycles request sections inside one pane).
const ZONE_FOCUS_NAV: Partial<Record<ZoneId, FocusNavDeclaration<unknown>>> = {
  edts: PANE_FOCUS_NAV,
  logs: LOGS_PANE_FOCUS_NAV,
};

const RESIZE_HINT = '^W resize';

// The resize hint is advertised only for a zone declaring a boundary; Logs also advertises its
// wrap-all key, since Ctrl+W no longer is it.
export function footerHintsFor(zone?: ZoneId): string[] {
  const base = DEFAULT_FOOTER_HINTS.filter((hint) => hint !== RESIZE_HINT);
  if (zone === 'logs') {
    base.push('[W] wrap all');
  }
  if (zone === undefined || hasResizableBoundary(zone)) {
    base.push(RESIZE_HINT);
  }
  const focusNav = zone === undefined ? undefined : ZONE_FOCUS_NAV[zone];
  if (focusNav !== undefined) {
    base.push(focusNavFooterHint(focusNav.mode, 'focus'));
  }
  return base;
}

export function Footer({ hints, zone }: { hints?: string[]; zone?: ZoneId }) {
  const items = hints && hints.length > 0 ? hints : footerHintsFor(zone);
  return (
    <Box
      backgroundColor={colors.background}
      paddingLeft={spacing['1']}
    >
      <Text color={colors['text-dim']}>{items.join('  ')}</Text>
    </Box>
  );
}