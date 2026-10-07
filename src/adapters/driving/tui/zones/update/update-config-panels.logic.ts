// tui/zones/update: pure logic of the two-panel configuration screen (EDT and all-repos
// scopes), modeled on edt-create's Step 3. Panel A holds the global parameters (merge source
// — EDT scope only —, migrations, clean restart); panel B is the per-service table. Rows show
// the effective value of each action: an action the manifest does not declare can never read
// as enabled. Every keystroke behavior is a standalone function; the zone only dispatches.
import {
  stepSuggestField,
  validateSuggestValue,
  type SuggestFieldState,
} from '../../shared/components/suggest-field.logic.js';
import type { TextEditKey } from '../../shared/components/text-edit.js';
import { resolveFocusStep } from '../../shared/keys/focus-navigation.js';
import { moveSelection, resolveSelectionDirection } from '../edts/edts-zone.logic.js';
import {
  applyMergeStrategy,
  type ToggleOverride,
  type UpdateConfigDraft,
  type UpdateConfigRow,
} from './update-config-dialog.logic.js';

export type EffectiveMigrations = 'migrate' | 'off' | 'none';
export type EffectiveRestart = 'clean' | 'basic' | 'no-recipe';

function wants(override: ToggleOverride, global: boolean): boolean {
  return override === 'follow' ? global : override === 'on';
}

export function effectiveMigrations(draft: UpdateConfigDraft, row: UpdateConfigRow): EffectiveMigrations {
  if (!wants(row.migrations, draft.runMigrations)) {
    return 'off';
  }
  return row.migrationDeclared ? 'migrate' : 'none';
}

export function effectiveRestart(draft: UpdateConfigDraft, row: UpdateConfigRow): EffectiveRestart {
  if (!wants(row.cleanRestart, draft.cleanRestart)) {
    return 'basic';
  }
  return row.recipeDeclared ? 'clean' : 'no-recipe';
}

// `perso` as soon as the row departs from the global parameters in any way.
export function rowMode(row: UpdateConfigRow): 'global' | 'perso' {
  return row.origin === 'manual' || row.migrations !== 'follow' || row.cleanRestart !== 'follow' ? 'perso' : 'global';
}

export type GlobalLine = 'source' | 'edt' | 'migrations' | 'cleanRestart';

export function globalLines(draft: UpdateConfigDraft): GlobalLine[] {
  if (draft.layout !== 'edt-panels') {
    return ['migrations', 'cleanRestart'];
  }
  return draft.strategy.kind === 'shared'
    ? ['source', 'migrations', 'cleanRestart']
    : ['source', 'edt', 'migrations', 'cleanRestart'];
}

export function clampPanelCursor(draft: UpdateConfigDraft, cursor: number): number {
  return Math.min(Math.max(cursor, 0), globalLines(draft).length - 1);
}

export function clampTableCursor(draft: UpdateConfigDraft, cursor: number): number {
  return Math.min(Math.max(cursor, 0), Math.max(draft.rows.length - 1, 0));
}

export function toggleGlobalLine(draft: UpdateConfigDraft, line: GlobalLine): UpdateConfigDraft {
  if (line === 'migrations') {
    return { ...draft, runMigrations: !draft.runMigrations, error: null };
  }
  if (line === 'cleanRestart') {
    return { ...draft, cleanRestart: !draft.cleanRestart, error: null };
  }
  return draft;
}

// Shared ⇄ From EDT. Switching to From EDT blocks every non-manual row until an EDT is picked.
export function toggleMergeSource(draft: UpdateConfigDraft): UpdateConfigDraft {
  return applyMergeStrategy(draft, draft.strategy.kind === 'shared' ? { kind: 'edt-pending' } : { kind: 'shared' });
}

export function toggleRowSelection(draft: UpdateConfigDraft, index: number): UpdateConfigDraft {
  const row = draft.rows[index];
  if (row === undefined) {
    return draft;
  }
  return {
    ...draft,
    rows: draft.rows.map((candidate, candidateIndex) => (candidateIndex === index ? { ...candidate, selected: !candidate.selected } : candidate)),
    error: null,
  };
}

export function setRow(draft: UpdateConfigDraft, index: number, next: UpdateConfigRow): UpdateConfigDraft {
  return { ...draft, rows: draft.rows.map((row, rowIndex) => (rowIndex === index ? next : row)), error: null };
}

// An empty branch means "follow the global source": the row rejoins the global strategy under
// Shared, and under From EDT stays a personal row pinned on its manifest `sharedBranch`.
export function commitEmptyBranch(draft: UpdateConfigDraft, row: UpdateConfigRow): UpdateConfigRow {
  const { sourceError: _cleared, ...rest } = row;
  if (draft.strategy.kind === 'shared') {
    return { ...rest, sourceBranch: row.sharedBranch, origin: 'shared' };
  }
  return { ...rest, sourceBranch: row.sharedBranch, origin: 'manual' };
}

// Ctrl+R: the row forgets every exception and follows the global parameters again.
export function resetRowToGlobal(draft: UpdateConfigDraft, index: number): UpdateConfigDraft {
  const row = draft.rows[index];
  if (row === undefined) {
    return draft;
  }
  const reset = applyMergeStrategy({ ...draft, rows: [{ ...row, origin: 'shared', migrations: 'follow', cleanRestart: 'follow' }] }, draft.strategy);
  return setRow(draft, index, reset.rows[0]!);
}

export interface PanelsViewState {
  focus: 'panel' | 'table';
  panelCursor: number;
  tableCursor: number;
  // The EDT field while it is being edited; null when browsing.
  edtField: SuggestFieldState | null;
}

export type PanelsKey = TextEditKey & { upArrow?: boolean; downArrow?: boolean; leftArrow?: boolean; rightArrow?: boolean };

export type PanelsStep =
  | { type: 'move-panel'; cursor: number }
  | { type: 'move-table'; cursor: number }
  | { type: 'switch-focus' }
  | { type: 'toggle-source' }
  | { type: 'toggle-global'; line: GlobalLine }
  | { type: 'edit-edt'; initial: string }
  | { type: 'edt-edit'; field: SuggestFieldState }
  | { type: 'edt-commit'; value: string }
  | { type: 'edt-cancel' }
  | { type: 'toggle-row' }
  | { type: 'open-box' }
  | { type: 'reset-row' }
  | { type: 'confirm' }
  | { type: 'cancel' }
  | { type: 'ignore' };

function isPrintable(input: string, key: PanelsKey): boolean {
  return (
    input.length === 1 &&
    input.trim() !== '' &&
    !key.ctrl &&
    !key.meta &&
    !key.return &&
    !key.escape &&
    !key.tab &&
    !key.backspace &&
    !key.delete
  );
}

export function resolvePanelsKey(
  input: string,
  key: PanelsKey,
  view: PanelsViewState,
  draft: UpdateConfigDraft,
  edtTopics: readonly string[],
): PanelsStep {
  if (view.edtField !== null) {
    const step = stepSuggestField(view.edtField, edtTopics, input, key);
    if (step.type === 'update') {
      return { type: 'edt-edit', field: step.state };
    }
    return step.type === 'commit' ? { type: 'edt-commit', value: step.value } : { type: 'edt-cancel' };
  }
  if (key.ctrl === true) {
    return input.toLowerCase() === 'r' && view.focus === 'table' ? { type: 'reset-row' } : { type: 'ignore' };
  }
  if (key.meta === true) {
    return { type: 'ignore' };
  }
  if (key.escape === true) {
    return { type: 'cancel' };
  }
  if (resolveFocusStep(input, key, 'tab') !== null) {
    return { type: 'switch-focus' };
  }
  // On the EDT line a typed `y` starts the filter like any other letter.
  const onEdtLine = view.focus === 'panel' && globalLines(draft)[view.panelCursor] === 'edt';
  if ((input === 'y' || input === 'Y') && !onEdtLine) {
    return { type: 'confirm' };
  }
  const direction = resolveSelectionDirection({
    upArrow: key.upArrow === true,
    downArrow: key.downArrow === true,
    home: false,
    end: false,
    tab: false,
  });
  if (view.focus === 'table') {
    if (direction !== null) {
      return { type: 'move-table', cursor: moveSelection(view.tableCursor, direction, draft.rows.length) };
    }
    if (input === ' ') {
      return { type: 'toggle-row' };
    }
    return key.return === true && draft.rows[view.tableCursor] !== undefined ? { type: 'open-box' } : { type: 'ignore' };
  }
  const lines = globalLines(draft);
  if (direction !== null) {
    return { type: 'move-panel', cursor: moveSelection(view.panelCursor, direction, lines.length) };
  }
  const line = lines[view.panelCursor];
  if (line === 'source') {
    return input === ' ' || key.return === true || key.leftArrow === true || key.rightArrow === true
      ? { type: 'toggle-source' }
      : { type: 'ignore' };
  }
  if (line === 'edt') {
    if (key.return === true) {
      return { type: 'edit-edt', initial: '' };
    }
    return isPrintable(input, key) ? { type: 'edit-edt', initial: input } : { type: 'ignore' };
  }
  if (line !== undefined && (input === ' ' || key.return === true)) {
    return { type: 'toggle-global', line };
  }
  return { type: 'ignore' };
}

// Resolves a committed EDT field: empty goes back to "no EDT chosen", a known topic is
// returned for the store to resolve, anything else is refused with a message.
export function checkEdtChoice(
  value: string,
  edts: readonly { ulid: string; topic: string }[],
): { type: 'none' } | { type: 'chosen'; ulid: string } | { type: 'invalid'; message: string } {
  const message = validateSuggestValue(
    value,
    edts.map((edt) => edt.topic),
    'EDT',
  );
  if (message !== null) {
    return { type: 'invalid', message };
  }
  const found = edts.find((edt) => edt.topic === value.trim());
  return found === undefined ? { type: 'none' } : { type: 'chosen', ulid: found.ulid };
}

// Height budget (NFR-7): the modal shares the terminal with its chrome, so every block gets a
// fixed line count and the table takes what is left, shrinking before anything can overflow.
export const CONFIG_CHROME_ROWS = 10; // modal border + padding + title (6) plus the zone title and app chrome (4)
export const CONFIG_MIN_ROWS = 22;
// Fixed height of the service box: border 2, title 1, branch 1, toggles 2, apply 1, error 1, footer 2.
export const SERVICE_BOX_ROWS = 10;
const FIXED_BODY_ROWS = 1 + 1 + 1 + 1 + 2; // panel A title, panel B title, table header, error line, hints

export interface ConfigBudget {
  tooSmall: boolean;
  tableRows: number;
  // List lines under the EDT field (panel A) while it is being edited.
  dropdownLines: number;
  // List lines under the branch field of the service box (which replaces the panels).
  boxDropdownLines: number;
}

export function computeConfigBudget(
  windowRows: number,
  draft: UpdateConfigDraft,
  edtEditing: boolean,
  dropdownMax: number,
  boxOpen = false,
): ConfigBudget {
  const available = windowRows - CONFIG_CHROME_ROWS - FIXED_BODY_ROWS - globalLines(draft).length;
  // The EDT list may take lines from the table but always leaves it at least three rows
  // (a header-less minimum that keeps the cursor row and one neighbor visible).
  const dropdownLines = edtEditing ? Math.max(0, Math.min(dropdownMax, available - 3)) : 0;
  const tableRows = available - dropdownLines;
  // The box replaces the panels: its fixed height is SERVICE_BOX_BOX_ROWS (9), the rest is list.
  const boxDropdownLines = Math.max(0, Math.min(dropdownMax, windowRows - CONFIG_CHROME_ROWS - SERVICE_BOX_ROWS));
  // The service box replaces the table, so a short table budget alone must not hide it.
  return { tooSmall: windowRows < CONFIG_MIN_ROWS || (!boxOpen && tableRows < 3), tableRows: Math.max(tableRows, 0), dropdownLines, boxDropdownLines };
}
