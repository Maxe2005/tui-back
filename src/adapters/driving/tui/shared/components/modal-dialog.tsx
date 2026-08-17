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
      <Text color={colors.accent}>
        {title}
      </Text>
      <Text color={colors.text}>
        ──
      </Text>
      {children ? (
        <Box flexDirection="column" maxHeight={maxHeight}>
          {children}
        </Box>
      ) : null}
    </Box>
  );
}