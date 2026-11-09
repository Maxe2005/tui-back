// tui/shared/components: the measured, windowed line renderer behind every scrollable output
// region (Logs grid panes, the Logs fullscreen preview, the Terminal view). Generic over the line
// type — the caller supplies how a line reads (`format`) and its colour (`color`). Bounded in both
// axes (AD-19): the content Box is measured for its real row budget, only the row-cost-aware
// window is mapped, and each line either truncates or wraps within the measured width.
import type { ReactNode } from 'react';
import { Box, Text, type TextProps } from 'ink';
import { useElementSize } from '../hooks/use-element-size.js';
import { computeLineRowCount, sliceVisibleWindow } from '../scrollable-output/index.js';

export type ScrollableOutputProps<T> = {
  lines: readonly T[];
  // Lines back from the live tail (0 == pinned to the tail).
  offset: number;
  wrap: boolean;
  // First-frame estimates only — the measured content box drives every later frame.
  fallbackRows: number;
  fallbackWidth: number;
  format: (line: T) => string;
  color: (line: T) => TextProps['color'];
  // Rendered when the window is empty; the caller passes `null` when something else (e.g. an
  // error annotation) already explains the emptiness.
  placeholder?: ReactNode;
};

export function ScrollableOutput<T>({ lines, offset, wrap, fallbackRows, fallbackWidth, format, color, placeholder = null }: ScrollableOutputProps<T>) {
  const [contentRef, measuredSize] = useElementSize();
  const rowBudget = measuredSize !== null ? measuredSize.height : fallbackRows;
  const width = measuredSize !== null ? Math.max(measuredSize.width, 1) : fallbackWidth;
  // Truncated lines always cost one row, so `format` only runs for row cost under wrap.
  const rowCost = wrap ? (line: T) => computeLineRowCount(format(line), width, true) : () => 1;
  const windowLines = sliceVisibleWindow(lines, offset, rowBudget, rowCost);
  return (
    <Box ref={contentRef} flexDirection="column" flexGrow={1} minHeight={0} minWidth={0} overflow="hidden">
      {windowLines.length === 0 ? placeholder : null}
      {windowLines.map((line, index) => (
        <Text key={index} color={color(line)} wrap={wrap ? 'wrap' : 'truncate-end'}>
          {format(line)}
        </Text>
      ))}
    </Box>
  );
}
