import { Box, Text } from 'ink';
import {
  DEFAULT_TAB_VISIBILITY,
  type GatedTabStatus,
  type ResolveTabVisibilityData,
} from '../../../../../core/edt/resolve-tab-visibility.js';
import { ZONES, zoneGatedStatus, type Zone, type ZoneId } from '../../zones/zones.js';
import { colors, spacing, typography } from '../theme/theme.js';

// Re-exported for callers that don't (yet) care about manifest-gating — every zone renders
// 'enabled', matching this component's pre-story-2.13 behavior exactly. Single source of
// truth lives in resolve-tab-visibility.ts (also used by app-store.ts's pre-load default).
export { DEFAULT_TAB_VISIBILITY };

export type ZoneTabState = {
  active: boolean;
  labelColor: string;
  backgroundColor: string;
  bold: boolean;
  strikethrough: boolean;
  badge: { text: string; color: string } | null;
};

export function resolveZoneTabState(
  zone: Zone,
  activeZone: ZoneId,
  eventCount: number,
  status: GatedTabStatus = 'enabled',
): ZoneTabState {
  const active = zone.id === activeZone;
  const disabled = status === 'disabled';
  return {
    active,
    // Boundaries: disabled renders text-dim + strikethrough, never accent — even while
    // active (a disabled tab can be the active zone once reached; it never gets the
    // accent-fill treatment an enabled active tab does).
    labelColor: disabled ? colors['text-dim'] : active ? colors.background : colors['text-dim'],
    backgroundColor: disabled ? colors.background : active ? colors.accent : colors.background,
    bold: disabled
      ? typography['disabled-tab'].bold
      : active
        ? typography['active-tab'].bold
        : typography.label.bold,
    strikethrough: disabled ? typography['disabled-tab'].strikethrough : false,
    // Boundaries: never a badge on a disabled tab, regardless of pending events.
    badge:
      !active && !disabled && eventCount > 0
        ? { text: `●${eventCount}`, color: colors[zone.statusColor] }
        : null,
  };
}

export function ZoneTabBar({
  activeZone,
  events,
  tabVisibility = DEFAULT_TAB_VISIBILITY,
}: {
  activeZone: ZoneId;
  events: Record<ZoneId, number>;
  tabVisibility?: ResolveTabVisibilityData;
}) {
  return (
    <Box backgroundColor={colors.background}>
      {ZONES.map((zone) => ({ zone, status: zoneGatedStatus(zone.id, tabVisibility) }))
        .filter(({ status }) => status !== 'omitted')
        .map(({ zone, status }) => {
          const state = resolveZoneTabState(zone, activeZone, events[zone.id], status);
          return (
            <Box
              key={zone.id}
              paddingX={spacing['1']}
              backgroundColor={state.backgroundColor}
            >
              <Text bold={state.bold} strikethrough={state.strikethrough} color={state.labelColor}>
                [{zone.mnemonic}] {zone.label}
              </Text>
              {state.badge ? (
                <Text color={state.badge.color}> {state.badge.text}</Text>
              ) : null}
            </Box>
          );
        })}
    </Box>
  );
}
