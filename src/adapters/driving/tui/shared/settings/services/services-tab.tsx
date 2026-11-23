// tui/shared/settings/services/services-tab: props-only view of the Services tab's health-check rows. State and key handling stay in settings-screen; this file only renders.
import { Box, Text } from 'ink';
import { CheckboxListItem } from '../../components/pickers/checkbox-list-item.js';
import { DimAnnotation } from '../../components/feedback/dim-annotation.js';
import { StateLine } from '../../components/feedback/state-line.js';
import { BoundedList } from '../../components/lists/bounded-list.js';
import { colors } from '../../theme/theme.js';
import { type ServicesSettingsRow } from './services.logic.js';
import { SETTINGS_LIST_CHROME_ROWS } from '../settings-tabs.logic.js';
import type { Settings } from '../../../../../../core/ports/settings.js';

export type ServicesTabProps = {
  settings: Settings;
  rows: readonly ServicesSettingsRow[];
  cursor: number;
};

export function ServicesTab({ settings, rows, cursor }: ServicesTabProps) {
  return (
    <Box flexDirection="column">
      {rows.length === 0 ? <StateLine kind="empty" subject="manifest services loaded" /> : null}
      <BoundedList
        items={rows}
        chromeRows={SETTINGS_LIST_CHROME_ROWS}
        cursorIndex={cursor}
        renderItem={(row, index) => {
          const highlighted = index === cursor;
          return (
            <Box key={row.key} flexDirection="row">
              <Text color={colors.accent} wrap="truncate-end">{highlighted ? '›' : ' '}</Text>
              <CheckboxListItem
                label={`${row.service} — health check`}
                selected={highlighted}
                state={settings.services.healthCheckDisabled.includes(row.service) ? 'unchecked' : 'checked'}
                disabled={row.disabledReason !== null}
                {...(row.disabledReason === null ? {} : { disabledReason: row.disabledReason })}
              />
            </Box>
          );
        }}
      />
      <DimAnnotation text="Unchecked: the service's healthUrl is never probed on this machine; its state comes from the container alone." />
    </Box>
  );
}
