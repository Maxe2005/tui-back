// tui/zones/shared-types: a `disabled`-status explanatory message in front of the
// ZonePlaceholder stub — the real shared-types content does not exist yet, so in practice the
// zone is `omitted` and unreachable.
import { Box, Text } from 'ink';
import { SHARED_TYPES_MODULE_IDS } from '../../../../../core/edt/resolve-tab-visibility.js';
import { useAppStore, type AppStore } from '../../store/app-store.js';
import { ZonePlaceholder } from '../../shared/components/index.js';
import { colors, spacing } from '../../shared/theme/theme.js';

// The singular-carrier phrasing names the source id specifically; the plural phrasing (module
// identity ambiguous across several carriers) names both ids generically instead.
const [SOURCE_MODULE_ID] = SHARED_TYPES_MODULE_IDS;

export function formatSharedTypesDisabledMessage(carryingServices: string[]): string {
  const list = carryingServices.join(', ');
  if (carryingServices.length === 1) {
    return `The repo ${list} (which imports the ${SOURCE_MODULE_ID} module) is not part of your active EDT.`;
  }
  return `None of the following repos (which import ${SHARED_TYPES_MODULE_IDS.join(' or ')}) are part of your active EDT: ${list}.`;
}

export function SharedTypesZone({ useStore = useAppStore }: { useStore?: AppStore }) {
  const status = useStore((state) => state.tabVisibility.sharedTypes.status);
  const carryingServices = useStore((state) => state.tabVisibility.sharedTypes.carryingServices);

  if (status === 'disabled') {
    return (
      <Box flexDirection="column" flexGrow={1} backgroundColor={colors.surface} paddingX={spacing['pane-padding-x']}>
        <Text color={colors.text} wrap="truncate-end">{formatSharedTypesDisabledMessage(carryingServices)}</Text>
      </Box>
    );
  }

  return <ZonePlaceholder zoneId="shared-types" useStore={useStore} />;
}
