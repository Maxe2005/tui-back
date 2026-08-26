// tui/zones/routes: story 2.13 layers a `disabled`-status explanatory message in front of
// the pre-existing ZonePlaceholder stub (idiom: edts-zone.tsx:71-84's labelled-lines
// message style) — the real Routes content itself is Epic 6's concern; this story only
// ever reaches `disabled` via injected port fixtures (module-registry.ts stays empty in
// real usage, so this zone is `omitted` — unreachable — today).
import { Box, Text } from 'ink';
import { useAppStore, type AppStore } from '../../store/app-store.js';
import { ZonePlaceholder } from '../../shared/components/index.js';
import { colors, spacing } from '../../shared/theme/theme.js';

export function formatRoutesDisabledMessage(carryingServices: string[]): string {
  const list = carryingServices.join(', ');
  return `None of your active EDT's services carry routes. Repos with routes: ${list}.`;
}

export function RoutesZone({ useStore = useAppStore }: { useStore?: AppStore }) {
  const status = useStore((state) => state.tabVisibility.routes.status);
  const carryingServices = useStore((state) => state.tabVisibility.routes.carryingServices);

  if (status === 'disabled') {
    return (
      <Box flexDirection="column" flexGrow={1} backgroundColor={colors.surface} paddingX={spacing['pane-padding-x']}>
        <Text color={colors.text}>{formatRoutesDisabledMessage(carryingServices)}</Text>
      </Box>
    );
  }

  return <ZonePlaceholder zoneId="routes" useStore={useStore} />;
}
