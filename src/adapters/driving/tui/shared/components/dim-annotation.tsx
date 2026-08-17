import { Box, Text } from 'ink';
import { colors } from '../theme/theme.js';

export type DimAnnotationProps = {
  text: string;
};

export function DimAnnotation(props: DimAnnotationProps) {
  const { text } = props;
  return (
    <Box paddingLeft={2}>
      <Text color={colors['text-dim']}>
        {text}
      </Text>
    </Box>
  );
}