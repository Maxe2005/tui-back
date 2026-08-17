import { Box, Text } from 'ink';
import type { AppStore } from '../../store/app-store.js';
import { useAppStore } from '../../store/app-store.js';
import { ZONES, type ZoneId } from '../../zones/zones.js';
import { colors, spacing } from '../theme/theme.js';
import { DetailPane } from './detail-pane.js';
import { ListDetailSplit } from './list-detail-split.js';
import { ListRow } from './list-row.js';

export type ZonePlaceholderProps = {
  zoneId: ZoneId;
  useStore?: AppStore;
};

export function ZonePlaceholder({
  zoneId,
  useStore = useAppStore,
}: ZonePlaceholderProps) {
  const zone = ZONES.find((candidate) => candidate.id === zoneId);
  const ratio = useStore((state) => state.splitterRatios[zoneId]);
  if (!zone) {
    return null;
  }
  return (
    <Box flexDirection="column" flexGrow={1} backgroundColor={colors.surface}>
      <ListDetailSplit
        ratio={ratio}
        list={
          <Box
            flexDirection="column"
            paddingX={spacing['pane-padding-x']}
          >
            <Text color={colors['text-dim']}>
              {zone.label.toUpperCase()}
            </Text>
            <ListRow label="list pane" selected />
            <ListRow label="placeholder rows" meta="populated in a later story" />
          </Box>
        }
        detail={
          <Box
            flexDirection="column"
            paddingX={spacing['pane-padding-x']}
          >
            <DetailPane title={zone.label}>
              detail pane — {zone.label} content mounts here once its
              capability lands
            </DetailPane>
          </Box>
        }
      />
    </Box>
  );
}
