// core/scripts/group-update: unit tests against fake ports (AD-13 core layer) — every
// I/O-matrix row of story 3.1 plus the lock-nesting and per-service-isolation guarantees.
// Real git/container behavior lives in adapters/driven/git|container's own integration
// tests and the black-box e2e; here only the use-case's orchestration is exercised.
import { describe, expect, it, vi, type Mock } from 'vitest';
import { err, ok } from '../result.js';
import type { ContainerPort } from '../ports/container.js';
import type { EdtMember, EdtRegistryEntry, EdtRegistryPort, EdtStatus } from '../ports/edt-registry.js';
import type { GitPort } from '../ports/git.js';
import type { LockPort } from '../ports/lock.js';
import type { Manifest, ManifestPort } from '../ports/manifest.js';
import type { MigrationPort } from '../ports/migration.js';
import type { RegistryPort } from '../ports/registry.js';
import type { StatePort } from '../ports/state.js';
import {
  GROUP_UPDATE_LOCK_KEY,
  edtUpdateLockKey,
  groupUpdate,
  markGroupUpdateInterrupted,
  type GroupUpdateParams,
  type OnUpdateBlocker,
  type UpdateBlocker,
  type UpdateBlockerChoice,
} from './group-update.js';

function calls(fn: unknown): Array<unknown[]> {
  return (fn as unknown as Mock).mock.calls;
}

function manifestFor(service: string): Manifest {
  return {
    service,
    container: `ctr-${service}`,
    migrationCommand: 'npm run migration:run',
    sharedBranch: 'development',
    modules: {},
  };
}

function fakeManifest(overrides: Partial<ManifestPort> = {}): ManifestPort {
  return {
    load: vi.fn(async (repoPath: string) => ok(manifestFor(repoPath.split('/').pop() ?? repoPath))),
    ...overrides,
  };
}

function fakeGit(overrides: Partial<GitPort> = {}): GitPort {
  return {
    assertAllowedBranch: vi.fn(async () => ok(undefined)),
    createBranch: vi.fn(async () => ok(undefined)),
    deleteBranch: vi.fn(async () => ok(undefined)),
    // Matches ACTIVE's own recorded branches per repo — anything else exercises the
    // `unexpected-branch` row (P1), never a silent merge into the wrong branch.
    currentBranch: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/b' ? 'feat/b' : 'feat/a')),
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
    ...overrides,
  };
}

function fakeContainer(overrides: Partial<ContainerPort> = {}): ContainerPort {
  return {
    restart: vi.fn(async () => ok(undefined)),
    ...overrides,
  };
}

function fakeMigration(overrides: Partial<MigrationPort> = {}): MigrationPort {
  return {
    run: vi.fn(async () => ok({ output: '' })),
    ...overrides,
  };
}

function fakeEdtRegistry(overrides: Partial<EdtRegistryPort> = {}): EdtRegistryPort {
  return {
    add: vi.fn(async () => ok(undefined)),
    list: vi.fn(async () => ok([])),
    setStatus: vi.fn(async () => ok(undefined)),
    update: vi.fn(async () => ok(undefined)),
    ...overrides,
  };
}

function fakeLock(overrides: Partial<LockPort> = {}): LockPort {
  return {
    acquire: vi.fn(async () => ok({ release: vi.fn(async () => ok(undefined)) })),
    peek: vi.fn(async () => ok({ locked: false })),
    ...overrides,
  };
}

function fakeState(overrides: Partial<StatePort> = {}): StatePort {
  return {
    readActiveEdt: vi.fn(async () => ok(null)),
    writeActiveEdt: vi.fn(async () => ok(undefined)),
    readSplitterRatios: vi.fn(async () => ok(null)),
    writeSplitterRatios: vi.fn(async () => ok(undefined)),
    ...overrides,
  };
}

function fakeRegistry(paths: string[] = []): RegistryPort {
  return {
    list: vi.fn(async () => ok(paths)),
    add: vi.fn(async () => ok(undefined)),
    exists: vi.fn(async () => ok(true)),
    scan: vi.fn(async () => ok({ candidates: [], skipped: [] })),
    reset: vi.fn(async () => ok({ path: '/p', backupPath: null })),
  };
}

function member(service: string, repoPath: string, branch: string): EdtMember {
  return { service, repoPath, branch };
}

function edtEntry(ulid: string, topic: string, members: EdtMember[], status: EdtStatus = 'active'): EdtRegistryEntry {
  return { ulid, topic, createdAt: '2026-09-17T00:00:00.000Z', status, members };
}

const ACTIVE = edtEntry('edt-active', 'demo', [
  member('svc-a', '/repo/a', 'feat/a'),
  member('svc-b', '/repo/b', 'feat/b'),
]);

function makeParams(overrides: Partial<GroupUpdateParams> = {}): GroupUpdateParams {
  return {
    edtRegistry: overrides.edtRegistry ?? fakeEdtRegistry({ list: vi.fn(async () => ok([ACTIVE])) }),
    state: overrides.state ?? fakeState({ readActiveEdt: vi.fn(async () => ok('edt-active')) }),
    manifest: overrides.manifest ?? fakeManifest(),
    git: overrides.git ?? fakeGit(),
    container: overrides.container ?? fakeContainer(),
    migration: overrides.migration ?? fakeMigration(),
    lock: overrides.lock ?? fakeLock(),
    ...(overrides.registry !== undefined ? { registry: overrides.registry } : {}),
    ...(overrides.scope !== undefined ? { scope: overrides.scope } : {}),
    ...(overrides.onUpdateBlocker !== undefined ? { onUpdateBlocker: overrides.onUpdateBlocker } : {}),
  };
}

describe('groupUpdate — active-EDT resolution', () => {
  it('fails with no-active-edt when no EDT is active, touching nothing else', async () => {
    const edtRegistry = fakeEdtRegistry();
    const git = fakeGit();
    const lock = fakeLock();
    const params = makeParams({ edtRegistry, git, lock, state: fakeState({ readActiveEdt: vi.fn(async () => ok(null)) }) });

    const result = await groupUpdate(params);

    expect(result).toMatchObject({ ok: false, error: { code: 'no-active-edt' } });
    expect(calls(edtRegistry.list)).toHaveLength(0);
    expect(calls(git.currentBranch)).toHaveLength(0);
    expect(calls(lock.acquire)).toHaveLength(0);
  });

  it('propagates a state.readActiveEdt() failure', async () => {
    const state = fakeState({ readActiveEdt: async () => err('state-invalid-format', 'corrupt') });

    const result = await groupUpdate(makeParams({ state }));

    expect(result).toMatchObject({ ok: false, error: { code: 'state-invalid-format' } });
  });

  it('fails with edt-not-found when the active pointer names an unregistered EDT', async () => {
    const edtRegistry = fakeEdtRegistry({ list: vi.fn(async () => ok([])) });

    const result = await groupUpdate(makeParams({ edtRegistry }));

    expect(result).toMatchObject({ ok: false, error: { code: 'edt-not-found' } });
  });

  it('returns an explicit no-op note (never silent success) for a zero-member EDT', async () => {
    const empty = edtEntry('edt-empty', 'empty', []);
    const edtRegistry = fakeEdtRegistry({ list: vi.fn(async () => ok([empty])) });
    const state = fakeState({ readActiveEdt: vi.fn(async () => ok('edt-empty')) });
    const git = fakeGit();
    const lock = fakeLock();

    const result = await groupUpdate(makeParams({ edtRegistry, state, git, lock }));

    expect(result).toEqual({
      ok: true,
      data: {
        ulid: 'edt-empty',
        topic: 'empty',
        results: [],
        note: expect.stringContaining('no member services'),
        scope: 'edt',
      },
    });
    expect(calls(git.currentBranch)).toHaveLength(0);
    expect(calls(lock.acquire)).toHaveLength(0);
  });
});

describe('groupUpdate — per-service pull-or-merge then restart', () => {
  it('merges the shared branch into a member on a feature branch, gated, then restarts', async () => {
    const git = fakeGit();
    const container = fakeContainer();

    const result = await groupUpdate(makeParams({ git, container }));

    expect(result).toEqual({
      ok: true,
      data: {
        ulid: 'edt-active',
        topic: 'demo',
        results: [
          { service: 'svc-a', outcome: 'updated' },
          { service: 'svc-b', outcome: 'updated' },
        ],
        scope: 'edt',
      },
    });
    // Fetch of the shared branch, write-gate on the member branch with the EDT ulid, merge.
    expect(calls(git.fetch)).toContainEqual(['/repo/a', 'development']);
    expect(calls(git.assertAllowedBranch)).toContainEqual(['/repo/a', 'feat/a', 'edt-active']);
    expect(calls(git.mergeBranch)).toContainEqual(['/repo/a', 'development']);
    // The merge path never pulls.
    expect(calls(git.pull)).toHaveLength(0);
    expect(calls(container.restart)).toContainEqual(['ctr-a']);
    expect(calls(container.restart)).toContainEqual(['ctr-b']);
  });

  it('fails a member sitting on a branch other than its recorded one, with no git write and no restart', async () => {
    const git = fakeGit({
      currentBranch: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/a' ? 'development' : 'feat/b')),
    });
    const container = fakeContainer();

    const result = await groupUpdate(makeParams({ git, container }));

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [
          {
            service: 'svc-a',
            outcome: 'failed',
            detail: {
              code: 'unexpected-branch',
              message: expect.stringContaining('development'),
            },
          },
          { service: 'svc-b', outcome: 'updated' },
        ],
      },
    });
    if (result.ok) {
      expect(result.data.results[0].detail?.message).toContain('"feat/a"');
    }
    // No git write of any kind for the mismatched repo, and no restart.
    for (const fn of [git.fetch, git.pull, git.mergeBranch, git.abortMerge]) {
      expect(calls(fn).filter(([path]) => path === '/repo/a')).toHaveLength(0);
    }
    expect(calls(container.restart).filter(([ctr]) => ctr === 'ctr-a')).toHaveLength(0);
    expect(calls(git.assertAllowedBranch).filter(([path]) => path === '/repo/a')).toHaveLength(0);
  });

  it('pulls (never fetches/merges) a member already sitting on the shared branch, then restarts its own container', async () => {
    // The pull path is only reachable when the member's *recorded* branch is the shared
    // branch itself and the repo actually sits on it (anything else is unexpected-branch).
    const onShared = edtEntry('edt-shared', 'shared', [member('svc-a', '/repo/a', 'development')]);
    const edtRegistry = fakeEdtRegistry({ list: vi.fn(async () => ok([onShared])) });
    const state = fakeState({ readActiveEdt: vi.fn(async () => ok('edt-shared')) });
    const git = fakeGit({ currentBranch: vi.fn(async () => ok('development')) });
    const container = fakeContainer();

    const result = await groupUpdate(makeParams({ edtRegistry, state, git, container }));

    expect(result).toEqual({
      ok: true,
      data: {
        ulid: 'edt-shared',
        topic: 'shared',
        results: [{ service: 'svc-a', outcome: 'updated' }],
        scope: 'edt',
      },
    });
    expect(calls(git.pull)).toEqual([['/repo/a']]);
    expect(calls(git.fetch)).toHaveLength(0);
    expect(calls(git.mergeBranch)).toHaveLength(0);
    // The pulled member's own manifest container was restarted.
    expect(calls(container.restart)).toEqual([['ctr-a']]);
  });

  it('skips a dirty member sitting on the shared branch, with zero pull/restart for it', async () => {
    const onShared = edtEntry('edt-shared', 'shared', [member('svc-a', '/repo/a', 'development')]);
    const edtRegistry = fakeEdtRegistry({ list: vi.fn(async () => ok([onShared])) });
    const state = fakeState({ readActiveEdt: vi.fn(async () => ok('edt-shared')) });
    const git = fakeGit({
      currentBranch: vi.fn(async () => ok('development')),
      listDirtyPaths: vi.fn(async () => ok(['wip.txt'])),
    });
    const container = fakeContainer();

    const result = await groupUpdate(makeParams({ edtRegistry, state, git, container }));

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [{ service: 'svc-a', outcome: 'skipped', detail: { code: 'dirty-worktree' } }],
      },
    });
    expect(calls(git.pull)).toHaveLength(0);
    expect(calls(container.restart)).toHaveLength(0);
  });

  it('reports updated on an idempotent rerun (merge no-op still restarts)', async () => {
    const git = fakeGit();
    const container = fakeContainer();

    const first = await groupUpdate(makeParams({ git, container }));
    const second = await groupUpdate(makeParams({ git, container }));

    expect(first).toMatchObject({ ok: true });
    expect(second).toMatchObject({
      ok: true,
      data: { results: [{ service: 'svc-a', outcome: 'updated' }, { service: 'svc-b', outcome: 'updated' }] },
    });
  });

  it('skips a dirty worktree with dirty-worktree detail, touching no git write and no container', async () => {
    const git = fakeGit({
      listDirtyPaths: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/a' ? ['wip.txt'] : [])),
    });
    const container = fakeContainer();

    const result = await groupUpdate(makeParams({ git, container }));

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [
          { service: 'svc-a', outcome: 'skipped', detail: { code: 'dirty-worktree' } },
          { service: 'svc-b', outcome: 'updated' },
        ],
      },
    });
    expect(calls(git.fetch).filter(([path]) => path === '/repo/a')).toHaveLength(0);
    expect(calls(git.mergeBranch).filter(([path]) => path === '/repo/a')).toHaveLength(0);
    expect(calls(git.pull).filter(([path]) => path === '/repo/a')).toHaveLength(0);
    expect(calls(container.restart).filter(([ctr]) => ctr === 'ctr-a')).toHaveLength(0);
    expect(calls(container.restart)).toContainEqual(['ctr-b']);
  });

  it('aborts a conflicting merge, reports failed merge-conflict, and still updates the other service', async () => {
    const git = fakeGit({
      mergeBranch: vi.fn(async (repoPath: string) =>
        repoPath === '/repo/a' ? err('merge-conflict', 'Automatic merge failed') : ok(undefined),
      ),
    });

    const result = await groupUpdate(makeParams({ git }));

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [
          { service: 'svc-a', outcome: 'failed', detail: { code: 'merge-conflict' } },
          { service: 'svc-b', outcome: 'updated' },
        ],
      },
    });
    expect(calls(git.abortMerge)).toEqual([['/repo/a']]);
  });

  it('keeps merge-conflict even when the abort itself fails, surfacing both messages', async () => {
    const git = fakeGit({
      mergeBranch: vi.fn(async () => err('merge-conflict', 'Automatic merge failed')),
      abortMerge: vi.fn(async () => err('git-merge-abort-error', 'no merge to abort')),
    });

    const result = await groupUpdate(makeParams({ git }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      const row = result.data.results[0];
      expect(row.outcome).toBe('failed');
      expect(row.detail?.code).toBe('merge-conflict');
      expect(row.detail?.message).toContain('merge --abort also failed');
    }
  });

  it('reports a non-conflict merge failure without aborting', async () => {
    const git = fakeGit({
      mergeBranch: vi.fn(async () => err('git-merge-error', 'died of signal')),
    });

    const result = await groupUpdate(makeParams({ git }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.results).toContainEqual({
        service: 'svc-a',
        outcome: 'failed',
        detail: { code: 'git-merge-error', message: 'died of signal' },
      });
    }
    expect(calls(git.abortMerge)).toHaveLength(0);
  });

  it('reports a restart failure as failed with the restart detail, others unaffected', async () => {
    const container = fakeContainer({
      restart: vi.fn(async (ctr: string) =>
        ctr === 'ctr-a' ? err('container-restart-error', 'No such container') : ok(undefined),
      ),
    });

    const result = await groupUpdate(makeParams({ container }));

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [
          { service: 'svc-a', outcome: 'failed', detail: { code: 'container-restart-error' } },
          { service: 'svc-b', outcome: 'updated' },
        ],
      },
    });
    // With duplicate service names in one EDT the code alone can't tell rows apart — the
    // message names both the repo path and the container.
    if (result.ok) {
      expect(result.data.results[0].detail?.message).toContain('/repo/a');
      expect(result.data.results[0].detail?.message).toContain('ctr-a');
    }
  });

  it('reports a manifest load failure as a failed row labeled by the member service', async () => {
    const manifest = fakeManifest({
      load: vi.fn(async (repoPath: string) =>
        repoPath === '/repo/a' ? err('manifest-not-found', 'no manifest') : ok(manifestFor('svc-b')),
      ),
    });
    const git = fakeGit();

    const result = await groupUpdate(makeParams({ manifest, git }));

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [
          { service: 'svc-a', outcome: 'failed', detail: { code: 'manifest-not-found' } },
          { service: 'svc-b', outcome: 'updated' },
        ],
      },
    });
    // The failed member never reached git at all.
    expect(calls(git.currentBranch).filter(([path]) => path === '/repo/a')).toHaveLength(0);
  });

  it('reports a write-gate rejection as failed without merging or restarting that service', async () => {
    const git = fakeGit({
      assertAllowedBranch: vi.fn(async (repoPath: string) =>
        repoPath === '/repo/a' ? err('branch-owned-by-other-edt', 'claimed elsewhere') : ok(undefined),
      ),
    });
    const container = fakeContainer();

    const result = await groupUpdate(makeParams({ git, container }));

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [
          { service: 'svc-a', outcome: 'failed', detail: { code: 'branch-owned-by-other-edt' } },
          { service: 'svc-b', outcome: 'updated' },
        ],
      },
    });
    expect(calls(git.mergeBranch).filter(([path]) => path === '/repo/a')).toHaveLength(0);
    expect(calls(container.restart).filter(([ctr]) => ctr === 'ctr-a')).toHaveLength(0);
  });

  it('reports a fetch failure as failed without merging that service', async () => {
    const git = fakeGit({
      fetch: vi.fn(async (repoPath: string) =>
        repoPath === '/repo/a' ? err('git-fetch-error', 'no route to origin') : ok(undefined),
      ),
    });

    const result = await groupUpdate(makeParams({ git }));

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [
          { service: 'svc-a', outcome: 'failed', detail: { code: 'git-fetch-error' } },
          { service: 'svc-b', outcome: 'updated' },
        ],
      },
    });
    expect(calls(git.mergeBranch).filter(([path]) => path === '/repo/a')).toHaveLength(0);
  });

  it('reports a pull failure as failed for a member on the shared branch', async () => {
    const onShared = edtEntry('edt-shared', 'shared', [member('svc-a', '/repo/a', 'development')]);
    const edtRegistry = fakeEdtRegistry({ list: vi.fn(async () => ok([onShared])) });
    const state = fakeState({ readActiveEdt: vi.fn(async () => ok('edt-shared')) });
    const git = fakeGit({
      currentBranch: vi.fn(async () => ok('development')),
      pull: vi.fn(async () => err('git-pull-error', 'divergent branches')),
    });

    const result = await groupUpdate(makeParams({ edtRegistry, state, git }));

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [{ service: 'svc-a', outcome: 'failed', detail: { code: 'git-pull-error' } }],
      },
    });
    // No merge in progress — the pull is reported as-is, never aborted.
    expect(calls(git.abortMerge)).toHaveLength(0);
  });

  it('aborts a conflicting pull left mid-merge and reports merge-conflict', async () => {
    const onShared = edtEntry('edt-shared', 'shared', [member('svc-a', '/repo/a', 'development')]);
    const edtRegistry = fakeEdtRegistry({ list: vi.fn(async () => ok([onShared])) });
    const state = fakeState({ readActiveEdt: vi.fn(async () => ok('edt-shared')) });
    // No mid-merge before the pull (pre-existing check passes); the failed pull leaves one.
    let pullCalled = false;
    const git = fakeGit({
      currentBranch: vi.fn(async () => ok('development')),
      pull: vi.fn(async () => {
        pullCalled = true;
        return err('git-pull-error', 'pull conflicts');
      }),
      isMergeInProgress: vi.fn(async () => ok(pullCalled)),
    });

    const result = await groupUpdate(makeParams({ edtRegistry, state, git }));

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [{ service: 'svc-a', outcome: 'failed', detail: { code: 'merge-conflict' } }],
      },
    });
    expect(calls(git.abortMerge)).toEqual([['/repo/a']]);
  });

  it('keeps merge-conflict when a conflicting pull aborts uncleanly, surfacing both messages', async () => {
    const onShared = edtEntry('edt-shared', 'shared', [member('svc-a', '/repo/a', 'development')]);
    const edtRegistry = fakeEdtRegistry({ list: vi.fn(async () => ok([onShared])) });
    const state = fakeState({ readActiveEdt: vi.fn(async () => ok('edt-shared')) });
    let pullCalled = false;
    const git = fakeGit({
      currentBranch: vi.fn(async () => ok('development')),
      pull: vi.fn(async () => {
        pullCalled = true;
        return err('git-pull-error', 'pull conflicts');
      }),
      isMergeInProgress: vi.fn(async () => ok(pullCalled)),
      abortMerge: vi.fn(async () => err('git-merge-abort-error', 'no merge to abort')),
    });

    const result = await groupUpdate(makeParams({ edtRegistry, state, git }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      const row = result.data.results[0];
      expect(row.outcome).toBe('failed');
      expect(row.detail?.code).toBe('merge-conflict');
      expect(row.detail?.message).toContain('merge --abort also failed');
    }
  });

  it('keeps a plain git-pull-error when the merge-state check itself cannot run', async () => {
    const onShared = edtEntry('edt-shared', 'shared', [member('svc-a', '/repo/a', 'development')]);
    const edtRegistry = fakeEdtRegistry({ list: vi.fn(async () => ok([onShared])) });
    const state = fakeState({ readActiveEdt: vi.fn(async () => ok('edt-shared')) });
    // The pre-existing check passes (first call clean); the post-pull classification fails.
    let mergeChecks = 0;
    const git = fakeGit({
      currentBranch: vi.fn(async () => ok('development')),
      pull: vi.fn(async () => err('git-pull-error', 'no route to origin')),
      isMergeInProgress: vi.fn(async () => {
        mergeChecks += 1;
        return mergeChecks <= 1 ? ok(false) : err('git-merge-check-error', 'git missing');
      }),
    });

    const result = await groupUpdate(makeParams({ edtRegistry, state, git }));

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [{ service: 'svc-a', outcome: 'failed', detail: { code: 'git-pull-error' } }],
      },
    });
    expect(calls(git.abortMerge)).toHaveLength(0);
  });
});

describe('groupUpdate — migrate phase (story 3.2)', () => {
  // The invocation index of fn's call for path, comparable across different mocks
  // (vitest's invocationCallOrder is a global sequence shared by every mock).
  function callOrder(fn: unknown, path: string): number {
    const mock = (fn as unknown as Mock).mock;
    const index = mock.calls.findIndex((args: unknown[]) => args[0] === path);
    return mock.invocationCallOrder[index];
  }

  it('runs the manifest migrationCommand after the merge and before the restart', async () => {
    const git = fakeGit();
    const migration = fakeMigration();
    const container = fakeContainer();

    const result = await groupUpdate(makeParams({ git, migration, container }));

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [{ service: 'svc-a', outcome: 'updated' }, { service: 'svc-b', outcome: 'updated' }],
      },
    });
    expect(calls(migration.run)).toContainEqual(['/repo/a', 'npm run migration:run']);
    expect(calls(migration.run)).toContainEqual(['/repo/b', 'npm run migration:run']);
    // Strict per-service order: pull/merge → migrate → restart.
    expect(callOrder(git.mergeBranch, '/repo/a')).toBeLessThan(callOrder(migration.run, '/repo/a'));
    expect(callOrder(migration.run, '/repo/a')).toBeLessThan(callOrder(container.restart, 'ctr-a'));
    expect(callOrder(git.mergeBranch, '/repo/b')).toBeLessThan(callOrder(migration.run, '/repo/b'));
    expect(callOrder(migration.run, '/repo/b')).toBeLessThan(callOrder(container.restart, 'ctr-b'));
  });

  it('runs the migration on the pull path too (member already on the shared branch)', async () => {
    const onShared = edtEntry('edt-shared', 'shared', [member('svc-a', '/repo/a', 'development')]);
    const edtRegistry = fakeEdtRegistry({ list: vi.fn(async () => ok([onShared])) });
    const state = fakeState({ readActiveEdt: vi.fn(async () => ok('edt-shared')) });
    const git = fakeGit({ currentBranch: vi.fn(async () => ok('development')) });
    const migration = fakeMigration();
    const container = fakeContainer();

    const result = await groupUpdate(makeParams({ edtRegistry, state, git, migration, container }));

    expect(result).toMatchObject({
      ok: true,
      data: { results: [{ service: 'svc-a', outcome: 'updated' }] },
    });
    expect(calls(migration.run)).toEqual([['/repo/a', 'npm run migration:run']]);
    expect(callOrder(git.pull, '/repo/a')).toBeLessThan(callOrder(migration.run, '/repo/a'));
    expect(callOrder(migration.run, '/repo/a')).toBeLessThan(callOrder(container.restart, 'ctr-a'));
  });

  it('skips the migration without error when no migrationCommand is declared, still reporting updated', async () => {
    const manifest = fakeManifest({
      load: vi.fn(async (repoPath: string) => ok({ ...manifestFor('svc-x'), migrationCommand: undefined })),
    });
    const migration = fakeMigration();
    const container = fakeContainer();

    const result = await groupUpdate(makeParams({ manifest, migration, container }));

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [{ service: 'svc-a', outcome: 'updated' }, { service: 'svc-b', outcome: 'updated' }],
      },
    });
    expect(calls(migration.run)).toHaveLength(0);
    expect(calls(container.restart)).toHaveLength(2);
  });

  it('treats a blank migrationCommand like an undeclared one (skip, never spawn)', async () => {
    const manifest = fakeManifest({
      load: vi.fn(async (repoPath: string) => ok({ ...manifestFor('svc-x'), migrationCommand: '   ' })),
    });
    const migration = fakeMigration();

    const result = await groupUpdate(makeParams({ manifest, migration }));

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [{ service: 'svc-a', outcome: 'updated' }, { service: 'svc-b', outcome: 'updated' }],
      },
    });
    expect(calls(migration.run)).toHaveLength(0);
  });

  it('reports a failing migration as failed migration-failed with service, command, and output — restart skipped, others continue', async () => {
    const migration = fakeMigration({
      run: vi.fn(async (repoPath: string, command: string) =>
        repoPath === '/repo/a' ? err('migration-failed', 'relation "users" does not exist') : ok({ output: '' }),
      ),
    });
    const container = fakeContainer();

    const result = await groupUpdate(makeParams({ migration, container }));

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [
          { service: 'svc-a', outcome: 'failed', detail: { code: 'migration-failed' } },
          { service: 'svc-b', outcome: 'updated' },
        ],
      },
    });
    if (result.ok) {
      const message = result.data.results[0].detail?.message ?? '';
      expect(message).toContain('/repo/a');
      expect(message).toContain('npm run migration:run');
      expect(message).toContain('relation "users" does not exist');
    }
    // The failed service merged (migration runs after pull/merge) but never restarted.
    expect(calls(container.restart).filter(([ctr]) => ctr === 'ctr-a')).toHaveLength(0);
    expect(calls(container.restart)).toContainEqual(['ctr-b']);
  });

  it('normalizes a non-migration-failed adapter code to the migration-failed row detail', async () => {
    const migration = fakeMigration({
      run: vi.fn(async () => err('sh-spawn-error', 'ENOENT')),
    });

    const result = await groupUpdate(makeParams({ migration }));

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [
          { service: 'svc-a', outcome: 'failed', detail: { code: 'migration-failed' } },
          { service: 'svc-b', outcome: 'failed', detail: { code: 'migration-failed' } },
        ],
      },
    });
    if (result.ok) {
      expect(result.data.results[0].detail?.message).toContain('ENOENT');
    }
  });

  it('never runs the migration for a dirty member — the row keeps its dirty-worktree skip', async () => {
    const git = fakeGit({
      listDirtyPaths: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/a' ? ['wip.txt'] : [])),
    });
    const migration = fakeMigration();

    const result = await groupUpdate(makeParams({ git, migration }));

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [
          { service: 'svc-a', outcome: 'skipped', detail: { code: 'dirty-worktree' } },
          { service: 'svc-b', outcome: 'updated' },
        ],
      },
    });
    expect(calls(migration.run).filter(([path]) => path === '/repo/a')).toHaveLength(0);
    expect(calls(migration.run)).toContainEqual(['/repo/b', 'npm run migration:run']);
  });

  it('never runs the migration for a conflicted member — the row keeps its merge-conflict failure', async () => {
    const git = fakeGit({
      mergeBranch: vi.fn(async (repoPath: string) =>
        repoPath === '/repo/a' ? err('merge-conflict', 'Automatic merge failed') : ok(undefined),
      ),
    });
    const migration = fakeMigration();

    const result = await groupUpdate(makeParams({ git, migration }));

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [
          { service: 'svc-a', outcome: 'failed', detail: { code: 'merge-conflict' } },
          { service: 'svc-b', outcome: 'updated' },
        ],
      },
    });
    expect(calls(migration.run).filter(([path]) => path === '/repo/a')).toHaveLength(0);
    expect(calls(migration.run)).toContainEqual(['/repo/b', 'npm run migration:run']);
  });

  it('never runs the migration for a member on an unexpected branch', async () => {
    const git = fakeGit({
      currentBranch: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/a' ? 'development' : 'feat/b')),
    });
    const migration = fakeMigration();

    const result = await groupUpdate(makeParams({ git, migration }));

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [
          { service: 'svc-a', outcome: 'failed', detail: { code: 'unexpected-branch' } },
          { service: 'svc-b', outcome: 'updated' },
        ],
      },
    });
    expect(calls(migration.run).filter(([path]) => path === '/repo/a')).toHaveLength(0);
  });

  it('never runs the migration when the pull/merge itself failed', async () => {
    const git = fakeGit({
      fetch: vi.fn(async (repoPath: string) =>
        repoPath === '/repo/a' ? err('git-fetch-error', 'no route to origin') : ok(undefined),
      ),
    });
    const migration = fakeMigration();

    const result = await groupUpdate(makeParams({ git, migration }));

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [
          { service: 'svc-a', outcome: 'failed', detail: { code: 'git-fetch-error' } },
          { service: 'svc-b', outcome: 'updated' },
        ],
      },
    });
    expect(calls(migration.run).filter(([path]) => path === '/repo/a')).toHaveLength(0);
  });
});

describe('groupUpdate — interrupted-status clearing', () => {
  it('clears a previously set interrupted status after a fully successful run', async () => {
    const interrupted = edtEntry(
      'edt-interrupted',
      'demo',
      [member('svc-a', '/repo/a', 'feat/a'), member('svc-b', '/repo/b', 'feat/b')],
      'interrupted',
    );
    const edtRegistry = fakeEdtRegistry({ list: vi.fn(async () => ok([interrupted])) });
    const state = fakeState({ readActiveEdt: vi.fn(async () => ok('edt-interrupted')) });

    const result = await groupUpdate(makeParams({ edtRegistry, state }));

    expect(result).toMatchObject({ ok: true });
    expect(calls(edtRegistry.setStatus)).toEqual([['edt-interrupted', 'active']]);
  });

  it('never clears interrupted when any service failed', async () => {
    const interrupted = edtEntry('edt-interrupted', 'demo', [member('svc-a', '/repo/a', 'feat/a')], 'interrupted');
    const edtRegistry = fakeEdtRegistry({ list: vi.fn(async () => ok([interrupted])) });
    const state = fakeState({ readActiveEdt: vi.fn(async () => ok('edt-interrupted')) });
    const git = fakeGit({ mergeBranch: vi.fn(async () => err('git-merge-error', 'died of signal')) });

    const result = await groupUpdate(makeParams({ edtRegistry, state, git }));

    expect(result).toMatchObject({ ok: true });
    expect(calls(edtRegistry.setStatus)).toHaveLength(0);
  });

  it('never touches setStatus when the entry was not interrupted', async () => {
    const edtRegistry = fakeEdtRegistry({ list: vi.fn(async () => ok([ACTIVE])) });

    const result = await groupUpdate(makeParams({ edtRegistry }));

    expect(result).toMatchObject({ ok: true });
    expect(calls(edtRegistry.setStatus)).toHaveLength(0);
  });

  it('keeps the per-service rows as error details when the reactivation write fails', async () => {
    const interrupted = edtEntry(
      'edt-interrupted',
      'demo',
      [member('svc-a', '/repo/a', 'feat/a'), member('svc-b', '/repo/b', 'feat/b')],
      'interrupted',
    );
    const edtRegistry = fakeEdtRegistry({
      list: vi.fn(async () => ok([interrupted])),
      setStatus: vi.fn(async () => err('edt-registry-write-error', 'disk full')),
    });
    const state = fakeState({ readActiveEdt: vi.fn(async () => ok('edt-interrupted')) });

    const result = await groupUpdate(makeParams({ edtRegistry, state }));

    expect(result).toMatchObject({ ok: false, error: { code: 'edt-registry-write-error' } });
    if (!result.ok) {
      const details = result.error.details as { results: unknown[] };
      expect(details.results).toContainEqual({ service: 'svc-a', outcome: 'updated' });
      expect(details.results).toContainEqual({ service: 'svc-b', outcome: 'updated' });
    }
  });
});

describe('groupUpdate — duplicate repoPath members', () => {
  it('touches a twice-registered repo exactly once (first wins)', async () => {
    const duplicated = edtEntry('edt-dup', 'demo', [
      member('svc-a', '/repo/a', 'feat/a'),
      member('svc-a-clone', '/repo/a', 'feat/a'),
      member('svc-b', '/repo/b', 'feat/b'),
    ]);
    const edtRegistry = fakeEdtRegistry({ list: vi.fn(async () => ok([duplicated])) });
    const state = fakeState({ readActiveEdt: vi.fn(async () => ok('edt-dup')) });
    const git = fakeGit();
    const container = fakeContainer();

    const result = await groupUpdate(makeParams({ edtRegistry, state, git, container }));

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [
          { service: 'svc-a', outcome: 'updated' },
          { service: 'svc-b', outcome: 'updated' },
        ],
      },
    });
    expect(calls(git.fetch).filter(([path]) => path === '/repo/a')).toHaveLength(1);
    expect(calls(git.mergeBranch).filter(([path]) => path === '/repo/a')).toHaveLength(1);
    expect(calls(container.restart)).toHaveLength(2);
  });
});

describe('groupUpdate — locks', () => {
  it('nests the global group-update key outside the edt:<ulid> key', async () => {
    const lock = fakeLock();

    const result = await groupUpdate(makeParams({ lock }));

    expect(result).toMatchObject({ ok: true });
    expect(calls(lock.acquire)).toEqual([[GROUP_UPDATE_LOCK_KEY], [edtUpdateLockKey('edt-active')]]);
  });

  it('rejects a second run with update-already-running when the global lock is held', async () => {
    const lock = fakeLock({ acquire: async () => err('action-in-progress', 'held') });

    const result = await groupUpdate(makeParams({ lock }));

    expect(result).toMatchObject({ ok: false, error: { code: 'update-already-running' } });
  });

  it('rejects a second run with update-already-running when the edt lock is held', async () => {
    const lock = fakeLock({
      acquire: vi.fn(async (key: string) =>
        key === edtUpdateLockKey('edt-active')
          ? err('action-in-progress', 'held')
          : ok({ release: vi.fn(async () => ok(undefined)) }),
      ),
    });

    const result = await groupUpdate(makeParams({ lock }));

    expect(result).toMatchObject({ ok: false, error: { code: 'update-already-running' } });
  });

  it('propagates a non-contention lock failure unchanged (never masked as already-running)', async () => {
    const lock = fakeLock({ acquire: async () => err('lock-acquire-error', 'unwritable state dir') });

    const result = await groupUpdate(makeParams({ lock }));

    expect(result).toMatchObject({ ok: false, error: { code: 'lock-acquire-error' } });
  });
});

describe('markGroupUpdateInterrupted', () => {
  it('marks the EDT interrupted via setStatus', async () => {
    const edtRegistry = fakeEdtRegistry();

    const result = await markGroupUpdateInterrupted(edtRegistry, 'edt-active');

    expect(result).toEqual({ ok: true, data: undefined });
    expect(calls(edtRegistry.setStatus)).toEqual([['edt-active', 'interrupted']]);
  });

  it('propagates a setStatus failure', async () => {
    const edtRegistry = fakeEdtRegistry({ setStatus: async () => err('edt-not-found', 'gone') });

    const result = await markGroupUpdateInterrupted(edtRegistry, 'edt-gone');

    expect(result).toMatchObject({ ok: false, error: { code: 'edt-not-found' } });
  });
});

describe('groupUpdate — all-repos scope (story 3.3)', () => {
  function allParams(overrides: Partial<GroupUpdateParams> = {}): GroupUpdateParams {
    return {
      ...makeParams(),
      registry: overrides.registry ?? fakeRegistry(['/repo/a', '/repo/b']),
      scope: 'all',
      ...overrides,
    };
  }

  it('runs the same per-service flow for every managed repo, each in results', async () => {
    const git = fakeGit();
    const container = fakeContainer();
    const lock = fakeLock();

    const result = await groupUpdate(allParams({ git, container, lock }));

    expect(result).toEqual({
      ok: true,
      data: {
        ulid: 'all',
        topic: 'all-repos',
        results: [
          { service: 'a', outcome: 'updated' },
          { service: 'b', outcome: 'updated' },
        ],
        scope: 'all',
      },
    });
    expect(calls(git.fetch)).toContainEqual(['/repo/a', 'development']);
    expect(calls(git.mergeBranch)).toContainEqual(['/repo/a', 'development']);
    expect(calls(container.restart)).toContainEqual(['ctr-a']);
    expect(calls(container.restart)).toContainEqual(['ctr-b']);
    // All-scope passes no EDT identity: the shared-branch gate applies, the cross-EDT
    // ownership half is skipped.
    expect(calls(git.assertAllowedBranch)).toContainEqual(['/repo/a', 'feat/a', undefined]);
    expect(calls(git.assertAllowedBranch)).toContainEqual(['/repo/b', 'feat/b', undefined]);
    // All-scope serializes on the global key only — never an edt:<ulid> key.
    expect(calls(lock.acquire)).toEqual([[GROUP_UPDATE_LOCK_KEY]]);
  });

  it('operates on currentBranch as-is with no unexpected-branch gate', async () => {
    const git = fakeGit({ currentBranch: vi.fn(async () => ok('feat/custom')) });
    const container = fakeContainer();

    const result = await groupUpdate(allParams({ git, container, registry: fakeRegistry(['/repo/a']) }));

    expect(result).toMatchObject({
      ok: true,
      data: { ulid: 'all', topic: 'all-repos', scope: 'all', results: [{ service: 'a', outcome: 'updated' }] },
    });
    expect(calls(git.fetch)).toContainEqual(['/repo/a', 'development']);
    expect(calls(git.mergeBranch)).toContainEqual(['/repo/a', 'development']);
    expect(calls(container.restart)).toContainEqual(['ctr-a']);
  });

  it('never gates on EDT ownership: a branch owned by another EDT still updates', async () => {
    const git = fakeGit({
      currentBranch: vi.fn(async () => ok('feat/custom')),
      assertAllowedBranch: vi.fn(async (_repoPath: string, _branch: string, edtId?: string) =>
        edtId === undefined ? ok(undefined) : err('branch-owned-by-other-edt', 'claimed elsewhere'),
      ),
    });

    const result = await groupUpdate(allParams({ git, registry: fakeRegistry(['/repo/a']) }));

    expect(result).toMatchObject({
      ok: true,
      data: { results: [{ service: 'a', outcome: 'updated' }] },
    });
  });

  it('pulls when the repo already sits on the shared branch', async () => {    const git = fakeGit({ currentBranch: vi.fn(async () => ok('development')) });

    const result = await groupUpdate(allParams({ git, registry: fakeRegistry(['/repo/a']) }));

    expect(result).toMatchObject({
      ok: true,
      data: { results: [{ service: 'a', outcome: 'updated' }] },
    });
    expect(calls(git.pull)).toEqual([['/repo/a']]);
    expect(calls(git.fetch)).toHaveLength(0);
  });

  it('returns an explicit no-op note for an empty registry without taking any lock', async () => {
    const lock = fakeLock();
    const git = fakeGit();

    const result = await groupUpdate(allParams({ registry: fakeRegistry([]), lock, git }));

    expect(result).toEqual({
      ok: true,
      data: {
        ulid: 'all',
        topic: 'all-repos',
        results: [],
        note: expect.stringContaining('No managed repos'),
        scope: 'all',
      },
    });
    expect(calls(lock.acquire)).toHaveLength(0);
    expect(calls(git.currentBranch)).toHaveLength(0);
  });

  it('returns an explicit no-op note when every registered path is unmanaged', async () => {
    const manifest = fakeManifest({ load: vi.fn(async () => err('manifest-not-found', 'no manifest')) });

    const result = await groupUpdate(allParams({ manifest, registry: fakeRegistry(['/repo/a', '/repo/b']) }));

    expect(result).toMatchObject({
      ok: true,
      data: { ulid: 'all', topic: 'all-repos', scope: 'all', results: [] },
    });
    if (result.ok) {
      expect(typeof result.data.note).toBe('string');
      expect(result.data.note ?? '').toContain('No managed repos');
    }
  });

  it('skips an unmanaged path like list-repos while the other repo still updates', async () => {
    const manifest = fakeManifest({
      load: vi.fn(async (repoPath: string) =>
        repoPath === '/repo/a' ? err('manifest-not-found', 'no manifest') : ok(manifestFor('svc-b')),
      ),
    });
    const git = fakeGit();

    const result = await groupUpdate(allParams({ manifest, git }));

    expect(result).toMatchObject({
      ok: true,
      data: { results: [{ service: 'svc-b', outcome: 'updated' }] },
    });
    expect(calls(git.currentBranch).filter(([path]) => path === '/repo/a')).toHaveLength(0);
  });

  it('keeps per-repo isolation: one dirty/conflict/migrate/restart failure never blocks the other', async () => {
    const git = fakeGit({
      listDirtyPaths: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/a' ? ['wip.txt'] : [])),
    });
    const container = fakeContainer();

    const result = await groupUpdate(allParams({ git, container }));

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [
          { service: 'a', outcome: 'skipped', detail: { code: 'dirty-worktree' } },
          { service: 'b', outcome: 'updated' },
        ],
      },
    });
  });

  it('reports a manifest load failure as a failed row labeled by path fallback, others continue', async () => {
    const manifest = fakeManifest({
      load: vi.fn(async (repoPath: string) =>
        repoPath === '/repo/a' ? err('manifest-invalid-yaml', 'bad yaml') : ok(manifestFor('svc-b')),
      ),
    });

    const result = await groupUpdate(allParams({ manifest }));

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [
          { service: 'a', outcome: 'failed', detail: { code: 'manifest-invalid-yaml' } },
          { service: 'svc-b', outcome: 'updated' },
        ],
      },
    });
  });

  it('dedupes twice-registered paths by resolved path (first wins)', async () => {
    const git = fakeGit();
    const container = fakeContainer();

    const result = await groupUpdate(allParams({ git, container, registry: fakeRegistry(['/repo/a', '/repo/a/', '/repo/b', '/repo/a/../a', '']) }));

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [
          { service: 'a', outcome: 'updated' },
          { service: 'b', outcome: 'updated' },
        ],
      },
    });
    expect(calls(git.fetch).filter(([path]) => path === '/repo/a' || path === '/repo/a/')).toHaveLength(1);
    expect(calls(container.restart)).toHaveLength(2);
  });

  it('rejects with update-already-running when the global lock is held (cross-scope)', async () => {
    const lock = fakeLock({ acquire: async () => err('action-in-progress', 'held') });

    const result = await groupUpdate(allParams({ lock }));

    expect(result).toMatchObject({ ok: false, error: { code: 'update-already-running' } });
  });

  it('fails with internal-error when the registry port is missing', async () => {
    const params = makeParams();
    delete (params as Partial<GroupUpdateParams>).registry;

    const result = await groupUpdate({ ...params, scope: 'all' });

    expect(result).toMatchObject({ ok: false, error: { code: 'internal-error' } });
  });

  it('propagates a registry.list() failure unchanged', async () => {
    const registry: RegistryPort = {
      ...fakeRegistry(),
      list: vi.fn(async () => err('registry-invalid-yaml', 'bad yaml')),
    };

    const result = await groupUpdate(allParams({ registry }));

    expect(result).toMatchObject({ ok: false, error: { code: 'registry-invalid-yaml' } });
  });
});

describe('groupUpdate — assisted resolution (story 3.4)', () => {
  // A scripted seam: answers each blocker with the next scripted choice, recording every
  // blocker raised (the Code Map's "scripted seam callbacks test the same way" as fakeGit
  // overrides + call-order assertions).
  function scriptedSeam(choices: UpdateBlockerChoice[]): { seam: OnUpdateBlocker; blockers: UpdateBlocker[] } {
    const blockers: UpdateBlocker[] = [];
    let index = 0;
    const seam: OnUpdateBlocker = async (blocker) => {
      blockers.push(blocker);
      const choice = choices[index];
      index += 1;
      if (choice === undefined) {
        throw new Error(`seam script exhausted after ${String(index - 1)} prompts`);
      }
      return choice;
    };
    return { seam, blockers };
  }

  it('auto-discards lockfile-only dirt silently and proceeds through merge → migrate → restart', async () => {
    const git = fakeGit();
    // Dirty at the gate, clean after the discard lands.
    (git.listDirtyPaths as unknown as Mock).mockResolvedValueOnce(ok(['package.json'])).mockResolvedValue(ok([]));
    const migration = fakeMigration();
    const container = fakeContainer();

    const result = await groupUpdate(makeParams({ git, migration, container }));

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [{ service: 'svc-a', outcome: 'updated' }, { service: 'svc-b', outcome: 'updated' }],
      },
    });
    expect(calls(git.discardPaths)).toContainEqual(['/repo/a', ['package.json']]);
    expect(calls(git.mergeBranch).filter(([path]) => path === '/repo/a')).toHaveLength(1);
    expect(calls(migration.run).filter(([path]) => path === '/repo/a')).toHaveLength(1);
    expect(calls(container.restart).filter(([ctr]) => ctr === 'ctr-a')).toHaveLength(1);
  });

  it('auto-discards nested lockfile paths (any depth) without prompting', async () => {
    const git = fakeGit();
    (git.listDirtyPaths as unknown as Mock)
      .mockResolvedValueOnce(ok(['services/a/package-lock.json', 'package.json']))
      .mockResolvedValueOnce(ok([]))
      .mockResolvedValue(ok([]));

    const result = await groupUpdate(makeParams({ git, onUpdateBlocker: scriptedSeam([]).seam }));

    expect(result).toMatchObject({
      ok: true,
      data: { results: [{ service: 'svc-a', outcome: 'updated' }, { service: 'svc-b', outcome: 'updated' }] },
    });
    expect(calls(git.discardPaths)).toContainEqual(['/repo/a', ['services/a/package-lock.json', 'package.json']]);
  });

  it('treats mixed lockfile + real dirt as ordinary dirt (no silent discard)', async () => {
    const git = fakeGit({
      listDirtyPaths: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/a' ? ['package.json', 'src/index.ts'] : [])),
    });

    const result = await groupUpdate(makeParams({ git }));

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [
          { service: 'svc-a', outcome: 'skipped', detail: { code: 'dirty-worktree' } },
          { service: 'svc-b', outcome: 'updated' },
        ],
      },
    });
    expect(calls(git.discardPaths)).toHaveLength(0);
  });

  it('dirty with seam: stash stashes via the git port, re-verifies clean, and resumes', async () => {
    const { seam, blockers } = scriptedSeam(['stash']);
    const git = fakeGit();
    // Dirty at the gate, clean after the stash.
    (git.listDirtyPaths as unknown as Mock).mockResolvedValueOnce(ok(['wip.txt'])).mockResolvedValue(ok([]));

    const result = await groupUpdate(makeParams({ git, onUpdateBlocker: seam }));

    expect(result).toMatchObject({
      ok: true,
      data: { results: [{ service: 'svc-a', outcome: 'updated' }, { service: 'svc-b', outcome: 'updated' }] },
    });
    expect(blockers).toEqual([{ service: 'svc-a', repoPath: '/repo/a', kind: 'dirty-worktree' }]);
    expect(calls(git.stashSave)).toContainEqual(['/repo/a', 'tui-back:update']);
    expect(calls(git.mergeBranch).filter(([path]) => path === '/repo/a')).toHaveLength(1);
  });

  it('dirty with seam: edited re-verifies before resuming', async () => {
    const { seam, blockers } = scriptedSeam(['edited']);
    const git = fakeGit();
    (git.listDirtyPaths as unknown as Mock)
      .mockResolvedValueOnce(ok(['wip.txt']))
      .mockResolvedValue(ok([]));

    const result = await groupUpdate(makeParams({ git, onUpdateBlocker: seam }));

    expect(result).toMatchObject({
      ok: true,
      data: { results: [{ service: 'svc-a', outcome: 'updated' }, { service: 'svc-b', outcome: 'updated' }] },
    });
    expect(blockers).toEqual([{ service: 'svc-a', repoPath: '/repo/a', kind: 'dirty-worktree' }]);
    // `edited` never writes through git itself — no stash, the menu only re-verifies.
    expect(calls(git.stashSave)).toHaveLength(0);
  });

  it('dirty with seam: still dirty after stash re-presents the menu', async () => {
    const { seam, blockers } = scriptedSeam(['stash', 'cancel-repo']);
    const git = fakeGit({
      listDirtyPaths: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/a' ? ['wip.txt'] : [])),
    });

    const result = await groupUpdate(makeParams({ git, onUpdateBlocker: seam }));

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [
          { service: 'svc-a', outcome: 'skipped', detail: { code: 'dirty-worktree' } },
          { service: 'svc-b', outcome: 'updated' },
        ],
      },
    });
    expect(blockers).toHaveLength(2);
    expect(blockers.every((blocker) => blocker.kind === 'dirty-worktree')).toBe(true);
    expect(calls(git.mergeBranch).filter(([path]) => path === '/repo/a')).toHaveLength(0);
  });

  it('dirty with seam: cancel-repo skips only that repo without aborting anything', async () => {
    const { seam } = scriptedSeam(['cancel-repo']);
    const git = fakeGit({
      listDirtyPaths: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/a' ? ['wip.txt'] : [])),
    });

    const result = await groupUpdate(makeParams({ git, onUpdateBlocker: seam }));

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [
          { service: 'svc-a', outcome: 'skipped', detail: { code: 'dirty-worktree' } },
          { service: 'svc-b', outcome: 'updated' },
        ],
      },
    });
    expect(calls(git.abortMerge)).toHaveLength(0);
  });

  it('dirty with seam: cancel-run stops the loop with rows so far, all skipped-never-failed', async () => {
    const { seam } = scriptedSeam(['cancel-run']);
    const git = fakeGit({
      listDirtyPaths: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/a' ? ['wip.txt'] : [])),
    });

    const result = await groupUpdate(makeParams({ git, onUpdateBlocker: seam }));

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [{ service: 'svc-a', outcome: 'skipped', detail: { code: 'dirty-worktree' } }],
      },
    });
    if (result.ok) {
      expect(result.data.results).toHaveLength(1);
    }
    // The run stopped: the second repo was never even read.
    expect(calls(git.currentBranch).filter(([path]) => path === '/repo/b')).toHaveLength(0);
  });

  it('mid-run conflict with seam: edited with zero unmerged paths finalizes the merge and continues', async () => {
    const { seam, blockers } = scriptedSeam(['edited']);
    const migration = fakeMigration();
    const container = fakeContainer();
    const git = fakeGit({
      mergeBranch: vi.fn(async (repoPath: string) =>
        repoPath === '/repo/a' ? err('merge-conflict', 'Automatic merge failed') : ok(undefined),
      ),
      hasUnmergedPaths: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/b')),
    });

    const result = await groupUpdate(makeParams({ git, migration, container, onUpdateBlocker: seam }));

    expect(result).toMatchObject({
      ok: true,
      data: { results: [{ service: 'svc-a', outcome: 'updated' }, { service: 'svc-b', outcome: 'updated' }] },
    });
    expect(blockers).toEqual([{ service: 'svc-a', repoPath: '/repo/a', kind: 'merge-conflict' }]);
    expect(calls(git.finalizeMerge)).toEqual([['/repo/a']]);
    // Finalized, not aborted — and the pipeline continued through migrate + restart.
    expect(calls(git.abortMerge)).toHaveLength(0);
    expect(calls(migration.run).filter(([path]) => path === '/repo/a')).toHaveLength(1);
    expect(calls(container.restart).filter(([ctr]) => ctr === 'ctr-a')).toHaveLength(1);
  });

  it('mid-run conflict with seam: a still-conflicted retry ends failed with no second prompt', async () => {
    const { seam, blockers } = scriptedSeam(['edited', 'edited']);
    const migration = fakeMigration();
    const git = fakeGit({
      mergeBranch: vi.fn(async () => err('merge-conflict', 'Automatic merge failed')),
      hasUnmergedPaths: vi.fn(async () => ok(true)),
    });

    const result = await groupUpdate(makeParams({ git, migration, onUpdateBlocker: seam }));

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [
          { service: 'svc-a', outcome: 'failed', detail: { code: 'merge-conflict' } },
          { service: 'svc-b', outcome: 'failed', detail: { code: 'merge-conflict' } },
        ],
      },
    });
    // Exactly one prompt per conflicted repo (two repos conflict here, one prompt each —
    // never a second prompt for the same repo).
    expect(blockers.filter((blocker) => blocker.repoPath === '/repo/a')).toHaveLength(1);
    // One initial merge + one bounded retry per repo, then abort.
    expect(calls(git.mergeBranch).filter(([path]) => path === '/repo/a')).toHaveLength(2);
    expect(calls(git.abortMerge).filter(([path]) => path === '/repo/a')).toHaveLength(1);
    expect(calls(migration.run).filter(([path]) => path === '/repo/a')).toHaveLength(0);
  });

  it('mid-run conflict with seam: cancel-repo aborts the own-started merge into a skipped row', async () => {
    const { seam } = scriptedSeam(['cancel-repo']);
    const git = fakeGit({
      mergeBranch: vi.fn(async (repoPath: string) =>
        repoPath === '/repo/a' ? err('merge-conflict', 'Automatic merge failed') : ok(undefined),
      ),
    });

    const result = await groupUpdate(makeParams({ git, onUpdateBlocker: seam }));

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [
          { service: 'svc-a', outcome: 'skipped', detail: { code: 'merge-conflict' } },
          { service: 'svc-b', outcome: 'updated' },
        ],
      },
    });
    expect(calls(git.abortMerge)).toEqual([['/repo/a']]);
  });

  it('mid-run conflict with seam: stash with a clean re-verification resumes the merge once', async () => {
    const single = edtEntry('edt-single', 'demo', [member('svc-a', '/repo/a', 'feat/a')]);
    const edtRegistry = fakeEdtRegistry({ list: vi.fn(async () => ok([single])) });
    const state = fakeState({ readActiveEdt: vi.fn(async () => ok('edt-single')) });
    const { seam, blockers } = scriptedSeam(['stash']);
    let merges = 0;
    const git = fakeGit({
      mergeBranch: vi.fn(async () => {
        merges += 1;
        return merges <= 1 ? err('merge-conflict', 'Automatic merge failed') : ok(undefined);
      }),
    });

    const result = await groupUpdate(makeParams({ edtRegistry, state, git, onUpdateBlocker: seam }));

    expect(result).toMatchObject({
      ok: true,
      data: { results: [{ service: 'svc-a', outcome: 'updated' }] },
    });
    expect(blockers).toEqual([{ service: 'svc-a', repoPath: '/repo/a', kind: 'merge-conflict' }]);
    expect(calls(git.stashSave)).toEqual([['/repo/a', 'tui-back:update']]);
    expect(calls(git.mergeBranch)).toHaveLength(2);
    expect(calls(git.abortMerge)).toHaveLength(0);
  });

  it('pre-existing mid-merge without a seam is a distinct skipped row, never aborted', async () => {
    const git = fakeGit({
      isMergeInProgress: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/a')),
    });

    const result = await groupUpdate(makeParams({ git }));

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [
          { service: 'svc-a', outcome: 'skipped', detail: { code: 'mid-merge' } },
          { service: 'svc-b', outcome: 'updated' },
        ],
      },
    });
    expect(calls(git.abortMerge)).toHaveLength(0);
    expect(calls(git.mergeBranch).filter(([path]) => path === '/repo/a')).toHaveLength(0);
  });

  it('pre-existing mid-rebase without a seam is a distinct skipped row, rebase never touched', async () => {
    const git = fakeGit({
      isRebaseInProgress: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/a')),
    });

    const result = await groupUpdate(makeParams({ git }));

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [
          { service: 'svc-a', outcome: 'skipped', detail: { code: 'mid-rebase' } },
          { service: 'svc-b', outcome: 'updated' },
        ],
      },
    });
    expect(calls(git.abortMerge)).toHaveLength(0);
    expect(calls(git.mergeBranch).filter(([path]) => path === '/repo/a')).toHaveLength(0);
  });

  it('pre-existing mid-merge with seam: menu applies after the report, edited resumes when cleared', async () => {
    const { seam, blockers } = scriptedSeam(['edited']);
    const git = fakeGit();
    // Mid-merge at arrival, cleared by the hand resolution the `edited` choice reports.
    (git.isMergeInProgress as unknown as Mock)
      .mockResolvedValueOnce(ok(true))
      .mockResolvedValueOnce(ok(false))
      .mockResolvedValue(ok(false));

    const result = await groupUpdate(makeParams({ git, onUpdateBlocker: seam }));

    expect(result).toMatchObject({
      ok: true,
      data: { results: [{ service: 'svc-a', outcome: 'updated' }, { service: 'svc-b', outcome: 'updated' }] },
    });
    expect(blockers).toEqual([{ service: 'svc-a', repoPath: '/repo/a', kind: 'mid-merge' }]);
    expect(calls(git.abortMerge)).toHaveLength(0);
    expect(calls(git.mergeBranch).filter(([path]) => path === '/repo/a')).toHaveLength(1);
  });

  it('pre-existing mid-merge with seam: cancel-repo never aborts it', async () => {
    const { seam, blockers } = scriptedSeam(['cancel-repo']);
    const git = fakeGit({
      isMergeInProgress: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/a')),
    });

    const result = await groupUpdate(makeParams({ git, onUpdateBlocker: seam }));

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [
          { service: 'svc-a', outcome: 'skipped', detail: { code: 'mid-merge' } },
          { service: 'svc-b', outcome: 'updated' },
        ],
      },
    });
    expect(blockers).toEqual([{ service: 'svc-a', repoPath: '/repo/a', kind: 'mid-merge' }]);
    expect(calls(git.abortMerge)).toHaveLength(0);
  });

  it('a throwing seam folds into a per-service failed row, others continue', async () => {
    const git = fakeGit({
      listDirtyPaths: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/a' ? ['wip.txt'] : [])),
    });
    const exploding: OnUpdateBlocker = async () => {
      throw new Error('menu crashed');
    };

    const result = await groupUpdate(makeParams({ git, onUpdateBlocker: exploding }));

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [
          { service: 'svc-a', outcome: 'failed', detail: { code: 'internal-error' } },
          { service: 'svc-b', outcome: 'updated' },
        ],
      },
    });
  });

  it('lockfile auto-fix applies in the all-repos scope too', async () => {
    const git = fakeGit();
    (git.listDirtyPaths as unknown as Mock)
      .mockResolvedValueOnce(ok(['package.json']))
      .mockResolvedValueOnce(ok([]))
      .mockResolvedValue(ok([]));
    const params: GroupUpdateParams = {
      ...makeParams({ git }),
      registry: fakeRegistry(['/repo/a']),
      scope: 'all',
    };

    const result = await groupUpdate(params);

    expect(result).toMatchObject({
      ok: true,
      data: { ulid: 'all', scope: 'all', results: [{ service: 'a', outcome: 'updated' }] },
    });
    expect(calls(git.discardPaths)).toContainEqual(['/repo/a', ['package.json']]);
  });

  it('a failing lockfile discard is a failed row with its code, touching no pull/merge/migration/restart', async () => {
    const git = fakeGit({
      listDirtyPaths: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/a' ? ['package.json'] : [])),
      discardPaths: vi.fn(async () => err('git-discard-error', 'git checkout -- failed')),
    });
    const migration = fakeMigration();
    const container = fakeContainer();

    const result = await groupUpdate(makeParams({ git, migration, container }));

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [
          { service: 'svc-a', outcome: 'failed', detail: { code: 'git-discard-error' } },
          { service: 'svc-b', outcome: 'updated' },
        ],
      },
    });
    expect(calls(git.mergeBranch).filter(([path]) => path === '/repo/a')).toHaveLength(0);
    expect(calls(git.pull).filter(([path]) => path === '/repo/a')).toHaveLength(0);
    expect(calls(migration.run).filter(([path]) => path === '/repo/a')).toHaveLength(0);
    expect(calls(container.restart).filter(([ctr]) => ctr === 'ctr-a')).toHaveLength(0);
  });

  it('a failing merge finalization is a failed row with its code, never aborted', async () => {
    const { seam, blockers } = scriptedSeam(['edited']);
    const migration = fakeMigration();
    const container = fakeContainer();
    const git = fakeGit({
      mergeBranch: vi.fn(async (repoPath: string) =>
        repoPath === '/repo/a' ? err('merge-conflict', 'Automatic merge failed') : ok(undefined),
      ),
      hasUnmergedPaths: vi.fn(async () => ok(false)),
      finalizeMerge: vi.fn(async () => err('git-commit-error', 'nothing to commit')),
    });

    const result = await groupUpdate(makeParams({ git, migration, container, onUpdateBlocker: seam }));

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [
          { service: 'svc-a', outcome: 'failed', detail: { code: 'git-commit-error' } },
          { service: 'svc-b', outcome: 'updated' },
        ],
      },
    });
    expect(blockers).toEqual([{ service: 'svc-a', repoPath: '/repo/a', kind: 'merge-conflict' }]);
    // The tree carries the developer's own resolution — aborting it away is forbidden.
    expect(calls(git.abortMerge)).toHaveLength(0);
    expect(calls(migration.run).filter(([path]) => path === '/repo/a')).toHaveLength(0);
    expect(calls(container.restart).filter(([ctr]) => ctr === 'ctr-a')).toHaveLength(0);
  });

  it('pull-path conflict with seam: edited finalizes via pull, never mergeBranch', async () => {
    const onShared = edtEntry('edt-shared', 'shared', [member('svc-a', '/repo/a', 'development')]);
    const edtRegistry = fakeEdtRegistry({ list: vi.fn(async () => ok([onShared])) });
    const state = fakeState({ readActiveEdt: vi.fn(async () => ok('edt-shared')) });
    const { seam, blockers } = scriptedSeam(['edited']);
    // No mid-merge before the pull (pre-existing check passes); the failed pull leaves one.
    let pullCalled = false;
    const migration = fakeMigration();
    const container = fakeContainer();
    const git = fakeGit({
      currentBranch: vi.fn(async () => ok('development')),
      pull: vi.fn(async () => {
        pullCalled = true;
        return err('git-pull-error', 'pull conflicts');
      }),
      isMergeInProgress: vi.fn(async () => ok(pullCalled)),
      hasUnmergedPaths: vi.fn(async () => ok(false)),
    });

    const result = await groupUpdate(makeParams({ edtRegistry, state, git, migration, container, onUpdateBlocker: seam }));

    expect(result).toMatchObject({
      ok: true,
      data: { results: [{ service: 'svc-a', outcome: 'updated' }] },
    });
    expect(blockers).toEqual([{ service: 'svc-a', repoPath: '/repo/a', kind: 'merge-conflict' }]);
    expect(calls(git.finalizeMerge)).toEqual([['/repo/a']]);
    expect(calls(git.pull)).toHaveLength(1);
    expect(calls(git.mergeBranch)).toHaveLength(0);
    expect(calls(git.abortMerge)).toHaveLength(0);
    expect(calls(migration.run)).toEqual([['/repo/a', 'npm run migration:run']]);
    expect(calls(container.restart)).toEqual([['ctr-a']]);
  });

  it('pull-path conflict with seam: a still-conflicted edited earns one re-pull, then updated', async () => {
    const onShared = edtEntry('edt-shared', 'shared', [member('svc-a', '/repo/a', 'development')]);
    const edtRegistry = fakeEdtRegistry({ list: vi.fn(async () => ok([onShared])) });
    const state = fakeState({ readActiveEdt: vi.fn(async () => ok('edt-shared')) });
    const { seam, blockers } = scriptedSeam(['edited']);
    let pulls = 0;
    let pullCalled = false;
    const git = fakeGit({
      currentBranch: vi.fn(async () => ok('development')),
      pull: vi.fn(async () => {
        pulls += 1;
        pullCalled = true;
        return pulls <= 1 ? err('git-pull-error', 'pull conflicts') : ok(undefined);
      }),
      isMergeInProgress: vi.fn(async () => ok(pullCalled)),
      hasUnmergedPaths: vi.fn(async () => ok(true)),
    });

    const result = await groupUpdate(makeParams({ edtRegistry, state, git, onUpdateBlocker: seam }));

    expect(result).toMatchObject({
      ok: true,
      data: { results: [{ service: 'svc-a', outcome: 'updated' }] },
    });
    expect(blockers).toEqual([{ service: 'svc-a', repoPath: '/repo/a', kind: 'merge-conflict' }]);
    expect(calls(git.pull)).toHaveLength(2);
    expect(calls(git.mergeBranch)).toHaveLength(0);
  });
});
