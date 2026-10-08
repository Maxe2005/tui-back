import { Box, Text } from 'ink';
import type { ReactNode } from 'react';
import { useBounds } from '../bounds/bounds-context.js';
import { colors, spacing } from '../theme/theme.js';

export type ModalDialogProps = {
  title: string;
  open?: boolean;
  children?: ReactNode;
  // A tighter cap than the window; the dialog is never taller than its bounds regardless.
  maxHeight?: number;
  // Pinned below the body, never clipped by it.
  footer?: ReactNode;
};

// Chrome of the frame: border (2) + padding (2) + title + rule.
const DIALOG_FRAME_ROWS = 6;

export function ModalDialog(props: ModalDialogProps) {
  const { title, open = true, children, maxHeight, footer } = props;
  const bounds = useBounds();
  if (!open) return null;
  const frameCap = Math.max(DIALOG_FRAME_ROWS + 1, bounds.rows);
  const cap = maxHeight === undefined ? frameCap : Math.min(maxHeight, frameCap);
  return (
    <Box
      backgroundColor={colors.surface}
      borderColor={colors.border}
      borderStyle="double"
      padding={spacing['1']}
      flexDirection="column"
      flexShrink={0}
      maxHeight={cap}
      overflow="hidden"
    >
      <Box flexShrink={0}>
        <Text color={colors.accent} wrap="truncate-end">
          {title}
        </Text>
      </Box>
      <Box flexShrink={0}>
        <Text color={colors.text}>
          ──
        </Text>
      </Box>
      {children ? (
        <Box flexDirection="column" flexShrink={1} minHeight={0} overflow="hidden">
          <Box flexDirection="column" flexShrink={0}>
            {children}
          </Box>
        </Box>
      ) : null}
      {footer ? <Box flexShrink={0}>{footer}</Box> : null}
    </Box>
  );
}
