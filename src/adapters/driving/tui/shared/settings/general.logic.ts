// tui/shared/settings/general.logic: the General tab's rows and its whole key mapping as one pure step. Pure; no Ink/React.
import { nextTextInputValue, type TextEditKey, type TextInputState } from '../components/text-edit.js';
import { nextCursorForKey } from '../keys/list-cursor.js';

// General tab: a small Up/Down row list — the quit-shortcut checkbox (Space toggles; the cursor
// starts on it) and the editor command, a free-text field (Enter opens it for editing, Enter
// again commits, Esc cancels the edit).
export type GeneralSettingsRowId = 'quit-shortcut' | 'editor-command';

export const GENERAL_SETTINGS_ROWS: readonly GeneralSettingsRowId[] = ['quit-shortcut', 'editor-command'];

export const EDITOR_COMMAND_PLACEHOLDER_TEXT = '(not set — $EDITOR, else vi)';

export type GeneralSettingsView = { cursor: number; editing: TextInputState | null };

export type GeneralSettingsStep =
  | { type: 'move'; cursor: number }
  | { type: 'toggle-quit' }
  | { type: 'begin-edit' }
  | { type: 'edit'; editing: TextInputState }
  | { type: 'commit-edit'; value: string }
  | { type: 'ignore' };

// The General tab's whole key mapping as one pure step (Esc is handled by the screen's own
// tab-aware Esc branch: it cancels an open edit before it closes anything). While the
// editor command is being edited every key belongs to the text field — a typed space or
// `q` is a literal character, never the quit toggle. The committed value is trimmed: a
// blank command means "not set".
export function resolveGeneralSettingsKey(
  input: string,
  key: TextEditKey,
  view: GeneralSettingsView,
): GeneralSettingsStep {
  if (view.editing !== null) {
    if (key.return) {
      return { type: 'commit-edit', value: view.editing.value.trim() };
    }
    return { type: 'edit', editing: nextTextInputValue(view.editing, input, key) };
  }
  const cursor = nextCursorForKey(key, view.cursor, GENERAL_SETTINGS_ROWS.length);
  if (cursor !== null) {
    return { type: 'move', cursor };
  }
  const row = GENERAL_SETTINGS_ROWS[view.cursor];
  if (row === 'quit-shortcut' && input === ' ') {
    return { type: 'toggle-quit' };
  }
  if (row === 'editor-command' && key.return) {
    return { type: 'begin-edit' };
  }
  return { type: 'ignore' };
}
