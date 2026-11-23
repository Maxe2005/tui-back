import { describe, it, expect, vi, afterEach } from "vitest";
import { ok, err } from "../../../../core/result.js";
import type { EdtRegistryEntry, EdtRegistryPort } from "../../../../core/ports/storage/edt-registry.js";
import type { GitPort } from "../../../../core/ports/vcs/git.js";
import type { ManifestPort } from "../../../../core/ports/vcs/manifest.js";
import type { RegistryPort } from "../../../../core/ports/storage/registry.js";
import type { StatePort } from "../../../../core/ports/storage/state.js";
import { createAppStore, NO_BRANCH_CREATION } from "./app-store.js";
import { manifestFor, fakeDeps, makeEdtsBaseDir, removeTmpDirs } from "./store.test-support.js";

afterEach(removeTmpDirs);

describe("app store", () => {
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
        readLogRules: vi.fn(async () => ok(null)),
        writeLogRules: vi.fn(async () => ok(undefined)),
        readLogRuleSets: vi.fn(async () => ok(null)),
        writeLogRuleSets: vi.fn(async () => ok(undefined)),
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
  // must forward exactly what it's given to core/workspace/edt/lifecycle/create.ts, never substitute a default.
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
});
