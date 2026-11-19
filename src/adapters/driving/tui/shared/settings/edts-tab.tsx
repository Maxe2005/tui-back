// tui/shared/settings/edts-tab: props-only view of the EDTs tab (group list and every drilled-in group). State and key handling stay in settings-screen; this file only renders.
import { Box, Text } from 'ink';
import { CheckboxListItem } from '../components/checkbox-list-item.js';
import { DimAnnotation } from '../components/dim-annotation.js';
import { colors } from '../theme/theme.js';
import { SHARED_EDT_TOGGLE_LABEL, SHARED_EDT_TOGGLE_NOTE, HIDEABLE_ACTION_HINTS, HIDEABLE_ACTION_TYPES, REALIGN_SCOPE_LABELS, SETTINGS_GROUPS, SWITCH_RESTART_LABELS, type SettingsGroupId } from './edts.logic.js';
import type { Settings } from '../../../../../core/ports/settings.js';

export type EdtsTabProps = {
  settings: Settings;
  edtsGroup: SettingsGroupId | null;
  groupCursor: number;
  hintCursor: number;
  actionTypeCursor: number;
};

export function EdtsTab({ settings, edtsGroup, groupCursor, hintCursor, actionTypeCursor }: EdtsTabProps) {
  return (
    <>
      {edtsGroup === null ? (
        // Opening the EDTs tab (or stepping back out of a group via Esc) shows this
        // Up/Down-navigable group list — no checkboxes at this level.
        <Box flexDirection="column">
          {SETTINGS_GROUPS.map((group, index) => {
            const highlighted = index === groupCursor;
            return (
              <Box key={group.id} flexDirection="row">
                <Text color={colors.accent} wrap="truncate-end">{highlighted ? '›' : ' '}</Text>
                <Text color={highlighted ? colors.accent : colors.text} wrap="truncate-end">{group.label}</Text>
              </Box>
            );
          })}
          <Box flexDirection="row">
            <Text color={colors.accent} wrap="truncate-end">{groupCursor === SETTINGS_GROUPS.length ? '›' : ' '}</Text>
            <CheckboxListItem
              label={SHARED_EDT_TOGGLE_LABEL}
              selected={groupCursor === SETTINGS_GROUPS.length}
              state={settings.edts.sharedBranchesEdtEnabled ? 'checked' : 'unchecked'}
            />
          </Box>
          <DimAnnotation text={SHARED_EDT_TOGGLE_NOTE} />
        </Box>
      ) : null}

      {edtsGroup === 'hint-visibility' ? (
        <Box flexDirection="column">
          {HIDEABLE_ACTION_HINTS.map((token, index) => {
            const highlighted = index === hintCursor;
            return (
              // checkbox-list-item's own `selected` prop has no visible effect on its own — the
              // highlighted row needs its own `›` cursor glyph, rendered as a sibling column.
              <Box key={token.id} flexDirection="row">
                <Text color={colors.accent} wrap="truncate-end">{highlighted ? '›' : ' '}</Text>
                <CheckboxListItem
                  label={token.label}
                  selected={highlighted}
                  state={settings.edts.hiddenActionHints.includes(token.id) ? 'checked' : 'unchecked'}
                />
              </Box>
            );
          })}
          <DimAnnotation text="Checked hides that hint from the EDT detail pane." />
        </Box>
      ) : null}

      {edtsGroup === 'action-types' ? (
        <Box flexDirection="column">
          {HIDEABLE_ACTION_TYPES.map((token, index) => {
            const highlighted = index === actionTypeCursor;
            return (
              <Box key={token.id} flexDirection="row">
                <Text color={colors.accent} wrap="truncate-end">{highlighted ? '›' : ' '}</Text>
                <CheckboxListItem
                  label={token.label}
                  selected={highlighted}
                  state={settings.edts.hiddenActionTypes.includes(token.id) ? 'checked' : 'unchecked'}
                />
              </Box>
            );
          })}
          <DimAnnotation text="Checked hides that action type from the Recent actions log." />
        </Box>
      ) : null}

      {edtsGroup === 'switch-restart' ? (
        <Box flexDirection="column">
          <Text color={colors.text} wrap="truncate-end">
            Restart services after an EDT switch: <Text color={colors.accent}>{SWITCH_RESTART_LABELS[settings.switch.restartMode]}</Text>
          </Text>
          <DimAnnotation text="Default for the switch dialog and `edt switch --restart`. Clean restart falls back to a simple restart where no recipe exists." />
        </Box>
      ) : null}

      {edtsGroup === 'realign-scope' ? (
        <Box flexDirection="column">
          <Text color={colors.text} wrap="truncate-end">
            Services pre-selected for a realign: <Text color={colors.accent}>{REALIGN_SCOPE_LABELS[settings.realign.defaultScope]}</Text>
          </Text>
          <DimAnnotation text="Initial preset of the realign dialog and `realign --scope` default. Only drifted services are ever listed." />
        </Box>
      ) : null}

      {edtsGroup === 'realign-restart' ? (
        <Box flexDirection="column">
          <Text color={colors.text} wrap="truncate-end">
            Restart services after a realign: <Text color={colors.accent}>{SWITCH_RESTART_LABELS[settings.realign.restartMode]}</Text>
          </Text>
          <DimAnnotation text="Default for the realign dialog and `realign --restart`. Clean restart falls back to a simple restart where no recipe exists." />
        </Box>
      ) : null}

      {edtsGroup === 'heal-restart' ? (
        <Box flexDirection="column">
          <Text color={colors.text} wrap="truncate-end">
            Restart mode for a heal: <Text color={colors.accent}>{SWITCH_RESTART_LABELS[settings.dashboard.restartMode]}</Text>
          </Text>
          <DimAnnotation text="Default for the Dashboard heal and `heal --restart`. Clean restart falls back to a simple restart where no recipe exists." />
        </Box>
      ) : null}

      {edtsGroup === 'branch-dropdown-rows' ? (
        <Box flexDirection="column">
          <Text color={colors.text} wrap="truncate-end">
            Branch dropdown max rows: <Text color={colors.accent}>{settings.edts.branchDropdownMaxRows}</Text>
          </Text>
          <DimAnnotation text="Caps the lines of the autocomplete dropdown, “N more” indicators included." />
        </Box>
      ) : null}
    </>
  );
}
