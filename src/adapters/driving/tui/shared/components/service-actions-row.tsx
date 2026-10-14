// tui/shared/components: ServiceActionsRow — one bounded line listing whatever actions the
// service-actions registry returns, each as `[key] label`; an unavailable action is greyed
// and carries its reason. Presentational only: adding a registry entry needs no change here.
import { Box, Text } from 'ink';
import type { ServiceAction } from '../../../../../core/service-actions/index.js';
import { normalizeMessage } from '../bounds/message.js';
import { colors } from '../theme/theme.js';

export function ServiceActionsRow({ actions }: { actions: readonly ServiceAction[] }) {
  return (
    <Box flexShrink={0} height={1} overflow="hidden">
      <Text wrap="truncate-end">
        {actions.map((action, index) => {
          const separator = index === 0 ? '' : '  ';
          if (action.availability.available) {
            return (
              <Text key={action.id}>
                {separator}
                <Text color={colors.accent}>{`[${normalizeMessage(action.key)}]`}</Text>
                {` ${normalizeMessage(action.label)}`}
              </Text>
            );
          }
          return (
            <Text key={action.id} color={colors['text-dim']}>
              {`${separator}[${normalizeMessage(action.key)}] ${normalizeMessage(action.label)} (${normalizeMessage(action.availability.reason)})`}
            </Text>
          );
        })}
      </Text>
    </Box>
  );
}
