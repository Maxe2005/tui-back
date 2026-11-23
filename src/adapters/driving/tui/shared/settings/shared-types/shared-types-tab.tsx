// tui/shared/settings/shared-types/shared-types-tab: props-only view of the st tab's checkbox and number rows. State and key handling stay in settings-screen; this file only renders.
import { Box, Text } from 'ink';
import { CheckboxListItem } from '../../components/pickers/checkbox-list-item.js';
import { DimAnnotation } from '../../components/feedback/dim-annotation.js';
import { colors } from '../../theme/theme.js';
import { SHARED_TYPES_SETTINGS_ROWS } from './shared-types.logic.js';
import type { Settings } from '../../../../../../core/ports/storage/settings.js';

export type SharedTypesTabProps = {
  settings: Settings;
  cursor: number;
};

export function SharedTypesTab({ settings, cursor }: SharedTypesTabProps) {
  return (
    <Box flexDirection="column">
      {SHARED_TYPES_SETTINGS_ROWS.map((row, index) => (
        <Box key={row.id} flexDirection="row">
          <Text color={colors.accent} wrap="truncate-end">{index === cursor ? '›' : ' '}</Text>
          {row.kind === 'checkbox' ? (
            <CheckboxListItem label={row.label} selected={index === cursor} state={settings.sharedTypes[row.id] ? 'checked' : 'unchecked'} />
          ) : (
            <Text color={index === cursor ? colors.accent : colors.text} wrap="truncate-end">
              {row.label}: <Text color={colors.accent}>{settings.sharedTypes[row.id]}</Text>
            </Text>
          )}
        </Box>
      ))}
      {(() => {
        const focused = SHARED_TYPES_SETTINGS_ROWS[cursor];
        return focused?.kind === 'number' ? <DimAnnotation text={focused.hint} /> : null;
      })()}
    </Box>
  );
}
