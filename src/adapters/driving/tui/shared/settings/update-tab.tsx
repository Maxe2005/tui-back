// tui/shared/settings/update-tab: props-only view of the Update tab's rows. State and key handling stay in settings-screen; this file only renders.
import { Box, Text } from 'ink';
import { CheckboxListItem } from '../components/checkbox-list-item.js';
import { DimAnnotation } from '../components/feedback/dim-annotation.js';
import { colors } from '../theme/theme.js';
import { UPDATE_SETTINGS_ROWS, UPDATE_SETTINGS_ROW_HINTS } from './update.logic.js';
import type { Settings } from '../../../../../core/ports/settings.js';

export type UpdateTabProps = {
  settings: Settings;
  cursor: number;
};

export function UpdateTab({ settings, cursor }: UpdateTabProps) {
  return (
    <Box flexDirection="column">
      {UPDATE_SETTINGS_ROWS.map((row, index) => {
        const highlighted = index === cursor;
        const cursorGlyph = <Text color={colors.accent} wrap="truncate-end">{highlighted ? '›' : ' '}</Text>;
        if (row === 'concurrency') {
          return (
            <Box key={row} flexDirection="row">
              {cursorGlyph}
              <Text color={highlighted ? colors.accent : colors.text} wrap="truncate-end">
                Update concurrency: <Text color={colors.accent}>{settings.update.concurrency}</Text>
              </Text>
            </Box>
          );
        }
        if (row === 'merge-source') {
          return (
            <Box key={row} flexDirection="row">
              {cursorGlyph}
              <Text color={highlighted ? colors.accent : colors.text} wrap="truncate-end">
                Merge source:{' '}
                <Text color={colors.accent}>{settings.update.mergeSource === 'shared' ? 'Shared branch' : 'From EDT (pick at run time)'}</Text>
              </Text>
            </Box>
          );
        }
        return (
          <Box key={row} flexDirection="row">
            {cursorGlyph}
            <CheckboxListItem
              label={row === 'run-migrations' ? 'Run migrations' : 'Clean restart'}
              selected={highlighted}
              state={(row === 'run-migrations' ? settings.update.runMigrations : settings.update.cleanRestart) ? 'checked' : 'unchecked'}
            />
          </Box>
        );
      })}
      <DimAnnotation text={UPDATE_SETTINGS_ROW_HINTS[UPDATE_SETTINGS_ROWS[cursor] ?? 'concurrency']} />
    </Box>
  );
}
