// tui/store/slices/edt-slice: unit tests for the switch dirty-repo confirm seam (bug fix) —
// the slice calls the real core/edt/switch.ts use-case against fake ports (AD-2 in-process),
// so these verify the wiring (switchDirtyRepos raised/cleared, resolveSwitchDirtyRepos
// resuming the paused core call) rather than re-testing switchActiveEdt's own matrix, already
// covered in core/edt/switch.test.ts. Mirrors update-slice.test.ts's onUpdateBlocker tests.
import { describe, expect, it, vi } from 'vitest';
import { ok, err } from '../../../../../core/result.js';
import type { DockerPort } from '../../../../../core/ports/docker.js';
import type { EdtRegistryPort } from '../../../../../core/ports/edt-registry.js';
import type { GitPort } from '../../../../../core/ports/git.js';
import type { LockPort } from '../../../../../core/ports/lock.js';
import type { ManifestPort } from '../../../../../core/ports/manifest.js';
import type { RegistryPort } from '../../../../../core/ports/registry.js';
import type { SettingsPort } from '../../../../../core/ports/settings.js';
import type { StatePort } from '../../../../../core/ports/state.js';
import { DEFAULT_SETTINGS } from '../../../../../core/ports/settings.js';
import { createAppStore, type AppStoreDeps } from '../app-store.js';

const TARGET_MEMBER = { service: 'svc-a', repoPath: '/repo/a', branch: 'feat/a' };
const OUTGOING_MEMBER = { service: 'svc-c', repoPath: '/repo/c', branch: 'feat/c' };
const REPOS = ['/repo/a', '/repo/b', '/repo/c'];

function fakeDeps(overrides: Partial<AppStoreDeps> = {}): AppStoreDeps {
  const registry: RegistryPort = {
    list: vi.fn(async () => ok(REPOS)),
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
    isRebaseInProgress: vi.fn(async () => ok(false)),
    hasUnmergedPaths: vi.fn(async () => ok(false)),
    finalizeMerge: vi.fn(async () => ok(undefined)),
    listBranches: vi.fn(async () => ok([])),
    renameBranch: vi.fn(async () => ok(undefined)),
    listRemoteBranches: vi.fn(async () => ok([])),
    createTrackingBranch: vi.fn(async () => ok(undefined)),
    isBranchMerged: vi.fn(async () => ok(true)),
    hasStash: vi.fn(async () => ok(false)),
  };
  const edtRegistry: EdtRegistryPort = {
    add: vi.fn(async () => ok(undefined)),
    list: vi.fn(async () =>
      ok([
        {
          ulid: 'target-ulid',
          topic: 'target-topic',
          createdAt: '2026-09-17T00:00:00.000Z',
          status: 'inactive' as const,
          members: [TARGET_MEMBER],
        },
        {
          ulid: 'outgoing-ulid',
          topic: 'outgoing-topic',
          createdAt: '2026-09-17T00:00:00.000Z',
          status: 'active' as const,
          members: [OUTGOING_MEMBER],
        },
      ]),
    ),
    setStatus: vi.fn(async () => ok(undefined)),
    update: vi.fn(async () => ok(undefined)),
    remove: vi.fn(async () => ok(undefined)),
  };
  const state: StatePort = {
    readActiveEdt: vi.fn(async () => ok('outgoing-ulid')),
    writeActiveEdt: vi.fn(async () => ok(undefined)),
    readSplitterRatios: vi.fn(async () => ok(null)),
    writeSplitterRatios: vi.fn(async () => ok(undefined)),
    readFilterHistory: vi.fn(async () => ok(null)),
    writeFilterHistory: vi.fn(async () => ok(undefined)),
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
    git,
    docker,
    edtRegistry,
    state,
    lock,
    registryResourceKey: '/config/registry.yaml',
    edtRegistryResourceKey: '/tmp/edts.yaml',
    edtsBaseDir: '/tmp/edts',
    settings,
    ...overrides,
  };
}

describe('edt slice — switch dirty-repo confirm seam (bug fix)', () => {
  it('starts with no raised dirty preview', () => {
    const store = createAppStore(fakeDeps());

    expect(store.getState().switchDirtyRepos).toBeNull();
  });

  it('raises switchDirtyRepos on a dirty non-member and resumes the switch on resolveSwitchDirtyRepos("proceed")', async () => {
    const git: GitPort = {
      ...(fakeDeps().git as GitPort),
      hasUncommittedChanges: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/b')),
    };
    const store = createAppStore(fakeDeps({ git }));

    const run = store.getState().switchEdt({ topic: 'target-topic' });
    await vi.waitFor(() => {
      expect(store.getState().switchDirtyRepos).toEqual([{ service: 'svc-b', repoPath: '/repo/b', scope: 'non-member' }]);
    });

    store.getState().resolveSwitchDirtyRepos('proceed');
    const result = await run;

    expect(result.ok).toBe(true);
    expect(store.getState().switchDirtyRepos).toBeNull();
    expect(store.getState().activeEdt).toBe('target-ulid');
  });

  it('a "cancel" choice settles as switch-cancelled-by-user, clears the preview, and never touches activeEdt', async () => {
    const git: GitPort = {
      ...(fakeDeps().git as GitPort),
      hasUncommittedChanges: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/b')),
    };
    const state: StatePort = {
      ...(fakeDeps().state as StatePort),
      readActiveEdt: vi.fn(async () => ok('outgoing-ulid')),
    };
    const store = createAppStore(fakeDeps({ git, state }));

    const run = store.getState().switchEdt({ topic: 'target-topic' });
    await vi.waitFor(() => {
      expect(store.getState().switchDirtyRepos).not.toBeNull();
    });

    store.getState().resolveSwitchDirtyRepos('cancel');
    const result = await run;

    expect(result).toMatchObject({ ok: false, error: { code: 'switch-cancelled-by-user' } });
    expect(store.getState().switchDirtyRepos).toBeNull();
    // activeEdt is only ever set inside the `result.ok` branch — a cancelled switch must
    // never flip the store's cached pointer.
    expect(store.getState().activeEdt).toBeNull();
    expect(calls(state.writeActiveEdt)).toHaveLength(0);
  });

  it('resolveSwitchDirtyRepos with no raised preview is a no-op, never a throw', () => {
    const store = createAppStore(fakeDeps());

    store.getState().resolveSwitchDirtyRepos('proceed');

    expect(store.getState().switchDirtyRepos).toBeNull();
  });

  it('never raises the preview when every repo is clean — switchEdt resolves directly', async () => {
    const store = createAppStore(fakeDeps());

    const result = await store.getState().switchEdt({ topic: 'target-topic' });

    expect(result.ok).toBe(true);
    expect(store.getState().switchDirtyRepos).toBeNull();
  });
});

function calls(fn: unknown): Array<unknown[]> {
  return (fn as unknown as { mock: { calls: unknown[][] } }).mock.calls;
}
