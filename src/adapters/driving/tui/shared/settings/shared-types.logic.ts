// tui/shared/settings/shared-types.logic: the st tab's row list, number clamping and key mapping. Pure; no Ink/React.
import type { TextEditKey } from '../components/text-edit.js';
import { nextCursorForKey } from '../keys/list-cursor.js';
import { MAX_HISTORY_DEPTH, MAX_MAX_COMMITS_SCANNED, MIN_HISTORY_DEPTH, MIN_MAX_COMMITS_SCANNED } from '../../../../../core/ports/settings.js';

// st tab: a flat Up/Down list of the shared-types zone's option defaults (Space toggles the
// checkboxes) followed by the History view's two numeric bounds (+/- step them, always clamped to
// the schema's range).
export type SharedTypesCheckboxRowId = 'install' | 'cleanRestart' | 'commit';
export type SharedTypesNumberRowId = 'historyDepth' | 'maxCommitsScanned';
export type SharedTypesSettingsRowId = SharedTypesCheckboxRowId | SharedTypesNumberRowId;

export const SHARED_TYPES_SETTINGS_ROWS: readonly (
  | { id: SharedTypesCheckboxRowId; label: string; kind: 'checkbox' }
  | { id: SharedTypesNumberRowId; label: string; kind: 'number'; min: number; max: number; step: number; hint: string }
)[] = [
  { id: 'install', label: 'Run npm i', kind: 'checkbox' },
  { id: 'cleanRestart', label: 'Clean restart', kind: 'checkbox' },
  { id: 'commit', label: 'Commit package.json + package-lock.json', kind: 'checkbox' },
  { id: 'historyDepth', label: 'History depth', kind: 'number', min: MIN_HISTORY_DEPTH, max: MAX_HISTORY_DEPTH, step: 1, hint: 'Version bumps a by-branch History search lists at most (+/-).' },
  { id: 'maxCommitsScanned', label: 'History max commits scanned', kind: 'number', min: MIN_MAX_COMMITS_SCANNED, max: MAX_MAX_COMMITS_SCANNED, step: 100, hint: 'Commits touching package.json a by-branch History search scans at most (+/-).' },
];

export type SharedTypesSettingsStep =
  | { type: 'move'; cursor: number }
  | { type: 'toggle'; id: SharedTypesCheckboxRowId }
  | { type: 'set-number'; id: SharedTypesNumberRowId; value: number }
  | { type: 'ignore' };

export function clampSharedTypesNumber(id: SharedTypesNumberRowId, value: number): number {
  const row = SHARED_TYPES_SETTINGS_ROWS.find((candidate) => candidate.id === id);
  return row?.kind === 'number' ? Math.min(Math.max(value, row.min), row.max) : value;
}

export function resolveSharedTypesSettingsKey(
  input: string,
  key: TextEditKey,
  cursor: number,
  current: { historyDepth: number; maxCommitsScanned: number },
): SharedTypesSettingsStep {
  const moved = nextCursorForKey(key, cursor, SHARED_TYPES_SETTINGS_ROWS.length);
  if (moved !== null) {
    return { type: 'move', cursor: moved };
  }
  const row = SHARED_TYPES_SETTINGS_ROWS[cursor];
  if (row === undefined) {
    return { type: 'ignore' };
  }
  if (row.kind === 'checkbox') {
    return input === ' ' ? { type: 'toggle', id: row.id } : { type: 'ignore' };
  }
  const value = current[row.id];
  if (input === '+') {
    return { type: 'set-number', id: row.id, value: clampSharedTypesNumber(row.id, value + row.step) };
  }
  if (input === '-') {
    return { type: 'set-number', id: row.id, value: clampSharedTypesNumber(row.id, value - row.step) };
  }
  return { type: 'ignore' };
}
