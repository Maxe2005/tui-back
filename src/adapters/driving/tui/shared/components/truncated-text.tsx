// tui/shared/components: bounded text by default — TruncatedText is one normalized line cut to
// its width with an ellipsis; ClampedParagraph keeps at most `maxLines` wrapped lines and ends
// with "… +N lines". Dynamic content outside shared/ goes through these, never raw ink Text.
import { Box, Text } from 'ink';
import wrapAnsi from 'wrap-ansi';
import type { ComponentProps } from 'react';
import { normalizeMessage, stripControl } from '../bounds/message.js';
import { useBounds } from '../bounds/bounds-context.js';

type TextStyleProps = Omit<ComponentProps<typeof Text>, 'children' | 'wrap'>;

export function TruncatedText({ children, maxChars, ...style }: TextStyleProps & { children: unknown; maxChars?: number }) {
  return (
    <Text {...style} wrap="truncate-end">
      {normalizeMessage(children, maxChars)}
    </Text>
  );
}

export function clampParagraph(text: string, width: number, maxLines: number): string[] {
  const safeWidth = Math.max(1, Math.floor(width));
  const safeMax = Math.max(1, Math.floor(maxLines));
  const lines = wrapAnsi(text, safeWidth, { trim: false, hard: true }).split('\n');
  if (lines.length <= safeMax) return lines;
  const hidden = lines.length - (safeMax - 1);
  return [...lines.slice(0, safeMax - 1), `… +${hidden} lines`];
}

// Text that fits within `maxLines` at the bounds' width renders through Ink's own wrap, so
// ordinary output is untouched. Longer text is pre-wrapped, cut and ended with "… +N lines".
// The max-height clip below also holds for panes narrower than the bounds estimate.
export function ClampedParagraph({
  children,
  maxLines,
  width,
  ...style
}: TextStyleProps & { children: string; maxLines: number; width?: number }) {
  const bounds = useBounds();
  const text = normalizeParagraph(children);
  const safeMax = Math.max(1, Math.floor(maxLines));
  const lineWidth = width ?? bounds.columns;
  const wrapped = clampParagraph(text, lineWidth, Number.MAX_SAFE_INTEGER);
  if (wrapped.length <= safeMax) {
    return (
      <Box flexDirection="column" flexShrink={0} maxHeight={safeMax} overflow="hidden">
        <Text {...style}>{text}</Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="column" flexShrink={0}>
      {clampParagraph(text, lineWidth, safeMax).map((line, index) => (
        <Text key={index} {...style} wrap="truncate-end">
          {line}
        </Text>
      ))}
    </Box>
  );
}

// Keeps line breaks and spacing (a paragraph) but strips ANSI/control characters.
function normalizeParagraph(text: string): string {
  return stripControl(text);
}
