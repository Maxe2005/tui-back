import { Box, Text } from 'ink';
import { ZONES, type Zone, type ZoneId } from '../../zones/zones.js';
import { colors, spacing, typography } from '../theme/theme.js';

export type ZoneTabState = {
  active: boolean;
  labelColor: string;
  backgroundColor: string;
  bold: boolean;
  badge: { text: string; color: string } | null;
};

export function resolveZoneTabState(
  zone: Zone,
  activeZone: ZoneId,
  eventCount: number,
): ZoneTabState {
  const active = zone.id === activeZone;
  return {
    active,
    labelColor: active ? colors.background : colors['text-dim'],
    backgroundColor: active ? colors.accent : colors.background,
    bold: active ? typography['active-tab'].bold : typography.label.bold,
    badge:
      !active && eventCount > 0
        ? { text: `●${eventCount}`, color: colors[zone.statusColor] }
        : null,
  };
}

export function ZoneTabBar({
  activeZone,
  events,
}: {
  activeZone: ZoneId;
  events: Record<ZoneId, number>;
}) {
  return (
    <Box backgroundColor={colors.background}>
      {ZONES.map((zone) => {
        const state = resolveZoneTabState(zone, activeZone, events[zone.id]);
        return (
          <Box
            key={zone.id}
            paddingX={spacing['1']}
            backgroundColor={state.backgroundColor}
          >
            <Text bold={state.bold} color={state.labelColor}>
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
