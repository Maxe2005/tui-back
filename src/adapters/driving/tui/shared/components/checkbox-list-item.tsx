import { Box, Text } from 'ink';
import { colors } from '../theme/theme.js';

export type CheckboxListItemProps = {
  label: string;
  selected?: boolean;
  nested?: boolean;
  meta?: string;
  state?: 'unchecked' | 'checked';
};

export type ResolvedCheckboxItem = {
  boxGlyph: string;
  labelColor: string;
  metaColor: string;
  paddingLeft: number;
};

export function resolveCheckboxItemLayout(
  props: CheckboxListItemProps,
): ResolvedCheckboxItem {
  const { selected = false, nested = false, state = 'unchecked' } = props;
  const isChecked = state === 'checked';
  return {
    boxGlyph: isChecked ? '[x]' : '[ ]',
    labelColor: colors.text,
    metaColor: colors['text-dim'],
    paddingLeft: nested ? 2 : 0,
  };
}

export function CheckboxListItem(props: CheckboxListItemProps) {
  const { label, meta, state } = props;
  const layout = resolveCheckboxItemLayout(props);
  return (
    <Box backgroundColor={colors.surface} paddingLeft={layout.paddingLeft}>
      <Text color={layout.labelColor}>{layout.boxGlyph}</Text>
      <Text color={layout.labelColor}> {label}</Text>
      {meta ? <Text color={layout.metaColor}> {meta}</Text> : null}
    </Box>
  );
}