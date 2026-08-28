import { Box, Text } from 'ink';
import { colors } from '../theme/theme.js';

export type SplitterProps = {
  orientation: 'horizontal' | 'vertical';
  size: number;
  // Story 2.21: recolors the splitter glyph to `colors.accent` while its boundary is the
  // Ctrl+W resize-mode's current target — every other boundary (the default, `false`) renders
  // in the plain `colors.border` (AC: "the targeted boundary recolors to accent").
  targeted?: boolean;
  onResize?: (newSize: number) => void;
};

export function Splitter(props: SplitterProps) {
  const { orientation, size, targeted = false, onResize } = props;
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
      <Text color={targeted ? colors.accent : colors.border}>
        {isHorizontal ? '─' : '│'}
      </Text>
    </Box>
  );
}