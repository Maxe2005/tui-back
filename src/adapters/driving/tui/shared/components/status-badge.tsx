import { Text } from 'ink';
import { colors } from '../theme/theme.js';

export type StatusBadgeState =
  | 'up'
  | 'down'
  | 'done'
  | 'failed'
  | 'in-progress'
  | 'selection'
  | 'action';

export const STATUS_BADGES = {
  up: { glyph: '●', color: colors.success },
  down: { glyph: '○', color: colors.error },
  done: { glyph: '✔', color: colors.success },
  failed: { glyph: '✖', color: colors.error },
  'in-progress': { glyph: '⣾', color: colors.info },
  selection: { glyph: '›', color: colors.accent },
  action: { glyph: '▸', color: colors.accent },
} as const;

export function StatusBadge({ state }: { state: StatusBadgeState }) {
  const { glyph, color } = STATUS_BADGES[state];
  return <Text color={color}>{glyph}</Text>;
}
