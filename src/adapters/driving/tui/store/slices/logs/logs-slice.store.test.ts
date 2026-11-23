import { describe, it, expect, vi } from "vitest";
import { ok, err } from "../../../../../../core/result.js";
import type { ManifestPort } from "../../../../../../core/ports/vcs/manifest.js";
import { DEFAULT_SETTINGS } from "../../../../../../core/ports/storage/settings.js";
import type { DockerPort } from "../../../../../../core/ports/runtime/docker.js";
import { createAppStore } from "../../app-store.js";
import { manifestFor, fakeDeps } from "../../store.test-support.js";

describe("logs slice", () => {
  it("toggleLogsEdtSelection/toggleLogsOtherSelection add then remove a repoPath (Space toggle)", () => {
    const store = createAppStore(fakeDeps());

    store.getState().toggleLogsEdtSelection("/repo/a");
    expect(store.getState().logsEdtSelected).toEqual(["/repo/a"]);
    store.getState().toggleLogsEdtSelection("/repo/a");
    expect(store.getState().logsEdtSelected).toEqual([]);

    store.getState().toggleLogsOtherSelection("/repo/b");
    expect(store.getState().logsOtherSelected).toEqual(["/repo/b"]);
  });

  it("selectAllLogsEdtServices/deselectAllLogsEdtServices set and clear the whole EDT-list selection (Ctrl+A / Ctrl+Shift+A)", () => {
    const store = createAppStore(fakeDeps());

    store.getState().selectAllLogsEdtServices(["/repo/a", "/repo/b"]);
    expect(store.getState().logsEdtSelected).toEqual(["/repo/a", "/repo/b"]);

    store.getState().deselectAllLogsEdtServices();
    expect(store.getState().logsEdtSelected).toEqual([]);
  });

  it("openLogsFullscreen/closeLogsFullscreen set and clear logsFullscreenTarget/logsFullscreenServiceName without touching selection", () => {
    const store = createAppStore(fakeDeps());
    store.getState().selectAllLogsEdtServices(["/repo/a"]);

    store.getState().openLogsFullscreen("/repo/other", "other-service");
    expect(store.getState().logsFullscreenTarget).toBe("/repo/other");
    expect(store.getState().logsFullscreenServiceName).toBe("other-service");

    store.getState().closeLogsFullscreen();
    expect(store.getState().logsFullscreenTarget).toBeNull();
    expect(store.getState().logsFullscreenServiceName).toBeNull();
    // Selection is untouched by the ad hoc preview's whole open/close cycle.
    expect(store.getState().logsEdtSelected).toEqual(["/repo/a"]);
  });

  it("subscribeLogsPane resolves the container via manifest.load then starts a stream, mirroring lines as they arrive", async () => {
    const streamed: { onLine: (line: { timestamp: string; stream: "stdout" | "stderr"; text: string }) => void } = {
      onLine: () => {},
    };
    const docker: DockerPort = {
      streamLogs: vi.fn((_container, onLine) => {
        streamed.onLine = onLine;
        return () => {};
      }),
      fetchLogsBefore: vi.fn(async () => ok([])),
      getContainerHealth: vi.fn(async () => ok('up' as const)),
      restartContainer: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ docker }));

    await store.getState().subscribeLogsPane("/repo/a", "svc-a");

    expect(docker.streamLogs).toHaveBeenCalledWith("ctr-a", expect.any(Function), expect.any(Function));
    expect(store.getState().logsPanes["/repo/a"]).toMatchObject({ repoPath: "/repo/a", service: "svc-a", lines: [] });

    streamed.onLine({ timestamp: "2026-01-01T00:00:00.000Z", stream: "stdout", text: "hello" });

    expect(store.getState().logsPanes["/repo/a"]?.lines).toEqual([
      { timestamp: "2026-01-01T00:00:00.000Z", stream: "stdout", text: "hello" },
    ]);
  });

  it("subscribeLogsPane is idempotent — subscribing an already-active key never starts a second stream", async () => {
    const docker: DockerPort = {
      streamLogs: vi.fn(() => () => {}),
      fetchLogsBefore: vi.fn(async () => ok([])),
      getContainerHealth: vi.fn(async () => ok('up' as const)),
      restartContainer: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ docker }));

    await store.getState().subscribeLogsPane("/repo/a", "svc-a");
    await store.getState().subscribeLogsPane("/repo/a", "svc-a");

    expect(docker.streamLogs).toHaveBeenCalledTimes(1);
  });

  it("subscribeLogsPane surfaces a manifest.load failure as this pane's own streamError", async () => {
    const manifest: ManifestPort = {
      load: vi.fn(async () => err("manifest-not-found", "no manifest here")),
    };
    const store = createAppStore(fakeDeps({ manifest }));

    await store.getState().subscribeLogsPane("/repo/a", "svc-a");

    expect(store.getState().logsPanes["/repo/a"]?.streamError).toEqual({
      code: "manifest-not-found",
      message: "no manifest here",
    });
  });

  it("subscribeLogsPane surfaces a docker-unavailable Result as this pane's own streamError", async () => {
    const docker: DockerPort = {
      streamLogs: vi.fn((_container, _onLine, onError) => {
        onError({ code: "docker-unavailable", message: "docker daemon unreachable" });
        return () => {};
      }),
      fetchLogsBefore: vi.fn(async () => ok([])),
      getContainerHealth: vi.fn(async () => ok('up' as const)),
      restartContainer: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ docker }));

    await store.getState().subscribeLogsPane("/repo/a", "svc-a");

    expect(store.getState().logsPanes["/repo/a"]?.streamError).toEqual({
      code: "docker-unavailable",
      message: "docker daemon unreachable",
    });
  });

  it("unsubscribeLogsPane stops the stream and removes the pane entry", async () => {
    const stop = vi.fn();
    const docker: DockerPort = {
      streamLogs: vi.fn(() => stop),
      fetchLogsBefore: vi.fn(async () => ok([])),
      getContainerHealth: vi.fn(async () => ok('up' as const)),
      restartContainer: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ docker }));
    await store.getState().subscribeLogsPane("/repo/a", "svc-a");

    store.getState().unsubscribeLogsPane("/repo/a");

    expect(stop).toHaveBeenCalledTimes(1);
    expect(store.getState().logsPanes["/repo/a"]).toBeUndefined();
  });

  it("loadOlderLogsPane on a pane that started genuinely empty pins scrollOffset to 0 — the newest of the just-fetched history — rather than overshooting past every line just loaded", async () => {
    const olderLine = { timestamp: "2025-12-31T23:59:00.000Z", stream: "stdout" as const, text: "older" };
    const docker: DockerPort = {
      streamLogs: vi.fn(() => () => {}),
      fetchLogsBefore: vi.fn(async () => ok([olderLine])),
      getContainerHealth: vi.fn(async () => ok('up' as const)),
      restartContainer: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ docker }));
    await store.getState().subscribeLogsPane("/repo/a", "svc-a");

    await store.getState().loadOlderLogsPane("/repo/a");

    expect(store.getState().logsPanes["/repo/a"]?.lines).toEqual([olderLine]);
    expect(store.getState().logsPanes["/repo/a"]?.scrollOffset).toBe(0);
  });

  it("loadOlderLogsPane on a pane that already had visible lines bumps scrollOffset to preserve the viewport", async () => {
    const olderLine = { timestamp: "2025-12-31T23:59:00.000Z", stream: "stdout" as const, text: "older" };
    let fetchOlder = false;
    const docker: DockerPort = {
      streamLogs: vi.fn((_container, onLine) => {
        onLine({ timestamp: "2026-01-01T00:00:00.000Z", stream: "stdout", text: "live" });
        return () => {};
      }),
      fetchLogsBefore: vi.fn(async () => {
        fetchOlder = true;
        return ok([olderLine]);
      }),
      getContainerHealth: vi.fn(async () => ok('up' as const)),
      restartContainer: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ docker }));
    await store.getState().subscribeLogsPane("/repo/a", "svc-a");
    expect(fetchOlder).toBe(false);

    await store.getState().loadOlderLogsPane("/repo/a");

    expect(store.getState().logsPanes["/repo/a"]?.lines).toHaveLength(2);
    expect(store.getState().logsPanes["/repo/a"]?.scrollOffset).toBe(1);
  });

  it("loadOlderLogsPane surfaces a manifest.load failure as this pane's own streamError, instead of silently no-oping forever", async () => {
    const manifest: ManifestPort = {
      load: vi
        .fn()
        // subscribeLogsPane's immediate health poll issues its own manifest.load synchronously
        // before subscribe's own load, so the queue needs one extra ok.
        .mockResolvedValueOnce(ok(manifestFor("/repo/a")))
        .mockResolvedValueOnce(ok(manifestFor("/repo/a")))
        .mockResolvedValueOnce(err("manifest-not-found", "no manifest here")),
    };
    const docker: DockerPort = {
      streamLogs: vi.fn(() => () => {}),
      fetchLogsBefore: vi.fn(async () => ok([])),
      getContainerHealth: vi.fn(async () => ok('up' as const)),
      restartContainer: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ docker, manifest }));
    await store.getState().subscribeLogsPane("/repo/a", "svc-a");

    await store.getState().loadOlderLogsPane("/repo/a");

    expect(store.getState().logsPanes["/repo/a"]?.streamError).toEqual({
      code: "manifest-not-found",
      message: "no manifest here",
    });
  });

  it("loadOlderLogsPane on a fetch failure sets noMoreHistory without erroring (scrolling stops at the edge)", async () => {
    const docker: DockerPort = {
      streamLogs: vi.fn(() => () => {}),
      fetchLogsBefore: vi.fn(async () => err("docker-unavailable", "daemon down")),
      getContainerHealth: vi.fn(async () => ok('up' as const)),
      restartContainer: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ docker }));
    await store.getState().subscribeLogsPane("/repo/a", "svc-a");

    await store.getState().loadOlderLogsPane("/repo/a");

    expect(store.getState().logsPanes["/repo/a"]?.noMoreHistory).toBe(true);
  });

  it("subscribeLogsPane leaves a fresh pane empty by default (settings.logs.startWithHistory: false) — never fetches history on its own", async () => {
    const fetchLogsBefore = vi.fn(async () => ok([{ timestamp: "2025-12-31T23:59:00.000Z", stream: "stdout" as const, text: "older" }]));
    const docker: DockerPort = {
      streamLogs: vi.fn(() => () => {}),
      fetchLogsBefore,
      getContainerHealth: vi.fn(async () => ok('up' as const)),
      restartContainer: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ docker }));

    await store.getState().subscribeLogsPane("/repo/a", "svc-a");

    expect(fetchLogsBefore).not.toHaveBeenCalled();
    expect(store.getState().logsPanes["/repo/a"]?.lines).toEqual([]);
  });

  it("subscribeLogsPane immediately loads the most recent history when settings.logs.startWithHistory is true", async () => {
    const olderLine = { timestamp: "2025-12-31T23:59:00.000Z", stream: "stdout" as const, text: "older" };
    const docker: DockerPort = {
      streamLogs: vi.fn(() => () => {}),
      fetchLogsBefore: vi.fn(async () => ok([olderLine])),
      getContainerHealth: vi.fn(async () => ok('up' as const)),
      restartContainer: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ docker }));
    store.setState((state) => ({ settings: { ...state.settings, logs: { ...state.settings.logs, startWithHistory: true } } }));

    await store.getState().subscribeLogsPane("/repo/a", "svc-a");

    expect(docker.fetchLogsBefore).toHaveBeenCalledWith("ctr-a", expect.any(String), DEFAULT_SETTINGS.logs.bufferSize);
    expect(store.getState().logsPanes["/repo/a"]?.lines).toEqual([olderLine]);
    expect(store.getState().logsPanes["/repo/a"]?.scrollOffset).toBe(0);
  });

  it("clearLogsPane wipes buffered lines/noMoreHistory/scrollOffset but leaves the live stream running", async () => {
    const streamed: { onLine: (line: { timestamp: string; stream: "stdout" | "stderr"; text: string }) => void } = {
      onLine: () => {},
    };
    const stop = vi.fn();
    const docker: DockerPort = {
      streamLogs: vi.fn((_container, onLine) => {
        streamed.onLine = onLine;
        return stop;
      }),
      fetchLogsBefore: vi.fn(async () => ok([])),
      getContainerHealth: vi.fn(async () => ok('up' as const)),
      restartContainer: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ docker }));
    await store.getState().subscribeLogsPane("/repo/a", "svc-a");
    streamed.onLine({ timestamp: "2026-01-01T00:00:00.000Z", stream: "stdout", text: "hello" });
    expect(store.getState().logsPanes["/repo/a"]?.lines).toHaveLength(1);

    store.getState().clearLogsPane("/repo/a");

    expect(store.getState().logsPanes["/repo/a"]).toMatchObject({ lines: [], noMoreHistory: false, scrollOffset: 0 });
    // The subscription itself is untouched — clearing is a display wipe, not a teardown.
    expect(stop).not.toHaveBeenCalled();

    streamed.onLine({ timestamp: "2026-01-01T00:00:01.000Z", stream: "stdout", text: "world" });
    expect(store.getState().logsPanes["/repo/a"]?.lines.map((l) => l.text)).toEqual(["world"]);
  });

  it("clearLogsPane is a safe no-op for a repoPath with no active pane", () => {
    const store = createAppStore(fakeDeps());
    expect(() => store.getState().clearLogsPane("/repo/never-subscribed")).not.toThrow();
  });

  it("setLogsPaneScrollOffset clamps to [0, lines.length - 1]", async () => {
    const docker: DockerPort = {
      streamLogs: vi.fn((_container, onLine) => {
        onLine({ timestamp: "2026-01-01T00:00:00.000Z", stream: "stdout", text: "one" });
        onLine({ timestamp: "2026-01-01T00:00:01.000Z", stream: "stdout", text: "two" });
        return () => {};
      }),
      fetchLogsBefore: vi.fn(async () => ok([])),
      getContainerHealth: vi.fn(async () => ok('up' as const)),
      restartContainer: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ docker }));
    await store.getState().subscribeLogsPane("/repo/a", "svc-a");

    store.getState().setLogsPaneScrollOffset("/repo/a", 100);
    expect(store.getState().logsPanes["/repo/a"]?.scrollOffset).toBe(1);

    store.getState().setLogsPaneScrollOffset("/repo/a", -5);
    expect(store.getState().logsPanes["/repo/a"]?.scrollOffset).toBe(0);
  });

  it("stopAllLogsPanes stops every active pane's stream and clears all pane state (process-exit teardown fallback)", async () => {
    const stopA = vi.fn();
    const stopB = vi.fn();
    const docker: DockerPort = {
      streamLogs: vi
        .fn()
        .mockImplementationOnce(() => stopA)
        .mockImplementationOnce(() => stopB),
      fetchLogsBefore: vi.fn(async () => ok([])),
      getContainerHealth: vi.fn(async () => ok('up' as const)),
      restartContainer: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ docker }));
    await store.getState().subscribeLogsPane("/repo/a", "svc-a");
    await store.getState().subscribeLogsPane("/repo/b", "svc-b");

    store.getState().stopAllLogsPanes();

    expect(stopA).toHaveBeenCalledTimes(1);
    expect(stopB).toHaveBeenCalledTimes(1);
    expect(store.getState().logsPanes).toEqual({});
  });

  it("stopAllLogsPanes is a safe no-op on an unwired store", () => {
    const store = createAppStore();
    expect(() => store.getState().stopAllLogsPanes()).not.toThrow();
  });

  it("every logs action is a safe no-op on an unwired store", async () => {
    const store = createAppStore();

    expect(() => store.getState().toggleLogsEdtSelection("/repo/a")).not.toThrow();
    await expect(store.getState().subscribeLogsPane("/repo/a", "svc-a")).resolves.toBeUndefined();
    expect(() => store.getState().unsubscribeLogsPane("/repo/a")).not.toThrow();
    await expect(store.getState().loadOlderLogsPane("/repo/a")).resolves.toBeUndefined();
    await expect(store.getState().restartLogsPane("/repo/a")).resolves.toBeUndefined();
  });
});
