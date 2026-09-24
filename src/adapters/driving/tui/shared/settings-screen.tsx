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
  MAX_EDTS_BRANCH_DROPDOWN_MAX_ROWS,
  MAX_FILTER_HISTORY_GRID_MAX_ROWS,
  MAX_FILTER_HISTORY_SIZE,
  MAX_GRID_MAX_ROWS,
  MAX_LOG_BUFFER_SIZE,
  MIN_EDTS_BRANCH_DROPDOWN_MAX_ROWS,
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
// do) — Left/Right (see the group model below) is its only adjustment.
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
//
// Branch autocomplete dropdown rows (shared BranchAutocompleteInput): the visible row count
// before the `… N more` overflow line, reusing the exact clamp/adjust/parse-digit idiom the
// Command Palette tab established for gridMaxRows (single source of truth: core's
// MIN/MAX_EDTS_BRANCH_DROPDOWN_MAX_ROWS, so the schema and the screen can't drift apart).
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

// Amended 2026-09-20 (visual-corruption fix): the Logs tab used to render all six fields as
// one flat row-cursor list (plus three DimAnnotation lines) inside ModalDialog, which has no
// width/height cap — in anything but a tall terminal, that content overflowed the visible
// viewport and Ink's diff-render corrupted the border/title above it ("SETTINGS" rendering as
// "--ttings") and overlapped the last two rows. Fixed the same way the EDTs tab already
// solves this (Design Notes there): a group-list level first, one field (or a small related
// cluster) per group, so no single screen renders more than a handful of lines. Five groups —
// four single-field ones plus "Clear history" holding both clear actions — chosen over fewer,
// denser groups so each screen stays minimal; the extra keystrokes to reach a field are an
// accepted trade-off (user decision, 2026-09-20).
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

// "Clear history" is the one Logs group holding more than a single field — its own small
// Up/Down row list, one level below the group list, mirroring the EDTs tab's own two-level
// depth (group list -> checkbox list) rather than growing a third top-level list.
export type LogsClearRowId = 'clear-global' | 'clear-service';

export const LOGS_CLEAR_ROWS: readonly LogsClearRowId[] = ['clear-global', 'clear-service'];

export const LOGS_CLEAR_ROW_LABELS: Record<LogsClearRowId, string> = {
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
  // Amended 2026-09-20: same test-only injection idiom, one level up, for the Logs tab's own
  // group list (mirrors initialEdtsGroup). Production always starts on the group list (null).
  initialLogsGroup?: LogsSettingsGroupId | null;
  // Story 5.4: same test-only injection idiom, for the Logs tab's "clear a service's history"
  // drill-down. Implies initialLogsGroup = 'clear-history' when that prop is left unset, since
  // the service list is only reachable from within that group.
  initialLogsClearServiceOpen?: boolean;
};

export function SettingsScreen({
  useStore = useAppStore,
  onClose = () => {},
  initialTab = 'general',
  initialEdtsGroup = null,
  initialLogsGroup = null,
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
  // Amended 2026-09-20: the Logs tab's own group list (mirrors edtsGroup/groupCursor exactly),
  // the "Clear history" group's own two-row list one level below that, and the "clear a
  // service's history" row's drill-down state one level below that again.
  const [logsGroup, setLogsGroup] = useState<LogsSettingsGroupId | null>(
    initialLogsGroup ?? (initialLogsClearServiceOpen ? 'clear-history' : null),
  );
  const [logsGroupCursor, setLogsGroupCursor] = useState(0);
  const [logsClearRowCursor, setLogsClearRowCursor] = useState(0);
  const [logsClearServiceOpen, setLogsClearServiceOpen] = useState(initialLogsClearServiceOpen);
  const [logsClearServiceCursor, setLogsClearServiceCursor] = useState(0);
  const logsServices = edtsBranches ?? [];

  // AC6 (amended 2026-09-20): drilled in on the EDTs tab's own group, or on any Logs tab group
  // (single-field group, "Clear history"'s own row list, or its "clear a service's history"
  // sub-list) — every other combination is "not drilled in" for Esc purposes.
  const drilledIn = (tab === 'edts' && edtsGroup !== null) || (tab === 'logs' && logsGroup !== null);

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
      if (tab === 'logs' && logsGroup !== null) {
        // Steps back up to the group list — the whole settings screen stays open.
        setLogsGroup(null);
        return;
      }
      onClose();
      return;
    }

    // AC1 (amended 2026-09-20): Tab always cycles the top-level tabs (never while drilled in).
    // Left/Right also cycle tabs at every tab's own top level — the Logs tab no longer needs an
    // exception here now that it has its own group list (see the group model below) rather than
    // a flat row list claiming Left/Right at the top level; Tab remains that tab's own way back
    // out to General/EDTs/Command Palette.
    if (!drilledIn && key.tab) {
      // Landing on (or leaving) the EDTs/Logs tab always resets to its own top level (AC6: "on
      // first opening the EDTs tab" — every arrival, not just the very first — extended to the
      // Logs tab's group list).
      setEdtsGroup(null);
      setGroupCursor(0);
      setLogsGroup(null);
      setLogsGroupCursor(0);
      setLogsClearServiceOpen(false);
      setTab((current) => nextSettingsTab(current, 1));
      return;
    }
    if (!drilledIn && (key.leftArrow || key.rightArrow)) {
      const direction = key.leftArrow ? -1 : 1;
      setEdtsGroup(null);
      setGroupCursor(0);
      setLogsGroup(null);
      setLogsGroupCursor(0);
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
      // steps back to the "Clear history" group's row list.
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

      // Amended 2026-09-20: "Clear history" is the one Logs group with more than one field —
      // its own small Up/Down row list, Enter triggers whichever action is highlighted.
      if (logsGroup === 'clear-history') {
        if (key.upArrow) {
          setLogsClearRowCursor((current) => moveHintCursor(current, 'up', LOGS_CLEAR_ROWS.length));
          return;
        }
        if (key.downArrow) {
          setLogsClearRowCursor((current) => moveHintCursor(current, 'down', LOGS_CLEAR_ROWS.length));
          return;
        }
        const row = LOGS_CLEAR_ROWS[logsClearRowCursor];
        if (row === 'clear-global' && (key.return || input === ' ')) {
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
      if (key.upArrow) {
        setLogsGroupCursor((current) => moveHintCursor(current, 'up', LOGS_SETTINGS_GROUPS.length));
        return;
      }
      if (key.downArrow) {
        setLogsGroupCursor((current) => moveHintCursor(current, 'down', LOGS_SETTINGS_GROUPS.length));
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

        {tab === 'logs' && logsGroup === null ? (
          // Amended 2026-09-20: the Logs tab's own group-list level, mirroring the EDTs tab's
          // group list exactly — every field lives behind its own (or a shared) group now,
          // rather than one flat six-row list, so no single screen overflows the modal.
          <Box flexDirection="column">
            {LOGS_SETTINGS_GROUPS.map((group, index) => {
              const highlighted = index === logsGroupCursor;
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

        {tab === 'logs' && logsGroup === 'buffer-size' ? (
          <Box flexDirection="column">
            <Text color={colors.text}>
              Log buffer size (lines per pane): <Text color={colors.accent}>{settings.logs.bufferSize}</Text>
            </Text>
            <DimAnnotation
              text={`Left/Right: ±${LOG_BUFFER_SIZE_STEP} per press, or a typed digit (1-9) for a x100 preset. Applies to new streams only — already-running panes keep their current buffer size. Esc for the group list.`}
            />
          </Box>
        ) : null}

        {tab === 'logs' && logsGroup === 'start-with-history' ? (
          <Box flexDirection="column">
            <CheckboxListItem
              label="Start streaming with the most recent history"
              state={settings.logs.startWithHistory ? 'checked' : 'unchecked'}
            />
            <DimAnnotation text="Space to toggle. Esc for the group list." />
          </Box>
        ) : null}

        {tab === 'logs' && logsGroup === 'filter-history-size' ? (
          <Box flexDirection="column">
            <Text color={colors.text}>
              Filter history size (entries per list): <Text color={colors.accent}>{settings.logs.filterHistorySize}</Text>
            </Text>
            <DimAnnotation text={`Left/Right: ±${FILTER_HISTORY_SIZE_STEP} per press. Esc for the group list.`} />
          </Box>
        ) : null}

        {tab === 'logs' && logsGroup === 'filter-history-grid' ? (
          <Box flexDirection="column">
            <Text color={colors.text}>
              Filter history grid max rows: <Text color={colors.accent}>{settings.logs.filterHistoryGridMaxRows}</Text>
            </Text>
            <DimAnnotation text="Left/Right: ±1 per press, or a typed digit (1-9). Esc for the group list." />
          </Box>
        ) : null}

        {tab === 'logs' && logsGroup === 'filter-history-dedup' ? (
          <Box flexDirection="column">
            <CheckboxListItem
              label="Dedup filter history (one instance per filter)"
              state={settings.logs.filterHistoryDedup ? 'checked' : 'unchecked'}
            />
            <DimAnnotation text="Space to toggle. Checked: reusing a filter moves it to the most recent place instead of storing it twice. Esc for the group list." />
          </Box>
        ) : null}

        {tab === 'logs' && logsGroup === 'clear-history' && !logsClearServiceOpen ? (
          // Amended 2026-09-20: "Clear history" is the one Logs group holding both clear
          // actions — its own small Up/Down row list, one level below the group list.
          <Box flexDirection="column">
            {LOGS_CLEAR_ROWS.map((row, index) => {
              const highlighted = index === logsClearRowCursor;
              return (
                <Box key={row} flexDirection="row">
                  <Text color={colors.accent}>{highlighted ? '›' : ' '}</Text>
                  <Text color={highlighted ? colors.accent : colors.text}>{LOGS_CLEAR_ROW_LABELS[row]}</Text>
                </Box>
              );
            })}
            <DimAnnotation text="Enter runs the highlighted action. Esc for the group list." />
          </Box>
        ) : null}

        {tab === 'logs' && logsGroup === 'clear-history' && logsClearServiceOpen ? (
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
            <DimAnnotation text="Enter to clear that service's filter history (text + regex). Esc for the row list." />
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

        {tab === 'edts' && edtsGroup === 'branch-dropdown-rows' ? (
          <Box flexDirection="column">
            <Text color={colors.text}>
              Branch dropdown max rows: <Text color={colors.accent}>{settings.edts.branchDropdownMaxRows}</Text>
            </Text>
            <DimAnnotation text="Up/Down or Left/Right to adjust, or type a digit (1-9). Caps the branch autocomplete dropdown before its … N more line. Esc for the group list." />
          </Box>
        ) : null}
      </Box>
    </ModalDialog>
  );
}
