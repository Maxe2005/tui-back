// tui/shared/settings-screen: story 2.19 tests, mirroring repo-registry-screen.test.tsx's
// pure-function-first convention. renderToString's fake stdin never emits data, so useInput
// itself is never exercised here — every key-handling decision is covered as a pure function
// instead (nextSettingsTab, adjustGridMaxRows/parseGridMaxRowsDigit, moveHintCursor/
// toggleHiddenHint), plus render-level smoke coverage of every tab body (AC1/AC2).
import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS } from '../../../../core/ports/settings.js';
import { createAppStore } from '../store/app-store.js';
import { renderToString } from './components/render-to-string.js';
import {
  HIDEABLE_ACTION_HINTS,
  HIDEABLE_ACTION_TYPES,
  LOG_BUFFER_SIZE_STEP,
  MAX_GRID_MAX_ROWS,
  MAX_LOG_BUFFER_SIZE,
  MIN_GRID_MAX_ROWS,
  MIN_LOG_BUFFER_SIZE,
  SETTINGS_GROUPS,
  SETTINGS_TABS,
  SettingsScreen,
  adjustGridMaxRows,
  adjustLogBufferSize,
  clampGridMaxRows,
  clampLogBufferSize,
  moveHintCursor,
  nextSettingsTab,
  parseGridMaxRowsDigit,
  parseLogBufferSizeDigit,
  resolveSettingsTabState,
  toggleHiddenHint,
} from './settings-screen.js';

describe('nextSettingsTab (AC1)', () => {
  it('cycles General -> EDTs -> Command Palette -> Logs -> General going forward', () => {
    expect(nextSettingsTab('general', 1)).toBe('edts');
    expect(nextSettingsTab('edts', 1)).toBe('command-palette');
    expect(nextSettingsTab('command-palette', 1)).toBe('logs');
    expect(nextSettingsTab('logs', 1)).toBe('general');
  });

  it('cycles the same order in reverse going backward', () => {
    expect(nextSettingsTab('general', -1)).toBe('logs');
    expect(nextSettingsTab('logs', -1)).toBe('command-palette');
    expect(nextSettingsTab('command-palette', -1)).toBe('edts');
    expect(nextSettingsTab('edts', -1)).toBe('general');
  });

  it('SETTINGS_TABS is declared in exactly that order', () => {
    expect(SETTINGS_TABS).toEqual(['general', 'edts', 'command-palette', 'logs']);
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

describe('parseGridMaxRowsDigit (I/O matrix "Adjust grid rows")', () => {
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

describe('clampLogBufferSize / adjustLogBufferSize (story 5.1)', () => {
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

describe('parseLogBufferSizeDigit (story 5.1)', () => {
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

describe('moveHintCursor', () => {
  it('moves down and up by one, clamped at both bounds', () => {
    expect(moveHintCursor(0, 'down', 3)).toBe(1);
    expect(moveHintCursor(2, 'down', 3)).toBe(2);
    expect(moveHintCursor(0, 'up', 3)).toBe(0);
  });

  it('always returns 0 for an empty list', () => {
    expect(moveHintCursor(0, 'down', 0)).toBe(0);
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
  it('lists exactly the three PaneFocus hint tokens story 2.18 emits — never invented ids', () => {
    expect(HIDEABLE_ACTION_HINTS.map((token) => token.id)).toEqual(['edts', 'edt-services', 'other-services']);
  });
});

describe('HIDEABLE_ACTION_TYPES (amended 2026-08-28, AC5)', () => {
  it('lists exactly the three EdtActionLogEntry[\'actionType\'] values — never invented ids', () => {
    expect(HIDEABLE_ACTION_TYPES.map((token) => token.id)).toEqual(['create', 'switch', 'modify']);
  });
});

describe('SETTINGS_GROUPS (amended 2026-08-28, AC6)', () => {
  it('lists exactly the two EDTs-tab settings groups, in this order', () => {
    expect(SETTINGS_GROUPS.map((group) => group.id)).toEqual(['hint-visibility', 'action-types']);
    expect(SETTINGS_GROUPS.map((group) => group.label)).toEqual(['Hint visibility', 'Recent action types']);
  });
});

describe('SettingsScreen (story 2.19)', () => {
  it('opens on the General tab, rendering the tab strip and the quit-shortcut toggle (AC1, AC2)', async () => {
    const store = createAppStore();
    const output = await renderToString(<SettingsScreen useStore={store} />);
    expect(output).toContain('SETTINGS');
    expect(output).toContain('General');
    expect(output).toContain('EDTs');
    expect(output).toContain('Command Palette');
    expect(output).toContain('Logs');
    expect(output).toContain("Enable 'q' to quit");
  });

  it('renders the quitShortcutEnabled checkbox on the General tab, checked/unchecked to match the live setting', async () => {
    const store = createAppStore();
    store.setState({ settings: { ...DEFAULT_SETTINGS, general: { quitShortcutEnabled: true } } });
    const checked = await renderToString(<SettingsScreen useStore={store} initialTab="general" />);
    const checkedLine = checked.split('\n').find((line) => line.includes("Enable 'q' to quit"));
    expect(checkedLine).toContain('[x]');
    expect(checked).toContain('Space to toggle');

    store.setState({ settings: { ...DEFAULT_SETTINGS, general: { quitShortcutEnabled: false } } });
    const unchecked = await renderToString(<SettingsScreen useStore={store} initialTab="general" />);
    const uncheckedLine = unchecked.split('\n').find((line) => line.includes("Enable 'q' to quit"));
    expect(uncheckedLine).toContain('[ ]');
  });

  it('surfaces a non-blocking settings warning without crashing (corrupt-file fallback)', async () => {
    const store = createAppStore();
    store.setState({ settingsWarning: 'Invalid settings file /x/settings.yaml: (root) — bad shape — using defaults.' });
    const output = await renderToString(<SettingsScreen useStore={store} />);
    expect(output).toContain('using defaults');
  });

  it('reflects the live gridMaxRows value from the store on the Command Palette tab data path', () => {
    const store = createAppStore();
    store.setState({ settings: { ...DEFAULT_SETTINGS, commandPalette: { gridMaxRows: 12 } } });
    expect(store.getState().settings.commandPalette.gridMaxRows).toBe(12);
  });

  it('reflects hidden hints from the store for the EDTs tab data path', () => {
    const store = createAppStore();
    store.setState({
      settings: { ...DEFAULT_SETTINGS, edts: { hiddenActionHints: ['edt-services'], hiddenActionTypes: [] } },
    });
    expect(store.getState().settings.edts.hiddenActionHints).toEqual(['edt-services']);
  });

  it('reflects hidden action types from the store for the EDTs tab data path (amended 2026-08-28, AC5)', () => {
    const store = createAppStore();
    store.setState({
      settings: { ...DEFAULT_SETTINGS, edts: { hiddenActionHints: [], hiddenActionTypes: ['modify'] } },
    });
    expect(store.getState().settings.edts.hiddenActionTypes).toEqual(['modify']);
  });

  it('renders the live gridMaxRows value and hint on the Command Palette tab (AC1)', async () => {
    const store = createAppStore();
    store.setState({ settings: { ...DEFAULT_SETTINGS, commandPalette: { gridMaxRows: 12 } } });
    const output = await renderToString(<SettingsScreen useStore={store} initialTab="command-palette" />);
    expect(output).toContain('Command grid max rows:');
    expect(output).toContain('12');
    expect(output).toContain('Up/Down to adjust, or type a digit (1-9).');
  });

  it('renders the live bufferSize value and hints on the Logs tab (story 5.1)', async () => {
    const store = createAppStore();
    store.setState({ settings: { ...DEFAULT_SETTINGS, logs: { bufferSize: 750, startWithHistory: false } } });
    const output = await renderToString(<SettingsScreen useStore={store} initialTab="logs" />);
    expect(output).toContain('Log buffer size');
    expect(output).toContain('750');
    expect(output).toContain(`Up/Down to adjust by ${LOG_BUFFER_SIZE_STEP}`);
    expect(output).toContain('Applies to new streams only');
  });

  it('renders the startWithHistory checkbox on the Logs tab, checked/unchecked to match the live setting (review fix)', async () => {
    const store = createAppStore();
    store.setState({ settings: { ...DEFAULT_SETTINGS, logs: { bufferSize: 500, startWithHistory: false } } });
    const unchecked = await renderToString(<SettingsScreen useStore={store} initialTab="logs" />);
    const uncheckedLine = unchecked.split('\n').find((line) => line.includes('Start streaming with the most recent history'));
    expect(uncheckedLine).toContain('[ ]');
    expect(unchecked).toContain('Space to toggle');

    store.setState({ settings: { ...DEFAULT_SETTINGS, logs: { bufferSize: 500, startWithHistory: true } } });
    const checked = await renderToString(<SettingsScreen useStore={store} initialTab="logs" />);
    const checkedLine = checked.split('\n').find((line) => line.includes('Start streaming with the most recent history'));
    expect(checkedLine).toContain('[x]');
  });

  it('opens the EDTs tab on its group list, not a checkbox list (AC6)', async () => {
    const store = createAppStore();
    const output = await renderToString(<SettingsScreen useStore={store} initialTab="edts" />);
    expect(output).toContain('Hint visibility');
    expect(output).toContain('Recent action types');
    for (const token of HIDEABLE_ACTION_HINTS) {
      expect(output).not.toContain(token.label);
    }
  });

  it('drilled into "Hint visibility", renders every hideable hint as a checkbox row, checked where hidden (I/O matrix "Toggle hidden hint")', async () => {
    const store = createAppStore();
    store.setState({
      settings: { ...DEFAULT_SETTINGS, edts: { hiddenActionHints: ['edt-services'], hiddenActionTypes: [] } },
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

  it('drilled into "Recent action types", renders create/switch/modify as a checkbox row, checked where hidden (amended 2026-08-28, AC5)', async () => {
    const store = createAppStore();
    store.setState({
      settings: { ...DEFAULT_SETTINGS, edts: { hiddenActionHints: [], hiddenActionTypes: ['modify'] } },
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
});
