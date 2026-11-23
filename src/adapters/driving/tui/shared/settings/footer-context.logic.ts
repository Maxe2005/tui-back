// tui/shared/settings/footer-context.logic: which footer context the settings overlay advertises for the current tab and drill-down level. Pure; no Ink/React.
import type { FooterContextId } from '../../keybindings/index.js';
import type { SettingsTab } from './settings-tabs.logic.js';
import type { SettingsGroupId } from './edts/edts.logic.js';
import type { LogsSettingsGroupId } from './logs/logs.logic.js';
import type { PaletteSettingsGroupId } from './palette.logic.js';

const GROUP_FOOTER_CONTEXTS: Record<SettingsGroupId | LogsSettingsGroupId | PaletteSettingsGroupId, FooterContextId> = {
  'grid-max-rows': 'settings-adjust',
  'history-size': 'settings-adjust',
  'history-dedup': 'settings-toggle',
  'hint-visibility': 'settings-toggle',
  'action-types': 'settings-toggle',
  'branch-dropdown-rows': 'settings-adjust',
  'switch-restart': 'settings-toggle',
  'realign-scope': 'settings-toggle',
  'realign-restart': 'settings-toggle',
  'heal-restart': 'settings-toggle',
  'buffer-size': 'settings-adjust',
  'start-with-history': 'settings-toggle',
  'filter-history-size': 'settings-adjust',
  'filter-history-grid': 'settings-adjust',
  'filter-history-dedup': 'settings-toggle',
  'restart-mode': 'settings-toggle',
  'clear-history': 'settings-run',
  'filter-rules': 'settings-rules',
};

// The footer context of the current tab and drill-down level: a text edit is a plain
// confirm/cancel, a group list opens groups, and each group advertises its own control.
export function settingsFooterContext(
  tab: SettingsTab,
  state: {
    generalEditing: boolean;
    edtsGroup: SettingsGroupId | null;
    // True while the EDTs group list's cursor rests on the shared-branches switch row.
    edtsToggleRow?: boolean;
    logsGroup: LogsSettingsGroupId | null;
    paletteGroup?: PaletteSettingsGroupId | null;
    // True while a Logs "persisted filter rules" action waits for its confirmation.
    logsRulesConfirming?: boolean;
  },
): FooterContextId {
  switch (tab) {
    case 'general':
      return state.generalEditing ? 'confirm' : 'settings-general';
    case 'update':
      return 'settings-update';
    case 'command-palette':
      return state.paletteGroup == null ? 'settings-groups' : GROUP_FOOTER_CONTEXTS[state.paletteGroup];
    case 'edts':
      if (state.edtsGroup === null) {
        return state.edtsToggleRow === true ? 'settings-groups-toggle' : 'settings-groups';
      }
      return GROUP_FOOTER_CONTEXTS[state.edtsGroup];
    case 'shared-types':
      return 'settings-shared-types';
    case 'services':
      return 'settings-services';
    case 'logs':
      if (state.logsGroup === 'filter-rules' && state.logsRulesConfirming === true) {
        return 'settings-rules-confirm';
      }
      return state.logsGroup === null ? 'settings-groups' : GROUP_FOOTER_CONTEXTS[state.logsGroup];
  }
}
