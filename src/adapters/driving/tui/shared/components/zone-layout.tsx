// A two-pane split driven by a zone's declared boundary: reads the boundary's ratio from the
// store, recolors its Splitter while Ctrl+W resize-mode targets it. Nest for multi-boundary zones.
import { Box } from 'ink';
import type { ReactNode } from 'react';
import { useAppStore, type AppStore } from '../../store/app-store.js';
import { ZONE_LAYOUTS, resolveBoundaryFlex } from '../../zones/zone-layouts.js';
import type { ZoneId } from '../../zones/zones.js';
import { BoundsProvider, useBounds } from '../bounds/bounds-context.js';
import { MIN_PANE_COLUMNS, MIN_PANE_ROWS, resolvePaneSplit } from '../bounds/bounds.js';
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
  const bounds = useBounds();
  if (spec === undefined) {
    return (
      <>
        {first}
        {second}
      </>
    );
  }
  const vertical = spec.orientation === 'vertical';
  const ratioFlex = resolveBoundaryFlex(zoneId, boundary, ratio ?? spec.defaultRatio);
  // Absolute minimums win over the ratio only when the ratio would leave a pane a sliver.
  const split = resolvePaneSplit(vertical ? bounds.columns : bounds.rows, ratioFlex.first, vertical ? MIN_PANE_COLUMNS : MIN_PANE_ROWS);
  const flex = split.adjustedRatio === null ? ratioFlex : { first: split.adjustedRatio, second: 1 - split.adjustedRatio };
  const firstBounds = vertical ? { columns: split.first, rows: bounds.rows } : { columns: bounds.columns, rows: split.first };
  const secondBounds = vertical ? { columns: split.second, rows: bounds.rows } : { columns: bounds.columns, rows: split.second };
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
        <BoundsProvider {...firstBounds}>{first}</BoundsProvider>
      </Box>
      <Splitter orientation={spec.orientation} size={1} targeted={targeted} />
      <Box flexGrow={flex.second} {...paneProps}>
        <BoundsProvider {...secondBounds}>{second}</BoundsProvider>
      </Box>
    </Box>
  );
}
