// tui/shared/settings-screen: story 2.19's `:settings` overlay — a tab-organized
// `modal-dialog` instance (General / EDTs / Command Palette), reachable exclusively through
// the registered `settings` command inside the `:` command bar (mirrors
// repo-registry-screen.tsx's own precedent, never a raw keypress). Every change applies to
// the live store and persists to settings.yaml immediately via the store's `updateSettings`
// action — there is no separate save step and no local "dirty" state here.
//
// Testability convention (render-to-string.ts): the shared renderToString harness's fake
// stdin never emits data, so a useInput callback itself is never invoked by any test in this
// repo — every key-handling decision below is a pure, directly-testable function; useInput
// only interprets the raw Ink Key and dispatches the pure result (mirrors
// repo-registry-screen.tsx's typeRootInputChar/moveCandidateCursor and command-bar.tsx's
// resolveTabPress).
//
// EDTs-tab token list (Design Notes): the three hideable hint tokens below are exactly the
// `PaneFocus` contexts edts-zone.tsx's `formatAvailableActionsHint` (story 2.18, its
// formerly-`formatEdtActionHistory`-embedded hint line) emits one hint string for — 'edts',
// 'edt-services', 'other-services' — never invented placeholder ids.
//
// Amended 2026-08-28 (Sprint Change Proposal): the EDTs tab now holds two distinct settings
// groups ("Hint visibility" above, "Recent action types" below) behind a drill-down — first
// opening the tab shows an Up/Down-navigable group list, `Enter` drills into that group's own
// checkbox list, `Esc` steps back out to the group list (only at this tab; General/Command
// Palette stay single-level). This is why Esc-close moves from AppShell's centralized handling
// (registryScreenOpen's precedent) to a self-contained `onClose` prop here, mirroring
// command-bar.tsx's own self-contained Esc pattern — AppShell no longer knows or needs to know
// how deep the EDTs tab is drilled.
import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { CheckboxListItem } from './components/checkbox-list-item.js';
import { DimAnnotation } from './components/dim-annotation.js';
import { ModalDialog } from './components/modal-dialog.js';
import { colors, spacing, typography } from './theme/theme.js';
import { useAppStore, type AppStore } from '../store/app-store.js';
import {
  MAX_FILTER_HISTORY_GRID_MAX_ROWS,
  MAX_FILTER_HISTORY_SIZE,
  MAX_GRID_MAX_ROWS,
  MAX_LOG_BUFFER_SIZE,
  MIN_FILTER_HISTORY_GRID_MAX_ROWS,
  MIN_FILTER_HISTORY_SIZE,
  MIN_GRID_MAX_ROWS,
  MIN_LOG_BUFFER_SIZE,
} from '../../../../core/ports/settings.js';

export type SettingsTab = 'general' | 'edts' | 'command-palette' | 'logs';

export const SETTINGS_TABS: readonly SettingsTab[] = ['general', 'edts', 'command-palette', 'logs'];

export const SETTINGS_TAB_LABELS: Record<SettingsTab, string> = {
  general: 'General',
  edts: 'EDTs',
  'command-palette': 'Command Palette',
  logs: 'Logs',
};

// AC1: Left/Right/Tab all cycle in the same General -> EDTs -> Command Palette -> General
// order (SETTINGS_TABS' own declared order) — Left and Tab both step forward here, deliberately
// simpler than zones.ts's bidirectional nextZoneId since there's no wrap-skip/omitted-tab
// concern (every settings tab is always reachable).
export function nextSettingsTab(current: SettingsTab, direction: 1 | -1): SettingsTab {
  const index = SETTINGS_TABS.indexOf(current);
  const nextIndex = (index + direction + SETTINGS_TABS.length) % SETTINGS_TABS.length;
  return SETTINGS_TABS[nextIndex]!;
}

export type SettingsTabState = {
  active: boolean;
  labelColor: string;
  backgroundColor: string;
  bold: boolean;
};

// Mirrors zone-tab-bar.tsx's resolveZoneTabState active/inactive treatment at a smaller
// scale (Boundaries: "visually mirroring zone-tab-bar.tsx's active/inactive treatment") — no
// strikethrough/badge here, since settings tabs are never manifest-gated or event-badged.
export function resolveSettingsTabState(tab: SettingsTab, activeTab: SettingsTab): SettingsTabState {
  const active = tab === activeTab;
  return {
    active,
    labelColor: active ? colors.background : colors['text-dim'],
    backgroundColor: active ? colors.accent : colors.background,
    bold: active ? typography['active-tab'].bold : typography.label.bold,
  };
}

// Command Palette tab: Story 2.17's COMMAND_GRID_MAX_ROWS default (8), now user-overridable.
// Clamped to a sane, always-positive range — 0/negative would break groupCommandsByColumn's
// own `Math.max(1, maxRows)` floor, and the zod schema enforces the same [MIN, MAX] bound
// (core/ports/settings.ts is the single source of truth for both, so they can't drift apart).
// Re-exported here so existing imports of these two constants from this module keep working.
export { MIN_GRID_MAX_ROWS, MAX_GRID_MAX_ROWS };

export function clampGridMaxRows(value: number): number {
  return Math.min(Math.max(value, MIN_GRID_MAX_ROWS), MAX_GRID_MAX_ROWS);
}

export function adjustGridMaxRows(current: number, direction: 'up' | 'down'): number {
  return clampGridMaxRows(current + (direction === 'up' ? 1 : -1));
}

// A typed digit sets the value directly (I/O matrix: "Up/Down or typed digit"). Only a single
// digit 1-9 is meaningful — '0' is never a valid gridMaxRows (zod's `.positive()`), and any
// non-digit character is ignored rather than appended (this is a value-set field, not free text).
export function parseGridMaxRowsDigit(input: string): number | null {
  if (!/^[1-9]$/.test(input)) {
    return null;
  }
  return clampGridMaxRows(Number(input));
}

// Logs tab (story 5.1): settings.logs.bufferSize, reusing the exact clamp/adjust/parse-digit/
// render idiom the Command Palette tab established above for gridMaxRows. Scaled for a much
// wider range (50-5000 vs. 1-99): Up/Down steps by LOG_BUFFER_SIZE_STEP rather than 1 (a
// single-line step would take dozens of keypresses to cross the range), and a typed digit
// 1-9 is a quick preset (digit x 100, e.g. '5' -> 500) rather than the literal digit — the
// same "single keystroke sets a sane value directly" spirit as parseGridMaxRowsDigit, just
// rescaled to a range where the literal digit itself is never a meaningful buffer size.
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

// Logs tab (story 5.4): settings.logs.filterHistorySize/filterHistoryGridMaxRows, same clamp/
// adjust idiom as bufferSize/gridMaxRows above. filterHistorySize has no digit preset (its
// range doesn't lend itself to one the way bufferSize's x100 or gridMaxRows' literal digit
// do) — Left/Right (see the row-cursor model below) is its only adjustment.
export const FILTER_HISTORY_SIZE_STEP = 5;
export { MIN_FILTER_HISTORY_SIZE, MAX_FILTER_HISTORY_SIZE };

export function clampFilterHistorySize(value: number): number {
  return Math.min(Math.max(value, MIN_FILTER_HISTORY_SIZE), MAX_FILTER_HISTORY_SIZE);
}

export function adjustFilterHistorySize(current: number, direction: 'up' | 'down'): number {
  return clampFilterHistorySize(current + (direction === 'up' ? FILTER_HISTORY_SIZE_STEP : -FILTER_HISTORY_SIZE_STEP));
}

// filterHistoryGridMaxRows mirrors gridMaxRows' own [1, 99] range and digit-preset convention
// exactly, but through its own independent constants (Boundaries: "independent of
// commandPalette.gridMaxRows").
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

// EDTs tab: the hideable per-context action hints (story 2.18's formatAvailableActionsHint).
export type HideableActionHint = { id: string; label: string };

export const HIDEABLE_ACTION_HINTS: readonly HideableActionHint[] = [
  { id: 'edts', label: 'EDT selector — "[Enter] Switch" / "[Enter] Modify"' },
  { id: 'edt-services', label: 'EDT services — "[Enter] Remove / Change branch"' },
  { id: 'other-services', label: 'Other services — "[Enter] Add to EDT"' },
];

// Generic clamped cursor mover — reused for the EDTs tab's group-list cursor, its
// "Hint visibility" checkbox cursor, and its "Recent action types" checkbox cursor (all three
// are just an index into a small fixed-length list; the name predates the group-list level but
// the logic was already list-agnostic).
export function moveHintCursor(current: number, direction: 'up' | 'down', length: number): number {
  if (length === 0) {
    return 0;
  }
  const next = direction === 'down' ? current + 1 : current - 1;
  return Math.min(Math.max(next, 0), length - 1);
}

// Toggles `id` in `hidden`, never mutating the input array (mirrors
// repo-registry-screen.tsx's toggleCandidateSelection immutability convention, array-shaped
// since Settings.edts.hiddenActionHints/hiddenActionTypes are each a string[], not a Set).
// Reused as-is for both the "Hint visibility" and "Recent action types" checkbox groups — the
// toggle logic is identical, only which settings field it's applied to differs at the call site.
export function toggleHiddenHint(hidden: readonly string[], id: string): string[] {
  return hidden.includes(id) ? hidden.filter((existing) => existing !== id) : [...hidden, id];
}

// Amended 2026-08-28 (Sprint Change Proposal): the "Recent action types" group's rows — the
// literal `EdtActionLogEntry['actionType']` domain (app-store.ts), confirmed exhaustive by
// grepping every `logEdtAction(...)` call site in this file. A closed, hardcoded list, never
// derived from `edtActionLog` at runtime (an EDT with no `modify` entries yet must still offer
// to hide `modify`) — Design Notes: "Action-type list is closed, not derived".
export type HideableActionType = { id: string; label: string };

export const HIDEABLE_ACTION_TYPES: readonly HideableActionType[] = [
  { id: 'create', label: 'Create' },
  { id: 'switch', label: 'Switch' },
  { id: 'modify', label: 'Modify' },
];

// Amended 2026-08-28 (Sprint Change Proposal): the EDTs tab's group-list level, ahead of its
// two checkbox lists (Boundaries: "a single flat checkbox list would conflate two unrelated
// toggles"; Design Notes explains why this is a drill-down rather than a flat list or a nested
// tab strip).
export type SettingsGroupId = 'hint-visibility' | 'action-types';

export type SettingsGroup = { id: SettingsGroupId; label: string };

export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  { id: 'hint-visibility', label: 'Hint visibility' },
  { id: 'action-types', label: 'Recent action types' },
];

// Story 5.4: the Logs tab's row-cursor model, mirroring the EDTs tab's groupCursor/
// moveHintCursor precedent (Code Map) rather than each field claiming its own dedicated key —
// with six fields now on one tab (bufferSize, startWithHistory, the two new filter-history
// settings, and two clear actions), a flat row list with Up/Down navigation is the only way
// every field stays unambiguously reachable (Boundaries). Numeric rows are adjusted with
// Left/Right once highlighted (Up/Down are claimed by row navigation); the boolean row toggles
// with Space; the two action rows trigger on Enter.
export type LogsSettingsRowId =
  | 'bufferSize'
  | 'startWithHistory'
  | 'filterHistorySize'
  | 'filterHistoryGridMaxRows'
  | 'clear-global'
  | 'clear-service';

export const LOGS_SETTINGS_ROWS: readonly LogsSettingsRowId[] = [
  'bufferSize',
  'startWithHistory',
  'filterHistorySize',
  'filterHistoryGridMaxRows',
  'clear-global',
  'clear-service',
];

export const LOGS_SETTINGS_ROW_LABELS: Record<LogsSettingsRowId, string> = {
  bufferSize: 'Log buffer size (lines per pane)',
  startWithHistory: 'Start streaming with the most recent history',
  filterHistorySize: 'Filter history size (entries per list)',
  filterHistoryGridMaxRows: 'Filter history grid max rows',
  'clear-global': 'Clear global filter history',
  'clear-service': "Clear a service's filter history",
};

// Amended 2026-08-28 (Sprint Change Proposal): self-contained Esc handling, mirroring
// command-bar.tsx's own `onClose` pattern rather than repo-registry-screen.tsx's
// AppShell-centralized one — the EDTs tab's drill-down state (is a group open?) is local to
// this component, so only this component can decide whether Esc steps back a level or closes
// the whole screen (Boundaries: "Esc's meaning is now tab-aware"). `onClose` defaults to a
// no-op so a bare smoke-test render (no interaction) never crashes for lack of a prop.
export type SettingsScreenProps = {
  useStore?: AppStore;
  onClose?: () => void;
  // Test-only injection points (mirror edts-zone.tsx's `initialPaneFocus`): renderToString
  // performs one synchronous render-then-unmount pass and never observes a keypress (the
  // shared harness's fake stdin never emits data), so a smoke test can't Tab/Enter its way to
  // a specific tab/drilled-group otherwise. Production always starts on General, group list
  // (AC1, AC6).
  initialTab?: SettingsTab;
  initialEdtsGroup?: SettingsGroupId | null;
  // Story 5.4: same test-only injection idiom, for the Logs tab's "clear a service's history"
  // drill-down.
  initialLogsClearServiceOpen?: boolean;
};

export function SettingsScreen({
  useStore = useAppStore,
  onClose = () => {},
  initialTab = 'general',
  initialEdtsGroup = null,
  initialLogsClearServiceOpen = false,
}: SettingsScreenProps) {
  const settings = useStore((state) => state.settings);
  const settingsWarning = useStore((state) => state.settingsWarning);
  const updateSettings = useStore((state) => state.updateSettings);
  // Story 5.4: the Logs tab's clear actions and the service list its "clear this service" row
  // drills into.
  const clearGlobalFilterHistory = useStore((state) => state.clearGlobalFilterHistory);
  const clearServiceFilterHistory = useStore((state) => state.clearServiceFilterHistory);
  const edtsBranches = useStore((state) => state.edtsBranches);

  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [edtsGroup, setEdtsGroup] = useState<SettingsGroupId | null>(initialEdtsGroup);
  const [groupCursor, setGroupCursor] = useState(0);
  const [hintCursor, setHintCursor] = useState(0);
  const [actionTypeCursor, setActionTypeCursor] = useState(0);
  // Story 5.4: the Logs tab's own row cursor (LOGS_SETTINGS_ROWS) and its "clear a service's
  // history" row's drill-down state (mirrors edtsGroup/groupCursor's own shape one level down).
  const [logsRowCursor, setLogsRowCursor] = useState(0);
  const [logsClearServiceOpen, setLogsClearServiceOpen] = useState(initialLogsClearServiceOpen);
  const [logsClearServiceCursor, setLogsClearServiceCursor] = useState(0);
  const logsServices = edtsBranches ?? [];

  // AC6 (amended, story 5.4): drilled in on the EDTs tab's own group, or on the Logs tab's
  // "clear a service's history" list — every other combination is "not drilled in" for Esc
  // purposes.
  const drilledIn = (tab === 'edts' && edtsGroup !== null) || (tab === 'logs' && logsClearServiceOpen);

  useInput((input, key) => {
    if (key.escape) {
      if (tab === 'edts' && edtsGroup !== null) {
        // Steps back up to the group list — the whole settings screen stays open.
        setEdtsGroup(null);
        return;
      }
      if (tab === 'logs' && logsClearServiceOpen) {
        setLogsClearServiceOpen(false);
        return;
      }
      onClose();
      return;
    }

    // AC1 (amended): Tab always cycles the top-level tabs (never while drilled in). Left/Right
    // also cycle tabs — except on the Logs tab (story 5.4), which repurposes them to adjust its
    // own highlighted numeric row (see the row-cursor model below); Tab remains that tab's own
    // way back out to General/EDTs/Command Palette.
    if (!drilledIn && key.tab) {
      // Landing on (or leaving) the EDTs/Logs tab always resets to its own top level (AC6: "on
      // first opening the EDTs tab" — every arrival, not just the very first — extended to the
      // Logs tab's row cursor).
      setEdtsGroup(null);
      setGroupCursor(0);
      setLogsRowCursor(0);
      setLogsClearServiceOpen(false);
      setTab((current) => nextSettingsTab(current, 1));
      return;
    }
    if (!drilledIn && tab !== 'logs' && (key.leftArrow || key.rightArrow)) {
      const direction = key.leftArrow ? -1 : 1;
      setEdtsGroup(null);
      setGroupCursor(0);
      setTab((current) => nextSettingsTab(current, direction));
      return;
    }

    if (tab === 'general') {
      // Space toggles quitShortcutEnabled — General has no row cursor yet, mirroring the Logs
      // tab's single dedicated-key convention for a lone checkbox field.
      if (input === ' ') {
        void updateSettings({ general: { quitShortcutEnabled: !settings.general.quitShortcutEnabled } });
      }
      return;
    }

    if (tab === 'command-palette') {
      if (key.upArrow) {
        void updateSettings({
          commandPalette: { gridMaxRows: adjustGridMaxRows(settings.commandPalette.gridMaxRows, 'up') },
        });
        return;
      }
      if (key.downArrow) {
        void updateSettings({
          commandPalette: { gridMaxRows: adjustGridMaxRows(settings.commandPalette.gridMaxRows, 'down') },
        });
        return;
      }
      const digit = parseGridMaxRowsDigit(input);
      if (digit !== null) {
        void updateSettings({ commandPalette: { gridMaxRows: digit } });
        return;
      }
      return;
    }

    if (tab === 'logs') {
      // Story 5.4: the "clear a service's history" drill-down — its own small Up/Down list,
      // Enter/Space clears that one service's two lists (text + regex), Esc (handled above)
      // steps back to the row list.
      if (logsClearServiceOpen) {
        if (key.upArrow) {
          setLogsClearServiceCursor((current) => moveHintCursor(current, 'up', logsServices.length));
          return;
        }
        if (key.downArrow) {
          setLogsClearServiceCursor((current) => moveHintCursor(current, 'down', logsServices.length));
          return;
        }
        if (key.return || input === ' ') {
          const service = logsServices[logsClearServiceCursor];
          if (service) {
            clearServiceFilterHistory(service.path);
          }
        }
        return;
      }

      // Story 5.4: the row-cursor level — Up/Down navigates between bufferSize/
      // startWithHistory/filterHistorySize/filterHistoryGridMaxRows/clear-global/clear-service;
      // Left/Right adjusts whichever numeric row is highlighted (Up/Down are no longer free
      // for that, unlike the pre-5.4 single-dedicated-key convention); Space toggles the
      // boolean row; Enter triggers an action row.
      if (key.upArrow) {
        setLogsRowCursor((current) => moveHintCursor(current, 'up', LOGS_SETTINGS_ROWS.length));
        return;
      }
      if (key.downArrow) {
        setLogsRowCursor((current) => moveHintCursor(current, 'down', LOGS_SETTINGS_ROWS.length));
        return;
      }

      const row = LOGS_SETTINGS_ROWS[logsRowCursor];

      if (row === 'bufferSize') {
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

      if (row === 'startWithHistory') {
        if (input === ' ') {
          void updateSettings({ logs: { startWithHistory: !settings.logs.startWithHistory } });
        }
        return;
      }

      if (row === 'filterHistorySize') {
        if (key.leftArrow) {
          void updateSettings({ logs: { filterHistorySize: adjustFilterHistorySize(settings.logs.filterHistorySize, 'down') } });
          return;
        }
        if (key.rightArrow) {
          void updateSettings({ logs: { filterHistorySize: adjustFilterHistorySize(settings.logs.filterHistorySize, 'up') } });
        }
        return;
      }

      if (row === 'filterHistoryGridMaxRows') {
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

      if (row === 'clear-global') {
        if (key.return || input === ' ') {
          clearGlobalFilterHistory();
        }
        return;
      }

      if (row === 'clear-service') {
        if (key.return) {
          setLogsClearServiceOpen(true);
          setLogsClearServiceCursor(0);
        }
        return;
      }
      return;
    }

    if (tab !== 'edts') {
      return;
    }

    if (!drilledIn) {
      // AC6: the group-list level — Up/Down navigates, Enter drills in.
      if (key.upArrow) {
        setGroupCursor((current) => moveHintCursor(current, 'up', SETTINGS_GROUPS.length));
        return;
      }
      if (key.downArrow) {
        setGroupCursor((current) => moveHintCursor(current, 'down', SETTINGS_GROUPS.length));
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
      if (key.upArrow) {
        setHintCursor((current) => moveHintCursor(current, 'up', HIDEABLE_ACTION_HINTS.length));
        return;
      }
      if (key.downArrow) {
        setHintCursor((current) => moveHintCursor(current, 'down', HIDEABLE_ACTION_HINTS.length));
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

    // edtsGroup === 'action-types'
    if (key.upArrow) {
      setActionTypeCursor((current) => moveHintCursor(current, 'up', HIDEABLE_ACTION_TYPES.length));
      return;
    }
    if (key.downArrow) {
      setActionTypeCursor((current) => moveHintCursor(current, 'down', HIDEABLE_ACTION_TYPES.length));
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
    <ModalDialog title="SETTINGS" open onConfirm={() => {}} onCancel={onClose}>
      <Box flexDirection="column">
        <Box flexDirection="row">
          {SETTINGS_TABS.map((t) => {
            const state = resolveSettingsTabState(t, tab);
            return (
              <Box key={t} paddingX={spacing['1']} backgroundColor={state.backgroundColor}>
                <Text bold={state.bold} color={state.labelColor}>
                  {SETTINGS_TAB_LABELS[t]}
                </Text>
              </Box>
            );
          })}
        </Box>

        {settingsWarning ? <DimAnnotation text={settingsWarning} /> : null}

        {tab === 'general' ? (
          <Box flexDirection="column">
            <CheckboxListItem
              label="Enable 'q' to quit"
              state={settings.general.quitShortcutEnabled ? 'checked' : 'unchecked'}
            />
            <DimAnnotation text="Space to toggle. Unchecked: 'q' types as a normal character; quit is still reachable via the :quit command." />
          </Box>
        ) : null}

        {tab === 'command-palette' ? (
          <Box flexDirection="column">
            <Text color={colors.text}>
              Command grid max rows: <Text color={colors.accent}>{settings.commandPalette.gridMaxRows}</Text>
            </Text>
            <DimAnnotation text="Up/Down to adjust, or type a digit (1-9)." />
          </Box>
        ) : null}

        {tab === 'logs' && !logsClearServiceOpen ? (
          // Story 5.4: row-cursor level — every field lives in one Up/Down-navigable list
          // (mirrors the EDTs tab's group-list precedent), so all six fields stay
          // unambiguously reachable now that Up/Down can't also mean "adjust this field".
          <Box flexDirection="column">
            {LOGS_SETTINGS_ROWS.map((row, index) => {
              const highlighted = index === logsRowCursor;
              const cursorGlyph = highlighted ? '›' : ' ';
              const rowColor = highlighted ? colors.accent : colors.text;

              if (row === 'startWithHistory') {
                return (
                  <Box key={row} flexDirection="row">
                    <Text color={colors.accent}>{cursorGlyph}</Text>
                    <CheckboxListItem
                      label={LOGS_SETTINGS_ROW_LABELS[row]}
                      selected={highlighted}
                      state={settings.logs.startWithHistory ? 'checked' : 'unchecked'}
                    />
                  </Box>
                );
              }

              if (row === 'bufferSize' || row === 'filterHistorySize' || row === 'filterHistoryGridMaxRows') {
                const value =
                  row === 'bufferSize'
                    ? settings.logs.bufferSize
                    : row === 'filterHistorySize'
                      ? settings.logs.filterHistorySize
                      : settings.logs.filterHistoryGridMaxRows;
                return (
                  <Box key={row} flexDirection="row">
                    <Text color={colors.accent}>{cursorGlyph}</Text>
                    <Text color={rowColor}>
                      {' '}
                      {LOGS_SETTINGS_ROW_LABELS[row]}: <Text color={colors.accent}>{value}</Text>
                    </Text>
                  </Box>
                );
              }

              // 'clear-global' / 'clear-service'
              return (
                <Box key={row} flexDirection="row">
                  <Text color={colors.accent}>{cursorGlyph}</Text>
                  <Text color={rowColor}> {LOGS_SETTINGS_ROW_LABELS[row]}</Text>
                </Box>
              );
            })}
            <DimAnnotation text="Up/Down move between fields. Left/Right adjusts a numeric field. Space toggles a checkbox. Enter runs a clear action or drills into the service list." />
            <DimAnnotation text={`Log buffer size: ±${LOG_BUFFER_SIZE_STEP} per press, or a typed digit (1-9) for a x100 preset. Applies to new streams only — already-running panes keep their current buffer size.`} />
            <DimAnnotation text={`Filter history size: ±${FILTER_HISTORY_SIZE_STEP} per press.`} />
            <DimAnnotation text="Filter history grid max rows: ±1 per press, or a typed digit (1-9)." />
          </Box>
        ) : null}

        {tab === 'logs' && logsClearServiceOpen ? (
          // Story 5.4: the "clear a service's history" row's drill-down — a plain Up/Down list
          // over every manifest service (Boundaries: "drilled into a list of manifest
          // services"), never limited to the active EDT's own members.
          <Box flexDirection="column">
            {logsServices.length === 0 ? <DimAnnotation text="No manifest services loaded yet." /> : null}
            {logsServices.map((service, index) => {
              const highlighted = index === logsClearServiceCursor;
              return (
                <Box key={service.path} flexDirection="row">
                  <Text color={colors.accent}>{highlighted ? '›' : ' '}</Text>
                  <Text color={highlighted ? colors.accent : colors.text}>{service.service}</Text>
                </Box>
              );
            })}
            <DimAnnotation text="Enter to clear that service's filter history (text + regex). Esc for the field list." />
          </Box>
        ) : null}

        {tab === 'edts' && !drilledIn ? (
          // AC6: first opening the EDTs tab (or stepping back out of a group via Esc) shows
          // this Up/Down-navigable group list — no checkboxes at this level.
          <Box flexDirection="column">
            {SETTINGS_GROUPS.map((group, index) => {
              const highlighted = index === groupCursor;
              return (
                <Box key={group.id} flexDirection="row">
                  <Text color={colors.accent}>{highlighted ? '›' : ' '}</Text>
                  <Text color={highlighted ? colors.accent : colors.text}>{group.label}</Text>
                </Box>
              );
            })}
            <DimAnnotation text="Enter to open a group. Esc to close." />
          </Box>
        ) : null}

        {tab === 'edts' && edtsGroup === 'hint-visibility' ? (
          <Box flexDirection="column">
            {HIDEABLE_ACTION_HINTS.map((token, index) => {
              const highlighted = index === hintCursor;
              return (
                // review patch (repo-registry-screen.tsx precedent): checkbox-list-item's own
                // `selected` prop has no visible effect on its own — the highlighted row needs
                // its own `›` cursor glyph, rendered as a sibling column.
                <Box key={token.id} flexDirection="row">
                  <Text color={colors.accent}>{highlighted ? '›' : ' '}</Text>
                  <CheckboxListItem
                    label={token.label}
                    selected={highlighted}
                    state={settings.edts.hiddenActionHints.includes(token.id) ? 'checked' : 'unchecked'}
                  />
                </Box>
              );
            })}
            <DimAnnotation text="Space to toggle — checked hides that hint from the EDT detail pane. Esc for the group list." />
          </Box>
        ) : null}

        {tab === 'edts' && edtsGroup === 'action-types' ? (
          <Box flexDirection="column">
            {HIDEABLE_ACTION_TYPES.map((token, index) => {
              const highlighted = index === actionTypeCursor;
              return (
                <Box key={token.id} flexDirection="row">
                  <Text color={colors.accent}>{highlighted ? '›' : ' '}</Text>
                  <CheckboxListItem
                    label={token.label}
                    selected={highlighted}
                    state={settings.edts.hiddenActionTypes.includes(token.id) ? 'checked' : 'unchecked'}
                  />
                </Box>
              );
            })}
            <DimAnnotation text="Space to toggle — checked hides that action type from the Recent actions log. Esc for the group list." />
          </Box>
        ) : null}
      </Box>
    </ModalDialog>
  );
}
