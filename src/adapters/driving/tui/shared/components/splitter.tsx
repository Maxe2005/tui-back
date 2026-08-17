import { Box, Text } from 'ink';
import { colors } from '../theme/theme.js';

export type SplitterProps = {
  orientation: 'horizontal' | 'vertical';
  size: number;
  onResize: (newSize: number) => void;
};

export function Splitter(props: SplitterProps) {
  const { orientation, size, onResize } = props;
  const isHorizontal = orientation === 'horizontal';
  const dimension = isHorizontal ? 'height' : 'width';
  const otherDim = isHorizontal ? 'width' : 'height';
  const borderSide = isHorizontal ? 'top' : 'left';

  return (
    <Box
      borderTopColor={colors.border}
      borderLeftColor={colors.border}
      borderRightColor={colors.border}
      borderBottomColor={colors.border}
    >
      <Text color={colors.accent}>
        {isHorizontal ? '─' : '│'}
      </Text>
    </Box>
  );
}