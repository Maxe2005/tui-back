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
import { ZONES } from "../zones/zones.js";
import { DEFAULT_LIST_RATIO } from "../shared/components/list-detail-split.js";
import { createAppStore, type AppStoreDeps } from "./app-store.js";

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
      expect(state.splitterRatios[zone.id]).toBe(DEFAULT_LIST_RATIO);
    }
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

  it("stores the splitter ratio per zone, clamped to keep both panes usable (AC4)", () => {
    const store = createAppStore();
    store.getState().setSplitterRatio("edts", 0.5);
    expect(store.getState().splitterRatios.edts).toBe(0.5);
    store.getState().setSplitterRatio("edts", 1);
    expect(store.getState().splitterRatios.edts).toBe(0.8);
    store.getState().setSplitterRatio("edts", 0);
    expect(store.getState().splitterRatios.edts).toBe(0.2);
    expect(store.getState().splitterRatios.dashboard).toBe(DEFAULT_LIST_RATIO);
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

      const result = await store.getState().createEdt({ topic: "demo", members: ["/repo/a"] });

      expect(result.ok).toBe(true);
      expect(loadTabVisibility).toHaveBeenCalled();
    });

    it("createEdt failure (e.g. zero members) never triggers a reload", async () => {
      const store = createAppStore(fakeDeps());
      const loadTabVisibility = vi.fn(async () => {});
      store.setState({ loadTabVisibility });

      const result = await store.getState().createEdt({ topic: "demo", members: [] });

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
      });
    });

    it("updateSettings() shallow-merges only the provided sub-object, leaving the other untouched", async () => {
      const store = createAppStore(fakeDeps());
      store.setState({
        settings: {
          commandPalette: { gridMaxRows: 20 },
          edts: { hiddenActionHints: ["edts"], hiddenActionTypes: [] },
        },
      });

      await store.getState().updateSettings({ edts: { hiddenActionHints: ["other-services"] } });

      expect(store.getState().settings).toEqual({
        commandPalette: { gridMaxRows: 20 },
        edts: { hiddenActionHints: ["other-services"], hiddenActionTypes: [] },
      });
    });

    it("updateSettings() shallow-merges hiddenActionTypes independently of hiddenActionHints (amended 2026-08-28)", async () => {
      const store = createAppStore(fakeDeps());
      store.setState({
        settings: {
          commandPalette: { gridMaxRows: 20 },
          edts: { hiddenActionHints: ["edts"], hiddenActionTypes: ["modify"] },
        },
      });

      await store.getState().updateSettings({ edts: { hiddenActionTypes: ["create", "modify"] } });

      expect(store.getState().settings).toEqual({
        commandPalette: { gridMaxRows: 20 },
        edts: { hiddenActionHints: ["edts"], hiddenActionTypes: ["create", "modify"] },
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
        settings: { commandPalette: { gridMaxRows: 8 }, edts: { hiddenActionHints: [], hiddenActionTypes: [] } },
        warning: null,
      });
      await loading;

      expect(store.getState().settings.commandPalette.gridMaxRows).toBe(42);
    });
  });
});
