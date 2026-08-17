import { Box, Text } from 'ink';
import { colors, spacing } from '../theme/theme.js';

export const DEFAULT_FOOTER_HINTS = [
  '[j/k] move',
  '[enter] open',
  '[space] select',
  '[d] dashboard',
  '[q] quit',
  '^W resize',
];

export function Footer({ hints }: { hints?: string[] }) {
  const items = hints && hints.length > 0 ? hints : DEFAULT_FOOTER_HINTS;
  return (
    <Box
      backgroundColor={colors.background}
      paddingLeft={spacing['1']}
    >
      <Text color={colors['text-dim']}>{items.join('  ')}</Text>
    </Box>
  );
}
