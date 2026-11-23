// tui/shared/settings/palette.logic: the Command Palette tab's grid-rows and filter-history clamp/adjust/parse helpers plus its group list. Pure; no Ink/React.
import {
  MAX_FILTER_HISTORY_GRID_MAX_ROWS,
  MAX_GRID_MAX_ROWS,
  MAX_INPUT_HISTORY_SIZE,
  MIN_FILTER_HISTORY_GRID_MAX_ROWS,
  MIN_GRID_MAX_ROWS,
  MIN_INPUT_HISTORY_SIZE,
} from '../../../../../../core/ports/storage/settings.js';

// Command Palette tab: the grid rows per column. Clamped to a sane, always-positive range —
// 0/negative would break groupCommandsByColumn's `Math.max(1, maxRows)` floor, and the zod
// schema enforces the same [MIN, MAX] bound (core/ports/storage/settings.ts holds both). Re-exported
// here for existing importers.
export { MIN_GRID_MAX_ROWS, MAX_GRID_MAX_ROWS };

export function clampGridMaxRows(value: number): number {
  return Math.min(Math.max(value, MIN_GRID_MAX_ROWS), MAX_GRID_MAX_ROWS);
}

export function adjustGridMaxRows(current: number, direction: 'up' | 'down'): number {
  return clampGridMaxRows(current + (direction === 'up' ? 1 : -1));
}

// A typed digit sets the value directly. Only a single digit 1-9 is meaningful — '0' is never a
// valid gridMaxRows (zod's `.positive()`), and any non-digit is ignored rather than appended
// (this is a value-set field, not free text).
export function parseGridMaxRowsDigit(input: string): number | null {
  if (!/^[1-9]$/.test(input)) {
    return null;
  }
  return clampGridMaxRows(Number(input));
}

// Logs tab: settings.logs.filterHistorySize/filterHistoryGridMaxRows, same clamp/adjust idiom
// as bufferSize (logs.logic.ts) and gridMaxRows (above). filterHistorySize has no digit preset —
// Left/Right is its only adjustment.
export const FILTER_HISTORY_SIZE_STEP = 5;
export { MIN_INPUT_HISTORY_SIZE as MIN_FILTER_HISTORY_SIZE, MAX_INPUT_HISTORY_SIZE as MAX_FILTER_HISTORY_SIZE };

export function clampFilterHistorySize(value: number): number {
  return Math.min(Math.max(value, MIN_INPUT_HISTORY_SIZE), MAX_INPUT_HISTORY_SIZE);
}

export function adjustFilterHistorySize(current: number, direction: 'up' | 'down'): number {
  return clampFilterHistorySize(current + (direction === 'up' ? FILTER_HISTORY_SIZE_STEP : -FILTER_HISTORY_SIZE_STEP));
}

// filterHistoryGridMaxRows mirrors gridMaxRows' [1, 99] range and digit-preset convention, but
// through its own constants (the two settings are independent).
export { MIN_FILTER_HISTORY_GRID_MAX_ROWS, MAX_FILTER_HISTORY_GRID_MAX_ROWS };

export function clampFilterHistoryGridMaxRows(value: number): number {
  return Math.min(Math.max(value, MIN_FILTER_HISTORY_GRID_MAX_ROWS), MAX_FILTER_HISTORY_GRID_MAX_ROWS);
}

export function adjustFilterHistoryGridMaxRows(current: number, direction: 'up' | 'down'): number {
  return clampFilterHistoryGridMaxRows(current + (direction === 'up' ? 1 : -1));
}

export function parseFilterHistoryGridMaxRowsDigit(input: string): number | null {
  if (!/^[1-9]$/.test(input)) {
    return null;
  }
  return clampFilterHistoryGridMaxRows(Number(input));
}

// The Command Palette tab's group list, same two-level shape as the Logs tab: the grid height
// plus the command-history controls (size, dedup, clear), one group each.
export type PaletteSettingsGroupId = 'grid-max-rows' | 'history-size' | 'history-dedup' | 'clear-history';

export type PaletteSettingsGroup = { id: PaletteSettingsGroupId; label: string };

export const PALETTE_SETTINGS_GROUPS: readonly PaletteSettingsGroup[] = [
  { id: 'grid-max-rows', label: 'Command grid max rows' },
  { id: 'history-size', label: 'Command history size' },
  { id: 'history-dedup', label: 'Deduplicate command history' },
  { id: 'clear-history', label: 'Clear command history' },
];
