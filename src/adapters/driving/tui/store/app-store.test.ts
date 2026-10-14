import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ok, err } from "../../../../core/result.js";
import type {
  EdtRegistryEntry,
  EdtRegistryPort,
} from "../../../../core/ports/edt-registry.js";
import type { GitPort } from "../../../../core/ports/git.js";
import type { LockPort } from "../../../../core/ports/lock.js";
import type {
  Manifest,
  ManifestPort,
} from "../../../../core/ports/manifest.js";
import type {
  RegistryPort,
} from "../../../../core/ports/registry.js";
import type { StatePort } from "../../../../core/ports/state.js";
import { DEFAULT_SETTINGS, type SettingsPort } from "../../../../core/ports/settings.js";
import type { DockerPort } from "../../../../core/ports/docker.js";
import { ZONES } from "../zones/zones.js";
import { ZONE_LAYOUTS, defaultZoneRatios } from "../zones/zone-layouts.js";
import { createAppStore, NO_BRANCH_CREATION, type AppStoreDeps } from "./app-store.js";

const DEFAULT_LIST_RATIO = ZONE_LAYOUTS.dashboard.boundaries[0]!.defaultRatio;

function manifestFor(repoPath: string): Manifest {
  const name = repoPath.split("/").pop();
  return {
    service: `svc-${name}`,
    container: `ctr-${name}`,
    migrationCommand: "npm run migration:run",
    sharedBranch: "development",
    modules: {},
  };
}

function fakeDeps(overrides: Partial<AppStoreDeps> = {}): AppStoreDeps {
  const registry: RegistryPort = {
    list: vi.fn(async () => ok(["/repo/a"])),
    add: vi.fn(async () => ok(undefined)),
    exists: vi.fn(async () => ok(true)),
    scan: vi.fn(async () => ok({ candidates: [], skipped: [] })),
    reset: vi.fn(async () => ok({ path: "/x", backupPath: null })),
    remove: vi.fn(async () => ok(undefined)),
  };
  const manifest: ManifestPort = {
    load: vi.fn(async (path: string) => ok(manifestFor(path))),
  };
  const git: GitPort = {
    assertAllowedBranch: vi.fn(async () => ok(undefined)),
    createBranch: vi.fn(async () => ok(undefined)),
    deleteBranch: vi.fn(async () => ok(undefined)),
    currentBranch: vi.fn(async () => ok("feat/a")),
    aheadBehind: vi.fn(async () => ok({ ahead: 2, behind: 0 })),
    checkout: vi.fn(async () => ok(undefined)),
    hasUncommittedChanges: vi.fn(async () => ok(false)),
    stashSave: vi.fn(async () => ok(undefined)),
    restoreStash: vi.fn(async () => ok(undefined)),
    branchExistsLocally: vi.fn(async () => ok(true)),
    fetch: vi.fn(async () => ok(undefined)),
    pull: vi.fn(async () => ok(undefined)),
    mergeBranch: vi.fn(async () => ok(undefined)),
    abortMerge: vi.fn(async () => ok(undefined)),
    isMergeInProgress: vi.fn(async () => ok(false)),
    listDirtyPaths: vi.fn(async () => ok([])),
    discardPaths: vi.fn(async () => ok(undefined)),
    discardAll: vi.fn(async () => ok(undefined)),
    diffNameOnly: vi.fn(async () => ok([])),
    headRevision: vi.fn(async () => ok('head-a')),
    diffStat: vi.fn(async () => ok({ files: 0, insertions: 0, deletions: 0 })),
    discardPathsToHead: vi.fn(async () => ok(undefined)),
    isRebaseInProgress: vi.fn(async () => ok(false)),
    hasUnmergedPaths: vi.fn(async () => ok(false)),
    listUnmergedPaths: vi.fn(async () => ok([] as string[])),
    readWorktreeFile: vi.fn(async () => ok("")),
    writeResolvedFile: vi.fn(async () => ok(undefined)),
    checkoutSide: vi.fn(async () => ok(undefined)),
    finalizeMerge: vi.fn(async () => ok(undefined)),
    listBranches: vi.fn(async () => ok([])),
    renameBranch: vi.fn(async () => ok(undefined)),
    listRemoteBranches: vi.fn(async () => ok([])),
    createTrackingBranch: vi.fn(async () => ok(undefined)),
    stagePaths: vi.fn(async () => ok(undefined)),
    commit: vi.fn(async () => ok(undefined)),
    isBranchMerged: vi.fn(async () => ok(true)),
    hasStash: vi.fn(async () => ok(false)),
    fetchRemote: vi.fn(async () => ok(undefined)),
    listUnpushedCommits: vi.fn(async () => ok([] as string[])),
    listVersionBumpCommits: vi.fn(async () => ok({ endedBy: "exhausted" as const, scanned: 0 })),
    listBranchesContaining: vi.fn(async () => ok([] as string[])),
  };
  const edtRegistry: EdtRegistryPort = {
    add: vi.fn(async () => ok(undefined)),
    list: vi.fn(async () => ok([] as EdtRegistryEntry[])),
    setStatus: vi.fn(async () => ok(undefined)),
    update: vi.fn(async () => ok(undefined)),
    remove: vi.fn(async () => ok(undefined)),
  };
  const state: StatePort = {
    readActiveEdt: vi.fn(async () => ok(null)),
    writeActiveEdt: vi.fn(async () => ok(undefined)),
    readSplitterRatios: vi.fn(async () => ok(null)),
    writeSplitterRatios: vi.fn(async () => ok(undefined)),
    readFilterHistory: vi.fn(async () => ok(null)),
    writeFilterHistory: vi.fn(async () => ok(undefined)),
    readCommandHistory: vi.fn(async () => ok(null)),
    writeCommandHistory: vi.fn(async () => ok(undefined)),
  };
  const lock: LockPort = {
    acquire: vi.fn(async () =>
      ok({ release: vi.fn(async () => ok(undefined)) }),
    ),
    peek: vi.fn(async () => ok({ locked: false })),
  };
  const settings: SettingsPort = {
    load: vi.fn(async () => ok({ settings: DEFAULT_SETTINGS, warning: null })),
    save: vi.fn(async () => ok(undefined)),
  };
  const docker: DockerPort = {
    streamLogs: vi.fn(() => () => {}),
    fetchLogsBefore: vi.fn(async () => ok([])),
    getContainerHealth: vi.fn(async () => ok('up' as const)),
    restartContainer: vi.fn(async () => ok(undefined)),
  };
  return {
    registry,
    manifest,
    manifestCarry: { capture: async () => ({ ok: true, data: { kind: 'absent' } }), restore: async () => ({ ok: true, data: undefined }) },
    git,
    edtRegistry,
    state,
    lock,
    registryResourceKey: "/config/registry.yaml",
    edtRegistryResourceKey: "/tmp/edts.yaml",
    edtsBaseDir: "/tmp/edts",
    settings,
    docker,
    ...overrides,
  };
}

const tmpDirs: string[] = [];

afterEach(async () => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

async function makeEdtsBaseDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tui-back-app-store-createedt-"));
  tmpDirs.push(dir);
  return dir;
}

describe("app store", () => {
  it("scaffolds placeholder cross-zone state: dashboard active, empty events, 2:3 splitter ratios, no active EDT (AD-10)", () => {
    const store = createAppStore();
    const state = store.getState();
    expect(state.activeZone).toBe("dashboard");
    expect(state.activeEdt).toBeNull();
    for (const zone of ZONES) {
      expect(state.zoneEvents[zone.id]).toBe(0);
      expect(state.splitterRatios[zone.id]).toEqual(defaultZoneRatios(zone.id));
    }
  });

  it("defaults resizeMode to null", () => {
    const store = createAppStore();
    expect(store.getState().resizeMode).toBeNull();
  });

  it("covers exactly the six compiled-in zones — no duplicate copy per zone", () => {
    const store = createAppStore();
    const state = store.getState();
    expect(ZONES).toHaveLength(6);
    const zoneIds = ZONES.map((zone) => zone.id);
    expect(Object.keys(state.zoneEvents).sort()).toEqual([...zoneIds].sort());
    expect(Object.keys(state.splitterRatios).sort()).toEqual(
      [...zoneIds].sort(),
    );
  });

  it("switches the active zone and clears pending events for the visited zone", () => {
    const store = createAppStore();
    store.getState().addZoneEvent("logs");
    store.getState().addZoneEvent("logs");
    expect(store.getState().zoneEvents.logs).toBe(2);
    store.getState().setActiveZone("logs");
    expect(store.getState().activeZone).toBe("logs");
    expect(store.getState().zoneEvents.logs).toBe(0);
  });

  it("adds pending background-event counts per zone independently", () => {
    const store = createAppStore();
    store.getState().addZoneEvent("routes");
    store.getState().addZoneEvent("routes");
    store.getState().addZoneEvent("dashboard");
    expect(store.getState().zoneEvents.routes).toBe(2);
    expect(store.getState().zoneEvents.dashboard).toBe(1);
  });

  it("stores the splitter ratio per zone/boundary, clamped to keep both panes usable", () => {
    const store = createAppStore();
    store.getState().setSplitterRatio("edts", 0, 0.5);
    expect(store.getState().splitterRatios.edts[0]).toBe(0.5);
    store.getState().setSplitterRatio("edts", 0, 1);
    expect(store.getState().splitterRatios.edts[0]).toBe(0.8);
    store.getState().setSplitterRatio("edts", 0, 0);
    expect(store.getState().splitterRatios.edts[0]).toBe(0.2);
    expect(store.getState().splitterRatios.dashboard[0]).toBe(DEFAULT_LIST_RATIO);
  });

  // The EDTs zone has 3 independently movable boundaries — each setSplitterRatio call only
  // ever touches the one boundaryIndex it's given, never the other two.
  it("moves only the targeted boundary within a multi-boundary zone", () => {
    const store = createAppStore();
    store.getState().setSplitterRatio("edts", 1, 0.7);
    expect(store.getState().splitterRatios.edts).toEqual([DEFAULT_LIST_RATIO, 0.7, DEFAULT_LIST_RATIO]);
    store.getState().setSplitterRatio("edts", 2, 0.3);
    expect(store.getState().splitterRatios.edts).toEqual([DEFAULT_LIST_RATIO, 0.7, 0.3]);
  });

  it("ignores an out-of-range boundaryIndex rather than writing a sparse array", () => {
    const store = createAppStore();
    const before = store.getState().splitterRatios.dashboard;
    store.getState().setSplitterRatio("dashboard", 5, 0.5);
    expect(store.getState().splitterRatios.dashboard).toEqual(before);
  });

  describe("resizeMode (Ctrl+W keyboard resize-mode)", () => {
    it("enterResizeMode sets the zone with targetBoundary 0", () => {
      const store = createAppStore();
      store.getState().enterResizeMode("edts");
      expect(store.getState().resizeMode).toEqual({ zone: "edts", targetBoundary: 0 });
    });

    it("exitResizeMode clears it back to null", () => {
      const store = createAppStore();
      store.getState().enterResizeMode("edts");
      store.getState().exitResizeMode();
      expect(store.getState().resizeMode).toBeNull();
    });

    it("cycleResizeTargetBoundary wraps across the zone's own boundary count", () => {
      const store = createAppStore();
      store.getState().enterResizeMode("edts");
      store.getState().cycleResizeTargetBoundary();
      expect(store.getState().resizeMode?.targetBoundary).toBe(1);
      store.getState().cycleResizeTargetBoundary();
      expect(store.getState().resizeMode?.targetBoundary).toBe(2);
      store.getState().cycleResizeTargetBoundary();
      expect(store.getState().resizeMode?.targetBoundary).toBe(0);
    });

    it("cycleResizeTargetBoundary('back') reverses, wrapping first to last", () => {
      const store = createAppStore();
      store.getState().enterResizeMode("edts");
      store.getState().cycleResizeTargetBoundary("back");
      expect(store.getState().resizeMode?.targetBoundary).toBe(2);
      store.getState().cycleResizeTargetBoundary("back");
      expect(store.getState().resizeMode?.targetBoundary).toBe(1);
    });

    it("cycleResizeTargetBoundary is a no-op while resizeMode is null", () => {
      const store = createAppStore();
      store.getState().cycleResizeTargetBoundary();
      expect(store.getState().resizeMode).toBeNull();
    });
  });

  it("tracks the active EDT placeholder field (AD-10)", () => {
    const store = createAppStore();
    store.getState().setActiveEdt("edt-01hx2");
    expect(store.getState().activeEdt).toBe("edt-01hx2");
    store.getState().setActiveEdt(null);
    expect(store.getState().activeEdt).toBeNull();
  });

  it("opens and closes the cross-zone help modal (AD-10)", () => {
    const store = createAppStore();
    expect(store.getState().helpOpen).toBe(false);
    store.getState().openHelp();
    expect(store.getState().helpOpen).toBe(true);
    store.getState().closeHelp();
    expect(store.getState().helpOpen).toBe(false);
  });

  describe("loadEdtsBranches (FR-9)", () => {
    it("starts idle with no data before the first load", () => {
      const store = createAppStore(fakeDeps());
      expect(store.getState().edtsBranches).toBeNull();
      expect(store.getState().edtsBranchesStatus).toBe("idle");
      expect(store.getState().edtsBranchesError).toBeNull();
    });

    it("flips to loading synchronously, then populates edtsBranches from the core use-case and returns to idle", async () => {
      const store = createAppStore(fakeDeps());

      const pending = store.getState().loadEdtsBranches();
      expect(store.getState().edtsBranchesStatus).toBe("loading");

      await pending;

      expect(store.getState().edtsBranchesStatus).toBe("idle");
      expect(store.getState().edtsBranchesError).toBeNull();
      expect(store.getState().edtsBranches).toEqual([
        {
          service: "svc-a",
          path: "/repo/a",
          isMember: false,
          sharedBranch: "development",
          protectedBranches: [],
          branch: "feat/a",
          ahead: 2,
          behind: 0,
          status: "current",
        },
      ]);
    });

    it("sets an explicit error state (never a stale value) when the underlying use-case fails", async () => {
      const registry: RegistryPort = {
        list: vi.fn(async () => err("registry-invalid-yaml", "bad yaml")),
        add: vi.fn(async () => ok(undefined)),
        exists: vi.fn(async () => ok(true)),
        scan: vi.fn(async () => ok({ candidates: [], skipped: [] })),
        reset: vi.fn(async () => ok({ path: "/x", backupPath: null })),
        remove: vi.fn(async () => ok(undefined)),
      };
      const store = createAppStore(fakeDeps({ registry }));

      await store.getState().loadEdtsBranches();

      expect(store.getState().edtsBranchesStatus).toBe("error");
      expect(store.getState().edtsBranchesError).toBe("bad yaml");
      expect(store.getState().edtsBranches).toBeNull();
    });

    it("degrades to an explicit error, never a throw, when the store was created with no ports wired", async () => {
      const store = createAppStore();

      await store.getState().loadEdtsBranches();

      expect(store.getState().edtsBranchesStatus).toBe("error");
      expect(store.getState().edtsBranchesError).toBeTruthy();
      expect(store.getState().edtsBranches).toBeNull();
    });

    it("populates edtsUnreachable/edtsErrors from the core use-case alongside edtsBranches", async () => {
      const registry: RegistryPort = {
        list: vi.fn(async () => ok(["/repo/a", "/repo/gone", "/repo/bad"])),
        add: vi.fn(async () => ok(undefined)),
        exists: vi.fn(async (path: string) => ok(path !== "/repo/gone")),
        scan: vi.fn(async () => ok({ candidates: [], skipped: [] })),
        reset: vi.fn(async () => ok({ path: "/x", backupPath: null })),
        remove: vi.fn(async () => ok(undefined)),
      };
      const manifest: ManifestPort = {
        load: vi.fn(async (path: string) =>
          path === "/repo/bad"
            ? err("manifest-validation-failed", "Invalid .tui-back.yaml")
            : ok(manifestFor(path)),
        ),
      };
      const store = createAppStore(fakeDeps({ registry, manifest }));

      await store.getState().loadEdtsBranches();

      expect(store.getState().edtsBranchesStatus).toBe("idle");
      expect(store.getState().edtsUnreachable).toEqual(["/repo/gone"]);
      expect(store.getState().edtsErrors).toEqual([
        {
          path: "/repo/bad",
          code: "manifest-validation-failed",
          message: "Invalid .tui-back.yaml",
        },
      ]);
    });

    it("starts with empty edtsUnreachable/edtsErrors before the first load", () => {
      const store = createAppStore(fakeDeps());
      expect(store.getState().edtsUnreachable).toEqual([]);
      expect(store.getState().edtsErrors).toEqual([]);
    });

    it("never starts a second concurrent fetch while one is already in flight", async () => {
      let resolveList: (() => void) | undefined;
      const registry: RegistryPort = {
        list: vi.fn(
          () =>
            new Promise<ReturnType<typeof ok<string[]>>>((resolveFn) => {
              resolveList = () => resolveFn(ok(["/repo/a"]));
            }),
        ),
        add: vi.fn(async () => ok(undefined)),
        exists: vi.fn(async () => ok(true)),
        scan: vi.fn(async () => ok({ candidates: [], skipped: [] })),
        reset: vi.fn(async () => ok({ path: "/x", backupPath: null })),
        remove: vi.fn(async () => ok(undefined)),
      };
      const store = createAppStore(fakeDeps({ registry }));

      const first = store.getState().loadEdtsBranches();
      const second = store.getState().loadEdtsBranches();
      expect(registry.list).toHaveBeenCalledTimes(1);

      resolveList?.();
      await Promise.all([first, second]);
      expect(store.getState().edtsBranchesStatus).toBe("idle");
    });
  });

  describe("loadTabVisibility", () => {
    it("starts with the default reachable state (both enabled) before the first load — no spinner, no flash-then-hide", () => {
      const store = createAppStore(fakeDeps());
      expect(store.getState().tabVisibility).toEqual({
        routes: { status: "enabled", carryingServices: [] },
        sharedTypes: { status: "enabled", carryingServices: [] },
      });
      expect(store.getState().tabVisibilityStatus).toBe("idle");
      expect(store.getState().tabVisibilityError).toBeNull();
    });

    it("flips to loading synchronously, then populates tabVisibility from the core use-case and returns to idle", async () => {
      const manifest: ManifestPort = {
        load: vi.fn(async (path: string) => ok({ ...manifestFor(path), modules: { "route-explorer": {} } })),
      };
      const store = createAppStore(fakeDeps({ manifest }));

      const pending = store.getState().loadTabVisibility();
      expect(store.getState().tabVisibilityStatus).toBe("loading");
      await pending;

      expect(store.getState().tabVisibilityStatus).toBe("idle");
      expect(store.getState().tabVisibilityError).toBeNull();
      expect(store.getState().tabVisibility).toEqual({
        routes: { status: "disabled", carryingServices: ["svc-a"] },
        sharedTypes: { status: "omitted", carryingServices: [] },
      });
    });

    it("sets an explicit error state when the underlying use-case fails, but leaves tabVisibility untouched — never falsely hides/dims a real capability", async () => {
      const registry: RegistryPort = {
        list: vi.fn(async () => err("registry-invalid-yaml", "bad yaml")),
        add: vi.fn(async () => ok(undefined)),
        exists: vi.fn(async () => ok(true)),
        scan: vi.fn(async () => ok({ candidates: [], skipped: [] })),
        reset: vi.fn(async () => ok({ path: "/x", backupPath: null })),
        remove: vi.fn(async () => ok(undefined)),
      };
      const store = createAppStore(fakeDeps({ registry }));

      await store.getState().loadTabVisibility();

      expect(store.getState().tabVisibilityStatus).toBe("error");
      expect(store.getState().tabVisibilityError).toBe("bad yaml");
      expect(store.getState().tabVisibility).toEqual({
        routes: { status: "enabled", carryingServices: [] },
        sharedTypes: { status: "enabled", carryingServices: [] },
      });
    });

    it("degrades to an explicit error, never a throw, when the store was created with no ports wired", async () => {
      const store = createAppStore();

      await store.getState().loadTabVisibility();

      expect(store.getState().tabVisibilityStatus).toBe("error");
      expect(store.getState().tabVisibilityError).toBeTruthy();
      expect(store.getState().tabVisibility).toEqual({
        routes: { status: "enabled", carryingServices: [] },
        sharedTypes: { status: "enabled", carryingServices: [] },
      });
    });

    it("never starts a second concurrent fetch while one is already in flight", async () => {
      let resolveList: (() => void) | undefined;
      const registry: RegistryPort = {
        list: vi.fn(
          () =>
            new Promise<ReturnType<typeof ok<string[]>>>((resolveFn) => {
              resolveList = () => resolveFn(ok(["/repo/a"]));
            }),
        ),
        add: vi.fn(async () => ok(undefined)),
        exists: vi.fn(async () => ok(true)),
        scan: vi.fn(async () => ok({ candidates: [], skipped: [] })),
        reset: vi.fn(async () => ok({ path: "/x", backupPath: null })),
        remove: vi.fn(async () => ok(undefined)),
      };
      const store = createAppStore(fakeDeps({ registry }));

      const first = store.getState().loadTabVisibility();
      const second = store.getState().loadTabVisibility();
      expect(registry.list).toHaveBeenCalledTimes(1);

      resolveList?.();
      await Promise.all([first, second]);
      expect(store.getState().tabVisibilityStatus).toBe("idle");
    });

    it("keeps the last known-good tabVisibility on a later reload failure (mirrors edtsBranches' rule)", async () => {
      let call = 0;
      const registry: RegistryPort = {
        list: vi.fn(async () => {
          call += 1;
          return call === 1 ? ok(["/repo/a"]) : err("registry-invalid-yaml", "bad yaml");
        }),
        add: vi.fn(async () => ok(undefined)),
        exists: vi.fn(async () => ok(true)),
        scan: vi.fn(async () => ok({ candidates: [], skipped: [] })),
        reset: vi.fn(async () => ok({ path: "/x", backupPath: null })),
        remove: vi.fn(async () => ok(undefined)),
      };
      const manifest: ManifestPort = {
        load: vi.fn(async (path: string) => ok({ ...manifestFor(path), modules: { "route-explorer": {} } })),
      };
      const store = createAppStore(fakeDeps({ registry, manifest }));

      await store.getState().loadTabVisibility();
      expect(store.getState().tabVisibility.routes.status).toBe("disabled");

      await store.getState().loadTabVisibility();
      expect(store.getState().tabVisibilityStatus).toBe("error");
      expect(store.getState().tabVisibility.routes.status).toBe("disabled");
    });
  });

  describe("active-EDT membership change reloads tabVisibility", () => {
    it("createEdt success triggers a tabVisibility reload", async () => {
      const edtsBaseDir = await makeEdtsBaseDir();
      const store = createAppStore(fakeDeps({ edtsBaseDir }));
      const loadTabVisibility = vi.fn(async () => {});
      store.setState({ loadTabVisibility });

      const result = await store.getState().createEdt({ topic: "demo", members: ["/repo/a"], branchOptions: NO_BRANCH_CREATION });

      expect(result.ok).toBe(true);
      expect(loadTabVisibility).toHaveBeenCalled();
    });

    it("createEdt failure (e.g. zero members) never triggers a reload", async () => {
      const store = createAppStore(fakeDeps());
      const loadTabVisibility = vi.fn(async () => {});
      store.setState({ loadTabVisibility });

      const result = await store.getState().createEdt({ topic: "demo", members: [], branchOptions: NO_BRANCH_CREATION });

      expect(result.ok).toBe(false);
      expect(loadTabVisibility).not.toHaveBeenCalled();
    });

    it("switchEdt success triggers a tabVisibility reload", async () => {
      const edtRegistry: EdtRegistryPort = {
        add: vi.fn(async () => ok(undefined)),
        list: vi.fn(async () =>
          ok([
            {
              ulid: "edt-1",
              topic: "demo",
              createdAt: "2026-08-19T00:00:00.000Z",
              status: "inactive" as const,
              members: [{ service: "svc-a", repoPath: "/repo/a", branch: "feat/a" }],
            },
          ]),
        ),
        setStatus: vi.fn(async () => ok(undefined)),
        update: vi.fn(async () => ok(undefined)),
        remove: vi.fn(async () => ok(undefined)),
      };
      const store = createAppStore(fakeDeps({ edtRegistry }));
      const loadTabVisibility = vi.fn(async () => {});
      store.setState({ loadTabVisibility });

      const result = await store.getState().switchEdt({ topic: "demo" });

      expect(result.ok).toBe(true);
      expect(loadTabVisibility).toHaveBeenCalled();
    });

    it("switchEdt failure (unknown topic) never triggers a reload", async () => {
      const store = createAppStore(fakeDeps());
      const loadTabVisibility = vi.fn(async () => {});
      store.setState({ loadTabVisibility });

      const result = await store.getState().switchEdt({ topic: "does-not-exist" });

      expect(result.ok).toBe(false);
      expect(loadTabVisibility).not.toHaveBeenCalled();
    });

    it("modifyEdt success triggers a tabVisibility reload", async () => {
      const edtRegistry: EdtRegistryPort = {
        add: vi.fn(async () => ok(undefined)),
        list: vi.fn(async () =>
          ok([
            {
              ulid: "edt-1",
              topic: "demo",
              createdAt: "2026-08-19T00:00:00.000Z",
              status: "active" as const,
              members: [],
            },
          ]),
        ),
        setStatus: vi.fn(async () => ok(undefined)),
        update: vi.fn(async () => ok(undefined)),
        remove: vi.fn(async () => ok(undefined)),
      };
      const store = createAppStore(fakeDeps({ edtRegistry }));
      const loadTabVisibility = vi.fn(async () => {});
      store.setState({ loadTabVisibility });

      const result = await store.getState().modifyEdt({
        topic: "demo",
        addMembers: [],
        removeMembers: [],
        setBranches: [],
        renameTo: "renamed",
      });

      expect(result.ok).toBe(true);
      expect(loadTabVisibility).toHaveBeenCalled();
    });

    it("modifyEdt failure (unknown topic) never triggers a reload", async () => {
      const store = createAppStore(fakeDeps());
      const loadTabVisibility = vi.fn(async () => {});
      store.setState({ loadTabVisibility });

      const result = await store.getState().modifyEdt({
        topic: "does-not-exist",
        addMembers: [],
        removeMembers: [],
        setBranches: [],
        renameTo: "renamed",
      });

      expect(result.ok).toBe(false);
      expect(loadTabVisibility).not.toHaveBeenCalled();
    });
  });

  describe("deleteEdt / resolveMemberDeleteStatuses / openEdtDeleteDialog", () => {
    function fakeTarget(overrides: Partial<EdtRegistryEntry> = {}): EdtRegistryEntry {
      return {
        ulid: "edt-1",
        topic: "demo",
        createdAt: "2026-08-19T00:00:00.000Z",
        status: "inactive",
        members: [{ service: "svc-a", repoPath: "/repo/a", branch: "feat/a" }],
        ...overrides,
      };
    }

    it("deleteEdt removes the registry entry for a non-active EDT", async () => {
      const target = fakeTarget();
      const edtRegistry: EdtRegistryPort = {
        add: vi.fn(async () => ok(undefined)),
        list: vi.fn(async () => ok([target])),
        setStatus: vi.fn(async () => ok(undefined)),
        update: vi.fn(async () => ok(undefined)),
        remove: vi.fn(async () => ok(undefined)),
      };
      const edtsBaseDir = await makeEdtsBaseDir();
      const store = createAppStore(fakeDeps({ edtRegistry, edtsBaseDir }));

      const result = await store.getState().deleteEdt({ topic: "demo", dispositions: {} });

      expect(result).toMatchObject({ ok: true, data: { ulid: "edt-1", topic: "demo", results: [{ outcome: "left" }] } });
      expect(edtRegistry.remove).toHaveBeenCalledWith("edt-1");
    });

    it("deleteEdt rejects the active EDT with edt-delete-active-rejected, never removing the entry", async () => {
      const target = fakeTarget();
      const edtRegistry: EdtRegistryPort = {
        add: vi.fn(async () => ok(undefined)),
        list: vi.fn(async () => ok([target])),
        setStatus: vi.fn(async () => ok(undefined)),
        update: vi.fn(async () => ok(undefined)),
        remove: vi.fn(async () => ok(undefined)),
      };
      const state: StatePort = {
        readActiveEdt: vi.fn(async () => ok("edt-1")),
        writeActiveEdt: vi.fn(async () => ok(undefined)),
        readSplitterRatios: vi.fn(async () => ok(null)),
        writeSplitterRatios: vi.fn(async () => ok(undefined)),
        readFilterHistory: vi.fn(async () => ok(null)),
        writeFilterHistory: vi.fn(async () => ok(undefined)),
        readCommandHistory: vi.fn(async () => ok(null)),
        writeCommandHistory: vi.fn(async () => ok(undefined)),
      };
      const store = createAppStore(fakeDeps({ edtRegistry, state }));

      const result = await store.getState().deleteEdt({ topic: "demo", dispositions: {} });

      expect(result).toMatchObject({ ok: false, error: { code: "edt-delete-active-rejected" } });
      expect(edtRegistry.remove).not.toHaveBeenCalled();
    });

    it("deleteEdt on an unwired store degrades to store-not-wired, never throwing", async () => {
      const store = createAppStore();

      const result = await store.getState().deleteEdt({ topic: "demo", dispositions: {} });

      expect(result).toMatchObject({ ok: false, error: { code: "store-not-wired" } });
    });

    it("resolveMemberDeleteStatuses computes merged/clean per member via git/manifest, never calling deps.git directly from the TUI layer", async () => {
      const git: GitPort = {
        assertAllowedBranch: vi.fn(async () => ok(undefined)),
        createBranch: vi.fn(async () => ok(undefined)),
        deleteBranch: vi.fn(async () => ok(undefined)),
        currentBranch: vi.fn(async () => ok("feat/a")),
        aheadBehind: vi.fn(async () => ok({ ahead: 0, behind: 0 })),
        checkout: vi.fn(async () => ok(undefined)),
        hasUncommittedChanges: vi.fn(async () => ok(false)),
        stashSave: vi.fn(async () => ok(undefined)),
        restoreStash: vi.fn(async () => ok(undefined)),
        branchExistsLocally: vi.fn(async () => ok(true)),
        fetch: vi.fn(async () => ok(undefined)),
        listBranches: vi.fn(async () => ok([])),
        renameBranch: vi.fn(async () => ok(undefined)),
        listRemoteBranches: vi.fn(async () => ok([])),
        createTrackingBranch: vi.fn(async () => ok(undefined)),
        stagePaths: vi.fn(async () => ok(undefined)),
        commit: vi.fn(async () => ok(undefined)),
        isBranchMerged: vi.fn(async () => ok(true)),
        hasStash: vi.fn(async () => ok(false)),
        fetchRemote: vi.fn(async () => ok(undefined)),
        listUnpushedCommits: vi.fn(async () => ok([] as string[])),
        listVersionBumpCommits: vi.fn(async () => ok({ endedBy: "exhausted" as const, scanned: 0 })),
        listBranchesContaining: vi.fn(async () => ok([] as string[])),
        pull: vi.fn(async () => ok(undefined)),
        isMergeInProgress: vi.fn(async () => ok(false)),
        mergeBranch: vi.fn(async () => ok(undefined)),
        abortMerge: vi.fn(async () => ok(undefined)),
        listDirtyPaths: vi.fn(async () => ok([])),
        discardPaths: vi.fn(async () => ok(undefined)),
        discardAll: vi.fn(async () => ok(undefined)),
        diffNameOnly: vi.fn(async () => ok([])),
        headRevision: vi.fn(async () => ok('head-a')),
        diffStat: vi.fn(async () => ok({ files: 0, insertions: 0, deletions: 0 })),
        discardPathsToHead: vi.fn(async () => ok(undefined)),
        isRebaseInProgress: vi.fn(async () => ok(false)),
        hasUnmergedPaths: vi.fn(async () => ok(false)),
        listUnmergedPaths: vi.fn(async () => ok([] as string[])),
        readWorktreeFile: vi.fn(async () => ok("")),
        writeResolvedFile: vi.fn(async () => ok(undefined)),
        checkoutSide: vi.fn(async () => ok(undefined)),
        finalizeMerge: vi.fn(async () => ok(undefined)),
      };
      const store = createAppStore(fakeDeps({ git }));

      const result = await store.getState().resolveMemberDeleteStatuses("target-ulid", [{ service: "svc-a", repoPath: "/repo/a", branch: "feat/a" }]);

      expect(result).toEqual([{ repoPath: "/repo/a", service: "svc-a", branch: "feat/a", merged: true, clean: true }]);
      expect(git.isBranchMerged).toHaveBeenCalledWith("/repo/a", "feat/a", "development");
    });

    it("resolveMemberDeleteStatuses on an unwired store returns an empty array, never throwing", async () => {
      const store = createAppStore();

      const result = await store.getState().resolveMemberDeleteStatuses("target-ulid", [{ service: "svc-a", repoPath: "/repo/a", branch: "feat/a" }]);

      expect(result).toEqual([]);
    });

    it("openEdtDeleteDialog sets currentEdtAction with type 'delete' and the parsed topic", () => {
      const store = createAppStore(fakeDeps());

      store.getState().openEdtDeleteDialog("edt-delete my-topic");

      expect(store.getState().currentEdtAction).toMatchObject({ type: "delete", target: "my-topic" });
    });

    it("openEdtDeleteDialog with no topic sets target to 'select EDT'", () => {
      const store = createAppStore(fakeDeps());

      store.getState().openEdtDeleteDialog("edt-delete");

      expect(store.getState().currentEdtAction).toMatchObject({ type: "delete", target: "select EDT" });
    });

    it("openEdtCreateFromDialog sets currentEdtAction with type 'create-from' and the parsed topic", () => {
      const store = createAppStore(fakeDeps());

      store.getState().openEdtCreateFromDialog("edt-create-from feat-a");

      expect(store.getState().currentEdtAction).toMatchObject({ type: "create-from", target: "feat-a" });
    });

    it("openEdtCreateFromDialog with no topic sets target to 'select EDT'", () => {
      const store = createAppStore(fakeDeps());

      store.getState().openEdtCreateFromDialog("edt-create-from");

      expect(store.getState().currentEdtAction).toMatchObject({ type: "create-from", target: "select EDT" });
    });
  });

  // The create-EDT dialog always builds and supplies its own CreateBranchOptions — the store
  // must forward exactly what it's given to core/edt/create.ts, never substitute a default.
  describe("createEdt passes branchOptions through unchanged", () => {
    it("a real (non-NO_BRANCH_CREATION) branchOptions reaches git.createBranch with the caller's base/name", async () => {
      const edtsBaseDir = await makeEdtsBaseDir();
      const git: GitPort = {
        assertAllowedBranch: vi.fn(async () => ok(undefined)),
        createBranch: vi.fn(async () => ok(undefined)),
        deleteBranch: vi.fn(async () => ok(undefined)),
        currentBranch: vi.fn(async () => ok("main")),
        aheadBehind: vi.fn(async () => ok({ ahead: 0, behind: 0 })),
        checkout: vi.fn(async () => ok(undefined)),
        hasUncommittedChanges: vi.fn(async () => ok(false)),
        stashSave: vi.fn(async () => ok(undefined)),
        restoreStash: vi.fn(async () => ok(undefined)),
        branchExistsLocally: vi.fn(async () => ok(true)),
        fetch: vi.fn(async () => ok(undefined)),
        pull: vi.fn(async () => ok(undefined)),
        mergeBranch: vi.fn(async () => ok(undefined)),
        abortMerge: vi.fn(async () => ok(undefined)),
        isMergeInProgress: vi.fn(async () => ok(false)),
        listDirtyPaths: vi.fn(async () => ok([])),
        discardPaths: vi.fn(async () => ok(undefined)),
        discardAll: vi.fn(async () => ok(undefined)),
        diffNameOnly: vi.fn(async () => ok([])),
        headRevision: vi.fn(async () => ok('head-a')),
        diffStat: vi.fn(async () => ok({ files: 0, insertions: 0, deletions: 0 })),
        discardPathsToHead: vi.fn(async () => ok(undefined)),
        isRebaseInProgress: vi.fn(async () => ok(false)),
        hasUnmergedPaths: vi.fn(async () => ok(false)),
        listUnmergedPaths: vi.fn(async () => ok([] as string[])),
        readWorktreeFile: vi.fn(async () => ok("")),
        writeResolvedFile: vi.fn(async () => ok(undefined)),
        checkoutSide: vi.fn(async () => ok(undefined)),
        finalizeMerge: vi.fn(async () => ok(undefined)),
        listBranches: vi.fn(async () => ok([])),
        renameBranch: vi.fn(async () => ok(undefined)),
        listRemoteBranches: vi.fn(async () => ok([])),
        createTrackingBranch: vi.fn(async () => ok(undefined)),
        stagePaths: vi.fn(async () => ok(undefined)),
        commit: vi.fn(async () => ok(undefined)),
        isBranchMerged: vi.fn(async () => ok(true)),
        hasStash: vi.fn(async () => ok(false)),
        fetchRemote: vi.fn(async () => ok(undefined)),
        listUnpushedCommits: vi.fn(async () => ok([] as string[])),
        listVersionBumpCommits: vi.fn(async () => ok({ endedBy: "exhausted" as const, scanned: 0 })),
        listBranchesContaining: vi.fn(async () => ok([] as string[])),
      };
      const store = createAppStore(fakeDeps({ edtsBaseDir, git }));

      const result = await store.getState().createEdt({
        topic: "demo",
        members: ["/repo/a"],
        branchOptions: { create: true, base: "main", mode: "grouped", names: { "/repo/a": "feature-demo" } },
      });

      expect(result.ok).toBe(true);
      expect(git.createBranch).toHaveBeenCalledWith("/repo/a", "feature-demo", "main");
    });

    it("NO_BRANCH_CREATION (zero-member fallback) never calls git.createBranch", async () => {
      const edtsBaseDir = await makeEdtsBaseDir();
      const git: GitPort = {
        assertAllowedBranch: vi.fn(async () => ok(undefined)),
        createBranch: vi.fn(async () => ok(undefined)),
        deleteBranch: vi.fn(async () => ok(undefined)),
        currentBranch: vi.fn(async () => ok("main")),
        aheadBehind: vi.fn(async () => ok({ ahead: 0, behind: 0 })),
        checkout: vi.fn(async () => ok(undefined)),
        hasUncommittedChanges: vi.fn(async () => ok(false)),
        stashSave: vi.fn(async () => ok(undefined)),
        restoreStash: vi.fn(async () => ok(undefined)),
        branchExistsLocally: vi.fn(async () => ok(true)),
        fetch: vi.fn(async () => ok(undefined)),
        pull: vi.fn(async () => ok(undefined)),
        mergeBranch: vi.fn(async () => ok(undefined)),
        abortMerge: vi.fn(async () => ok(undefined)),
        isMergeInProgress: vi.fn(async () => ok(false)),
        listDirtyPaths: vi.fn(async () => ok([])),
        discardPaths: vi.fn(async () => ok(undefined)),
        discardAll: vi.fn(async () => ok(undefined)),
        diffNameOnly: vi.fn(async () => ok([])),
        headRevision: vi.fn(async () => ok('head-a')),
        diffStat: vi.fn(async () => ok({ files: 0, insertions: 0, deletions: 0 })),
        discardPathsToHead: vi.fn(async () => ok(undefined)),
        isRebaseInProgress: vi.fn(async () => ok(false)),
        hasUnmergedPaths: vi.fn(async () => ok(false)),
        listUnmergedPaths: vi.fn(async () => ok([] as string[])),
        readWorktreeFile: vi.fn(async () => ok("")),
        writeResolvedFile: vi.fn(async () => ok(undefined)),
        checkoutSide: vi.fn(async () => ok(undefined)),
        finalizeMerge: vi.fn(async () => ok(undefined)),
        listBranches: vi.fn(async () => ok([])),
        renameBranch: vi.fn(async () => ok(undefined)),
        listRemoteBranches: vi.fn(async () => ok([])),
        createTrackingBranch: vi.fn(async () => ok(undefined)),
        stagePaths: vi.fn(async () => ok(undefined)),
        commit: vi.fn(async () => ok(undefined)),
        isBranchMerged: vi.fn(async () => ok(true)),
        hasStash: vi.fn(async () => ok(false)),
        fetchRemote: vi.fn(async () => ok(undefined)),
        listUnpushedCommits: vi.fn(async () => ok([] as string[])),
        listVersionBumpCommits: vi.fn(async () => ok({ endedBy: "exhausted" as const, scanned: 0 })),
        listBranchesContaining: vi.fn(async () => ok([] as string[])),
      };
      const store = createAppStore(fakeDeps({ edtsBaseDir, git }));

      const result = await store.getState().createEdt({
        topic: "demo",
        members: ["/repo/a"],
        branchOptions: NO_BRANCH_CREATION,
      });

      expect(result.ok).toBe(true);
      expect(git.createBranch).not.toHaveBeenCalled();
      // NO_BRANCH_CREATION's create:false path reuses the member's current branch instead.
      expect(git.currentBranch).toHaveBeenCalledWith("/repo/a");
    });
  });

  // The branch-picker's store actions and modifyEdt's renameBranches param wrap real core
  // exports — every interaction test exercising the picker replaces these actions wholesale
  // via store.setState(...), so only these tests verify that the real wiring reaches deps.git
  // with the right arguments in order.
  describe("branch-picker store actions", () => {
    it("listBranches forwards repoPath to git.listBranches and returns its result unchanged", async () => {
      const git: GitPort = {
        assertAllowedBranch: vi.fn(async () => ok(undefined)),
        createBranch: vi.fn(async () => ok(undefined)),
        deleteBranch: vi.fn(async () => ok(undefined)),
        currentBranch: vi.fn(async () => ok("main")),
        aheadBehind: vi.fn(async () => ok({ ahead: 0, behind: 0 })),
        checkout: vi.fn(async () => ok(undefined)),
        hasUncommittedChanges: vi.fn(async () => ok(false)),
        stashSave: vi.fn(async () => ok(undefined)),
        restoreStash: vi.fn(async () => ok(undefined)),
        branchExistsLocally: vi.fn(async () => ok(true)),
        fetch: vi.fn(async () => ok(undefined)),
        pull: vi.fn(async () => ok(undefined)),
        mergeBranch: vi.fn(async () => ok(undefined)),
        abortMerge: vi.fn(async () => ok(undefined)),
        isMergeInProgress: vi.fn(async () => ok(false)),
        listDirtyPaths: vi.fn(async () => ok([])),
        discardPaths: vi.fn(async () => ok(undefined)),
        discardAll: vi.fn(async () => ok(undefined)),
        diffNameOnly: vi.fn(async () => ok([])),
        headRevision: vi.fn(async () => ok('head-a')),
        diffStat: vi.fn(async () => ok({ files: 0, insertions: 0, deletions: 0 })),
        discardPathsToHead: vi.fn(async () => ok(undefined)),
        isRebaseInProgress: vi.fn(async () => ok(false)),
        hasUnmergedPaths: vi.fn(async () => ok(false)),
        listUnmergedPaths: vi.fn(async () => ok([] as string[])),
        readWorktreeFile: vi.fn(async () => ok("")),
        writeResolvedFile: vi.fn(async () => ok(undefined)),
        checkoutSide: vi.fn(async () => ok(undefined)),
        finalizeMerge: vi.fn(async () => ok(undefined)),
        listBranches: vi.fn(async () => ok(["main", "feature-x"])),
        renameBranch: vi.fn(async () => ok(undefined)),
        listRemoteBranches: vi.fn(async () => ok([])),
        createTrackingBranch: vi.fn(async () => ok(undefined)),
        stagePaths: vi.fn(async () => ok(undefined)),
        commit: vi.fn(async () => ok(undefined)),
        isBranchMerged: vi.fn(async () => ok(true)),
        hasStash: vi.fn(async () => ok(false)),
        fetchRemote: vi.fn(async () => ok(undefined)),
        listUnpushedCommits: vi.fn(async () => ok([] as string[])),
        listVersionBumpCommits: vi.fn(async () => ok({ endedBy: "exhausted" as const, scanned: 0 })),
        listBranchesContaining: vi.fn(async () => ok([] as string[])),
      };
      const store = createAppStore(fakeDeps({ git }));

      const result = await store.getState().listBranches("/repo/a");

      expect(result).toEqual({ ok: true, data: ["main", "feature-x"] });
      expect(git.listBranches).toHaveBeenCalledWith("/repo/a");
    });

    it("createMemberBranch forwards repoPath/branchName/baseBranch to git.createBranch in that order", async () => {
      const git: GitPort = {
        assertAllowedBranch: vi.fn(async () => ok(undefined)),
        createBranch: vi.fn(async () => ok(undefined)),
        deleteBranch: vi.fn(async () => ok(undefined)),
        currentBranch: vi.fn(async () => ok("main")),
        aheadBehind: vi.fn(async () => ok({ ahead: 0, behind: 0 })),
        checkout: vi.fn(async () => ok(undefined)),
        hasUncommittedChanges: vi.fn(async () => ok(false)),
        stashSave: vi.fn(async () => ok(undefined)),
        restoreStash: vi.fn(async () => ok(undefined)),
        branchExistsLocally: vi.fn(async () => ok(true)),
        fetch: vi.fn(async () => ok(undefined)),
        pull: vi.fn(async () => ok(undefined)),
        mergeBranch: vi.fn(async () => ok(undefined)),
        abortMerge: vi.fn(async () => ok(undefined)),
        isMergeInProgress: vi.fn(async () => ok(false)),
        listDirtyPaths: vi.fn(async () => ok([])),
        discardPaths: vi.fn(async () => ok(undefined)),
        discardAll: vi.fn(async () => ok(undefined)),
        diffNameOnly: vi.fn(async () => ok([])),
        headRevision: vi.fn(async () => ok('head-a')),
        diffStat: vi.fn(async () => ok({ files: 0, insertions: 0, deletions: 0 })),
        discardPathsToHead: vi.fn(async () => ok(undefined)),
        isRebaseInProgress: vi.fn(async () => ok(false)),
        hasUnmergedPaths: vi.fn(async () => ok(false)),
        listUnmergedPaths: vi.fn(async () => ok([] as string[])),
        readWorktreeFile: vi.fn(async () => ok("")),
        writeResolvedFile: vi.fn(async () => ok(undefined)),
        checkoutSide: vi.fn(async () => ok(undefined)),
        finalizeMerge: vi.fn(async () => ok(undefined)),
        listBranches: vi.fn(async () => ok([])),
        renameBranch: vi.fn(async () => ok(undefined)),
        listRemoteBranches: vi.fn(async () => ok([])),
        createTrackingBranch: vi.fn(async () => ok(undefined)),
        stagePaths: vi.fn(async () => ok(undefined)),
        commit: vi.fn(async () => ok(undefined)),
        isBranchMerged: vi.fn(async () => ok(true)),
        hasStash: vi.fn(async () => ok(false)),
        fetchRemote: vi.fn(async () => ok(undefined)),
        listUnpushedCommits: vi.fn(async () => ok([] as string[])),
        listVersionBumpCommits: vi.fn(async () => ok({ endedBy: "exhausted" as const, scanned: 0 })),
        listBranchesContaining: vi.fn(async () => ok([] as string[])),
      };
      const store = createAppStore(fakeDeps({ git }));

      const result = await store.getState().createMemberBranch("/repo/a", "feature-new", "development");

      expect(result).toEqual({ ok: true, data: undefined });
      expect(git.createBranch).toHaveBeenCalledWith("/repo/a", "feature-new", "development");
    });

    it("renameBranch forwards repoPath/oldName/newName to git.renameBranch in that order", async () => {
      const git: GitPort = {
        assertAllowedBranch: vi.fn(async () => ok(undefined)),
        createBranch: vi.fn(async () => ok(undefined)),
        deleteBranch: vi.fn(async () => ok(undefined)),
        currentBranch: vi.fn(async () => ok("main")),
        aheadBehind: vi.fn(async () => ok({ ahead: 0, behind: 0 })),
        checkout: vi.fn(async () => ok(undefined)),
        hasUncommittedChanges: vi.fn(async () => ok(false)),
        stashSave: vi.fn(async () => ok(undefined)),
        restoreStash: vi.fn(async () => ok(undefined)),
        branchExistsLocally: vi.fn(async () => ok(true)),
        fetch: vi.fn(async () => ok(undefined)),
        pull: vi.fn(async () => ok(undefined)),
        mergeBranch: vi.fn(async () => ok(undefined)),
        abortMerge: vi.fn(async () => ok(undefined)),
        isMergeInProgress: vi.fn(async () => ok(false)),
        listDirtyPaths: vi.fn(async () => ok([])),
        discardPaths: vi.fn(async () => ok(undefined)),
        discardAll: vi.fn(async () => ok(undefined)),
        diffNameOnly: vi.fn(async () => ok([])),
        headRevision: vi.fn(async () => ok('head-a')),
        diffStat: vi.fn(async () => ok({ files: 0, insertions: 0, deletions: 0 })),
        discardPathsToHead: vi.fn(async () => ok(undefined)),
        isRebaseInProgress: vi.fn(async () => ok(false)),
        hasUnmergedPaths: vi.fn(async () => ok(false)),
        listUnmergedPaths: vi.fn(async () => ok([] as string[])),
        readWorktreeFile: vi.fn(async () => ok("")),
        writeResolvedFile: vi.fn(async () => ok(undefined)),
        checkoutSide: vi.fn(async () => ok(undefined)),
        finalizeMerge: vi.fn(async () => ok(undefined)),
        listBranches: vi.fn(async () => ok([])),
        renameBranch: vi.fn(async () => ok(undefined)),
        listRemoteBranches: vi.fn(async () => ok([])),
        createTrackingBranch: vi.fn(async () => ok(undefined)),
        stagePaths: vi.fn(async () => ok(undefined)),
        commit: vi.fn(async () => ok(undefined)),
        isBranchMerged: vi.fn(async () => ok(true)),
        hasStash: vi.fn(async () => ok(false)),
        fetchRemote: vi.fn(async () => ok(undefined)),
        listUnpushedCommits: vi.fn(async () => ok([] as string[])),
        listVersionBumpCommits: vi.fn(async () => ok({ endedBy: "exhausted" as const, scanned: 0 })),
        listBranchesContaining: vi.fn(async () => ok([] as string[])),
      };
      const store = createAppStore(fakeDeps({ git }));

      const result = await store.getState().renameBranch("/repo/a", "feature-old", "feature-new");

      expect(result).toEqual({ ok: true, data: undefined });
      expect(git.renameBranch).toHaveBeenCalledWith("/repo/a", "feature-old", "feature-new");
    });

    it("modifyEdt forwards a non-empty renameBranches param through to modifyEdtUseCase (reaches git.renameBranch)", async () => {
      const git: GitPort = {
        assertAllowedBranch: vi.fn(async () => ok(undefined)),
        createBranch: vi.fn(async () => ok(undefined)),
        deleteBranch: vi.fn(async () => ok(undefined)),
        currentBranch: vi.fn(async () => ok("main")),
        aheadBehind: vi.fn(async () => ok({ ahead: 0, behind: 0 })),
        checkout: vi.fn(async () => ok(undefined)),
        hasUncommittedChanges: vi.fn(async () => ok(false)),
        stashSave: vi.fn(async () => ok(undefined)),
        restoreStash: vi.fn(async () => ok(undefined)),
        branchExistsLocally: vi.fn(async () => ok(true)),
        fetch: vi.fn(async () => ok(undefined)),
        pull: vi.fn(async () => ok(undefined)),
        mergeBranch: vi.fn(async () => ok(undefined)),
        abortMerge: vi.fn(async () => ok(undefined)),
        isMergeInProgress: vi.fn(async () => ok(false)),
        listDirtyPaths: vi.fn(async () => ok([])),
        discardPaths: vi.fn(async () => ok(undefined)),
        discardAll: vi.fn(async () => ok(undefined)),
        diffNameOnly: vi.fn(async () => ok([])),
        headRevision: vi.fn(async () => ok('head-a')),
        diffStat: vi.fn(async () => ok({ files: 0, insertions: 0, deletions: 0 })),
        discardPathsToHead: vi.fn(async () => ok(undefined)),
        isRebaseInProgress: vi.fn(async () => ok(false)),
        hasUnmergedPaths: vi.fn(async () => ok(false)),
        listUnmergedPaths: vi.fn(async () => ok([] as string[])),
        readWorktreeFile: vi.fn(async () => ok("")),
        writeResolvedFile: vi.fn(async () => ok(undefined)),
        checkoutSide: vi.fn(async () => ok(undefined)),
        finalizeMerge: vi.fn(async () => ok(undefined)),
        listBranches: vi.fn(async () => ok([])),
        renameBranch: vi.fn(async () => ok(undefined)),
        listRemoteBranches: vi.fn(async () => ok([])),
        createTrackingBranch: vi.fn(async () => ok(undefined)),
        stagePaths: vi.fn(async () => ok(undefined)),
        commit: vi.fn(async () => ok(undefined)),
        isBranchMerged: vi.fn(async () => ok(true)),
        hasStash: vi.fn(async () => ok(false)),
        fetchRemote: vi.fn(async () => ok(undefined)),
        listUnpushedCommits: vi.fn(async () => ok([] as string[])),
        listVersionBumpCommits: vi.fn(async () => ok({ endedBy: "exhausted" as const, scanned: 0 })),
        listBranchesContaining: vi.fn(async () => ok([] as string[])),
      };
      const edtRegistry: EdtRegistryPort = {
        add: vi.fn(async () => ok(undefined)),
        list: vi.fn(async () =>
          ok([
            {
              ulid: "edt-1",
              topic: "demo",
              createdAt: "2026-08-19T00:00:00.000Z",
              status: "active" as const,
              members: [{ service: "svc-a", repoPath: "/repo/a", branch: "main" }],
            },
          ]),
        ),
        setStatus: vi.fn(async () => ok(undefined)),
        update: vi.fn(async () => ok(undefined)),
        remove: vi.fn(async () => ok(undefined)),
      };
      const store = createAppStore(fakeDeps({ git, edtRegistry }));

      const result = await store.getState().modifyEdt({
        topic: "demo",
        addMembers: [],
        removeMembers: [],
        setBranches: [],
        renameBranches: [{ repoPath: "/repo/a", newName: "feature-renamed" }],
      });

      expect(result.ok).toBe(true);
      // oldName ("main") is resolved by the core use case from this EDT's own membership —
      // proves renameBranches actually reached modifyEdtUseCase, not just accepted and dropped.
      expect(git.renameBranch).toHaveBeenCalledWith("/repo/a", "main", "feature-renamed");
    });
  });

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
              update: { concurrency: 3, runMigrations: true, cleanRestart: false, mergeSource: 'shared' as const }, sharedTypes: { install: true, cleanRestart: false, commit: true, historyDepth: 20, maxCommitsScanned: 1000 }, logs: { bufferSize: 500, startWithHistory: false, filterHistorySize: 20, filterHistoryGridMaxRows: 8, filterHistoryDedup: true, restartMode: 'simple' as const },
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
        update: { concurrency: 3, runMigrations: true, cleanRestart: false, mergeSource: 'shared' as const }, sharedTypes: { install: true, cleanRestart: false, commit: true, historyDepth: 20, maxCommitsScanned: 1000 }, logs: { bufferSize: 500, startWithHistory: false, filterHistorySize: 20, filterHistoryGridMaxRows: 8, filterHistoryDedup: true, restartMode: 'simple' as const },
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
        update: { concurrency: 3, runMigrations: true, cleanRestart: false, mergeSource: 'shared' as const }, sharedTypes: { install: true, cleanRestart: false, commit: true, historyDepth: 20, maxCommitsScanned: 1000 }, logs: { bufferSize: 500, startWithHistory: false, filterHistorySize: 20, filterHistoryGridMaxRows: 8, filterHistoryDedup: true, restartMode: 'simple' as const },
      });
    });

    it("updateSettings() merges a partial sharedTypes update, keeping the sibling keys", async () => {
      const store = createAppStore();
      await store.getState().updateSettings({ sharedTypes: { cleanRestart: true } });
      expect(store.getState().settings.sharedTypes).toEqual({ install: true, cleanRestart: true, commit: true, historyDepth: 20, maxCommitsScanned: 1000 });
    });

    it("updateSettings() shallow-merges only the provided sub-object, leaving the other untouched", async () => {
      const store = createAppStore(fakeDeps());
      store.setState({
        settings: {
          general: { quitShortcutEnabled: true, editorCommand: '' },
          commandPalette: { gridMaxRows: 20, historySize: 20, historyDedup: true },
          edts: { hiddenActionHints: ["edts"], hiddenActionTypes: [], branchDropdownMaxRows: 5 },
          update: { concurrency: 3, runMigrations: true, cleanRestart: false, mergeSource: 'shared' as const }, sharedTypes: { install: true, cleanRestart: false, commit: true, historyDepth: 20, maxCommitsScanned: 1000 }, logs: { bufferSize: 500, startWithHistory: false, filterHistorySize: 20, filterHistoryGridMaxRows: 8, filterHistoryDedup: true, restartMode: 'simple' as const },
        },
      });

      await store.getState().updateSettings({ edts: { hiddenActionHints: ["other-services"] } });

      expect(store.getState().settings).toEqual({
        general: { quitShortcutEnabled: true, editorCommand: '' },
        commandPalette: { gridMaxRows: 20, historySize: 20, historyDedup: true },
        edts: { hiddenActionHints: ["other-services"], hiddenActionTypes: [], branchDropdownMaxRows: 5 },
        update: { concurrency: 3, runMigrations: true, cleanRestart: false, mergeSource: 'shared' as const }, sharedTypes: { install: true, cleanRestart: false, commit: true, historyDepth: 20, maxCommitsScanned: 1000 }, logs: { bufferSize: 500, startWithHistory: false, filterHistorySize: 20, filterHistoryGridMaxRows: 8, filterHistoryDedup: true, restartMode: 'simple' as const },
      });
    });

    it("updateSettings() shallow-merges hiddenActionTypes independently of hiddenActionHints", async () => {
      const store = createAppStore(fakeDeps());
      store.setState({
        settings: {
          general: { quitShortcutEnabled: true, editorCommand: '' },
          commandPalette: { gridMaxRows: 20, historySize: 20, historyDedup: true },
          edts: { hiddenActionHints: ["edts"], hiddenActionTypes: ["modify"], branchDropdownMaxRows: 5 },
          update: { concurrency: 3, runMigrations: true, cleanRestart: false, mergeSource: 'shared' as const }, sharedTypes: { install: true, cleanRestart: false, commit: true, historyDepth: 20, maxCommitsScanned: 1000 }, logs: { bufferSize: 500, startWithHistory: false, filterHistorySize: 20, filterHistoryGridMaxRows: 8, filterHistoryDedup: true, restartMode: 'simple' as const },
        },
      });

      await store.getState().updateSettings({ edts: { hiddenActionTypes: ["create", "modify"] } });

      expect(store.getState().settings).toEqual({
        general: { quitShortcutEnabled: true, editorCommand: '' },
        commandPalette: { gridMaxRows: 20, historySize: 20, historyDedup: true },
        edts: { hiddenActionHints: ["edts"], hiddenActionTypes: ["create", "modify"], branchDropdownMaxRows: 5 },
        update: { concurrency: 3, runMigrations: true, cleanRestart: false, mergeSource: 'shared' as const }, sharedTypes: { install: true, cleanRestart: false, commit: true, historyDepth: 20, maxCommitsScanned: 1000 }, logs: { bufferSize: 500, startWithHistory: false, filterHistorySize: 20, filterHistoryGridMaxRows: 8, filterHistoryDedup: true, restartMode: 'simple' as const },
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
          update: { concurrency: 3, runMigrations: true, cleanRestart: false, mergeSource: 'shared' as const }, sharedTypes: { install: true, cleanRestart: false, commit: true, historyDepth: 20, maxCommitsScanned: 1000 }, logs: { bufferSize: 500, startWithHistory: false, filterHistorySize: 20, filterHistoryGridMaxRows: 8, filterHistoryDedup: true, restartMode: 'simple' as const },
        },
        warning: null,
      });
      await loading;

      expect(store.getState().settings.commandPalette.gridMaxRows).toBe(42);
    });
  });

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
});

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
    store.setState((current) => ({ settings: { ...current.settings, logs: { ...current.settings.logs, filterHistoryDedup: true, restartMode: 'simple' as const } } }));

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
