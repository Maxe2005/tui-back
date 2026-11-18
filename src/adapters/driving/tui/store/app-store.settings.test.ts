import { describe, it, expect, vi } from "vitest";
import { ok, err } from "../../../../core/result.js";
import { DEFAULT_SETTINGS, type SettingsPort } from "../../../../core/ports/settings.js";
import { createAppStore } from "./app-store.js";
import { fakeDeps } from "./store.test-support.js";

describe("app store", () => {
  describe("settings slice", () => {
    it("seeds `settings` with DEFAULT_SETTINGS before loadSettings() ever resolves", () => {
      const store = createAppStore(fakeDeps());
      expect(store.getState().settings).toEqual(DEFAULT_SETTINGS);
      expect(store.getState().settingsWarning).toBeNull();
    });

    it("loadSettings() applies the loaded value and any non-blocking warning (corrupt-file fallback)", async () => {
      const settings: SettingsPort = {
        load: vi.fn(async () =>
          ok({
            settings: {
              general: { quitShortcutEnabled: true, editorCommand: '' },
              commandPalette: { gridMaxRows: 12, historySize: 20, historyDedup: true },
              edts: { hiddenActionHints: ["edts"], hiddenActionTypes: [], branchDropdownMaxRows: 5 },
              update: { concurrency: 3, runMigrations: true, cleanRestart: false, mergeSource: 'shared' as const }, sharedTypes: { install: true, cleanRestart: false, commit: true, historyDepth: 20, maxCommitsScanned: 1000 }, switch: { restartMode: 'none' as const }, realign: { defaultScope: 'edt' as const, restartMode: 'none' as const }, dashboard: { restartMode: 'simple' as const }, logs: { bufferSize: 500, startWithHistory: false, filterHistorySize: 20, filterHistoryGridMaxRows: 8, filterHistoryDedup: true, restartMode: 'simple' as const }, services: { healthCheckDisabled: [] as string[] },
            },
            warning: "Invalid settings file /x/settings.yaml: (root) — bad shape — using defaults.",
          }),
        ),
        save: vi.fn(async () => ok(undefined)),
      };
      const store = createAppStore(fakeDeps({ settings }));

      await store.getState().loadSettings();

      expect(store.getState().settings).toEqual({
        general: { quitShortcutEnabled: true, editorCommand: '' },
        commandPalette: { gridMaxRows: 12, historySize: 20, historyDedup: true },
        edts: { hiddenActionHints: ["edts"], hiddenActionTypes: [], branchDropdownMaxRows: 5 },
        update: { concurrency: 3, runMigrations: true, cleanRestart: false, mergeSource: 'shared' as const }, sharedTypes: { install: true, cleanRestart: false, commit: true, historyDepth: 20, maxCommitsScanned: 1000 }, switch: { restartMode: 'none' as const }, realign: { defaultScope: 'edt' as const, restartMode: 'none' as const }, dashboard: { restartMode: 'simple' as const }, logs: { bufferSize: 500, startWithHistory: false, filterHistorySize: 20, filterHistoryGridMaxRows: 8, filterHistoryDedup: true, restartMode: 'simple' as const }, services: { healthCheckDisabled: [] as string[] },
      });
      expect(store.getState().settingsWarning).toContain("using defaults");
    });

    it("loadSettings() on a genuine I/O error keeps the last-known settings, surfacing the failure as a warning", async () => {
      const settings: SettingsPort = {
        load: vi.fn(async () => err("settings-read-error", "Failed to read settings file")),
        save: vi.fn(async () => ok(undefined)),
      };
      const store = createAppStore(fakeDeps({ settings }));

      await store.getState().loadSettings();

      expect(store.getState().settings).toEqual(DEFAULT_SETTINGS);
      expect(store.getState().settingsWarning).toBe("Failed to read settings file");
    });

    it("loadSettings() is a no-op when the store is unwired", async () => {
      const store = createAppStore();
      await store.getState().loadSettings();
      expect(store.getState().settings).toEqual(DEFAULT_SETTINGS);
    });

    it("updateSettings() applies optimistically before persistence resolves, then persists (no separate save step)", async () => {
      let resolveSave: (() => void) | undefined;
      const savePromise = new Promise<void>((resolve) => {
        resolveSave = resolve;
      });
      const save = vi.fn(async () => {
        await savePromise;
        return ok(undefined);
      });
      const settings: SettingsPort = {
        load: vi.fn(async () => ok({ settings: DEFAULT_SETTINGS, warning: null })),
        save,
      };
      const store = createAppStore(fakeDeps({ settings }));

      const updatePromise = store.getState().updateSettings({ commandPalette: { gridMaxRows: 15 } });
      // Optimistic: the store already reflects the new value before save() resolves.
      expect(store.getState().settings.commandPalette.gridMaxRows).toBe(15);

      resolveSave?.();
      await updatePromise;

      expect(save).toHaveBeenCalledWith({
        general: { quitShortcutEnabled: true, editorCommand: '' },
        commandPalette: { gridMaxRows: 15, historySize: 20, historyDedup: true },
        edts: { hiddenActionHints: [], hiddenActionTypes: [], branchDropdownMaxRows: 5 },
        update: { concurrency: 3, runMigrations: true, cleanRestart: false, mergeSource: 'shared' as const }, sharedTypes: { install: true, cleanRestart: false, commit: true, historyDepth: 20, maxCommitsScanned: 1000 }, switch: { restartMode: 'none' as const }, realign: { defaultScope: 'edt' as const, restartMode: 'none' as const }, dashboard: { restartMode: 'simple' as const }, logs: { bufferSize: 500, startWithHistory: false, filterHistorySize: 20, filterHistoryGridMaxRows: 8, filterHistoryDedup: true, restartMode: 'simple' as const }, services: { healthCheckDisabled: [] as string[] },
      });
    });

    it("updateSettings() merges a partial sharedTypes update, keeping the sibling keys", async () => {
      const store = createAppStore();
      await store.getState().updateSettings({ sharedTypes: { cleanRestart: true } });
      expect(store.getState().settings.sharedTypes).toEqual({ install: true, cleanRestart: true, commit: true, historyDepth: 20, maxCommitsScanned: 1000 });
    });

    it("updateSettings() merges services.healthCheckDisabled, keeping the other groups", async () => {
      const store = createAppStore();
      await store.getState().updateSettings({ services: { healthCheckDisabled: ["api"] } });
      expect(store.getState().settings.services).toEqual({ healthCheckDisabled: ["api"] });
      expect(store.getState().settings.logs).toEqual(DEFAULT_SETTINGS.logs);
    });

    it("updateSettings() shallow-merges only the provided sub-object, leaving the other untouched", async () => {
      const store = createAppStore(fakeDeps());
      store.setState({
        settings: {
          general: { quitShortcutEnabled: true, editorCommand: '' },
          commandPalette: { gridMaxRows: 20, historySize: 20, historyDedup: true },
          edts: { hiddenActionHints: ["edts"], hiddenActionTypes: [], branchDropdownMaxRows: 5 },
          update: { concurrency: 3, runMigrations: true, cleanRestart: false, mergeSource: 'shared' as const }, sharedTypes: { install: true, cleanRestart: false, commit: true, historyDepth: 20, maxCommitsScanned: 1000 }, switch: { restartMode: 'none' as const }, realign: { defaultScope: 'edt' as const, restartMode: 'none' as const }, dashboard: { restartMode: 'simple' as const }, logs: { bufferSize: 500, startWithHistory: false, filterHistorySize: 20, filterHistoryGridMaxRows: 8, filterHistoryDedup: true, restartMode: 'simple' as const }, services: { healthCheckDisabled: [] as string[] },
        },
      });

      await store.getState().updateSettings({ edts: { hiddenActionHints: ["other-services"] } });

      expect(store.getState().settings).toEqual({
        general: { quitShortcutEnabled: true, editorCommand: '' },
        commandPalette: { gridMaxRows: 20, historySize: 20, historyDedup: true },
        edts: { hiddenActionHints: ["other-services"], hiddenActionTypes: [], branchDropdownMaxRows: 5 },
        update: { concurrency: 3, runMigrations: true, cleanRestart: false, mergeSource: 'shared' as const }, sharedTypes: { install: true, cleanRestart: false, commit: true, historyDepth: 20, maxCommitsScanned: 1000 }, switch: { restartMode: 'none' as const }, realign: { defaultScope: 'edt' as const, restartMode: 'none' as const }, dashboard: { restartMode: 'simple' as const }, logs: { bufferSize: 500, startWithHistory: false, filterHistorySize: 20, filterHistoryGridMaxRows: 8, filterHistoryDedup: true, restartMode: 'simple' as const }, services: { healthCheckDisabled: [] as string[] },
      });
    });

    it("updateSettings() shallow-merges hiddenActionTypes independently of hiddenActionHints", async () => {
      const store = createAppStore(fakeDeps());
      store.setState({
        settings: {
          general: { quitShortcutEnabled: true, editorCommand: '' },
          commandPalette: { gridMaxRows: 20, historySize: 20, historyDedup: true },
          edts: { hiddenActionHints: ["edts"], hiddenActionTypes: ["modify"], branchDropdownMaxRows: 5 },
          update: { concurrency: 3, runMigrations: true, cleanRestart: false, mergeSource: 'shared' as const }, sharedTypes: { install: true, cleanRestart: false, commit: true, historyDepth: 20, maxCommitsScanned: 1000 }, switch: { restartMode: 'none' as const }, realign: { defaultScope: 'edt' as const, restartMode: 'none' as const }, dashboard: { restartMode: 'simple' as const }, logs: { bufferSize: 500, startWithHistory: false, filterHistorySize: 20, filterHistoryGridMaxRows: 8, filterHistoryDedup: true, restartMode: 'simple' as const }, services: { healthCheckDisabled: [] as string[] },
        },
      });

      await store.getState().updateSettings({ edts: { hiddenActionTypes: ["create", "modify"] } });

      expect(store.getState().settings).toEqual({
        general: { quitShortcutEnabled: true, editorCommand: '' },
        commandPalette: { gridMaxRows: 20, historySize: 20, historyDedup: true },
        edts: { hiddenActionHints: ["edts"], hiddenActionTypes: ["create", "modify"], branchDropdownMaxRows: 5 },
        update: { concurrency: 3, runMigrations: true, cleanRestart: false, mergeSource: 'shared' as const }, sharedTypes: { install: true, cleanRestart: false, commit: true, historyDepth: 20, maxCommitsScanned: 1000 }, switch: { restartMode: 'none' as const }, realign: { defaultScope: 'edt' as const, restartMode: 'none' as const }, dashboard: { restartMode: 'simple' as const }, logs: { bufferSize: 500, startWithHistory: false, filterHistorySize: 20, filterHistoryGridMaxRows: 8, filterHistoryDedup: true, restartMode: 'simple' as const }, services: { healthCheckDisabled: [] as string[] },
      });
    });

    it("updateSettings() surfaces a save failure as settingsWarning without reverting the optimistic value", async () => {
      const settings: SettingsPort = {
        load: vi.fn(async () => ok({ settings: DEFAULT_SETTINGS, warning: null })),
        save: vi.fn(async () => err("settings-write-error", "Failed to write settings file")),
      };
      const store = createAppStore(fakeDeps({ settings }));

      await store.getState().updateSettings({ commandPalette: { gridMaxRows: 3 } });

      expect(store.getState().settings.commandPalette.gridMaxRows).toBe(3);
      expect(store.getState().settingsWarning).toBe("Failed to write settings file");
    });

    it("openSettingsScreen/closeSettingsScreen toggle settingsScreenOpen (mirrors registryScreenOpen)", () => {
      const store = createAppStore(fakeDeps());
      expect(store.getState().settingsScreenOpen).toBe(false);

      store.getState().openSettingsScreen();
      expect(store.getState().settingsScreenOpen).toBe(true);

      store.getState().closeSettingsScreen();
      expect(store.getState().settingsScreenOpen).toBe(false);
    });

    it("closeSettingsScreen() also clears settingsWarning, so a previously-seen warning doesn't linger", () => {
      const store = createAppStore(fakeDeps());
      store.setState({ settingsScreenOpen: true, settingsWarning: "Invalid settings file — using defaults." });

      store.getState().closeSettingsScreen();

      expect(store.getState().settingsWarning).toBeNull();
    });

    it("updateSettings() clears a stale settingsWarning once a save succeeds", async () => {
      const settings: SettingsPort = {
        load: vi.fn(async () => ok({ settings: DEFAULT_SETTINGS, warning: null })),
        save: vi.fn(async () => ok(undefined)),
      };
      const store = createAppStore(fakeDeps({ settings }));
      store.setState({ settingsWarning: "Failed to write settings file" });

      await store.getState().updateSettings({ commandPalette: { gridMaxRows: 3 } });

      expect(store.getState().settingsWarning).toBeNull();
    });

    it("updateSettings() persists concurrent calls in the order they were requested, not resolution order", async () => {
      const persisted: number[] = [];
      let resolveFirst: (() => void) | undefined;
      const firstGate = new Promise<void>((resolve) => {
        resolveFirst = resolve;
      });
      const save = vi
        .fn()
        .mockImplementationOnce(async (next: { commandPalette: { gridMaxRows: number } }) => {
          // The first save is the slow one — it resolves after the second call has already
          // been issued, so without serialization the faster second save would land on disk
          // first and the slower first save would overwrite it afterwards with stale data.
          await firstGate;
          persisted.push(next.commandPalette.gridMaxRows);
          return ok(undefined);
        })
        .mockImplementationOnce(async (next: { commandPalette: { gridMaxRows: number } }) => {
          persisted.push(next.commandPalette.gridMaxRows);
          return ok(undefined);
        });
      const settings: SettingsPort = {
        load: vi.fn(async () => ok({ settings: DEFAULT_SETTINGS, warning: null })),
        save,
      };
      const store = createAppStore(fakeDeps({ settings }));

      const first = store.getState().updateSettings({ commandPalette: { gridMaxRows: 1 } });
      const second = store.getState().updateSettings({ commandPalette: { gridMaxRows: 2 } });
      resolveFirst?.();
      await Promise.all([first, second]);

      expect(persisted).toEqual([1, 2]);
    });

    it("loadSettings() discards a stale result superseded by a newer updateSettings() while it was in flight", async () => {
      let resolveLoad: ((value: { settings: typeof DEFAULT_SETTINGS; warning: string | null }) => void) | undefined;
      const loadPromise = new Promise<{ settings: typeof DEFAULT_SETTINGS; warning: string | null }>((resolve) => {
        resolveLoad = resolve;
      });
      const settings: SettingsPort = {
        load: vi.fn(async () => ok(await loadPromise)),
        save: vi.fn(async () => ok(undefined)),
      };
      const store = createAppStore(fakeDeps({ settings }));

      const loading = store.getState().loadSettings();
      // A newer updateSettings() lands while the load above is still in flight.
      await store.getState().updateSettings({ commandPalette: { gridMaxRows: 42 } });

      // The stale load now resolves with an older on-disk value — it must not clobber the
      // newer update already applied above.
      resolveLoad?.({
        settings: {
          general: { quitShortcutEnabled: true, editorCommand: '' },
          commandPalette: { gridMaxRows: 8, historySize: 20, historyDedup: true },
          edts: { hiddenActionHints: [], hiddenActionTypes: [], branchDropdownMaxRows: 5 },
          update: { concurrency: 3, runMigrations: true, cleanRestart: false, mergeSource: 'shared' as const }, sharedTypes: { install: true, cleanRestart: false, commit: true, historyDepth: 20, maxCommitsScanned: 1000 }, switch: { restartMode: 'none' as const }, realign: { defaultScope: 'edt' as const, restartMode: 'none' as const }, dashboard: { restartMode: 'simple' as const }, logs: { bufferSize: 500, startWithHistory: false, filterHistorySize: 20, filterHistoryGridMaxRows: 8, filterHistoryDedup: true, restartMode: 'simple' as const }, services: { healthCheckDisabled: [] as string[] },
        },
        warning: null,
      });
      await loading;

      expect(store.getState().settings.commandPalette.gridMaxRows).toBe(42);
    });
  });
});
