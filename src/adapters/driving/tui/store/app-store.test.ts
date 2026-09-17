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
import { DEFAULT_LIST_RATIO } from "../shared/components/list-detail-split.js";
import { createAppStore, NO_BRANCH_CREATION, type AppStoreDeps } from "./app-store.js";

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
    listBranches: vi.fn(async () => ok([])),
    renameBranch: vi.fn(async () => ok(undefined)),
  };
  const edtRegistry: EdtRegistryPort = {
    add: vi.fn(async () => ok(undefined)),
    list: vi.fn(async () => ok([] as EdtRegistryEntry[])),
    setStatus: vi.fn(async () => ok(undefined)),
    update: vi.fn(async () => ok(undefined)),
  };
  const state: StatePort = {
    readActiveEdt: vi.fn(async () => ok(null)),
    writeActiveEdt: vi.fn(async () => ok(undefined)),
    readSplitterRatios: vi.fn(async () => ok(null)),
    writeSplitterRatios: vi.fn(async () => ok(undefined)),
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
  };
  return {
    registry,
    manifest,
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
      expect(state.splitterRatios[zone.id]).toEqual(
        zone.id === "edts"
          ? [DEFAULT_LIST_RATIO, DEFAULT_LIST_RATIO, DEFAULT_LIST_RATIO]
          : [DEFAULT_LIST_RATIO],
      );
    }
  });

  it("defaults resizeMode to null (story 2.21)", () => {
    const store = createAppStore();
    expect(store.getState().resizeMode).toBeNull();
  });

  it("covers exactly the six compiled-in zones — no duplicate copy per zone (AC5)", () => {
    const store = createAppStore();
    const state = store.getState();
    expect(ZONES).toHaveLength(6);
    const zoneIds = ZONES.map((zone) => zone.id);
    expect(Object.keys(state.zoneEvents).sort()).toEqual([...zoneIds].sort());
    expect(Object.keys(state.splitterRatios).sort()).toEqual(
      [...zoneIds].sort(),
    );
  });

  it("switches the active zone and clears pending events for the visited zone (AC3)", () => {
    const store = createAppStore();
    store.getState().addZoneEvent("logs");
    store.getState().addZoneEvent("logs");
    expect(store.getState().zoneEvents.logs).toBe(2);
    store.getState().setActiveZone("logs");
    expect(store.getState().activeZone).toBe("logs");
    expect(store.getState().zoneEvents.logs).toBe(0);
  });

  it("adds pending background-event counts per zone independently (AC3)", () => {
    const store = createAppStore();
    store.getState().addZoneEvent("routes");
    store.getState().addZoneEvent("routes");
    store.getState().addZoneEvent("dashboard");
    expect(store.getState().zoneEvents.routes).toBe(2);
    expect(store.getState().zoneEvents.dashboard).toBe(1);
  });

  it("stores the splitter ratio per zone/boundary, clamped to keep both panes usable (AC4)", () => {
    const store = createAppStore();
    store.getState().setSplitterRatio("edts", 0, 0.5);
    expect(store.getState().splitterRatios.edts[0]).toBe(0.5);
    store.getState().setSplitterRatio("edts", 0, 1);
    expect(store.getState().splitterRatios.edts[0]).toBe(0.8);
    store.getState().setSplitterRatio("edts", 0, 0);
    expect(store.getState().splitterRatios.edts[0]).toBe(0.2);
    expect(store.getState().splitterRatios.dashboard[0]).toBe(DEFAULT_LIST_RATIO);
  });

  // Story 2.21: the EDTs zone has 3 independently movable boundaries — each setSplitterRatio
  // call only ever touches the one boundaryIndex it's given, never the other two.
  it("moves only the targeted boundary within a multi-boundary zone (story 2.21)", () => {
    const store = createAppStore();
    store.getState().setSplitterRatio("edts", 1, 0.7);
    expect(store.getState().splitterRatios.edts).toEqual([DEFAULT_LIST_RATIO, 0.7, DEFAULT_LIST_RATIO]);
    store.getState().setSplitterRatio("edts", 2, 0.3);
    expect(store.getState().splitterRatios.edts).toEqual([DEFAULT_LIST_RATIO, 0.7, 0.3]);
  });

  it("ignores an out-of-range boundaryIndex rather than writing a sparse array (story 2.21)", () => {
    const store = createAppStore();
    const before = store.getState().splitterRatios.dashboard;
    store.getState().setSplitterRatio("dashboard", 5, 0.5);
    expect(store.getState().splitterRatios.dashboard).toEqual(before);
  });

  describe("resizeMode (story 2.21, Ctrl+W keyboard resize-mode)", () => {
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

  describe("loadEdtsBranches (story 2.6, FR-9)", () => {
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

    it("populates edtsUnreachable/edtsErrors from the core use-case alongside edtsBranches (review patch)", async () => {
      const registry: RegistryPort = {
        list: vi.fn(async () => ok(["/repo/a", "/repo/gone", "/repo/bad"])),
        add: vi.fn(async () => ok(undefined)),
        exists: vi.fn(async (path: string) => ok(path !== "/repo/gone")),
        scan: vi.fn(async () => ok({ candidates: [], skipped: [] })),
        reset: vi.fn(async () => ok({ path: "/x", backupPath: null })),
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

  describe("loadTabVisibility (story 2.13)", () => {
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
      };
      const store = createAppStore(fakeDeps({ registry }));

      const first = store.getState().loadTabVisibility();
      const second = store.getState().loadTabVisibility();
      expect(registry.list).toHaveBeenCalledTimes(1);

      resolveList?.();
      await Promise.all([first, second]);
      expect(store.getState().tabVisibilityStatus).toBe("idle");
    });

    it("keeps the last known-good tabVisibility on a later reload failure (review-guard, mirrors edtsBranches' rule)", async () => {
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

  describe("active-EDT membership change reloads tabVisibility (story 2.13)", () => {
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

  // Story 2.22: the create-EDT dialog now always builds and supplies its own
  // CreateBranchOptions — the store must forward exactly what it's given through to
  // core/edt/create.ts rather than silently substituting its own hardcoded default.
  describe("createEdt passes branchOptions through unchanged (story 2.22)", () => {
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
        listBranches: vi.fn(async () => ok([])),
        renameBranch: vi.fn(async () => ok(undefined)),
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
        listBranches: vi.fn(async () => ok([])),
        renameBranch: vi.fn(async () => ok(undefined)),
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

  // Story 2.26: the branch-picker's own store actions and modifyEdt's renameBranches param
  // wrap real core exports (createMemberBranch/renameMemberBranch/listMemberBranches, and
  // modifyEdtUseCase itself) — every interaction test exercising the picker instead replaces
  // these actions wholesale via store.setState(...), so nothing else in the suite verifies
  // that the real wiring below actually reaches deps.git with the right arguments in order.
  describe("branch-picker store actions (story 2.26)", () => {
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
        listBranches: vi.fn(async () => ok(["main", "feature-x"])),
        renameBranch: vi.fn(async () => ok(undefined)),
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
        listBranches: vi.fn(async () => ok([])),
        renameBranch: vi.fn(async () => ok(undefined)),
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
        listBranches: vi.fn(async () => ok([])),
        renameBranch: vi.fn(async () => ok(undefined)),
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
        listBranches: vi.fn(async () => ok([])),
        renameBranch: vi.fn(async () => ok(undefined)),
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

  describe("settings slice (story 2.19)", () => {
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
              commandPalette: { gridMaxRows: 12 },
              edts: { hiddenActionHints: ["edts"], hiddenActionTypes: [] },
              logs: { bufferSize: 500 },
            },
            warning: "Invalid settings file /x/settings.yaml: (root) — bad shape — using defaults.",
          }),
        ),
        save: vi.fn(async () => ok(undefined)),
      };
      const store = createAppStore(fakeDeps({ settings }));

      await store.getState().loadSettings();

      expect(store.getState().settings).toEqual({
        commandPalette: { gridMaxRows: 12 },
        edts: { hiddenActionHints: ["edts"], hiddenActionTypes: [] },
        logs: { bufferSize: 500 },
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

    it("updateSettings() applies optimistically before persistence resolves, then persists (Boundaries: no separate save step)", async () => {
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
        commandPalette: { gridMaxRows: 15 },
        edts: { hiddenActionHints: [], hiddenActionTypes: [] },
        logs: { bufferSize: 500 },
      });
    });

    it("updateSettings() shallow-merges only the provided sub-object, leaving the other untouched", async () => {
      const store = createAppStore(fakeDeps());
      store.setState({
        settings: {
          commandPalette: { gridMaxRows: 20 },
          edts: { hiddenActionHints: ["edts"], hiddenActionTypes: [] },
          logs: { bufferSize: 500 },
        },
      });

      await store.getState().updateSettings({ edts: { hiddenActionHints: ["other-services"] } });

      expect(store.getState().settings).toEqual({
        commandPalette: { gridMaxRows: 20 },
        edts: { hiddenActionHints: ["other-services"], hiddenActionTypes: [] },
        logs: { bufferSize: 500 },
      });
    });

    it("updateSettings() shallow-merges hiddenActionTypes independently of hiddenActionHints (amended 2026-08-28)", async () => {
      const store = createAppStore(fakeDeps());
      store.setState({
        settings: {
          commandPalette: { gridMaxRows: 20 },
          edts: { hiddenActionHints: ["edts"], hiddenActionTypes: ["modify"] },
          logs: { bufferSize: 500 },
        },
      });

      await store.getState().updateSettings({ edts: { hiddenActionTypes: ["create", "modify"] } });

      expect(store.getState().settings).toEqual({
        commandPalette: { gridMaxRows: 20 },
        edts: { hiddenActionHints: ["edts"], hiddenActionTypes: ["create", "modify"] },
        logs: { bufferSize: 500 },
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
          commandPalette: { gridMaxRows: 8 },
          edts: { hiddenActionHints: [], hiddenActionTypes: [] },
          logs: { bufferSize: 500 },
        },
        warning: null,
      });
      await loading;

      expect(store.getState().settings.commandPalette.gridMaxRows).toBe(42);
    });
  });

  describe("splitterRatios persistence (story 2.21)", () => {
    it("setSplitterRatio() applies live before persistence resolves, then persists the whole ratios map (Boundaries: no separate save step)", async () => {
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

    it("loadSplitterRatios() on a genuine I/O error keeps the built-in defaults", async () => {
      const state: StatePort = {
        readActiveEdt: vi.fn(async () => ok(null)),
        writeActiveEdt: vi.fn(async () => ok(undefined)),
        readSplitterRatios: vi.fn(async () => err("state-invalid-json", "corrupt state.json")),
        writeSplitterRatios: vi.fn(async () => ok(undefined)),
      };
      const store = createAppStore(fakeDeps({ state }));

      await store.getState().loadSplitterRatios();

      expect(store.getState().splitterRatios.edts).toEqual([
        DEFAULT_LIST_RATIO,
        DEFAULT_LIST_RATIO,
        DEFAULT_LIST_RATIO,
      ]);
    });

    it("loadSplitterRatios() on a fresh/pre-2.21 machine (null) keeps the built-in defaults", async () => {
      const state: StatePort = {
        readActiveEdt: vi.fn(async () => ok(null)),
        writeActiveEdt: vi.fn(async () => ok(undefined)),
        readSplitterRatios: vi.fn(async () => ok(null)),
        writeSplitterRatios: vi.fn(async () => ok(undefined)),
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

    // Review fix (story 2.21, finding 4): mirrors the settingsVersion-guarded
    // "loadSettings() discards a stale result superseded by a newer updateSettings()" test
    // above — loadSplitterRatios() (AppShell's mount-time load) must never overwrite a live
    // setSplitterRatio() move (e.g. a Ctrl+W resize) that lands while the read is still in
    // flight with the stale pre-move value it read from disk.
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

describe("logs slice (story 5.1)", () => {
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

  it("openLogsFullscreen/closeLogsFullscreen set and clear logsFullscreenTarget/logsFullscreenServiceName without touching selection (I/O matrix FULLSCREEN_PREVIEW)", () => {
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

  it("subscribeLogsPane surfaces a docker-unavailable Result as this pane's own streamError (I/O matrix DOCKER_UNAVAILABLE)", async () => {
    const docker: DockerPort = {
      streamLogs: vi.fn((_container, _onLine, onError) => {
        onError({ code: "docker-unavailable", message: "docker daemon unreachable" });
        return () => {};
      }),
      fetchLogsBefore: vi.fn(async () => ok([])),
    };
    const store = createAppStore(fakeDeps({ docker }));

    await store.getState().subscribeLogsPane("/repo/a", "svc-a");

    expect(store.getState().logsPanes["/repo/a"]?.streamError).toEqual({
      code: "docker-unavailable",
      message: "docker daemon unreachable",
    });
  });

  it("unsubscribeLogsPane stops the stream and removes the pane entry (I/O matrix SELECTION_CHANGE: that stream stops, its pane is removed)", async () => {
    const stop = vi.fn();
    const docker: DockerPort = {
      streamLogs: vi.fn(() => stop),
      fetchLogsBefore: vi.fn(async () => ok([])),
    };
    const store = createAppStore(fakeDeps({ docker }));
    await store.getState().subscribeLogsPane("/repo/a", "svc-a");

    store.getState().unsubscribeLogsPane("/repo/a");

    expect(stop).toHaveBeenCalledTimes(1);
    expect(store.getState().logsPanes["/repo/a"]).toBeUndefined();
  });

  it("loadOlderLogsPane prepends older lines and bumps scrollOffset to preserve the viewport (I/O matrix SCROLLBACK_RELOAD)", async () => {
    const olderLine = { timestamp: "2025-12-31T23:59:00.000Z", stream: "stdout" as const, text: "older" };
    const docker: DockerPort = {
      streamLogs: vi.fn(() => () => {}),
      fetchLogsBefore: vi.fn(async () => ok([olderLine])),
    };
    const store = createAppStore(fakeDeps({ docker }));
    await store.getState().subscribeLogsPane("/repo/a", "svc-a");

    await store.getState().loadOlderLogsPane("/repo/a");

    expect(store.getState().logsPanes["/repo/a"]?.lines).toEqual([olderLine]);
    expect(store.getState().logsPanes["/repo/a"]?.scrollOffset).toBe(1);
  });

  it("loadOlderLogsPane surfaces a manifest.load failure as this pane's own streamError, instead of silently no-oping forever (review fix)", async () => {
    const manifest: ManifestPort = {
      load: vi
        .fn()
        .mockResolvedValueOnce(ok(manifestFor("/repo/a")))
        .mockResolvedValueOnce(err("manifest-not-found", "no manifest here")),
    };
    const docker: DockerPort = {
      streamLogs: vi.fn(() => () => {}),
      fetchLogsBefore: vi.fn(async () => ok([])),
    };
    const store = createAppStore(fakeDeps({ docker, manifest }));
    await store.getState().subscribeLogsPane("/repo/a", "svc-a");

    await store.getState().loadOlderLogsPane("/repo/a");

    expect(store.getState().logsPanes["/repo/a"]?.streamError).toEqual({
      code: "manifest-not-found",
      message: "no manifest here",
    });
  });

  it("loadOlderLogsPane on a fetch failure sets noMoreHistory without erroring (I/O matrix: fetch fails -> scrolling stops at the edge)", async () => {
    const docker: DockerPort = {
      streamLogs: vi.fn(() => () => {}),
      fetchLogsBefore: vi.fn(async () => err("docker-unavailable", "daemon down")),
    };
    const store = createAppStore(fakeDeps({ docker }));
    await store.getState().subscribeLogsPane("/repo/a", "svc-a");

    await store.getState().loadOlderLogsPane("/repo/a");

    expect(store.getState().logsPanes["/repo/a"]?.noMoreHistory).toBe(true);
  });

  it("setLogsPaneScrollOffset clamps to [0, lines.length - 1]", async () => {
    const docker: DockerPort = {
      streamLogs: vi.fn((_container, onLine) => {
        onLine({ timestamp: "2026-01-01T00:00:00.000Z", stream: "stdout", text: "one" });
        onLine({ timestamp: "2026-01-01T00:00:01.000Z", stream: "stdout", text: "two" });
        return () => {};
      }),
      fetchLogsBefore: vi.fn(async () => ok([])),
    };
    const store = createAppStore(fakeDeps({ docker }));
    await store.getState().subscribeLogsPane("/repo/a", "svc-a");

    store.getState().setLogsPaneScrollOffset("/repo/a", 100);
    expect(store.getState().logsPanes["/repo/a"]?.scrollOffset).toBe(1);

    store.getState().setLogsPaneScrollOffset("/repo/a", -5);
    expect(store.getState().logsPanes["/repo/a"]?.scrollOffset).toBe(0);
  });

  it("stopAllLogsPanes stops every active pane's stream and clears all pane state (process-exit teardown fallback, review fix)", async () => {
    const stopA = vi.fn();
    const stopB = vi.fn();
    const docker: DockerPort = {
      streamLogs: vi
        .fn()
        .mockImplementationOnce(() => stopA)
        .mockImplementationOnce(() => stopB),
      fetchLogsBefore: vi.fn(async () => ok([])),
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
  });
});
