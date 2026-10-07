import { Box, Text } from 'ink';
import { hasResizableBoundary } from '../../zones/zone-layouts.js';
import type { ZoneId } from '../../zones/zones.js';
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