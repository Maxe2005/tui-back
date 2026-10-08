import { Box } from 'ink';
import { colors } from '../theme/theme.js';
import { ClampedParagraph } from './truncated-text.js';

export type DimAnnotationProps = {
  text: string;
};

// An annotation is a hint or an error detail, never a log: a few lines at most.
export const DIM_ANNOTATION_MAX_LINES = 3;

export function DimAnnotation(props: DimAnnotationProps) {
  const { text } = props;
  return (
    <Box paddingLeft={2}>
      <ClampedParagraph color={colors['text-dim']} maxLines={DIM_ANNOTATION_MAX_LINES}>
        {text}
      </ClampedParagraph>
    </Box>
  );
}
