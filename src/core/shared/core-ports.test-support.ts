// Fake ports and builders shared by the core use-case tests (group-update, switch).
import { vi, type Mock } from 'vitest';
import { ok } from '../result.js';
import type { ContainerPort } from '../ports/container.js';
import type { EdtMember, EdtRegistryEntry, EdtRegistryPort, EdtStatus } from '../ports/edt-registry.js';
import type { GitPort } from '../ports/git.js';
import type { LockPort } from '../ports/lock.js';
import type { Manifest, ManifestPort } from '../ports/manifest.js';
import type { MigrationPort } from '../ports/migration.js';
import type { RestartPort } from '../ports/restart.js';
import type { RegistryPort } from '../ports/registry.js';
import type { StatePort } from '../ports/state.js';

export function calls(fn: unknown): Array<unknown[]> {
  return (fn as unknown as Mock).mock.calls;
}

export function manifestFor(service: string, container: string = `ctr-${service}`): Manifest {
  return {
    service,
    container,
    migrationCommand: 'npm run migration:run',
    sharedBranch: 'development',
    modules: {},
  };
}

export function fakeManifest(
  overrides: Partial<ManifestPort> = {},
  manifestOf: (repoPath: string) => Manifest = (repoPath) => manifestFor(repoPath.split('/').pop() ?? repoPath),
): ManifestPort {
  return {
    load: vi.fn(async (repoPath: string) => ok(manifestOf(repoPath))),
    ...overrides,
  };
}

export function fakeGit(overrides: Partial<GitPort> = {}): GitPort {
  return {
    assertAllowedBranch: vi.fn(async () => ok(undefined)),
    createBranch: vi.fn(async () => ok(undefined)),
    deleteBranch: vi.fn(async () => ok(undefined)),
    currentBranch: vi.fn(async () => ok('development')),
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
    ...overrides,
  };
}

export function fakeContainer(overrides: Partial<ContainerPort> = {}): ContainerPort {
  return {
    restart: vi.fn(async () => ok(undefined)),
    ...overrides,
  };
}

export function fakeMigration(overrides: Partial<MigrationPort> = {}): MigrationPort {
  return {
    run: vi.fn(async () => ok({ output: '' })),
    ...overrides,
  };
}

export function fakeRestart(overrides: Partial<RestartPort> = {}): RestartPort {
  return {
    run: vi.fn(async () => ok({ output: '' })),
    ...overrides,
  };
}

export function fakeEdtRegistry(overrides: Partial<EdtRegistryPort> = {}): EdtRegistryPort {
  return {
    add: vi.fn(async () => ok(undefined)),
    list: vi.fn(async () => ok([])),
    setStatus: vi.fn(async () => ok(undefined)),
    update: vi.fn(async () => ok(undefined)),
    remove: vi.fn(async () => ok(undefined)),
    ...overrides,
  };
}

export function fakeLock(overrides: Partial<LockPort> = {}): LockPort {
  return {
    acquire: vi.fn(async () => ok({ release: vi.fn(async () => ok(undefined)) })),
    peek: vi.fn(async () => ok({ locked: false })),
    ...overrides,
  };
}

export function fakeState(overrides: Partial<StatePort> = {}): StatePort {
  return {
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
    ...overrides,
  };
}

export function fakeRegistry(paths: string[] = [], overrides: Partial<RegistryPort> = {}): RegistryPort {
  return {
    list: vi.fn(async () => ok(paths)),
    add: vi.fn(async () => ok(undefined)),
    exists: vi.fn(async () => ok(true)),
    scan: vi.fn(async () => ok({ candidates: [], skipped: [] })),
    reset: vi.fn(async () => ok({ path: '/p', backupPath: null })),
    remove: vi.fn(async () => ok(undefined)),
    ...overrides,
  };
}

export function member(service: string, repoPath: string, branch: string): EdtMember {
  return { service, repoPath, branch };
}

export function edtEntry(ulid: string, topic: string, members: EdtMember[], status: EdtStatus = 'active'): EdtRegistryEntry {
  return { ulid, topic, createdAt: '2026-09-17T00:00:00.000Z', status, members };
}
