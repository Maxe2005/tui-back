import { Box, Text } from 'ink';
import { useAppStore } from '../../store/app-store.js';
import { ZONES, type ZoneId } from '../../zones/zones.js';
import { colors, spacing } from '../theme/theme.js';
import { DetailPane } from './detail-pane.js';
import { ListDetailSplit } from './list-detail-split.js';
import { ListRow } from './list-row.js';

export type ZonePlaceholderProps = {
  zoneId: ZoneId;
};

export function ZonePlaceholder({ zoneId }: ZonePlaceholderProps) {
  const zone = ZONES.find((candidate) => candidate.id === zoneId);
  const ratio = useAppStore((state) => state.splitterRatios[zoneId]);
  const setRatio = useAppStore((state) => state.setSplitterRatio);
  if (!zone) {
    return null;
  }
  return (
    <Box flexDirection="column" flexGrow={1} backgroundColor={colors.surface}>
      <ListDetailSplit
        ratio={ratio}
        onResize={(next) => setRatio(zoneId, next)}
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