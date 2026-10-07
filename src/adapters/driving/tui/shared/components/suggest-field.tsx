// shared/components/suggest-field: render-only view of the SuggestField (see
// suggest-field.logic.ts for the behavior). One field line, then — while editing — a list of
// at most `maxLines` lines (indicators included) plus one status line while suggestions load,
// so the component never exceeds 1 + max(maxLines, 1) lines.
import { Box, Text } from 'ink';
import { colors } from '../theme/theme.js';
import { resolveBranchAutocompleteValidity, type BranchAutocompleteStatus } from './branch-autocomplete-input.js';
import {
  resolveSuggestWindow,
  suggestMatches,
  suggestShowsHighlight,
  type SuggestFieldState,
} from './suggest-field.logic.js';

export type SuggestFieldProps = {
  label: string;
  state: SuggestFieldState;
  suggestions: readonly string[];
  placeholder: string;
  status?: BranchAutocompleteStatus;
  maxLines: number;
  // The field owns the keys: caret and list are shown only then.
  editing: boolean;
  // The row cursor sits on the field (accent label) even when not editing.
  focused?: boolean;
  labelWidth?: number;
};

export function SuggestField({
  label,
  state,
  suggestions,
  placeholder,
  status = 'ready',
  maxLines,
  editing,
  focused = false,
  labelWidth = 0,
}: SuggestFieldProps) {
  const empty = state.value === '';
  const position = Math.min(Math.max(state.cursor, 0), state.value.length);
  const before = state.value.slice(0, position);
  const atCursor = state.value.slice(position, position + 1) || ' ';
  const after = state.value.slice(position + 1);
  const labelColor = focused || editing ? colors.accent : colors.text;
  const validity = !empty && editing && status === 'ready' ? resolveBranchAutocompleteValidity(state.value, suggestions) : null;
  const window =
    editing && status === 'ready'
      ? resolveSuggestWindow(suggestMatches(state, suggestions), state.pickCursor, suggestShowsHighlight(state), maxLines)
      : null;
  return (
    <Box flexDirection="column">
      <Text wrap="truncate-end">
        {label !== '' ? <Text color={labelColor}>{label.padEnd(labelWidth)} </Text> : null}
        {editing ? (
          <>
            <Text color={colors.text}>{before}</Text>
            <Text inverse>{atCursor}</Text>
            <Text color={colors.text}>{after}</Text>
            {empty ? <Text color={colors['text-dim']}>{placeholder}</Text> : null}
          </>
        ) : empty ? (
          <Text color={colors['text-dim']}>{placeholder}</Text>
        ) : (
          <Text color={colors.text}>{state.value}</Text>
        )}
        {validity !== null ? <Text color={validity.glyphColor}> {validity.glyph}</Text> : null}
      </Text>
      {editing && status === 'loading' ? <Text color={colors['text-dim']}>Chargement…</Text> : null}
      {editing && status === 'error' ? <Text color={colors.error}>Failed to load.</Text> : null}
      {window !== null && window.hiddenAbove > 0 ? <Text color={colors['text-dim']}>  ↑ {window.hiddenAbove} de plus</Text> : null}
      {window?.items.map((item, index) => (
        <Text key={`${index}:${item}`} wrap="truncate-end" color={index === window.highlight ? colors.accent : colors.text}>
          {index === window.highlight ? '  › ' : '    '}
          {item}
        </Text>
      ))}
      {window !== null && window.hiddenBelow > 0 ? <Text color={colors['text-dim']}>  ↓ {window.hiddenBelow} de plus</Text> : null}
    </Box>
  );
}
