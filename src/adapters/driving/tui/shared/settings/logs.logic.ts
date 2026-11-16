// tui/shared/settings/logs.logic: the Logs tab's buffer-size helpers, group list and clear/rules row models. Pure; no Ink/React.
import { MAX_LOG_BUFFER_SIZE, MIN_LOG_BUFFER_SIZE } from '../../../../../core/ports/settings.js';

// Logs tab: settings.logs.bufferSize, with the Command Palette tab's clamp/adjust/parse-digit
// idiom rescaled to its wider range (50-5000 vs. 1-99): Up/Down steps by LOG_BUFFER_SIZE_STEP,
// and a typed digit 1-9 is a quick preset (digit x 100, e.g. '5' -> 500) since the literal
// digit is never a meaningful buffer size.
export const LOG_BUFFER_SIZE_STEP = 50;
export { MIN_LOG_BUFFER_SIZE, MAX_LOG_BUFFER_SIZE };

export function clampLogBufferSize(value: number): number {
  return Math.min(Math.max(value, MIN_LOG_BUFFER_SIZE), MAX_LOG_BUFFER_SIZE);
}

export function adjustLogBufferSize(current: number, direction: 'up' | 'down'): number {
  return clampLogBufferSize(current + (direction === 'up' ? LOG_BUFFER_SIZE_STEP : -LOG_BUFFER_SIZE_STEP));
}

export function parseLogBufferSizeDigit(input: string): number | null {
  if (!/^[1-9]$/.test(input)) {
    return null;
  }
  return clampLogBufferSize(Number(input) * 100);
}

// The Logs tab's group list: one field (or a small related cluster) per group, so no screen
// renders more than a handful of lines. ModalDialog has no height cap, and a flat list of every
// field overflowed short terminals — Ink's diff-render then corrupted the border and title.
// Five groups: four single-field ones plus "Clear history" holding both clear actions.
export type LogsSettingsGroupId =
  | 'buffer-size'
  | 'start-with-history'
  | 'filter-history-size'
  | 'filter-history-grid'
  | 'filter-history-dedup'
  | 'restart-mode'
  | 'clear-history'
  | 'filter-rules';

export type LogsSettingsGroup = { id: LogsSettingsGroupId; label: string };

export const LOGS_SETTINGS_GROUPS: readonly LogsSettingsGroup[] = [
  { id: 'buffer-size', label: 'Buffer size' },
  { id: 'start-with-history', label: 'Start with history' },
  { id: 'filter-history-size', label: 'Filter history size' },
  { id: 'filter-history-grid', label: 'Filter history grid' },
  { id: 'filter-history-dedup', label: 'Filter history dedup' },
  { id: 'restart-mode', label: 'Restart mode' },
  { id: 'clear-history', label: 'Clear history' },
  { id: 'filter-rules', label: 'Persisted filter rules' },
];

// "Clear history" is the one Logs group holding more than a single field — its own small
// Up/Down row list, one level below the group list, mirroring the EDTs tab's own two-level
// depth (group list -> checkbox list) rather than growing a third top-level list.
export type LogsClearRowId = 'clear-global' | 'clear-service';

export const LOGS_CLEAR_ROWS: readonly LogsClearRowId[] = ['clear-global', 'clear-service'];

export const LOGS_CLEAR_ROW_LABELS: Record<LogsClearRowId, string> = {
  'clear-global': 'Clear global filter history',
  'clear-service': "Clear a service's filter history",
};

// "Persisted filter rules" holds two separate, confirmed actions: clearing one scope's persisted
// rule list (a scope picker one level below) and deleting the whole named-set library.
export type LogsRulesRowId = 'clear-scope' | 'delete-library';

export const LOGS_RULES_ROWS: readonly LogsRulesRowId[] = ['clear-scope', 'delete-library'];

export const LOGS_RULES_ROW_LABELS: Record<LogsRulesRowId, string> = {
  'clear-scope': "Clear one scope's persisted rules",
  'delete-library': 'Delete the whole rule-set library',
};

// What a pending confirmation will do once accepted.
export type LogsRulesConfirm = { kind: 'scope'; key: string; label: string } | { kind: 'library' };
