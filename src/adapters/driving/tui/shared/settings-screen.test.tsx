// tui/shared/settings-screen: pure-function tests for every key-handling decision
// (renderToString's fake stdin never emits keys) plus render smoke coverage of every tab body.
import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS } from '../../../../core/ports/settings.js';
import { createAppStore } from '../store/app-store.js';
import { renderToString } from './components/render-to-string.js';
import { SHARED_TYPES_SETTINGS_ROWS, resolveSharedTypesSettingsKey, settingsFooterContext } from './settings-screen.js';
import {
  EDITOR_COMMAND_PLACEHOLDER_TEXT,
  FILTER_HISTORY_SIZE_STEP,
  GENERAL_SETTINGS_ROWS,
  HIDEABLE_ACTION_HINTS,
  HIDEABLE_ACTION_TYPES,
  LOG_BUFFER_SIZE_STEP,
  LOGS_SETTINGS_GROUPS,
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
  SETTINGS_GROUPS,
  SETTINGS_TABS,
  SettingsScreen,
  adjustBranchDropdownMaxRows,
  adjustFilterHistoryGridMaxRows,
  adjustFilterHistorySize,
  adjustGridMaxRows,
  adjustUpdateConcurrency,
  parseUpdateConcurrencyDigit,
  adjustLogBufferSize,
  clampBranchDropdownMaxRows,
  clampFilterHistoryGridMaxRows,
  clampFilterHistorySize,
  clampGridMaxRows,
  clampLogBufferSize,
  nextSettingsTab,
  parseBranchDropdownMaxRowsDigit,
  parseFilterHistoryGridMaxRowsDigit,
  parseGridMaxRowsDigit,
  parseLogBufferSizeDigit,
  resolveGeneralSettingsKey,
  resolveUpdateSettingsKey,
  UPDATE_SETTINGS_ROWS,
  resolveSettingsTabState,
  toggleHiddenHint,
} from './settings-screen.js';

describe('update concurrency row', () => {
  it('steps within [1, 8] and sets from a digit', () => {
    expect(adjustUpdateConcurrency(3, 'up')).toBe(4);
    expect(adjustUpdateConcurrency(1, 'down')).toBe(1);
    expect(adjustUpdateConcurrency(8, 'up')).toBe(8);
    expect(parseUpdateConcurrencyDigit('5')).toBe(5);
    expect(parseUpdateConcurrencyDigit('0')).toBeNull();
    expect(parseUpdateConcurrencyDigit('x')).toBeNull();
  });

  it('only reacts on its own row', () => {
    const update = { ...DEFAULT_SETTINGS.update, concurrency: 3 };
    expect(resolveUpdateSettingsKey('+', {}, 0, update)).toEqual({ type: 'set-concurrency', value: 4 });
    expect(resolveUpdateSettingsKey('-', {}, 0, update)).toEqual({ type: 'set-concurrency', value: 2 });
    expect(resolveUpdateSettingsKey('6', {}, 0, update)).toEqual({ type: 'set-concurrency', value: 6 });
    expect(resolveUpdateSettingsKey('+', {}, 1, update)).toEqual({ type: 'ignore' });
  });
});

describe('resolveUpdateSettingsKey (Update tab)', () => {
  const update = DEFAULT_SETTINGS.update;
  it('moves the cursor, clamped', () => {
    expect(resolveUpdateSettingsKey('', { downArrow: true }, 0, update)).toEqual({ type: 'move', cursor: 1 });
    expect(resolveUpdateSettingsKey('', { downArrow: true }, UPDATE_SETTINGS_ROWS.length - 1, update)).toEqual({
      type: 'move',
      cursor: UPDATE_SETTINGS_ROWS.length - 1,
    });
  });

  it('Space toggles the two booleans on their own rows only', () => {
    expect(resolveUpdateSettingsKey(' ', {}, UPDATE_SETTINGS_ROWS.indexOf('run-migrations'), update)).toEqual({ type: 'toggle-run-migrations' });
    expect(resolveUpdateSettingsKey(' ', {}, UPDATE_SETTINGS_ROWS.indexOf('clean-restart'), update)).toEqual({ type: 'toggle-clean-restart' });
    expect(resolveUpdateSettingsKey(' ', {}, UPDATE_SETTINGS_ROWS.indexOf('concurrency'), update)).toEqual({ type: 'ignore' });
  });

  it('Space/Enter flips the merge source between shared and edt-pending', () => {
    const row = UPDATE_SETTINGS_ROWS.indexOf('merge-source');
    expect(resolveUpdateSettingsKey(' ', {}, row, update)).toEqual({ type: 'set-merge-source', value: 'edt-pending' });
    expect(resolveUpdateSettingsKey('', { return: true }, row, { ...update, mergeSource: 'edt-pending' })).toEqual({
      type: 'set-merge-source',
      value: 'shared',
    });
  });
});

describe('nextSettingsTab', () => {
  it('cycles General -> EDTs -> Command Palette -> Logs -> Update -> st -> General going forward', () => {
    expect(nextSettingsTab('general', 1)).toBe('edts');
    expect(nextSettingsTab('edts', 1)).toBe('command-palette');
    expect(nextSettingsTab('command-palette', 1)).toBe('logs');
    expect(nextSettingsTab('logs', 1)).toBe('update');
    expect(nextSettingsTab('update', 1)).toBe('shared-types');
    expect(nextSettingsTab('shared-types', 1)).toBe('general');
  });

  it('cycles the same order in reverse going backward', () => {
    expect(nextSettingsTab('general', -1)).toBe('shared-types');
    expect(nextSettingsTab('shared-types', -1)).toBe('update');
    expect(nextSettingsTab('update', -1)).toBe('logs');
    expect(nextSettingsTab('logs', -1)).toBe('command-palette');
    expect(nextSettingsTab('command-palette', -1)).toBe('edts');
    expect(nextSettingsTab('edts', -1)).toBe('general');
  });

  it('SETTINGS_TABS is declared in exactly that order', () => {
    expect(SETTINGS_TABS).toEqual(['general', 'edts', 'command-palette', 'logs', 'update', 'shared-types']);
  });
});

describe('resolveSettingsTabState', () => {
  it('marks the active tab with the accent fill and background-colored bold text', () => {
    const state = resolveSettingsTabState('edts', 'edts');
    expect(state.active).toBe(true);
    expect(state.bold).toBe(true);
  });

  it('marks an inactive tab text-dim on background, not bold', () => {
    const state = resolveSettingsTabState('general', 'edts');
    expect(state.active).toBe(false);
    expect(state.bold).toBe(false);
  });
});

describe('clampGridMaxRows / adjustGridMaxRows', () => {
  it('clamps to the minimum', () => {
    expect(clampGridMaxRows(0)).toBe(MIN_GRID_MAX_ROWS);
    expect(clampGridMaxRows(-5)).toBe(MIN_GRID_MAX_ROWS);
  });

  it('clamps to the maximum', () => {
    expect(clampGridMaxRows(1000)).toBe(MAX_GRID_MAX_ROWS);
  });

  it('adjustGridMaxRows increments/decrements by one', () => {
    expect(adjustGridMaxRows(8, 'up')).toBe(9);
    expect(adjustGridMaxRows(8, 'down')).toBe(7);
  });

  it('adjustGridMaxRows never drops below the minimum', () => {
    expect(adjustGridMaxRows(MIN_GRID_MAX_ROWS, 'down')).toBe(MIN_GRID_MAX_ROWS);
  });
});

describe('parseGridMaxRowsDigit', () => {
  it('parses a single digit 1-9 as the new value', () => {
    expect(parseGridMaxRowsDigit('5')).toBe(5);
    expect(parseGridMaxRowsDigit('9')).toBe(9);
  });

  it('rejects 0 — gridMaxRows must stay positive', () => {
    expect(parseGridMaxRowsDigit('0')).toBeNull();
  });

  it('rejects non-digit or multi-character input', () => {
    expect(parseGridMaxRowsDigit('a')).toBeNull();
    expect(parseGridMaxRowsDigit('12')).toBeNull();
    expect(parseGridMaxRowsDigit('')).toBeNull();
  });
});

describe('clampLogBufferSize / adjustLogBufferSize', () => {
  it('clamps to the minimum', () => {
    expect(clampLogBufferSize(0)).toBe(MIN_LOG_BUFFER_SIZE);
    expect(clampLogBufferSize(-5)).toBe(MIN_LOG_BUFFER_SIZE);
  });

  it('clamps to the maximum', () => {
    expect(clampLogBufferSize(1_000_000)).toBe(MAX_LOG_BUFFER_SIZE);
  });

  it('adjustLogBufferSize steps by LOG_BUFFER_SIZE_STEP', () => {
    expect(adjustLogBufferSize(500, 'up')).toBe(500 + LOG_BUFFER_SIZE_STEP);
    expect(adjustLogBufferSize(500, 'down')).toBe(500 - LOG_BUFFER_SIZE_STEP);
  });

  it('adjustLogBufferSize never drops below the minimum or exceeds the maximum', () => {
    expect(adjustLogBufferSize(MIN_LOG_BUFFER_SIZE, 'down')).toBe(MIN_LOG_BUFFER_SIZE);
    expect(adjustLogBufferSize(MAX_LOG_BUFFER_SIZE, 'up')).toBe(MAX_LOG_BUFFER_SIZE);
  });
});

describe('parseLogBufferSizeDigit', () => {
  it('parses a single digit 1-9 as a x100 preset', () => {
    expect(parseLogBufferSizeDigit('5')).toBe(500);
    expect(parseLogBufferSizeDigit('1')).toBe(100);
  });

  it('rejects 0, non-digit, or multi-character input', () => {
    expect(parseLogBufferSizeDigit('0')).toBeNull();
    expect(parseLogBufferSizeDigit('a')).toBeNull();
    expect(parseLogBufferSizeDigit('12')).toBeNull();
    expect(parseLogBufferSizeDigit('')).toBeNull();
  });
});

describe('clampFilterHistorySize / adjustFilterHistorySize', () => {
  it('clamps to the minimum', () => {
    expect(clampFilterHistorySize(0)).toBe(MIN_FILTER_HISTORY_SIZE);
    expect(clampFilterHistorySize(-5)).toBe(MIN_FILTER_HISTORY_SIZE);
  });

  it('clamps to the maximum', () => {
    expect(clampFilterHistorySize(10_000)).toBe(MAX_FILTER_HISTORY_SIZE);
  });

  it('adjustFilterHistorySize steps by FILTER_HISTORY_SIZE_STEP', () => {
    expect(adjustFilterHistorySize(20, 'up')).toBe(20 + FILTER_HISTORY_SIZE_STEP);
    expect(adjustFilterHistorySize(20, 'down')).toBe(20 - FILTER_HISTORY_SIZE_STEP);
  });

  it('adjustFilterHistorySize never drops below the minimum or exceeds the maximum', () => {
    expect(adjustFilterHistorySize(MIN_FILTER_HISTORY_SIZE, 'down')).toBe(MIN_FILTER_HISTORY_SIZE);
    expect(adjustFilterHistorySize(MAX_FILTER_HISTORY_SIZE, 'up')).toBe(MAX_FILTER_HISTORY_SIZE);
  });
});

describe('clampFilterHistoryGridMaxRows / adjustFilterHistoryGridMaxRows', () => {
  it('clamps to the minimum and maximum', () => {
    expect(clampFilterHistoryGridMaxRows(0)).toBe(MIN_FILTER_HISTORY_GRID_MAX_ROWS);
    expect(clampFilterHistoryGridMaxRows(1000)).toBe(MAX_FILTER_HISTORY_GRID_MAX_ROWS);
  });

  it('adjustFilterHistoryGridMaxRows increments/decrements by one, independent of commandPalette.gridMaxRows\' own constants', () => {
    expect(adjustFilterHistoryGridMaxRows(8, 'up')).toBe(9);
    expect(adjustFilterHistoryGridMaxRows(8, 'down')).toBe(7);
    expect(MIN_FILTER_HISTORY_GRID_MAX_ROWS).toBe(MIN_GRID_MAX_ROWS);
    expect(MAX_FILTER_HISTORY_GRID_MAX_ROWS).toBe(MAX_GRID_MAX_ROWS);
  });
});

describe('parseFilterHistoryGridMaxRowsDigit', () => {
  it('parses a single digit 1-9 as the new value', () => {
    expect(parseFilterHistoryGridMaxRowsDigit('5')).toBe(5);
  });

  it('rejects 0, non-digit, or multi-character input', () => {
    expect(parseFilterHistoryGridMaxRowsDigit('0')).toBeNull();
    expect(parseFilterHistoryGridMaxRowsDigit('a')).toBeNull();
    expect(parseFilterHistoryGridMaxRowsDigit('12')).toBeNull();
  });
});

describe('clampBranchDropdownMaxRows / adjustBranchDropdownMaxRows (branch autocomplete shared component)', () => {
  it('clamps to the minimum and maximum', () => {
    expect(clampBranchDropdownMaxRows(0)).toBe(MIN_EDTS_BRANCH_DROPDOWN_MAX_ROWS);
    expect(clampBranchDropdownMaxRows(-5)).toBe(MIN_EDTS_BRANCH_DROPDOWN_MAX_ROWS);
    expect(clampBranchDropdownMaxRows(1000)).toBe(MAX_EDTS_BRANCH_DROPDOWN_MAX_ROWS);
  });

  it('adjustBranchDropdownMaxRows increments/decrements by one', () => {
    expect(adjustBranchDropdownMaxRows(5, 'up')).toBe(6);
    expect(adjustBranchDropdownMaxRows(5, 'down')).toBe(4);
  });

  it('adjustBranchDropdownMaxRows never leaves [MIN, MAX]', () => {
    expect(adjustBranchDropdownMaxRows(MIN_EDTS_BRANCH_DROPDOWN_MAX_ROWS, 'down')).toBe(MIN_EDTS_BRANCH_DROPDOWN_MAX_ROWS);
    expect(adjustBranchDropdownMaxRows(MAX_EDTS_BRANCH_DROPDOWN_MAX_ROWS, 'up')).toBe(MAX_EDTS_BRANCH_DROPDOWN_MAX_ROWS);
  });

  it('the range is 1–20 with a default of 5 (single source of truth in core/ports/settings.ts)', () => {
    expect(MIN_EDTS_BRANCH_DROPDOWN_MAX_ROWS).toBe(1);
    expect(MAX_EDTS_BRANCH_DROPDOWN_MAX_ROWS).toBe(20);
    expect(DEFAULT_SETTINGS.edts.branchDropdownMaxRows).toBe(5);
  });
});

describe('parseBranchDropdownMaxRowsDigit (branch autocomplete shared component)', () => {
  it('parses a single digit 1-9 as the new value, clamped into range', () => {
    expect(parseBranchDropdownMaxRowsDigit('5')).toBe(5);
    expect(parseBranchDropdownMaxRowsDigit('9')).toBe(9);
  });

  it('rejects 0, non-digit, or multi-character input', () => {
    expect(parseBranchDropdownMaxRowsDigit('0')).toBeNull();
    expect(parseBranchDropdownMaxRowsDigit('a')).toBeNull();
    expect(parseBranchDropdownMaxRowsDigit('12')).toBeNull();
    expect(parseBranchDropdownMaxRowsDigit('')).toBeNull();
  });
});

describe('SettingsScreen branch-dropdown-rows group (branch autocomplete shared component)', () => {
  it('opens the EDTs tab on its group list including the new group', async () => {
    const store = createAppStore();
    const output = await renderToString(<SettingsScreen useStore={store} initialTab="edts" />);
    expect(output).toContain('Hint visibility');
    expect(output).toContain('Recent action types');
    expect(output).toContain('Branch dropdown rows');
  });

  it('drilled into "Branch dropdown rows", renders the live value with its adjust hint', async () => {
    const store = createAppStore();
    store.setState({
      settings: { ...DEFAULT_SETTINGS, edts: { ...DEFAULT_SETTINGS.edts, branchDropdownMaxRows: 12 } },
    });
    const output = await renderToString(
      <SettingsScreen useStore={store} initialTab="edts" initialEdtsGroup="branch-dropdown-rows" />,
    );
    expect(output).toContain('Branch dropdown max rows:');
    expect(output).toContain('12');
    expect(output).toContain('Caps the lines of the autocomplete dropdown');
  });
});

describe('LOGS_SETTINGS_GROUPS', () => {
  it('lists exactly the seven Logs-tab groups, in this order', () => {
    expect(LOGS_SETTINGS_GROUPS.map((group) => group.id)).toEqual([
      'buffer-size',
      'start-with-history',
      'filter-history-size',
      'filter-history-grid',
      'filter-history-dedup',
      'restart-mode',
      'clear-history',
    ]);
    expect(LOGS_SETTINGS_GROUPS.map((group) => group.label)).toEqual([
      'Buffer size',
      'Start with history',
      'Filter history size',
      'Filter history grid',
      'Filter history dedup',
      'Restart mode',
      'Clear history',
    ]);
  });
});

describe('toggleHiddenHint', () => {
  it('adds an id not yet hidden, without mutating the input array', () => {
    const original = ['edts'];
    const next = toggleHiddenHint(original, 'edt-services');
    expect(next).toEqual(['edts', 'edt-services']);
    expect(original).toEqual(['edts']);
  });

  it('removes an id already hidden', () => {
    expect(toggleHiddenHint(['edts', 'edt-services'], 'edts')).toEqual(['edt-services']);
  });
});

describe('HIDEABLE_ACTION_HINTS', () => {
  it('lists exactly the three PaneFocus hint tokens the EDTs zone emits — never invented ids', () => {
    expect(HIDEABLE_ACTION_HINTS.map((token) => token.id)).toEqual(['edts', 'edt-services', 'other-services']);
  });
});

describe('HIDEABLE_ACTION_TYPES', () => {
  it('lists exactly the three EdtActionLogEntry[\'actionType\'] values — never invented ids', () => {
    expect(HIDEABLE_ACTION_TYPES.map((token) => token.id)).toEqual(['create', 'switch', 'modify']);
  });
});

describe('SETTINGS_GROUPS', () => {
  it('lists exactly the three EDTs-tab settings groups, in this order', () => {
    expect(SETTINGS_GROUPS.map((group) => group.id)).toEqual(['hint-visibility', 'action-types', 'branch-dropdown-rows']);
    expect(SETTINGS_GROUPS.map((group) => group.label)).toEqual(['Hint visibility', 'Recent action types', 'Branch dropdown rows']);
  });
});

describe('SettingsScreen', () => {
  it('opens on the General tab, rendering the tab strip and the quit-shortcut toggle', async () => {
    const store = createAppStore();
    const output = await renderToString(<SettingsScreen useStore={store} />);
    expect(output).toContain('SETTINGS');
    expect(output).toContain('General');
    expect(output).toContain('EDTs');
    expect(output).toContain('Command Palette');
    expect(output).toContain('Logs');
    expect(output).toContain("Enable 'q' to quit");
  });

  it('renders the Update tab with concurrency and the three persisted defaults', async () => {
    const store = createAppStore();
    store.setState({
      settings: { ...DEFAULT_SETTINGS, update: { concurrency: 5, runMigrations: false, cleanRestart: true, mergeSource: 'edt-pending' } },
    });
    const output = await renderToString(<SettingsScreen useStore={store} initialTab="update" />);
    expect(output).toContain('Update');
    expect(output).toContain('Update concurrency: 5');
    expect(output.split('\n').find((line) => line.includes('Run migrations'))).toContain('[ ]');
    expect(output.split('\n').find((line) => line.includes('Clean restart'))).toContain('[x]');
    expect(output).toContain('From EDT');
    const general = await renderToString(<SettingsScreen useStore={store} initialTab="general" />);
    expect(general).not.toContain('Update concurrency');
  });

  it('renders the quitShortcutEnabled checkbox on the General tab, checked/unchecked to match the live setting', async () => {
    const store = createAppStore();
    store.setState({ settings: { ...DEFAULT_SETTINGS, general: { quitShortcutEnabled: true, editorCommand: '' } } });
    const checked = await renderToString(<SettingsScreen useStore={store} initialTab="general" />);
    const checkedLine = checked.split('\n').find((line) => line.includes("Enable 'q' to quit"));
    expect(checkedLine).toContain('[x]');
    expect(checked).toContain('Unchecked: ');

    store.setState({ settings: { ...DEFAULT_SETTINGS, general: { quitShortcutEnabled: false, editorCommand: '' } } });
    const unchecked = await renderToString(<SettingsScreen useStore={store} initialTab="general" />);
    const uncheckedLine = unchecked.split('\n').find((line) => line.includes("Enable 'q' to quit"));
    expect(uncheckedLine).toContain('[ ]');
  });

  it('renders the editor command row on the General tab: the not-set placeholder, then the configured command', async () => {
    const store = createAppStore();
    const unset = await renderToString(<SettingsScreen useStore={store} initialTab="general" />);
    expect(unset).toContain('Editor command:');
    expect(unset).toContain(EDITOR_COMMAND_PLACEHOLDER_TEXT);

    store.setState({ settings: { ...DEFAULT_SETTINGS, general: { quitShortcutEnabled: true, editorCommand: 'code <repo>' } } });
    const configured = await renderToString(<SettingsScreen useStore={store} initialTab="general" />);
    expect(configured).toContain('Editor command: code <repo>');
    expect(configured).not.toContain(EDITOR_COMMAND_PLACEHOLDER_TEXT);
  });

  it('renders the open editor-command edit as a focused text field pre-filled with the current command', async () => {
    const store = createAppStore();
    store.setState({ settings: { ...DEFAULT_SETTINGS, general: { quitShortcutEnabled: true, editorCommand: 'code <repo>' } } });
    const output = await renderToString(<SettingsScreen useStore={store} initialTab="general" initialGeneralEditing />);
    expect(output).toContain('Editor command: code <repo>');
    expect(output).toContain('<repo> is replaced by the repo path');
    expect(output).not.toContain('Run by the Update zone');
  });

  it('surfaces a non-blocking settings warning without crashing (corrupt-file fallback)', async () => {
    const store = createAppStore();
    store.setState({ settingsWarning: 'Invalid settings file /x/settings.yaml: (root) — bad shape — using defaults.' });
    const output = await renderToString(<SettingsScreen useStore={store} />);
    expect(output).toContain('using defaults');
  });

  it('reflects the live gridMaxRows value from the store on the Command Palette tab data path', () => {
    const store = createAppStore();
    store.setState({ settings: { ...DEFAULT_SETTINGS, commandPalette: { gridMaxRows: 12, historySize: 20, historyDedup: true } } });
    expect(store.getState().settings.commandPalette.gridMaxRows).toBe(12);
  });

  it('reflects hidden hints from the store for the EDTs tab data path', () => {
    const store = createAppStore();
    store.setState({
      settings: { ...DEFAULT_SETTINGS, edts: { hiddenActionHints: ['edt-services'], hiddenActionTypes: [], branchDropdownMaxRows: 5 } },
    });
    expect(store.getState().settings.edts.hiddenActionHints).toEqual(['edt-services']);
  });

  it('reflects hidden action types from the store for the EDTs tab data path', () => {
    const store = createAppStore();
    store.setState({
      settings: { ...DEFAULT_SETTINGS, edts: { hiddenActionHints: [], hiddenActionTypes: ['modify'], branchDropdownMaxRows: 5 } },
    });
    expect(store.getState().settings.edts.hiddenActionTypes).toEqual(['modify']);
  });

  it('renders the live gridMaxRows value and hint on the Command Palette tab', async () => {
    const store = createAppStore();
    store.setState({ settings: { ...DEFAULT_SETTINGS, commandPalette: { gridMaxRows: 12, historySize: 20, historyDedup: true } } });
    const output = await renderToString(<SettingsScreen useStore={store} initialTab="command-palette" initialPaletteGroup="grid-max-rows" />);
    expect(output).toContain('Command grid max rows:');
    expect(output).toContain('12');
    expect(output).toContain('Rows of the command grid');
  });

  it('lists the Command Palette groups at the tab\'s top level', async () => {
    const output = await renderToString(<SettingsScreen useStore={createAppStore()} initialTab="command-palette" />);
    expect(output).toContain('Command grid max rows');
    expect(output).toContain('Command history size');
    expect(output).toContain('Deduplicate command history');
    expect(output).toContain('Clear command history');
  });

  it('renders the live command history size and the dedup checkbox state', async () => {
    const store = createAppStore();
    store.setState({ settings: { ...DEFAULT_SETTINGS, commandPalette: { ...DEFAULT_SETTINGS.commandPalette, historySize: 35, historyDedup: false } } });
    expect(await renderToString(<SettingsScreen useStore={store} initialTab="command-palette" initialPaletteGroup="history-size" />)).toContain('35');
    expect(await renderToString(<SettingsScreen useStore={store} initialTab="command-palette" initialPaletteGroup="history-dedup" />)).toContain('[ ]');
  });

  it('renders the live bufferSize value and hints when drilled into the "Buffer size" group', async () => {
    const store = createAppStore();
    store.setState({ settings: { ...DEFAULT_SETTINGS, logs: { bufferSize: 750, startWithHistory: false, filterHistorySize: 20, filterHistoryGridMaxRows: 8, filterHistoryDedup: true, restartMode: 'simple' as const } } });
    const output = await renderToString(<SettingsScreen useStore={store} initialTab="logs" initialLogsGroup="buffer-size" />);
    expect(output).toContain('Log buffer size');
    expect(output).toContain('750');
    expect(output).toContain(`Steps of ${LOG_BUFFER_SIZE_STEP} lines`);
    expect(output).toContain('Applies to new streams only');
  });

  it('renders the startWithHistory checkbox when drilled into the "Start with history" group, checked/unchecked to match the live setting', async () => {
    const store = createAppStore();
    store.setState({ settings: { ...DEFAULT_SETTINGS, logs: { bufferSize: 500, startWithHistory: false, filterHistorySize: 20, filterHistoryGridMaxRows: 8, filterHistoryDedup: true, restartMode: 'simple' as const } } });
    const unchecked = await renderToString(<SettingsScreen useStore={store} initialTab="logs" initialLogsGroup="start-with-history" />);
    const uncheckedLine = unchecked.split('\n').find((line) => line.includes('Start streaming with the most recent history'));
    expect(uncheckedLine).toContain('[ ]');

    store.setState({ settings: { ...DEFAULT_SETTINGS, logs: { bufferSize: 500, startWithHistory: true, filterHistorySize: 20, filterHistoryGridMaxRows: 8, filterHistoryDedup: true, restartMode: 'simple' as const } } });
    const checked = await renderToString(<SettingsScreen useStore={store} initialTab="logs" initialLogsGroup="start-with-history" />);
    const checkedLine = checked.split('\n').find((line) => line.includes('Start streaming with the most recent history'));
    expect(checkedLine).toContain('[x]');
  });

  it('renders the live restart mode when drilled into the "Restart mode" group', async () => {
    const store = createAppStore();
    store.setState({ settings: { ...DEFAULT_SETTINGS, logs: { ...DEFAULT_SETTINGS.logs, restartMode: 'clean' as const } } });
    const output = await renderToString(<SettingsScreen useStore={store} initialTab="logs" initialLogsGroup="restart-mode" />);
    expect(output).toContain('Restart mode');
    expect(output).toContain('clean');
  });

  it('opens the EDTs tab on its group list, not a checkbox list', async () => {
    const store = createAppStore();
    const output = await renderToString(<SettingsScreen useStore={store} initialTab="edts" />);
    expect(output).toContain('Hint visibility');
    expect(output).toContain('Recent action types');
    for (const token of HIDEABLE_ACTION_HINTS) {
      expect(output).not.toContain(token.label);
    }
  });

  it('drilled into "Hint visibility", renders every hideable hint as a checkbox row, checked where hidden', async () => {
    const store = createAppStore();
    store.setState({
      settings: { ...DEFAULT_SETTINGS, edts: { hiddenActionHints: ['edt-services'], hiddenActionTypes: [], branchDropdownMaxRows: 5 } },
    });
    const output = await renderToString(
      <SettingsScreen useStore={store} initialTab="edts" initialEdtsGroup="hint-visibility" />,
    );
    for (const token of HIDEABLE_ACTION_HINTS) {
      expect(output).toContain(token.label);
    }
    const lines = output.split('\n');
    const hiddenLine = lines.find((line) => line.includes('EDT services'));
    const visibleLine = lines.find((line) => line.includes('EDT selector'));
    expect(hiddenLine).toContain('[x]');
    expect(visibleLine).toContain('[ ]');
  });

  it('drilled into "Recent action types", renders create/switch/modify as a checkbox row, checked where hidden', async () => {
    const store = createAppStore();
    store.setState({
      settings: { ...DEFAULT_SETTINGS, edts: { hiddenActionHints: [], hiddenActionTypes: ['modify'], branchDropdownMaxRows: 5 } },
    });
    const output = await renderToString(
      <SettingsScreen useStore={store} initialTab="edts" initialEdtsGroup="action-types" />,
    );
    for (const token of HIDEABLE_ACTION_TYPES) {
      expect(output).toContain(token.label);
    }
    const lines = output.split('\n');
    const hiddenLine = lines.find((line) => line.includes('Modify'));
    const visibleLine = lines.find((line) => line.includes('Create'));
    expect(hiddenLine).toContain('[x]');
    expect(visibleLine).toContain('[ ]');
  });

  // The Logs tab's group list keeps the modal from overflowing its viewport, like the EDTs
  // tab's.
  it('opens the Logs tab on its group list, not a field list', async () => {
    const store = createAppStore();
    const output = await renderToString(<SettingsScreen useStore={store} initialTab="logs" />);
    expect(output).toContain('Buffer size');
    expect(output).toContain('Start with history');
    expect(output).toContain('Filter history size');
    expect(output).toContain('Filter history grid');
    expect(output).toContain('Filter history dedup');
    expect(output).toContain('Clear history');
    expect(output).not.toContain('Log buffer size (lines per pane)');
    expect(output).not.toContain('Clear global filter history');
    const lines = output.split('\n');
    const firstGroupLine = lines.find((line) => line.includes('Buffer size'));
    expect(firstGroupLine).toContain('›');
  });

  it('renders the live filterHistorySize value when drilled into the "Filter history size" group', async () => {
    const store = createAppStore();
    store.setState({
      settings: { ...DEFAULT_SETTINGS, logs: { bufferSize: 500, startWithHistory: false, filterHistorySize: 30, filterHistoryGridMaxRows: 12, filterHistoryDedup: true, restartMode: 'simple' as const } },
    });
    const output = await renderToString(<SettingsScreen useStore={store} initialTab="logs" initialLogsGroup="filter-history-size" />);
    expect(output).toContain('Filter history size');
    expect(output).toContain('30');
  });

  it('renders the live filterHistoryGridMaxRows value when drilled into the "Filter history grid" group', async () => {
    const store = createAppStore();
    store.setState({
      settings: { ...DEFAULT_SETTINGS, logs: { bufferSize: 500, startWithHistory: false, filterHistorySize: 30, filterHistoryGridMaxRows: 12, filterHistoryDedup: true, restartMode: 'simple' as const } },
    });
    const output = await renderToString(<SettingsScreen useStore={store} initialTab="logs" initialLogsGroup="filter-history-grid" />);
    expect(output).toContain('Filter history grid max rows');
    expect(output).toContain('12');
  });

  it('renders the filterHistoryDedup checkbox checked/unchecked to match the live setting', async () => {
    const checked = createAppStore();
    checked.setState({
      settings: { ...DEFAULT_SETTINGS, logs: { ...DEFAULT_SETTINGS.logs, filterHistoryDedup: true, restartMode: 'simple' as const } },
    });
    expect(await renderToString(<SettingsScreen useStore={checked} initialTab="logs" initialLogsGroup="filter-history-dedup" />)).toContain('[x]');
    const unchecked = createAppStore();
    unchecked.setState({
      settings: { ...DEFAULT_SETTINGS, logs: { ...DEFAULT_SETTINGS.logs, filterHistoryDedup: false } },
    });
    expect(await renderToString(<SettingsScreen useStore={unchecked} initialTab="logs" initialLogsGroup="filter-history-dedup" />)).toContain('[ ]');
  });

  it('drilled into the "Clear history" group, lists both clear actions as a row-cursor list, cursor on clear-global by default', async () => {
    const store = createAppStore();
    const output = await renderToString(<SettingsScreen useStore={store} initialTab="logs" initialLogsGroup="clear-history" />);
    expect(output).toContain('Clear global filter history');
    expect(output).toContain("Clear a service's filter history");
    const lines = output.split('\n');
    const clearGlobalLine = lines.find((line) => line.includes('Clear global filter history'));
    expect(clearGlobalLine).toContain('›');
  });

  it('drilled into "clear a service\'s history", lists every manifest service from edtsBranches', async () => {
    const store = createAppStore();
    store.setState({
      edtsBranches: [
        { service: 'api-gateway', path: '/repos/api-gateway', isMember: false, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development', protectedBranches: [] },
        { service: 'route-explorer', path: '/repos/route-explorer', isMember: false, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development', protectedBranches: [] },
      ],
    });
    const output = await renderToString(<SettingsScreen useStore={store} initialTab="logs" initialLogsClearServiceOpen />);
    expect(output).toContain('api-gateway');
    expect(output).toContain('route-explorer');
    expect(output).not.toContain('Log buffer size');
  });

  it('drilled into "clear a service\'s history" with no services loaded yet, shows a non-blocking message rather than an empty list', async () => {
    const store = createAppStore();
    const output = await renderToString(<SettingsScreen useStore={store} initialTab="logs" initialLogsClearServiceOpen />);
    expect(output).toContain('No manifest services loaded yet.');
  });
});

describe('resolveGeneralSettingsKey (General tab row list + editor command field)', () => {
  const quitRow = GENERAL_SETTINGS_ROWS.indexOf('quit-shortcut');
  const editorRow = GENERAL_SETTINGS_ROWS.indexOf('editor-command');

  it('Home/End jump to the first and last row', () => {
    expect(resolveGeneralSettingsKey('', { end: true }, { cursor: 0, editing: null })).toEqual({ type: 'move', cursor: GENERAL_SETTINGS_ROWS.length - 1 });
    expect(resolveGeneralSettingsKey('', { home: true }, { cursor: editorRow, editing: null })).toEqual({ type: 'move', cursor: 0 });
  });

  it('Up/Down move the row cursor, clamped at both ends', () => {
    expect(resolveGeneralSettingsKey('', { downArrow: true }, { cursor: quitRow, editing: null })).toEqual({ type: 'move', cursor: editorRow });
    expect(resolveGeneralSettingsKey('', { downArrow: true }, { cursor: editorRow, editing: null })).toEqual({ type: 'move', cursor: editorRow });
    expect(resolveGeneralSettingsKey('', { upArrow: true }, { cursor: quitRow, editing: null })).toEqual({ type: 'move', cursor: quitRow });
  });

  it('Space toggles the quit shortcut only on its own row; Enter opens the edit only on the editor row', () => {
    expect(resolveGeneralSettingsKey(' ', {}, { cursor: quitRow, editing: null })).toEqual({ type: 'toggle-quit' });
    expect(resolveGeneralSettingsKey(' ', {}, { cursor: editorRow, editing: null })).toEqual({ type: 'ignore' });
    expect(resolveGeneralSettingsKey('', { return: true }, { cursor: editorRow, editing: null })).toEqual({ type: 'begin-edit' });
    expect(resolveGeneralSettingsKey('', { return: true }, { cursor: quitRow, editing: null })).toEqual({ type: 'ignore' });
  });

  it('while editing, every key belongs to the text field — a space or q is a literal character, arrows move the caret', () => {
    const editing = { value: 'code', cursor: 4 };
    expect(resolveGeneralSettingsKey(' ', {}, { cursor: editorRow, editing })).toEqual({ type: 'edit', editing: { value: 'code ', cursor: 5 } });
    expect(resolveGeneralSettingsKey('q', {}, { cursor: editorRow, editing })).toEqual({ type: 'edit', editing: { value: 'codeq', cursor: 5 } });
    expect(resolveGeneralSettingsKey('', { leftArrow: true }, { cursor: editorRow, editing })).toEqual({
      type: 'edit',
      editing: { value: 'code', cursor: 3 },
    });
    expect(resolveGeneralSettingsKey('', { upArrow: true }, { cursor: editorRow, editing })).toEqual({ type: 'edit', editing });
  });

  it('Enter commits the trimmed draft — a blank draft commits as not set', () => {
    expect(resolveGeneralSettingsKey('', { return: true }, { cursor: editorRow, editing: { value: '  code <repo> ', cursor: 0 } })).toEqual({
      type: 'commit-edit',
      value: 'code <repo>',
    });
    expect(resolveGeneralSettingsKey('', { return: true }, { cursor: editorRow, editing: { value: '   ', cursor: 0 } })).toEqual({
      type: 'commit-edit',
      value: '',
    });
  });
});

describe('settingsFooterContext', () => {
  const closed = { generalEditing: false, edtsGroup: null, logsGroup: null };

  it('maps each tab and drill-down level to its footer context', () => {
    expect(settingsFooterContext('general', closed)).toBe('settings-general');
    expect(settingsFooterContext('update', closed)).toBe('settings-update');
    expect(settingsFooterContext('general', { ...closed, generalEditing: true })).toBe('confirm');
    expect(settingsFooterContext('command-palette', closed)).toBe('settings-groups');
    expect(settingsFooterContext('command-palette', { ...closed, paletteGroup: 'grid-max-rows' })).toBe('settings-adjust');
    expect(settingsFooterContext('command-palette', { ...closed, paletteGroup: 'history-dedup' })).toBe('settings-toggle');
    expect(settingsFooterContext('edts', closed)).toBe('settings-groups');
    expect(settingsFooterContext('edts', { ...closed, edtsGroup: 'hint-visibility' })).toBe('settings-toggle');
    expect(settingsFooterContext('edts', { ...closed, edtsGroup: 'branch-dropdown-rows' })).toBe('settings-adjust');
    expect(settingsFooterContext('logs', { ...closed, logsGroup: 'buffer-size' })).toBe('settings-adjust');
    expect(settingsFooterContext('logs', { ...closed, logsGroup: 'clear-history' })).toBe('settings-run');
  });
});

describe('st settings tab', () => {
  it('is a tab labelled st with the option rows then the two History bounds', () => {
    expect(SETTINGS_TABS).toContain('shared-types');
    expect(SHARED_TYPES_SETTINGS_ROWS.map((row) => row.id)).toEqual(['install', 'cleanRestart', 'commit', 'historyDepth', 'maxCommitsScanned']);
    expect(settingsFooterContext('shared-types', { generalEditing: false, edtsGroup: null, logsGroup: null })).toBe('settings-shared-types');
  });

  it('moves with the arrows and toggles the row under the cursor with Space', () => {
    expect(resolveSharedTypesSettingsKey('', { downArrow: true }, 0, { historyDepth: 20, maxCommitsScanned: 1000 })).toEqual({ type: 'move', cursor: 1 });
    expect(resolveSharedTypesSettingsKey(' ', {}, 1, { historyDepth: 20, maxCommitsScanned: 1000 })).toEqual({ type: 'toggle', id: 'cleanRestart' });
    expect(resolveSharedTypesSettingsKey('x', {}, 1, { historyDepth: 20, maxCommitsScanned: 1000 })).toEqual({ type: 'ignore' });
  });

  it('steps and clamps the History depth row with +/- only', () => {
    const current = { historyDepth: 20, maxCommitsScanned: 1000 };
    expect(resolveSharedTypesSettingsKey('+', {}, 3, current)).toEqual({ type: 'set-number', id: 'historyDepth', value: 21 });
    expect(resolveSharedTypesSettingsKey('-', {}, 3, { ...current, historyDepth: 1 })).toEqual({ type: 'set-number', id: 'historyDepth', value: 1 });
    expect(resolveSharedTypesSettingsKey('+', {}, 3, { ...current, historyDepth: 200 })).toEqual({ type: 'set-number', id: 'historyDepth', value: 200 });
    expect(resolveSharedTypesSettingsKey('5', {}, 3, current)).toEqual({ type: 'ignore' });
    expect(resolveSharedTypesSettingsKey('', { backspace: true }, 3, current)).toEqual({ type: 'ignore' });
    expect(resolveSharedTypesSettingsKey(' ', {}, 3, current)).toEqual({ type: 'ignore' });
  });

  it('steps by 100 and clamps the max commits scanned row to 100..20000', () => {
    const current = { historyDepth: 20, maxCommitsScanned: 1000 };
    expect(resolveSharedTypesSettingsKey('+', {}, 4, current)).toEqual({ type: 'set-number', id: 'maxCommitsScanned', value: 1100 });
    expect(resolveSharedTypesSettingsKey('-', {}, 4, { ...current, maxCommitsScanned: 100 })).toEqual({ type: 'set-number', id: 'maxCommitsScanned', value: 100 });
    expect(resolveSharedTypesSettingsKey('+', {}, 4, { ...current, maxCommitsScanned: 20000 })).toEqual({ type: 'set-number', id: 'maxCommitsScanned', value: 20000 });
  });
});
