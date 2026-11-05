import { Box, Text } from 'ink';
import { colors } from '../theme/theme.js';

export type CheckboxListItemProps = {
  label: string;
  selected?: boolean;
  nested?: boolean;
  meta?: string;
  state?: 'unchecked' | 'checked';
  // A row that cannot be toggled: rendered dim with a `[-]` box and its dim reason (e.g. `no
  // healthUrl`) instead of a checked/unchecked state.
  disabled?: boolean;
  disabledReason?: string;
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
  const { nested = false, state = 'unchecked', disabled = false } = props;
  const isChecked = state === 'checked';
  return {
    boxGlyph: disabled ? '[-]' : isChecked ? '[x]' : '[ ]',
    labelColor: disabled ? colors['text-dim'] : colors.text,
    metaColor: colors['text-dim'],
    paddingLeft: nested ? 2 : 0,
  };
}

export function CheckboxListItem(props: CheckboxListItemProps) {
  const { label, meta, disabled = false, disabledReason } = props;
  const layout = resolveCheckboxItemLayout(props);
  return (
    <Box backgroundColor={colors.surface} paddingLeft={layout.paddingLeft}>
      <Text color={layout.labelColor}>{layout.boxGlyph}</Text>
      <Text color={layout.labelColor}> {label}</Text>
      {meta ? <Text color={layout.metaColor}> {meta}</Text> : null}
      {disabled && disabledReason ? <Text color={layout.metaColor} wrap="truncate-end"> ({disabledReason})</Text> : null}
    </Box>
  );
}