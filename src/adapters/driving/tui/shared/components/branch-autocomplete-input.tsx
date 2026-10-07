// shared/components/branch-autocomplete-input: the shared branch-choosing input — a text field
// (TextInputLine) plus a bounded, case-insensitive substring dropdown and an exact-match
// validity glyph (`✔`/`✖`, never color alone). `handleBranchAutocompleteKey` is the pure reducer
// the host dialog's useInput calls; the first Enter on a non-empty list inserts the highlighted
// branch, so the host keeps its own commit semantics.
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

// The dropdown's own windowing: a maxRows-capped slice plus the overflow count for the
// `… N more` line. Deliberately no scrolling window — when pickCursor runs past the visible
// slice, no row highlights rather than the window following it.
export function resolveBranchAutocompleteDropdown(
  matches: readonly string[],
  maxRows: number,
): { visible: readonly string[]; overflow: number } {
  const safeMax = Number.isFinite(maxRows) ? Math.max(0, Math.floor(maxRows)) : 0;
  const visible = matches.slice(0, safeMax);
  return { visible, overflow: matches.length - visible.length };
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
  state: BranchAutocompleteState;
  branches: readonly string[];
  branchesStatus: BranchAutocompleteStatus;
  maxRows: number;
  focused?: boolean;
};

export function BranchAutocompleteInput(props: BranchAutocompleteInputProps) {
  const { label, state, branches, branchesStatus, maxRows, focused = false } = props;
  if (branchesStatus === 'loading' || branchesStatus === 'error') {
    // No dropdown and no validity coloring while the branch list itself is unavailable — the
    // field stays editable, with the status line carrying the state (same convention as
    // branch-picker.tsx's own loading/error lines).
    return (
      <Box flexDirection="column">
        <TextInputLine label={label} value={state.value} cursor={state.cursor} focused={focused} />
        {branchesStatus === 'loading' ? (
          <StateLine kind="loading" subject="branches" />
        ) : (
          <StateLine kind="error" subject="branches" />
        )}
      </Box>
    );
  }
  const matches = matchBranchesBySubstring(state.value, branches);
  const { visible, overflow } = resolveBranchAutocompleteDropdown(matches, maxRows);
  const validity = resolveBranchAutocompleteValidity(state.value, branches);
  const highlight = clampAutocompletePickCursor(state.pickCursor, matches.length);
  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <TextInputLine label={label} value={state.value} cursor={state.cursor} focused={focused} />
        <Text color={validity.glyphColor}> {validity.glyph}</Text>
      </Box>
      {visible.length > 0 ? (
        <Box flexDirection="column" paddingLeft={2}>
          {visible.map((branch, index) => (
            <Text key={branch} color={index === highlight ? colors.accent : colors.text}>
              {index === highlight ? '› ' : '  '}
              {branch}
            </Text>
          ))}
        </Box>
      ) : null}
      {overflow > 0 ? <Text color={colors['text-dim']}>… {overflow} more</Text> : null}
    </Box>
  );
}
