import { Box, Text } from 'ink';
import type { ReactNode } from 'react';
import { useBounds } from '../bounds/bounds-context.js';
import { colors } from '../theme/theme.js';
import { ClampedParagraph, TruncatedText } from './truncated-text.js';

export type SummaryTone = 'success' | 'warning' | 'error';

export const SUMMARY_LINE_COLORS = Object.freeze({
  success: colors.success,
  warning: colors.warning,
  error: colors.error,
} as const);

export function DetailPane({
  title,
  children,
  summary,
}: {
  title: string;
  children: ReactNode;
  summary?: { tone: SummaryTone; text: string };
}) {
  const bounds = useBounds();
  // Title + the summary rule and line leave the rest of the pane to the body.
  const bodyRows = Math.max(1, bounds.rows - (summary ? 4 : 1));
  return (
    <Box flexDirection="column">
      <Text color={colors['text-dim']} wrap="truncate-end">{title.toUpperCase()}</Text>
      {typeof children === 'string' ? (
        <ClampedParagraph color={colors.text} maxLines={bodyRows}>
          {children}
        </ClampedParagraph>
      ) : (
        <Text color={colors.text}>{children}</Text>
      )}
      {summary ? (
        <Box
          borderStyle="single"
          borderLeft={false}
          borderRight={false}
          borderBottom={false}
          borderTopColor={SUMMARY_LINE_COLORS[summary.tone]}
        >
          <TruncatedText color={colors.text}>{summary.text}</TruncatedText>
        </Box>
      ) : null}
    </Box>
  );
}
