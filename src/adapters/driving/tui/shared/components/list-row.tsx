import { Box, Text } from 'ink';
import { colors, spacing } from '../theme/theme.js';

export type ListRowProps = {
  label: string;
  selected?: boolean;
  nested?: boolean;
  meta?: string;
};

export type ResolvedRow = {
  barGlyph: string;
  marker: string;
  background: string;
  labelColor: string;
  metaColor: string;
  paddingLeft: number;
};

export function resolveRowLayout(
  props: ListRowProps,
): ResolvedRow {
  const { selected = false, nested = false } = props;
  return {
    barGlyph: selected ? '▌' : ' ',
    marker: selected ? '›' : '',
    background: selected ? colors['surface-selected'] : colors.surface,
    labelColor: colors.text,
    metaColor: colors['text-dim'],
    paddingLeft: nested ? spacing.indent : 0,
  };
}

export function ListRow(props: ListRowProps) {
  const { label, meta } = props;
  const layout = resolveRowLayout(props);
  return (
    <Box paddingLeft={layout.paddingLeft} backgroundColor={layout.background}>
      <Text color={colors.accent}>{layout.barGlyph}</Text>
      {layout.marker ? <Text color={colors.accent}>{layout.marker}</Text> : null}
      <Text color={layout.labelColor}>{label}</Text>
      {meta ? <Text color={layout.metaColor}> {meta}</Text> : null}
    </Box>
  );
}
