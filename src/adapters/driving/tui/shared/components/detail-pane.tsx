import { Box, Text } from 'ink';
import type { ReactNode } from 'react';
import { colors } from '../theme/theme.js';

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
  return (
    <Box flexDirection="column">
      <Text color={colors['text-dim']}>{title.toUpperCase()}</Text>
      <Text color={colors.text}>{children}</Text>
      {summary ? (
        <Box
          borderStyle="single"
          borderLeft={false}
          borderRight={false}
          borderBottom={false}
          borderTopColor={SUMMARY_LINE_COLORS[summary.tone]}
        >
          <Text color={colors.text}>{summary.text}</Text>
        </Box>
      ) : null}
    </Box>
  );
}
