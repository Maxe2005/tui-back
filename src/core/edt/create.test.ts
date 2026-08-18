// core/edt/create: unit tests against fake ports (AD-13 core layer) — every I/O-matrix row
// of story 2.2 plus the validation-ordering guarantees. Real git/filesystem behavior lives
// in adapters/driven/git/index.test.ts and the black-box e2e; here only the use-case's
// orchestration is exercised: validation order (topic/membership/duplicate-topic before any
// write), the per-member branch loop, failure isolation, and the registry write under the
// per-resource lock. createEdt still performs its own real EDT-dir/db writes (pre-existing
// Story 2.1 behavior), so edtsBaseDir points at a per-test temp dir.
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
import { createEdt, type CreateBranchOptions, type CreateEdtParams } from './create.js';

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
    ...overrides,
  };
}

function fakeLock(): LockPort {
  return {
    acquire: vi.fn(async () => ok({ release: vi.fn(async () => ok(undefined)) })),
  };
}

const SHARED_BRANCHES = ['development', 'preprod', 'prod'];

function fakeGit(overrides: Partial<GitPort> = {}): GitPort {
  return {
    assertAllowedBranch: vi.fn(async (_repoPath: string, branchName: string) =>
      SHARED_BRANCHES.includes(branchName)
        ? err('shared-branch-rejected', `Branch "${branchName}" is a shared/protected branch`)
        : ok(undefined),
    ),
    createBranch: vi.fn(async () => ok(undefined)),
    deleteBranch: vi.fn(async () => ok(undefined)),
    currentBranch: vi.fn(async () => ok('development')),
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

  it('rejects a member that is not a registered managed repo with invalid-member (matrix)', async () => {
    const params = await makeParams({ members: ['/repo/a', '/not/registered'], registry: fakeRegistry(['/repo/a']) });

    const result = await createEdt(params);

    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-member' } });
    expect(calls(params.edtRegistry.add)).toHaveLength(0);
  });

  it('rejects a duplicate topic with edt-topic-exists before any write (AC2)', async () => {
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

  it('rejects and excludes a member whose current branch is shared, without any git write (story 2.3 matrix)', async () => {
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
  it('creates one shared branch in every member and registers it (grouped, AC1)', async () => {
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

  it('creates one branch per member by name map (individual, AC1)', async () => {
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
});

describe('createEdt — per-service failure isolation (AC3)', () => {
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
    // A does not join the EDT: a failed member is never registered (story 2.3), even
    // though its current branch could have been read as a fallback.
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

  it('excludes a member when createBranch fails and the fallback current branch is shared (story 2.3 matrix)', async () => {
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

  it('rolls back the created branches when the registry write fails (branch rollback, review)', async () => {
    const edtRegistry = fakeEdtRegistry({ add: async () => err('edt-registry-write-error', 'disk full') });
    const git = fakeGit();
    const params = await makeParams({ edtRegistry, git, branchOptions: GROUPED });

    const result = await createEdt(params);

    expect(result).toMatchObject({ ok: false, error: { code: 'edt-registry-write-error' } });
    // Every branch that was created in this run is deleted again, in the same order.
    expect(calls(git.deleteBranch)).toEqual([
      ['/repo/a', 'feat/x'],
      ['/repo/b', 'feat/x'],
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

  it('re-checks topic uniqueness inside the lock and rejects a same-topic entry added meanwhile (race, review)', async () => {
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
      ['/repo/a', 'feat/x'],
      ['/repo/b', 'feat/x'],
    ]);
    expect(await readdir(params.edtsBaseDir)).toEqual([]);
  });
});
