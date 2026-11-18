import { describe, it, expect, vi } from "vitest";
import { ok, err } from "../../../../../core/result.js";
import type { LockPort } from "../../../../../core/ports/lock.js";
import type { ManifestPort } from "../../../../../core/ports/manifest.js";
import type { DockerPort } from "../../../../../core/ports/docker.js";
import { createAppStore, type AppStoreDeps } from "../app-store.js";
import { manifestFor, fakeDeps } from "../store.test-support.js";

describe("logs slice: inline service health & restart", () => {
  async function flushPolls(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  it("subscribeLogsPane polls container health on subscribe and reflects it on the pane badge", async () => {
    const getContainerHealth = vi.fn(async () => ok("up" as const));
    const docker: DockerPort = {
      streamLogs: vi.fn(() => () => {}),
      fetchLogsBefore: vi.fn(async () => ok([])),
      getContainerHealth,
      restartContainer: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ docker }));
    await store.getState().subscribeLogsPane("/repo/a", "svc-a");

    await flushPolls();

    expect(getContainerHealth).toHaveBeenCalledWith("ctr-a");
    expect(store.getState().logsPanes["/repo/a"]?.health).toBe("up");
  });

  it("a failed health poll keeps last-known health instead of clearing the badge", async () => {
    vi.useFakeTimers();
    try {
      const getContainerHealth = vi.fn(async () => ok("up" as const));
      const docker: DockerPort = {
        streamLogs: vi.fn(() => () => {}),
        fetchLogsBefore: vi.fn(async () => ok([])),
        getContainerHealth,
        restartContainer: vi.fn(async () => ok(undefined)),
      };
      const store = createAppStore(fakeDeps({ docker }));
      await store.getState().subscribeLogsPane("/repo/a", "svc-a");
      await vi.advanceTimersByTimeAsync(0);
      // First drive the badge to a known non-default state — asserting `"down"` below would
      // also match `emptyPane`'s default and pass even if a failed poll reset the badge.
      expect(store.getState().logsPanes["/repo/a"]?.health).toBe("up");

      getContainerHealth.mockImplementation(async () => err("docker-unavailable", "daemon down"));
      const callsBefore = getContainerHealth.mock.calls.length;
      await vi.advanceTimersByTimeAsync(5000);
      await vi.advanceTimersByTimeAsync(0);

      // The failing poll really ran (guards a vacuous pass where the assertion below would
      // hold simply because no second poll happened yet) and the badge kept last-known.
      expect(getContainerHealth.mock.calls.length).toBeGreaterThan(callsBefore);
      expect(store.getState().logsPanes["/repo/a"]?.health).toBe("up");
    } finally {
      vi.useRealTimers();
    }
  });

  it("a poll whose manifest.load fails leaves health untouched and never crashes", async () => {
    vi.useFakeTimers();
    try {
      const manifestLoad = vi.fn(async (path: string) => ok(manifestFor(path)));
      const manifest: ManifestPort = { load: manifestLoad };
      const getContainerHealth = vi.fn(async () => ok("up" as const));
      const docker: DockerPort = {
        streamLogs: vi.fn(() => () => {}),
        fetchLogsBefore: vi.fn(async () => ok([])),
        getContainerHealth,
        restartContainer: vi.fn(async () => ok(undefined)),
      };
      const store = createAppStore(fakeDeps({ docker, manifest }));
      await store.getState().subscribeLogsPane("/repo/a", "svc-a");
      await vi.advanceTimersByTimeAsync(0);
      expect(store.getState().logsPanes["/repo/a"]?.health).toBe("up");

      manifestLoad.mockImplementation(async () => err("manifest-not-found", "gone"));
      const callsBefore = getContainerHealth.mock.calls.length;
      await vi.advanceTimersByTimeAsync(5000);
      await vi.advanceTimersByTimeAsync(0);

      // The poll bailed before ever reaching the adapter — no inspect, no crash, badge kept.
      expect(getContainerHealth.mock.calls.length).toBe(callsBefore);
      expect(store.getState().logsPanes["/repo/a"]?.health).toBe("up");
    } finally {
      vi.useRealTimers();
    }
  });

  it("health polling repeats on a ~5s interval and stops after unsubscribe (never outlives the pane)", async () => {
    vi.useFakeTimers();
    try {
      const getContainerHealth = vi.fn(async () => ok("up" as const));
      const docker: DockerPort = {
        streamLogs: vi.fn(() => () => {}),
        fetchLogsBefore: vi.fn(async () => ok([])),
        getContainerHealth,
        restartContainer: vi.fn(async () => ok(undefined)),
      };
      const store = createAppStore(fakeDeps({ docker }));
      await store.getState().subscribeLogsPane("/repo/a", "svc-a");
      await vi.advanceTimersByTimeAsync(0);
      const afterSubscribe = getContainerHealth.mock.calls.length;
      expect(afterSubscribe).toBeGreaterThanOrEqual(1);

      await vi.advanceTimersByTimeAsync(5000);
      expect(getContainerHealth.mock.calls.length).toBeGreaterThan(afterSubscribe);

      const afterInterval = getContainerHealth.mock.calls.length;
      store.getState().unsubscribeLogsPane("/repo/a");
      await vi.advanceTimersByTimeAsync(20000);
      expect(getContainerHealth.mock.calls.length).toBe(afterInterval);
    } finally {
      vi.useRealTimers();
    }
  });

  function restartDeps(overrides: Partial<AppStoreDeps> = {}) {
    const containerRestart = vi.fn(async (_container: string) => ok(undefined));
    const recipeRun = vi.fn(async (_repoPath: string, _command: string) => ok({ output: "" }));
    const launch = vi.fn((_repoPath: string, _editor: string) => ok(undefined));
    const getContainerHealth = vi.fn(async () => ok("up" as const));
    const docker: DockerPort = {
      streamLogs: vi.fn(() => () => {}),
      fetchLogsBefore: vi.fn(async () => ok([])),
      getContainerHealth,
      restartContainer: vi.fn(async () => ok(undefined)),
    };
    const deps = fakeDeps({
      docker,
      container: { restart: containerRestart },
      restart: { run: recipeRun },
      editor: { launch },
      ...overrides,
    });
    return { deps, containerRestart, recipeRun, launch, getContainerHealth, docker };
  }

  it("restartLogsPane runs the registry's simple restart for that pane's container and re-polls health immediately", async () => {
    const { deps, containerRestart, getContainerHealth, docker } = restartDeps();
    const store = createAppStore(deps);
    await store.getState().subscribeLogsPane("/repo/a", "svc-a");
    const callsAfterSubscribe = getContainerHealth.mock.calls.length;

    await store.getState().restartLogsPane("/repo/a");

    expect(containerRestart).toHaveBeenCalledTimes(1);
    expect(containerRestart).toHaveBeenCalledWith("ctr-a");
    expect(docker.restartContainer).not.toHaveBeenCalled();
    expect(store.getState().logsPanes["/repo/a"]?.restarting).toBe(false);
    expect(store.getState().logsPanes["/repo/a"]?.notice ?? null).toBeNull();
    expect(getContainerHealth.mock.calls.length).toBeGreaterThan(callsAfterSubscribe);
  });

  it("restartLogsPane in clean mode runs the manifest recipe and shows no notice", async () => {
    const manifest: ManifestPort = {
      load: vi.fn(async (path: string) => ok({ ...manifestFor(path), restartCommands: ["npm run reset"] })),
    };
    const { deps, containerRestart, recipeRun } = restartDeps({ manifest });
    const store = createAppStore(deps);
    store.setState((s) => ({ settings: { ...s.settings, logs: { ...s.settings.logs, restartMode: "clean" } } }));
    await store.getState().subscribeLogsPane("/repo/a", "svc-a");

    await store.getState().restartLogsPane("/repo/a");

    expect(recipeRun).toHaveBeenCalledWith("/repo/a", "npm run reset");
    expect(containerRestart).not.toHaveBeenCalled();
    expect(store.getState().logsPanes["/repo/a"]?.notice ?? null).toBeNull();
  });

  it("restartLogsPane in clean mode without a recipe falls back to a simple restart and sets the dim notice", async () => {
    const { deps, containerRestart } = restartDeps();
    const store = createAppStore(deps);
    store.setState((s) => ({ settings: { ...s.settings, logs: { ...s.settings.logs, restartMode: "clean" } } }));
    await store.getState().subscribeLogsPane("/repo/a", "svc-a");

    await store.getState().restartLogsPane("/repo/a");

    expect(containerRestart).toHaveBeenCalledWith("ctr-a");
    expect(store.getState().logsPanes["/repo/a"]?.notice).toBe("no clean-restart recipe — simple restart");
    expect(store.getState().logsPanes["/repo/a"]?.streamError).toBeNull();
  });

  it("restartLogsPane reads the current mode on every call (live change, simple again after clean)", async () => {
    const { deps, recipeRun, containerRestart } = restartDeps({
      manifest: { load: vi.fn(async (path: string) => ok({ ...manifestFor(path), restartCommands: ["x"] })) },
    });
    const store = createAppStore(deps);
    await store.getState().subscribeLogsPane("/repo/a", "svc-a");
    await store.getState().restartLogsPane("/repo/a");
    expect(containerRestart).toHaveBeenCalledTimes(1);
    expect(recipeRun).not.toHaveBeenCalled();

    store.setState((s) => ({ settings: { ...s.settings, logs: { ...s.settings.logs, restartMode: "clean" } } }));
    await store.getState().restartLogsPane("/repo/a");
    expect(recipeRun).toHaveBeenCalledTimes(1);
  });

  it("restartLogsPane is a no-op while that pane is already restarting — never a second concurrent restart", async () => {
    const { deps, containerRestart } = restartDeps();
    const store = createAppStore(deps);
    await store.getState().subscribeLogsPane("/repo/a", "svc-a");
    store.setState((state) => ({
      logsPanes: { ...state.logsPanes, "/repo/a": { ...state.logsPanes["/repo/a"]!, restarting: true } },
    }));

    await store.getState().restartLogsPane("/repo/a");

    expect(containerRestart).not.toHaveBeenCalled();
  });

  it("restartLogsPane surfaces a restart failure inline on the pane while the badge keeps last-known health", async () => {
    const { deps } = restartDeps({ container: { restart: vi.fn(async () => err("container-restart-error", "no such container")) } });
    const store = createAppStore(deps);
    await store.getState().subscribeLogsPane("/repo/a", "svc-a");

    await store.getState().restartLogsPane("/repo/a");

    expect(store.getState().logsPanes["/repo/a"]?.streamError).toEqual({
      code: "container-restart-error",
      message: "no such container",
    });
    expect(store.getState().logsPanes["/repo/a"]?.restarting).toBe(false);
  });

  it("restartLogsPane surfaces a manifest.load failure inline and re-enables the control instead of wedging on restarting", async () => {
    const manifest: ManifestPort = {
      load: vi
        .fn()
        // subscribeLogsPane's immediate health poll issues its own manifest.load
        // synchronously before subscribe's own load, so the queue needs two oks before the
        // restart's failing load.
        .mockResolvedValueOnce(ok(manifestFor("/repo/a")))
        .mockResolvedValueOnce(ok(manifestFor("/repo/a")))
        .mockResolvedValueOnce(err("manifest-not-found", "no manifest here")),
    };
    const { deps, containerRestart } = restartDeps({ manifest });
    const store = createAppStore(deps);
    await store.getState().subscribeLogsPane("/repo/a", "svc-a");

    await store.getState().restartLogsPane("/repo/a");

    expect(containerRestart).not.toHaveBeenCalled();
    expect(store.getState().logsPanes["/repo/a"]?.streamError).toEqual({
      code: "manifest-not-found",
      message: "no manifest here",
    });
    expect(store.getState().logsPanes["/repo/a"]?.restarting).toBe(false);
  });

  it("restartLogsPane on a manifest without container marks the pane no-container and calls no restart port", async () => {
    const manifest: ManifestPort = {
      load: vi
        .fn()
        .mockResolvedValueOnce(ok(manifestFor("/repo/a")))
        .mockResolvedValueOnce(ok(manifestFor("/repo/a")))
        .mockResolvedValue(ok({ service: "svc-a", sharedBranch: "development", modules: {} })),
    };
    const { deps, containerRestart, recipeRun } = restartDeps({ manifest });
    const store = createAppStore(deps);
    await store.getState().subscribeLogsPane("/repo/a", "svc-a");

    await store.getState().restartLogsPane("/repo/a");

    const pane = store.getState().logsPanes["/repo/a"];
    expect(pane?.health).toBe("no-container");
    expect(pane?.streamError?.code).toBe("no-container");
    expect(pane?.restarting).toBe(false);
    expect(containerRestart).not.toHaveBeenCalled();
    expect(recipeRun).not.toHaveBeenCalled();
  });

  it("restartLogsPane on a pane already at no-container calls no restart port", async () => {
    const { deps, containerRestart, recipeRun } = restartDeps();
    const store = createAppStore(deps);
    await store.getState().subscribeLogsPane("/repo/a", "svc-a");
    store.setState((state) => ({
      logsPanes: { ...state.logsPanes, "/repo/a": { ...state.logsPanes["/repo/a"]!, health: "no-container" as const } },
    }));

    await store.getState().restartLogsPane("/repo/a");

    expect(containerRestart).not.toHaveBeenCalled();
    expect(recipeRun).not.toHaveBeenCalled();
  });

  it("a successful restart clears a lingering streamError", async () => {
    const { deps } = restartDeps();
    const store = createAppStore(deps);
    await store.getState().subscribeLogsPane("/repo/a", "svc-a");
    store.setState((state) => ({
      logsPanes: { ...state.logsPanes, "/repo/a": { ...state.logsPanes["/repo/a"]!, streamError: { code: "x", message: "old" } } },
    }));

    await store.getState().restartLogsPane("/repo/a");

    expect(store.getState().logsPanes["/repo/a"]?.streamError).toBeNull();
  });

  it("a failed restart clears a lingering notice", async () => {
    const { deps } = restartDeps({ container: { restart: vi.fn(async () => err("container-restart-error", "boom")) } });
    const store = createAppStore(deps);
    await store.getState().subscribeLogsPane("/repo/a", "svc-a");
    store.setState((state) => ({
      logsPanes: { ...state.logsPanes, "/repo/a": { ...state.logsPanes["/repo/a"]!, notice: "old notice" } },
    }));

    await store.getState().restartLogsPane("/repo/a");

    const pane = store.getState().logsPanes["/repo/a"];
    expect(pane?.notice).toBeNull();
    expect(pane?.streamError?.message).toBe("boom");
  });

  it("openLogsPaneInIde launches the editor on the repo with the configured editor command", async () => {
    const { deps, launch } = restartDeps();
    const store = createAppStore(deps);
    store.setState((s) => ({ settings: { ...s.settings, general: { ...s.settings.general, editorCommand: "code" } } }));
    await store.getState().subscribeLogsPane("/repo/a", "svc-a");

    store.getState().openLogsPaneInIde("/repo/a");

    expect(launch).toHaveBeenCalledWith("/repo/a", "code");
    expect(store.getState().logsPanes["/repo/a"]?.notice ?? null).toBeNull();
  });

  it("openLogsPaneInIde surfaces a launch failure as a one-line pane notice without throwing", async () => {
    const { deps } = restartDeps({
      editor: { launch: vi.fn(() => err("editor-launch-failed", 'Could not launch "nope": ENOENT\nsecond line')) },
    });
    const store = createAppStore(deps);
    await store.getState().subscribeLogsPane("/repo/a", "svc-a");

    store.getState().openLogsPaneInIde("/repo/a");

    expect(store.getState().logsPanes["/repo/a"]?.notice).toBe('Could not launch "nope": ENOENT');
  });

  // `R` / `O` / the `a` menu, resolved through the service-action registry.
  function lockHeld(key: string): LockPort {
    return {
      acquire: vi.fn(async () => ok({ release: vi.fn(async () => ok(undefined)) })),
      peek: vi.fn(async (candidate: string) => ok({ locked: candidate === key })),
    };
  }
  const containerLessManifest: ManifestPort = {
    load: vi.fn(async () => ok({ service: "svc-a", sharedBranch: "development", modules: {} })),
  };

  it("listLogsPaneActions lists the registry's five actions in order", async () => {
    const { deps } = restartDeps();
    const store = createAppStore(deps);
    const actions = await store.getState().listLogsPaneActions("/repo/a");
    expect(actions?.map((action) => action.id)).toEqual([
      "open-in-ide",
      "restart-simple",
      "restart-clean",
      "terminal-service",
      "terminal-container",
    ]);
  });

  it("listLogsPaneActions on a container-less service lists the restarts and the container terminal as `no container`", async () => {
    const { deps } = restartDeps({ manifest: containerLessManifest });
    const store = createAppStore(deps);
    const actions = (await store.getState().listLogsPaneActions("/repo/a")) ?? [];
    const disabled = actions.filter((action) => !action.availability.available).map((action) => [action.id, action.availability]);
    expect(disabled).toEqual([
      ["restart-simple", { available: false, reason: "no container" }],
      ["restart-clean", { available: false, reason: "no container" }],
      ["terminal-container", { available: false, reason: "no container" }],
    ]);
  });

  it("listLogsPaneActions returns null when the listing rejects, and with the restart ports unwired", async () => {
    const rejecting: LockPort = {
      acquire: vi.fn(async () => ok({ release: vi.fn(async () => ok(undefined)) })),
      peek: vi.fn(async () => {
        throw new Error("boom");
      }),
    };
    const store = createAppStore(restartDeps({ lock: rejecting }).deps);
    await expect(store.getState().listLogsPaneActions("/repo/a")).resolves.toBeNull();

    const unwired = createAppStore(fakeDeps());
    await expect(unwired.getState().listLogsPaneActions("/repo/a")).resolves.toBeNull();
  });

  it("R (simple mode) runs the registry's simple restart", async () => {
    const { deps, containerRestart, recipeRun } = restartDeps();
    const store = createAppStore(deps);
    await store.getState().subscribeLogsPane("/repo/a", "svc-a");

    await store.getState().runLogsPaneShortcut("/repo/a", "restart", "svc-a");

    expect(containerRestart).toHaveBeenCalledWith("ctr-a");
    expect(recipeRun).not.toHaveBeenCalled();
    expect(store.getState().logsPanes["/repo/a"]?.notice ?? null).toBeNull();
  });

  it("R (clean mode) with an empty recipe runs the simple restart entry and shows the no-recipe notice", async () => {
    const { deps, containerRestart, recipeRun } = restartDeps({
      manifest: { load: vi.fn(async (path: string) => ok({ ...manifestFor(path), restartCommands: ["  "] })) },
    });
    const store = createAppStore(deps);
    store.setState((s) => ({ settings: { ...s.settings, logs: { ...s.settings.logs, restartMode: "clean" } } }));
    await store.getState().subscribeLogsPane("/repo/a", "svc-a");

    await store.getState().runLogsPaneShortcut("/repo/a", "restart", "svc-a");

    expect(containerRestart).toHaveBeenCalledWith("ctr-a");
    expect(recipeRun).not.toHaveBeenCalled();
    expect(store.getState().logsPanes["/repo/a"]?.notice).toBe("no clean-restart recipe — simple restart");
  });

  it("R (clean mode) with a recipe runs the clean restart", async () => {
    const { deps, recipeRun } = restartDeps({
      manifest: { load: vi.fn(async (path: string) => ok({ ...manifestFor(path), restartCommands: ["npm run reset"] })) },
    });
    const store = createAppStore(deps);
    store.setState((s) => ({ settings: { ...s.settings, logs: { ...s.settings.logs, restartMode: "clean" } } }));
    await store.getState().subscribeLogsPane("/repo/a", "svc-a");

    await store.getState().runLogsPaneShortcut("/repo/a", "restart", "svc-a");

    expect(recipeRun).toHaveBeenCalledWith("/repo/a", "npm run reset");
  });

  it("R while the group update lock is held does not restart and shows `group update` on the pane", async () => {
    const { deps, containerRestart } = restartDeps({ lock: lockHeld("group-update") });
    const store = createAppStore(deps);
    await store.getState().subscribeLogsPane("/repo/a", "svc-a");

    await store.getState().runLogsPaneShortcut("/repo/a", "restart", "svc-a");

    expect(containerRestart).not.toHaveBeenCalled();
    expect(store.getState().logsPanes["/repo/a"]?.notice).toBe("Restart unavailable — group update");
  });

  it("R (clean mode) while blocked never falls back: the blocking reason shows", async () => {
    const { deps, containerRestart } = restartDeps({ lock: lockHeld("group-update") });
    const store = createAppStore(deps);
    store.setState((s) => ({ settings: { ...s.settings, logs: { ...s.settings.logs, restartMode: "clean" } } }));
    await store.getState().subscribeLogsPane("/repo/a", "svc-a");

    await store.getState().runLogsPaneShortcut("/repo/a", "restart", "svc-a");

    expect(containerRestart).not.toHaveBeenCalled();
    expect(store.getState().logsPanes["/repo/a"]?.notice).toBe("Clean restart unavailable — group update");
  });

  it("R on a container-less pane does not restart and shows `no container` on the pane", async () => {
    const { deps, containerRestart, recipeRun } = restartDeps({ manifest: containerLessManifest });
    const store = createAppStore(deps);
    await store.getState().subscribeLogsPane("/repo/a", "svc-a");

    await store.getState().runLogsPaneShortcut("/repo/a", "restart", "svc-a");

    expect(containerRestart).not.toHaveBeenCalled();
    expect(recipeRun).not.toHaveBeenCalled();
    expect(store.getState().logsPanes["/repo/a"]?.notice).toBe("Restart unavailable — no container");
  });

  it("R on a pane already restarting is a no-op (the slice guard)", async () => {
    const { deps, containerRestart } = restartDeps();
    const store = createAppStore(deps);
    await store.getState().subscribeLogsPane("/repo/a", "svc-a");
    store.setState((state) => ({
      logsPanes: { ...state.logsPanes, "/repo/a": { ...state.logsPanes["/repo/a"]!, restarting: true } },
    }));

    await store.getState().runLogsPaneShortcut("/repo/a", "restart", "svc-a");

    expect(containerRestart).not.toHaveBeenCalled();
  });

  it("R when the listing fails runs nothing and says so on the pane", async () => {
    const rejecting: LockPort = {
      acquire: vi.fn(async () => ok({ release: vi.fn(async () => ok(undefined)) })),
      peek: vi.fn(async () => {
        throw new Error("boom");
      }),
    };
    const { deps, containerRestart } = restartDeps({ lock: rejecting });
    const store = createAppStore(deps);
    await store.getState().subscribeLogsPane("/repo/a", "svc-a");

    await store.getState().runLogsPaneShortcut("/repo/a", "restart", "svc-a");

    expect(containerRestart).not.toHaveBeenCalled();
    expect(store.getState().logsPanes["/repo/a"]?.notice).toBe("the service actions could not be loaded — try again");
  });

  it("O opens the IDE through the registry, and still through the editor port with the restart ports unwired", async () => {
    const { deps, launch } = restartDeps();
    const store = createAppStore(deps);
    await store.getState().subscribeLogsPane("/repo/a", "svc-a");
    await store.getState().runLogsPaneShortcut("/repo/a", "ide", "svc-a");
    expect(launch).toHaveBeenCalledWith("/repo/a", "");

    const editorOnly = vi.fn((_repoPath: string, _editor: string) => ok(undefined));
    const unwired = createAppStore(fakeDeps({ editor: { launch: editorOnly } }));
    await unwired.getState().subscribeLogsPane("/repo/a", "svc-a");
    await unwired.getState().runLogsPaneShortcut("/repo/a", "ide", "svc-a");
    expect(editorOnly).toHaveBeenCalledWith("/repo/a", "");
  });

  it("runLogsPaneAction runs the chosen clean restart, then re-polls health", async () => {
    const { deps, recipeRun, getContainerHealth } = restartDeps({
      manifest: { load: vi.fn(async (path: string) => ok({ ...manifestFor(path), restartCommands: ["npm run reset"] })) },
    });
    const store = createAppStore(deps);
    await store.getState().subscribeLogsPane("/repo/a", "svc-a");
    const healthCalls = getContainerHealth.mock.calls.length;

    await store.getState().runLogsPaneAction("/repo/a", "restart-clean", "svc-a");

    expect(recipeRun).toHaveBeenCalledWith("/repo/a", "npm run reset");
    expect(store.getState().logsPanes["/repo/a"]?.restarting).toBe(false);
    expect(getContainerHealth.mock.calls.length).toBeGreaterThan(healthCalls);
  });

  it("runLogsPaneAction surfaces a restart failure as the pane streamError", async () => {
    const { deps } = restartDeps({ container: { restart: vi.fn(async () => err("container-restart-error", "boom")) } });
    const store = createAppStore(deps);
    await store.getState().subscribeLogsPane("/repo/a", "svc-a");

    await store.getState().runLogsPaneAction("/repo/a", "restart-simple", "svc-a");

    expect(store.getState().logsPanes["/repo/a"]?.streamError).toEqual({ code: "container-restart-error", message: "boom" });
  });

  it("runLogsPaneAction opens the terminal overlay on the repo for the terminal entries", async () => {
    const { deps } = restartDeps();
    const store = createAppStore(deps);
    const openTerminal = vi.fn(async () => {});
    store.setState({ openTerminal });
    await store.getState().subscribeLogsPane("/repo/a", "svc-a");

    await store.getState().runLogsPaneAction("/repo/a", "terminal-service", "svc-a");
    await store.getState().runLogsPaneAction("/repo/a", "terminal-container", "svc-a");

    expect(openTerminal).toHaveBeenNthCalledWith(1, "/repo/a", "service", "svc-a");
    expect(openTerminal).toHaveBeenNthCalledWith(2, "/repo/a", "container", "svc-a");
  });

  it("runLogsPaneAction fails closed: an action disabled since the menu opened does not run and shows its reason", async () => {
    const { deps, containerRestart } = restartDeps({ lock: lockHeld("group-update") });
    const store = createAppStore(deps);
    await store.getState().subscribeLogsPane("/repo/a", "svc-a");

    await store.getState().runLogsPaneAction("/repo/a", "restart-simple", "svc-a");

    expect(containerRestart).not.toHaveBeenCalled();
    expect(store.getState().logsPanes["/repo/a"]?.notice).toBe("Restart unavailable — group update");
  });

  function rejectingLock(): LockPort {
    return {
      acquire: vi.fn(async () => ok({ release: vi.fn(async () => ok(undefined)) })),
      peek: vi.fn(async () => {
        throw new Error("boom");
      }),
    };
  }

  it("runLogsPaneAction with a failed re-list runs no restart and says so", async () => {
    const { deps, containerRestart } = restartDeps({ lock: rejectingLock() });
    const store = createAppStore(deps);
    await store.getState().subscribeLogsPane("/repo/a", "svc-a");

    await store.getState().runLogsPaneAction("/repo/a", "restart-simple", "svc-a");

    expect(containerRestart).not.toHaveBeenCalled();
    expect(store.getState().logsPanes["/repo/a"]?.notice).toBe("the service actions could not be loaded — try again");
  });

  it("Open in IDE (menu or O) is never blocked by a failed listing: it opens without re-listing", async () => {
    const lock = rejectingLock();
    const { deps, launch } = restartDeps({ lock });
    const store = createAppStore(deps);
    await store.getState().subscribeLogsPane("/repo/a", "svc-a");

    await store.getState().runLogsPaneAction("/repo/a", "open-in-ide", "svc-a");
    await store.getState().runLogsPaneShortcut("/repo/a", "ide", "svc-a");

    expect(launch).toHaveBeenCalledTimes(2);
    expect(lock.peek).not.toHaveBeenCalled();
  });

  it("a restart is refused with a notice while the health poll reports the pane restarting (shortcut and menu)", async () => {
    const { deps, containerRestart, getContainerHealth } = restartDeps();
    // The poll keeps reading `restarting`, so an in-flight cycle never overwrites the seed.
    getContainerHealth.mockImplementation(async () => ok("restarting" as never));
    const store = createAppStore(deps);
    await store.getState().subscribeLogsPane("/repo/a", "svc-a");
    const seed = () =>
      store.setState((state) => ({
        logsPanes: { ...state.logsPanes, "/repo/a": { ...state.logsPanes["/repo/a"]!, health: "restarting" as const } },
      }));

    seed();
    await store.getState().runLogsPaneShortcut("/repo/a", "restart", "svc-a");
    expect(store.getState().logsPanes["/repo/a"]?.notice).toBe("Restart unavailable — restart in progress");
    seed();
    await store.getState().runLogsPaneAction("/repo/a", "restart-simple", "svc-a");

    expect(containerRestart).not.toHaveBeenCalled();
    expect(store.getState().logsPanes["/repo/a"]?.notice).toBe("Restart unavailable — restart in progress");
  });

  it("restartLogsPane on a pane known container-less says so instead of returning silently", async () => {
    const { deps, containerRestart } = restartDeps();
    const store = createAppStore(deps);
    await store.getState().subscribeLogsPane("/repo/a", "svc-a");
    store.setState((state) => ({
      logsPanes: { ...state.logsPanes, "/repo/a": { ...state.logsPanes["/repo/a"]!, noContainer: true } },
    }));

    await store.getState().restartLogsPane("/repo/a");

    expect(containerRestart).not.toHaveBeenCalled();
    expect(store.getState().logsPanes["/repo/a"]?.notice).toBe("Restart unavailable — no container");
  });

  it("R (clean, no recipe) falls back to the simple restart's own reason when that one is disabled too", async () => {
    // list() checks the simple restart's service lock first, then the clean one's: answering
    // "held" to the first peek only lists simple as `restart in progress` while clean is
    // disabled solely for its missing recipe — the fallback then meets a disabled simple entry.
    let servicePeeks = 0;
    const peek = vi.fn(async (key: string) => ok({ locked: key.startsWith("service:") && servicePeeks++ === 0 }));
    const { deps, containerRestart } = restartDeps({
      lock: { acquire: vi.fn(async () => ok({ release: vi.fn(async () => ok(undefined)) })), peek },
    });
    const store = createAppStore(deps);
    store.setState((s) => ({ settings: { ...s.settings, logs: { ...s.settings.logs, restartMode: "clean" } } }));
    await store.getState().subscribeLogsPane("/repo/a", "svc-a");

    await store.getState().runLogsPaneShortcut("/repo/a", "restart", "svc-a");

    expect(containerRestart).not.toHaveBeenCalled();
    expect(store.getState().logsPanes["/repo/a"]?.notice).toBe("Restart unavailable — restart in progress");
  });

  it("R fallback: a failed simple restart keeps the no-recipe notice next to the streamError", async () => {
    const { deps } = restartDeps({ container: { restart: vi.fn(async () => err("container-restart-error", "boom")) } });
    const store = createAppStore(deps);
    store.setState((s) => ({ settings: { ...s.settings, logs: { ...s.settings.logs, restartMode: "clean" } } }));
    await store.getState().subscribeLogsPane("/repo/a", "svc-a");

    await store.getState().runLogsPaneShortcut("/repo/a", "restart", "svc-a");

    const pane = store.getState().logsPanes["/repo/a"];
    expect(pane?.streamError?.message).toBe("boom");
    expect(pane?.notice).toBe("no clean-restart recipe — simple restart");
  });

  it("the actions never reject: a throwing terminal open becomes a pane notice", async () => {
    const { deps } = restartDeps();
    const store = createAppStore(deps);
    store.setState({ openTerminal: vi.fn(async () => { throw new Error("boom"); }) });
    await store.getState().subscribeLogsPane("/repo/a", "svc-a");

    await expect(store.getState().runLogsPaneAction("/repo/a", "terminal-service", "svc-a")).resolves.toBeUndefined();
    expect(store.getState().logsPanes["/repo/a"]?.notice).toBe("the action failed unexpectedly");
  });

  it("an action id missing from the fresh list shows a notice instead of returning silently", async () => {
    const { deps } = restartDeps();
    const store = createAppStore(deps);
    await store.getState().subscribeLogsPane("/repo/a", "svc-a");

    await store.getState().runLogsPaneAction("/repo/a", "made-up", "svc-a");

    expect(store.getState().logsPanes["/repo/a"]?.notice).toBe("made-up unavailable — not offered for this service");
  });

  it("a pane closed while the list was loading gets nothing run on it", async () => {
    const { deps, containerRestart } = restartDeps();
    const store = createAppStore(deps);
    await store.getState().subscribeLogsPane("/repo/a", "svc-a");

    const run = store.getState().runLogsPaneAction("/repo/a", "restart-simple", "svc-a");
    store.getState().unsubscribeLogsPane("/repo/a");
    await run;

    expect(containerRestart).not.toHaveBeenCalled();
    expect(store.getState().logsPanes["/repo/a"]).toBeUndefined();
  });
});
