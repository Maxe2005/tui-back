import { Box, Text } from 'ink';
import { colors, spacing } from '../theme/theme.js';

export type ListRowProps = {
  label: string;
  selected?: boolean;
  // Story 2.18: the tool-wide active EDT's row — accent-colored, bold label. Independent of
  // `selected` (the keyboard cursor): additive, composes with (never replaces) the existing
  // selected-cursor treatment (accent bar + `›` marker + surface-selected fill), which stays
  // driven entirely by `selected`. A row can be active, selected, both, or neither.
  active?: boolean;
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
  bold: boolean;
};

export function resolveRowLayout(
  props: ListRowProps,
): ResolvedRow {
  const { selected = false, nested = false, active = false } = props;
  return {
    barGlyph: selected ? '▌' : ' ',
    marker: selected ? '›' : ' ',
    background: selected ? colors['surface-selected'] : colors.surface,
    labelColor: active ? colors.accent : colors.text,
    metaColor: colors['text-dim'],
    paddingLeft: nested ? spacing.indent : 0,
    bold: active,
  };
}

export function ListRow(props: ListRowProps) {
  const { label, meta } = props;
  const layout = resolveRowLayout(props);
  return (
    <Box paddingLeft={layout.paddingLeft} backgroundColor={layout.background}>
      <Text color={colors.accent}>{layout.barGlyph}</Text>
      <Text color={colors.accent}>{layout.marker}</Text>
      <Text color={layout.labelColor} bold={layout.bold}>{label}</Text>
      {meta ? <Text color={layout.metaColor}> {meta}</Text> : null}
    </Box>
  );
}
