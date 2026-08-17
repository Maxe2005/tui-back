import { Box, Text } from 'ink';
import { colors, spacing } from '../theme/theme.js';

export function TopBar({ activeEdt }: { activeEdt: string | null }) {
  return (
    <Box backgroundColor={colors.background} paddingLeft={spacing['1']}>
      <Text color={colors.text}>tui-back</Text>
      <Text color={colors['text-dim']}>
        {' '}
        {activeEdt ? activeEdt : 'no active EDT'}
      </Text>
      <Box flexGrow={1} />
      <Text color={colors['text-dim']}>[/] filter  [:] cmd</Text>
    </Box>
  );
}
