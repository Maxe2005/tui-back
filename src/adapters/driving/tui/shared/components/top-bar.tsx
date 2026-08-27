import { Box, Text } from 'ink';
import type { EdtRegistryEntry } from '../../../../../core/ports/edt-registry.js';
import { colors, spacing } from '../theme/theme.js';

export function TopBar({
  activeEdt,
  edts,
}: {
  activeEdt: string | null;
  edts: EdtRegistryEntry[] | null;
}) {
  const topic = edts?.find((edt) => edt.ulid === activeEdt)?.topic ?? null;
  return (
    <Box backgroundColor={colors.background} paddingLeft={spacing['1']}>
      <Text color={colors.text}>tui-back</Text>
      <Text color={colors['text-dim']}>
        {' '}
        {topic ? topic : 'no active EDT'}
      </Text>
      <Box flexGrow={1} />
      <Text color={colors['text-dim']}>[/] filter  [:] cmd</Text>
    </Box>
  );
}
