import { Text } from 'ink';
import { colors } from '../theme/theme.js';

export type SpinnerProps = {
  /** Current progress state; cycles through glyphs while true, stops when false */
  active?: boolean;
  intervalMs?: number;
};

const SPINNER_GLYPHS = ['⣾', '⣽', '⣻', '⣽', '⣾', '⢹', '⢸', '⢶', '⢴', '⢲', '⢱', '⢳'];

export function Spinner(props: SpinnerProps) {
  const { active = true, intervalMs = 100 } = props;
  if (!active) return null;

  let frame = 0;
  const glyph = SPINNER_GLYPHS[frame];

  return <Text color={colors.info}>{glyph}</Text>;
}