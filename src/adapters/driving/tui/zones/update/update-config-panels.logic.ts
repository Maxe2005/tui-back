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
import type { FooterContextId } from '../../keybindings/index.js';
import type { TextEditKey } from '../../shared/components/text-edit.js';
import { resolveFocusStep } from '../../shared/keys/focus-navigation.js';
import { nextCursorForKey } from '../../shared/keys/list-cursor.js';
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

// `custom` as soon as the row departs from the global parameters in any way.
export function rowMode(row: UpdateConfigRow): 'global' | 'custom' {
  return row.origin === 'manual' || row.migrations !== 'follow' || row.cleanRestart !== 'follow' ? 'custom' : 'global';
}

export type GlobalLine = 'source' | 'edt' | 'migrations' | 'cleanRestart' | 'start';

export function globalLines(draft: UpdateConfigDraft): GlobalLine[] {
  if (draft.layout !== 'edt-panels') {
    return ['migrations', 'cleanRestart', 'start'];
  }
  return draft.strategy.kind === 'shared'
    ? ['source', 'migrations', 'cleanRestart', 'start']
    : ['source', 'edt', 'migrations', 'cleanRestart', 'start'];
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

// The footer context of the screen layer that owns the keyboard: a branch/EDT field being edited,
// the per-service box, or the global panel / services table.
export function updateConfigFooterContext(view: Pick<PanelsViewState, 'focus' | 'edtField'>, box: { editing: boolean } | null): FooterContextId {
  if (box !== null) {
    return box.editing ? 'branch-input' : 'update-box';
  }
  if (view.edtField !== null) {
    return 'branch-input';
  }
  return view.focus === 'panel' ? 'update-config-global' : 'update-config-table';
}

export type PanelsKey = TextEditKey & {
  upArrow?: boolean;
  downArrow?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
  home?: boolean;
  end?: boolean;
};

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
  const cursorKey = {
    upArrow: key.upArrow === true,
    downArrow: key.downArrow === true,
    home: key.home === true,
    end: key.end === true,
  };
  if (view.focus === 'table') {
    const cursor = nextCursorForKey(cursorKey, view.tableCursor, draft.rows.length);
    if (cursor !== null) {
      return { type: 'move-table', cursor };
    }
    if (input === ' ') {
      return { type: 'toggle-row' };
    }
    return key.return === true && draft.rows[view.tableCursor] !== undefined ? { type: 'open-box' } : { type: 'ignore' };
  }
  const lines = globalLines(draft);
  const panelCursor = nextCursorForKey(cursorKey, view.panelCursor, lines.length);
  if (panelCursor !== null) {
    return { type: 'move-panel', cursor: panelCursor };
  }
  const line = lines[view.panelCursor];
  if (line === 'source') {
    return input === ' ' || key.leftArrow === true || key.rightArrow === true ? { type: 'toggle-source' } : { type: 'ignore' };
  }
  if (line === 'edt') {
    if (key.return === true) {
      return { type: 'edit-edt', initial: '' };
    }
    return isPrintable(input, key) ? { type: 'edit-edt', initial: input } : { type: 'ignore' };
  }
  if (line === 'start') {
    return key.return === true ? { type: 'confirm' } : { type: 'ignore' };
  }
  if (line !== undefined && input === ' ') {
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
export const CONFIG_MIN_ROWS = 21;
// A one-service screen needs one table row, so it fits wherever the service box does.
export const CONFIG_SERVICE_MIN_ROWS = 18;
// Fixed height of the service box: border 2, title 1, branch 1, toggles 2, apply 1, error 1.
export const SERVICE_BOX_ROWS = 8;
const FIXED_BODY_ROWS = 1 + 1 + 1 + 1; // panel A title, panel B title, table header, error line

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
  const minRows = draft.layout === 'service-panels' ? CONFIG_SERVICE_MIN_ROWS : CONFIG_MIN_ROWS;
  const neededTableRows = Math.min(3, Math.max(draft.rows.length, 1));
  return { tooSmall: windowRows < minRows || (!boxOpen && tableRows < neededTableRows), tableRows: Math.max(tableRows, 0), dropdownLines, boxDropdownLines };
}
