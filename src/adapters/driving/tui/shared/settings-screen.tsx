// tui/shared/settings-screen: the `:settings` overlay — a tab-organized modal (General / EDTs /
// Command Palette / Logs) reachable only through the `settings` command. Every change applies
// to the live store and persists immediately via `updateSettings` (no save step, no dirty
// state). The EDTs and Logs tabs open on a group list that Enter drills into, so Esc handling
// lives here (`onClose`): only this component knows whether Esc steps back or closes.
import { useState } from 'react';
import { Box, Text } from 'ink';
import { useInput } from './hooks/use-input.js';
import { CheckboxListItem } from './components/checkbox-list-item.js';
import { DimAnnotation } from './components/dim-annotation.js';
import { ModalDialog } from './components/modal-dialog.js';
import { nextTextInputValue, type TextEditKey, type TextInputState } from './components/text-edit.js';
import { TextInputLine } from './components/text-input-line.js';
import { formatHint } from './components/hints.js';
import { useFooterContext } from './hooks/use-footer-context.js';
import { resolveFocusStep, stepFocus } from './keys/focus-navigation.js';
import { nextCursorForKey } from './keys/list-cursor.js';
import type { FooterContextId } from '../keybindings/index.js';
import { colors, spacing, typography } from './theme/theme.js';
import { useAppStore, type AppStore } from '../store/app-store.js';
import {
  MAX_EDTS_BRANCH_DROPDOWN_MAX_ROWS,
  MAX_FILTER_HISTORY_GRID_MAX_ROWS,
  MAX_INPUT_HISTORY_SIZE,
  MAX_GRID_MAX_ROWS,
  MAX_LOG_BUFFER_SIZE,
  MIN_EDTS_BRANCH_DROPDOWN_MAX_ROWS,
  MIN_FILTER_HISTORY_GRID_MAX_ROWS,
  MIN_INPUT_HISTORY_SIZE,
  MIN_GRID_MAX_ROWS,
  MIN_LOG_BUFFER_SIZE,
  MAX_UPDATE_CONCURRENCY,
  MIN_UPDATE_CONCURRENCY,
  type Settings,
  type UpdateMergeSourceDefault,
} from '../../../../core/ports/settings.js';
import { StateLine } from './components/state-line.js';
import { BoundedList } from './components/bounded-list.js';

export type SettingsTab = 'general' | 'edts' | 'command-palette' | 'logs' | 'update';

export const SETTINGS_TABS: readonly SettingsTab[] = ['general', 'edts', 'command-palette', 'logs', 'update'];

export const SETTINGS_TAB_LABELS: Record<SettingsTab, string> = {
  general: 'General',
  edts: 'EDTs',
  'command-palette': 'Command Palette',
  logs: 'Logs',
  update: 'Update',
};

// Left/Right/Tab all cycle in the same General -> EDTs -> Command Palette -> Logs -> Update order
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

// Command Palette tab: the grid rows per column. Clamped to a sane, always-positive range —
// 0/negative would break groupCommandsByColumn's `Math.max(1, maxRows)` floor, and the zod
// schema enforces the same [MIN, MAX] bound (core/ports/settings.ts holds both). Re-exported
// here for existing importers.
export { MIN_GRID_MAX_ROWS, MAX_GRID_MAX_ROWS };

export function clampGridMaxRows(value: number): number {
  return Math.min(Math.max(value, MIN_GRID_MAX_ROWS), MAX_GRID_MAX_ROWS);
}

export function adjustGridMaxRows(current: number, direction: 'up' | 'down'): number {
  return clampGridMaxRows(current + (direction === 'up' ? 1 : -1));
}

// A typed digit sets the value directly. Only a single digit 1-9 is meaningful — '0' is never a
// valid gridMaxRows (zod's `.positive()`), and any non-digit is ignored rather than appended
// (this is a value-set field, not free text).
export function parseGridMaxRowsDigit(input: string): number | null {
  if (!/^[1-9]$/.test(input)) {
    return null;
  }
  return clampGridMaxRows(Number(input));
}

// Logs tab: settings.logs.bufferSize, with the Command Palette tab's clamp/adjust/parse-digit
// idiom rescaled to its wider range (50-5000 vs. 1-99): Up/Down steps by LOG_BUFFER_SIZE_STEP,
// and a typed digit 1-9 is a quick preset (digit x 100, e.g. '5' -> 500) since the literal
// digit is never a meaningful buffer size.
export const LOG_BUFFER_SIZE_STEP = 50;
export { MIN_LOG_BUFFER_SIZE, MAX_LOG_BUFFER_SIZE };

export function clampLogBufferSize(value: number): number {
  return Math.min(Math.max(value, MIN_LOG_BUFFER_SIZE), MAX_LOG_BUFFER_SIZE);
}

export function adjustLogBufferSize(current: number, direction: 'up' | 'down'): number {
  return clampLogBufferSize(current + (direction === 'up' ? LOG_BUFFER_SIZE_STEP : -LOG_BUFFER_SIZE_STEP));
}

export function parseLogBufferSizeDigit(input: string): number | null {
  if (!/^[1-9]$/.test(input)) {
    return null;
  }
  return clampLogBufferSize(Number(input) * 100);
}

// Logs tab: settings.logs.filterHistorySize/filterHistoryGridMaxRows, same clamp/adjust idiom
// as bufferSize/gridMaxRows above. filterHistorySize has no digit preset — Left/Right (see the
// group model below) is its only adjustment.
export const FILTER_HISTORY_SIZE_STEP = 5;
export { MIN_INPUT_HISTORY_SIZE as MIN_FILTER_HISTORY_SIZE, MAX_INPUT_HISTORY_SIZE as MAX_FILTER_HISTORY_SIZE };

export function clampFilterHistorySize(value: number): number {
  return Math.min(Math.max(value, MIN_INPUT_HISTORY_SIZE), MAX_INPUT_HISTORY_SIZE);
}

export function adjustFilterHistorySize(current: number, direction: 'up' | 'down'): number {
  return clampFilterHistorySize(current + (direction === 'up' ? FILTER_HISTORY_SIZE_STEP : -FILTER_HISTORY_SIZE_STEP));
}

// filterHistoryGridMaxRows mirrors gridMaxRows' [1, 99] range and digit-preset convention, but
// through its own constants (the two settings are independent).
export { MIN_FILTER_HISTORY_GRID_MAX_ROWS, MAX_FILTER_HISTORY_GRID_MAX_ROWS };

export function clampFilterHistoryGridMaxRows(value: number): number {
  return Math.min(Math.max(value, MIN_FILTER_HISTORY_GRID_MAX_ROWS), MAX_FILTER_HISTORY_GRID_MAX_ROWS);
}

export function adjustFilterHistoryGridMaxRows(current: number, direction: 'up' | 'down'): number {
  return clampFilterHistoryGridMaxRows(current + (direction === 'up' ? 1 : -1));
}

export function parseFilterHistoryGridMaxRowsDigit(input: string): number | null {
  if (!/^[1-9]$/.test(input)) {
    return null;
  }
  return clampFilterHistoryGridMaxRows(Number(input));
}

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

// Update tab: the group-update defaults — concurrency (moved here from General), and the three
// global defaults the 3.7 config screen and the CLI start from. A flat Up/Down row list; edits
// persist immediately. Per-run changes in the config screen are never written back here.
export type UpdateSettingsRowId = 'concurrency' | 'run-migrations' | 'clean-restart' | 'merge-source';

export const UPDATE_SETTINGS_ROWS: readonly UpdateSettingsRowId[] = ['concurrency', 'run-migrations', 'clean-restart', 'merge-source'];

export const UPDATE_SETTINGS_ROW_HINTS: Record<UpdateSettingsRowId, string> = {
  concurrency: 'Services a group update processes at once (+/- or a digit). 1 = one after the other.',
  'run-migrations': 'Whether a group update runs migrations by default (config screen and CLI); a per-run change is never saved here.',
  'clean-restart': 'Whether a group update does a clean restart by default (config screen and CLI); a per-run change is never saved here.',
  'merge-source': 'Space toggles. From EDT applies to the EDT-scoped config screen only (the all-repos and single-service screens have no merge-source line).',
};

// update.concurrency: how many services a group update processes at once. `+`/`-` step it, a typed
// digit sets it; the schema enforces the same [MIN, MAX] bound.
export function clampUpdateConcurrency(value: number): number {
  return Math.min(Math.max(value, MIN_UPDATE_CONCURRENCY), MAX_UPDATE_CONCURRENCY);
}

export function adjustUpdateConcurrency(current: number, direction: 'up' | 'down'): number {
  return clampUpdateConcurrency(current + (direction === 'up' ? 1 : -1));
}

export function parseUpdateConcurrencyDigit(input: string): number | null {
  return /^[1-9]$/.test(input) ? clampUpdateConcurrency(Number(input)) : null;
}

export type UpdateSettingsStep =
  | { type: 'move'; cursor: number }
  | { type: 'set-concurrency'; value: number }
  | { type: 'toggle-run-migrations' }
  | { type: 'toggle-clean-restart' }
  | { type: 'set-merge-source'; value: UpdateMergeSourceDefault }
  | { type: 'ignore' };

export function nextMergeSourceDefault(current: UpdateMergeSourceDefault): UpdateMergeSourceDefault {
  return current === 'shared' ? 'edt-pending' : 'shared';
}

export function resolveUpdateSettingsKey(
  input: string,
  key: TextEditKey,
  cursor: number,
  update: Settings['update'],
): UpdateSettingsStep {
  const moved = nextCursorForKey(key, cursor, UPDATE_SETTINGS_ROWS.length);
  if (moved !== null) {
    return { type: 'move', cursor: moved };
  }
  const row = UPDATE_SETTINGS_ROWS[cursor];
  if (row === 'concurrency') {
    if (input === '+') {
      return { type: 'set-concurrency', value: adjustUpdateConcurrency(update.concurrency, 'up') };
    }
    if (input === '-') {
      return { type: 'set-concurrency', value: adjustUpdateConcurrency(update.concurrency, 'down') };
    }
    const digit = parseUpdateConcurrencyDigit(input);
    return digit !== null ? { type: 'set-concurrency', value: digit } : { type: 'ignore' };
  }
  if (row === 'run-migrations' && input === ' ') {
    return { type: 'toggle-run-migrations' };
  }
  if (row === 'clean-restart' && input === ' ') {
    return { type: 'toggle-clean-restart' };
  }
  if (row === 'merge-source' && (input === ' ' || key.return)) {
    return { type: 'set-merge-source', value: nextMergeSourceDefault(update.mergeSource) };
  }
  return { type: 'ignore' };
}

// EDTs tab: the hideable per-context action hints (formatAvailableActionsHint's contexts).
export type HideableActionHint = { id: string; label: string };

export const HIDEABLE_ACTION_HINTS: readonly HideableActionHint[] = [
  { id: 'edts', label: `EDT selector — "${formatHint(['Enter', 'Switch'])}" / "${formatHint(['Enter', 'Modify'])}"` },
  { id: 'edt-services', label: `EDT services — "${formatHint(['Enter', 'Remove / Change branch'])}"` },
  { id: 'other-services', label: `Other services — "${formatHint(['Enter', 'Add to EDT'])}"` },
];

// Toggles `id` in `hidden`, never mutating the input array (Settings.edts.hiddenActionHints and
// hiddenActionTypes are each a string[], not a Set). Shared by both EDTs checkbox groups.
export function toggleHiddenHint(hidden: readonly string[], id: string): string[] {
  return hidden.includes(id) ? hidden.filter((existing) => existing !== id) : [...hidden, id];
}

// The "Recent action types" group's rows — the literal `EdtActionLogEntry['actionType']`
// domain, closed and hardcoded, never derived from `edtActionLog` at runtime (an EDT with no
// `modify` entries yet must still offer to hide `modify`).
export type HideableActionType = { id: string; label: string };

export const HIDEABLE_ACTION_TYPES: readonly HideableActionType[] = [
  { id: 'create', label: 'Create' },
  { id: 'switch', label: 'Switch' },
  { id: 'modify', label: 'Modify' },
];

// The EDTs tab's group-list level, ahead of its two checkbox lists (one flat list would
// conflate two unrelated toggles).
//
// Branch autocomplete dropdown rows (shared BranchAutocompleteInput): the visible row count
// before the `… N more` overflow line, with the gridMaxRows clamp/adjust/parse-digit idiom
// (bounds from core's MIN/MAX_EDTS_BRANCH_DROPDOWN_MAX_ROWS, shared with the schema).
export { MIN_EDTS_BRANCH_DROPDOWN_MAX_ROWS, MAX_EDTS_BRANCH_DROPDOWN_MAX_ROWS };

export function clampBranchDropdownMaxRows(value: number): number {
  return Math.min(Math.max(value, MIN_EDTS_BRANCH_DROPDOWN_MAX_ROWS), MAX_EDTS_BRANCH_DROPDOWN_MAX_ROWS);
}

export function adjustBranchDropdownMaxRows(current: number, direction: 'up' | 'down'): number {
  return clampBranchDropdownMaxRows(current + (direction === 'up' ? 1 : -1));
}

// A typed digit sets the value directly (same value-set convention as parseGridMaxRowsDigit:
// single digit 1-9 only; '0' is never valid and non-digits are ignored rather than appended).
export function parseBranchDropdownMaxRowsDigit(input: string): number | null {
  if (!/^[1-9]$/.test(input)) {
    return null;
  }
  return clampBranchDropdownMaxRows(Number(input));
}

export type SettingsGroupId = 'hint-visibility' | 'action-types' | 'branch-dropdown-rows';

export type SettingsGroup = { id: SettingsGroupId; label: string };

export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  { id: 'hint-visibility', label: 'Hint visibility' },
  { id: 'action-types', label: 'Recent action types' },
  { id: 'branch-dropdown-rows', label: 'Branch dropdown rows' },
];

// The Logs tab's group list: one field (or a small related cluster) per group, so no screen
// renders more than a handful of lines. ModalDialog has no height cap, and a flat list of every
// field overflowed short terminals — Ink's diff-render then corrupted the border and title.
// Five groups: four single-field ones plus "Clear history" holding both clear actions.
export type LogsSettingsGroupId =
  | 'buffer-size'
  | 'start-with-history'
  | 'filter-history-size'
  | 'filter-history-grid'
  | 'filter-history-dedup'
  | 'clear-history';

export type LogsSettingsGroup = { id: LogsSettingsGroupId; label: string };

export const LOGS_SETTINGS_GROUPS: readonly LogsSettingsGroup[] = [
  { id: 'buffer-size', label: 'Buffer size' },
  { id: 'start-with-history', label: 'Start with history' },
  { id: 'filter-history-size', label: 'Filter history size' },
  { id: 'filter-history-grid', label: 'Filter history grid' },
  { id: 'filter-history-dedup', label: 'Filter history dedup' },
  { id: 'clear-history', label: 'Clear history' },
];

// The Command Palette tab's group list, same two-level shape as the Logs tab: the grid height
// plus the command-history controls (size, dedup, clear), one group each.
export type PaletteSettingsGroupId = 'grid-max-rows' | 'history-size' | 'history-dedup' | 'clear-history';

export type PaletteSettingsGroup = { id: PaletteSettingsGroupId; label: string };

export const PALETTE_SETTINGS_GROUPS: readonly PaletteSettingsGroup[] = [
  { id: 'grid-max-rows', label: 'Command grid max rows' },
  { id: 'history-size', label: 'Command history size' },
  { id: 'history-dedup', label: 'Deduplicate command history' },
  { id: 'clear-history', label: 'Clear command history' },
];

const GROUP_FOOTER_CONTEXTS: Record<SettingsGroupId | LogsSettingsGroupId | PaletteSettingsGroupId, FooterContextId> = {
  'grid-max-rows': 'settings-adjust',
  'history-size': 'settings-adjust',
  'history-dedup': 'settings-toggle',
  'hint-visibility': 'settings-toggle',
  'action-types': 'settings-toggle',
  'branch-dropdown-rows': 'settings-adjust',
  'buffer-size': 'settings-adjust',
  'start-with-history': 'settings-toggle',
  'filter-history-size': 'settings-adjust',
  'filter-history-grid': 'settings-adjust',
  'filter-history-dedup': 'settings-toggle',
  'clear-history': 'settings-run',
};

// The footer context of the current tab and drill-down level: a text edit is a plain
// confirm/cancel, a group list opens groups, and each group advertises its own control.
export function settingsFooterContext(
  tab: SettingsTab,
  state: {
    generalEditing: boolean;
    edtsGroup: SettingsGroupId | null;
    logsGroup: LogsSettingsGroupId | null;
    paletteGroup?: PaletteSettingsGroupId | null;
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
      return state.edtsGroup === null ? 'settings-groups' : GROUP_FOOTER_CONTEXTS[state.edtsGroup];
    case 'logs':
      return state.logsGroup === null ? 'settings-groups' : GROUP_FOOTER_CONTEXTS[state.logsGroup];
  }
}

// "Clear history" is the one Logs group holding more than a single field — its own small
// Up/Down row list, one level below the group list, mirroring the EDTs tab's own two-level
// depth (group list -> checkbox list) rather than growing a third top-level list.
export type LogsClearRowId = 'clear-global' | 'clear-service';

export const LOGS_CLEAR_ROWS: readonly LogsClearRowId[] = ['clear-global', 'clear-service'];

export const LOGS_CLEAR_ROW_LABELS: Record<LogsClearRowId, string> = {
  'clear-global': 'Clear global filter history',
  'clear-service': "Clear a service's filter history",
};

// Self-contained Esc handling (like command-bar.tsx's `onClose`): the drill-down state is local
// to this component, so only it can decide whether Esc steps back a level or closes the whole
// screen. `onClose` defaults to a no-op so a bare smoke-test render never crashes.
export type SettingsScreenProps = {
  useStore?: AppStore;
  onClose?: () => void;
  // Test-only injection points (like edts-zone.tsx's `initialPaneFocus`): renderToString never
  // observes a keypress, so a smoke test can't Tab/Enter its way to a specific tab or drilled
  // group otherwise. Production always starts on General, at the group list.
  initialTab?: SettingsTab;
  initialEdtsGroup?: SettingsGroupId | null;
  // Same test-only injection idiom, one level up, for the Logs tab's own group list (mirrors
  // initialEdtsGroup). Production always starts on the group list (null).
  initialLogsGroup?: LogsSettingsGroupId | null;
  // Same test-only injection idiom, for the Logs tab's "clear a service's history" drill-down.
  // Implies initialLogsGroup = 'clear-history' when that prop is left unset, since the service
  // list is only reachable from within that group.
  initialLogsClearServiceOpen?: boolean;
  // Same test-only injection idiom for the Command Palette tab's own group list.
  initialPaletteGroup?: PaletteSettingsGroupId | null;
  // Same test-only injection idiom for the General tab's editor-command edit session.
  // Production always starts browsing the row list (false).
  initialGeneralEditing?: boolean;
};

// Rows the settings frame, tab strip, heading and hint keep around a drill-down list.
const SETTINGS_LIST_CHROME_ROWS = 14;

export function SettingsScreen({
  useStore = useAppStore,
  onClose = () => {},
  initialTab = 'general',
  initialEdtsGroup = null,
  initialLogsGroup = null,
  initialLogsClearServiceOpen = false,
  initialPaletteGroup = null,
  initialGeneralEditing = false,
}: SettingsScreenProps) {
  const settings = useStore((state) => state.settings);
  const settingsWarning = useStore((state) => state.settingsWarning);
  const updateSettings = useStore((state) => state.updateSettings);
  // The Logs tab's clear actions and the service list its "clear this service" row drills
  // into.
  const clearGlobalFilterHistory = useStore((state) => state.clearGlobalFilterHistory);
  const clearServiceFilterHistory = useStore((state) => state.clearServiceFilterHistory);
  const clearCommandHistory = useStore((state) => state.clearCommandHistory);
  const edtsBranches = useStore((state) => state.edtsBranches);

  const [tab, setTab] = useState<SettingsTab>(initialTab);
  // The General tab's row cursor + in-progress editor-command edit (null when browsing).
  // The edit is a local draft: only Enter persists it, Esc drops it.
  const [generalCursor, setGeneralCursor] = useState(initialGeneralEditing ? GENERAL_SETTINGS_ROWS.indexOf('editor-command') : 0);
  const [updateCursor, setUpdateCursor] = useState(0);
  const [generalEditing, setGeneralEditing] = useState<TextInputState | null>(
    initialGeneralEditing ? { value: settings.general.editorCommand, cursor: settings.general.editorCommand.length } : null,
  );
  const [edtsGroup, setEdtsGroup] = useState<SettingsGroupId | null>(initialEdtsGroup);
  const [groupCursor, setGroupCursor] = useState(0);
  const [hintCursor, setHintCursor] = useState(0);
  const [actionTypeCursor, setActionTypeCursor] = useState(0);
  // The Logs tab's own group list (mirrors edtsGroup/groupCursor), the "Clear history" group's
  // two-row list one level below that, and the "clear a service's history" row's drill-down
  // state one level below that again.
  const [logsGroup, setLogsGroup] = useState<LogsSettingsGroupId | null>(
    initialLogsGroup ?? (initialLogsClearServiceOpen ? 'clear-history' : null),
  );
  const [logsGroupCursor, setLogsGroupCursor] = useState(0);
  const [logsClearRowCursor, setLogsClearRowCursor] = useState(0);
  const [logsClearServiceOpen, setLogsClearServiceOpen] = useState(initialLogsClearServiceOpen);
  const [logsClearServiceCursor, setLogsClearServiceCursor] = useState(0);
  const logsServices = edtsBranches ?? [];
  // The Command Palette tab's group list (same shape as the Logs tab's).
  const [paletteGroup, setPaletteGroup] = useState<PaletteSettingsGroupId | null>(initialPaletteGroup);
  const [paletteGroupCursor, setPaletteGroupCursor] = useState(0);

  // Drilled in on the EDTs tab's own group, or on any Logs tab group (single-field group,
  // "Clear history"'s row list, or its "clear a service's history" sub-list) — every other
  // combination is "not drilled in" for Esc purposes. An open editor-command edit on the
  // General tab counts too: Left/Right/Tab belong to the text field while it is open, and Esc
  // cancels the edit rather than closing the screen.
  const drilledIn =
    (tab === 'general' && generalEditing !== null) || (tab === 'edts' && edtsGroup !== null) || (tab === 'logs' && logsGroup !== null) ||
    (tab === 'command-palette' && paletteGroup !== null);

  useFooterContext(
    'settings',
    settingsFooterContext(tab, { generalEditing: generalEditing !== null, edtsGroup, logsGroup, paletteGroup }),
    useStore,
  );

  useInput((input, key) => {
    if (key.escape) {
      if (tab === 'general' && generalEditing !== null) {
        // Drops the draft — the persisted command is untouched, the screen stays open.
        setGeneralEditing(null);
        return;
      }
      if (tab === 'edts' && edtsGroup !== null) {
        // Steps back up to the group list — the whole settings screen stays open.
        setEdtsGroup(null);
        return;
      }
      if (tab === 'command-palette' && paletteGroup !== null) {
        setPaletteGroup(null);
        return;
      }
      if (tab === 'logs' && logsClearServiceOpen) {
        setLogsClearServiceOpen(false);
        return;
      }
      if (tab === 'logs' && logsGroup !== null) {
        // Steps back up to the group list — the whole settings screen stays open.
        setLogsGroup(null);
        return;
      }
      onClose();
      return;
    }

    // Tab always cycles the top-level tabs (never while drilled in). Left/Right also cycle tabs
    // at every tab's own top level; Tab remains the Logs tab's way back out.
    const tabStep = drilledIn ? null : resolveFocusStep(input, key, 'tab');
    if (tabStep !== null) {
      // Landing on (or leaving) the EDTs/Logs tab always resets to its own top level — on every
      // arrival, not just the first.
      setEdtsGroup(null);
      setGroupCursor(0);
      setLogsGroup(null);
      setLogsGroupCursor(0);
      setLogsClearServiceOpen(false);
      setPaletteGroup(null);
      setPaletteGroupCursor(0);
      setTab((current) => nextSettingsTab(current, tabStep === 'back' ? -1 : 1));
      return;
    }
    const arrowStep = drilledIn ? null : resolveFocusStep(input, key, 'horizontal');
    if (arrowStep !== null) {
      const direction = arrowStep === 'back' ? -1 : 1;
      setEdtsGroup(null);
      setGroupCursor(0);
      setLogsGroup(null);
      setLogsGroupCursor(0);
      setPaletteGroup(null);
      setPaletteGroupCursor(0);
      setTab((current) => nextSettingsTab(current, direction));
      return;
    }

    if (tab === 'general') {
      const step = resolveGeneralSettingsKey(input, key, { cursor: generalCursor, editing: generalEditing });
      if (step.type === 'move') {
        setGeneralCursor(step.cursor);
      } else if (step.type === 'toggle-quit') {
        void updateSettings({ general: { quitShortcutEnabled: !settings.general.quitShortcutEnabled } });
      } else if (step.type === 'begin-edit') {
        setGeneralEditing({ value: settings.general.editorCommand, cursor: settings.general.editorCommand.length });
      } else if (step.type === 'edit') {
        setGeneralEditing(step.editing);
      } else if (step.type === 'commit-edit') {
        setGeneralEditing(null);
        void updateSettings({ general: { editorCommand: step.value } });
      }
      return;
    }

    if (tab === 'update') {
      const step = resolveUpdateSettingsKey(input, key, updateCursor, settings.update);
      if (step.type === 'move') {
        setUpdateCursor(step.cursor);
      } else if (step.type === 'set-concurrency') {
        void updateSettings({ update: { concurrency: step.value } });
      } else if (step.type === 'toggle-run-migrations') {
        void updateSettings({ update: { runMigrations: !settings.update.runMigrations } });
      } else if (step.type === 'toggle-clean-restart') {
        void updateSettings({ update: { cleanRestart: !settings.update.cleanRestart } });
      } else if (step.type === 'set-merge-source') {
        void updateSettings({ update: { mergeSource: step.value } });
      }
      return;
    }

    if (tab === 'command-palette') {
      if (paletteGroup === 'grid-max-rows') {
        if (key.upArrow || key.rightArrow) {
          void updateSettings({
            commandPalette: { gridMaxRows: adjustGridMaxRows(settings.commandPalette.gridMaxRows, 'up') },
          });
          return;
        }
        if (key.downArrow || key.leftArrow) {
          void updateSettings({
            commandPalette: { gridMaxRows: adjustGridMaxRows(settings.commandPalette.gridMaxRows, 'down') },
          });
          return;
        }
        const digit = parseGridMaxRowsDigit(input);
        if (digit !== null) {
          void updateSettings({ commandPalette: { gridMaxRows: digit } });
        }
        return;
      }

      if (paletteGroup === 'history-size') {
        if (key.leftArrow || key.downArrow) {
          void updateSettings({ commandPalette: { historySize: adjustFilterHistorySize(settings.commandPalette.historySize, 'down') } });
          return;
        }
        if (key.rightArrow || key.upArrow) {
          void updateSettings({ commandPalette: { historySize: adjustFilterHistorySize(settings.commandPalette.historySize, 'up') } });
        }
        return;
      }

      if (paletteGroup === 'history-dedup') {
        if (input === ' ') {
          void updateSettings({ commandPalette: { historyDedup: !settings.commandPalette.historyDedup } });
        }
        return;
      }

      if (paletteGroup === 'clear-history') {
        if (key.return) {
          clearCommandHistory();
        }
        return;
      }

      // paletteGroup === null: the group-list level — Up/Down navigates, Enter drills in.
      const moved = nextCursorForKey(key, paletteGroupCursor, PALETTE_SETTINGS_GROUPS.length);
      if (moved !== null) {
        setPaletteGroupCursor(moved);
        return;
      }
      if (key.return) {
        const group = PALETTE_SETTINGS_GROUPS[paletteGroupCursor];
        if (group) {
          setPaletteGroup(group.id);
        }
      }
      return;
    }

    if (tab === 'logs') {
      // The "clear a service's history" drill-down — its own small Up/Down list, Enter/Space
      // clears that one service's two lists (text + regex), Esc (handled above) steps back to
      // the "Clear history" group's row list.
      if (logsClearServiceOpen) {
        const moved = nextCursorForKey(key, logsClearServiceCursor, logsServices.length);
        if (moved !== null) {
          setLogsClearServiceCursor(moved);
          return;
        }
        if (key.return) {
          const service = logsServices[logsClearServiceCursor];
          if (service) {
            clearServiceFilterHistory(service.path);
          }
        }
        return;
      }

      // "Clear history" is the one Logs group with more than one field — its own small Up/Down
      // row list, Enter triggers whichever action is highlighted.
      if (logsGroup === 'clear-history') {
        const moved = nextCursorForKey(key, logsClearRowCursor, LOGS_CLEAR_ROWS.length);
        if (moved !== null) {
          setLogsClearRowCursor(moved);
          return;
        }
        const row = LOGS_CLEAR_ROWS[logsClearRowCursor];
        if (row === 'clear-global' && key.return) {
          clearGlobalFilterHistory();
          return;
        }
        if (row === 'clear-service' && key.return) {
          setLogsClearServiceOpen(true);
          setLogsClearServiceCursor(0);
        }
        return;
      }

      if (logsGroup === 'buffer-size') {
        if (key.leftArrow) {
          void updateSettings({ logs: { bufferSize: adjustLogBufferSize(settings.logs.bufferSize, 'down') } });
          return;
        }
        if (key.rightArrow) {
          void updateSettings({ logs: { bufferSize: adjustLogBufferSize(settings.logs.bufferSize, 'up') } });
          return;
        }
        const digit = parseLogBufferSizeDigit(input);
        if (digit !== null) {
          void updateSettings({ logs: { bufferSize: digit } });
        }
        return;
      }

      if (logsGroup === 'start-with-history') {
        if (input === ' ') {
          void updateSettings({ logs: { startWithHistory: !settings.logs.startWithHistory } });
        }
        return;
      }

      if (logsGroup === 'filter-history-size') {
        if (key.leftArrow) {
          void updateSettings({ logs: { filterHistorySize: adjustFilterHistorySize(settings.logs.filterHistorySize, 'down') } });
          return;
        }
        if (key.rightArrow) {
          void updateSettings({ logs: { filterHistorySize: adjustFilterHistorySize(settings.logs.filterHistorySize, 'up') } });
        }
        return;
      }

      if (logsGroup === 'filter-history-grid') {
        if (key.leftArrow) {
          void updateSettings({
            logs: { filterHistoryGridMaxRows: adjustFilterHistoryGridMaxRows(settings.logs.filterHistoryGridMaxRows, 'down') },
          });
          return;
        }
        if (key.rightArrow) {
          void updateSettings({
            logs: { filterHistoryGridMaxRows: adjustFilterHistoryGridMaxRows(settings.logs.filterHistoryGridMaxRows, 'up') },
          });
          return;
        }
        const digit = parseFilterHistoryGridMaxRowsDigit(input);
        if (digit !== null) {
          void updateSettings({ logs: { filterHistoryGridMaxRows: digit } });
        }
        return;
      }

      if (logsGroup === 'filter-history-dedup') {
        if (input === ' ') {
          void updateSettings({ logs: { filterHistoryDedup: !settings.logs.filterHistoryDedup } });
        }
        return;
      }

      // logsGroup === null: the group-list level — Up/Down navigates, Enter drills in.
      const moved = nextCursorForKey(key, logsGroupCursor, LOGS_SETTINGS_GROUPS.length);
      if (moved !== null) {
        setLogsGroupCursor(moved);
        return;
      }
      if (key.return) {
        const group = LOGS_SETTINGS_GROUPS[logsGroupCursor];
        if (group) {
          setLogsGroup(group.id);
        }
      }
      return;
    }

    if (tab !== 'edts') {
      return;
    }

    if (!drilledIn) {
      // The group-list level — Up/Down navigates, Enter drills in.
      const moved = nextCursorForKey(key, groupCursor, SETTINGS_GROUPS.length);
      if (moved !== null) {
        setGroupCursor(moved);
        return;
      }
      if (key.return) {
        const group = SETTINGS_GROUPS[groupCursor];
        if (group) {
          setEdtsGroup(group.id);
        }
      }
      return;
    }

    if (edtsGroup === 'hint-visibility') {
      const moved = nextCursorForKey(key, hintCursor, HIDEABLE_ACTION_HINTS.length);
      if (moved !== null) {
        setHintCursor(moved);
        return;
      }
      if (input === ' ') {
        const token = HIDEABLE_ACTION_HINTS[hintCursor];
        if (token) {
          void updateSettings({
            edts: { hiddenActionHints: toggleHiddenHint(settings.edts.hiddenActionHints, token.id) },
          });
        }
      }
      return;
    }

    if (edtsGroup === 'branch-dropdown-rows') {
      // Numeric single-field group (mirrors the Command Palette tab's gridMaxRows idiom, plus
      // the Logs tab's Left/Right convention): Up/Right steps up, Down/Left steps down, a typed
      // digit 1-9 sets the value directly — always clamped live to [MIN, MAX], persisted via a
      // single-field updateSettings call that leaves the group's sibling fields untouched.
      if (key.upArrow || key.rightArrow) {
        void updateSettings({
          edts: { branchDropdownMaxRows: adjustBranchDropdownMaxRows(settings.edts.branchDropdownMaxRows, 'up') },
        });
        return;
      }
      if (key.downArrow || key.leftArrow) {
        void updateSettings({
          edts: { branchDropdownMaxRows: adjustBranchDropdownMaxRows(settings.edts.branchDropdownMaxRows, 'down') },
        });
        return;
      }
      const digit = parseBranchDropdownMaxRowsDigit(input);
      if (digit !== null) {
        void updateSettings({ edts: { branchDropdownMaxRows: digit } });
      }
      return;
    }

    // edtsGroup === 'action-types'
    const moved = nextCursorForKey(key, actionTypeCursor, HIDEABLE_ACTION_TYPES.length);
    if (moved !== null) {
      setActionTypeCursor(moved);
      return;
    }
    if (input === ' ') {
      const token = HIDEABLE_ACTION_TYPES[actionTypeCursor];
      if (token) {
        void updateSettings({
          edts: { hiddenActionTypes: toggleHiddenHint(settings.edts.hiddenActionTypes, token.id) },
        });
      }
    }
  });

  return (
    <ModalDialog title="SETTINGS" open>
      <Box flexDirection="column">
        <Box flexDirection="row">
          {SETTINGS_TABS.map((t) => {
            const state = resolveSettingsTabState(t, tab);
            return (
              <Box key={t} paddingX={spacing['1']} backgroundColor={state.backgroundColor}>
                <Text bold={state.bold} color={state.labelColor} wrap="truncate-end">
                  {SETTINGS_TAB_LABELS[t]}
                </Text>
              </Box>
            );
          })}
        </Box>

        {settingsWarning ? <DimAnnotation text={settingsWarning} /> : null}

        {tab === 'general' ? (
          <Box flexDirection="column">
            <Box flexDirection="row">
              <Text color={colors.accent} wrap="truncate-end">{GENERAL_SETTINGS_ROWS[generalCursor] === 'quit-shortcut' ? '›' : ' '}</Text>
              <CheckboxListItem
                label="Enable 'q' to quit"
                selected={GENERAL_SETTINGS_ROWS[generalCursor] === 'quit-shortcut'}
                state={settings.general.quitShortcutEnabled ? 'checked' : 'unchecked'}
              />
            </Box>
            <Box flexDirection="row">
              <Text color={colors.accent} wrap="truncate-end">{GENERAL_SETTINGS_ROWS[generalCursor] === 'editor-command' ? '›' : ' '}</Text>
              {generalEditing !== null ? (
                <TextInputLine label="Editor command" value={generalEditing.value} cursor={generalEditing.cursor} focused />
              ) : (
                <Text color={GENERAL_SETTINGS_ROWS[generalCursor] === 'editor-command' ? colors.accent : colors.text} wrap="truncate-end">
                  Editor command:{' '}
                  {settings.general.editorCommand !== '' ? (
                    <Text color={colors.accent}>{settings.general.editorCommand}</Text>
                  ) : (
                    <Text color={colors['text-dim']} wrap="truncate-end">{EDITOR_COMMAND_PLACEHOLDER_TEXT}</Text>
                  )}
                </Text>
              )}
            </Box>
            {GENERAL_SETTINGS_ROWS[generalCursor] === 'quit-shortcut' ? (
              <DimAnnotation text="Unchecked: 'q' types as a normal character; quit is still reachable via the :quit command." />
            ) : generalEditing !== null ? (
              <DimAnnotation text="<repo> is replaced by the repo path (appended when absent), e.g. code <repo>. Empty: $EDITOR, else vi." />
            ) : (
              <DimAnnotation text="Run by the Update zone's “Open in editor” choice on a blocked repo, e.g. code <repo>." />
            )}
          </Box>
        ) : null}

        {tab === 'update' ? (
          <Box flexDirection="column">
            {UPDATE_SETTINGS_ROWS.map((row, index) => {
              const highlighted = index === updateCursor;
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
            <DimAnnotation text={UPDATE_SETTINGS_ROW_HINTS[UPDATE_SETTINGS_ROWS[updateCursor] ?? 'concurrency']} />
          </Box>
        ) : null}

        {tab === 'command-palette' && paletteGroup === null ? (
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

        {tab === 'command-palette' && paletteGroup === 'grid-max-rows' ? (
          <Box flexDirection="column">
            <Text color={colors.text} wrap="truncate-end">
              Command grid max rows: <Text color={colors.accent}>{settings.commandPalette.gridMaxRows}</Text>
            </Text>
            <DimAnnotation text="Rows of the command grid before it scrolls." />
          </Box>
        ) : null}

        {tab === 'command-palette' && paletteGroup === 'history-size' ? (
          <Box flexDirection="column">
            <Text color={colors.text} wrap="truncate-end">
              Command history size: <Text color={colors.accent}>{settings.commandPalette.historySize}</Text>
            </Text>
            <DimAnnotation text={`Steps of ${FILTER_HISTORY_SIZE_STEP} entries.`} />
          </Box>
        ) : null}

        {tab === 'command-palette' && paletteGroup === 'history-dedup' ? (
          <Box flexDirection="column">
            <CheckboxListItem
              label="Deduplicate command history"
              state={settings.commandPalette.historyDedup ? 'checked' : 'unchecked'}
            />
            <DimAnnotation text="On: a repeated command moves to the front. Off: only a repeat of the latest is merged." />
          </Box>
        ) : null}

        {tab === 'command-palette' && paletteGroup === 'clear-history' ? (
          <Box flexDirection="column">
            <Text color={colors.text} wrap="truncate-end">Clear the command history</Text>
            <DimAnnotation text="Empties the `:` bar's recall list; the filter histories are untouched." />
          </Box>
        ) : null}

        {tab === 'logs' && logsGroup === null ? (
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

        {tab === 'logs' && logsGroup === 'buffer-size' ? (
          <Box flexDirection="column">
            <Text color={colors.text} wrap="truncate-end">
              Log buffer size (lines per pane): <Text color={colors.accent}>{settings.logs.bufferSize}</Text>
            </Text>
            <DimAnnotation
              text={`Steps of ${LOG_BUFFER_SIZE_STEP} lines; a digit sets a x100 preset. Applies to new streams only — already-running panes keep their current buffer size.`}
            />
          </Box>
        ) : null}

        {tab === 'logs' && logsGroup === 'start-with-history' ? (
          <Box flexDirection="column">
            <CheckboxListItem
              label="Start streaming with the most recent history"
              state={settings.logs.startWithHistory ? 'checked' : 'unchecked'}
            />
          </Box>
        ) : null}

        {tab === 'logs' && logsGroup === 'filter-history-size' ? (
          <Box flexDirection="column">
            <Text color={colors.text} wrap="truncate-end">
              Filter history size (entries per list): <Text color={colors.accent}>{settings.logs.filterHistorySize}</Text>
            </Text>
            <DimAnnotation text={`Steps of ${FILTER_HISTORY_SIZE_STEP} entries.`} />
          </Box>
        ) : null}

        {tab === 'logs' && logsGroup === 'filter-history-grid' ? (
          <Box flexDirection="column">
            <Text color={colors.text} wrap="truncate-end">
              Filter history grid max rows: <Text color={colors.accent}>{settings.logs.filterHistoryGridMaxRows}</Text>
            </Text>
            <DimAnnotation text="Steps of 1 row; a digit sets the value." />
          </Box>
        ) : null}

        {tab === 'logs' && logsGroup === 'filter-history-dedup' ? (
          <Box flexDirection="column">
            <CheckboxListItem
              label="Dedup filter history (one instance per filter)"
              state={settings.logs.filterHistoryDedup ? 'checked' : 'unchecked'}
            />
            <DimAnnotation text="Checked: reusing a filter moves it to the most recent place instead of storing it twice." />
          </Box>
        ) : null}

        {tab === 'logs' && logsGroup === 'clear-history' && !logsClearServiceOpen ? (
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

        {tab === 'logs' && logsGroup === 'clear-history' && logsClearServiceOpen ? (
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

        {tab === 'edts' && !drilledIn ? (
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
          </Box>
        ) : null}

        {tab === 'edts' && edtsGroup === 'hint-visibility' ? (
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

        {tab === 'edts' && edtsGroup === 'action-types' ? (
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

        {tab === 'edts' && edtsGroup === 'branch-dropdown-rows' ? (
          <Box flexDirection="column">
            <Text color={colors.text} wrap="truncate-end">
              Branch dropdown max rows: <Text color={colors.accent}>{settings.edts.branchDropdownMaxRows}</Text>
            </Text>
            <DimAnnotation text="Caps the lines of the autocomplete dropdown, “N more” indicators included." />
          </Box>
        ) : null}
      </Box>
    </ModalDialog>
  );
}
