// tui/store/slices/edt-slice: unit tests for the switch dirty-repo seam — the slice calls the
// real core/edt/switch.ts use-case against fake ports, so these verify the wiring (preview
// raised/cleared, resolveSwitchDirtyRepos resuming the paused core call) rather than
// re-testing switchActiveEdt itself. Mirrors update-slice.test.ts's onUpdateBlocker tests.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
    readCommandHistory: vi.fn(async () => ok(null)),
    writeCommandHistory: vi.fn(async () => ok(undefined)),
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

describe('edt slice — switch dirty-repo seam', () => {
  it('starts with no raised dirty preview', () => {
    const store = createAppStore(fakeDeps());

    expect(store.getState().switchDirtyRepos).toBeNull();
  });

  it('raises switchDirtyRepos on a dirty non-member and resumes the switch on a proceed choice carrying resolutions', async () => {
    const git: GitPort = {
      ...(fakeDeps().git as GitPort),
      hasUncommittedChanges: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/b')),
      listDirtyPaths: vi.fn(async () => ok(['junk.txt'])),
    };
    const store = createAppStore(fakeDeps({ git }));

    const run = store.getState().switchEdt({ topic: 'target-topic' });
    await vi.waitFor(() => {
      expect(store.getState().switchDirtyRepos).toEqual([
        {
          service: 'svc-b',
          repoPath: '/repo/b',
          scope: 'non-member',
          currentBranch: 'development',
          currentBranchShared: true,
          sharedBranch: 'development',
          protectedBranches: [],
          owningEdtTopics: [],
          dirtyPaths: ['junk.txt'],
        },
      ]);
    });

    store.getState().resolveSwitchDirtyRepos({ kind: 'proceed', resolutions: { '/repo/b': { kind: 'discard' } } });
    const result = await run;

    expect(result.ok).toBe(true);
    expect(calls(git.discardAll)).toEqual([['/repo/b']]);
    expect(store.getState().switchDirtyRepos).toBeNull();
    expect(store.getState().activeEdt).toBe('target-ulid');
  });

  it('a proceed payload carrying an adopt resolution reaches core: branch created, repo adopted into the outgoing EDT', async () => {
    const git: GitPort = {
      ...(fakeDeps().git as GitPort),
      hasUncommittedChanges: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/b')),
    };
    const deps = fakeDeps({ git });
    const store = createAppStore(deps);

    const run = store.getState().switchEdt({ topic: 'target-topic' });
    await vi.waitFor(() => {
      expect(store.getState().switchDirtyRepos).not.toBeNull();
    });

    store.getState().resolveSwitchDirtyRepos({ kind: 'proceed', resolutions: { '/repo/b': { kind: 'adopt', branch: 'outgoing-topic' } } });
    const result = await run;

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.results).toContainEqual({
        service: 'svc-b',
        outcome: 'adopted',
        detail: expect.objectContaining({ code: 'adopted', adoptedBranch: 'outgoing-topic' }),
      });
    }
    expect(calls(git.createBranch)).toEqual([['/repo/b', 'outgoing-topic', 'development']]);
    expect(calls(deps.edtRegistry.update)).toHaveLength(1);
  });

  it('a cancel choice settles as switch-cancelled-by-user, clears the preview, and never touches activeEdt', async () => {
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

    store.getState().resolveSwitchDirtyRepos({ kind: 'cancel' });
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

    store.getState().resolveSwitchDirtyRepos({ kind: 'cancel' });

    expect(store.getState().switchDirtyRepos).toBeNull();
  });

  it('never raises the preview when every repo is clean — switchEdt resolves directly', async () => {
    const store = createAppStore(fakeDeps());

    const result = await store.getState().switchEdt({ topic: 'target-topic' });

    expect(result.ok).toBe(true);
    expect(store.getState().switchDirtyRepos).toBeNull();
  });
});

describe('edt slice — update-in-progress lock', () => {
  it('switchEdt and activateEdt are refused while a group update runs, touching nothing', async () => {
    const deps = fakeDeps();
    const store = createAppStore(deps);
    store.setState({ updateStatus: 'running' });

    const switched = await store.getState().switchEdt({ topic: 'target-topic' });
    const activated = await store.getState().activateEdt({ topic: 'target-topic' });

    expect(switched).toMatchObject({ ok: false, error: { code: 'update-in-progress' } });
    expect(activated).toMatchObject({ ok: false, error: { code: 'update-in-progress' } });
    expect(deps.state.writeActiveEdt).not.toHaveBeenCalled();
  });

  it('switchEdt works again once the run is over', async () => {
    const store = createAppStore(fakeDeps());
    store.setState({ updateStatus: 'done' });

    expect((await store.getState().switchEdt({ topic: 'target-topic' })).ok).toBe(true);
  });
});

function calls(fn: unknown): Array<unknown[]> {
  return (fn as unknown as { mock: { calls: unknown[][] } }).mock.calls;
}

describe('edt slice — create wizard Step 3 wiring', () => {
  it('listCreateBranches returns the local and remote-tracking lists through core', async () => {
    const deps = fakeDeps();
    (deps.git.listBranches as ReturnType<typeof vi.fn>).mockImplementation(async () => ok(['main']));
    (deps.git.listRemoteBranches as ReturnType<typeof vi.fn>).mockImplementation(async () => ok(['origin/main']));
    const store = createAppStore(deps);
    const result = await store.getState().listCreateBranches('/repo/a');
    expect(result).toEqual({ ok: true, data: { local: ['main'], remote: ['origin/main'] } });
    expect(deps.git.fetch).not.toHaveBeenCalled();
  });

  it('listCreateBranches surfaces a list failure', async () => {
    const deps = fakeDeps();
    (deps.git.listRemoteBranches as ReturnType<typeof vi.fn>).mockImplementation(async () => err('git-error', 'boom'));
    const store = createAppStore(deps);
    const result = await store.getState().listCreateBranches('/repo/a');
    expect(result.ok).toBe(false);
  });

  it('listCreateBranches on an unwired store is a store-not-wired error, never a throw', async () => {
    const result = await createAppStore().getState().listCreateBranches('/repo/a');
    expect(result).toEqual({ ok: false, error: { code: 'store-not-wired', message: 'No ports wired into the TUI store' } });
  });

  it('createEdt forwards memberPlans to core without any branchOptions', async () => {
    const edtsBaseDir = await mkdtemp(join(tmpdir(), 'tui-back-edt-slice-'));
    try {
      const deps = fakeDeps({ edtsBaseDir });
      (deps.edtRegistry.list as ReturnType<typeof vi.fn>).mockImplementation(async () => ok([]));
      const store = createAppStore(deps);
      const result = await store.getState().createEdt({
        topic: 'auth-flow',
        members: ['/repo/a'],
        memberPlans: { '/repo/a': { kind: 'create', base: 'origin/rel', name: 'auth-flow' } },
      });
      expect(result.ok).toBe(true);
      expect(deps.git.createBranch).toHaveBeenCalledWith('/repo/a', 'auth-flow', 'origin/rel');
    } finally {
      await rm(edtsBaseDir, { recursive: true, force: true });
    }
  });
});

describe('edt slice — create never activates, activateEdt does', () => {
  it('createEdt never writes state.json nor flips the cached active pointer', async () => {
    const edtsBaseDir = await mkdtemp(join(tmpdir(), 'tui-back-edt-slice-'));
    try {
      const deps = fakeDeps({ edtsBaseDir });
      (deps.edtRegistry.list as ReturnType<typeof vi.fn>).mockImplementation(async () => ok([]));
      const store = createAppStore(deps);
      const result = await store.getState().createEdt({
        topic: 'auth-flow',
        members: ['/repo/a'],
        memberPlans: { '/repo/a': { kind: 'create', base: 'development', name: 'auth-flow' } },
      });
      expect(result.ok).toBe(true);
      expect(deps.state.writeActiveEdt).not.toHaveBeenCalled();
      expect(store.getState().activeEdt).toBeNull();
    } finally {
      await rm(edtsBaseDir, { recursive: true, force: true });
    }
  });

  it('activateEdt on the first EDT sets the cached active pointer on success', async () => {
    const deps = fakeDeps();
    (deps.state.readActiveEdt as ReturnType<typeof vi.fn>).mockImplementation(async () => ok(null));
    const store = createAppStore(deps);

    const result = await store.getState().activateEdt({ topic: 'target-topic' });

    expect(result).toMatchObject({ ok: true, data: { status: 'activated', ulid: 'target-ulid' } });
    expect(deps.state.writeActiveEdt).toHaveBeenCalledWith('target-ulid');
    expect(store.getState().activeEdt).toBe('target-ulid');
  });

  it('a blocked activation changes nothing and forwards the overwrite map', async () => {
    const deps = fakeDeps();
    (deps.state.readActiveEdt as ReturnType<typeof vi.fn>).mockImplementation(async () => ok(null));
    (deps.git.currentBranch as ReturnType<typeof vi.fn>).mockImplementation(async () => ok('main'));
    (deps.git.listDirtyPaths as ReturnType<typeof vi.fn>).mockImplementation(async (repoPath: string) =>
      ok(repoPath === '/repo/a' ? ['a.ts', 'b.ts'] : []),
    );
    (deps.git.diffNameOnly as ReturnType<typeof vi.fn>).mockImplementation(async () => ok(['a.ts', 'b.ts']));
    const store = createAppStore(deps);

    const result = await store.getState().activateEdt({ topic: 'target-topic', overwrite: { '/repo/a': ['a.ts'] } });

    expect(result).toMatchObject({ ok: true, data: { status: 'blocked' } });
    expect(deps.state.writeActiveEdt).not.toHaveBeenCalled();
    expect(deps.git.checkout).not.toHaveBeenCalled();
    expect(store.getState().activeEdt).toBeNull();

    // The same call with every at-risk path confirmed proceeds and discards exactly the map's
    // paths — proof the overwrite map reached the use-case.
    const confirmed = await store.getState().activateEdt({ topic: 'target-topic', overwrite: { '/repo/a': ['a.ts', 'b.ts'] } });
    expect(confirmed).toMatchObject({ ok: true, data: { status: 'activated' } });
    expect(deps.git.discardPathsToHead).toHaveBeenCalledWith('/repo/a', ['a.ts', 'b.ts']);
  });

  it('an activated result reloads tab visibility; a blocked one does not', async () => {
    const deps = fakeDeps();
    (deps.state.readActiveEdt as ReturnType<typeof vi.fn>).mockImplementation(async () => ok(null));
    (deps.git.currentBranch as ReturnType<typeof vi.fn>).mockImplementation(async () => ok('main'));
    (deps.git.listDirtyPaths as ReturnType<typeof vi.fn>).mockImplementation(async (repoPath: string) => ok(repoPath === '/repo/a' ? ['a.ts'] : []));
    (deps.git.diffNameOnly as ReturnType<typeof vi.fn>).mockImplementation(async () => ok(['a.ts']));
    const store = createAppStore(deps);
    const loadTabVisibility = vi.fn(async () => {});
    store.setState({ loadTabVisibility });

    const blocked = await store.getState().activateEdt({ topic: 'target-topic' });
    expect(blocked).toMatchObject({ ok: true, data: { status: 'blocked' } });
    expect(loadTabVisibility).not.toHaveBeenCalled();

    const activated = await store.getState().activateEdt({ topic: 'target-topic', overwrite: { '/repo/a': ['a.ts'] } });
    expect(activated).toMatchObject({ ok: true, data: { status: 'activated' } });
    expect(loadTabVisibility).toHaveBeenCalledTimes(1);
  });

  it('activateEdt on an unwired store is a store-not-wired error', async () => {
    expect(await createAppStore().getState().activateEdt({ topic: 'x' })).toMatchObject({
      ok: false,
      error: { code: 'store-not-wired' },
    });
  });
});
