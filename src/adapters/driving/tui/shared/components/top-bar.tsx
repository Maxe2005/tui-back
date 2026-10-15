import { Box, Text } from 'ink';
import type { EdtRegistryEntry } from '../../../../../core/ports/edt-registry.js';
import { normalizeMessage } from '../bounds/message.js';
import { colors, spacing } from '../theme/theme.js';
import { formatHints } from './hints.js';

export function TopBar({
  activeEdt,
  edts,
}: {
  activeEdt: string | null;
  edts: EdtRegistryEntry[] | null;
}) {
  const topic = edts?.find((edt) => edt.ulid === activeEdt)?.topic ?? null;
  return (
    <Box backgroundColor={colors.background} paddingLeft={spacing['1']} flexShrink={0}>
      <Box flexShrink={0}>
        <Text color={colors.text} bold>
          tui-back
        </Text>
      </Box>
      {topic ? (
        <Text wrap="truncate-end">
          <Text color={colors['text-dim']}>{'  EDT · '}</Text>
          <Text color={colors.text} bold>
            {normalizeMessage(topic, 60)}
          </Text>
        </Text>
      ) : (
        <Text color={colors['text-dim']} wrap="truncate-end">
          {'  no active EDT'}
        </Text>
      )}
      <Box flexGrow={1} flexShrink={0} />
      <Box flexShrink={0}>
        <Text color={colors['text-dim']}>{formatHints([[':', 'cmd']])}</Text>
      </Box>
    </Box>
  );
}
