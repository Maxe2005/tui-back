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
  // The Update zone's own closed per-service status set (up/down/restarting/updating/
  // migrating/error). Each gets its own glyph/color pairing rather than bridging through the
  // generic 'in-progress' entry (unlike the Logs zone's healthBadgeState bridge), since the
  // Update zone must tell restarting/updating/migrating apart at a glance.
  | 'restarting'
  | 'updating'
  | 'migrating'
  | 'error'
  // A managed service with no Docker runtime (manifest omits `container`) — dim by design,
  // never the down/error treatment.
  | 'no-container';

export const STATUS_BADGES = Object.freeze({
  up: { glyph: '●', color: colors.success },
  down: { glyph: '○', color: colors.error },
  done: { glyph: '✔', color: colors.success },
  failed: { glyph: '✖', color: colors.error },
  'in-progress': { glyph: '⣾', color: colors.info },
  selection: { glyph: '›', color: colors.accent },
  action: { glyph: '▸', color: colors.accent },
  // Distinct glyphs so a developer scanning the Update zone's service list can
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
  // Hollow like down but dimmed rather than red — "no runtime" is not "runtime down".
  'no-container': { glyph: '○', color: colors['text-dim'] },
} as const);

export function StatusBadge({ state }: { state: StatusBadgeState }) {
  const { glyph, color } = STATUS_BADGES[state];
  return <Text color={color}>{glyph}</Text>;
}
