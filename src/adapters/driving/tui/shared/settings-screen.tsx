// tui/shared/settings-screen: the `:settings` overlay — a tab-organized modal (General / EDTs /
// Command Palette / Logs / Update / st / Services) reachable only through the `settings` command. Every change applies
// to the live store and persists immediately via `updateSettings` (no save step, no dirty
// state). The EDTs and Logs tabs open on a group list that Enter drills into, so Esc handling
// lives here (`onClose`): only this component knows whether Esc steps back or closes.
import { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { useInput } from './hooks/use-input.js';
import { DimAnnotation } from './components/feedback/dim-annotation.js';
import { ModalDialog } from './components/dialogs/modal-dialog.js';
import type { TextInputState } from './components/inputs/text-edit.js';
import { useFooterContext } from './hooks/use-footer-context.js';
import { resolveFocusStep } from './keys/focus-navigation.js';
import { nextCursorForKey } from './keys/list-cursor.js';
import { spacing } from './theme/theme.js';
import { useAppStore, type AppStore } from '../store/app-store.js';
import { cycleSwitchRestartMode, cycleRealignScope } from '../../../../core/ports/settings.js';
import { GLOBAL_RULES_KEY } from '../../../../core/logs/rule-sets.js';
import { SETTINGS_TABS, SETTINGS_TAB_LABELS, nextSettingsTab, resolveSettingsTabState, type SettingsTab } from './settings/settings-tabs.logic.js';
import { buildServicesSettingsRows, resolveServicesSettingsKey } from './settings/services.logic.js';
import { resolveSharedTypesSettingsKey } from './settings/shared-types.logic.js';
import { GENERAL_SETTINGS_ROWS, resolveGeneralSettingsKey } from './settings/general.logic.js';
import { resolveUpdateSettingsKey } from './settings/update.logic.js';
import { PALETTE_SETTINGS_GROUPS, type PaletteSettingsGroupId, adjustFilterHistoryGridMaxRows, adjustFilterHistorySize, adjustGridMaxRows, parseFilterHistoryGridMaxRowsDigit, parseGridMaxRowsDigit } from './settings/palette.logic.js';
import { LOGS_CLEAR_ROWS, LOGS_RULES_ROWS, LOGS_SETTINGS_GROUPS, type LogsRulesConfirm, type LogsSettingsGroupId, adjustLogBufferSize, parseLogBufferSizeDigit } from './settings/logs.logic.js';
import { EDTS_TOP_LEVEL_ROW_COUNT, isSharedEdtToggleRow, HIDEABLE_ACTION_HINTS, HIDEABLE_ACTION_TYPES, SETTINGS_GROUPS, type SettingsGroupId, adjustBranchDropdownMaxRows, parseBranchDropdownMaxRowsDigit, toggleHiddenHint } from './settings/edts.logic.js';
import { settingsFooterContext } from './settings/footer-context.logic.js';
import { SharedTypesTab } from './settings/shared-types-tab.js';
import { ServicesTab } from './settings/services-tab.js';
import { GeneralTab } from './settings/general-tab.js';
import { UpdateTab } from './settings/update-tab.js';
import { PaletteTab } from './settings/palette-tab.js';
import { LogsTab } from './settings/logs-tab.js';
import { EdtsTab } from './settings/edts-tab.js';
export * from './settings/footer-context.logic.js';
export * from './settings/edts.logic.js';
export * from './settings/logs.logic.js';
export * from './settings/palette.logic.js';
export * from './settings/update.logic.js';
export * from './settings/general.logic.js';
export * from './settings/shared-types.logic.js';
export * from './settings/services.logic.js';
export * from './settings/settings-tabs.logic.js';

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
  // The group cursor is shared by tab visits: coming back to the EDTs tab starts on its first row.
  useEffect(() => {
    setGroupCursor(0);
  }, [tab]);

  const drilledIn =
    (tab === 'general' && generalEditing !== null) || (tab === 'edts' && edtsGroup !== null) || (tab === 'logs' && logsGroup !== null) ||
    (tab === 'command-palette' && paletteGroup !== null);

  useFooterContext(
    'settings',
    settingsFooterContext(tab, {
      generalEditing: generalEditing !== null,
      edtsGroup,
      edtsToggleRow: isSharedEdtToggleRow(groupCursor),
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
      const moved = nextCursorForKey(key, groupCursor, EDTS_TOP_LEVEL_ROW_COUNT);
      if (moved !== null) {
        setGroupCursor(moved);
        return;
      }
      if (input === ' ' && isSharedEdtToggleRow(groupCursor)) {
        // Applied live; a refusal (system EDT active) lands in `settingsWarning`, shown inline.
        void updateSettings({ edts: { sharedBranchesEdtEnabled: !useStore.getState().settings.edts.sharedBranchesEdtEnabled } });
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
          <SharedTypesTab settings={settings} cursor={sharedTypesCursor} />
        ) : null}

        {tab === 'services' ? (
          <ServicesTab settings={settings} rows={servicesRows} cursor={servicesCursor} />
        ) : null}

        {tab === 'general' ? (
          <GeneralTab settings={settings} cursor={generalCursor} editing={generalEditing} />
        ) : null}

        {tab === 'update' ? (
          <UpdateTab settings={settings} cursor={updateCursor} />
        ) : null}

        {tab === 'command-palette' ? (
          <PaletteTab settings={settings} paletteGroup={paletteGroup} paletteGroupCursor={paletteGroupCursor} />
        ) : null}

        {tab === 'logs' ? (
          <LogsTab
            settings={settings}
            logsGroup={logsGroup}
            logsGroupCursor={logsGroupCursor}
            logsClearRowCursor={logsClearRowCursor}
            logsClearServiceOpen={logsClearServiceOpen}
            logsClearServiceCursor={logsClearServiceCursor}
            logsServices={logsServices}
            logsRulesRowCursor={logsRulesRowCursor}
            logsRulesScopeOpen={logsRulesScopeOpen}
            logsRulesScopes={logsRulesScopes}
            logsRulesScopeIndex={logsRulesScopeIndex}
            logsRulesConfirm={logsRulesConfirm}
            logsRuleSetCount={logsRuleSets.length}
          />
        ) : null}

        {tab === 'edts' ? (
          <EdtsTab settings={settings} edtsGroup={edtsGroup} groupCursor={groupCursor} hintCursor={hintCursor} actionTypeCursor={actionTypeCursor} />
        ) : null}
      </Box>
    </ModalDialog>
  );
}
