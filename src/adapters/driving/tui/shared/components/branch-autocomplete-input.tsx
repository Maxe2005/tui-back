// shared/components/branch-autocomplete-input: the one suggest-as-you-type input — a text field
// (TextInputLine), a bounded case-insensitive substring list that follows the highlight, an
// exact-match validity glyph (`✔`/`✖`, never color alone) and one StateLine for loading/error.
// Suggestions are plain strings (branches, EDT topics). `handleBranchAutocompleteKey` is the
// pure reducer the host's useInput calls; the first Enter on a non-empty list inserts the
// highlighted suggestion, so the host keeps its own commit semantics.
import { Box, Text } from 'ink';
// Text editing goes through shared/components/text-edit.ts directly, never edts-zone.logic:
// that path would close an import cycle (autocomplete -> edts-zone.logic -> branch-picker ->
// autocomplete).
import { nextTextInputValue, type TextEditKey } from './text-edit.js';
import { colors } from '../theme/theme.js';
import { TextInputLine } from './text-input-line.js';
import { StateLine } from './state-line.js';

export type BranchAutocompleteStatus = 'loading' | 'ready' | 'error';

export type BranchAutocompleteState = {
  value: string;
  cursor: number;
  pickCursor: number;
};

export function createBranchAutocompleteState(initial?: { value?: string; cursor?: number }): BranchAutocompleteState {
  const value = initial?.value ?? '';
  const cursor = Math.min(Math.max(initial?.cursor ?? value.length, 0), value.length);
  return { value, cursor, pickCursor: 0 };
}

// Case-insensitive substring match over the trimmed query — an empty query matches every
// branch (String.includes('') is true for all), so a freshly focused field proposes the whole
// list, capped at maxRows. Trimming keeps a stray trailing space from emptying the proposals
// while the (also trimmed) validity check still reports an exact match.
export function matchBranchesBySubstring(query: string, branches: readonly string[]): string[] {
  const needle = query.trim().toLowerCase();
  return branches.filter((branch) => branch.toLowerCase().includes(needle));
}

// Advisory-only validity: the trimmed text exactly equals a listed branch, compared
// case-sensitively (git branch names are case-sensitive). Never blocks typing.
export function isBranchAutocompleteExactMatch(value: string, branches: readonly string[]): boolean {
  return branches.includes(value.trim());
}

export type BranchAutocompleteValidity = {
  exact: boolean;
  glyph: string;
  glyphColor: string;
};

// The glyph+color pairing (never color alone): `✔` in `success` for an exact match, `✖` in
// `error` otherwise — the same pairing in both focus states (focused only changes the field's
// own label treatment, via TextInputLine, never the glyph's status color, since accent is
// never a status color).
export function resolveBranchAutocompleteValidity(
  value: string,
  branches: readonly string[],
): BranchAutocompleteValidity {
  const exact = isBranchAutocompleteExactMatch(value, branches);
  return { exact, glyph: exact ? '✔' : '✖', glyphColor: exact ? colors.success : colors.error };
}

export interface SuggestWindow {
  items: readonly string[];
  // Index of the highlighted item inside `items`, or -1 when none is highlighted.
  highlight: number;
  hiddenAbove: number;
  hiddenBelow: number;
}

// Slices the matches into at most `maxLines` lines including the "N more" indicators, the
// window following the highlight. Zero or negative budgets render nothing.
export function resolveSuggestWindow(
  matches: readonly string[],
  pickCursor: number,
  showHighlight: boolean,
  maxLines: number,
): SuggestWindow {
  // An unbounded budget shows every match; anything else non-finite (NaN) shows none.
  const budget = maxLines === Infinity ? matches.length : Number.isFinite(maxLines) ? Math.max(0, Math.floor(maxLines)) : 0;
  if (budget === 0 || matches.length === 0) {
    return { items: [], highlight: -1, hiddenAbove: 0, hiddenBelow: 0 };
  }
  const cursor = clampAutocompletePickCursor(pickCursor, matches.length);
  if (matches.length <= budget) {
    return { items: matches, highlight: showHighlight ? cursor : -1, hiddenAbove: 0, hiddenBelow: 0 };
  }
  // Too tight for the "N more" indicators: a plain window, no indicators.
  if (budget < 3) {
    const start = Math.min(Math.max(cursor, 0), matches.length - budget);
    return {
      items: matches.slice(start, start + budget),
      highlight: showHighlight ? cursor - start : -1,
      hiddenAbove: 0,
      hiddenBelow: 0,
    };
  }
  const size = budget - 2;
  const start = Math.min(Math.max(cursor - Math.floor(size / 2), 0), matches.length - size);
  const items = matches.slice(start, start + size);
  return {
    items,
    highlight: showHighlight ? cursor - start : -1,
    hiddenAbove: start,
    hiddenBelow: matches.length - start - items.length,
  };
}

export type BranchAutocompleteKey = TextEditKey;

export type BranchAutocompleteKeyResult =
  | { type: 'update'; state: BranchAutocompleteState }
  | { type: 'insert'; state: BranchAutocompleteState; branch: string }
  | { type: 'commit-through' };

// Shared clamp for every highlight index in this feature (shared reducer, BranchPicker's
// pick-existing filter, update-config's branch editor) — one definition so bound fixes can
// never drift between the three call sites.
export function clampAutocompletePickCursor(pickCursor: number, length: number): number {
  if (length === 0) {
    return 0;
  }
  return Math.min(Math.max(pickCursor, 0), length - 1);
}

export function handleBranchAutocompleteKey(
  state: BranchAutocompleteState,
  branches: readonly string[],
  input: string,
  key: BranchAutocompleteKey,
): BranchAutocompleteKeyResult {
  // Ctrl/Meta combos stay inert — checked first, before any navigation/edit branch, so
  // Ctrl/Meta+<key> never moves or edits anything (mirrors nextTextInputValue's own guard).
  if (key.ctrl || key.meta) {
    return { type: 'update', state };
  }
  const matches = matchBranchesBySubstring(state.value, branches);
  if (key.downArrow || key.upArrow) {
    if (matches.length === 0) {
      return { type: 'update', state: { ...state, pickCursor: 0 } };
    }
    const direction = key.downArrow ? 1 : -1;
    return { type: 'update', state: { ...state, pickCursor: clampAutocompletePickCursor(state.pickCursor + direction, matches.length) } };
  }
  if (key.return) {
    if (matches.length === 0) {
      return { type: 'commit-through' };
    }
    const branch = matches[clampAutocompletePickCursor(state.pickCursor, matches.length)]!;
    // Inserting is a programmatic overwrite — the caret lands at the inserted value's end and
    // the highlight resets to the top (the new filter value's own match list starts there).
    return { type: 'insert', state: { value: branch, cursor: branch.length, pickCursor: 0 }, branch };
  }
  const edited = nextTextInputValue({ value: state.value, cursor: state.cursor }, input, key);
  // A pure caret move leaves the filter value unchanged — the highlight survives it. Only an
  // actual filter-text change re-derives the match list and resets pickCursor to the top.
  const nextPickCursor = edited.value === state.value ? clampAutocompletePickCursor(state.pickCursor, matches.length) : 0;
  return { type: 'update', state: { value: edited.value, cursor: edited.cursor, pickCursor: nextPickCursor } };
}

export type BranchAutocompleteInputProps = {
  label: string;
  state: BranchAutocompleteState & { highlighted?: boolean };
  // What the suggestions are, for the loading/error line.
  subject?: string;
  branches: readonly string[];
  branchesStatus: BranchAutocompleteStatus;
  // The list's line budget, "N more" indicators included.
  maxLines: number;
  // The row cursor sits on the field (accent label) even when not editing.
  focused?: boolean;
  // The field owns the keys: caret, list and validity are shown only then. Defaults to true.
  editing?: boolean;
  // Dim text standing for "use the default" while the field is empty; its presence also hides
  // the empty field's validity mark and the list's highlight until an arrow or a letter.
  placeholder?: string;
  labelWidth?: number;
  // Only where the host binds a retry key for this list.
  retry?: boolean;
};

// With a placeholder the empty field means "default", so no row is highlighted until an arrow
// moved it or text filters the list.
export function branchAutocompleteShowsHighlight(state: { value: string; highlighted?: boolean }, hasPlaceholder: boolean): boolean {
  return !hasPlaceholder || state.value.trim() !== '' || state.highlighted === true;
}

export function BranchAutocompleteInput(props: BranchAutocompleteInputProps) {
  const { label, state, branches, branchesStatus, maxLines, focused = false, editing = true, placeholder, labelWidth, retry, subject = 'branches' } = props;
  const hasPlaceholder = placeholder !== undefined;
  const empty = state.value === '';
  const ready = branchesStatus === 'ready';
  // No list and no validity coloring while the suggestions themselves are unavailable — the
  // field stays editable, with the status line carrying the state.
  const validity =
    ready && (hasPlaceholder ? editing && !empty : true) ? resolveBranchAutocompleteValidity(state.value, branches) : null;
  const window =
    editing && ready
      ? resolveSuggestWindow(
          matchBranchesBySubstring(state.value, branches),
          state.pickCursor,
          branchAutocompleteShowsHighlight(state, hasPlaceholder),
          maxLines,
        )
      : null;
  return (
    <Box flexDirection="column">
      <TextInputLine
        label={label}
        value={state.value}
        cursor={state.cursor}
        focused={editing}
        highlighted={focused}
        placeholder={placeholder}
        labelWidth={labelWidth}
        suffix={validity !== null ? { text: ` ${validity.glyph}`, color: validity.glyphColor } : undefined}
      />
      {editing && branchesStatus === 'loading' ? <StateLine kind="loading" subject={subject} /> : null}
      {editing && branchesStatus === 'error' ? <StateLine kind="error" subject={subject} retry={retry} /> : null}
      {window !== null && window.hiddenAbove > 0 ? <Text color={colors['text-dim']}>  ↑ {window.hiddenAbove} more</Text> : null}
      {window?.items.map((item, index) => (
        <Text key={`${index}:${item}`} wrap="truncate-end" color={index === window.highlight ? colors.accent : colors.text}>
          {index === window.highlight ? '  › ' : '    '}
          {item}
        </Text>
      ))}
      {window !== null && window.hiddenBelow > 0 ? <Text color={colors['text-dim']}>  ↓ {window.hiddenBelow} more</Text> : null}
    </Box>
  );
}
