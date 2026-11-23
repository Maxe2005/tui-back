import { describe, it, expect, vi } from "vitest";
import { ok, err } from "../../../../../../core/result.js";
import type { StatePort } from "../../../../../../core/ports/storage/state.js";
import { createAppStore } from "../../app-store.js";
import { fakeDeps } from "../../store.test-support.js";

// Filter-history persistence — mirrors "splitterRatios persistence"'s coverage shape.
describe("logs slice: filter history", () => {
  it("commitFilterHistoryEntry pushes onto the exact (scope, mode) list and persists the whole map immediately (no separate save step)", async () => {
    const writeFilterHistory = vi.fn(async () => ok(undefined));
    const state: StatePort = {
      readActiveEdt: vi.fn(async () => ok(null)),
      writeActiveEdt: vi.fn(async () => ok(undefined)),
      readSplitterRatios: vi.fn(async () => ok(null)),
      writeSplitterRatios: vi.fn(async () => ok(undefined)),
      readFilterHistory: vi.fn(async () => ok(null)),
      writeFilterHistory,
      readCommandHistory: vi.fn(async () => ok(null)),
      writeCommandHistory: vi.fn(async () => ok(undefined)),
      readLogRules: vi.fn(async () => ok(null)),
      writeLogRules: vi.fn(async () => ok(undefined)),
      readLogRuleSets: vi.fn(async () => ok(null)),
      writeLogRuleSets: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ state }));

    store.getState().commitFilterHistoryEntry({ scope: "global", repoPath: null, mode: "text" }, "boom");
    // Optimistic: the store already reflects the new entry before the write resolves.
    expect(store.getState().filterHistory["global:text"]).toEqual(["boom"]);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(writeFilterHistory).toHaveBeenCalledWith({ "global:text": ["boom"] });
  });

  it("commitFilterHistoryEntry keeps every other (scope, mode) list untouched", () => {
    const store = createAppStore(fakeDeps());
    store.getState().commitFilterHistoryEntry({ scope: "pane", repoPath: "/repo/a", mode: "text" }, "first");

    store.getState().commitFilterHistoryEntry({ scope: "global", repoPath: null, mode: "regex" }, "second");

    expect(store.getState().filterHistory["service:/repo/a:text"]).toEqual(["first"]);
    expect(store.getState().filterHistory["global:regex"]).toEqual(["second"]);
  });

  it("commitFilterHistoryEntry trims to settings.logs.filterHistorySize", () => {
    const store = createAppStore(fakeDeps());
    store.setState((current) => ({ settings: { ...current.settings, logs: { ...current.settings.logs, filterHistorySize: 2 } } }));

    store.getState().commitFilterHistoryEntry({ scope: "global", repoPath: null, mode: "text" }, "a");
    store.getState().commitFilterHistoryEntry({ scope: "global", repoPath: null, mode: "text" }, "b");
    store.getState().commitFilterHistoryEntry({ scope: "global", repoPath: null, mode: "text" }, "c");

    expect(store.getState().filterHistory["global:text"]).toEqual(["c", "b"]);
  });

  it("commitFilterHistoryEntry with filterHistoryDedup moves a repeat to the front without duplicating it", () => {
    const store = createAppStore(fakeDeps());
    store.setState((current) => ({ settings: { ...current.settings, logs: { ...current.settings.logs, filterHistoryDedup: true, restartMode: 'simple' as const }, services: { healthCheckDisabled: [] as string[] } } }));

    store.getState().commitFilterHistoryEntry({ scope: "global", repoPath: null, mode: "text" }, "a");
    store.getState().commitFilterHistoryEntry({ scope: "global", repoPath: null, mode: "text" }, "b");
    store.getState().commitFilterHistoryEntry({ scope: "global", repoPath: null, mode: "text" }, "a");

    expect(store.getState().filterHistory["global:text"]).toEqual(["a", "b"]);
  });

  it("commitFilterHistoryEntry without filterHistoryDedup keeps the legacy duplicate", () => {
    const store = createAppStore(fakeDeps());
    store.setState((current) => ({ settings: { ...current.settings, logs: { ...current.settings.logs, filterHistoryDedup: false } } }));

    store.getState().commitFilterHistoryEntry({ scope: "global", repoPath: null, mode: "text" }, "a");
    store.getState().commitFilterHistoryEntry({ scope: "global", repoPath: null, mode: "text" }, "b");
    store.getState().commitFilterHistoryEntry({ scope: "global", repoPath: null, mode: "text" }, "a");

    expect(store.getState().filterHistory["global:text"]).toEqual(["a", "b", "a"]);
  });

  it("clearGlobalFilterHistory only touches the two global lists", async () => {
    const writeFilterHistory = vi.fn(async () => ok(undefined));
    const state: StatePort = {
      readActiveEdt: vi.fn(async () => ok(null)),
      writeActiveEdt: vi.fn(async () => ok(undefined)),
      readSplitterRatios: vi.fn(async () => ok(null)),
      writeSplitterRatios: vi.fn(async () => ok(undefined)),
      readFilterHistory: vi.fn(async () => ok(null)),
      writeFilterHistory,
      readCommandHistory: vi.fn(async () => ok(null)),
      writeCommandHistory: vi.fn(async () => ok(undefined)),
      readLogRules: vi.fn(async () => ok(null)),
      writeLogRules: vi.fn(async () => ok(undefined)),
      readLogRuleSets: vi.fn(async () => ok(null)),
      writeLogRuleSets: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ state }));
    store.getState().commitFilterHistoryEntry({ scope: "global", repoPath: null, mode: "text" }, "g-text");
    store.getState().commitFilterHistoryEntry({ scope: "global", repoPath: null, mode: "regex" }, "g-regex");
    store.getState().commitFilterHistoryEntry({ scope: "pane", repoPath: "/repo/a", mode: "text" }, "p-text");

    store.getState().clearGlobalFilterHistory();

    expect(store.getState().filterHistory["global:text"]).toBeUndefined();
    expect(store.getState().filterHistory["global:regex"]).toBeUndefined();
    expect(store.getState().filterHistory["service:/repo/a:text"]).toEqual(["p-text"]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(writeFilterHistory).toHaveBeenLastCalledWith({ "service:/repo/a:text": ["p-text"] });
  });

  it("clearServiceFilterHistory only touches that one service's two lists", () => {
    const store = createAppStore(fakeDeps());
    store.getState().commitFilterHistoryEntry({ scope: "pane", repoPath: "/repo/a", mode: "text" }, "a-text");
    store.getState().commitFilterHistoryEntry({ scope: "pane", repoPath: "/repo/a", mode: "regex" }, "a-regex");
    store.getState().commitFilterHistoryEntry({ scope: "pane", repoPath: "/repo/b", mode: "text" }, "b-text");
    store.getState().commitFilterHistoryEntry({ scope: "global", repoPath: null, mode: "text" }, "g-text");

    store.getState().clearServiceFilterHistory("/repo/a");

    expect(store.getState().filterHistory["service:/repo/a:text"]).toBeUndefined();
    expect(store.getState().filterHistory["service:/repo/a:regex"]).toBeUndefined();
    expect(store.getState().filterHistory["service:/repo/b:text"]).toEqual(["b-text"]);
    expect(store.getState().filterHistory["global:text"]).toEqual(["g-text"]);
  });

  it("loadFilterHistory hydrates a persisted map", async () => {
    const state: StatePort = {
      readActiveEdt: vi.fn(async () => ok(null)),
      writeActiveEdt: vi.fn(async () => ok(undefined)),
      readSplitterRatios: vi.fn(async () => ok(null)),
      writeSplitterRatios: vi.fn(async () => ok(undefined)),
      readFilterHistory: vi.fn(async () => ok({ "global:text": ["boom"] })),
      writeFilterHistory: vi.fn(async () => ok(undefined)),
      readCommandHistory: vi.fn(async () => ok(null)),
      writeCommandHistory: vi.fn(async () => ok(undefined)),
      readLogRules: vi.fn(async () => ok(null)),
      writeLogRules: vi.fn(async () => ok(undefined)),
      readLogRuleSets: vi.fn(async () => ok(null)),
      writeLogRuleSets: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ state }));

    await store.getState().loadFilterHistory();

    expect(store.getState().filterHistory).toEqual({ "global:text": ["boom"] });
  });

  it("loadFilterHistory on a genuine I/O error or a fresh machine (null) keeps the empty default (never a crash)", async () => {
    const state: StatePort = {
      readActiveEdt: vi.fn(async () => ok(null)),
      writeActiveEdt: vi.fn(async () => ok(undefined)),
      readSplitterRatios: vi.fn(async () => ok(null)),
      writeSplitterRatios: vi.fn(async () => ok(undefined)),
      readFilterHistory: vi.fn(async () => err("state-invalid-format", "corrupt filterHistory")),
      writeFilterHistory: vi.fn(async () => ok(undefined)),
      readCommandHistory: vi.fn(async () => ok(null)),
      writeCommandHistory: vi.fn(async () => ok(undefined)),
      readLogRules: vi.fn(async () => ok(null)),
      writeLogRules: vi.fn(async () => ok(undefined)),
      readLogRuleSets: vi.fn(async () => ok(null)),
      writeLogRuleSets: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ state }));

    await expect(store.getState().loadFilterHistory()).resolves.toBeUndefined();

    expect(store.getState().filterHistory).toEqual({});
  });

  it("every filter-history action is a safe no-op on an unwired store", async () => {
    const store = createAppStore();

    expect(() => store.getState().commitFilterHistoryEntry({ scope: "global", repoPath: null, mode: "text" }, "boom")).not.toThrow();
    expect(store.getState().filterHistory["global:text"]).toEqual(["boom"]);
    expect(() => store.getState().clearGlobalFilterHistory()).not.toThrow();
    expect(() => store.getState().clearServiceFilterHistory("/repo/a")).not.toThrow();
    await expect(store.getState().loadFilterHistory()).resolves.toBeUndefined();
  });

  // Mirrors "loadSplitterRatios() discards a stale result..." above, but for the opposite
  // failure mode — filterHistoryVersion only protects a *stale read* from clobbering a *newer
  // write*; it does nothing for a *write that fires while the first (mount-time)
  // loadFilterHistory() is still in flight*. Without gating, commitFilterHistoryEntry would
  // persist the still-empty pre-load map, discarding every other scope/service on disk.
  it("commitFilterHistoryEntry awaits an in-flight initial loadFilterHistory() before reading/persisting, so it never wipes out already-persisted history for other keys", async () => {
    let resolveLoad: ((value: { ok: true; data: Record<string, string[]> }) => void) | undefined;
    const loadPromise = new Promise<{ ok: true; data: Record<string, string[]> }>((resolve) => {
      resolveLoad = resolve;
    });
    const writeFilterHistory = vi.fn(async () => ok(undefined));
    const state: StatePort = {
      readActiveEdt: vi.fn(async () => ok(null)),
      writeActiveEdt: vi.fn(async () => ok(undefined)),
      readSplitterRatios: vi.fn(async () => ok(null)),
      writeSplitterRatios: vi.fn(async () => ok(undefined)),
      readFilterHistory: vi.fn(async () => loadPromise),
      writeFilterHistory,
      readCommandHistory: vi.fn(async () => ok(null)),
      writeCommandHistory: vi.fn(async () => ok(undefined)),
      readLogRules: vi.fn(async () => ok(null)),
      writeLogRules: vi.fn(async () => ok(undefined)),
      readLogRuleSets: vi.fn(async () => ok(null)),
      writeLogRuleSets: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ state }));

    const loading = store.getState().loadFilterHistory();
    // A commit lands while the mount-time load above is still in flight.
    store.getState().commitFilterHistoryEntry({ scope: "global", repoPath: null, mode: "text" }, "new-entry");

    // The in-flight read now resolves with what was already on disk for an unrelated key.
    resolveLoad?.({ ok: true, data: { "service:/repo/a:text": ["already-on-disk"] } });
    await loading;
    // Flushes the commit's own continuation, queued behind the load's promise.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(store.getState().filterHistory["service:/repo/a:text"]).toEqual(["already-on-disk"]);
    expect(store.getState().filterHistory["global:text"]).toEqual(["new-entry"]);
    expect(writeFilterHistory).toHaveBeenLastCalledWith({
      "service:/repo/a:text": ["already-on-disk"],
      "global:text": ["new-entry"],
    });
  });

  it("clearGlobalFilterHistory awaits an in-flight initial loadFilterHistory() before reading/persisting, so it never wipes out already-persisted history for other keys", async () => {
    let resolveLoad: ((value: { ok: true; data: Record<string, string[]> }) => void) | undefined;
    const loadPromise = new Promise<{ ok: true; data: Record<string, string[]> }>((resolve) => {
      resolveLoad = resolve;
    });
    const writeFilterHistory = vi.fn(async () => ok(undefined));
    const state: StatePort = {
      readActiveEdt: vi.fn(async () => ok(null)),
      writeActiveEdt: vi.fn(async () => ok(undefined)),
      readSplitterRatios: vi.fn(async () => ok(null)),
      writeSplitterRatios: vi.fn(async () => ok(undefined)),
      readFilterHistory: vi.fn(async () => loadPromise),
      writeFilterHistory,
      readCommandHistory: vi.fn(async () => ok(null)),
      writeCommandHistory: vi.fn(async () => ok(undefined)),
      readLogRules: vi.fn(async () => ok(null)),
      writeLogRules: vi.fn(async () => ok(undefined)),
      readLogRuleSets: vi.fn(async () => ok(null)),
      writeLogRuleSets: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ state }));

    const loading = store.getState().loadFilterHistory();
    store.getState().clearGlobalFilterHistory();

    resolveLoad?.({ ok: true, data: { "global:text": ["already-on-disk"], "service:/repo/a:text": ["keep-me"] } });
    await loading;
    await new Promise((resolve) => setTimeout(resolve, 0));

    // clearGlobalFilterHistory only touches the two global lists — the service entry loaded
    // from disk in the same race must survive.
    expect(store.getState().filterHistory["global:text"]).toBeUndefined();
    expect(store.getState().filterHistory["service:/repo/a:text"]).toEqual(["keep-me"]);
    expect(writeFilterHistory).toHaveBeenLastCalledWith({ "service:/repo/a:text": ["keep-me"] });
  });
});
