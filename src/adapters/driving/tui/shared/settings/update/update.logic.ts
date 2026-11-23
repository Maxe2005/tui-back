// tui/shared/settings/update.logic: the Update tab's rows, hints, concurrency clamp/adjust/parse and key mapping. Pure; no Ink/React.
import type { TextEditKey } from '../../components/inputs/text-edit.js';
import { nextCursorForKey } from '../../keys/list-cursor.js';
import { MAX_UPDATE_CONCURRENCY, MIN_UPDATE_CONCURRENCY, type Settings, type UpdateMergeSourceDefault } from '../../../../../../core/ports/settings.js';

// Update tab: the group-update defaults — concurrency (moved here from General), and the three
// global defaults the 3.7 config screen and the CLI start from. A flat Up/Down row list; edits
// persist immediately. Per-run changes in the config screen are never written back here.
export type UpdateSettingsRowId = 'concurrency' | 'run-migrations' | 'clean-restart' | 'merge-source';

export const UPDATE_SETTINGS_ROWS: readonly UpdateSettingsRowId[] = ['concurrency', 'run-migrations', 'clean-restart', 'merge-source'];

export const UPDATE_SETTINGS_ROW_HINTS: Record<UpdateSettingsRowId, string> = {
  concurrency: 'Services a group update processes at once (+/- or a digit). 1 = one after the other.',
  'run-migrations': 'Whether a group update runs migrations by default (config screen and CLI); a per-run change is never saved here.',
  'clean-restart': 'Whether a group update does a clean restart by default (config screen and CLI); a per-run change is never saved here.',
  'merge-source': 'Space toggles. From EDT applies to the EDT-scoped config screen only (the all-repos and single-service screens have no merge-source line).',
};

// update.concurrency: how many services a group update processes at once. `+`/`-` step it, a typed
// digit sets it; the schema enforces the same [MIN, MAX] bound.
export function clampUpdateConcurrency(value: number): number {
  return Math.min(Math.max(value, MIN_UPDATE_CONCURRENCY), MAX_UPDATE_CONCURRENCY);
}

export function adjustUpdateConcurrency(current: number, direction: 'up' | 'down'): number {
  return clampUpdateConcurrency(current + (direction === 'up' ? 1 : -1));
}

export function parseUpdateConcurrencyDigit(input: string): number | null {
  return /^[1-9]$/.test(input) ? clampUpdateConcurrency(Number(input)) : null;
}

export type UpdateSettingsStep =
  | { type: 'move'; cursor: number }
  | { type: 'set-concurrency'; value: number }
  | { type: 'toggle-run-migrations' }
  | { type: 'toggle-clean-restart' }
  | { type: 'set-merge-source'; value: UpdateMergeSourceDefault }
  | { type: 'ignore' };

export function nextMergeSourceDefault(current: UpdateMergeSourceDefault): UpdateMergeSourceDefault {
  return current === 'shared' ? 'edt-pending' : 'shared';
}

export function resolveUpdateSettingsKey(
  input: string,
  key: TextEditKey,
  cursor: number,
  update: Settings['update'],
): UpdateSettingsStep {
  const moved = nextCursorForKey(key, cursor, UPDATE_SETTINGS_ROWS.length);
  if (moved !== null) {
    return { type: 'move', cursor: moved };
  }
  const row = UPDATE_SETTINGS_ROWS[cursor];
  if (row === 'concurrency') {
    if (input === '+') {
      return { type: 'set-concurrency', value: adjustUpdateConcurrency(update.concurrency, 'up') };
    }
    if (input === '-') {
      return { type: 'set-concurrency', value: adjustUpdateConcurrency(update.concurrency, 'down') };
    }
    const digit = parseUpdateConcurrencyDigit(input);
    return digit !== null ? { type: 'set-concurrency', value: digit } : { type: 'ignore' };
  }
  if (row === 'run-migrations' && input === ' ') {
    return { type: 'toggle-run-migrations' };
  }
  if (row === 'clean-restart' && input === ' ') {
    return { type: 'toggle-clean-restart' };
  }
  if (row === 'merge-source' && (input === ' ' || key.return)) {
    return { type: 'set-merge-source', value: nextMergeSourceDefault(update.mergeSource) };
  }
  return { type: 'ignore' };
}
