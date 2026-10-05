// shared/components/suggest-field.logic: pure behavior of SuggestField — a one-line text
// field with a bounded suggestion list and a dim placeholder standing for "use the default".
// It wraps the branch-autocomplete reducer (suggestions are plain strings: branches, EDT
// topics, …) and only adds what that reducer lacks: arrows highlight without touching the
// text, `Enter` on an empty field commits the default unless a suggestion was highlighted,
// exact-match validation, and a list window that follows the highlight within a line budget.
import {
  clampAutocompletePickCursor,
  createBranchAutocompleteState,
  handleBranchAutocompleteKey,
  isBranchAutocompleteExactMatch,
  matchBranchesBySubstring,
  type BranchAutocompleteState,
} from './branch-autocomplete-input.js';
import type { TextEditKey } from './text-edit.js';

export interface SuggestFieldState extends BranchAutocompleteState {
  // True once ↑/↓ moved the highlight on an empty field; lets Enter tell "keep the default"
  // from "take the highlighted suggestion". Any text change clears it.
  highlighted: boolean;
}

export function createSuggestFieldState(value = ''): SuggestFieldState {
  return { ...createBranchAutocompleteState({ value }), highlighted: false };
}

export type SuggestFieldStep =
  | { type: 'update'; state: SuggestFieldState }
  | { type: 'commit'; value: string }
  | { type: 'cancel' };

export function stepSuggestField(
  state: SuggestFieldState,
  suggestions: readonly string[],
  input: string,
  key: TextEditKey,
): SuggestFieldStep {
  if (key.escape) {
    return { type: 'cancel' };
  }
  const empty = state.value.trim() === '';
  if (key.return) {
    if (empty && !state.highlighted) {
      return { type: 'commit', value: '' };
    }
    if (isBranchAutocompleteExactMatch(state.value, suggestions)) {
      return { type: 'commit', value: state.value.trim() };
    }
  }
  // On an empty field no row shows a highlight yet, so the first arrow reveals row 0.
  if (empty && !state.highlighted && (key.upArrow === true || key.downArrow === true)) {
    return { type: 'update', state: { ...state, pickCursor: 0, highlighted: true } };
  }
  const result = handleBranchAutocompleteKey(state, suggestions, input, key);
  if (result.type === 'commit-through') {
    return { type: 'commit', value: state.value.trim() };
  }
  const arrow = key.upArrow === true || key.downArrow === true;
  const textChanged = result.state.value !== state.value;
  return {
    type: 'update',
    state: { ...result.state, highlighted: textChanged ? false : arrow || state.highlighted },
  };
}

// Empty is always valid (the default applies); anything else must be a listed suggestion.
export function validateSuggestValue(value: string, suggestions: readonly string[], noun: string): string | null {
  const trimmed = value.trim();
  if (trimmed === '' || suggestions.includes(trimmed)) {
    return null;
  }
  return `"${trimmed}" n'est pas ${noun} existant(e)`;
}

export interface SuggestWindow {
  items: readonly string[];
  // Index of the highlighted item inside `items`, or -1 when none is highlighted.
  highlight: number;
  hiddenAbove: number;
  hiddenBelow: number;
}

// Slices the matches into at most `maxLines` lines including the "N de plus" indicators, the
// window following the highlight. Zero or negative budgets render nothing.
export function resolveSuggestWindow(
  matches: readonly string[],
  pickCursor: number,
  showHighlight: boolean,
  maxLines: number,
): SuggestWindow {
  const budget = Number.isFinite(maxLines) ? Math.max(0, Math.floor(maxLines)) : 0;
  if (budget === 0 || matches.length === 0) {
    return { items: [], highlight: -1, hiddenAbove: 0, hiddenBelow: 0 };
  }
  const cursor = clampAutocompletePickCursor(pickCursor, matches.length);
  if (matches.length <= budget) {
    return { items: matches, highlight: showHighlight ? cursor : -1, hiddenAbove: 0, hiddenBelow: 0 };
  }
  const size = Math.max(1, budget - 2);
  const start = Math.min(Math.max(cursor - Math.floor(size / 2), 0), matches.length - size);
  const items = matches.slice(start, start + size);
  return {
    items,
    highlight: showHighlight ? cursor - start : -1,
    hiddenAbove: start,
    hiddenBelow: matches.length - start - items.length,
  };
}

export function suggestMatches(state: SuggestFieldState, suggestions: readonly string[]): string[] {
  return matchBranchesBySubstring(state.value, suggestions);
}

// The highlight is meaningful once text filters the list or an arrow moved it.
export function suggestShowsHighlight(state: SuggestFieldState): boolean {
  return state.value.trim() !== '' || state.highlighted;
}
