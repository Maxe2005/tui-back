// core/edt/create: unit tests against fake ports — validation order (topic, membership,
// duplicate topic before any write), the per-member branch loop, failure isolation, and the
// registry write under the per-resource lock. createEdt performs real EDT-dir/db writes, so
// edtsBaseDir points at a per-test temp dir.
import { describe, expect, it, vi, afterEach, type Mock } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ok, err } from '../result.js';
import type { EdtRegistryEntry, EdtRegistryPort } from '../ports/edt-registry.js';
import type { GitPort } from '../ports/git.js';
import type { LockPort } from '../ports/lock.js';
import type { Manifest, ManifestPort } from '../ports/manifest.js';
import type { RegistryPort } from '../ports/registry.js';
import { createEdt, listCreateCandidateBranches, type CreateBranchOptions, type CreateEdtParams, type MemberBranchPlan } from './create.js';

const tmpDirs: string[] = [];

async function tempEdtsBaseDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tui-back-edt-create-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

function calls(fn: unknown): Array<unknown[]> {
  return (fn as unknown as Mock).mock.calls;
}

function fakeRegistry(registered: string[]): RegistryPort {
  return {
    list: async () => ok(registered),
    add: async () => ok(undefined),
    exists: async () => ok(true),
    scan: async () => ok({ candidates: [], skipped: [] }),
    reset: async () => ok({ path: '/x', backupPath: null }),
    remove: async () => ok(undefined),
  };
}

function manifestFor(path: string): Manifest {
  return {
    service: `svc-${path}`,
    container: `ctr-${path}`,
    migrationCommand: 'npm run migration:run',
    sharedBranch: 'development',
    modules: {},
  };
}

function fakeManifest(overrides: Partial<ManifestPort> = {}): ManifestPort {
  return {
    load: vi.fn(async (path: string) => ok(manifestFor(path))),
    ...overrides,
  };
}

function fakeEdtRegistry(overrides: Partial<EdtRegistryPort> = {}): EdtRegistryPort {
  return {
    list: async () => ok([]),
    add: vi.fn(async () => ok(undefined)),
    setStatus: vi.fn(async () => ok(undefined)),
    update: vi.fn(async () => ok(undefined)),
    remove: vi.fn(async () => ok(undefined)),
    ...overrides,
  };
}

function fakeLock(): LockPort {
  return {
    acquire: vi.fn(async () => ok({ release: vi.fn(async () => ok(undefined)) })),
    peek: vi.fn(async () => ok({ locked: false })),
  };
}

// A manifest fixture — the protected set these fakes emulate, as if every repo's manifest
// declared `sharedBranch: development` and `protectedBranches: [preprod, prod]`. The real gate
// resolves it from each repo's own manifest (core/edt/shared-branches.ts).
const MANIFEST_PROTECTED_BRANCHES = ['development', 'preprod', 'prod'];

function fakeGit(overrides: Partial<GitPort> = {}): GitPort {
  return {
    assertAllowedBranch: vi.fn(async (_repoPath: string, branchName: string) =>
      MANIFEST_PROTECTED_BRANCHES.includes(branchName)
        ? err('shared-branch-rejected', `Branch "${branchName}" is protected by its service's manifest`)
        : ok(undefined),
    ),
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
    ...overrides,
  };
}

function entry(ulid: string, topic: string): EdtRegistryEntry {
  return { ulid, topic, createdAt: new Date().toISOString(), status: 'active', members: [] };
}

const GROUPED = {
  create: true,
  base: 'development',
  mode: 'grouped',
  names: { '/repo/a': 'feat/x', '/repo/b': 'feat/x' },
} as CreateBranchOptions;

async function makeParams(overrides: Partial<CreateEdtParams> = {}): Promise<CreateEdtParams> {
  const edtsBaseDir = await tempEdtsBaseDir();
  const members = overrides.members ?? ['/repo/a', '/repo/b'];
  return {
    edtsBaseDir,
    manifest: overrides.manifest ?? fakeManifest(),
    edtRegistry: overrides.edtRegistry ?? fakeEdtRegistry(),
    lock: overrides.lock ?? fakeLock(),
    edtRegistryResourceKey: '/cfg/edts.yaml',
    registry: overrides.registry ?? fakeRegistry(members),
    git: overrides.git ?? fakeGit(),
    topic: overrides.topic ?? 'demo',
    members,
    branchOptions:
      overrides.branchOptions ?? { create: false, base: 'development', mode: 'grouped', names: {} },
  };
}

describe('createEdt — validation before any write', () => {
  it('rejects a missing/blank topic with missing-argument before any write', async () => {
    const params = await makeParams({ topic: '   ' });

    const result = await createEdt(params);

    expect(result).toMatchObject({ ok: false, error: { code: 'missing-argument' } });
    expect(calls(params.edtRegistry.add)).toHaveLength(0);
    expect(calls(params.git.createBranch)).toHaveLength(0);
    expect(calls(params.git.currentBranch)).toHaveLength(0);
  });

  it('rejects zero members with invalid-member before any write', async () => {
    const params = await makeParams({ members: [] });

    const result = await createEdt(params);

    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-member' } });
    expect(calls(params.edtRegistry.add)).toHaveLength(0);
    expect(calls(params.git.createBranch)).toHaveLength(0);
  });

  it('rejects a member that is not a registered managed repo with invalid-member', async () => {
    const params = await makeParams({ members: ['/repo/a', '/not/registered'], registry: fakeRegistry(['/repo/a']) });

    const result = await createEdt(params);

    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-member' } });
    expect(calls(params.edtRegistry.add)).toHaveLength(0);
  });

  it('rejects a duplicate topic with edt-topic-exists before any write', async () => {
    const edtRegistry = fakeEdtRegistry({ list: async () => ok([entry('other-ulid', 'demo')]) });
    const params = await makeParams({ edtRegistry });

    const result = await createEdt(params);

    expect(result).toMatchObject({ ok: false, error: { code: 'edt-topic-exists' } });
    expect(calls(params.edtRegistry.add)).toHaveLength(0);
    expect(calls(params.git.createBranch)).toHaveLength(0);
  });

  it('rejects create mode without a branch name for every member (invalid-argument)', async () => {
    const params = await makeParams({
      branchOptions: { create: true, base: 'development', mode: 'grouped', names: { '/repo/a': 'feat/x' } },
    });

    const result = await createEdt(params);

    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
    expect(calls(params.edtRegistry.add)).toHaveLength(0);
  });

  it('propagates a registry.list failure instead of masking it', async () => {
    const registry = fakeRegistry(['/repo/a']);
    registry.list = async () => err('registry-invalid-yaml', 'bad yaml');
    const params = await makeParams({ registry });

    const result = await createEdt(params);

    expect(result).toMatchObject({ ok: false, error: { code: 'registry-invalid-yaml' } });
  });

  it('propagates an edtRegistry.list failure instead of masking it', async () => {
    const edtRegistry = fakeEdtRegistry({ list: async () => err('edt-registry-invalid-format', 'bad shape') });
    const params = await makeParams({ edtRegistry });

    const result = await createEdt(params);

    expect(result).toMatchObject({ ok: false, error: { code: 'edt-registry-invalid-format' } });
  });
});

describe('createEdt — branch creation disabled', () => {
  it('records each member current branch with outcome existing-branch when it is not shared (regression)', async () => {
    const git = fakeGit({
      currentBranch: vi.fn(async (path: string) => ok(path === '/repo/a' ? 'main' : 'feature-x')),
    });
    const params = await makeParams({ git });

    const result = await createEdt(params);

    expect(result).toMatchObject({
      ok: true,
      data: {
        topic: 'demo',
        results: [
          { service: 'svc-/repo/a', outcome: 'existing-branch' },
          { service: 'svc-/repo/b', outcome: 'existing-branch' },
        ],
      },
    });
    expect(calls(params.git.createBranch)).toHaveLength(0);

    const added = calls(params.edtRegistry.add);
    expect(added).toHaveLength(1);
    const entryWritten = added[0][0] as EdtRegistryEntry;
    expect(entryWritten.topic).toBe('demo');
    expect(entryWritten.members).toEqual([
      { service: 'svc-/repo/a', repoPath: '/repo/a', branch: 'main' },
      { service: 'svc-/repo/b', repoPath: '/repo/b', branch: 'feature-x' },
    ]);
    if (result.ok) {
      expect(result.data.ulid).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    }
  });

  it('rejects and excludes a member whose current branch is shared, without any git write', async () => {
    const git = fakeGit({
      currentBranch: vi.fn(async (path: string) => ok(path === '/repo/a' ? 'development' : 'feature-x')),
    });
    const params = await makeParams({ git });

    const result = await createEdt(params);

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [
          { service: 'svc-/repo/a', outcome: 'failed', detail: { code: 'shared-branch-rejected' } },
          { service: 'svc-/repo/b', outcome: 'existing-branch' },
        ],
      },
    });
    expect(calls(params.git.createBranch)).toHaveLength(0);
    expect(calls(params.git.assertAllowedBranch)).toEqual([
      ['/repo/a', 'development'],
      ['/repo/b', 'feature-x'],
    ]);

    const added = calls(params.edtRegistry.add);
    expect(added).toHaveLength(1);
    expect((added[0][0] as EdtRegistryEntry).members).toEqual([
      { service: 'svc-/repo/b', repoPath: '/repo/b', branch: 'feature-x' },
    ]);
  });

  it('excludes a member when assertAllowedBranch fails for a reason other than shared-branch-rejected (edge case)', async () => {
    const git = fakeGit({
      currentBranch: vi.fn(async () => ok('feature-x')),
      assertAllowedBranch: vi.fn(async (path: string) =>
        path === '/repo/a' ? err('manifest-not-found', 'manifest vanished between reads') : ok(undefined),
      ),
    });
    const params = await makeParams({ git });

    const result = await createEdt(params);

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [
          { service: 'svc-/repo/a', outcome: 'failed', detail: { code: 'manifest-not-found' } },
          { service: 'svc-/repo/b', outcome: 'existing-branch' },
        ],
      },
    });
    const added = calls(params.edtRegistry.add);
    expect((added[0][0] as EdtRegistryEntry).members).toEqual([
      { service: 'svc-/repo/b', repoPath: '/repo/b', branch: 'feature-x' },
    ]);
  });

  it('trims the topic before storing it', async () => {
    const params = await makeParams({
      topic: '  demo  ',
      git: fakeGit({ currentBranch: vi.fn(async () => ok('feature-x')) }),
    });

    const result = await createEdt(params);

    if (!result.ok) throw new Error('expected ok');
    expect(result.data.topic).toBe('demo');
  });
});

describe('createEdt — branch creation enabled', () => {
  it('creates one shared branch in every member and registers it (grouped)', async () => {
    const params = await makeParams({ branchOptions: GROUPED });

    const result = await createEdt(params);

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [
          { service: 'svc-/repo/a', outcome: 'created' },
          { service: 'svc-/repo/b', outcome: 'created' },
        ],
      },
    });
    expect(calls(params.git.createBranch)).toEqual([
      ['/repo/a', 'feat/x', 'development'],
      ['/repo/b', 'feat/x', 'development'],
    ]);

    const added = calls(params.edtRegistry.add);
    expect((added[0][0] as EdtRegistryEntry).members).toEqual([
      { service: 'svc-/repo/a', repoPath: '/repo/a', branch: 'feat/x' },
      { service: 'svc-/repo/b', repoPath: '/repo/b', branch: 'feat/x' },
    ]);
  });

  it('creates one branch per member by name map (individual)', async () => {
    const params = await makeParams({
      branchOptions: {
        create: true,
        base: 'development',
        mode: 'individual',
        names: { '/repo/a': 'feat/a', '/repo/b': 'feat/b' },
      } as CreateBranchOptions,
    });

    const result = await createEdt(params);

    if (!result.ok) throw new Error('expected ok');
    expect(result.data.results).toEqual([
      { service: 'svc-/repo/a', outcome: 'created' },
      { service: 'svc-/repo/b', outcome: 'created' },
    ]);
    expect(calls(params.git.createBranch)).toEqual([
      ['/repo/a', 'feat/a', 'development'],
      ['/repo/b', 'feat/b', 'development'],
    ]);
  });

  it('uses a non-default base branch when requested', async () => {
    const params = await makeParams({ branchOptions: { ...GROUPED, base: 'main' } });

    await createEdt(params);

    expect(calls(params.git.createBranch)).toEqual([
      ['/repo/a', 'feat/x', 'main'],
      ['/repo/b', 'feat/x', 'main'],
    ]);
  });

  // `bases[member]` overrides the top-level `base` for that member only — what the creation
  // TUI sends when the selected members' manifest sharedBranch values diverge.
  it('a per-member `bases` entry wins over the top-level `base` for that member, leaving others on `base`', async () => {
    const params = await makeParams({
      branchOptions: { ...GROUPED, base: 'main', bases: { '/repo/a': 'master' } },
    });

    await createEdt(params);

    expect(calls(params.git.createBranch)).toEqual([
      ['/repo/a', 'feat/x', 'master'],
      ['/repo/b', 'feat/x', 'main'],
    ]);
  });
});

describe('createEdt — per-service failure isolation', () => {
  it('reports a branch-exists failure for one member without aborting the others or EDT creation', async () => {
    const git = fakeGit({
      createBranch: vi.fn(async (path: string) =>
        path === '/repo/a' ? err('branch-exists', 'already exists') : ok(undefined),
      ),
    });
    const params = await makeParams({ git, branchOptions: GROUPED });

    const result = await createEdt(params);

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [
          { service: 'svc-/repo/a', outcome: 'failed', detail: { code: 'branch-exists', message: 'already exists' } },
          { service: 'svc-/repo/b', outcome: 'created' },
        ],
      },
    });
    // A does not join the EDT: a failed member is never registered, even though its current
    // branch could have been read as a fallback.
    const added = calls(params.edtRegistry.add);
    expect(added).toHaveLength(1);
    expect((added[0][0] as EdtRegistryEntry).members).toEqual([
      { service: 'svc-/repo/b', repoPath: '/repo/b', branch: 'feat/x' },
    ]);
  });

  it('reports base-branch-missing per member without aborting the batch or EDT creation', async () => {
    const git = fakeGit({
      createBranch: vi.fn(async () => err('base-branch-missing', 'base nope missing')),
    });
    const params = await makeParams({ git, branchOptions: GROUPED });

    const result = await createEdt(params);

    if (!result.ok) throw new Error('expected ok');
    expect(result.data.results).toEqual([
      { service: 'svc-/repo/a', outcome: 'failed', detail: { code: 'base-branch-missing', message: 'base nope missing' } },
      { service: 'svc-/repo/b', outcome: 'failed', detail: { code: 'base-branch-missing', message: 'base nope missing' } },
    ]);
    expect(calls(params.edtRegistry.add)).toHaveLength(1);
    // Both members failed, so both are excluded — a zero-member EDT is still created.
    expect((calls(params.edtRegistry.add)[0][0] as EdtRegistryEntry).members).toEqual([]);
  });

  it('propagates shared-branch-rejected as a per-member failure, excluding it from members (FR-7, AD-8)', async () => {
    const git = fakeGit({
      createBranch: vi.fn(async () => err('shared-branch-rejected', 'shared branch')),
    });
    const params = await makeParams({ git, branchOptions: GROUPED });

    const result = await createEdt(params);

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [
          { service: 'svc-/repo/a', outcome: 'failed', detail: { code: 'shared-branch-rejected' } },
          { service: 'svc-/repo/b', outcome: 'failed', detail: { code: 'shared-branch-rejected' } },
        ],
      },
    });
    expect((calls(params.edtRegistry.add)[0][0] as EdtRegistryEntry).members).toEqual([]);
  });

  it('excludes a member when createBranch fails and the fallback current-branch read also fails', async () => {
    const git = fakeGit({
      createBranch: vi.fn(async () => err('git-create-branch-error', 'boom')),
      currentBranch: vi.fn(async () => err('git-current-branch-error', 'not a repo')),
    });
    const params = await makeParams({ git, branchOptions: GROUPED });

    const result = await createEdt(params);

    if (!result.ok) throw new Error('expected ok');
    const added = calls(params.edtRegistry.add);
    expect((added[0][0] as EdtRegistryEntry).members.find((m) => m.service === 'svc-/repo/a')).toBeUndefined();
  });

  it('excludes a member when createBranch fails and the fallback current branch is shared', async () => {
    const git = fakeGit({
      createBranch: vi.fn(async () => err('base-branch-missing', 'base missing')),
      currentBranch: vi.fn(async () => ok('development')),
    });
    const params = await makeParams({ git, branchOptions: GROUPED });

    const result = await createEdt(params);

    if (!result.ok) throw new Error('expected ok');
    expect(result.data.results).toEqual([
      { service: 'svc-/repo/a', outcome: 'failed', detail: { code: 'base-branch-missing', message: 'base missing' } },
      { service: 'svc-/repo/b', outcome: 'failed', detail: { code: 'base-branch-missing', message: 'base missing' } },
    ]);
    const added = calls(params.edtRegistry.add);
    expect((added[0][0] as EdtRegistryEntry).members).toEqual([]);
  });

  it('reports a member whose manifest fails to load as a per-service failure', async () => {
    const manifest = fakeManifest({
      load: vi.fn(async (path: string) =>
        path === '/repo/a' ? err('manifest-not-found', 'no manifest') : ok(manifestFor(path)),
      ),
    });
    const git = fakeGit({ currentBranch: vi.fn(async () => ok('feature-x')) });
    const params = await makeParams({ manifest, git });

    const result = await createEdt(params);

    if (!result.ok) throw new Error('expected ok');
    expect(result.data.results[0]).toEqual({
      service: '/repo/a',
      outcome: 'failed',
      detail: { code: 'manifest-not-found', message: 'no manifest' },
    });
    expect(result.data.results[1]).toEqual({ service: 'svc-/repo/b', outcome: 'existing-branch' });
  });
});

describe('createEdt — registry write under lock (AD-9)', () => {
  it('writes the EDT registry entry inside the per-resource action lock', async () => {
    const lock = fakeLock();
    const params = await makeParams({ lock });

    const result = await createEdt(params);

    expect(result).toMatchObject({ ok: true });
    expect(calls(lock.acquire)).toEqual([['/cfg/edts.yaml']]);
    expect(calls(params.edtRegistry.add)).toHaveLength(1);
  });

  it('rolls back the EDT dir/db when the registry write fails and propagates the error', async () => {
    const edtRegistry = fakeEdtRegistry({ add: async () => err('edt-registry-write-error', 'disk full') });
    const params = await makeParams({ edtRegistry });

    const result = await createEdt(params);

    expect(result).toMatchObject({ ok: false, error: { code: 'edt-registry-write-error' } });
    // The EDT dir and db must not survive the failed creation.
    expect(await readdir(params.edtsBaseDir)).toEqual([]);
  });

  it('rolls back the created branches when the registry write fails (branch rollback)', async () => {
    const edtRegistry = fakeEdtRegistry({ add: async () => err('edt-registry-write-error', 'disk full') });
    const git = fakeGit();
    const params = await makeParams({ edtRegistry, git, branchOptions: GROUPED });

    const result = await createEdt(params);

    expect(result).toMatchObject({ ok: false, error: { code: 'edt-registry-write-error' } });
    // Every branch that was created in this run is deleted again, in the same order.
    expect(calls(git.deleteBranch)).toEqual([
      ['/repo/a', 'feat/x', true],
      ['/repo/b', 'feat/x', true],
    ]);
    // Only created branches are rolled back — failed/existing members are left alone.
    expect(calls(git.createBranch)).toHaveLength(2);
    expect(await readdir(params.edtsBaseDir)).toEqual([]);
  });

  it('does not delete branches when the registry write succeeds', async () => {
    const params = await makeParams({ branchOptions: GROUPED });

    const result = await createEdt(params);

    expect(result).toMatchObject({ ok: true });
    expect(calls(params.git.deleteBranch)).toHaveLength(0);
  });

  it('re-checks topic uniqueness inside the lock and rejects a same-topic entry added meanwhile (race)', async () => {
    // Simulates the authoritative in-lock check: the pre-lock fast-fail saw an empty
    // registry, but by the time the lock is held another run has registered the topic.
    const edtRegistry = fakeEdtRegistry({
      list: vi
        .fn()
        .mockResolvedValueOnce(ok([])) // pre-lock fast-fail
        .mockResolvedValueOnce(ok([entry('other-ulid', 'demo')])), // in-lock re-check
    });
    const git = fakeGit();
    const params = await makeParams({ edtRegistry, git, branchOptions: GROUPED });

    const result = await createEdt(params);

    expect(result).toMatchObject({ ok: false, error: { code: 'edt-topic-exists' } });
    expect(calls(edtRegistry.add)).toHaveLength(0);
    // The branches this run created are rolled back even though the lock was held.
    expect(calls(git.deleteBranch)).toEqual([
      ['/repo/a', 'feat/x', true],
      ['/repo/b', 'feat/x', true],
    ]);
    expect(await readdir(params.edtsBaseDir)).toEqual([]);
  });
});

describe('createEdt — per-member branch plans', () => {
  // A git fake whose local/remote branch state is declared per repo: branchExistsLocally and
  // listRemoteBranches answer from these tables instead of fakeGit's blanket defaults.
  function planGit(
    state: { local?: Record<string, string[]>; remote?: Record<string, string[]> } = {},
    overrides: Partial<GitPort> = {},
  ): GitPort {
    return fakeGit({
      branchExistsLocally: vi.fn(async (repoPath: string, branchName: string) =>
        ok((state.local?.[repoPath] ?? []).includes(branchName)),
      ),
      listRemoteBranches: vi.fn(async (repoPath: string) => ok(state.remote?.[repoPath] ?? [])),
      ...overrides,
    });
  }

  async function makePlanParams(
    memberPlans: Record<string, MemberBranchPlan>,
    overrides: Partial<CreateEdtParams> = {},
  ): Promise<CreateEdtParams> {
    const params = await makeParams(overrides);
    delete params.branchOptions;
    return { ...params, memberPlans };
  }

  function gitWrites(git: GitPort): number {
    return (
      calls(git.createBranch).length +
      calls(git.createTrackingBranch).length +
      calls(git.renameBranch).length +
      calls(git.deleteBranch).length
    );
  }

  function registeredMembers(params: CreateEdtParams): unknown {
    return (calls(params.edtRegistry.add)[0][0] as EdtRegistryEntry).members;
  }

  describe('validation before any write', () => {
    async function expectRejected(params: CreateEdtParams): Promise<void> {
      const result = await createEdt(params);

      expect(result).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
      expect(calls(params.edtRegistry.add)).toHaveLength(0);
      expect(gitWrites(params.git)).toBe(0);
      expect(calls(params.git.branchExistsLocally)).toHaveLength(0);
      expect(await readdir(params.edtsBaseDir)).toEqual([]);
    }

    it('rejects when neither branchOptions nor memberPlans is provided', async () => {
      const params = await makeParams();
      delete params.branchOptions;

      await expectRejected(params);
    });

    it('rejects a member without a plan', async () => {
      await expectRejected(
        await makePlanParams({ '/repo/a': { kind: 'create', base: 'development', name: 'feat/x' } }),
      );
    });

    it('rejects a plan keyed by a path that is not a member', async () => {
      await expectRejected(
        await makePlanParams({
          '/repo/a': { kind: 'create', base: 'development', name: 'feat/x' },
          '/repo/b': { kind: 'create', base: 'development', name: 'feat/x' },
          '/repo/c': { kind: 'create', base: 'development', name: 'feat/x' },
        }),
      );
    });

    it.each([
      ['an empty create base', { kind: 'create', base: '', name: 'feat/x' }],
      ['a blank create name', { kind: 'create', base: 'development', name: '  ' }],
      ['an empty existing branch', { kind: 'existing', branch: '' }],
      ['an empty existing renameTo', { kind: 'existing', branch: 'feat/y', renameTo: '' }],
    ] as Array<[string, MemberBranchPlan]>)('rejects %s', async (_label, plan) => {
      await expectRejected(
        await makePlanParams({ '/repo/a': plan, '/repo/b': { kind: 'existing', branch: 'feat/y' } }),
      );
    });

    it('rejects a null memberPlans (untyped caller) instead of throwing', async () => {
      const params = await makePlanParams(null as unknown as Record<string, MemberBranchPlan>);

      await expectRejected(params);
    });

    it('rejects two plan keys resolving to the same member', async () => {
      await expectRejected(
        await makePlanParams({
          '/repo/a': { kind: 'create', base: 'development', name: 'feat/x' },
          '/repo/a/': { kind: 'create', base: 'development', name: 'feat/y' },
          '/repo/b': { kind: 'create', base: 'development', name: 'feat/x' },
        }),
      );
    });

    it.each([
      ['an unknown plan kind', { kind: 'bogus', branch: 'feat/y' }],
      ['a non-object plan', 'feat/y'],
      ['a null plan', null],
    ])('rejects %s (runtime guard)', async (_label, plan) => {
      await expectRejected(
        await makePlanParams({
          '/repo/a': plan as unknown as MemberBranchPlan,
          '/repo/b': { kind: 'existing', branch: 'feat/y' },
        }),
      );
    });

    it('resolve()s plan keys like members (a trailing slash still matches)', async () => {
      const git = planGit();
      const params = await makePlanParams(
        {
          '/repo/a/': { kind: 'create', base: 'development', name: 'feat/x' },
          '/repo/b': { kind: 'create', base: 'development', name: 'feat/x' },
        },
        { git },
      );

      const result = await createEdt(params);

      expect(result).toMatchObject({ ok: true });
      expect(calls(git.createBranch)).toEqual([
        ['/repo/a', 'feat/x', 'development'],
        ['/repo/b', 'feat/x', 'development'],
      ]);
    });

    it('ignores branchOptions entirely when memberPlans is present (authoritative)', async () => {
      const git = planGit();
      const params = await makePlanParams(
        {
          '/repo/a': { kind: 'create', base: 'develop', name: 'feat/a' },
          '/repo/b': { kind: 'create', base: 'origin/release', name: 'feat/b' },
        },
        { git },
      );
      params.branchOptions = GROUPED;

      const result = await createEdt(params);

      expect(result).toMatchObject({ ok: true });
      expect(calls(git.createBranch)).toEqual([
        ['/repo/a', 'feat/a', 'develop'],
        ['/repo/b', 'feat/b', 'origin/release'],
      ]);
    });
  });

  it('create plans: each member uses its own base and name (local and remote bases), never checked out', async () => {
    const git = planGit();
    const params = await makePlanParams(
      {
        '/repo/a': { kind: 'create', base: 'develop', name: 'feat/x' },
        '/repo/b': { kind: 'create', base: 'origin/release', name: 'feat/r' },
      },
      { git },
    );

    const result = await createEdt(params);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.results).toEqual([
      { service: 'svc-/repo/a', outcome: 'created' },
      { service: 'svc-/repo/b', outcome: 'created' },
    ]);
    expect(calls(git.createBranch)).toEqual([
      ['/repo/a', 'feat/x', 'develop'],
      ['/repo/b', 'feat/r', 'origin/release'],
    ]);
    expect(calls(git.checkout)).toHaveLength(0);
    expect(calls(git.fetch)).toHaveLength(0);
    expect(registeredMembers(params)).toEqual([
      { service: 'svc-/repo/a', repoPath: '/repo/a', branch: 'feat/x' },
      { service: 'svc-/repo/b', repoPath: '/repo/b', branch: 'feat/r' },
    ]);
  });

  it('create plan: a missing base fails only that member with base-branch-missing', async () => {
    const git = planGit(
      {},
      {
        createBranch: vi.fn(async (repoPath: string) =>
          repoPath === '/repo/a' ? err('base-branch-missing', 'Base branch "origin/nope" does not exist') : ok(undefined),
        ),
      },
    );
    const params = await makePlanParams(
      {
        '/repo/a': { kind: 'create', base: 'origin/nope', name: 'feat/x' },
        '/repo/b': { kind: 'create', base: 'develop', name: 'feat/x' },
      },
      { git },
    );

    const result = await createEdt(params);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.results[0]).toMatchObject({ outcome: 'failed', detail: { code: 'base-branch-missing' } });
    expect(result.data.results[1]).toEqual({ service: 'svc-/repo/b', outcome: 'created' });
    expect(registeredMembers(params)).toEqual([{ service: 'svc-/repo/b', repoPath: '/repo/b', branch: 'feat/x' }]);
  });

  it('existing local branch: gated, reused as-is with outcome existing-branch', async () => {
    const git = planGit({ local: { '/repo/a': ['feat/y'], '/repo/b': ['feat/w'] } });
    const params = await makePlanParams(
      { '/repo/a': { kind: 'existing', branch: 'feat/y' }, '/repo/b': { kind: 'existing', branch: 'feat/w' } },
      { git },
    );

    const result = await createEdt(params);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.results.map((row) => row.outcome)).toEqual(['existing-branch', 'existing-branch']);
    expect(calls(git.assertAllowedBranch)).toEqual([
      ['/repo/a', 'feat/y', result.data.ulid],
      ['/repo/b', 'feat/w', result.data.ulid],
    ]);
    expect(gitWrites(git)).toBe(0);
    expect(calls(git.listRemoteBranches)).toHaveLength(0);
    expect(registeredMembers(params)).toEqual([
      { service: 'svc-/repo/a', repoPath: '/repo/a', branch: 'feat/y' },
      { service: 'svc-/repo/b', repoPath: '/repo/b', branch: 'feat/w' },
    ]);
  });

  it('existing local protected branch fails with shared-branch-rejected and is not registered', async () => {
    const git = planGit({ local: { '/repo/a': ['development'], '/repo/b': ['feat/w'] } });
    const params = await makePlanParams(
      { '/repo/a': { kind: 'existing', branch: 'development' }, '/repo/b': { kind: 'existing', branch: 'feat/w' } },
      { git },
    );

    const result = await createEdt(params);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.results[0]).toMatchObject({ outcome: 'failed', detail: { code: 'shared-branch-rejected' } });
    expect(result.data.results[1]).toEqual({ service: 'svc-/repo/b', outcome: 'existing-branch' });
    expect(registeredMembers(params)).toEqual([{ service: 'svc-/repo/b', repoPath: '/repo/b', branch: 'feat/w' }]);
  });

  it('existing local branch + renameTo: renamed, registered under the new name', async () => {
    const git = planGit({ local: { '/repo/a': ['feat/y'], '/repo/b': ['feat/w'] } });
    const params = await makePlanParams(
      {
        '/repo/a': { kind: 'existing', branch: 'feat/y', renameTo: 'feat/z' },
        '/repo/b': { kind: 'existing', branch: 'feat/w' },
      },
      { git },
    );

    const result = await createEdt(params);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.results[0]).toEqual({ service: 'svc-/repo/a', outcome: 'renamed' });
    expect(calls(git.renameBranch)).toEqual([['/repo/a', 'feat/y', 'feat/z']]);
    expect(registeredMembers(params)).toEqual([
      { service: 'svc-/repo/a', repoPath: '/repo/a', branch: 'feat/z' },
      { service: 'svc-/repo/b', repoPath: '/repo/b', branch: 'feat/w' },
    ]);
  });

  it('existing local branch + renameTo: a protected old or new name fails only that member', async () => {
    const git = planGit(
      { local: { '/repo/a': ['development'], '/repo/b': ['feat/w'] } },
      {
        renameBranch: vi.fn(async (_repoPath: string, oldName: string, newName: string) =>
          MANIFEST_PROTECTED_BRANCHES.includes(oldName) || MANIFEST_PROTECTED_BRANCHES.includes(newName)
            ? err('shared-branch-rejected', 'protected')
            : ok(undefined),
        ),
      },
    );
    const params = await makePlanParams(
      {
        '/repo/a': { kind: 'existing', branch: 'development', renameTo: 'feat/z' },
        '/repo/b': { kind: 'existing', branch: 'feat/w', renameTo: 'prod' },
      },
      { git },
    );

    const result = await createEdt(params);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.results.map((row) => row.detail?.code)).toEqual([
      'shared-branch-rejected',
      'shared-branch-rejected',
    ]);
    expect(registeredMembers(params)).toEqual([]);
  });

  it('existing local branch + renameTo equal to branch: no rename, gated, outcome existing-branch', async () => {
    const git = planGit({ local: { '/repo/a': ['feat/y'], '/repo/b': ['feat/w'] } });
    const params = await makePlanParams(
      {
        '/repo/a': { kind: 'existing', branch: 'feat/y', renameTo: 'feat/y' },
        '/repo/b': { kind: 'existing', branch: 'feat/w' },
      },
      { git },
    );

    const result = await createEdt(params);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.results[0]).toEqual({ service: 'svc-/repo/a', outcome: 'existing-branch' });
    expect(calls(git.renameBranch)).toHaveLength(0);
    expect(calls(git.assertAllowedBranch).map((args) => args.slice(0, 2))).toContainEqual(['/repo/a', 'feat/y']);
    expect(registeredMembers(params)).toContainEqual({ service: 'svc-/repo/a', repoPath: '/repo/a', branch: 'feat/y' });
  });

  describe('cross-EDT gate on existing local branches (AD-8)', () => {
    // Rejects feat/owned as another EDT's own branch whenever an edtId is passed.
    function crossEdtGit(): GitPort {
      return planGit(
        { local: { '/repo/a': ['feat/owned'], '/repo/b': ['feat/w'] } },
        {
          assertAllowedBranch: vi.fn(async (_repoPath: string, branchName: string, edtId?: string) =>
            edtId !== undefined && branchName === 'feat/owned'
              ? err('branch-owned-by-other-edt', `Branch "${branchName}" belongs to another EDT`)
              : ok(undefined),
          ),
        },
      );
    }

    it.each([
      ['attached as-is', { kind: 'existing', branch: 'feat/owned' }],
      ['renamed away', { kind: 'existing', branch: 'feat/owned', renameTo: 'feat/mine' }],
    ] as Array<[string, MemberBranchPlan]>)(
      'rejects a branch owned by another EDT being %s, with the new EDT ulid as edtId',
      async (_label, plan) => {
        const git = crossEdtGit();
        const params = await makePlanParams(
          { '/repo/a': plan, '/repo/b': { kind: 'existing', branch: 'feat/w' } },
          { git },
        );

        const result = await createEdt(params);

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.data.results[0]).toMatchObject({
          outcome: 'failed',
          detail: { code: 'branch-owned-by-other-edt' },
        });
        expect(result.data.results[1]).toEqual({ service: 'svc-/repo/b', outcome: 'existing-branch' });
        expect(calls(git.renameBranch)).toHaveLength(0);
        expect(calls(git.assertAllowedBranch)).toEqual([
          ['/repo/a', 'feat/owned', result.data.ulid],
          ['/repo/b', 'feat/w', result.data.ulid],
        ]);
        expect(registeredMembers(params)).toEqual([
          { service: 'svc-/repo/b', repoPath: '/repo/b', branch: 'feat/w' },
        ]);
      },
    );
  });

  it('existing remote-only branch: tracking branch with the remote segment stripped, outcome created', async () => {
    const git = planGit({ local: { '/repo/b': ['feat/w'] }, remote: { '/repo/a': ['origin/development', 'origin/feat/q'] } });
    const params = await makePlanParams(
      { '/repo/a': { kind: 'existing', branch: 'origin/feat/q' }, '/repo/b': { kind: 'existing', branch: 'feat/w' } },
      { git },
    );

    const result = await createEdt(params);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.results[0]).toEqual({ service: 'svc-/repo/a', outcome: 'created' });
    expect(calls(git.createTrackingBranch)).toEqual([['/repo/a', 'feat/q', 'origin/feat/q']]);
    expect(calls(git.fetch)).toHaveLength(0);
    expect(registeredMembers(params)).toEqual([
      { service: 'svc-/repo/a', repoPath: '/repo/a', branch: 'feat/q' },
      { service: 'svc-/repo/b', repoPath: '/repo/b', branch: 'feat/w' },
    ]);
  });

  it('existing remote-only branch: a colliding local name surfaces branch-exists as that member\'s failure', async () => {
    const git = planGit(
      { local: { '/repo/b': ['feat/w'] }, remote: { '/repo/a': ['origin/feat/q'] } },
      { createTrackingBranch: vi.fn(async () => err('branch-exists', 'Branch "feat/q" already exists')) },
    );
    const params = await makePlanParams(
      { '/repo/a': { kind: 'existing', branch: 'origin/feat/q' }, '/repo/b': { kind: 'existing', branch: 'feat/w' } },
      { git },
    );

    const result = await createEdt(params);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.results[0]).toMatchObject({ outcome: 'failed', detail: { code: 'branch-exists' } });
    expect(registeredMembers(params)).toEqual([{ service: 'svc-/repo/b', repoPath: '/repo/b', branch: 'feat/w' }]);
  });

  it('existing remote-only branch + renameTo: tracking branch under the new name', async () => {
    const git = planGit({ local: { '/repo/b': ['feat/w'] }, remote: { '/repo/a': ['origin/feat/q'] } });
    const params = await makePlanParams(
      {
        '/repo/a': { kind: 'existing', branch: 'origin/feat/q', renameTo: 'mine' },
        '/repo/b': { kind: 'existing', branch: 'feat/w' },
      },
      { git },
    );

    const result = await createEdt(params);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.results[0]).toEqual({ service: 'svc-/repo/a', outcome: 'created' });
    expect(calls(git.createTrackingBranch)).toEqual([['/repo/a', 'mine', 'origin/feat/q']]);
    expect(calls(git.renameBranch)).toHaveLength(0);
    expect(registeredMembers(params)).toContainEqual({ service: 'svc-/repo/a', repoPath: '/repo/a', branch: 'mine' });
  });

  it('existing remote-only branch + protected renameTo fails only that member', async () => {
    const git = planGit(
      { local: { '/repo/b': ['feat/w'] }, remote: { '/repo/a': ['origin/feat/q'] } },
      {
        createTrackingBranch: vi.fn(async (_repoPath: string, localName: string) =>
          MANIFEST_PROTECTED_BRANCHES.includes(localName) ? err('shared-branch-rejected', 'protected') : ok(undefined),
        ),
      },
    );
    const params = await makePlanParams(
      {
        '/repo/a': { kind: 'existing', branch: 'origin/feat/q', renameTo: 'preprod' },
        '/repo/b': { kind: 'existing', branch: 'feat/w' },
      },
      { git },
    );

    const result = await createEdt(params);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.results[0]).toMatchObject({ outcome: 'failed', detail: { code: 'shared-branch-rejected' } });
    expect(registeredMembers(params)).toEqual([{ service: 'svc-/repo/b', repoPath: '/repo/b', branch: 'feat/w' }]);
  });

  it('existing branch found neither locally nor remotely fails with branch-missing; the EDT is still created', async () => {
    const git = planGit({ local: { '/repo/b': ['feat/w'] }, remote: { '/repo/a': ['origin/feat/q'] } });
    const params = await makePlanParams(
      { '/repo/a': { kind: 'existing', branch: 'nope' }, '/repo/b': { kind: 'existing', branch: 'feat/w' } },
      { git },
    );

    const result = await createEdt(params);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.results[0]).toMatchObject({ outcome: 'failed', detail: { code: 'branch-missing' } });
    expect(gitWrites(git)).toBe(0);
    expect(registeredMembers(params)).toEqual([{ service: 'svc-/repo/b', repoPath: '/repo/b', branch: 'feat/w' }]);
  });

  it('a local branch wins over a remote-tracking ref of the same spelling', async () => {
    const git = planGit({
      local: { '/repo/a': ['origin/feat/q'], '/repo/b': ['feat/w'] },
      remote: { '/repo/a': ['origin/feat/q'] },
    });
    const params = await makePlanParams(
      { '/repo/a': { kind: 'existing', branch: 'origin/feat/q' }, '/repo/b': { kind: 'existing', branch: 'feat/w' } },
      { git },
    );

    const result = await createEdt(params);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.results[0]).toEqual({ service: 'svc-/repo/a', outcome: 'existing-branch' });
    expect(calls(git.createTrackingBranch)).toHaveLength(0);
  });

  it('a git read error while resolving an existing branch fails only that member', async () => {
    const git = planGit(
      { local: { '/repo/b': ['feat/w'] } },
      { listRemoteBranches: vi.fn(async () => err('git-list-remote-branches-error', 'boom')) },
    );
    const params = await makePlanParams(
      { '/repo/a': { kind: 'existing', branch: 'origin/feat/q' }, '/repo/b': { kind: 'existing', branch: 'feat/w' } },
      { git },
    );

    const result = await createEdt(params);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.results[0]).toMatchObject({
      outcome: 'failed',
      detail: { code: 'git-list-remote-branches-error' },
    });
    expect(result.data.results[1]).toEqual({ service: 'svc-/repo/b', outcome: 'existing-branch' });
  });

  it('registry write failure: created + tracking branches force-deleted, renamed branches renamed back, existing left alone', async () => {
    const members = ['/repo/a', '/repo/b', '/repo/c', '/repo/d'];
    const edtRegistry = fakeEdtRegistry({ add: async () => err('edt-registry-write-error', 'disk full') });
    const git = planGit({
      local: { '/repo/c': ['feat/y'], '/repo/d': ['feat/keep'] },
      remote: { '/repo/b': ['origin/feat/q'] },
    });
    const params = await makePlanParams(
      {
        '/repo/a': { kind: 'create', base: 'develop', name: 'feat/x' },
        '/repo/b': { kind: 'existing', branch: 'origin/feat/q' },
        '/repo/c': { kind: 'existing', branch: 'feat/y', renameTo: 'feat/z' },
        '/repo/d': { kind: 'existing', branch: 'feat/keep' },
      },
      { edtRegistry, git, members },
    );

    const result = await createEdt(params);

    expect(result).toMatchObject({ ok: false, error: { code: 'edt-registry-write-error' } });
    expect(await readdir(params.edtsBaseDir)).toEqual([]);
    expect(calls(git.deleteBranch)).toEqual([
      ['/repo/a', 'feat/x', true],
      ['/repo/b', 'feat/q', true],
    ]);
    expect(calls(git.renameBranch)).toEqual([
      ['/repo/c', 'feat/y', 'feat/z'],
      ['/repo/c', 'feat/z', 'feat/y'],
    ]);
  });

  it('registry write failure: each rollback failure is logged, never thrown', async () => {
    const edtRegistry = fakeEdtRegistry({ add: async () => err('edt-registry-write-error', 'disk full') });
    const git = planGit(
      { local: { '/repo/b': ['feat/y'] } },
      {
        deleteBranch: vi.fn(async () => err('git-delete-branch-error', 'delete boom')),
        renameBranch: vi
          .fn()
          .mockResolvedValueOnce(ok(undefined))
          .mockResolvedValueOnce(err('git-rename-branch-error', 'rename boom')),
      },
    );
    const params = await makePlanParams(
      {
        '/repo/a': { kind: 'create', base: 'develop', name: 'feat/x' },
        '/repo/b': { kind: 'existing', branch: 'feat/y', renameTo: 'feat/z' },
      },
      { edtRegistry, git },
    );
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const result = await createEdt(params);

      expect(result).toMatchObject({ ok: false, error: { code: 'edt-registry-write-error' } });
      const logged = consoleError.mock.calls.map((args) => args.join(' '));
      expect(logged.some((line) => line.includes('feat/x') && line.includes('delete boom'))).toBe(true);
      expect(logged.some((line) => line.includes('feat/z') && line.includes('rename boom'))).toBe(true);
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe('listCreateCandidateBranches', () => {
  it('returns the local and remote-tracking lists side by side, never fetching', async () => {
    const git = fakeGit({
      listBranches: vi.fn(async () => ok(['main', 'rel'])),
      listRemoteBranches: vi.fn(async () => ok(['origin/rel', 'origin/x'])),
    });
    const result = await listCreateCandidateBranches(git, '/repo/a');
    expect(result).toEqual({ ok: true, data: { local: ['main', 'rel'], remote: ['origin/rel', 'origin/x'] } });
    expect(calls(git.fetch)).toHaveLength(0);
  });

  it('fails when the local list cannot be read', async () => {
    const git = fakeGit({ listBranches: vi.fn(async () => err('git-error', 'boom')) });
    const result = await listCreateCandidateBranches(git, '/repo/a');
    expect(result.ok).toBe(false);
  });

  it('fails when the remote list cannot be read', async () => {
    const git = fakeGit({ listRemoteBranches: vi.fn(async () => err('git-error', 'boom')) });
    const result = await listCreateCandidateBranches(git, '/repo/a');
    expect(result).toEqual({ ok: false, error: { code: 'git-error', message: 'boom' } });
  });
});
