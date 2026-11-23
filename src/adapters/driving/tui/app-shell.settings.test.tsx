import { describe, it, expect, vi } from 'vitest';
import { ok } from '../../../core/result.js';
import { DEFAULT_SETTINGS, type SettingsPort } from '../../../core/ports/settings.js';
import { AppShell } from './app-shell.js';
import { createAppStore } from './store/app-store.js';
import { KEYS } from './shared/test-support/fake-tty.js';
import { SETTINGS_GROUPS } from './shared/screens/settings-screen.js';
import { fakeDeps, mount, press, pressEscape } from './app-shell.test-support.js';

describe('AppShell settings screen (:settings)', () => {
  it('opens on the General tab via the registered `settings` command — never a raw keypress', async () => {
    const store = createAppStore();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      // A bare keypress (not through the command bar) must never open it.
      await press(instance, stdin, 's');
      expect(stdout.output).not.toContain('SETTINGS');

      await press(instance, stdin, ':');
      await press(instance, stdin, 'settings');
      await press(instance, stdin, KEYS.enter);

      expect(store.getState().settingsScreenOpen).toBe(true);
      expect(stdout.output).toContain('SETTINGS');
      expect(stdout.output).toContain("Enable 'q' to quit");
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Space on the General tab toggles settings.general.quitShortcutEnabled and persists via updateSettings', async () => {
    const settingsPort: SettingsPort = {
      load: async () => ok({ settings: DEFAULT_SETTINGS, warning: null }),
      save: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ settings: settingsPort }));
    store.getState().openSettingsScreen();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await press(instance, stdin, ' ');

      expect(store.getState().settings.general.quitShortcutEnabled).toBe(false);
      expect(settingsPort.save).toHaveBeenCalledWith({
        general: { quitShortcutEnabled: false, editorCommand: '' },
        commandPalette: { gridMaxRows: 8, historySize: 20, historyDedup: true },
        edts: { hiddenActionHints: [], hiddenActionTypes: [], branchDropdownMaxRows: 5, sharedBranchesEdtEnabled: false },
        update: { concurrency: 3, runMigrations: true, cleanRestart: false, mergeSource: 'shared' as const }, sharedTypes: { install: true, cleanRestart: false, commit: true, historyDepth: 20, maxCommitsScanned: 1000 }, switch: { restartMode: 'none' as const }, realign: { defaultScope: 'edt' as const, restartMode: 'none' as const }, dashboard: { restartMode: 'simple' as const }, logs: { bufferSize: 500, startWithHistory: false, filterHistorySize: 20, filterHistoryGridMaxRows: 8, filterHistoryDedup: true, restartMode: 'simple' as const }, services: { healthCheckDisabled: [] as string[] },
      });

      await press(instance, stdin, ' ');
      expect(store.getState().settings.general.quitShortcutEnabled).toBe(true);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Shift+Tab on the General tab goes back to the Services tab (wrapping), then st, then Update, then Logs', async () => {
    const store = createAppStore(fakeDeps());
    store.getState().openSettingsScreen();
    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.shiftTab);
      expect(stdout.output.slice(stdout.output.lastIndexOf('tui-back'))).toContain('healthUrl is never probed');
      await press(instance, stdin, KEYS.shiftTab);
      expect(stdout.output.slice(stdout.output.lastIndexOf('tui-back'))).toContain('Run npm i');
      await press(instance, stdin, KEYS.shiftTab);
      expect(stdout.output.slice(stdout.output.lastIndexOf('tui-back'))).toContain('Update concurrency');
      await press(instance, stdin, KEYS.shiftTab);
      expect(stdout.output.slice(stdout.output.lastIndexOf('tui-back'))).toContain('Buffer size');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Space on the Services tab unchecks a service health check and persists it at once', async () => {
    const settingsPort: SettingsPort = {
      load: async () => ok({ settings: DEFAULT_SETTINGS, warning: null }),
      save: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ settings: settingsPort }));
    store.setState({
      edtsBranches: [
        { service: 'api', path: '/repos/api', isMember: false, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development', protectedBranches: [], healthUrl: 'http://api/health' },
        { service: 'lib', path: '/repos/lib', isMember: false, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development', protectedBranches: [] },
      ],
    });
    store.getState().openSettingsScreen();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.shiftTab); // General -> Services (wrapping)

      await press(instance, stdin, KEYS.space);
      expect(store.getState().settings.services.healthCheckDisabled).toEqual(['api']);
      expect(settingsPort.save).toHaveBeenCalledWith(expect.objectContaining({ services: { healthCheckDisabled: ['api'] } }));

      // A row without healthUrl is disabled: Space does nothing.
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.space);
      expect(store.getState().settings.services.healthCheckDisabled).toEqual(['api']);

      await press(instance, stdin, KEYS.up);
      await press(instance, stdin, KEYS.space);
      expect(store.getState().settings.services.healthCheckDisabled).toEqual([]);
      expect(settingsPort.save).toHaveBeenLastCalledWith(expect.objectContaining({ services: { healthCheckDisabled: [] } }));
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Esc closes it — nothing to discard', async () => {
    const store = createAppStore();
    store.getState().openSettingsScreen();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      expect(store.getState().settingsScreenOpen).toBe(true);

      await pressEscape(instance, stdin);

      expect(store.getState().settingsScreenOpen).toBe(false);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Tab/Left/Right cycle General -> EDTs -> Command Palette -> General', async () => {
    const store = createAppStore();
    store.getState().openSettingsScreen();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      expect(stdout.output).toContain("Enable 'q' to quit");

      await press(instance, stdin, KEYS.tab);
      // The EDTs tab opens on its group list, not a flat checkbox list.
      expect(stdout.output).toContain('Hint visibility');
      expect(stdout.output).toContain('Recent action types');

      await press(instance, stdin, KEYS.tab);
      // The Command Palette tab opens on its group list too.
      expect(stdout.output).toContain('Command history size');
      expect(stdout.output).toContain('Clear command history');

      await press(instance, stdin, KEYS.tab);
      expect(stdout.output).toContain("Enable 'q' to quit");
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('never cycles tabs while a group is drilled into on the EDTs tab', async () => {
    const store = createAppStore();
    store.getState().openSettingsScreen();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await press(instance, stdin, KEYS.tab); // General -> EDTs (group list)
      await press(instance, stdin, KEYS.enter); // drill into "Hint visibility"
      expect(stdout.output).toContain('EDT selector');

      // Tab must not cycle away to Command Palette while drilled in.
      await press(instance, stdin, KEYS.tab);
      expect(stdout.output).toContain('EDT selector');
      expect(stdout.output).not.toContain('Command grid max rows:');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Esc steps back to the EDTs tab group list without closing the screen, then closes on the next Esc', async () => {
    const store = createAppStore();
    store.getState().openSettingsScreen();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await press(instance, stdin, KEYS.tab); // General -> EDTs (group list)
      await press(instance, stdin, KEYS.enter); // drill into "Hint visibility"
      expect(stdout.output).toContain('EDT selector');

      await pressEscape(instance, stdin);

      // Still open, back at the group list.
      expect(store.getState().settingsScreenOpen).toBe(true);
      expect(stdout.output).toContain('Hint visibility');
      expect(stdout.output).toContain('Recent action types');

      await pressEscape(instance, stdin);

      expect(store.getState().settingsScreenOpen).toBe(false);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('never stacks on top of the help overlay, and a typed "?" never opens help while it is open', async () => {
    const store = createAppStore();
    store.getState().openHelp();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, ':');
      await press(instance, stdin, 'settings');
      await press(instance, stdin, KEYS.enter);
      expect(stdout.output).not.toContain('SETTINGS');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Up on the drilled-in Command Palette "Command grid max rows" group adjusts gridMaxRows live and persists via updateSettings', async () => {
    const settingsPort: SettingsPort = {
      load: async () => ok({ settings: DEFAULT_SETTINGS, warning: null }),
      save: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ settings: settingsPort }));
    store.getState().openSettingsScreen();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab); // General -> EDTs
      await press(instance, stdin, KEYS.tab); // EDTs -> Command Palette (group list)
      await press(instance, stdin, KEYS.enter); // drill into "Command grid max rows"

      await press(instance, stdin, KEYS.up);

      expect(store.getState().settings.commandPalette.gridMaxRows).toBe(9);
      expect(settingsPort.save).toHaveBeenCalledWith({
        general: { quitShortcutEnabled: true, editorCommand: '' },
        commandPalette: { gridMaxRows: 9, historySize: 20, historyDedup: true },
        edts: { hiddenActionHints: [], hiddenActionTypes: [], branchDropdownMaxRows: 5, sharedBranchesEdtEnabled: false },
        update: { concurrency: 3, runMigrations: true, cleanRestart: false, mergeSource: 'shared' as const }, sharedTypes: { install: true, cleanRestart: false, commit: true, historyDepth: 20, maxCommitsScanned: 1000 }, switch: { restartMode: 'none' as const }, realign: { defaultScope: 'edt' as const, restartMode: 'none' as const }, dashboard: { restartMode: 'simple' as const }, logs: { bufferSize: 500, startWithHistory: false, filterHistorySize: 20, filterHistoryGridMaxRows: 8, filterHistoryDedup: true, restartMode: 'simple' as const }, services: { healthCheckDisabled: [] as string[] },
      });
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Command Palette tab: Right on "Command history size" steps the size, Space toggles dedup, Enter on "Clear command history" empties the list', async () => {
    const settingsPort: SettingsPort = {
      load: async () => ok({ settings: DEFAULT_SETTINGS, warning: null }),
      save: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ settings: settingsPort }));
    store.setState({ commandHistory: ['settings', 'registry'] });
    store.getState().openSettingsScreen();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab); // General -> EDTs
      await press(instance, stdin, KEYS.tab); // EDTs -> Command Palette (group list)

      await press(instance, stdin, KEYS.down); // -> "Command history size"
      await press(instance, stdin, KEYS.enter);
      await press(instance, stdin, KEYS.right);
      expect(store.getState().settings.commandPalette.historySize).toBe(25);
      await pressEscape(instance, stdin);

      await press(instance, stdin, KEYS.down); // -> "Deduplicate command history"
      await press(instance, stdin, KEYS.enter);
      await press(instance, stdin, KEYS.space);
      expect(store.getState().settings.commandPalette.historyDedup).toBe(false);
      await pressEscape(instance, stdin);

      await press(instance, stdin, KEYS.down); // -> "Clear command history"
      await press(instance, stdin, KEYS.enter);
      await press(instance, stdin, KEYS.enter);
      expect(store.getState().commandHistory).toEqual([]);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // The Logs tab is a group list (like the EDTs tab) so the modal never overflows its
  // viewport: Up/Down navigates between groups, Enter drills into one, Left/Right adjusts the
  // one numeric field a drilled-in group holds.
  it('Left/Right on the Logs tab\'s default "Buffer size" group adjusts settings.logs.bufferSize live and persists via updateSettings', async () => {
    const settingsPort: SettingsPort = {
      load: async () => ok({ settings: DEFAULT_SETTINGS, warning: null }),
      save: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ settings: settingsPort }));
    store.getState().openSettingsScreen();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab); // General -> EDTs
      await press(instance, stdin, KEYS.tab); // EDTs -> Command Palette
      await press(instance, stdin, KEYS.tab); // Command Palette -> Logs (group list)
      await press(instance, stdin, KEYS.enter); // drill into "Buffer size" (first, default group)

      await press(instance, stdin, KEYS.right);

      expect(store.getState().settings.logs.bufferSize).toBe(550);
      expect(settingsPort.save).toHaveBeenCalledWith({
        general: { quitShortcutEnabled: true, editorCommand: '' },
        commandPalette: { gridMaxRows: 8, historySize: 20, historyDedup: true },
        edts: { hiddenActionHints: [], hiddenActionTypes: [], branchDropdownMaxRows: 5, sharedBranchesEdtEnabled: false },
        update: { concurrency: 3, runMigrations: true, cleanRestart: false, mergeSource: 'shared' as const }, sharedTypes: { install: true, cleanRestart: false, commit: true, historyDepth: 20, maxCommitsScanned: 1000 }, switch: { restartMode: 'none' as const }, realign: { defaultScope: 'edt' as const, restartMode: 'none' as const }, dashboard: { restartMode: 'simple' as const }, logs: { bufferSize: 550, startWithHistory: false, filterHistorySize: 20, filterHistoryGridMaxRows: 8, filterHistoryDedup: true, restartMode: 'simple' as const }, services: { healthCheckDisabled: [] as string[] },
      });

      // A typed digit is a quick preset (digit x 100), still while on the bufferSize row.
      await press(instance, stdin, '3');
      expect(store.getState().settings.logs.bufferSize).toBe(300);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Space on the Logs tab\'s "Start with history" group (reached via one Down from "Buffer size") toggles settings.logs.startWithHistory live and persists via updateSettings, independently of bufferSize', async () => {
    const settingsPort: SettingsPort = {
      load: async () => ok({ settings: DEFAULT_SETTINGS, warning: null }),
      save: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ settings: settingsPort }));
    store.getState().openSettingsScreen();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab); // General -> EDTs
      await press(instance, stdin, KEYS.tab); // EDTs -> Command Palette
      await press(instance, stdin, KEYS.tab); // Command Palette -> Logs (group list)
      await press(instance, stdin, KEYS.down); // "Buffer size" -> "Start with history" group
      await press(instance, stdin, KEYS.enter); // drill into "Start with history"

      await press(instance, stdin, KEYS.space);

      expect(store.getState().settings.logs.startWithHistory).toBe(true);
      expect(store.getState().settings.logs.bufferSize).toBe(DEFAULT_SETTINGS.logs.bufferSize);
      expect(settingsPort.save).toHaveBeenCalledWith({
        general: { quitShortcutEnabled: true, editorCommand: '' },
        commandPalette: { gridMaxRows: 8, historySize: 20, historyDedup: true },
        edts: { hiddenActionHints: [], hiddenActionTypes: [], branchDropdownMaxRows: 5, sharedBranchesEdtEnabled: false },
        update: { concurrency: 3, runMigrations: true, cleanRestart: false, mergeSource: 'shared' as const }, switch: { restartMode: 'none' as const }, realign: { defaultScope: 'edt' as const, restartMode: 'none' as const }, dashboard: { restartMode: 'simple' as const }, sharedTypes: { install: true, cleanRestart: false, commit: true, historyDepth: 20, maxCommitsScanned: 1000 },
        logs: {
          bufferSize: DEFAULT_SETTINGS.logs.bufferSize,
          startWithHistory: true,
          filterHistorySize: 20,
          filterHistoryGridMaxRows: 8,
          filterHistoryDedup: true,
          restartMode: 'simple' as const,
        },
        services: { healthCheckDisabled: [] },
      });

      await press(instance, stdin, KEYS.space);
      expect(store.getState().settings.logs.startWithHistory).toBe(false);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Space/arrows on the "Restart mode" group toggle simple/clean live and persist', async () => {
    const settingsPort: SettingsPort = {
      load: async () => ok({ settings: DEFAULT_SETTINGS, warning: null }),
      save: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ settings: settingsPort }));
    store.getState().openSettingsScreen();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, KEYS.tab); // -> Logs (group list)
      for (let i = 0; i < 5; i += 1) {
        await press(instance, stdin, KEYS.down); // -> "Restart mode"
      }
      await press(instance, stdin, KEYS.enter);

      await press(instance, stdin, KEYS.space);
      expect(store.getState().settings.logs.restartMode).toBe('clean');
      expect(settingsPort.save).toHaveBeenCalledWith(
        expect.objectContaining({ logs: expect.objectContaining({ restartMode: 'clean' }) }),
      );
      await press(instance, stdin, KEYS.space);
      expect(store.getState().settings.logs.restartMode).toBe('simple');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Right/Left/Space on the EDTs tab realign groups cycle realign.defaultScope and realign.restartMode live and persist', async () => {
    const settingsPort: SettingsPort = {
      load: async () => ok({ settings: DEFAULT_SETTINGS, warning: null }),
      save: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ settings: settingsPort }));
    store.getState().openSettingsScreen();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab); // General -> EDTs (group list)
      for (let i = 0; i < 4; i += 1) {
        await press(instance, stdin, KEYS.down); // -> "Realign default scope"
      }
      await press(instance, stdin, KEYS.enter);

      await press(instance, stdin, KEYS.right);
      expect(store.getState().settings.realign.defaultScope).toBe('all');
      expect(settingsPort.save).toHaveBeenLastCalledWith(expect.objectContaining({ realign: { defaultScope: 'all', restartMode: 'none' } }));
      await press(instance, stdin, KEYS.left);
      await press(instance, stdin, KEYS.left);
      expect(store.getState().settings.realign.defaultScope).toBe('none');
      await press(instance, stdin, KEYS.space);
      expect(store.getState().settings.realign.defaultScope).toBe('edt');
      expect(settingsPort.save).toHaveBeenLastCalledWith(expect.objectContaining({ realign: { defaultScope: 'edt', restartMode: 'none' } }));

      await pressEscape(instance, stdin); // back to the group list, cursor on "Realign default scope"
      await press(instance, stdin, KEYS.down); // -> "Post-realign restart"
      await press(instance, stdin, KEYS.enter);
      await press(instance, stdin, KEYS.right);
      expect(store.getState().settings.realign.restartMode).toBe('simple');
      await press(instance, stdin, KEYS.space);
      expect(store.getState().settings.realign.restartMode).toBe('clean');
      await press(instance, stdin, KEYS.left);
      expect(store.getState().settings.realign.restartMode).toBe('simple');
      expect(settingsPort.save).toHaveBeenLastCalledWith(expect.objectContaining({ realign: { defaultScope: 'edt', restartMode: 'simple' } }));
      expect(store.getState().settings.switch.restartMode).toBe('none');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Right/Left/Space on the EDTs tab "Heal restart mode" group flip dashboard.restartMode live and persist', async () => {
    const settingsPort: SettingsPort = {
      load: async () => ok({ settings: DEFAULT_SETTINGS, warning: null }),
      save: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ settings: settingsPort }));
    store.getState().openSettingsScreen();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab); // General -> EDTs (group list)
      const healIndex = SETTINGS_GROUPS.findIndex((group) => group.id === 'heal-restart');
      expect(healIndex).toBeGreaterThan(0);
      for (let i = 0; i < healIndex; i += 1) {
        await press(instance, stdin, KEYS.down); // -> "Heal restart mode"
      }
      await press(instance, stdin, KEYS.enter);

      await press(instance, stdin, KEYS.right);
      expect(store.getState().settings.dashboard.restartMode).toBe('clean');
      expect(settingsPort.save).toHaveBeenLastCalledWith(expect.objectContaining({ dashboard: { restartMode: 'clean' } }));
      await press(instance, stdin, KEYS.left);
      expect(store.getState().settings.dashboard.restartMode).toBe('simple');
      await press(instance, stdin, KEYS.space);
      expect(store.getState().settings.dashboard.restartMode).toBe('clean');
      expect(settingsPort.save).toHaveBeenLastCalledWith(expect.objectContaining({ dashboard: { restartMode: 'clean' } }));
      expect(store.getState().settings.realign.restartMode).toBe('none');
      expect(store.getState().settings.switch.restartMode).toBe('none');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  // End-to-end coverage of the filter-history fields and the clear actions, real-keypress
  // driven (mirrors the two tests just above).
  it('Left/Right on the "Filter history size"/"Filter history grid" groups adjusts them live and persists', async () => {
    const settingsPort: SettingsPort = {
      load: async () => ok({ settings: DEFAULT_SETTINGS, warning: null }),
      save: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ settings: settingsPort }));
    store.getState().openSettingsScreen();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab); // General -> EDTs
      await press(instance, stdin, KEYS.tab); // EDTs -> Command Palette
      await press(instance, stdin, KEYS.tab); // Command Palette -> Logs (group list)
      await press(instance, stdin, KEYS.down); // -> "Start with history"
      await press(instance, stdin, KEYS.down); // -> "Filter history size"
      await press(instance, stdin, KEYS.enter); // drill in

      await press(instance, stdin, KEYS.right);
      expect(store.getState().settings.logs.filterHistorySize).toBe(25);

      await pressEscape(instance, stdin); // back to the group list
      await press(instance, stdin, KEYS.down); // -> "Filter history grid"
      await press(instance, stdin, KEYS.enter); // drill in
      await press(instance, stdin, KEYS.right);
      expect(store.getState().settings.logs.filterHistoryGridMaxRows).toBe(9);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Enter on "Clear global filter history" clears both global lists; Enter on "Clear a service\'s filter history" drills into a service list that clears just that service\'s lists', async () => {
    const store = createAppStore(fakeDeps());
    store.getState().commitFilterHistoryEntry({ scope: 'global', repoPath: null, mode: 'text' }, 'g-text');
    store.getState().commitFilterHistoryEntry({ scope: 'pane', repoPath: '/repo/a', mode: 'text' }, 'a-text');
    store.setState({
      edtsBranches: [
        { service: 'svc-a', path: '/repo/a', isMember: false, branch: 'main', ahead: 0, behind: 0, status: 'current', sharedBranch: 'development', protectedBranches: [] },
      ],
    });
    store.getState().openSettingsScreen();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab); // General -> EDTs
      await press(instance, stdin, KEYS.tab); // EDTs -> Command Palette
      await press(instance, stdin, KEYS.tab); // Command Palette -> Logs (group list)
      await press(instance, stdin, KEYS.down); // -> "Start with history"
      await press(instance, stdin, KEYS.down); // -> "Filter history size"
      await press(instance, stdin, KEYS.down); // -> "Filter history grid"
      await press(instance, stdin, KEYS.down); // -> "Filter history dedup"
      await press(instance, stdin, KEYS.down); // -> "Restart mode"
      await press(instance, stdin, KEYS.down); // -> "Clear history"
      await press(instance, stdin, KEYS.enter); // drill in (row cursor on clear-global)

      await press(instance, stdin, KEYS.enter);
      expect(store.getState().filterHistory['global:text']).toBeUndefined();
      expect(store.getState().filterHistory['service:/repo/a:text']).toEqual(['a-text']);

      await press(instance, stdin, KEYS.down); // -> clear-service
      await press(instance, stdin, KEYS.enter); // drill into the service list
      await press(instance, stdin, KEYS.enter); // clear svc-a's history

      expect(store.getState().filterHistory['service:/repo/a:text']).toBeUndefined();
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Space on a "Hint visibility" checkbox row toggles that hint into settings.edts.hiddenActionHints and persists', async () => {
    const settingsPort: SettingsPort = {
      load: async () => ok({ settings: DEFAULT_SETTINGS, warning: null }),
      save: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ settings: settingsPort }));
    store.getState().openSettingsScreen();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab); // General -> EDTs (group list)
      await press(instance, stdin, KEYS.enter); // drill into "Hint visibility" (first row highlighted)

      await press(instance, stdin, ' ');

      expect(store.getState().settings.edts.hiddenActionHints).toEqual(['edts']);
      expect(settingsPort.save).toHaveBeenCalledWith({
        general: { quitShortcutEnabled: true, editorCommand: '' },
        commandPalette: { gridMaxRows: 8, historySize: 20, historyDedup: true },
        edts: { hiddenActionHints: ['edts'], hiddenActionTypes: [], branchDropdownMaxRows: 5, sharedBranchesEdtEnabled: false },
        update: { concurrency: 3, runMigrations: true, cleanRestart: false, mergeSource: 'shared' as const }, sharedTypes: { install: true, cleanRestart: false, commit: true, historyDepth: 20, maxCommitsScanned: 1000 }, switch: { restartMode: 'none' as const }, realign: { defaultScope: 'edt' as const, restartMode: 'none' as const }, dashboard: { restartMode: 'simple' as const }, logs: { bufferSize: 500, startWithHistory: false, filterHistorySize: 20, filterHistoryGridMaxRows: 8, filterHistoryDedup: true, restartMode: 'simple' as const }, services: { healthCheckDisabled: [] as string[] },
      });
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Enter on the EDTs tab\'s group list drills into "Recent action types"; Space toggles a type into settings.edts.hiddenActionTypes and persists', async () => {
    const settingsPort: SettingsPort = {
      load: async () => ok({ settings: DEFAULT_SETTINGS, warning: null }),
      save: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ settings: settingsPort }));
    store.getState().openSettingsScreen();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab); // General -> EDTs (group list, "Hint visibility" highlighted)

      await press(instance, stdin, KEYS.down); // highlight "Recent action types"
      await press(instance, stdin, KEYS.enter); // drill in
      expect(stdout.output).toContain('Create');
      expect(stdout.output).toContain('Switch');
      expect(stdout.output).toContain('Modify');

      await press(instance, stdin, ' '); // toggle "Create" (first row)

      expect(store.getState().settings.edts.hiddenActionTypes).toEqual(['create']);
      expect(settingsPort.save).toHaveBeenCalledWith({
        general: { quitShortcutEnabled: true, editorCommand: '' },
        commandPalette: { gridMaxRows: 8, historySize: 20, historyDedup: true },
        edts: { hiddenActionHints: [], hiddenActionTypes: ['create'], branchDropdownMaxRows: 5, sharedBranchesEdtEnabled: false },
        update: { concurrency: 3, runMigrations: true, cleanRestart: false, mergeSource: 'shared' as const }, sharedTypes: { install: true, cleanRestart: false, commit: true, historyDepth: 20, maxCommitsScanned: 1000 }, switch: { restartMode: 'none' as const }, realign: { defaultScope: 'edt' as const, restartMode: 'none' as const }, dashboard: { restartMode: 'simple' as const }, logs: { bufferSize: 500, startWithHistory: false, filterHistorySize: 20, filterHistoryGridMaxRows: 8, filterHistoryDedup: true, restartMode: 'simple' as const }, services: { healthCheckDisabled: [] as string[] },
      });
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});
