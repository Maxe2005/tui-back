// tui/zones/update: shared fixtures for the UpdateZone tests.
import { it, vi } from 'vitest';
import { render } from 'ink';
import { ok } from '../../../../../core/result.js';
import type { ServiceBranchDivergence } from '../../../../../core/edt/lifecycle/list.js';
import type { DockerPort } from '../../../../../core/ports/runtime/docker.js';
import type { EdtRegistryPort } from '../../../../../core/ports/storage/edt-registry.js';
import type { GitPort } from '../../../../../core/ports/vcs/git.js';
import type { LockPort } from '../../../../../core/ports/runtime/lock.js';
import type { ManifestPort } from '../../../../../core/ports/vcs/manifest.js';
import type { RegistryPort } from '../../../../../core/ports/storage/registry.js';
import type { SettingsPort } from '../../../../../core/ports/storage/settings.js';
import type { StatePort } from '../../../../../core/ports/storage/state.js';
import { DEFAULT_SETTINGS } from '../../../../../core/ports/storage/settings.js';
import { createAppStore, type AppStoreDeps } from '../../store/app-store.js';
import { UpdateZone } from './update-zone.js';

export const INTERRUPTED_EDTS = [
  {
    ulid: 'edt-1',
    topic: 'demo',
    createdAt: '2026-09-17T00:00:00.000Z',
    status: 'interrupted' as const,
    members: [{ service: 'svc-a', repoPath: '/repo/a', branch: 'feat/a' }],
  },
];

// The Update zone's always-visible service-list fixtures.
export const ACTIVE_EDT = {
  ulid: 'edt-1',
  topic: 'demo',
  createdAt: '2026-09-17T00:00:00.000Z',
  status: 'active' as const,
  members: [{ service: 'svc-a', repoPath: '/repo/a', branch: 'feat/a' }],
};

export const SERVICE_A: ServiceBranchDivergence = {
  service: 'svc-a',
  path: '/repo/a',
  isMember: true,
  sharedBranch: 'development',
  protectedBranches: [],
  branch: 'feat/a',
  ahead: 0,
  behind: 0,
  status: 'current',
};

export const SERVICE_B: ServiceBranchDivergence = {
  service: 'svc-b',
  path: '/repo/b',
  isMember: false,
  sharedBranch: 'development',
  protectedBranches: [],
  branch: 'development',
  ahead: 0,
  behind: 0,
  status: 'current',
};

export const LOADING_MEMBERS = 'Loading member services…';

// A no-op stub for every render test below: `createAppStore()` (no deps, the same default
// every other zone test uses) still owns *real* loadEdtsBranches/loadEdts actions that
// early-return an 'error'/no-op status when unwired — and UpdateZone calls both on mount.
// Left un-stubbed, those real calls would race the state each test deliberately seeds and
// clobber it out from under it (mirrors edts-zone.test.tsx's own noopLoad precedent).
export const noopLoad = async () => {};

// Every render test above uses a deps-less `createAppStore()`, under which `pollServiceHealth`
// early-returns whatever path it is given — so a poll keyed by `row.service` instead of
// `row.path` (`updateServiceHealth[row.path]` reads by path) would leave every row on the `down`
// fallback with zero failures. This block wires real (fake-port) deps, like update-slice.test.ts's
// health-polling fakeDeps, and mounts UpdateZone with a real Ink render loop.
export function fakeUpdateZoneDeps(overrides: Partial<AppStoreDeps> = {}): AppStoreDeps {
  const registry: RegistryPort = {
    list: vi.fn(async () => ok([])),
    add: vi.fn(async () => ok(undefined)),
    exists: vi.fn(async () => ok(true)),
    scan: vi.fn(async () => ok({ candidates: [], skipped: [] })),
    reset: vi.fn(async () => ok({ path: '/x', backupPath: null })),
    remove: vi.fn(async () => ok(undefined)),
  };
  const manifest: ManifestPort = {
    load: vi.fn(async (repoPath: string) =>
      ok({
        service: `svc-${repoPath.split('/').pop()}`,
        container: `ctr-${repoPath.split('/').pop()}`,
        migrationCommand: 'npm run migration:run',
        sharedBranch: 'development',
        modules: {},
      }),
    ),
  };
  const git: GitPort = {
    assertAllowedBranch: vi.fn(async () => ok(undefined)),
    createBranch: vi.fn(async () => ok(undefined)),
    deleteBranch: vi.fn(async () => ok(undefined)),
    currentBranch: vi.fn(async () => ok('feat/a')),
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
    isBranchMerged: vi.fn(async () => ok(true)),
    hasStash: vi.fn(async () => ok(false)),
    fetchRemote: vi.fn(async () => ok(undefined)),
    listUnpushedCommits: vi.fn(async () => ok([] as string[])),
    listVersionBumpCommits: vi.fn(async () => ok({ endedBy: "exhausted" as const, scanned: 0 })),
    listBranchesContaining: vi.fn(async () => ok([] as string[])),
    listRemoteBranches: vi.fn(async () => ok([])),
    createTrackingBranch: vi.fn(async () => ok(undefined)),
    stagePaths: vi.fn(async () => ok(undefined)),
    commit: vi.fn(async () => ok(undefined)),
  };
  const edtRegistry: EdtRegistryPort = {
    add: vi.fn(async () => ok(undefined)),
    list: vi.fn(async () => ok([])),
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
    acquire: vi.fn(async () => ok({ release: vi.fn(async () => ok(undefined)) })),
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
    edtRegistryResourceKey: '/tmp/edts.yaml',
    edtsBaseDir: '/tmp/edts',
    registryResourceKey: '/config/registry.yaml',
    settings,
    docker,
    ...overrides,
  };
}
