// tui/shared/components: ServiceActionsRow — the actions the service-actions registry returns,
// each as `[key] label`; an unavailable action is greyed and carries its reason. The actions wrap
// onto further lines at action boundaries (an action is never split across two lines), up to
// `maxLines`; a single action wider than the line is cut with an ellipsis. Presentational only:
// adding a registry entry needs no change here.
import { Box, Text } from 'ink';
import type { ServiceAction } from '../../../../../core/service-actions/index.js';
import { normalizeMessage } from '../bounds/message.js';
import { colors } from '../theme/theme.js';

export const SERVICE_ACTIONS_MAX_LINES = 3;
const ACTION_GAP = 2;

export function ServiceActionsRow({ actions, maxLines = SERVICE_ACTIONS_MAX_LINES }: { actions: readonly ServiceAction[]; maxLines?: number }) {
  return (
    <Box flexShrink={0} flexWrap="wrap" columnGap={ACTION_GAP} maxHeight={Math.max(1, maxLines)} overflow="hidden">
      {actions.map((action) => {
        const head = `[${normalizeMessage(action.key)}]`;
        const label = normalizeMessage(action.label);
        if (action.availability.available) {
          return (
            <Box key={action.id} flexShrink={1} minWidth={0}>
              <Text wrap="truncate-end">
                <Text color={colors.accent}>{head}</Text>
                {` ${label}`}
              </Text>
            </Box>
          );
        }
        const reason = normalizeMessage(action.availability.reason);
        return (
          <Box key={action.id} flexShrink={1} minWidth={0}>
            <Text wrap="truncate-end" color={colors['text-dim']}>
              {`${head} ${label}${reason === '' ? '' : ` (${reason})`}`}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
