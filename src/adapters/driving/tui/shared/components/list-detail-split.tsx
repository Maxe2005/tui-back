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
  // Recolors this list<->detail split's Splitter to accent while it is the Ctrl+W resize-mode's
  // current target (boundary 0). Defaults to false.
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
      {/* Yoga's default makes a flex item's minimum size its own content size: without
          `flexBasis={0}`/`minWidth={0}`/`overflow="hidden"`, a long unbroken run of content in
          either pane (a long branch name, a wide action-log line) refuses to shrink to its
          ratio share and blows through the splitter into the other pane's space. */}
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
