// tui/shared/settings/general/general-tab: props-only view of the General tab's rows (quit shortcut, editor command). State and key handling stay in settings-screen; this file only renders.
import { Box, Text } from 'ink';
import { CheckboxListItem } from '../../components/pickers/checkbox-list-item.js';
import { DimAnnotation } from '../../components/feedback/dim-annotation.js';
import { TextInputLine } from '../../components/inputs/text-input-line.js';
import { colors } from '../../theme/theme.js';
import type { TextInputState } from '../../components/inputs/text-edit.js';
import { EDITOR_COMMAND_PLACEHOLDER_TEXT, GENERAL_SETTINGS_ROWS } from './general.logic.js';
import type { Settings } from '../../../../../../core/ports/storage/settings.js';

export type GeneralTabProps = {
  settings: Settings;
  cursor: number;
  editing: TextInputState | null;
};

export function GeneralTab({ settings, cursor, editing }: GeneralTabProps) {
  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Text color={colors.accent} wrap="truncate-end">{GENERAL_SETTINGS_ROWS[cursor] === 'quit-shortcut' ? '›' : ' '}</Text>
        <CheckboxListItem
          label="Enable 'q' to quit"
          selected={GENERAL_SETTINGS_ROWS[cursor] === 'quit-shortcut'}
          state={settings.general.quitShortcutEnabled ? 'checked' : 'unchecked'}
        />
      </Box>
      <Box flexDirection="row">
        <Text color={colors.accent} wrap="truncate-end">{GENERAL_SETTINGS_ROWS[cursor] === 'editor-command' ? '›' : ' '}</Text>
        {editing !== null ? (
          <TextInputLine label="Editor command" value={editing.value} cursor={editing.cursor} focused />
        ) : (
          <Text color={GENERAL_SETTINGS_ROWS[cursor] === 'editor-command' ? colors.accent : colors.text} wrap="truncate-end">
            Editor command:{' '}
            {settings.general.editorCommand !== '' ? (
              <Text color={colors.accent}>{settings.general.editorCommand}</Text>
            ) : (
              <Text color={colors['text-dim']} wrap="truncate-end">{EDITOR_COMMAND_PLACEHOLDER_TEXT}</Text>
            )}
          </Text>
        )}
      </Box>
      {GENERAL_SETTINGS_ROWS[cursor] === 'quit-shortcut' ? (
        <DimAnnotation text="Unchecked: 'q' types as a normal character; quit is still reachable via the :quit command." />
      ) : editing !== null ? (
        <DimAnnotation text="<repo> is replaced by the repo path (appended when absent), e.g. code <repo>. Empty: $EDITOR, else vi." />
      ) : (
        <DimAnnotation text="Run by the Update zone's “Open in editor” choice on a blocked repo, e.g. code <repo>." />
      )}
    </Box>
  );
}
