// AppShell real-keypress tests: renderToString's fake stdin never emits a real keypress and
// the zone interaction tests never mount AppShell, so only these tests (real Ink input via
// shared/test-support/fake-tty.ts) observe whether a keystroke reaches, or is blocked from,
// AppShell's global dispatch — e.g. the zoneInputCaptured gate.
import { createElement } from 'react';
import { render } from 'ink';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { ok } from '../../../core/result.js';
import type { EdtRegistryEntry, EdtRegistryPort } from '../../../core/ports/edt-registry.js';
import type { ManifestPort } from '../../../core/ports/manifest.js';
import type { StatePort } from '../../../core/ports/state.js';
import { DEFAULT_SETTINGS, type SettingsPort } from '../../../core/ports/settings.js';
import { AppShell } from './app-shell.js';
import { createAppStore } from './store/app-store.js';
import { fakeInteractiveTtyStdin, FakeTtyStdout, KEYS } from './shared/test-support/fake-tty.js';
import { footerIdOf } from './shared/test-support/mount-for-test.js';
import { filterKeybindings } from './shared/components/keybinding-help.js';
import { KEYBINDINGS } from './keybindings/index.js';
import { SETTINGS_GROUPS } from './shared/settings-screen.js';
import { fakeDeps, flushAsyncLoad, mount, press, pressEscape } from './app-shell.test-support.js';
import { manifestFor } from './store/store.test-support.js';

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
        edts: { hiddenActionHints: [], hiddenActionTypes: [], branchDropdownMaxRows: 5 },
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
        edts: { hiddenActionHints: [], hiddenActionTypes: [], branchDropdownMaxRows: 5 },
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
        edts: { hiddenActionHints: [], hiddenActionTypes: [], branchDropdownMaxRows: 5 },
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
        edts: { hiddenActionHints: [], hiddenActionTypes: [], branchDropdownMaxRows: 5 },
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
        edts: { hiddenActionHints: ['edts'], hiddenActionTypes: [], branchDropdownMaxRows: 5 },
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
        edts: { hiddenActionHints: [], hiddenActionTypes: ['create'], branchDropdownMaxRows: 5 },
        update: { concurrency: 3, runMigrations: true, cleanRestart: false, mergeSource: 'shared' as const }, sharedTypes: { install: true, cleanRestart: false, commit: true, historyDepth: 20, maxCommitsScanned: 1000 }, switch: { restartMode: 'none' as const }, realign: { defaultScope: 'edt' as const, restartMode: 'none' as const }, dashboard: { restartMode: 'simple' as const }, logs: { bufferSize: 500, startWithHistory: false, filterHistorySize: 20, filterHistoryGridMaxRows: 8, filterHistoryDedup: true, restartMode: 'simple' as const }, services: { healthCheckDisabled: [] as string[] },
      });
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});

describe('AppShell tabVisibility load activation', () => {
  it('loads real tabVisibility from wired deps on mount — reflected in store state and the rendered tab bar', async () => {
    const manifest: ManifestPort = {
      load: vi.fn(async (path: string) => ok({ ...manifestFor(path), modules: { 'route-explorer': {} } })),
    };
    const store = createAppStore(fakeDeps({ manifest }));

    const { instance, stdout } = mount(store);
    try {
      await flushAsyncLoad(instance);

      // routes has one carrying repo (svc-a) but no active EDT — 'disabled', not 'enabled'.
      // sharedTypes has zero carrying repos — 'omitted'. Neither is the pre-load default
      // (both 'enabled'), so this can only pass if the mount effect actually loaded real data.
      expect(store.getState().tabVisibility).toEqual({
        routes: { status: 'disabled', carryingServices: ['svc-a'] },
        sharedTypes: { status: 'omitted', carryingServices: [] },
      });
      // The tab bar reflects it too: routes (disabled) stays reachable, shared-types
      // (omitted) is dropped from the bar entirely. `stdout.output` accumulates every frame
      // (including the pre-load one, which still shows both tabs) — the TopBar's "tui-back"
      // label re-renders at the start of every frame, so its last occurrence marks where the
      // final (post-load) frame begins.
      const output = stdout.output;
      const lastFrame = output.slice(output.lastIndexOf('tui-back'));
      expect(lastFrame).toContain('[r] Routes');
      expect(lastFrame).not.toContain('[s] Shared types');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('reloads tabVisibility after closeRegistryScreen() is called on an already-mounted shell', async () => {
    let loadCount = 0;
    const manifest: ManifestPort = {
      load: vi.fn(async (path: string) => {
        loadCount += 1;
        // Only the reload triggered by closing the registry screen (the 3rd load: mount,
        // then the open->close flip) reports the carrying module — isolates the assertion to
        // that specific reload rather than any load happening at all.
        const modules: Record<string, Record<string, unknown>> = loadCount >= 3 ? { 'route-explorer': {} } : {};
        return ok({ ...manifestFor(path), modules });
      }),
    };
    const store = createAppStore(fakeDeps({ manifest }));

    const { instance } = mount(store);
    try {
      await flushAsyncLoad(instance);
      expect(store.getState().tabVisibility.routes.status).toBe('omitted');

      // Simulate the registry screen having been opened (without exercising openRegistryScreen
      // itself, which is a separate concern) so closeRegistryScreen() below actually flips
      // registryScreenOpen false->true->false, re-triggering AppShell's effect.
      store.setState({ registryScreenOpen: true });
      await flushAsyncLoad(instance);

      store.getState().closeRegistryScreen();
      await flushAsyncLoad(instance);

      expect(store.getState().tabVisibility.routes).toEqual({
        status: 'disabled',
        carryingServices: ['svc-a'],
      });
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});

describe('AppShell edts load activation', () => {
  it('resolves the active EDT topic in the top bar from a wired mount-time loadEdts(), without ever visiting the EDTs zone', async () => {
    const edtRegistry: EdtRegistryPort = {
      add: vi.fn(async () => ok(undefined)),
      list: vi.fn(async () =>
        ok([
          {
            ulid: '01JXXXXX1AAAAAAAAAAAAAAAAA',
            topic: 'checkout-revamp',
            createdAt: '2026-01-01T00:00:00.000Z',
            status: 'active',
            members: [],
          },
        ] as EdtRegistryEntry[]),
      ),
      setStatus: vi.fn(async () => ok(undefined)),
      update: vi.fn(async () => ok(undefined)),
      remove: vi.fn(async () => ok(undefined)),
    };
    const state: StatePort = {
      readActiveEdt: vi.fn(async () => ok('01JXXXXX1AAAAAAAAAAAAAAAAA')),
      writeActiveEdt: vi.fn(async () => ok(undefined)),
      readSplitterRatios: vi.fn(async () => ok(null)),
      writeSplitterRatios: vi.fn(async () => ok(undefined)),
      readFilterHistory: vi.fn(async () => ok(null)),
      writeFilterHistory: vi.fn(async () => ok(undefined)),
      readCommandHistory: vi.fn(async () => ok(null)),
      writeCommandHistory: vi.fn(async () => ok(undefined)),
      readLogRules: vi.fn(async () => ok(null)),
      writeLogRules: vi.fn(async () => ok(undefined)),
      readLogRuleSets: vi.fn(async () => ok(null)),
      writeLogRuleSets: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ edtRegistry, state }));

    // The default activeZone is 'dashboard' — this test never switches to 'edts', so
    // EdtsZone's own mount-time loadEdts() call never fires; the store's edts/activeEdt can
    // only be populated by AppShell's own mount-time loadEdts() effect.
    expect(store.getState().activeZone).toBe('dashboard');

    const { instance, stdout } = mount(store);
    try {
      await flushAsyncLoad(instance);

      expect(store.getState().edts).toEqual([
        expect.objectContaining({ ulid: '01JXXXXX1AAAAAAAAAAAAAAAAA', topic: 'checkout-revamp' }),
      ]);
      expect(store.getState().activeEdt).toBe('01JXXXXX1AAAAAAAAAAAAAAAAA');

      const output = stdout.output;
      const lastFrame = output.slice(output.lastIndexOf('tui-back'));
      expect(lastFrame).toContain('checkout-revamp');
      expect(lastFrame).not.toContain('01JXXXXX1AAAAAAAAAAAAAAAAA');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});

// Mounts AppShell with a StatePort.readSplitterRatios stub returning a non-null persisted map
// and asserts the store reflects it post-mount (every other test here stubs it as ok(null)).
describe('AppShell splitterRatios load activation', () => {
  it('resolves store.splitterRatios from a wired mount-time loadSplitterRatios(), independent of which zone renders first', async () => {
    const state: StatePort = {
      readActiveEdt: vi.fn(async () => ok(null)),
      writeActiveEdt: vi.fn(async () => ok(undefined)),
      readSplitterRatios: vi.fn(async () => ok({ edts: [0.3, 0.4, 0.5], dashboard: [0.6] })),
      writeSplitterRatios: vi.fn(async () => ok(undefined)),
      readFilterHistory: vi.fn(async () => ok(null)),
      writeFilterHistory: vi.fn(async () => ok(undefined)),
      readCommandHistory: vi.fn(async () => ok(null)),
      writeCommandHistory: vi.fn(async () => ok(undefined)),
      readLogRules: vi.fn(async () => ok(null)),
      writeLogRules: vi.fn(async () => ok(undefined)),
      readLogRuleSets: vi.fn(async () => ok(null)),
      writeLogRuleSets: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ state }));

    // The default activeZone is 'dashboard' — this test never switches to 'edts', so the
    // persisted ratios can only be populated by AppShell's own mount-time
    // loadSplitterRatios() effect, not by EdtsZone ever mounting.
    expect(store.getState().activeZone).toBe('dashboard');
    expect(store.getState().splitterRatios.edts).not.toEqual([0.3, 0.4, 0.5]);

    const { instance } = mount(store);
    try {
      await flushAsyncLoad(instance);

      expect(store.getState().splitterRatios.edts).toEqual([0.3, 0.4, 0.5]);
      expect(store.getState().splitterRatios.dashboard).toEqual([0.6]);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});

describe('AppShell commandHistory load activation', () => {
  it('resolves store.commandHistory from a wired mount-time loadCommandHistory()', async () => {
    const state: StatePort = {
      readActiveEdt: vi.fn(async () => ok(null)),
      writeActiveEdt: vi.fn(async () => ok(undefined)),
      readSplitterRatios: vi.fn(async () => ok(null)),
      writeSplitterRatios: vi.fn(async () => ok(undefined)),
      readFilterHistory: vi.fn(async () => ok(null)),
      writeFilterHistory: vi.fn(async () => ok(undefined)),
      readCommandHistory: vi.fn(async () => ok(['settings', 'registry'])),
      writeCommandHistory: vi.fn(async () => ok(undefined)),
      readLogRules: vi.fn(async () => ok(null)),
      writeLogRules: vi.fn(async () => ok(undefined)),
      readLogRuleSets: vi.fn(async () => ok(null)),
      writeLogRuleSets: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ state }));
    expect(store.getState().commandHistory).toEqual([]);

    const { instance } = mount(store);
    try {
      await flushAsyncLoad(instance);

      expect(state.readCommandHistory).toHaveBeenCalled();
      expect(store.getState().commandHistory).toEqual(['settings', 'registry']);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});

describe('AppShell Ctrl+W resize-mode', () => {
  it.each(['dashboard', 'update', 'logs', 'routes', 'shared-types'] as const)('Ctrl+W engages resize-mode on boundary 0 in the %s zone', async (zone) => {
    const store = createAppStore();
    store.getState().setActiveZone(zone);
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await press(instance, stdin, KEYS.ctrlW);

      expect(store.getState().resizeMode).toEqual({ zone, targetBoundary: 0 });
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Ctrl+W is a no-op while the Logs fullscreen preview is open', async () => {
    const store = createAppStore();
    store.getState().setActiveZone('logs');
    store.setState({ logsFullscreenTarget: '/repos/api-gateway', logsFullscreenServiceName: 'api-gateway' });
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await press(instance, stdin, KEYS.ctrlW);

      expect(store.getState().resizeMode).toBeNull();
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Ctrl+W engages resize-mode, targeting boundary 0, while the EDTs zone is active', async () => {
    const store = createAppStore();
    store.getState().setActiveZone('edts');
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await press(instance, stdin, KEYS.ctrlW);

      expect(store.getState().resizeMode).toEqual({ zone: 'edts', targetBoundary: 0 });
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Ctrl+W under the command bar overlay is a no-op', async () => {
    const store = createAppStore();
    store.getState().setActiveZone('edts');
    store.getState().openCommandBar();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await press(instance, stdin, KEYS.ctrlW);

      expect(store.getState().resizeMode).toBeNull();
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Shift+Tab in resize-mode reverses the target boundary, wrapping first to last', async () => {
    const store = createAppStore();
    store.getState().setActiveZone('edts');
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.ctrlW);
      expect(store.getState().resizeMode).toEqual({ zone: 'edts', targetBoundary: 0 });

      await press(instance, stdin, KEYS.shiftTab);
      expect(store.getState().resizeMode).toEqual({ zone: 'edts', targetBoundary: 2 });

      await press(instance, stdin, KEYS.shiftTab);
      expect(store.getState().resizeMode).toEqual({ zone: 'edts', targetBoundary: 1 });
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('a second Ctrl+W while resize-mode is already active is a no-op', async () => {
    const store = createAppStore();
    store.getState().setActiveZone('edts');
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await press(instance, stdin, KEYS.ctrlW);
      expect(store.getState().resizeMode).toEqual({ zone: 'edts', targetBoundary: 0 });

      // Move the target off boundary 0 first, so a second Ctrl+W silently re-entering
      // (targetBoundary reset to 0) would be observable rather than coincidentally matching
      // the already-correct state.
      await press(instance, stdin, KEYS.tab);
      expect(store.getState().resizeMode).toEqual({ zone: 'edts', targetBoundary: 1 });

      await press(instance, stdin, KEYS.ctrlW);

      // Still targeting boundary 1 — the second Ctrl+W was swallowed as "every other key is
      // inert while resize-mode owns input", never re-entering (which would have reset
      // targetBoundary back to 0) and never exiting either.
      expect(store.getState().resizeMode).toEqual({ zone: 'edts', targetBoundary: 1 });
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Tab cycles the targeted boundary across all 3, wrapping back to 0 — and never touches EdtsZone\'s own paneFocus', async () => {
    // A populated, successfully-loaded EDT so the detail pane's "Topic: ..." line
    // (formatEdtDetail, unique to the EDT-selector's own detail content — never rendered by
    // either services pane) is a reliable, plain-text signal for "paneFocus is still 'edts'".
    // EdtsZone's own Tab handler (cyclePaneFocus) would otherwise move this to
    // 'edt-services' on the very first Tab. An *unwired* store's own mount-time loadEdts()
    // flips edtsStatus to 'error' (edtsRows then renders as empty regardless of any seeded
    // `edts` array — "never show stale rows under an error banner"), so this needs wired deps
    // with a populated edtRegistry, not a bare `createAppStore()` + `setState`.
    const edtRegistry: EdtRegistryPort = {
      add: vi.fn(async () => ok(undefined)),
      list: vi.fn(async () =>
        ok([
          {
            ulid: '01JXXXXX1AAAAAAAAAAAAAAAAA',
            topic: 'checkout-revamp',
            createdAt: '2026-01-01T00:00:00.000Z',
            status: 'active',
            members: [],
          },
        ] as EdtRegistryEntry[]),
      ),
      setStatus: vi.fn(async () => ok(undefined)),
      update: vi.fn(async () => ok(undefined)),
      remove: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ edtRegistry }));
    store.getState().setActiveZone('edts');
    store.getState().enterResizeMode('edts');
    const { instance, stdin, stdout } = mount(store);
    // `stdout.output` accumulates every frame ever written — a string only ever needs to have
    // appeared *once* to satisfy a plain `toContain` against it, so a stale first-render frame
    // could hide a real regression on a later frame. Slice out just the most recent frame
    // (mirrors 'AppShell edts load activation' above) before every assertion below.
    const lastFrame = () => stdout.output.slice(stdout.output.lastIndexOf('tui-back'));
    try {
      await flushAsyncLoad(instance);
      expect(lastFrame()).toContain('Topic: checkout-revamp');

      await press(instance, stdin, KEYS.tab);
      expect(store.getState().resizeMode?.targetBoundary).toBe(1);
      expect(lastFrame()).toContain('Topic: checkout-revamp');

      await press(instance, stdin, KEYS.tab);
      expect(store.getState().resizeMode?.targetBoundary).toBe(2);
      expect(lastFrame()).toContain('Topic: checkout-revamp');

      await press(instance, stdin, KEYS.tab);
      expect(store.getState().resizeMode?.targetBoundary).toBe(0);
      expect(lastFrame()).toContain('Topic: checkout-revamp');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Left/Right resize the vertical boundary 0 (list<->detail split), clamped', async () => {
    const store = createAppStore();
    store.getState().setActiveZone('edts');
    store.getState().enterResizeMode('edts');
    const before = store.getState().splitterRatios.edts[0];
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await press(instance, stdin, KEYS.right);
      expect(store.getState().splitterRatios.edts[0]).toBeCloseTo(before + 0.05);

      await press(instance, stdin, KEYS.left);
      await press(instance, stdin, KEYS.left);
      expect(store.getState().splitterRatios.edts[0]).toBeCloseTo(before - 0.05);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Up/Down resize a horizontal boundary (1/2), while boundary 0 is unaffected', async () => {
    const store = createAppStore();
    store.getState().setActiveZone('edts');
    store.getState().enterResizeMode('edts');
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      // Tab from boundary 0 to boundary 1 (the EDTs zone's first horizontal sub-split).
      await press(instance, stdin, KEYS.tab);
      const boundary0Before = store.getState().splitterRatios.edts[0];
      const boundary1Before = store.getState().splitterRatios.edts[1];

      await press(instance, stdin, KEYS.down);

      expect(store.getState().splitterRatios.edts[1]).toBeCloseTo(boundary1Before + 0.05);
      expect(store.getState().splitterRatios.edts[0]).toBe(boundary0Before);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('a horizontal boundary ignores Left/Right (wrong axis) — no-op', async () => {
    const store = createAppStore();
    store.getState().setActiveZone('edts');
    store.getState().enterResizeMode('edts');
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.tab);
      const before = store.getState().splitterRatios.edts[1];

      await press(instance, stdin, KEYS.right);

      expect(store.getState().splitterRatios.edts[1]).toBe(before);
      // Left/Right's usual zone-switch binding is also inert while resize-mode is active.
      expect(store.getState().activeZone).toBe('edts');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Enter exits resize-mode with no separate save step (the live move already applied)', async () => {
    const store = createAppStore();
    store.getState().setActiveZone('edts');
    store.getState().enterResizeMode('edts');
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.right);
      const movedRatio = store.getState().splitterRatios.edts[0];

      await press(instance, stdin, KEYS.enter);

      expect(store.getState().resizeMode).toBeNull();
      expect(store.getState().splitterRatios.edts[0]).toBe(movedRatio);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('Esc exits resize-mode and normal keys (e.g. zone-switch arrows) resume', async () => {
    const store = createAppStore();
    store.getState().setActiveZone('edts');
    store.getState().enterResizeMode('edts');
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await pressEscape(instance, stdin);
      expect(store.getState().resizeMode).toBeNull();

      await press(instance, stdin, KEYS.right);
      expect(store.getState().activeZone).toBe('update');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('resize-mode persists boundary moves via StatePort.writeSplitterRatios', async () => {
    const writeSplitterRatios = vi.fn(async () => ok(undefined));
    const state: StatePort = {
      readActiveEdt: vi.fn(async () => ok(null)),
      writeActiveEdt: vi.fn(async () => ok(undefined)),
      readSplitterRatios: vi.fn(async () => ok(null)),
      writeSplitterRatios,
      readFilterHistory: vi.fn(async () => ok(null)),
      writeFilterHistory: vi.fn(async () => ok(undefined)),
      readCommandHistory: vi.fn(async () => ok(null)),
      writeCommandHistory: vi.fn(async () => ok(undefined)),
      readLogRules: vi.fn(async () => ok(null)),
      writeLogRules: vi.fn(async () => ok(undefined)),
      readLogRuleSets: vi.fn(async () => ok(null)),
      writeLogRuleSets: vi.fn(async () => ok(undefined)),
    };
    // A non-empty EDT registry: an empty one auto-opens the EDTs zone's create dialog, which
    // sets zoneInputCaptured — that would swallow the Ctrl+W-driven resize keypress below
    // before it ever reaches AppShell's resize-mode dispatch.
    const edtRegistry: EdtRegistryPort = {
      add: vi.fn(async () => ok(undefined)),
      list: vi.fn(async () =>
        ok([
          {
            ulid: '01JXXXXX1AAAAAAAAAAAAAAAAA',
            topic: 'checkout-revamp',
            createdAt: '2026-01-01T00:00:00.000Z',
            status: 'active',
            members: [],
          },
        ] as EdtRegistryEntry[]),
      ),
      setStatus: vi.fn(async () => ok(undefined)),
      update: vi.fn(async () => ok(undefined)),
      remove: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ state, edtRegistry }));
    store.getState().setActiveZone('edts');
    store.getState().enterResizeMode('edts');
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await press(instance, stdin, KEYS.right);
      // setSplitterRatio's own persistence chain is awaited internally, but the dispatch call
      // itself is fire-and-forget (`void`) from app-shell.tsx — give the microtask queue a
      // turn to flush before asserting the write actually landed.
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(writeSplitterRatios).toHaveBeenCalledWith(store.getState().splitterRatios);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});

describe('AppShell reset screen (:reset)', () => {
  function statefulDeps() {
    const disk = {
      edts: [
        {
          ulid: 'ULID1',
          topic: 'feature-a',
          createdAt: '2026-09-29T00:00:00.000Z',
          status: 'active' as const,
          members: [{ service: 'svc-a', repoPath: '/repo/a', branch: 'feat/a' }],
        },
      ] as EdtRegistryEntry[],
      activeEdt: 'ULID1' as string | null,
    };
    const edtRegistry: EdtRegistryPort = {
      add: vi.fn(async () => ok(undefined)),
      list: vi.fn(async () => ok([...disk.edts])),
      setStatus: vi.fn(async () => ok(undefined)),
      update: vi.fn(async () => ok(undefined)),
      remove: vi.fn(async (ulid: string) => {
        disk.edts = disk.edts.filter((e) => e.ulid !== ulid);
        return ok(undefined);
      }),
    };
    const base = fakeDeps();
    const state: StatePort = {
      ...base.state,
      readActiveEdt: vi.fn(async () => ok(disk.activeEdt)),
      writeActiveEdt: vi.fn(async (ulid: string | null) => {
        disk.activeEdt = ulid;
        return ok(undefined);
      }),
    };
    return { deps: fakeDeps({ edtRegistry, state, edtsBaseDir: resetEdtsBaseDir }), disk };
  }

  // A real tmp EDT data dir, so the wipe is exercised against the filesystem.
  let resetTmpRoot: string;
  let resetEdtsBaseDir: string;
  beforeEach(async () => {
    resetTmpRoot = await mkdtemp(join(tmpdir(), 'tui-back-reset-shell-'));
    resetEdtsBaseDir = join(resetTmpRoot, 'edts');
    await mkdir(join(resetEdtsBaseDir, 'ULID1'), { recursive: true });
    await writeFile(join(resetEdtsBaseDir, 'ULID1.db'), 'db');
  });
  afterEach(async () => {
    await rm(resetTmpRoot, { recursive: true, force: true });
  });

  function mountWithQuitSpy(store: ReturnType<typeof createAppStore>) {
    const stdout = new FakeTtyStdout();
    const stdin = fakeInteractiveTtyStdin();
    const onQuit = vi.fn();
    const instance = render(createElement(AppShell, { useStore: store, onQuit }), {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin,
      interactive: true,
      exitOnCtrlC: false,
      patchConsole: false,
    });
    return { instance, stdout, stdin, onQuit };
  }

  it('with the overlay open, single global-shortcut keys never leak to AppShell', async () => {
    const { deps } = statefulDeps();
    const store = createAppStore(deps);
    const { instance, stdin, onQuit } = mountWithQuitSpy(store);
    try {
      await flushAsyncLoad(instance);
      store.getState().openResetScreen();
      await flushAsyncLoad(instance);
      const zoneBefore = store.getState().activeZone;

      // One character per press, so each one arrives as its own keystroke.
      for (const key of ['e', 'r', 'l', ':', 'q', '?', KEYS.right]) {
        await press(instance, stdin, key);
      }

      expect(store.getState().activeZone).toBe(zoneBefore);
      expect(store.getState().commandBarOpen).toBe(false);
      expect(store.getState().helpOpen).toBe(false);
      expect(onQuit).not.toHaveBeenCalled();
      expect(store.getState().resetScreenOpen).toBe(true);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('with the overlay open over the EDTs zone, Enter/Space never reach the zone', async () => {
    const { deps } = statefulDeps();
    const store = createAppStore(deps);
    store.getState().setActiveZone('edts');
    const { instance, stdin } = mountWithQuitSpy(store);
    try {
      await flushAsyncLoad(instance);
      store.getState().openResetScreen();
      await flushAsyncLoad(instance);

      await press(instance, stdin, KEYS.space);
      await press(instance, stdin, KEYS.enter);
      await flushAsyncLoad(instance);

      // Enter on the EDTs zone's focused (active) EDT would open its modify dialog, which
      // captures input — it must not have happened underneath the overlay.
      expect(store.getState().zoneInputCaptured).toBe(false);
      expect(store.getState().activeZone).toBe('edts');

      // Control: once the overlay closes, the same Enter does reach the zone.
      await pressEscape(instance, stdin);
      expect(store.getState().resetScreenOpen).toBe(false);
      await press(instance, stdin, KEYS.enter);
      await flushAsyncLoad(instance);
      expect(store.getState().zoneInputCaptured).toBe(true);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('while a reset is running, Esc and other keys are ignored', async () => {
    const store = createAppStore();
    store.setState({ resetScreenOpen: true, resetStatus: 'running' });
    const { instance, stdin, stdout } = mountWithQuitSpy(store);
    try {
      await instance.waitUntilRenderFlush();
      expect(stdout.output).toContain('Resetting…');

      await pressEscape(instance, stdin);
      await press(instance, stdin, KEYS.enter);
      await press(instance, stdin, ':');

      expect(store.getState().resetScreenOpen).toBe(true);
      expect(store.getState().resetStatus).toBe('running');
      expect(store.getState().commandBarOpen).toBe(false);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('opens only through the `reset` command, and Esc closes it with zero writes', async () => {
    const { deps } = statefulDeps();
    const store = createAppStore(deps);
    const { instance, stdin, stdout } = mount(store);
    try {
      await flushAsyncLoad(instance);

      await press(instance, stdin, ':');
      await press(instance, stdin, 'reset');
      await press(instance, stdin, KEYS.enter);

      expect(store.getState().resetScreenOpen).toBe(true);
      expect(stdout.output).toContain('RESET TOOL DATA');

      await press(instance, stdin, KEYS.space);
      await press(instance, stdin, KEYS.enter);
      await pressEscape(instance, stdin);

      expect(store.getState().resetScreenOpen).toBe(false);
      expect(deps.edtRegistry.remove).not.toHaveBeenCalled();
      expect(deps.state.writeActiveEdt).not.toHaveBeenCalled();
      expect(deps.state.writeFilterHistory).not.toHaveBeenCalled();
      expect(deps.registry.remove).not.toHaveBeenCalled();
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('BUSY: is refused while a run is in progress, with the reason shown', async () => {
    const store = createAppStore();
    store.getState().setRunInProgress(true);
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await press(instance, stdin, ':');
      await press(instance, stdin, 'reset');
      await press(instance, stdin, KEYS.enter);

      expect(store.getState().resetScreenOpen).toBe(false);
      expect(stdout.output).toContain('Reset unavailable');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('a wrong confirmation word writes nothing; the exact word resets and rehydrates the store', async () => {
    const { deps, disk } = statefulDeps();
    const store = createAppStore(deps);
    const { instance, stdin, stdout } = mount(store);
    try {
      await flushAsyncLoad(instance);
      expect(store.getState().activeEdt).toBe('ULID1');

      store.getState().openResetScreen();
      await flushAsyncLoad(instance);

      await press(instance, stdin, KEYS.space); // EDTs
      await press(instance, stdin, KEYS.enter); // -> summary
      expect(stdout.output).toContain('feature-a');
      await press(instance, stdin, KEYS.enter); // -> confirm

      // `?` must type into the confirm field, never open global help on top of it.
      await press(instance, stdin, '?');
      expect(store.getState().helpOpen).toBe(false);
      await press(instance, stdin, KEYS.backspace);

      await press(instance, stdin, 'Reset');
      await press(instance, stdin, KEYS.enter);
      await flushAsyncLoad(instance);
      expect(deps.edtRegistry.remove).not.toHaveBeenCalled();
      expect(store.getState().resetStatus).toBe('idle');

      for (let i = 0; i < 5; i += 1) {
        await press(instance, stdin, KEYS.backspace);
      }
      await press(instance, stdin, 'reset');
      await press(instance, stdin, KEYS.enter);
      await flushAsyncLoad(instance);

      expect(disk.edts).toEqual([]);
      expect(disk.activeEdt).toBeNull();
      expect(await readdir(resetEdtsBaseDir)).toEqual([]);
      expect(store.getState().resetStatus).toBe('done');
      expect(store.getState().edts).toEqual([]);
      expect(store.getState().activeEdt).toBeNull();
      expect(stdout.output).toContain('svc-a / /repo/a / feat/a');

      await press(instance, stdin, KEYS.enter);
      expect(store.getState().resetScreenOpen).toBe(false);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});

describe('AppShell footer contexts (real keypress)', () => {
  const settle = async (instance: ReturnType<typeof render>) => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    await instance.waitUntilRenderFlush();
  };

  async function withShell(run: (ctx: { store: ReturnType<typeof createAppStore>; instance: ReturnType<typeof render>; stdin: NodeJS.ReadStream }) => Promise<void>) {
    const store = createAppStore();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await run({ store, instance, stdin });
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  }

  it('the help registers its context while open and clears it on close', async () => {
    await withShell(async ({ store, instance, stdin }) => {
      await press(instance, stdin, '?');
      await settle(instance);
      expect(footerIdOf(store)).toBe('help');
      await press(instance, stdin, '?');
      await settle(instance);
      expect(footerIdOf(store)).toBeUndefined();
    });
  });

  it('typing in the open help filters it; ? and Esc edit a non-empty filter before closing', async () => {
    await withShell(async ({ store, instance, stdin }) => {
      await press(instance, stdin, '?');
      await settle(instance);
      await press(instance, stdin, 'r');
      await press(instance, stdin, 'E');
      expect(store.getState()).toMatchObject({ helpOpen: true, helpFilter: 'rE', activeZone: 'dashboard' });
      await press(instance, stdin, KEYS.backspace);
      expect(store.getState().helpFilter).toBe('r');
      await press(instance, stdin, '?');
      expect(store.getState()).toMatchObject({ helpOpen: true, helpFilter: 'r?' });
      await pressEscape(instance, stdin);
      expect(store.getState()).toMatchObject({ helpOpen: true, helpFilter: '' });
      await press(instance, stdin, 'q');
      await pressEscape(instance, stdin);
      await press(instance, stdin, '?');
      expect(store.getState()).toMatchObject({ helpOpen: false, helpFilter: '' });
      await settle(instance);
      await press(instance, stdin, '?');
      expect(store.getState()).toMatchObject({ helpOpen: true, helpFilter: '' });
    });
  });

  // A wide, tall terminal so the whole help window renders unclipped and keys never wrap.
  function mountLarge(store: ReturnType<typeof createAppStore>) {
    const stdout = new FakeTtyStdout();
    stdout.columns = 200;
    stdout.rows = 60;
    const stdin = fakeInteractiveTtyStdin();
    const instance = render(createElement(AppShell, { useStore: store, onQuit: () => {} }), {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin,
      interactive: true,
      exitOnCtrlC: false,
      patchConsole: false,
    });
    const frame = () => stdout.output.slice(stdout.output.lastIndexOf('KEYBINDINGS'));
    return { instance, stdin, frame };
  }

  it('End then Up scrolls the filtered list by exactly one row', async () => {
    const store = createAppStore();
    const { instance, stdin, frame } = mountLarge(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, '?');
      await settle(instance);
      for (const char of 'logs') await press(instance, stdin, char);
      await settle(instance);
      const rows = filterKeybindings(KEYBINDINGS, 'logs');
      expect(rows.length).toBeGreaterThan(11);
      expect(rows.length).toBeLessThan(KEYBINDINGS.length);

      await press(instance, stdin, KEYS.end);
      await settle(instance);
      expect(frame()).toContain(`[${rows.at(-1)!.keys}]`);
      expect(frame()).toContain(`[${rows.at(-10)!.keys}]`);
      expect(frame()).not.toContain(`[${rows.at(-11)!.keys}]`);

      await press(instance, stdin, KEYS.up);
      await settle(instance);
      expect(frame()).toContain(`[${rows.at(-11)!.keys}]`);
      expect(frame()).toContain(`[${rows.at(-2)!.keys}]`);
      expect(frame()).not.toContain(`[${rows.at(-1)!.keys}]`);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('a filter change scrolls the help back to its first match', async () => {
    const store = createAppStore();
    const { instance, stdin, frame } = mountLarge(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, '?');
      await settle(instance);
      await press(instance, stdin, KEYS.end);
      await press(instance, stdin, KEYS.down);
      await settle(instance);
      expect(frame()).not.toContain(`[${KEYBINDINGS[0]!.keys}]`);

      await press(instance, stdin, 'z');
      await settle(instance);
      const matches = filterKeybindings(KEYBINDINGS, 'z');
      expect(matches.length).toBeGreaterThan(10);
      expect(frame()).toContain(`[${matches[0]!.keys}]`);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('q, : and a zone mnemonic typed in the open help only edit its filter', async () => {
    const store = createAppStore();
    const onQuit = vi.fn();
    const stdout = new FakeTtyStdout();
    const stdin = fakeInteractiveTtyStdin();
    const instance = render(createElement(AppShell, { useStore: store, onQuit }), {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin,
      interactive: true,
      exitOnCtrlC: false,
      patchConsole: false,
    });
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, '?');
      await settle(instance);
      const zone = store.getState().activeZone;
      await press(instance, stdin, 'q');
      await press(instance, stdin, ':');
      await press(instance, stdin, 'l');
      await settle(instance);
      expect(store.getState()).toMatchObject({
        helpOpen: true,
        helpFilter: 'q:l',
        commandBarOpen: false,
        quitRequested: false,
        activeZone: zone,
      });
      expect(onQuit).not.toHaveBeenCalled();
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('the open help footer lists the filter keys', async () => {
    const store = createAppStore();
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, '?');
      await settle(instance);
      const frame = stdout.output.slice(stdout.output.lastIndexOf('KEYBINDINGS'));
      expect(frame).toContain('type to filter');
      expect(frame).toContain('[type] filter');
      expect(frame).toContain('[Backspace] erase');
      expect(frame).toContain('[PgUp/PgDn] page');
      expect(frame).toContain('clear/close');
      expect(frame).not.toContain('[?] close');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('the command bar registers its context while open and clears it on Esc', async () => {
    await withShell(async ({ store, instance, stdin }) => {
      await press(instance, stdin, ':');
      await settle(instance);
      expect(footerIdOf(store)).toBe('command');
      await pressEscape(instance, stdin);
      await settle(instance);
      expect(footerIdOf(store)).toBeUndefined();
    });
  });

  it('a zone registering while the help is open does not take the footer from it', async () => {
    await withShell(async ({ store, instance, stdin }) => {
      await press(instance, stdin, '?');
      await settle(instance);
      store.getState().setFooterContext('edts', 'confirm');
      expect(footerIdOf(store)).toBe('help');
      await press(instance, stdin, '?');
      await settle(instance);
      expect(footerIdOf(store)).toBe('confirm');
    });
  });

  it('"?" still closes an open help panel when a zone dialog captured input meanwhile', async () => {
    const store = createAppStore();
    store.setState({ helpOpen: true, zoneInputCaptured: true });

    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();

      await press(instance, stdin, '?');

      expect(store.getState().helpOpen).toBe(false);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});

describe('AppShell realign overlay', () => {
  it('opens through `:realign`, owns every key while open, and Esc closes it', async () => {
    const store = createAppStore();
    const { instance, stdin, stdout } = mount(store);
    try {
      await flushAsyncLoad(instance);
      await press(instance, stdin, ':');
      await press(instance, stdin, 'realign');
      await press(instance, stdin, KEYS.enter);
      await flushAsyncLoad(instance);

      expect(store.getState().realignScreenOpen).toBe(true);
      expect(stdout.output).toContain('REALIGN');
      const zoneBefore = store.getState().activeZone;

      for (const key of ['e', 'u', ':', '?', KEYS.right]) {
        await press(instance, stdin, key);
      }
      expect(store.getState().activeZone).toBe(zoneBefore);
      expect(store.getState().commandBarOpen).toBe(false);
      expect(store.getState().helpOpen).toBe(false);
      expect(store.getState().realignScreenOpen).toBe(true);

      await pressEscape(instance, stdin);
      expect(store.getState().realignScreenOpen).toBe(false);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('while a realign is running, q does not quit', async () => {
    const store = createAppStore();
    store.setState({
      realignScreenOpen: true,
      realignCandidates: { status: 'ready', rows: [], error: null },
      realignRun: { status: 'running', restartMode: 'none', rows: [{ service: 'svc-a', path: '/repo/a', status: 'realigning' }], restartRows: [], restartError: null, error: null },
    });
    const stdout = new FakeTtyStdout();
    const stdin = fakeInteractiveTtyStdin();
    const onQuit = vi.fn();
    const instance = render(createElement(AppShell, { useStore: store, onQuit }), {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin,
      interactive: true,
      exitOnCtrlC: false,
      patchConsole: false,
    });
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, 'q');
      await instance.waitUntilRenderFlush();
      expect(onQuit).not.toHaveBeenCalled();
      expect(store.getState().quitRequested).toBe(false);
      expect(store.getState().realignScreenOpen).toBe(true);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('while a realign is running, Esc is ignored', async () => {
    const store = createAppStore();
    store.setState({
      realignScreenOpen: true,
      realignCandidates: { status: 'ready', rows: [], error: null },
      realignRun: { status: 'running', restartMode: 'none', rows: [{ service: 'svc-a', path: '/repo/a', status: 'realigning' }], restartRows: [], restartError: null, error: null },
    });
    const { instance, stdin, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      expect(stdout.output).toContain('Realigning services…');
      await pressEscape(instance, stdin);
      expect(store.getState().realignScreenOpen).toBe(true);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});

describe('AppShell heal overlay', () => {
  const rows = [
    { service: 'svc-a', repoPath: '/repo/a', phase: 'pending' as const },
    { service: 'svc-b', repoPath: '/repo/b', phase: 'skipped' as const, skipReason: 'up' as const },
  ];

  it('mounts while open, owns every key, and Esc closes it', async () => {
    const store = createAppStore();
    store.setState({
      healScreenOpen: true,
      healRun: { status: 'confirm', plan: { edt: { ulid: 'e1', topic: 'demo' }, rows }, mode: 'simple', rows, report: null, error: null },
    });
    const onQuit = vi.fn();
    const stdout = new FakeTtyStdout();
    const stdin = fakeInteractiveTtyStdin();
    const instance = render(createElement(AppShell, { useStore: store, onQuit }), {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin,
      interactive: true,
      exitOnCtrlC: false,
      patchConsole: false,
    });
    try {
      await instance.waitUntilRenderFlush();
      expect(stdout.output).toContain('HEAL');
      const zoneBefore = store.getState().activeZone;
      for (const key of ['e', 'u', ':', '?', 'q', KEYS.ctrlW]) {
        await press(instance, stdin, key);
      }
      expect(store.getState().activeZone).toBe(zoneBefore);
      expect(store.getState()).toMatchObject({ commandBarOpen: false, helpOpen: false, healScreenOpen: true, quitRequested: false, resizeMode: null });
      expect(onQuit).not.toHaveBeenCalled();
      await pressEscape(instance, stdin);
      expect(store.getState()).toMatchObject({ healScreenOpen: false, healRun: null });
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('renders the heal notice when no overlay opened', async () => {
    const store = createAppStore();
    store.setState({ healNotice: { message: 'every service is up', tone: 'success' } });
    const { instance, stdout } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      expect(stdout.output).toContain('every service is up');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});

describe('AppShell filter rules load activation', () => {
  it('hydrates the persisted rule lists and library from the mount-time loadLogsRules()', async () => {
    const rule = { mode: 'text', query: 'noise', action: 'hide', target: 'line', enabled: true };
    const state: StatePort = {
      readActiveEdt: vi.fn(async () => ok(null)),
      writeActiveEdt: vi.fn(async () => ok(undefined)),
      readSplitterRatios: vi.fn(async () => ok(null)),
      writeSplitterRatios: vi.fn(async () => ok(undefined)),
      readFilterHistory: vi.fn(async () => ok(null)),
      writeFilterHistory: vi.fn(async () => ok(undefined)),
      readCommandHistory: vi.fn(async () => ok(null)),
      writeCommandHistory: vi.fn(async () => ok(undefined)),
      readLogRules: vi.fn(async () => ok({ global: [rule] })),
      writeLogRules: vi.fn(async () => ok(undefined)),
      readLogRuleSets: vi.fn(async () => ok([{ name: 'n', rules: [rule] }])),
      writeLogRuleSets: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ state }));
    expect(store.getState().logsGlobalFilter.rules).toEqual([]);

    const { instance } = mount(store);
    try {
      await flushAsyncLoad(instance);

      expect(state.readLogRules).toHaveBeenCalled();
      expect(store.getState().logsGlobalFilter.rules).toEqual([rule]);
      expect(store.getState().logsRuleSets).toHaveLength(1);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});
