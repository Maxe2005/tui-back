// tui/zones/update: story 3.7 — pure logic for the pre-run configuration screen (the
// shared modal every group-update trigger opens before any git/docker action). Service
// checklist pre-selected per trigger scope, per-service source branch defaulting to the
// manifest `sharedBranch`, plus two run-wide toggles (migrate ON, clean restart OFF)
// applied uniformly to every selected service. Deselecting a service excludes it
// entirely; confirming with zero selected is rejected inline and the screen stays open.
//
// The same split as every other zone: every keystroke behavior below is a standalone pure
// function, unit-tested directly — the zone's `useInput` callback stays a thin dispatcher.
// Checkbox toggling reuses `toggleMemberSelection` and blank-branch rejection reuses
// `validateBranchEditValue` (the edts-zone.logic.ts patterns from the Code Map); branch-field
// editing hosts the shared autocomplete reducer (text via shared/components/text-edit.ts's
// `nextTextInputValue`, never reimplemented).
import type { GroupUpdateScope, GroupUpdateSelectionItem } from '../../../../../core/scripts/group-update.js';
import type { TextEditKey, TextInputState } from '../../shared/components/text-edit.js';
import {
  createBranchAutocompleteState,
  handleBranchAutocompleteKey,
  isBranchAutocompleteExactMatch,
  matchBranchesBySubstring,
  clampAutocompletePickCursor,
  type BranchAutocompleteState,
} from '../../shared/components/branch-autocomplete-input.js';
import {
  moveSelection,
  jumpSelection,
  resolveSelectionDirection,
  resolveSelectionJump,
  toggleMemberSelection,
  validateBranchEditValue,
} from '../edts/edts-zone.logic.js';

export type { TextInputState, TextEditKey };
export type { BranchAutocompleteState };

// One configured service row — `sourceBranch` is the confirmed merge source for this
// service (pre-filled from the manifest `sharedBranch`, editable per row).
export interface UpdateConfigRow {
  service: string;
  repoPath: string;
  sourceBranch: string;
  selected: boolean;
}

// The store-owned draft (live run state lives in Zustand): the run `scope`, one row per
// targeted service, the two run-wide toggles, and the current inline `error` (null when
// the draft validates). The keyboard cursor and the in-progress branch edit are zone-local
// `useState` (see UpdateConfigViewState) — never store state.
export interface UpdateConfigDraft {
  scope: GroupUpdateScope;
  rows: UpdateConfigRow[];
  runMigrations: boolean;
  cleanRestart: boolean;
  error: string | null;
}

export interface UpdateConfigRowInput {
  service: string;
  repoPath: string;
  sourceBranch: string;
}

// Every targeted service starts pre-selected with its branch pre-filled; migrate ON and
// clean restart OFF (the Ask-First defaults — never anything else without renegotiation).
export function createUpdateConfigDraft(scope: GroupUpdateScope, rows: readonly UpdateConfigRowInput[]): UpdateConfigDraft {
  return {
    scope,
    rows: rows.map((row) => ({ ...row, selected: true })),
    runMigrations: true,
    cleanRestart: false,
    error: null,
  };
}

// The focusable rows: every service row in order, then the migrate toggle, then the
// clean-restart toggle.
export function updateConfigRowCount(draft: UpdateConfigDraft): number {
  return draft.rows.length + 2;
}

export function isMigrateRow(draft: UpdateConfigDraft, index: number): boolean {
  return index === draft.rows.length;
}

export function isCleanRestartRow(draft: UpdateConfigDraft, index: number): boolean {
  return index === draft.rows.length + 1;
}

// Space on a row: a service row flips its selection (via the shared `toggleMemberSelection`
// over the selected repoPaths — rows are deduped upstream so repoPaths are unique); a
// toggle row flips its uniform run-wide switch. Out-of-range cursors leave the draft
// untouched. Any edit clears the current inline error.
export function toggleUpdateConfigRow(draft: UpdateConfigDraft, index: number): UpdateConfigDraft {
  if (isMigrateRow(draft, index)) {
    return { ...draft, runMigrations: !draft.runMigrations, error: null };
  }
  if (isCleanRestartRow(draft, index)) {
    return { ...draft, cleanRestart: !draft.cleanRestart, error: null };
  }
  const row = draft.rows[index];
  if (row === undefined) {
    return draft;
  }
  const selected = toggleMemberSelection(
    draft.rows.filter((candidate) => candidate.selected).map((candidate) => candidate.repoPath),
    row.repoPath,
  );
  return {
    ...draft,
    rows: draft.rows.map((candidate) => ({ ...candidate, selected: selected.includes(candidate.repoPath) })),
    error: null,
  };
}

// Enter/`e` on a service row opens the branch editor pre-filled with the row's current
// source branch (caret at the end, the TextInputLine convention) hosting the shared
// autocomplete state (pickCursor 0 — a freshly focused field proposes the whole list).
// Toggle rows and out-of-range cursors have no branch to edit.
export function beginUpdateConfigBranchEdit(draft: UpdateConfigDraft, index: number): BranchAutocompleteState | null {
  const row = draft.rows[index];
  if (row === undefined) {
    return null;
  }
  return createBranchAutocompleteState({ value: row.sourceBranch });
}

// One branch-editor keystroke — delegates to the shared autocomplete reducer (typing at the
// caret via `nextTextInputValue`, Left/Right/Home/End preserving the highlight, Up/Down
// moving it; Ctrl/Meta stay inert). `branches` is the edited row's own `listBranches()`
// result (empty while loading — the field stays usable). Kept as a thin wrapper so the
// reducer stays directly unit-testable through resolveUpdateConfigKey.
export function stepUpdateConfigBranchEdit(
  current: BranchAutocompleteState,
  input: string,
  key: TextEditKey,
  branches: readonly string[] = [],
): BranchAutocompleteState {
  const result = handleBranchAutocompleteKey(current, branches, input, key);
  if (result.type === 'insert') {
    return result.state;
  }
  if (result.type === 'commit-through') {
    return current;
  }
  return result.state;
}

// Commits a branch edit back into the row: a blank value is rejected inline (the
// create-dialog `validateBranchEditValue` convention — block confirm, keep the dialog
// open) and the row keeps its previous branch.
export function commitUpdateConfigBranchEdit(draft: UpdateConfigDraft, index: number, value: string): UpdateConfigDraft {
  const row = draft.rows[index];
  if (row === undefined) {
    return draft;
  }
  const violation = validateBranchEditValue(value);
  if (violation !== null) {
    return { ...draft, error: violation };
  }
  return {
    ...draft,
    rows: draft.rows.map((candidate, candidateIndex) =>
      candidateIndex === index ? { ...candidate, sourceBranch: value } : candidate,
    ),
    error: null,
  };
}

export type ConfirmedUpdateConfig = {
  scope: GroupUpdateScope;
  selection: GroupUpdateSelectionItem[];
  runMigrations: boolean;
  cleanRestart: boolean;
};

// Confirms the draft into the exact configuration the run starts with: every selected
// service plus its branch, and the two uniform toggles. Zero selected is rejected with an
// explicit message (the screen stays open — the caller keeps the dialog mounted); so is a
// blank branch on any selected row (unreachable through the editor above, which rejects
// blanks at commit, but never trusted blindly).
export function confirmUpdateConfigDraft(
  draft: UpdateConfigDraft,
): { ok: true; config: ConfirmedUpdateConfig } | { ok: false; error: string } {
  const selected = draft.rows.filter((row) => row.selected);
  if (selected.length === 0) {
    return { ok: false, error: 'No services selected — select at least one service before starting the run.' };
  }
  for (const row of selected) {
    if (row.sourceBranch.trim() === '') {
      return { ok: false, error: `Service "${row.service}" has an empty source branch — enter a branch or deselect it.` };
    }
  }
  return {
    ok: true,
    config: {
      scope: draft.scope,
      selection: selected.map((row) => ({ service: row.service, repoPath: row.repoPath, sourceBranch: row.sourceBranch })),
      runMigrations: draft.runMigrations,
      cleanRestart: draft.cleanRestart,
    },
  };
}

// Zone-local view state: the keyboard cursor over the focusable rows plus the in-progress
// branch edit (null when browsing) — the edit hosts the shared autocomplete state, fed by
// the edited row's own `listBranches()` result (see the zone's fetch-once-per-edit effect).
export interface UpdateConfigViewState {
  cursor: number;
  editing: BranchAutocompleteState | null;
}

export function clampUpdateConfigCursor(draft: UpdateConfigDraft, cursor: number): number {
  const count = updateConfigRowCount(draft);
  if (count === 0) {
    return 0;
  }
  return Math.min(Math.max(cursor, 0), count - 1);
}

export type UpdateConfigInputKey = {
  upArrow?: boolean;
  downArrow?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
  home?: boolean;
  end?: boolean;
  return?: boolean;
  escape?: boolean;
  backspace?: boolean;
  delete?: boolean;
  ctrl?: boolean;
  meta?: boolean;
  tab?: boolean;
};

export type UpdateConfigStep =
  | { type: 'move'; cursor: number }
  | { type: 'toggle' }
  | { type: 'begin-edit' }
  | { type: 'edit'; editing: BranchAutocompleteState }
  | { type: 'commit-edit' }
  | { type: 'cancel-edit' }
  | { type: 'confirm' }
  | { type: 'cancel' }
  | { type: 'ignore' };

// The dialog's keystroke reducer. Browse mode: arrows/Home/End move (the
// edts-zone cursor vocabulary), Space toggles, `e`/Enter opens the branch editor on a
// service row (Enter toggles a toggle row), `y` confirms the run, Esc cancels. Branch-edit
// mode: the editor hosts the shared autocomplete — `Enter` on a non-empty list first
// `insert`s (fills the text, editing continues) and only the next confirm commits via the
// existing `commitUpdateConfigBranchEdit` path (blank still rejected inline) — except when
// the text already exactly matches a listed branch, where inserting would be a no-op and
// the commit runs at once instead (same idempotent-submit rule pick-existing follows);
// `Enter` with zero matches is a `commit-through` straight to that same commit path. Esc
// cancels the edit (never the dialog), everything else steps the shared reducer.
export function resolveUpdateConfigKey(
  input: string,
  key: UpdateConfigInputKey,
  view: UpdateConfigViewState,
  draft: UpdateConfigDraft,
  branches: readonly string[] = [],
): UpdateConfigStep {
  if (view.editing !== null) {
    if (key.escape === true) {
      return { type: 'cancel-edit' };
    }
    if (key.return === true) {
      const matches = matchBranchesBySubstring(view.editing.value, branches);
      if (matches.length === 0) {
        return { type: 'commit-edit' };
      }
      if (isBranchAutocompleteExactMatch(view.editing.value, branches)) {
        return { type: 'commit-edit' };
      }
      const highlighted = matches[clampAutocompletePickCursor(view.editing.pickCursor, matches.length)]!;
      return { type: 'edit', editing: { value: highlighted, cursor: highlighted.length, pickCursor: 0 } };
    }
    if (key.ctrl === true || key.meta === true) {
      return { type: 'ignore' };
    }
    return { type: 'edit', editing: stepUpdateConfigBranchEdit(view.editing, input, key, branches) };
  }
  if (key.ctrl === true || key.meta === true) {
    return { type: 'ignore' };
  }
  if (key.escape === true) {
    return { type: 'cancel' };
  }
  const count = updateConfigRowCount(draft);
  // `resolveSelectionJump`/`resolveSelectionDirection` read Ink's required-boolean
  // `NavigationKey`; the dialog's own key shape is partial, so it is normalized first.
  const navigationKey = {
    upArrow: key.upArrow === true,
    downArrow: key.downArrow === true,
    home: key.home === true,
    end: key.end === true,
    tab: key.tab === true,
  };
  const jump = resolveSelectionJump(navigationKey);
  if (jump !== null) {
    return { type: 'move', cursor: jumpSelection(jump, count) };
  }
  const direction = resolveSelectionDirection(navigationKey);
  if (direction !== null) {
    return { type: 'move', cursor: moveSelection(view.cursor, direction, count) };
  }
  if (input === ' ') {
    return { type: 'toggle' };
  }
  if (input === 'y' || input === 'Y') {
    return { type: 'confirm' };
  }
  if (input === 'e' || input === 'E') {
    return draft.rows[view.cursor] !== undefined ? { type: 'begin-edit' } : { type: 'ignore' };
  }
  if (key.return === true) {
    return draft.rows[view.cursor] !== undefined ? { type: 'begin-edit' } : { type: 'toggle' };
  }
  return { type: 'ignore' };
}
