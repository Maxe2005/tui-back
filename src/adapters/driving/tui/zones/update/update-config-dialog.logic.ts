// tui/zones/update: pure logic for the pre-run configuration screen every group-update trigger
// opens before any git/docker action — a service checklist pre-selected per trigger scope, a
// per-service source branch defaulting to the manifest `sharedBranch`, and two run-wide toggles
// (migrate ON, clean restart OFF). Deselecting excludes a service entirely; confirming with
// zero selected is rejected inline. Every keystroke behavior is a pure, unit-tested function.
import type { GroupUpdateScope, GroupUpdateSelectionItem } from '../../../../../core/scripts/group-update.js';
import type { MergeSourceError, MergeSourceOrigin, MergeSourceRow } from '../../../../../core/scripts/resolve-merge-sources.js';
import type { TextEditKey, TextInputState } from '../../shared/components/text-edit.js';
import {
  createBranchAutocompleteState,
  handleBranchAutocompleteKey,
  isBranchAutocompleteExactMatch,
  matchBranchesBySubstring,
  clampAutocompletePickCursor,
  type BranchAutocompleteState,
} from '../../shared/components/branch-autocomplete-input.js';
import { nextCursorForKey } from '../../shared/keys/list-cursor.js';
import {
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
  // The manifest `sharedBranch`: what the row follows under the shared strategy and what
  // the manual editor is pre-filled with.
  sharedBranch: string;
  origin: MergeSourceOrigin;
  // Set while a from-EDT row cannot resolve; blocks the run only when the row is selected.
  sourceError?: RowSourceError;
  selected: boolean;
  // What the manifest declares: an undeclared action can never run, whatever is asked.
  migrationDeclared: boolean;
  recipeDeclared: boolean;
  // Per-service answers to the two run-wide toggles.
  migrations: ToggleOverride;
  cleanRestart: ToggleOverride;
}

export type RowSourceError = MergeSourceError | 'no-edt-chosen';
export type ToggleOverride = 'follow' | 'off' | 'on';

// Where non-manual rows take their source from: each manifest `sharedBranch`, or the
// branch recorded for the service in another EDT. `resolved` is that EDT's resolution,
// kept so a manual row can be reset without re-reading git.
export type MergeStrategy =
  | { kind: 'shared' }
  // From EDT selected but no EDT picked yet: every row is blocked until one is.
  | { kind: 'edt-pending' }
  | { kind: 'edt'; ulid: string; topic: string; resolved: MergeSourceRow[] };

// `simple`: the plain checklist (single-service config). `edt-panels`/`all-panels`: the two
// panels — the merge-source lines exist only in EDT scope.
export type ConfigLayout = 'simple' | 'edt-panels' | 'all-panels';

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
  layout: ConfigLayout;
  strategy: MergeStrategy;
}

export interface UpdateConfigRowInput {
  service: string;
  repoPath: string;
  sourceBranch: string;
  migrationDeclared?: boolean;
  recipeDeclared?: boolean;
}

// Every targeted service starts pre-selected with its branch pre-filled; migrate ON and clean
// restart OFF — deliberate defaults.
export function createUpdateConfigDraft(
  scope: GroupUpdateScope,
  rows: readonly UpdateConfigRowInput[],
  options: { layout?: ConfigLayout } = {},
): UpdateConfigDraft {
  return {
    scope,
    rows: rows.map((row) => ({
      service: row.service,
      repoPath: row.repoPath,
      sourceBranch: row.sourceBranch,
      sharedBranch: row.sourceBranch,
      origin: 'shared',
      selected: true,
      migrationDeclared: row.migrationDeclared ?? true,
      recipeDeclared: row.recipeDeclared ?? true,
      migrations: 'follow',
      cleanRestart: 'follow',
    })),
    runMigrations: true,
    cleanRestart: false,
    error: null,
    layout: options.layout ?? 'simple',
    strategy: { kind: 'shared' },
  };
}

// Re-resolves every non-manual row under `strategy`; manual rows keep their branch. Rows
// the chosen EDT cannot resolve get an empty source plus the reason.
export function applyMergeStrategy(draft: UpdateConfigDraft, strategy: MergeStrategy): UpdateConfigDraft {
  return {
    ...draft,
    strategy,
    rows: draft.rows.map((row) => (row.origin === 'manual' ? row : followStrategy(row, strategy))),
    error: null,
  };
}

function followStrategy(row: UpdateConfigRow, strategy: MergeStrategy): UpdateConfigRow {
  const { sourceError: _dropped, ...rest } = row;
  if (strategy.kind === 'shared') {
    return { ...rest, sourceBranch: row.sharedBranch, origin: 'shared' };
  }
  if (strategy.kind === 'edt-pending') {
    return { ...rest, sourceBranch: '', origin: 'edt', sourceError: 'no-edt-chosen' };
  }
  const resolved = strategy.resolved.find((candidate) => candidate.repoPath === row.repoPath);
  return {
    ...rest,
    sourceBranch: resolved?.source ?? '',
    origin: 'edt',
    ...(resolved?.error !== undefined ? { sourceError: resolved.error } : {}),
  };
}

// An unresolved row opens the editor on its manifest `sharedBranch`, not on the empty source.
function editorSeed(row: UpdateConfigRow): string {
  return row.sourceError !== undefined ? row.sharedBranch : row.sourceBranch;
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

// `e` on a service row opens the branch editor pre-filled with the row's current
// source branch (caret at the end, the TextInputLine convention) hosting the shared
// autocomplete state (pickCursor 0 — a freshly focused field proposes the whole list).
// Toggle rows and out-of-range cursors have no branch to edit.
export function beginUpdateConfigBranchEdit(draft: UpdateConfigDraft, index: number): BranchAutocompleteState | null {
  const row = draft.rows[index];
  if (row === undefined) {
    return null;
  }
  return createBranchAutocompleteState({ value: editorSeed(row) });
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
    rows: draft.rows.map((candidate, candidateIndex) => {
      if (candidateIndex !== index) {
        return candidate;
      }
      const { sourceError: _cleared, ...rest } = candidate;
      return { ...rest, sourceBranch: value, origin: 'manual' };
    }),
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
  // The two-panel screen speaks French like edt-create's Step 3; the plain list keeps English.
  const fr = draft.layout !== 'simple';
  if (selected.length === 0) {
    return {
      ok: false,
      error: fr
        ? 'Aucun service sélectionné — cochez au moins un service avant de lancer.'
        : 'No services selected — select at least one service before starting the run.',
    };
  }
  const unresolved = selected.filter((row) => row.sourceError !== undefined);
  if (unresolved.length > 0) {
    const names = unresolved.map((row) => row.service).join(', ');
    return {
      ok: false,
      error: fr
        ? `Source de merge non résolue pour : ${names} — configurez la ligne (Entrée) ou décochez-la.`
        : `Unresolved merge source for: ${names} — pick a branch (Enter) or deselect.`,
    };
  }
  for (const row of selected) {
    if (row.sourceBranch.trim() === '') {
      return {
        ok: false,
        error: fr
          ? `Le service "${row.service}" n'a pas de branche source — saisissez-en une ou décochez-le.`
          : `Service "${row.service}" has an empty source branch — enter a branch or deselect it.`,
      };
    }
  }
  return {
    ok: true,
    config: {
      scope: draft.scope,
      selection: selected.map((row) => ({
        service: row.service,
        repoPath: row.repoPath,
        sourceBranch: row.sourceBranch,
        ...(row.migrations !== 'follow' ? { runMigrations: row.migrations === 'on' } : {}),
        ...(row.cleanRestart !== 'follow' ? { cleanRestart: row.cleanRestart === 'on' } : {}),
      })),
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
  shift?: boolean;
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
// edts-zone cursor vocabulary), Space toggles, `e` opens the branch editor on a
// service row, Enter confirms the run, Esc cancels. Branch-edit
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
  const cursor = nextCursorForKey(key, view.cursor, count);
  if (cursor !== null) {
    return { type: 'move', cursor };
  }
  if (input === ' ') {
    return { type: 'toggle' };
  }
  if (input === 'e' || input === 'E') {
    return draft.rows[view.cursor] !== undefined ? { type: 'begin-edit' } : { type: 'ignore' };
  }
  if (key.return === true) {
    return { type: 'confirm' };
  }
  return { type: 'ignore' };
}
