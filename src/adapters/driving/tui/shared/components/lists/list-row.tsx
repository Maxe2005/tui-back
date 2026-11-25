import { Box, Text } from 'ink';
import { colors, methodColor, spacing } from '../../theme/theme.js';

export type ListRowProps = {
  label: string;
  selected?: boolean;
  // Accent-colored, bold label for whichever row currently drives a categorized split (e.g.
  // the EDT selector row whose membership partitions EDT SERVICES/OTHER SERVICES). Independent
  // of `selected` (the keyboard cursor, which keeps the accent bar + `›` marker +
  // surface-selected fill): a row can be emphasized, selected, both, or neither.
  emphasized?: boolean;
  // The tool-wide active EDT's row: a discreet, non-bold `colors.info` "• active" suffix after
  // `meta`, never accent+bold on the label (that is `emphasized`; the two can land on different
  // rows). The `•` glyph is required: `info` is a status color, and DESIGN.md mandates every
  // status color be paired with a glyph (accent and warning are too close in hue for color-only
  // status). A row can be active, emphasized, both, or neither.
  active?: boolean;
  nested?: boolean;
  // Dimmed label for an unavailable row (e.g. a stale favorite).
  dim?: boolean;
  meta?: string;
  // HTTP method printed (as text) in its method color before the label. A dim row dims it too.
  method?: string;
  // The method already prefixing `meta` (picker rows: `METHOD path`): that token is colored,
  // the remainder stays dim. Ignored when `meta` does not start with it.
  metaMethod?: string;
};

export type ResolvedRow = {
  barGlyph: string;
  marker: string;
  background: string;
  labelColor: string;
  metaColor: string;
  paddingLeft: number;
  bold: boolean;
  activeSuffix: string;
  methodColor: string;
};

export function resolveRowLayout(
  props: ListRowProps,
): ResolvedRow {
  const { selected = false, nested = false, emphasized = false, active = false, dim = false } = props;
  return {
    barGlyph: selected ? '▌' : ' ',
    marker: selected ? '›' : ' ',
    background: selected ? colors['surface-selected'] : colors.surface,
    labelColor: emphasized ? colors.accent : dim ? colors['text-dim'] : colors.text,
    metaColor: colors['text-dim'],
    paddingLeft: nested ? spacing.indent : 0,
    bold: emphasized,
    activeSuffix: active ? ' • active' : '',
    methodColor: dim || props.method === undefined ? colors['text-dim'] : methodColor(props.method),
  };
}

export function ListRow(props: ListRowProps) {
  const { label, meta, method, metaMethod } = props;
  const splitMeta = meta !== undefined && metaMethod !== undefined && metaMethod !== '' && meta.startsWith(`${metaMethod} `);
  const layout = resolveRowLayout(props);
  return (
    <Box paddingLeft={layout.paddingLeft} backgroundColor={layout.background} minWidth={0} overflow="hidden">
      {/* The selection bar + marker must never give up width to a long label: as plain
          sibling <Text>s they shrank to nothing (bar invisible) once the truncated label
          filled the row. */}
      <Box flexShrink={0}>
        <Text color={colors.accent}>{layout.barGlyph}</Text>
        <Text color={colors.accent}>{layout.marker}</Text>
      </Box>
      {/* The list pane's width is ratio-bound, so a label+meta that doesn't fit would hit
          Ink's default mid-token word-wrap. `Text` has no layout props of its own, so a
          wrapping `Box` carries it: the label's `flexShrink={1}` + `minWidth={0}` absorbs the
          squeeze and `wrap="truncate-end"` turns it into a clean ellipsis; `meta`'s
          `flexShrink={0}` keeps the trailing status text intact and the last thing to give. */}
      {method !== undefined && method !== '' ? (
        <Box flexShrink={0}>
          <Text color={layout.methodColor}>{method} </Text>
        </Box>
      ) : null}
      <Box flexShrink={1} minWidth={0}>
        <Text color={layout.labelColor} bold={layout.bold} wrap="truncate-end">{label}</Text>
      </Box>
      {meta ? (
        <Box flexShrink={0}>
          {splitMeta ? (
            <Text color={layout.metaColor}>
              {' '}
              <Text color={props.dim === true ? colors['text-dim'] : methodColor(metaMethod)}>{metaMethod}</Text>
              {meta.slice(metaMethod.length)}
            </Text>
          ) : (
            <Text color={layout.metaColor}> {meta}</Text>
          )}
        </Box>
      ) : null}
      {layout.activeSuffix ? (
        <Box flexShrink={0}>
          <Text color={colors.info}>{layout.activeSuffix}</Text>
        </Box>
      ) : null}
    </Box>
  );
}
