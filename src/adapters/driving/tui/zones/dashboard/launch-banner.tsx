import { Box, Text } from 'ink';
import { colors, spacing } from '../../shared/theme/theme.js';

export const BANNER_LINES = [
  '▀█▀ █░█ █    █▄▄ ▄▀█ █▀▀ █▄▀',
  '░█░ █▄█ █ ▄▄ █▄█ █▀█ █▄▄ █░█',
];

export function LaunchBanner() {
  return (
    <Box
      flexDirection="column"
      paddingX={spacing['pane-padding-x']}
      backgroundColor={colors.surface}
    >
      {BANNER_LINES.map((line) => (
        <Text key={line} color={colors['text-dim']} wrap="truncate-end">
          {line}
        </Text>
      ))}
    </Box>
  );
}
