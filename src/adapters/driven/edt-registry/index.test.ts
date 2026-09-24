// adapters/driven/edt-registry: integration tests against real temp files (AD-13 driven
// layer). The schema is strict on purpose — story 2.2 evolved the entry shape in place
// (AD-7), replacing the 2.1 single `branch` placeholder with `topic` + per-member
// `members: [...]`. No real 2.1-shape data exists (verified at review time), so a legacy
// 2.1 entry is intentionally rejected as edt-registry-invalid-format rather than migrated;
// a migration decision is tracked separately.
import { describe, expect, it, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { createEdtRegistryPort } from './index.js';
import { modifyEdt } from '../../../core/edt/modify.js';
import { ok, type Result } from '../../../core/result.js';
import type { GitPort } from '../../../core/ports/git.js';
import type { ManifestPort } from '../../../core/ports/manifest.js';
import type { RegistryPort } from '../../../core/ports/registry.js';
import type { LockPort } from '../../../core/ports/lock.js';

const tmpDirs: string[] = [];

afterEach(async () => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

async function makeRegistryFile(): Promise<{ file: string; edtsBaseDir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'tui-back-edt-registry-'));
  tmpDirs.push(dir);
  return { file: join(dir, 'edts.yaml'), edtsBaseDir: dir };
}

describe('edt-registry list()', () => {
  it('round-trips a new-shape registry file ({ulid, topic, createdAt, status, members})', async () => {
    const { file, edtsBaseDir } = await makeRegistryFile();
    const entry = {
      ulid: '01JXXXXX1AAAAAAAAAAAAAAAAA',
      topic: 'demo',
      createdAt: '2026-08-18T00:00:00.000Z',
      status: 'active',
      members: [],
    };
    await writeFile(file, stringify({ edts: [entry] }));

    const port = createEdtRegistryPort(file, edtsBaseDir);

    expect(await port.list()).toEqual({ ok: true, data: [entry] });
  });

  it('round-trips per-member entries including their branches', async () => {
    const { file, edtsBaseDir } = await makeRegistryFile();
    const entry = {
      ulid: '01JXXXXX1AAAAAAAAAAAAAAAAA',
      topic: 'demo',
      createdAt: '2026-08-18T00:00:00.000Z',
      status: 'active',
      members: [{ service: 'route-explorer', repoPath: '/repos/a', branch: 'feat/x' }],
    };
    await writeFile(file, stringify({ edts: [entry] }));

    const port = createEdtRegistryPort(file, edtsBaseDir);

    expect(await port.list()).toEqual({ ok: true, data: [entry] });
    expect(await readFile(file, 'utf8')).toBe(stringify({ edts: [entry] }));
  });

  it('rejects a legacy 2.1-shape entry (ulid/branch, no topic/members) as edt-registry-invalid-format', async () => {
    const { file, edtsBaseDir } = await makeRegistryFile();
    await writeFile(
      file,
      stringify({ edts: [{ ulid: '01JXXXXX1AAAAAAAAAAAAAAAAA', branch: 'edt-01JXXXXX1AAAAAAAAAAAAAAAAA', createdAt: '2026-08-18T00:00:00.000Z', status: 'active' }] }),
    );

    const port = createEdtRegistryPort(file, edtsBaseDir);

    const result = await port.list();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('edt-registry-invalid-format');
    }
  });
});

// Story 2.4: setStatus is a read/find/replace/write, mirroring addEdtRegistryEntry's shape.
describe('edt-registry setStatus()', () => {
  it('updates only the matching entry, leaving others and their fields untouched', async () => {
    const { file, edtsBaseDir } = await makeRegistryFile();
    const entryA = {
      ulid: '01JXXXXX1AAAAAAAAAAAAAAAAA',
      topic: 'a',
      createdAt: '2026-08-18T00:00:00.000Z',
      status: 'active',
      members: [{ service: 'route-explorer', repoPath: '/repos/a', branch: 'feat/x' }],
    };
    const entryB = {
      ulid: '01JXXXXX2BBBBBBBBBBBBBBBBB',
      topic: 'b',
      createdAt: '2026-08-18T01:00:00.000Z',
      status: 'active',
      members: [],
    };
    await writeFile(file, stringify({ edts: [entryA, entryB] }));
    const port = createEdtRegistryPort(file, edtsBaseDir);

    const result = await port.setStatus(entryA.ulid, 'inactive');

    expect(result).toEqual({ ok: true, data: undefined });
    expect(await port.list()).toEqual({
      ok: true,
      data: [{ ...entryA, status: 'inactive' }, entryB],
    });
  });

  it('fails with edt-not-found for an unregistered ulid, without writing anything', async () => {
    const { file, edtsBaseDir } = await makeRegistryFile();
    const entry = {
      ulid: '01JXXXXX1AAAAAAAAAAAAAAAAA',
      topic: 'demo',
      createdAt: '2026-08-18T00:00:00.000Z',
      status: 'active',
      members: [],
    };
    await writeFile(file, stringify({ edts: [entry] }));
    const port = createEdtRegistryPort(file, edtsBaseDir);

    const result = await port.setStatus('01JNOTFOUND0000000000000', 'inactive');

    expect(result).toMatchObject({ ok: false, error: { code: 'edt-not-found' } });
    expect(await port.list()).toEqual({ ok: true, data: [entry] });
  });

  it('creates the registry directory when it does not exist yet, on an empty registry', async () => {
    const { file, edtsBaseDir } = await makeRegistryFile();
    const port = createEdtRegistryPort(file, edtsBaseDir);

    const result = await port.setStatus('01JXXXXX1AAAAAAAAAAAAAAAAA', 'inactive');

    expect(result).toMatchObject({ ok: false, error: { code: 'edt-not-found' } });
  });
});

// Story 2.29: remove() is a read/find/filter/write, mirroring updateEdtEntry's shape above —
// removes the matching entry entirely (no soft-delete/undo, per the story's Boundaries).
describe('edt-registry remove()', () => {
  it('removes only the matching entry, leaving others and their fields untouched', async () => {
    const { file, edtsBaseDir } = await makeRegistryFile();
    const entryA = {
      ulid: '01JXXXXX1AAAAAAAAAAAAAAAAA',
      topic: 'a',
      createdAt: '2026-08-18T00:00:00.000Z',
      status: 'active',
      members: [{ service: 'route-explorer', repoPath: '/repos/a', branch: 'feat/x' }],
    };
    const entryB = {
      ulid: '01JXXXXX2BBBBBBBBBBBBBBBBB',
      topic: 'b',
      createdAt: '2026-08-18T01:00:00.000Z',
      status: 'active',
      members: [],
    };
    await writeFile(file, stringify({ edts: [entryA, entryB] }));
    const port = createEdtRegistryPort(file, edtsBaseDir);

    const result = await port.remove(entryA.ulid);

    expect(result).toEqual({ ok: true, data: undefined });
    expect(await port.list()).toEqual({ ok: true, data: [entryB] });
  });

  it('fails with edt-not-found for an unregistered ulid, without writing anything', async () => {
    const { file, edtsBaseDir } = await makeRegistryFile();
    const entry = {
      ulid: '01JXXXXX1AAAAAAAAAAAAAAAAA',
      topic: 'demo',
      createdAt: '2026-08-18T00:00:00.000Z',
      status: 'active',
      members: [],
    };
    await writeFile(file, stringify({ edts: [entry] }));
    const port = createEdtRegistryPort(file, edtsBaseDir);

    const result = await port.remove('01JNOTFOUND0000000000000');

    expect(result).toMatchObject({ ok: false, error: { code: 'edt-not-found' } });
    expect(await port.list()).toEqual({ ok: true, data: [entry] });
  });

  it('removing the last remaining entry leaves a valid, empty registry', async () => {
    const { file, edtsBaseDir } = await makeRegistryFile();
    const entry = {
      ulid: '01JXXXXX1AAAAAAAAAAAAAAAAA',
      topic: 'demo',
      createdAt: '2026-08-18T00:00:00.000Z',
      status: 'active',
      members: [],
    };
    await writeFile(file, stringify({ edts: [entry] }));
    const port = createEdtRegistryPort(file, edtsBaseDir);

    const result = await port.remove(entry.ulid);

    expect(result).toEqual({ ok: true, data: undefined });
    expect(await port.list()).toEqual({ ok: true, data: [] });
  });
});

// Story 2.5: update() is a read/find/replace/write, mirroring setStatus's shape.
describe('edt-registry update()', () => {
  it('updates only the topic', async () => {
    const { file, edtsBaseDir } = await makeRegistryFile();
    const entry = {
      ulid: '01JXXXXX1AAAAAAAAAAAAAAAAA',
      topic: 'original',
      createdAt: '2026-08-18T00:00:00.000Z',
      status: 'active',
      members: [{ service: 'route-explorer', repoPath: '/repos/a', branch: 'feat/x' }],
    };
    await writeFile(file, stringify({ edts: [entry] }));
    const port = createEdtRegistryPort(file, edtsBaseDir);

    const result = await port.update(entry.ulid, { topic: 'renamed' });

    expect(result).toEqual({ ok: true, data: undefined });
    expect(await port.list()).toEqual({
      ok: true,
      data: [{ ...entry, topic: 'renamed' }],
    });
  });

  it('updates only the members', async () => {
    const { file, edtsBaseDir } = await makeRegistryFile();
    const entry = {
      ulid: '01JXXXXX1AAAAAAAAAAAAAAAAA',
      topic: 'demo',
      createdAt: '2026-08-18T00:00:00.000Z',
      status: 'active',
      members: [{ service: 'route-explorer', repoPath: '/repos/a', branch: 'feat/x' }],
    };
    await writeFile(file, stringify({ edts: [entry] }));
    const port = createEdtRegistryPort(file, edtsBaseDir);

    const result = await port.update(entry.ulid, {
      members: [{ service: 'shared-types', repoPath: '/repos/b', branch: 'main' }],
    });

    expect(result).toEqual({ ok: true, data: undefined });
    expect(await port.list()).toEqual({
      ok: true,
      data: [{ ...entry, members: [{ service: 'shared-types', repoPath: '/repos/b', branch: 'main' }] }],
    });
  });

  it('updates both topic and members', async () => {
    const { file, edtsBaseDir } = await makeRegistryFile();
    const entry = {
      ulid: '01JXXXXX1AAAAAAAAAAAAAAAAA',
      topic: 'original',
      createdAt: '2026-08-18T00:00:00.000Z',
      status: 'active',
      members: [{ service: 'route-explorer', repoPath: '/repos/a', branch: 'feat/x' }],
    };
    await writeFile(file, stringify({ edts: [entry] }));
    const port = createEdtRegistryPort(file, edtsBaseDir);

    const result = await port.update(entry.ulid, {
      topic: 'renamed',
      members: [{ service: 'shared-types', repoPath: '/repos/b', branch: 'main' }],
    });

    expect(result).toEqual({ ok: true, data: undefined });
    expect(await port.list()).toEqual({
      ok: true,
      data: [{ ...entry, topic: 'renamed', members: [{ service: 'shared-types', repoPath: '/repos/b', branch: 'main' }] }],
    });
  });

  it('fails with edt-not-found for an unregistered ulid', async () => {
    const { file, edtsBaseDir } = await makeRegistryFile();
    const entry = {
      ulid: '01JXXXXX1AAAAAAAAAAAAAAAAA',
      topic: 'demo',
      createdAt: '2026-08-18T00:00:00.000Z',
      status: 'active',
      members: [],
    };
    await writeFile(file, stringify({ edts: [entry] }));
    const port = createEdtRegistryPort(file, edtsBaseDir);

    const result = await port.update('01JNOTFOUND0000000000000', {
      topic: 'new-topic',
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'edt-not-found' } });
    // Registry file should be unchanged
    expect(await readFile(file, 'utf8')).toEqual(
      stringify({ edts: [entry] }),
    );
  });

  it('leaves sibling entries untouched', async () => {
    const { file, edtsBaseDir } = await makeRegistryFile();
    const entryA = {
      ulid: '01JXXXXX1AAAAAAAAAAAAAAAAA',
      topic: 'a',
      createdAt: '2026-08-18T00:00:00.000Z',
      status: 'active',
      members: [],
    };
    const entryB = {
      ulid: '01JXXXXX2BBBBBBBBBBBBBBBBB',
      topic: 'b',
      createdAt: '2026-08-18T01:00:00.000Z',
      status: 'active',
      members: [{ service: 'route-explorer', repoPath: '/repos/a', branch: 'feat/x' }],
    };
    await writeFile(file, stringify({ edts: [entryA, entryB] }));
    const port = createEdtRegistryPort(file, edtsBaseDir);

    const result = await port.update(entryA.ulid, { topic: 'renamed-a' });

    expect(result).toEqual({ ok: true, data: undefined });
    expect(await port.list()).toEqual({
      ok: true,
      data: [{ ...entryA, topic: 'renamed-a' }, entryB],
    });
  });
});

// Story 2.9 regression: modify.ts computed added members / branch changes into `results`
// but never fed them back into the patch it wrote to the registry. This test drives
// modifyEdt end-to-end against a *real* createEdtRegistryPort (temp file, real update()) —
// not a mock that just echoes ok(undefined) — so a re-introduction of the bug (persisted
// entry silently missing the add/branch-change) fails this test instead of shipping
// undetected, the way it did the first time (see deferred-work.md, code review of 2-5).
describe('modifyEdt persistence (story 2.9 regression, real update())', () => {
  function fakeGit(overrides: Partial<GitPort> = {}): GitPort {
    return {
      assertAllowedBranch: async () => ok(undefined),
      createBranch: async () => ok(undefined),
      deleteBranch: async () => ok(undefined),
      currentBranch: async () => ok('feature-new'),
      aheadBehind: async () => ok({ ahead: 0, behind: 0 }),
      checkout: async () => ok(undefined),
      hasUncommittedChanges: async () => ok(false),
      stashSave: async () => ok(undefined),
      restoreStash: async () => ok(undefined),
      branchExistsLocally: async () => ok(true),
      fetch: async () => ok(undefined),
      pull: async () => ok(undefined),
      mergeBranch: async () => ok(undefined),
      abortMerge: async () => ok(undefined),
      isMergeInProgress: async () => ok(false),
      listDirtyPaths: async () => ok([]),
      discardPaths: async () => ok(undefined),
      isRebaseInProgress: async () => ok(false),
      hasUnmergedPaths: async () => ok(false),
      finalizeMerge: async () => ok(undefined),
      listBranches: async () => ok([]),
      renameBranch: async () => ok(undefined),
      listRemoteBranches: async () => ok([]),
      createTrackingBranch: async () => ok(undefined),
      isBranchMerged: async () => ok(true),
      hasStash: async () => ok(false),
      ...overrides,
    };
  }

  function fakeManifest(): ManifestPort {
    return {
      load: async (repoPath: string) =>
        ok({
          service: `service-${repoPath.split('/').pop()}`,
          container: 'ctr',
          migrationCommand: 'true',
          sharedBranch: 'development',
          modules: {},
        }),
    };
  }

  function fakeRegistry(paths: string[]): RegistryPort {
    return {
      list: async () => ok(paths),
      add: async () => ok(undefined),
      exists: async () => ok(true),
      scan: async () => ok({ candidates: [], skipped: [] }),
      reset: async () => ok({ path: paths[0] ?? '', backupPath: null }),
      remove: async () => ok(undefined),
    };
  }

  function fakeLock(): LockPort {
    return {
      acquire: async () => ok({ release: async (): Promise<Result<void>> => ok(undefined) }),
      peek: async () => ok({ locked: false }),
    };
  }

  it('actually persists an added member to the registry entry (not just `results`)', async () => {
    const { file, edtsBaseDir } = await makeRegistryFile();
    const entry = {
      ulid: '01JXXXXX1AAAAAAAAAAAAAAAAA',
      topic: 'demo',
      createdAt: '2026-08-18T00:00:00.000Z',
      status: 'active' as const,
      members: [],
    };
    await writeFile(file, stringify({ edts: [entry] }));
    const edtRegistry = createEdtRegistryPort(file, edtsBaseDir);

    const result = await modifyEdt({
      edtRegistry,
      registry: fakeRegistry(['/repos/new-member']),
      manifest: fakeManifest(),
      git: fakeGit(),
      lock: fakeLock(),
      edtRegistryResourceKey: file,
      topic: 'demo',
      addMembers: ['/repos/new-member'],
      removeMembers: [],
      // Story 2.24: addMembers no longer silently defaults to the repo's currentBranch — a
      // matching setBranches entry is required to name the requested branch explicitly.
      setBranches: [{ repoPath: '/repos/new-member', branch: 'feature-new' }],
      renameTo: undefined,
    });

    expect(result.ok).toBe(true);

    const persisted = await edtRegistry.list();
    expect(persisted.ok).toBe(true);
    if (persisted.ok) {
      expect(persisted.data[0].members).toEqual([
        { service: 'service-new-member', repoPath: '/repos/new-member', branch: 'feature-new' },
      ]);
    }
  });

  it('actually persists a member branch change to the registry entry (not just `results`)', async () => {
    const { file, edtsBaseDir } = await makeRegistryFile();
    const entry = {
      ulid: '01JXXXXX1AAAAAAAAAAAAAAAAA',
      topic: 'demo',
      createdAt: '2026-08-18T00:00:00.000Z',
      status: 'active' as const,
      members: [{ service: 'route-explorer', repoPath: '/repos/a', branch: 'old-branch' }],
    };
    await writeFile(file, stringify({ edts: [entry] }));
    const edtRegistry = createEdtRegistryPort(file, edtsBaseDir);

    const result = await modifyEdt({
      edtRegistry,
      registry: fakeRegistry(['/repos/a']),
      manifest: fakeManifest(),
      git: fakeGit(),
      lock: fakeLock(),
      edtRegistryResourceKey: file,
      topic: 'demo',
      addMembers: [],
      removeMembers: [],
      setBranches: [{ repoPath: '/repos/a', branch: 'new-branch' }],
      renameTo: undefined,
    });

    expect(result.ok).toBe(true);

    const persisted = await edtRegistry.list();
    expect(persisted.ok).toBe(true);
    if (persisted.ok) {
      expect(persisted.data[0].members).toEqual([
        { service: 'route-explorer', repoPath: '/repos/a', branch: 'new-branch' },
      ]);
    }
  });

  it('drops a removed member entirely, verified against the real persisted patch', async () => {
    const { file, edtsBaseDir } = await makeRegistryFile();
    const entry = {
      ulid: '01JXXXXX1AAAAAAAAAAAAAAAAA',
      topic: 'demo',
      createdAt: '2026-08-18T00:00:00.000Z',
      status: 'active' as const,
      members: [{ service: 'route-explorer', repoPath: '/repos/a', branch: 'main' }],
    };
    await writeFile(file, stringify({ edts: [entry] }));
    const edtRegistry = createEdtRegistryPort(file, edtsBaseDir);

    const result = await modifyEdt({
      edtRegistry,
      registry: fakeRegistry(['/repos/a']),
      manifest: fakeManifest(),
      git: fakeGit(),
      lock: fakeLock(),
      edtRegistryResourceKey: file,
      topic: 'demo',
      addMembers: [],
      removeMembers: ['/repos/a'],
      setBranches: [],
      renameTo: undefined,
    });

    expect(result.ok).toBe(true);

    const persisted = await edtRegistry.list();
    expect(persisted.ok).toBe(true);
    if (persisted.ok) {
      expect(persisted.data[0].members).toEqual([]);
    }
  });

  it('persists a renamed topic against the real registry file', async () => {
    const { file, edtsBaseDir } = await makeRegistryFile();
    const entry = {
      ulid: '01JXXXXX1AAAAAAAAAAAAAAAAA',
      topic: 'original',
      createdAt: '2026-08-18T00:00:00.000Z',
      status: 'active' as const,
      members: [],
    };
    await writeFile(file, stringify({ edts: [entry] }));
    const edtRegistry = createEdtRegistryPort(file, edtsBaseDir);

    const result = await modifyEdt({
      edtRegistry,
      registry: fakeRegistry([]),
      manifest: fakeManifest(),
      git: fakeGit(),
      lock: fakeLock(),
      edtRegistryResourceKey: file,
      topic: 'original',
      addMembers: [],
      removeMembers: [],
      setBranches: [],
      renameTo: 'renamed',
    });

    expect(result.ok).toBe(true);

    const persisted = await edtRegistry.list();
    expect(persisted.ok).toBe(true);
    if (persisted.ok) {
      expect(persisted.data[0].topic).toBe('renamed');
    }
  });

  it('a branch override on a member added in the same call wins over its auto-resolved current branch', async () => {
    const { file, edtsBaseDir } = await makeRegistryFile();
    const entry = {
      ulid: '01JXXXXX1AAAAAAAAAAAAAAAAA',
      topic: 'demo',
      createdAt: '2026-08-18T00:00:00.000Z',
      status: 'active' as const,
      members: [],
    };
    await writeFile(file, stringify({ edts: [entry] }));
    const edtRegistry = createEdtRegistryPort(file, edtsBaseDir);

    const result = await modifyEdt({
      edtRegistry,
      registry: fakeRegistry(['/repos/new-member']),
      manifest: fakeManifest(),
      git: fakeGit({ currentBranch: async () => ok('auto-resolved') }),
      lock: fakeLock(),
      edtRegistryResourceKey: file,
      topic: 'demo',
      addMembers: ['/repos/new-member'],
      removeMembers: [],
      setBranches: [{ repoPath: '/repos/new-member', branch: 'chosen-instead' }],
      renameTo: undefined,
    });

    expect(result.ok).toBe(true);

    const persisted = await edtRegistry.list();
    expect(persisted.ok).toBe(true);
    if (persisted.ok) {
      expect(persisted.data[0].members).toEqual([
        { service: 'service-new-member', repoPath: '/repos/new-member', branch: 'chosen-instead' },
      ]);
    }
  });
});
