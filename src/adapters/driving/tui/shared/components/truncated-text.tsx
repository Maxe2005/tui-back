// tui/shared/components: bounded text by default — TruncatedText is one normalized line cut to
// its width with an ellipsis; ClampedParagraph keeps at most `maxLines` wrapped lines and ends
// with "… +N lines". Dynamic content outside shared/ goes through these, never raw ink Text.
import { Text } from 'ink';
import wrapAnsi from 'wrap-ansi';
import type { ComponentProps } from 'react';
import { normalizeMessage } from '../bounds/message.js';
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

export function ClampedParagraph({
  children,
  maxLines,
  width,
  ...style
}: TextStyleProps & { children: string; maxLines: number; width?: number }) {
  const bounds = useBounds();
  const lines = clampParagraph(normalizeParagraph(children), width ?? bounds.columns, maxLines);
  return (
    <>
      {lines.map((line, index) => (
        <Text key={index} {...style} wrap="truncate-end">
          {line}
        </Text>
      ))}
    </>
  );
}

// Keeps line breaks (a paragraph) but strips ANSI/control characters.
function normalizeParagraph(text: string): string {
  return text
    .split('\n')
    .map((line) => normalizeMessage(line, 2000))
    .join('\n');
}
