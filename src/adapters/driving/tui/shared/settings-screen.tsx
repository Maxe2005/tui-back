// tui/shared/settings-screen: the `:settings` overlay — a tab-organized modal (General / EDTs /
// Command Palette / Logs / Update / st / Services) reachable only through the `settings` command. Every change applies
// to the live store and persists immediately via `updateSettings` (no save step, no dirty
// state). The EDTs and Logs tabs open on a group list that Enter drills into, so Esc handling
// lives here (`onClose`): only this component knows whether Esc steps back or closes.
import { useEffect, useState } from 'react';
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
  MAX_HISTORY_DEPTH,
  MAX_INPUT_HISTORY_SIZE,
  MAX_MAX_COMMITS_SCANNED,
  MIN_HISTORY_DEPTH,
  MIN_MAX_COMMITS_SCANNED,
  MAX_GRID_MAX_ROWS,
  MAX_LOG_BUFFER_SIZE,
  MIN_EDTS_BRANCH_DROPDOWN_MAX_ROWS,
  MIN_FILTER_HISTORY_GRID_MAX_ROWS,
  MIN_INPUT_HISTORY_SIZE,
  MIN_GRID_MAX_ROWS,
  MIN_LOG_BUFFER_SIZE,
  MAX_UPDATE_CONCURRENCY,
  MIN_UPDATE_CONCURRENCY,
  cycleSwitchRestartMode,
  cycleRealignScope,
  type RealignScope,
  type Settings,
  type SwitchRestartMode,
  type UpdateMergeSourceDefault,
} from '../../../../core/ports/settings.js';
import { StateLine } from './components/state-line.js';
import { GLOBAL_RULES_KEY } from '../../../../core/logs/rule-sets.js';
import { BoundedList } from './components/bounded-list.js';
import type { BranchDivergenceEntryError, ServiceBranchDivergence } from '../../../../core/edt/list.js';
import { SETTINGS_LIST_CHROME_ROWS, SETTINGS_TABS, SETTINGS_TAB_LABELS, nextSettingsTab, resolveSettingsTabState, type SettingsTab } from './settings/settings-tabs.logic.js';
import { buildServicesSettingsRows, resolveServicesSettingsKey } from './settings/services.logic.js';
import { SHARED_TYPES_SETTINGS_ROWS, resolveSharedTypesSettingsKey } from './settings/shared-types.logic.js';
import { EDITOR_COMMAND_PLACEHOLDER_TEXT, GENERAL_SETTINGS_ROWS, resolveGeneralSettingsKey } from './settings/general.logic.js';
import { UPDATE_SETTINGS_ROWS, UPDATE_SETTINGS_ROW_HINTS, resolveUpdateSettingsKey } from './settings/update.logic.js';
import { FILTER_HISTORY_SIZE_STEP, PALETTE_SETTINGS_GROUPS, type PaletteSettingsGroupId, adjustFilterHistoryGridMaxRows, adjustFilterHistorySize, adjustGridMaxRows, parseFilterHistoryGridMaxRowsDigit, parseGridMaxRowsDigit } from './settings/palette.logic.js';
import { LOGS_CLEAR_ROWS, LOGS_CLEAR_ROW_LABELS, LOGS_RULES_ROWS, LOGS_RULES_ROW_LABELS, LOGS_SETTINGS_GROUPS, LOG_BUFFER_SIZE_STEP, type LogsRulesConfirm, type LogsSettingsGroupId, adjustLogBufferSize, parseLogBufferSizeDigit } from './settings/logs.logic.js';
import { HIDEABLE_ACTION_HINTS, HIDEABLE_ACTION_TYPES, REALIGN_SCOPE_LABELS, SETTINGS_GROUPS, SWITCH_RESTART_LABELS, type SettingsGroupId, adjustBranchDropdownMaxRows, parseBranchDropdownMaxRowsDigit, toggleHiddenHint } from './settings/edts.logic.js';
export * from './settings/edts.logic.js';
export * from './settings/logs.logic.js';
export * from './settings/palette.logic.js';
export * from './settings/update.logic.js';
export * from './settings/general.logic.js';
export * from './settings/shared-types.logic.js';
export * from './settings/services.logic.js';
export * from './settings/settings-tabs.logic.js';

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
      return state.edtsGroup === null ? 'settings-groups' : GROUP_FOOTER_CONTEXTS[state.edtsGroup];
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
  const clearLogsScopeRules = useStore((state) => state.clearLogsScopeRules);
  const clearLogsRuleSets = useStore((state) => state.clearLogsRuleSets);
  const logsRuleSets = useStore((state) => state.logsRuleSets);
  const logsGlobalFilter = useStore((state) => state.logsGlobalFilter);
  const logsPaneFilters = useStore((state) => state.logsPaneFilters);
  const edtsBranches = useStore((state) => state.edtsBranches);
  const edtsErrors = useStore((state) => state.edtsErrors);
  const loadEdtsBranches = useStore((state) => state.loadEdtsBranches);

  const [tab, setTab] = useState<SettingsTab>(initialTab);
  // The General tab's row cursor + in-progress editor-command edit (null when browsing).
  // The edit is a local draft: only Enter persists it, Esc drops it.
  const [sharedTypesCursor, setSharedTypesCursor] = useState(0);
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
  // The "persisted filter rules" group: its two-row list, the scope picker below the first row,
  // and the confirmation every action waits for.
  const [logsRulesRowCursor, setLogsRulesRowCursor] = useState(0);
  const [logsRulesScopeOpen, setLogsRulesScopeOpen] = useState(false);
  const [logsRulesScopeCursor, setLogsRulesScopeCursor] = useState(0);
  const [logsRulesConfirm, setLogsRulesConfirm] = useState<LogsRulesConfirm | null>(null);
  // Every scope with a persisted list: global, each listed service, and (so they can still be
  // cleared) services that are no longer listed.
  const listedPaths = new Set(logsServices.map((service) => service.path));
  const logsRulesScopes = [
    { key: GLOBAL_RULES_KEY, label: 'Global filter', count: logsGlobalFilter.rules.length },
    ...logsServices.map((service) => ({ key: service.path, label: service.service, count: logsPaneFilters[service.path]?.rules.length ?? 0 })),
    ...Object.entries(logsPaneFilters)
      .filter(([path, scope]) => !listedPaths.has(path) && scope.rules.length > 0)
      .map(([path, scope]) => ({ key: path, label: `${path} (not listed)`, count: scope.rules.length })),
  ];
  const logsRulesScopeIndex = Math.min(logsRulesScopeCursor, Math.max(logsRulesScopes.length - 1, 0));
  // The Command Palette tab's group list (same shape as the Logs tab's).
  const [paletteGroup, setPaletteGroup] = useState<PaletteSettingsGroupId | null>(initialPaletteGroup);
  const [paletteGroupCursor, setPaletteGroupCursor] = useState(0);
  // The Services tab's flat row list (clamped: a reload can shrink it under the cursor).
  const servicesRows = buildServicesSettingsRows(edtsBranches, edtsErrors);
  const [servicesCursorRaw, setServicesCursor] = useState(0);
  const servicesCursor = Math.min(servicesCursorRaw, Math.max(0, servicesRows.length - 1));
  // The Services tab owns its data: opened before any zone listed the services, it loads them
  // once on arrival (the slice ignores a call while a load is already in flight).
  useEffect(() => {
    if (tab === 'services' && useStore.getState().edtsBranches === null) {
      void loadEdtsBranches();
    }
  }, [tab, useStore, loadEdtsBranches]);

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
    settingsFooterContext(tab, {
      generalEditing: generalEditing !== null,
      edtsGroup,
      logsGroup,
      paletteGroup,
      logsRulesConfirming: logsRulesConfirm !== null,
    }),
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
      if (tab === 'logs' && logsRulesConfirm !== null) {
        setLogsRulesConfirm(null);
        return;
      }
      if (tab === 'logs' && logsRulesScopeOpen) {
        setLogsRulesScopeOpen(false);
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
      setLogsRulesScopeOpen(false);
      setLogsRulesConfirm(null);
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

    if (tab === 'shared-types') {
      const step = resolveSharedTypesSettingsKey(input, key, sharedTypesCursor, settings.sharedTypes);
      if (step.type === 'move') {
        setSharedTypesCursor(step.cursor);
      } else if (step.type === 'set-number') {
        void updateSettings({ sharedTypes: { [step.id]: step.value } });
      } else if (step.type === 'toggle') {
        void updateSettings({ sharedTypes: { [step.id]: !settings.sharedTypes[step.id] } });
      }
      return;
    }

    if (tab === 'services') {
      const step = resolveServicesSettingsKey(input, key, servicesCursor, servicesRows);
      if (step.type === 'move') {
        setServicesCursor(step.cursor);
      } else if (step.type === 'toggle') {
        // Checked = enabled, so the stored list holds the unchecked ones; persisted at once. Read
        // from the live store, not this render's snapshot: two quick presses before a re-render
        // must each toggle on top of the previous one.
        const disabled = useStore.getState().settings.services.healthCheckDisabled;
        void updateSettings({ services: { healthCheckDisabled: toggleHiddenHint(disabled, step.service) } });
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

      // "Persisted filter rules": every action asks first (y/Enter accepts, anything else cancels),
      // and each clears only what it targets — one scope's list, or the library.
      if (logsGroup === 'filter-rules') {
        if (logsRulesConfirm !== null) {
          if (input === 'y' || input === 'Y' || key.return) {
            if (logsRulesConfirm.kind === 'scope') {
              clearLogsScopeRules(logsRulesConfirm.key);
              setLogsRulesScopeOpen(false);
            } else {
              clearLogsRuleSets();
            }
          }
          setLogsRulesConfirm(null);
          return;
        }
        if (logsRulesScopeOpen) {
          const moved = nextCursorForKey(key, logsRulesScopeIndex, logsRulesScopes.length);
          if (moved !== null) {
            setLogsRulesScopeCursor(moved);
            return;
          }
          const scope = logsRulesScopes[logsRulesScopeIndex];
          if (key.return && scope !== undefined && scope.count > 0) {
            setLogsRulesConfirm({ kind: 'scope', key: scope.key, label: scope.label });
          }
          return;
        }
        const moved = nextCursorForKey(key, logsRulesRowCursor, LOGS_RULES_ROWS.length);
        if (moved !== null) {
          setLogsRulesRowCursor(moved);
          return;
        }
        const row = LOGS_RULES_ROWS[logsRulesRowCursor];
        if (row === 'clear-scope' && key.return) {
          setLogsRulesScopeOpen(true);
          setLogsRulesScopeCursor(0);
        } else if (row === 'delete-library' && key.return && logsRuleSets.length > 0) {
          setLogsRulesConfirm({ kind: 'library' });
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

      if (logsGroup === 'restart-mode') {
        if (key.leftArrow || key.rightArrow || input === ' ') {
          void updateSettings({ logs: { restartMode: settings.logs.restartMode === 'clean' ? 'simple' : 'clean' } });
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

    if (edtsGroup === 'switch-restart') {
      if (key.leftArrow) {
        void updateSettings({ switch: { restartMode: cycleSwitchRestartMode(settings.switch.restartMode, -1) } });
      } else if (key.rightArrow || input === ' ') {
        void updateSettings({ switch: { restartMode: cycleSwitchRestartMode(settings.switch.restartMode, 1) } });
      }
      return;
    }

    if (edtsGroup === 'heal-restart') {
      // Two values only: Left, Right and Space all flip simple ↔ clean.
      if (key.leftArrow || key.rightArrow || input === ' ') {
        void updateSettings({ dashboard: { restartMode: settings.dashboard.restartMode === 'clean' ? 'simple' : 'clean' } });
      }
      return;
    }

    if (edtsGroup === 'realign-scope' || edtsGroup === 'realign-restart') {
      const direction = key.leftArrow ? -1 : key.rightArrow || input === ' ' ? 1 : null;
      if (direction === null) {
        return;
      }
      void updateSettings({
        realign:
          edtsGroup === 'realign-scope'
            ? { defaultScope: cycleRealignScope(settings.realign.defaultScope, direction) }
            : { restartMode: cycleSwitchRestartMode(settings.realign.restartMode, direction) },
      });
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

        {tab === 'shared-types' ? (
          <Box flexDirection="column">
            {SHARED_TYPES_SETTINGS_ROWS.map((row, index) => (
              <Box key={row.id} flexDirection="row">
                <Text color={colors.accent} wrap="truncate-end">{index === sharedTypesCursor ? '›' : ' '}</Text>
                {row.kind === 'checkbox' ? (
                  <CheckboxListItem label={row.label} selected={index === sharedTypesCursor} state={settings.sharedTypes[row.id] ? 'checked' : 'unchecked'} />
                ) : (
                  <Text color={index === sharedTypesCursor ? colors.accent : colors.text} wrap="truncate-end">
                    {row.label}: <Text color={colors.accent}>{settings.sharedTypes[row.id]}</Text>
                  </Text>
                )}
              </Box>
            ))}
            {(() => {
              const focused = SHARED_TYPES_SETTINGS_ROWS[sharedTypesCursor];
              return focused?.kind === 'number' ? <DimAnnotation text={focused.hint} /> : null;
            })()}
          </Box>
        ) : null}

        {tab === 'services' ? (
          <Box flexDirection="column">
            {servicesRows.length === 0 ? <StateLine kind="empty" subject="manifest services loaded" /> : null}
            <BoundedList
              items={servicesRows}
              chromeRows={SETTINGS_LIST_CHROME_ROWS}
              cursorIndex={servicesCursor}
              renderItem={(row, index) => {
                const highlighted = index === servicesCursor;
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
        ) : null}

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

        {tab === 'logs' && logsGroup === 'restart-mode' ? (
          <Box flexDirection="column">
            <Text color={colors.text} wrap="truncate-end">
              Restart mode (R in Logs): <Text color={colors.accent}>{settings.logs.restartMode}</Text>
            </Text>
            <DimAnnotation text="simple: plain container restart. clean: run the manifest's clean-restart recipe, falling back to a simple restart when none is declared." />
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

        {tab === 'logs' && logsGroup === 'filter-rules' && !logsRulesScopeOpen ? (
          <Box flexDirection="column">
            {LOGS_RULES_ROWS.map((row, index) => {
              const highlighted = index === logsRulesRowCursor;
              return (
                <Box key={row} flexDirection="row">
                  <Text color={colors.accent} wrap="truncate-end">{highlighted ? '›' : ' '}</Text>
                  <Text color={highlighted ? colors.accent : colors.text} wrap="truncate-end">
                    {LOGS_RULES_ROW_LABELS[row]}
                    {row === 'delete-library' ? ` (${logsRuleSets.length} ${logsRuleSets.length === 1 ? 'set' : 'sets'})` : ''}
                  </Text>
                </Box>
              );
            })}
            <DimAnnotation text="Active rule lists and the library are cleared separately; each asks first." />
          </Box>
        ) : null}

        {tab === 'logs' && logsGroup === 'filter-rules' && logsRulesScopeOpen ? (
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

        {tab === 'logs' && logsGroup === 'filter-rules' && logsRulesConfirm !== null ? (
          <Text color={colors.warning} wrap="truncate-end">
            {logsRulesConfirm.kind === 'scope'
              ? `Clear the persisted rules of ${logsRulesConfirm.label}? (y/Enter = yes, Esc = no)`
              : `Delete all ${logsRuleSets.length} saved rule sets? (y/Enter = yes, Esc = no)`}
          </Text>
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

        {tab === 'edts' && edtsGroup === 'switch-restart' ? (
          <Box flexDirection="column">
            <Text color={colors.text} wrap="truncate-end">
              Restart services after an EDT switch: <Text color={colors.accent}>{SWITCH_RESTART_LABELS[settings.switch.restartMode]}</Text>
            </Text>
            <DimAnnotation text="Default for the switch dialog and `edt switch --restart`. Clean restart falls back to a simple restart where no recipe exists." />
          </Box>
        ) : null}

        {tab === 'edts' && edtsGroup === 'realign-scope' ? (
          <Box flexDirection="column">
            <Text color={colors.text} wrap="truncate-end">
              Services pre-selected for a realign: <Text color={colors.accent}>{REALIGN_SCOPE_LABELS[settings.realign.defaultScope]}</Text>
            </Text>
            <DimAnnotation text="Initial preset of the realign dialog and `realign --scope` default. Only drifted services are ever listed." />
          </Box>
        ) : null}

        {tab === 'edts' && edtsGroup === 'realign-restart' ? (
          <Box flexDirection="column">
            <Text color={colors.text} wrap="truncate-end">
              Restart services after a realign: <Text color={colors.accent}>{SWITCH_RESTART_LABELS[settings.realign.restartMode]}</Text>
            </Text>
            <DimAnnotation text="Default for the realign dialog and `realign --restart`. Clean restart falls back to a simple restart where no recipe exists." />
          </Box>
        ) : null}

        {tab === 'edts' && edtsGroup === 'heal-restart' ? (
          <Box flexDirection="column">
            <Text color={colors.text} wrap="truncate-end">
              Restart mode for a heal: <Text color={colors.accent}>{SWITCH_RESTART_LABELS[settings.dashboard.restartMode]}</Text>
            </Text>
            <DimAnnotation text="Default for the Dashboard heal and `heal --restart`. Clean restart falls back to a simple restart where no recipe exists." />
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
