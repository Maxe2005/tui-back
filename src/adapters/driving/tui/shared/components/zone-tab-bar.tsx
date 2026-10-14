import { Box, Text } from 'ink';
import {
  DEFAULT_TAB_VISIBILITY,
  type GatedTabStatus,
  type ResolveTabVisibilityData,
} from '../../../../../core/edt/resolve-tab-visibility.js';
import { ZONES, zoneGatedStatus, type Zone, type ZoneId } from '../../zones/zones.js';
import { useBounds } from '../bounds/bounds-context.js';
import { colors, spacing, typography } from '../theme/theme.js';

// Re-exported for callers that don't care about manifest-gating — every zone renders
// 'enabled'. The single source of truth lives in resolve-tab-visibility.ts.
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
  busy = false,
  pendingIncidents = 0,
): ZoneTabState {
  const active = zone.id === activeZone;
  const disabled = status === 'disabled';
  return {
    active,
    // Disabled renders text-dim + strikethrough, never accent — even while active (a disabled
    // tab can be the active zone once reached; it never gets the accent-fill treatment).
    labelColor: disabled ? colors['text-dim'] : active ? colors.background : colors['text-dim'],
    backgroundColor: disabled ? colors.background : active ? colors.accent : colors.background,
    bold: disabled
      ? typography['disabled-tab'].bold
      : active
        ? typography['active-tab'].bold
        : typography.label.bold,
    strikethrough: disabled ? typography['disabled-tab'].strikethrough : false,
    // Never a badge on a disabled tab, regardless of pending events. A busy tab (a group update
    // is running) carries its status badge even while active, so the whole tool shows the run.
    badge:
      busy && !disabled
        ? pendingIncidents > 0
          ? { text: `◐ ${pendingIncidents} awaiting you`, color: active ? colors.background : colors.warning }
          : { text: '⇄ updating', color: active ? colors.background : colors.info }
        : !active && !disabled && eventCount > 0
          ? { text: `●${eventCount}`, color: colors[zone.statusColor] }
          : null,
  };
}

export function ZoneTabBar({
  activeZone,
  events,
  tabVisibility = DEFAULT_TAB_VISIBILITY,
  busy = {},
}: {
  activeZone: ZoneId;
  events: Record<ZoneId, number>;
  tabVisibility?: ResolveTabVisibilityData;
  // Zones with a run in flight (or blocked awaiting the developer) show their status badge from
  // any zone; `incidents` > 0 turns it into `N awaiting you`.
  busy?: Partial<Record<ZoneId, { incidents: number }>>;
}) {
  const { columns } = useBounds();
  const tabs = ZONES.map((zone) => ({ zone, status: zoneGatedStatus(zone.id, tabVisibility) })).filter(
    ({ status }) => status !== 'omitted',
  );
  // Full labels when they fit; otherwise only the active tab keeps its label, the rest shrink
  // to their `[mnemonic]`.
  const fullWidth = tabs.reduce((sum, { zone, status }) => {
    const badge = resolveZoneTabState(zone, activeZone, events[zone.id], status, busy[zone.id] !== undefined, busy[zone.id]?.incidents ?? 0).badge;
    return sum + 2 + `[${zone.mnemonic}] ${zone.label}`.length + (badge ? badge.text.length + 1 : 0);
  }, 0);
  const compact = fullWidth > columns;
  return (
    <Box backgroundColor={colors.background} flexShrink={0} height={1} overflow="hidden">
      {tabs.map(({ zone, status }) => {
          const state = resolveZoneTabState(zone, activeZone, events[zone.id], status, busy[zone.id] !== undefined, busy[zone.id]?.incidents ?? 0);
          const collapsed = compact && !state.active;
          return (
            <Box
              key={zone.id}
              paddingX={collapsed ? 0 : spacing['1']}
              marginRight={collapsed ? 1 : 0}
              flexShrink={0}
              backgroundColor={state.backgroundColor}
            >
              <Text bold={state.bold} strikethrough={state.strikethrough} color={state.labelColor} wrap="truncate-end">
                {collapsed ? `[${zone.mnemonic}]` : `[${zone.mnemonic}] ${zone.label}`}
              </Text>
              {state.badge ? (
                <Text color={state.badge.color}>{collapsed ? Array.from(state.badge.text)[0] : ` ${state.badge.text}`}</Text>
              ) : null}
            </Box>
          );
      })}
    </Box>
  );
}
