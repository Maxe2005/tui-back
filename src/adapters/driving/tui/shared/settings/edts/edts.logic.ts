// tui/shared/settings/edts.logic: the EDTs tab's hideable hints/action types, branch-dropdown rows helpers, group list and restart/scope labels. Pure; no Ink/React.
import { formatHint } from '../../components/dialogs/hints.js';
import {
  MAX_EDTS_BRANCH_DROPDOWN_MAX_ROWS,
  MIN_EDTS_BRANCH_DROPDOWN_MAX_ROWS,
  cycleRealignScope,
  cycleSwitchRestartMode,
  type RealignScope,
  type SwitchRestartMode,
} from '../../../../../../core/ports/settings.js';

// EDTs tab: the hideable per-context action hints (formatAvailableActionsHint's contexts).
export type HideableActionHint = { id: string; label: string };

export const HIDEABLE_ACTION_HINTS: readonly HideableActionHint[] = [
  { id: 'edts', label: `EDT selector — "${formatHint(['Enter', 'Switch'])}" / "${formatHint(['Enter', 'Modify'])}"` },
  { id: 'edt-services', label: `EDT services — "${formatHint(['Enter', 'Remove / Change branch'])}"` },
  { id: 'other-services', label: `Other services — "${formatHint(['Enter', 'Add to EDT'])}"` },
];

// Toggles `id` in `hidden`, never mutating the input array (Settings.edts.hiddenActionHints and
// hiddenActionTypes are each a string[], not a Set). Shared by both EDTs checkbox groups.
export function toggleHiddenHint(hidden: readonly string[], id: string): string[] {
  return hidden.includes(id) ? hidden.filter((existing) => existing !== id) : [...hidden, id];
}

// The "Recent action types" group's rows — the literal `EdtActionLogEntry['actionType']`
// domain, closed and hardcoded, never derived from `edtActionLog` at runtime (an EDT with no
// `modify` entries yet must still offer to hide `modify`).
export type HideableActionType = { id: string; label: string };

export const HIDEABLE_ACTION_TYPES: readonly HideableActionType[] = [
  { id: 'create', label: 'Create' },
  { id: 'switch', label: 'Switch' },
  { id: 'modify', label: 'Modify' },
];

// The EDTs tab's group-list level, ahead of its two checkbox lists (one flat list would
// conflate two unrelated toggles).
//
// Branch autocomplete dropdown rows (shared BranchAutocompleteInput): the visible row count
// before the `… N more` overflow line, with the gridMaxRows clamp/adjust/parse-digit idiom
// (bounds from core's MIN/MAX_EDTS_BRANCH_DROPDOWN_MAX_ROWS, shared with the schema).
export { MIN_EDTS_BRANCH_DROPDOWN_MAX_ROWS, MAX_EDTS_BRANCH_DROPDOWN_MAX_ROWS };

export function clampBranchDropdownMaxRows(value: number): number {
  return Math.min(Math.max(value, MIN_EDTS_BRANCH_DROPDOWN_MAX_ROWS), MAX_EDTS_BRANCH_DROPDOWN_MAX_ROWS);
}

export function adjustBranchDropdownMaxRows(current: number, direction: 'up' | 'down'): number {
  return clampBranchDropdownMaxRows(current + (direction === 'up' ? 1 : -1));
}

// A typed digit sets the value directly (same value-set convention as parseGridMaxRowsDigit:
// single digit 1-9 only; '0' is never valid and non-digits are ignored rather than appended).
export function parseBranchDropdownMaxRowsDigit(input: string): number | null {
  if (!/^[1-9]$/.test(input)) {
    return null;
  }
  return clampBranchDropdownMaxRows(Number(input));
}

export type SettingsGroupId =
  | 'hint-visibility'
  | 'action-types'
  | 'branch-dropdown-rows'
  | 'switch-restart'
  | 'realign-scope'
  | 'realign-restart'
  | 'heal-restart';

export type SettingsGroup = { id: SettingsGroupId; label: string };

export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  { id: 'hint-visibility', label: 'Hint visibility' },
  { id: 'action-types', label: 'Recent action types' },
  { id: 'branch-dropdown-rows', label: 'Branch dropdown rows' },
  { id: 'switch-restart', label: 'Post-switch restart' },
  { id: 'realign-scope', label: 'Realign default scope' },
  { id: 'realign-restart', label: 'Post-realign restart' },
  { id: 'heal-restart', label: 'Heal restart mode' },
];

// The group list's trailing row: a single boolean toggled directly with Space (no drill-in),
// `edts.sharedBranchesEdtEnabled`. Its row index follows the last group.
export const SHARED_EDT_TOGGLE_LABEL = 'Show the shared-branches EDT';
export const SHARED_EDT_TOGGLE_NOTE = 'Adds the system "Shared branches" EDT (every service on its shared branch) to the EDTs zone, quick-pick and `edt switch`.';

// Number of rows of the EDTs tab's top-level list: the groups plus the toggle row.
export const EDTS_TOP_LEVEL_ROW_COUNT = SETTINGS_GROUPS.length + 1;

export function isSharedEdtToggleRow(cursor: number): boolean {
  return cursor === SETTINGS_GROUPS.length;
}

export const SWITCH_RESTART_LABELS: Record<SwitchRestartMode, string> = { none: 'None', simple: 'Simple restart', clean: 'Clean restart' };

// Left/Right/Space cycle none → simple → clean (Left goes back).
export { cycleSwitchRestartMode };

export const REALIGN_SCOPE_LABELS: Record<RealignScope, string> = { none: 'None', edt: 'EDT services', all: 'All' };

export { cycleRealignScope };
