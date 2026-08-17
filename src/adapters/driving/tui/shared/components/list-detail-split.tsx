import { Box } from 'ink';
import type { ReactNode } from 'react';
import { Splitter } from './splitter.js';

export const DEFAULT_LIST_RATIO = 2 / 5;

export function resolveSplitFlex(ratio: number): {
  list: number;
  detail: number;
} {
  const clamped = Math.min(0.8, Math.max(0.2, ratio));
  return { list: clamped, detail: 1 - clamped };
}

export function ListDetailSplit({
  ratio,
  list,
  detail,
  onResize,
}: {
  ratio: number;
  list: ReactNode;
  detail: ReactNode;
  onResize: (ratio: number) => void;
}) {
  const flex = resolveSplitFlex(ratio);
  return (
    <Box flexDirection="row" flexGrow={1}>
      <Box flexGrow={flex.list}>{list}</Box>
      <Splitter orientation="vertical" size={1} onResize={onResize} />
      <Box flexGrow={flex.detail}>{detail}</Box>
    </Box>
  );
}