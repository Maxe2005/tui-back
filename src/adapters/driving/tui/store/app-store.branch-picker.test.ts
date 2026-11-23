import { describe, it, expect, vi } from "vitest";
import { ok } from "../../../../core/result.js";
import type { EdtRegistryPort } from "../../../../core/ports/storage/edt-registry.js";
import type { GitPort } from "../../../../core/ports/vcs/git.js";
import { createAppStore } from "./app-store.js";
import { fakeDeps } from "./store.test-support.js";

describe("app store", () => {
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

      const result = await store.getState().renameBranch("/repo/a", "feature-old", "feature-new", "EDT1");

      expect(result).toEqual({ ok: true, data: undefined });
      expect(git.renameBranch).toHaveBeenCalledWith("/repo/a", "feature-old", "feature-new", "EDT1");
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
      expect(git.renameBranch).toHaveBeenCalledWith("/repo/a", "main", "feature-renamed", "edt-1");
    });
  });
});
