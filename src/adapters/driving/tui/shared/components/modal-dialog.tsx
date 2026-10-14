import { Box, Text } from 'ink';
import type { ReactNode } from 'react';
import { colors, spacing } from '../theme/theme.js';

export type ModalDialogProps = {
  title: string;
  onConfirm: () => void;
  onCancel: () => void;
  open?: boolean;
  children?: ReactNode;
  maxHeight?: number | string;
};

export function ModalDialog(props: ModalDialogProps) {
  const { title, onConfirm, onCancel, open = true, children, maxHeight } = props;
  if (!open) return null;
  return (
    <Box
      backgroundColor={colors.surface}
      borderColor={colors.border}
      borderStyle="double"
      padding={spacing['1']}
      flexDirection="column"
    >
      {/* flexShrink 0: when the modal is taller than the screen, Yoga would otherwise shrink the
          title/separator rows to 0 height and draw the next row over them. */}
      <Box flexShrink={0}>
        <Text color={colors.accent} wrap="truncate-end">
          {title}
        </Text>
      </Box>
      <Box flexShrink={0}>
        <Text color={colors.text}>──</Text>
      </Box>
      {children ? (
        <Box flexDirection="column" maxHeight={maxHeight}>
          {children}
        </Box>
      ) : null}
    </Box>
  );
}