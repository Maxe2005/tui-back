import { Box, Text } from 'ink';
import { hasResizableBoundary } from '../../zones/zone-layouts.js';
import type { ZoneId } from '../../zones/zones.js';
import { KEYBINDINGS, activeFooterContext, footerContextHints, type FooterContextId } from '../../keybindings/index.js';
import { useAppStore, type AppStore } from '../../store/app-store.js';
import { colors, spacing } from '../theme/theme.js';
import { formatHint } from './hints.js';

const footerEntries = KEYBINDINGS.flatMap((binding) => (binding.footer === undefined ? [] : [binding.footer]));

// The zone-independent hints. A resize hint is zone-conditional (see footerHintsFor) but listed
// here too, as the app-wide default before any zone is known.
export const DEFAULT_FOOTER_HINTS = footerEntries
  .filter((entry) => entry.zones === undefined)
  .map((entry) => formatHint([entry.key, entry.verb]));

// Generated from the keybinding declarations: the shared hints, those scoped to this zone, and
// the resize hint only for a zone declaring a splitter boundary.
export function footerHintsFor(zone?: ZoneId): string[] {
  return footerEntries
    .filter((entry) => {
      if (entry.zones !== undefined && (zone === undefined || !entry.zones.includes(zone))) {
        return false;
      }
      return entry.when !== 'resizable' || zone === undefined || hasResizableBoundary(zone);
    })
    .map((entry) => formatHint([entry.key, entry.verb]));
}

export function footerContextHintStrings(id: FooterContextId): string[] {
  return footerContextHints(id).map(formatHint);
}

export function Footer({ hints, zone, useStore = useAppStore }: { hints?: string[]; zone?: ZoneId; useStore?: AppStore }) {
  const context = useStore((state) => activeFooterContext(state.footerContexts));
  const items = hints && hints.length > 0 ? hints : context !== undefined ? footerContextHintStrings(context) : footerHintsFor(zone);
  return (
    <Box
      backgroundColor={colors.background}
      paddingLeft={spacing['1']}
    >
      <Text color={colors['text-dim']}>{items.join('  ')}</Text>
    </Box>
  );
}
