import { describe, it, expect, vi } from "vitest";
import { ok, err } from "../../../../core/result.js";
import type { StatePort } from "../../../../core/ports/state.js";
import { createAppStore } from "./app-store.js";
import { DEFAULT_LIST_RATIO, fakeDeps } from "./store.test-support.js";

describe("app store", () => {
  describe("splitterRatios persistence", () => {
    it("setSplitterRatio() applies live before persistence resolves, then persists the whole ratios map (no separate save step)", async () => {
      let resolveSave: (() => void) | undefined;
      const savePromise = new Promise<void>((resolve) => {
        resolveSave = resolve;
      });
      const writeSplitterRatios = vi.fn(async () => {
        await savePromise;
        return ok(undefined);
      });
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
      const store = createAppStore(fakeDeps({ state }));

      const applyPromise = store.getState().setSplitterRatio("edts", 1, 0.6);
      // Optimistic: the store already reflects the new value before the write resolves.
      expect(store.getState().splitterRatios.edts[1]).toBe(0.6);

      resolveSave?.();
      await applyPromise;

      expect(writeSplitterRatios).toHaveBeenCalledWith(store.getState().splitterRatios);
    });

    it("setSplitterRatio() is a no-op persistence-wise when the store is unwired, but still applies live", async () => {
      const store = createAppStore();
      await store.getState().setSplitterRatio("edts", 0, 0.6);
      expect(store.getState().splitterRatios.edts[0]).toBe(0.6);
    });

    it("setSplitterRatio() persists concurrent calls in the order they were requested, not resolution order", async () => {
      const persisted: Record<string, number[]>[] = [];
      let resolveFirst: (() => void) | undefined;
      const firstGate = new Promise<void>((resolve) => {
        resolveFirst = resolve;
      });
      const writeSplitterRatios = vi
        .fn()
        .mockImplementationOnce(async (ratios: Record<string, number[]>) => {
          await firstGate;
          persisted.push(ratios);
          return ok(undefined);
        })
        .mockImplementationOnce(async (ratios: Record<string, number[]>) => {
          persisted.push(ratios);
          return ok(undefined);
        });
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
      const store = createAppStore(fakeDeps({ state }));

      const first = store.getState().setSplitterRatio("edts", 0, 0.3);
      const second = store.getState().setSplitterRatio("edts", 0, 0.4);
      resolveFirst?.();
      await Promise.all([first, second]);

      expect(persisted.map((ratios) => ratios.edts[0])).toEqual([0.3, 0.4]);
    });

    it("loadSplitterRatios() hydrates a valid persisted map, per-zone", async () => {
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

      await store.getState().loadSplitterRatios();

      expect(store.getState().splitterRatios.edts).toEqual([0.3, 0.4, 0.5]);
      expect(store.getState().splitterRatios.dashboard).toEqual([0.6]);
    });

    it("loadSplitterRatios() falls back to the built-in default for a zone whose persisted array length doesn't match its own boundary count, leaving other zones untouched", async () => {
      const state: StatePort = {
        readActiveEdt: vi.fn(async () => ok(null)),
        writeActiveEdt: vi.fn(async () => ok(undefined)),
        // 'edts' has 3 boundaries — a persisted array of length 1 is a shape mismatch for it.
        readSplitterRatios: vi.fn(async () => ok({ edts: [0.3], dashboard: [0.6] })),
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

      await store.getState().loadSplitterRatios();

      expect(store.getState().splitterRatios.edts).toEqual([
        DEFAULT_LIST_RATIO,
        DEFAULT_LIST_RATIO,
        DEFAULT_LIST_RATIO,
      ]);
      expect(store.getState().splitterRatios.dashboard).toEqual([0.6]);
    });

    it("loadSplitterRatios() clamps a persisted ratio to its boundary's own min/max", async () => {
      const state: StatePort = {
        readActiveEdt: vi.fn(async () => ok(null)),
        writeActiveEdt: vi.fn(async () => ok(undefined)),
        readSplitterRatios: vi.fn(async () => ok({ logs: [0.9], dashboard: [0.9] })),
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

      await store.getState().loadSplitterRatios();

      expect(store.getState().splitterRatios.logs).toEqual([0.5]);
      expect(store.getState().splitterRatios.dashboard).toEqual([0.8]);
    });

    it("enterResizeMode() engages on boundary 0 in any zone with a boundary and Tab cycles that zone's declared boundaries", () => {
      const store = createAppStore();
      store.getState().enterResizeMode("logs");
      expect(store.getState().resizeMode).toEqual({ zone: "logs", targetBoundary: 0 });
      store.getState().cycleResizeTargetBoundary();
      expect(store.getState().resizeMode).toEqual({ zone: "logs", targetBoundary: 0 });
      store.getState().exitResizeMode();
      store.getState().enterResizeMode("edts");
      store.getState().cycleResizeTargetBoundary();
      expect(store.getState().resizeMode).toEqual({ zone: "edts", targetBoundary: 1 });
    });

    it("setSplitterRatio() clamps to the targeted boundary's own min/max", async () => {
      const store = createAppStore();
      await store.getState().setSplitterRatio("logs", 0, 0.99);
      expect(store.getState().splitterRatios.logs).toEqual([0.5]);
      await store.getState().setSplitterRatio("logs", 0, 0);
      expect(store.getState().splitterRatios.logs).toEqual([0.15]);
    });

    it("loadSplitterRatios() on a genuine I/O error keeps the built-in defaults", async () => {
      const state: StatePort = {
        readActiveEdt: vi.fn(async () => ok(null)),
        writeActiveEdt: vi.fn(async () => ok(undefined)),
        readSplitterRatios: vi.fn(async () => err("state-invalid-json", "corrupt state.json")),
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

      await store.getState().loadSplitterRatios();

      expect(store.getState().splitterRatios.edts).toEqual([
        DEFAULT_LIST_RATIO,
        DEFAULT_LIST_RATIO,
        DEFAULT_LIST_RATIO,
      ]);
    });

    it("loadSplitterRatios() on a fresh machine (null) keeps the built-in defaults", async () => {
      const state: StatePort = {
        readActiveEdt: vi.fn(async () => ok(null)),
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
      const store = createAppStore(fakeDeps({ state }));

      await store.getState().loadSplitterRatios();

      expect(store.getState().splitterRatios.edts).toEqual([
        DEFAULT_LIST_RATIO,
        DEFAULT_LIST_RATIO,
        DEFAULT_LIST_RATIO,
      ]);
    });

    it("loadSplitterRatios() is a no-op when the store is unwired", async () => {
      const store = createAppStore();
      await store.getState().loadSplitterRatios();
      expect(store.getState().splitterRatios.edts).toEqual([
        DEFAULT_LIST_RATIO,
        DEFAULT_LIST_RATIO,
        DEFAULT_LIST_RATIO,
      ]);
    });

    // Mirrors the settingsVersion-guarded "loadSettings() discards a stale result superseded
    // by a newer updateSettings()" test above — loadSplitterRatios() (AppShell's mount-time
    // load) must never overwrite a live setSplitterRatio() move (e.g. a Ctrl+W resize) that
    // lands while the read is still in flight with the stale pre-move value it read from disk.
    it("loadSplitterRatios() discards a stale result superseded by a newer setSplitterRatio() while it was in flight", async () => {
      let resolveLoad: ((value: { ok: true; data: Record<string, number[]> }) => void) | undefined;
      const loadPromise = new Promise<{ ok: true; data: Record<string, number[]> }>((resolve) => {
        resolveLoad = resolve;
      });
      const state: StatePort = {
        readActiveEdt: vi.fn(async () => ok(null)),
        writeActiveEdt: vi.fn(async () => ok(undefined)),
        readSplitterRatios: vi.fn(async () => loadPromise),
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

      const loading = store.getState().loadSplitterRatios();
      // A newer setSplitterRatio() lands while the load above is still in flight.
      await store.getState().setSplitterRatio("edts", 0, 0.75);

      // The stale load now resolves with an older on-disk value — it must not clobber the
      // newer live move already applied above.
      resolveLoad?.({ ok: true, data: { edts: [0.2, 0.2, 0.2] } });
      await loading;

      expect(store.getState().splitterRatios.edts[0]).toBe(0.75);
    });
  });
});
