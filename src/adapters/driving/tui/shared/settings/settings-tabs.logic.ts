// tui/shared/settings/settings-tabs.logic: the settings overlay's tab model — tab ids, labels, Tab/Left/Right cycling, tab-strip styling and the list chrome height. Pure; no Ink/React.
import { stepFocus } from '../keys/focus-navigation.js';
import { colors, typography } from '../theme/theme.js';

export type SettingsTab = 'general' | 'edts' | 'command-palette' | 'logs' | 'update' | 'shared-types' | 'services';

// Services stays last: a new tab is appended, never inserted, so muscle memory for the others holds.
export const SETTINGS_TABS: readonly SettingsTab[] = ['general', 'edts', 'command-palette', 'logs', 'update', 'shared-types', 'services'];

export const SETTINGS_TAB_LABELS: Record<SettingsTab, string> = {
  general: 'General',
  edts: 'EDTs',
  'command-palette': 'Command Palette',
  logs: 'Logs',
  update: 'Update',
  'shared-types': 'st',
  services: 'Services',
};

// Left/Right/Tab all cycle in the same General -> EDTs -> Command Palette -> Logs -> Update -> st -> General order
// (SETTINGS_TABS' declared order) — Left and Tab both step forward, simpler than zones.ts's
// nextZoneId since every settings tab is always reachable.
export function nextSettingsTab(current: SettingsTab, direction: 1 | -1): SettingsTab {
  const index = SETTINGS_TABS.indexOf(current);
  return stepFocus(SETTINGS_TABS, SETTINGS_TABS[index] ?? SETTINGS_TABS[0]!, direction === 1 ? 'next' : 'back');
}

export type SettingsTabState = {
  active: boolean;
  labelColor: string;
  backgroundColor: string;
  bold: boolean;
};

// Mirrors zone-tab-bar.tsx's active/inactive treatment at a smaller scale — no
// strikethrough/badge, since settings tabs are never manifest-gated or event-badged.
export function resolveSettingsTabState(tab: SettingsTab, activeTab: SettingsTab): SettingsTabState {
  const active = tab === activeTab;
  return {
    active,
    labelColor: active ? colors.background : colors['text-dim'],
    backgroundColor: active ? colors.accent : colors.background,
    bold: active ? typography['active-tab'].bold : typography.label.bold,
  };
}

// Rows the settings frame, tab strip, heading and hint keep around a drill-down list.
export const SETTINGS_LIST_CHROME_ROWS = 14;
