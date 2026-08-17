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
}: {
  ratio: number;
  list: ReactNode;
  detail: ReactNode;
}) {
  const flex = resolveSplitFlex(ratio);
  return (
    <Box flexDirection="row" flexGrow={1}>
      <Box flexGrow={flex.list}>{list}</Box>
      <Splitter orientation="vertical" size={1} />
      <Box flexGrow={flex.detail}>{detail}</Box>
    </Box>
  );
}
