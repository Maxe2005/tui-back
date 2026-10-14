// tui/zones/shared-types: the History view's pure decisions — key reducer, result rows and the
// status lines. The component (`shared-types-history.tsx`) is a thin dispatcher over these.
import { isValidHistoryVersion, type VersionHistoryEntry, type VersionHit } from '../../../../../core/shared-types/version-history.js';
import type { SharedTypesHistory } from '../../store/slices/shared-types-slice.js';
import {
  createBranchAutocompleteState,
  handleBranchAutocompleteKey,
  isBranchAutocompleteExactMatch,
  type BranchAutocompleteState,
} from '../../shared/components/branch-autocomplete-input.js';
import { nextTextInputValue, type TextEditKey, type TextInputState } from '../../shared/components/text-edit.js';

export type HistoryMode = SharedTypesHistory['mode'];

export type HistoryView = {
  // The text field owns the keys; otherwise the result rows do.
  editing: boolean;
  row: number;
  branch: BranchAutocompleteState;
  version: TextInputState;
  // Inline message for an invalid by-version input (no git call was made).
  inputError: string | null;
};

export function initialHistoryView(): HistoryView {
  return { editing: true, row: 0, branch: createBranchAutocompleteState(), version: { value: '', cursor: 0 }, inputError: null };
}

export const HISTORY_VERSION_INPUT_ERROR = 'Enter a version as MAJOR.MINOR.PATCH (digits only), e.g. 0.1.3770.';

export type HistoryKey = TextEditKey & { upArrow?: boolean; downArrow?: boolean; return?: boolean };

export type HistoryAction =
  | { type: 'none' }
  | { type: 'close' }
  | { type: 'cancel' }
  | { type: 'switch-mode' }
  | { type: 'search'; query: string }
  | { type: 'select'; version: string };

export type HistoryContext = {
  mode: HistoryMode;
  searching: boolean;
  branches: readonly string[];
  // The version Enter picks on each result row.
  rowVersions: readonly string[];
};

export function reduceHistoryKey(view: HistoryView, ctx: HistoryContext, input: string, key: HistoryKey): { view: HistoryView; action: HistoryAction } {
  const idle = (next: HistoryView = view): { view: HistoryView; action: HistoryAction } => ({ view: next, action: { type: 'none' } });
  if (key.escape === true) {
    if (ctx.searching) {
      return { view, action: { type: 'cancel' } };
    }
    if (view.editing && ctx.rowVersions.length > 0) {
      return idle({ ...view, editing: false, row: 0 });
    }
    return { view, action: { type: 'close' } };
  }
  if (key.tab === true) {
    return { view: { ...view, editing: true, row: 0, inputError: null }, action: { type: 'switch-mode' } };
  }
  if (!view.editing) {
    if (key.upArrow === true) {
      return view.row <= 0 ? idle({ ...view, editing: true }) : idle({ ...view, row: view.row - 1 });
    }
    if (key.downArrow === true) {
      return idle({ ...view, row: Math.max(0, Math.min(ctx.rowVersions.length - 1, view.row + 1)) });
    }
    if (key.return === true) {
      const version = ctx.rowVersions[view.row];
      return version === undefined ? idle() : { view, action: { type: 'select', version } };
    }
    if (input === '/') {
      return idle({ ...view, editing: true });
    }
    return idle();
  }
  if (ctx.mode === 'version') {
    if (key.return === true) {
      const value = view.version.value.trim();
      if (!isValidHistoryVersion(value)) {
        return idle({ ...view, inputError: HISTORY_VERSION_INPUT_ERROR });
      }
      return { view: { ...view, inputError: null }, action: { type: 'search', query: value } };
    }
    if (key.upArrow === true || key.downArrow === true) {
      return idle();
    }
    return idle({ ...view, inputError: null, version: nextTextInputValue(view.version, input, key) });
  }
  // By branch: a first Enter on a proposal fills the field, Enter on an exact branch (or with
  // no proposal at all, so an arbitrary ref can still be tried) searches.
  if (key.return === true && isBranchAutocompleteExactMatch(view.branch.value, ctx.branches)) {
    return { view, action: { type: 'search', query: view.branch.value.trim() } };
  }
  const step = handleBranchAutocompleteKey(view.branch, ctx.branches, input, key);
  if (step.type === 'commit-through') {
    const query = view.branch.value.trim();
    return query === '' ? idle() : { view, action: { type: 'search', query } };
  }
  return idle({ ...view, branch: step.state });
}

export function formatShortCommit(commit: string): string {
  return commit.slice(0, 7);
}

export function formatDate(date: string): string {
  return date.length >= 10 ? date.slice(0, 10) : date;
}

export function entryRow(entry: VersionHistoryEntry): string {
  return `${entry.version}  ${formatShortCommit(entry.commit)}  ${formatDate(entry.date)}`;
}

export function hitRow(hit: VersionHit): string {
  const branches = hit.branches.length > 0 ? hit.branches.join(', ') : '(no branch)';
  return `${hit.earliest ? '* ' : '  '}${formatShortCommit(hit.commit)}  ${formatDate(hit.date)}  ${branches}`;
}

// The one line saying why a by-branch walk ended (or that it is still going).
export function branchStatusLine(history: SharedTypesHistory): string | null {
  if (history.status === 'searching') {
    return `searching… ${String(history.entries.length)} found`;
  }
  if (history.status !== 'done') {
    return null;
  }
  switch (history.endedBy) {
    case 'depth':
      return `stopped: depth ${String(history.depth)}`;
    case 'scanned':
      return `stopped: ${String(history.maxScanned)} commits scanned`;
    case 'exhausted':
      return history.entries.length === 0 ? 'branch exhausted: no version bump found' : 'branch exhausted';
    case 'aborted':
      return 'cancelled';
    default:
      return null;
  }
}

export function versionStatusLine(history: SharedTypesHistory): string | null {
  if (history.status === 'searching') {
    return `searching… ${String(history.hits.length)} found`;
  }
  if (history.status !== 'done') {
    return null;
  }
  if (history.endedBy === 'aborted') {
    return 'cancelled';
  }
  if (history.found === false) {
    return `${history.query} was not found on any branch`;
  }
  return history.earliestBranch !== null ? `earliest introduced on ${history.earliestBranch} (marked *)` : null;
}
