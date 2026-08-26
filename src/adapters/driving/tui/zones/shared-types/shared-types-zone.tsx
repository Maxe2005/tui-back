// tui/zones/shared-types: story 2.13 layers a `disabled`-status explanatory message in
// front of the pre-existing ZonePlaceholder stub (idiom: edts-zone.tsx:71-84's
// labelled-lines message style) — the real shared-types content itself is Epic 4's
// concern; this story only ever reaches `disabled` via injected port fixtures
// (module-registry.ts stays empty in real usage, so this zone is `omitted` — unreachable —
// today).
import { Box, Text } from 'ink';
import { SHARED_TYPES_MODULE_IDS } from '../../../../../core/edt/resolve-tab-visibility.js';
import { useAppStore, type AppStore } from '../../store/app-store.js';
import { ZonePlaceholder } from '../../shared/components/index.js';
import { colors, spacing } from '../../shared/theme/theme.js';

// The spec's own example ("which imports the `shared-types-source` module") names the
// source id specifically — the singular-carrier phrasing follows that lead; the plural
// phrasing (module identity ambiguous across multiple carriers) names both ids generically
// instead.
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
        <Text color={colors.text}>{formatSharedTypesDisabledMessage(carryingServices)}</Text>
      </Box>
    );
  }

  return <ZonePlaceholder zoneId="shared-types" useStore={useStore} />;
}
