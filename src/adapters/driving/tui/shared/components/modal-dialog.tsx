import { Box, Text } from 'ink';
import { colors } from '../theme/theme.js';

export type ModalDialogProps = {
  title: string;
  onConfirm: () => void;
  onCancel: () => void;
  open?: boolean;
};

export function ModalDialog(props: ModalDialogProps) {
  const { title, onConfirm, onCancel, open = true } = props;
  if (!open) return null;
  return (
    <Box
      backgroundColor={colors.surface}
      borderColor={colors.border}
      borderStyle="double"
      padding={1}
    >
      <Text color={colors.accent}>
        {title}
      </Text>
      <Text color={colors.text}>
        ──
      </Text>
    </Box>
  );
}