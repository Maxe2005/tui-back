import { Text } from 'ink';
import { colors } from '../theme/theme.js';

export type StatusBadgeState =
  | 'up'
  | 'down'
  | 'done'
  | 'failed'
  | 'in-progress'
  | 'selection'
  | 'action'
  // Story 3.6: the Update zone's own closed per-service status set
  // (up/down/restarting/updating/migrating/error — Design Notes). Each gets its own
  // glyph/color pairing rather than bridging through the generic 'in-progress' entry
  // (unlike Logs zone's healthBadgeState bridge), since the Update zone must distinguish
  // restarting/updating/migrating from one another at a glance.
  | 'restarting'
  | 'updating'
  | 'migrating'
  | 'error';

export const STATUS_BADGES = Object.freeze({
  up: { glyph: '●', color: colors.success },
  down: { glyph: '○', color: colors.error },
  done: { glyph: '✔', color: colors.success },
  failed: { glyph: '✖', color: colors.error },
  'in-progress': { glyph: '⣾', color: colors.info },
  selection: { glyph: '›', color: colors.accent },
  action: { glyph: '▸', color: colors.accent },
  // Story 3.6: distinct glyphs so a developer scanning the Update zone's service list can
  // tell restarting/updating/migrating apart without relying on color (which two of these
  // share, by design — see the header comment above).
  restarting: { glyph: '↻', color: colors.info },
  updating: { glyph: '⇄', color: colors.info },
  migrating: { glyph: '⇒', color: colors.info },
  // 'error' is deliberately the same glyph/color as 'failed' (both mean "this outcome was
  // a failure") — the two keys exist separately because they're driven by different
  // vocabularies (a generic action outcome vs. the Update zone's per-service status set),
  // not because they need to look different.
  error: { glyph: '✖', color: colors.error },
} as const);

export function StatusBadge({ state }: { state: StatusBadgeState }) {
  const { glyph, color } = STATUS_BADGES[state];
  return <Text color={color}>{glyph}</Text>;
}
