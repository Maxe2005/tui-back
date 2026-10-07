import { Box, Text } from 'ink';
import { hasResizableBoundary } from '../../zones/zone-layouts.js';
import type { ZoneId } from '../../zones/zones.js';
import { focusNavFooterHint, type FocusNavDeclaration } from '../keys/focus-navigation.js';
import { PANE_FOCUS_NAV } from '../../zones/edts/edts-zone.logic.js';
import { LOGS_PANE_FOCUS_NAV } from '../../zones/logs/logs-zone.logic.js';
import { KEYBINDINGS } from '../../keybindings/index.js';
import { colors, spacing } from '../theme/theme.js';
import { formatHint } from './hints.js';

const footerEntries = KEYBINDINGS.flatMap((binding) => (binding.footer === undefined ? [] : [binding.footer]));

export const DEFAULT_FOOTER_HINTS = footerEntries
  .filter((entry) => entry.zone === undefined)
  .map((entry) => formatHint([entry.key, entry.verb]));

// Zones whose Tab key cycles pane focus, keyed to the same declarations their handlers use.
// Routes has no zone-level declaration (its Tab cycles request sections inside one pane).
const ZONE_FOCUS_NAV: Partial<Record<ZoneId, FocusNavDeclaration<unknown>>> = {
  edts: PANE_FOCUS_NAV,
  logs: LOGS_PANE_FOCUS_NAV,
};

const RESIZE_HINT = '[Ctrl+W] resize';

// The resize hint is advertised only for a zone declaring a boundary; Logs also advertises its
// wrap-all key, since Ctrl+W no longer is it.
export function footerHintsFor(zone?: ZoneId): string[] {
  const base = DEFAULT_FOOTER_HINTS.filter((hint) => hint !== RESIZE_HINT);
  for (const entry of footerEntries) {
    if (entry.zone !== undefined && entry.zone === zone) {
      base.push(formatHint([entry.key, entry.verb]));
    }
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