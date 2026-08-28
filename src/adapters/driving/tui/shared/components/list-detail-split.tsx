import { Box } from 'ink';
import type { ReactNode } from 'react';
import { Splitter } from './splitter.js';

export const DEFAULT_LIST_RATIO = 2 / 5;
export const MIN_LIST_RATIO = 0.2;
export const MAX_LIST_RATIO = 0.8;

export function clampListRatio(ratio: number): number {
  const safe = Number.isFinite(ratio) ? ratio : DEFAULT_LIST_RATIO;
  return Math.min(MAX_LIST_RATIO, Math.max(MIN_LIST_RATIO, safe));
}

export function resolveSplitFlex(ratio: number): {
  list: number;
  detail: number;
} {
  const clamped = clampListRatio(ratio);
  return { list: clamped, detail: 1 - clamped };
}

export function ListDetailSplit({
  ratio,
  list,
  detail,
  // Story 2.21: recolors this list<->detail split's own Splitter to accent when it's the
  // Ctrl+W resize-mode's current target — boundary 0 in every zone that has one (Design
  // Notes). Defaults to false so the 5 non-EDTs zones (zone-placeholder.tsx, which never
  // passes this prop) are unaffected.
  listSplitterTargeted = false,
}: {
  ratio: number;
  list: ReactNode;
  detail: ReactNode;
  listSplitterTargeted?: boolean;
}) {
  const flex = resolveSplitFlex(ratio);
  return (
    <Box flexDirection="row" flexGrow={1} minHeight={0} overflow="hidden">
      {/* Bugfix (story 2.21 follow-up #2): same Yoga "a flex item's minimum size is its own
          content size" trap the internal EDTS/EDT-SERVICES/OTHER-SERVICES sub-splits were
          fixed against (edts-zone.tsx) — but never applied here, at the list<->detail split
          every zone actually renders through. Without `flexBasis={0}`/`minWidth={0}`/
          `overflow="hidden"`, a long unbroken run of content in either pane (a long branch
          name, a wide action-log line) refuses to shrink to its ratio share and blows straight
          through the splitter into the other pane's space — confirmed with a standalone repro
          (an 80-col container, ratio 0.4, a 200-char word in `list`: the detail pane's own
          short text got squeezed to ~4 visible columns, overlapping the overflowing list text)
          before landing this fix. */}
      <Box flexGrow={flex.list} flexBasis={0} minWidth={0} minHeight={0} overflow="hidden">
        {list}
      </Box>
      <Splitter orientation="vertical" size={1} targeted={listSplitterTargeted} />
      <Box flexGrow={flex.detail} flexBasis={0} minWidth={0} minHeight={0} overflow="hidden">
        {detail}
      </Box>
    </Box>
  );
}
