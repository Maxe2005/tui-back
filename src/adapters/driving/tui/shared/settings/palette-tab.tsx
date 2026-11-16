// tui/shared/settings/palette-tab: props-only view of the Command Palette tab (group list and the drilled-in group). State and key handling stay in settings-screen; this file only renders.
import { Box, Text } from 'ink';
import { CheckboxListItem } from '../components/checkbox-list-item.js';
import { DimAnnotation } from '../components/dim-annotation.js';
import { colors } from '../theme/theme.js';
import { FILTER_HISTORY_SIZE_STEP, PALETTE_SETTINGS_GROUPS, type PaletteSettingsGroupId } from './palette.logic.js';
import type { Settings } from '../../../../../core/ports/settings.js';

export type PaletteTabProps = {
  settings: Settings;
  paletteGroup: PaletteSettingsGroupId | null;
  paletteGroupCursor: number;
};

export function PaletteTab({ settings, paletteGroup, paletteGroupCursor }: PaletteTabProps) {
  return (
    <>
      {paletteGroup === null ? (
        <Box flexDirection="column">
          {PALETTE_SETTINGS_GROUPS.map((group, index) => {
            const highlighted = index === paletteGroupCursor;
            return (
              <Box key={group.id} flexDirection="row">
                <Text color={colors.accent} wrap="truncate-end">{highlighted ? '›' : ' '}</Text>
                <Text color={highlighted ? colors.accent : colors.text} wrap="truncate-end">{group.label}</Text>
              </Box>
            );
          })}
        </Box>
      ) : null}

      {paletteGroup === 'grid-max-rows' ? (
        <Box flexDirection="column">
          <Text color={colors.text} wrap="truncate-end">
            Command grid max rows: <Text color={colors.accent}>{settings.commandPalette.gridMaxRows}</Text>
          </Text>
          <DimAnnotation text="Rows of the command grid before it scrolls." />
        </Box>
      ) : null}

      {paletteGroup === 'history-size' ? (
        <Box flexDirection="column">
          <Text color={colors.text} wrap="truncate-end">
            Command history size: <Text color={colors.accent}>{settings.commandPalette.historySize}</Text>
          </Text>
          <DimAnnotation text={`Steps of ${FILTER_HISTORY_SIZE_STEP} entries.`} />
        </Box>
      ) : null}

      {paletteGroup === 'history-dedup' ? (
        <Box flexDirection="column">
          <CheckboxListItem
            label="Deduplicate command history"
            state={settings.commandPalette.historyDedup ? 'checked' : 'unchecked'}
          />
          <DimAnnotation text="On: a repeated command moves to the front. Off: only a repeat of the latest is merged." />
        </Box>
      ) : null}

      {paletteGroup === 'clear-history' ? (
        <Box flexDirection="column">
          <Text color={colors.text} wrap="truncate-end">Clear the command history</Text>
          <DimAnnotation text="Empties the `:` bar's recall list; the filter histories are untouched." />
        </Box>
      ) : null}
    </>
  );
}
