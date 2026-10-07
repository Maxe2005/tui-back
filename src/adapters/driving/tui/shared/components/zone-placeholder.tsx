import { Box, Text } from 'ink';
import type { AppStore } from '../../store/app-store.js';
import { useAppStore } from '../../store/app-store.js';
import { ZONES, type ZoneId } from '../../zones/zones.js';
import { colors, spacing } from '../theme/theme.js';
import { DetailPane } from './detail-pane.js';
import { ListRow } from './list-row.js';
import { ZoneLayout } from './zone-layout.js';

export type ZonePlaceholderProps = {
  zoneId: ZoneId;
  useStore?: AppStore;
};

export function ZonePlaceholder({
  zoneId,
  useStore = useAppStore,
}: ZonePlaceholderProps) {
  const zone = ZONES.find((candidate) => candidate.id === zoneId);
  if (!zone) {
    return null;
  }
  return (
    <Box flexDirection="column" flexGrow={1} backgroundColor={colors.surface}>
      <ZoneLayout
        zoneId={zoneId}
        useStore={useStore}
        first={
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
        second={
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
