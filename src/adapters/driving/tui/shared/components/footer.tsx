import { Box, Text } from 'ink';
import wrapAnsi from 'wrap-ansi';
import { hasResizableBoundary } from '../../zones/zone-layouts.js';
import type { ZoneId } from '../../zones/zones.js';
import { KEYBINDINGS, activeFooterContext, footerContextHints, type FooterContextId } from '../../keybindings/index.js';
import { useAppStore, type AppStore } from '../../store/app-store.js';
import { colors, spacing } from '../theme/theme.js';
import { formatHint } from './hints.js';

// The hint list wraps on a narrow terminal; past this many rows the rest is clipped.
export const FOOTER_MAX_ROWS = 3;

const footerEntries = KEYBINDINGS.flatMap((binding) => (binding.footer === undefined ? [] : [binding.footer]));

// The zone-independent hints. A resize hint is zone-conditional (see footerHintsFor) but listed
// here too, as the app-wide default before any zone is known.
export const DEFAULT_FOOTER_HINTS = footerEntries
  .filter((entry) => entry.zones === undefined)
  .map((entry) => formatHint([entry.key, entry.verb]));

// Generated from the keybinding declarations: the shared hints, those scoped to this zone, and
// the resize hint only for a zone declaring a splitter boundary.
export function footerHintsFor(zone?: ZoneId, { serviceFocused = true, activeEdt = true }: { serviceFocused?: boolean; activeEdt?: boolean } = {}): string[] {
  return footerEntries
    .filter((entry) => {
      if (entry.zones !== undefined && (zone === undefined || !entry.zones.includes(zone))) {
        return false;
      }
      if (entry.when === 'service-focused') {
        return serviceFocused;
      }
      if (entry.when === 'active-edt') {
        return activeEdt;
      }
      return entry.when !== 'resizable' || zone === undefined || hasResizableBoundary(zone);
    })
    .map((entry) => formatHint([entry.key, entry.verb]));
}

export function footerContextHintStrings(id: FooterContextId): string[] {
  return footerContextHints(id).map(formatHint);
}

// The hints currently shown: explicit ones, else the active footer context's, else the zone's.
export function useFooterItems(zone: ZoneId | undefined, useStore: AppStore, hints?: string[]): string[] {
  const context = useStore((state) => activeFooterContext(state.footerContexts));
  // The Dashboard's per-service keys only apply while a service row is focused.
  const serviceFocused = useStore((state) => state.dashboardServicesStatus === 'ready' && (state.dashboardServices?.services.length ?? 0) > 0);
  const activeEdt = useStore((state) => state.dashboardServicesStatus === 'ready' && state.dashboardServices?.status === 'active' && state.dashboardServices.edt !== null);
  return hints && hints.length > 0 ? hints : context !== undefined ? footerContextHintStrings(context) : footerHintsFor(zone, { serviceFocused, activeEdt });
}

// Rows the footer takes at `columns`: its wrapped hint lines (1 column of left padding), capped.
export function footerRowsFor(items: readonly string[], columns: number): number {
  const width = Math.max(1, columns - 1);
  const lines = wrapAnsi(items.join('  '), width, { trim: false, hard: true }).split('\n').length;
  return Math.min(FOOTER_MAX_ROWS, Math.max(1, lines));
}

export function Footer({ hints, zone, useStore = useAppStore }: { hints?: string[]; zone?: ZoneId; useStore?: AppStore }) {
  const items = useFooterItems(zone, useStore, hints);
  return (
    <Box
      backgroundColor={colors.background}
      paddingLeft={spacing['1']}
      flexShrink={0}
      maxHeight={FOOTER_MAX_ROWS}
      overflow="hidden"
    >
      <Text color={colors['text-dim']}>{items.join('  ')}</Text>
    </Box>
  );
}
