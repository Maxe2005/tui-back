// A two-pane split driven by a zone's declared boundary: reads the boundary's ratio from the
// store, recolors its Splitter while Ctrl+W resize-mode targets it. Nest for multi-boundary zones.
import { Box } from 'ink';
import type { ReactNode } from 'react';
import { useAppStore, type AppStore } from '../../store/app-store.js';
import { ZONE_LAYOUTS, resolveBoundaryFlex } from '../../zones/zone-layouts.js';
import type { ZoneId } from '../../zones/zones.js';
import { Splitter } from './splitter.js';

export type ZoneLayoutProps = {
  zoneId: ZoneId;
  boundary?: number;
  first: ReactNode;
  second: ReactNode;
  useStore?: AppStore;
};

export function ZoneLayout({ zoneId, boundary = 0, first, second, useStore = useAppStore }: ZoneLayoutProps) {
  const ratio = useStore((state) => state.splitterRatios[zoneId][boundary]);
  const targeted = useStore(
    (state) => state.resizeMode?.zone === zoneId && state.resizeMode.targetBoundary === boundary,
  );
  const spec = ZONE_LAYOUTS[zoneId].boundaries[boundary];
  if (spec === undefined) {
    return <>{first}</>;
  }
  const flex = resolveBoundaryFlex(zoneId, boundary, ratio ?? spec.defaultRatio);
  const vertical = spec.orientation === 'vertical';
  // Yoga's default makes a flex item's minimum size its own content size: without
  // `flexBasis={0}`/`minWidth={0}`/`minHeight={0}`/`overflow="hidden"`, a long unbroken run of
  // content in either pane refuses to shrink to its ratio share and blows through the splitter.
  const paneProps = {
    flexBasis: 0,
    minWidth: 0,
    minHeight: 0,
    overflow: 'hidden' as const,
    ...(vertical ? {} : { flexDirection: 'column' as const }),
  };
  return (
    <Box flexDirection={vertical ? 'row' : 'column'} flexGrow={1} minHeight={0} overflow="hidden">
      <Box flexGrow={flex.first} {...paneProps}>
        {first}
      </Box>
      <Splitter orientation={spec.orientation} size={1} targeted={targeted} />
      <Box flexGrow={flex.second} {...paneProps}>
        {second}
      </Box>
    </Box>
  );
}
