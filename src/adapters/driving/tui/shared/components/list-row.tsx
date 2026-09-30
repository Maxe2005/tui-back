import { Box, Text } from 'ink';
import { colors, spacing } from '../theme/theme.js';

export type ListRowProps = {
  label: string;
  selected?: boolean;
  // Story 2.18, repurposed 2026-08-27 (Sprint Change Proposal): accent-colored, bold label for
  // whichever row currently drives a categorized split (e.g. the EDT selector row whose
  // membership partitions EDT SERVICES/OTHER SERVICES). Independent of `selected` (the
  // keyboard cursor): additive, composes with (never replaces) the existing selected-cursor
  // treatment (accent bar + `›` marker + surface-selected fill), which stays driven entirely by
  // `selected`. A row can be emphasized, selected, both, or neither.
  emphasized?: boolean;
  // Story 2.18, repurposed 2026-08-27 (Sprint Change Proposal): the tool-wide active EDT's row
  // — no longer accent+bold on the label (that moved to `emphasized`, since the two could land
  // on different rows and competed visually). Renders a discreet, non-bold `colors.info`
  // "• active" suffix after `meta` instead — the `•` glyph is required, not decorative: `info`
  // is one of the four semantic status colors, which DESIGN.md's Colors section mandates must
  // always be paired with a glyph, never carried by color alone (accent and warning are close
  // enough in hue that color-only status would be ambiguous). Decoupled from `emphasized`: a
  // row can be active, emphasized, both, or neither.
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
  activeSuffix: string;
};

export function resolveRowLayout(
  props: ListRowProps,
): ResolvedRow {
  const { selected = false, nested = false, emphasized = false, active = false } = props;
  return {
    barGlyph: selected ? '▌' : ' ',
    marker: selected ? '›' : ' ',
    background: selected ? colors['surface-selected'] : colors.surface,
    labelColor: emphasized ? colors.accent : colors.text,
    metaColor: colors['text-dim'],
    paddingLeft: nested ? spacing.indent : 0,
    bold: emphasized,
    activeSuffix: active ? ' • active' : '',
  };
}

export function ListRow(props: ListRowProps) {
  const { label, meta } = props;
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
      {/* Bugfix (story 2.21 follow-up #2): now that the list pane's own width is genuinely
          ratio-bound (list-detail-split.tsx), a row whose label+meta combined no longer fits
          the real column width surfaced Ink's default word-wrap mid-token (e.g.
          "detached-head-s" / "c" split across two lines) — previously masked entirely by the
          pane-sizing bug, which let the whole row overflow outward instead of ever being
          measured against a real width. `Text` has no layout props of its own (Ink), so the
          shrink/truncate behavior is carried by a wrapping `Box`: the label's `flexShrink={1}`
          + `minWidth={0}` lets it absorb the squeeze, with `wrap="truncate-end"` turning that
          into a clean ellipsis instead of a mid-word break; `meta`'s `flexShrink={0}` keeps the
          trailing status text (the more information-dense half) intact and the last thing to
          give. */}
      <Box flexShrink={1} minWidth={0}>
        <Text color={layout.labelColor} bold={layout.bold} wrap="truncate-end">{label}</Text>
      </Box>
      {meta ? (
        <Box flexShrink={0}>
          <Text color={layout.metaColor}> {meta}</Text>
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
