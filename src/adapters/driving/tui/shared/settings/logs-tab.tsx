// tui/shared/settings/logs-tab: props-only view of the Logs tab (group list and every drilled-in group, clear lists and the rules confirmation). State and key handling stay in settings-screen; this file only renders.
import { Box, Text } from 'ink';
import { CheckboxListItem } from '../components/checkbox-list-item.js';
import { DimAnnotation } from '../components/feedback/dim-annotation.js';
import { StateLine } from '../components/feedback/state-line.js';
import { BoundedList } from '../components/bounded-list.js';
import { colors } from '../theme/theme.js';
import type { ServiceBranchDivergence } from '../../../../../core/edt/list.js';
import { LOGS_CLEAR_ROWS, LOGS_CLEAR_ROW_LABELS, LOGS_RULES_ROWS, LOGS_RULES_ROW_LABELS, LOGS_SETTINGS_GROUPS, LOG_BUFFER_SIZE_STEP, type LogsRulesConfirm, type LogsSettingsGroupId } from './logs.logic.js';
import { FILTER_HISTORY_SIZE_STEP } from './palette.logic.js';
import { SETTINGS_LIST_CHROME_ROWS } from './settings-tabs.logic.js';
import type { Settings } from '../../../../../core/ports/settings.js';

export type LogsTabProps = {
  settings: Settings;
  logsGroup: LogsSettingsGroupId | null;
  logsGroupCursor: number;
  logsClearRowCursor: number;
  logsClearServiceOpen: boolean;
  logsClearServiceCursor: number;
  logsServices: readonly Pick<ServiceBranchDivergence, 'path' | 'service'>[];
  logsRulesRowCursor: number;
  logsRulesScopeOpen: boolean;
  logsRulesScopes: readonly { key: string; label: string; count: number }[];
  logsRulesScopeIndex: number;
  logsRulesConfirm: LogsRulesConfirm | null;
  logsRuleSetCount: number;
};

export function LogsTab({ settings, logsGroup, logsGroupCursor, logsClearRowCursor, logsClearServiceOpen, logsClearServiceCursor, logsServices, logsRulesRowCursor, logsRulesScopeOpen, logsRulesScopes, logsRulesScopeIndex, logsRulesConfirm, logsRuleSetCount }: LogsTabProps) {
  return (
    <>
      {logsGroup === null ? (
        // The Logs tab's group-list level, mirroring the EDTs tab's group list — every field
        // lives behind its own (or a shared) group, so no single screen overflows the modal.
        <Box flexDirection="column">
          {LOGS_SETTINGS_GROUPS.map((group, index) => {
            const highlighted = index === logsGroupCursor;
            return (
              <Box key={group.id} flexDirection="row">
                <Text color={colors.accent} wrap="truncate-end">{highlighted ? '›' : ' '}</Text>
                <Text color={highlighted ? colors.accent : colors.text} wrap="truncate-end">{group.label}</Text>
              </Box>
            );
          })}
        </Box>
      ) : null}

      {logsGroup === 'buffer-size' ? (
        <Box flexDirection="column">
          <Text color={colors.text} wrap="truncate-end">
            Log buffer size (lines per pane): <Text color={colors.accent}>{settings.logs.bufferSize}</Text>
          </Text>
          <DimAnnotation
            text={`Steps of ${LOG_BUFFER_SIZE_STEP} lines; a digit sets a x100 preset. Applies to new streams only — already-running panes keep their current buffer size.`}
          />
        </Box>
      ) : null}

      {logsGroup === 'start-with-history' ? (
        <Box flexDirection="column">
          <CheckboxListItem
            label="Start streaming with the most recent history"
            state={settings.logs.startWithHistory ? 'checked' : 'unchecked'}
          />
        </Box>
      ) : null}

      {logsGroup === 'filter-history-size' ? (
        <Box flexDirection="column">
          <Text color={colors.text} wrap="truncate-end">
            Filter history size (entries per list): <Text color={colors.accent}>{settings.logs.filterHistorySize}</Text>
          </Text>
          <DimAnnotation text={`Steps of ${FILTER_HISTORY_SIZE_STEP} entries.`} />
        </Box>
      ) : null}

      {logsGroup === 'filter-history-grid' ? (
        <Box flexDirection="column">
          <Text color={colors.text} wrap="truncate-end">
            Filter history grid max rows: <Text color={colors.accent}>{settings.logs.filterHistoryGridMaxRows}</Text>
          </Text>
          <DimAnnotation text="Steps of 1 row; a digit sets the value." />
        </Box>
      ) : null}

      {logsGroup === 'filter-history-dedup' ? (
        <Box flexDirection="column">
          <CheckboxListItem
            label="Dedup filter history (one instance per filter)"
            state={settings.logs.filterHistoryDedup ? 'checked' : 'unchecked'}
          />
          <DimAnnotation text="Checked: reusing a filter moves it to the most recent place instead of storing it twice." />
        </Box>
      ) : null}

      {logsGroup === 'restart-mode' ? (
        <Box flexDirection="column">
          <Text color={colors.text} wrap="truncate-end">
            Restart mode (R in Logs): <Text color={colors.accent}>{settings.logs.restartMode}</Text>
          </Text>
          <DimAnnotation text="simple: plain container restart. clean: run the manifest's clean-restart recipe, falling back to a simple restart when none is declared." />
        </Box>
      ) : null}

      {logsGroup === 'clear-history' && !logsClearServiceOpen ? (
        // "Clear history" is the one Logs group holding both clear actions — its own small
        // Up/Down row list, one level below the group list.
        <Box flexDirection="column">
          {LOGS_CLEAR_ROWS.map((row, index) => {
            const highlighted = index === logsClearRowCursor;
            return (
              <Box key={row} flexDirection="row">
                <Text color={colors.accent} wrap="truncate-end">{highlighted ? '›' : ' '}</Text>
                <Text color={highlighted ? colors.accent : colors.text} wrap="truncate-end">{LOGS_CLEAR_ROW_LABELS[row]}</Text>
              </Box>
            );
          })}
        </Box>
      ) : null}

      {logsGroup === 'clear-history' && logsClearServiceOpen ? (
        // The "clear a service's history" row's drill-down — a plain Up/Down list over every
        // manifest service, never limited to the active EDT's own members.
        <Box flexDirection="column">
          {logsServices.length === 0 ? <StateLine kind="empty" subject="manifest services loaded" /> : null}
          <BoundedList
            items={logsServices}
            chromeRows={SETTINGS_LIST_CHROME_ROWS}
            cursorIndex={logsClearServiceCursor}
            renderItem={(service, index) => {
              const highlighted = index === logsClearServiceCursor;
              return (
                <Box key={service.path} flexDirection="row">
                  <Text color={colors.accent} wrap="truncate-end">{highlighted ? '›' : ' '}</Text>
                  <Text color={highlighted ? colors.accent : colors.text} wrap="truncate-end">{service.service}</Text>
                </Box>
              );
            }}
          />
          <DimAnnotation text="Clears that service's filter history (text + regex)." />
        </Box>
      ) : null}

      {logsGroup === 'filter-rules' && !logsRulesScopeOpen ? (
        <Box flexDirection="column">
          {LOGS_RULES_ROWS.map((row, index) => {
            const highlighted = index === logsRulesRowCursor;
            return (
              <Box key={row} flexDirection="row">
                <Text color={colors.accent} wrap="truncate-end">{highlighted ? '›' : ' '}</Text>
                <Text color={highlighted ? colors.accent : colors.text} wrap="truncate-end">
                  {LOGS_RULES_ROW_LABELS[row]}
                  {row === 'delete-library' ? ` (${logsRuleSetCount} ${logsRuleSetCount === 1 ? 'set' : 'sets'})` : ''}
                </Text>
              </Box>
            );
          })}
          <DimAnnotation text="Active rule lists and the library are cleared separately; each asks first." />
        </Box>
      ) : null}

      {logsGroup === 'filter-rules' && logsRulesScopeOpen ? (
        <Box flexDirection="column">
          <BoundedList
            items={logsRulesScopes}
            chromeRows={SETTINGS_LIST_CHROME_ROWS}
            cursorIndex={logsRulesScopeIndex}
            renderItem={(scope, index) => {
              const highlighted = index === logsRulesScopeIndex;
              return (
                <Box key={scope.key} flexDirection="row">
                  <Text color={colors.accent} wrap="truncate-end">{highlighted ? '›' : ' '}</Text>
                  <Text color={highlighted ? colors.accent : colors.text} wrap="truncate-end">
                    {scope.label} ({scope.count} {scope.count === 1 ? 'rule' : 'rules'})
                  </Text>
                </Box>
              );
            }}
          />
          <DimAnnotation text="Clears that scope's persisted rules; its level restriction and every other scope are untouched." />
        </Box>
      ) : null}

      {logsGroup === 'filter-rules' && logsRulesConfirm !== null ? (
        <Text color={colors.warning} wrap="truncate-end">
          {logsRulesConfirm.kind === 'scope'
            ? `Clear the persisted rules of ${logsRulesConfirm.label}? (y/Enter = yes, Esc = no)`
            : `Delete all ${logsRuleSetCount} saved rule sets? (y/Enter = yes, Esc = no)`}
        </Text>
      ) : null}
    </>
  );
}
