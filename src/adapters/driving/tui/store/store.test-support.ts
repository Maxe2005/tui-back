import { vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ok } from "../../../../core/result.js";
import type { EdtRegistryEntry, EdtRegistryPort } from "../../../../core/ports/storage/edt-registry.js";
import type { GitPort } from "../../../../core/ports/vcs/git.js";
import type { LockPort } from "../../../../core/ports/runtime/lock.js";
import type { Manifest, ManifestPort } from "../../../../core/ports/vcs/manifest.js";
import type { RegistryPort } from "../../../../core/ports/storage/registry.js";
import type { StatePort } from "../../../../core/ports/storage/state.js";
import { DEFAULT_SETTINGS, type SettingsPort } from "../../../../core/ports/storage/settings.js";
import type { DockerPort } from "../../../../core/ports/runtime/docker.js";
import { ZONE_LAYOUTS } from "../zones/zone-layouts.js";
import { type AppStoreDeps } from "./app-store.js";

export const DEFAULT_LIST_RATIO = ZONE_LAYOUTS.dashboard.boundaries[0]!.defaultRatio;

export function manifestFor(repoPath: string): Manifest {
  const name = repoPath.split("/").pop();
  return {
    service: `svc-${name}`,
    container: `ctr-${name}`,
    migrationCommand: "npm run migration:run",
    sharedBranch: "development",
    modules: {},
  };
}

export function fakeDeps(overrides: Partial<AppStoreDeps> = {}): AppStoreDeps {
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
    readLogRules: vi.fn(async () => ok(null)),
    writeLogRules: vi.fn(async () => ok(undefined)),
    readLogRuleSets: vi.fn(async () => ok(null)),
    writeLogRuleSets: vi.fn(async () => ok(undefined)),
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

export const tmpDirs: string[] = [];

export async function removeTmpDirs(): Promise<void> {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

export async function makeEdtsBaseDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tui-back-app-store-createedt-"));
  tmpDirs.push(dir);
  return dir;
}
