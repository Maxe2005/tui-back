// adapters/driven/edt-registry: integration tests against real temp files (AD-13 driven
// layer). The schema is strict on purpose — story 2.2 evolved the entry shape in place
// (AD-7), replacing the 2.1 single `branch` placeholder with `topic` + per-member
// `members: [...]`. No real 2.1-shape data exists (verified at review time), so a legacy
// 2.1 entry is intentionally rejected as edt-registry-invalid-format rather than migrated;
// a migration decision is tracked separately.
import { describe, expect, it, vi, type Mock, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ulid as generateUlid } from 'ulid';
import { stringify } from 'yaml';
import { modifyEdt, createMemberBranch, renameMemberBranch, listMemberBranches, addMemberUnderLock } from './modify.js';
import type { ModifyEdtResult, ModifyEdtData } from './modify.js';
import type { RegistryPort } from '../ports/registry.js';
import type { ManifestPort } from '../ports/manifest.js';
import type { EdtMember, EdtRegistryEntry, EdtRegistryPort } from '../ports/edt-registry.js';
import type { LockPort } from '../ports/lock.js';
import { Result, err, ok } from '../result.js';

const tmpDirs: string[] = [];

afterEach(async () => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

async function makeRegistryFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tui-back-edt-modify-'));
  tmpDirs.push(dir);
  return join(dir, 'edts.yaml');
}

function makeMockManifest(): ManifestPort {
  return {
    load: async (repoPath: string): Promise<Result<{ service: string; container: string; migrationCommand: string; sharedBranch: string; modules: {} }>> => {
      const hash = repoPath.split('/').pop() || 'repo';
      return ok({
        service: `service-${hash}`,
        container: `container-${hash}`,
        migrationCommand: 'true',
        sharedBranch: 'development',
        modules: {},
      });
    },
  };
}

function makeMockRegistry(initialPaths: Set<string> = new Set()): RegistryPort {
  const registeredPaths = initialPaths;
  return {
    list: async () => ok(Array.from(registeredPaths)),
    add: async (_path: string) => ok(undefined),
    exists: async (_path: string) => ok(false),
    scan: async (_root: string) => ok({ candidates: [], skipped: [] }),
    reset: async (_path: string) => ok({ path: _path, backupPath: null }),
    remove: async (_path: string) => ok(undefined),
  };
}

function makeMockGit(): any {
  return {
    currentBranch: async (repoPath: string) => {
      const branch = repoPath.endsWith('-shared') ? 'development' : 'feature-x';
      return ok(branch);
    },
    assertAllowedBranch: async (repoPath: string, branchName: string, edtId?: string) => {
      if (edtId !== undefined && (branchName === 'development' || branchName === 'preprod' || branchName === 'prod')) {
        return err('shared-branch-rejected', `Branch "${branchName}" is shared/protected`);
      }
      return ok(undefined);
    },
    hasUncommittedChanges: async (repoPath: string) => ok(false),
    stashSave: async (repoPath: string, message: string) => ok(undefined),
    checkout: async (repoPath: string, branchName: string) => ok(undefined),
    restoreStash: async (repoPath: string, message: string) => ok(undefined),
    createBranch: async (repoPath: string, branchName: string, baseBranch: string) => ok(undefined),
    renameBranch: async (repoPath: string, oldName: string, newName: string) => ok(undefined),
    listBranches: async (repoPath: string) => ok(['development', 'feature-x']),
  };
}

// In-memory EDT registry for tests (mirrors edts.yaml shape)
const testEdtStore = new Map<
  string,
  { topic: string; members: { service: string; repoPath: string; branch: string }[] }
>();

function resetEdtStore() {
  testEdtStore.clear();
}

describe('modifyEdt — unit / matrix', () => {
  resetEdtStore();

  it('adds a member with a matching setBranches entry (story 2.24: no silent currentBranch default)', async () => {
    resetEdtStore();
    // Pre-register an EDT
    const file = await makeRegistryFile();
    const updateCalls: Array<{ ulid: string; patch: unknown }> = [];
    const port = {
      list: async () => ok([{ ulid: '01JTEST000000000000001', topic: 'demo', createdAt: '2026-08-18T00:00:00.000Z', status: 'active', members: [] }]),
      add: async () => ok(undefined),
      setStatus: async () => ok(undefined),
      update: async (ulid: string, patch: unknown) => {
        updateCalls.push({ ulid, patch });
        return ok(undefined);
      },
    } as any;

    const git = makeMockGit();
    const manifest = makeMockManifest();

    const result = await modifyEdt({
      edtRegistry: port as any,
      registry: makeMockRegistry(new Set(["/repos/some-repo"])),
      manifest,
      git,
      lock: {
        acquire: async () => ok({ ok: true, data: { release: async () => ok(undefined) } }),
        peek: async () => ok({ ok: true, data: { locked: false } }),
        release: async () => ok(undefined),
      } as any,
      edtRegistryResourceKey: file,
      topic: 'demo',
      addMembers: ['/repos/some-repo'],
      removeMembers: [],
      setBranches: [{ repoPath: '/repos/some-repo', branch: 'feature-requested' }],
      renameTo: undefined,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Story 2.24: the requested branch wins — never the repo's currentBranch (the mock's
      // currentBranch would have returned 'feature-x' for this path; the assertion here
      // proves step 1 never even called it).
      expect(result.data?.results).toHaveLength(1);
      expect(result.data?.results[0].outcome).toBe('added');
      expect(result.data?.results[0].newBranch).toBe('feature-requested');
    }
    // Story 2.24: step 3's promotion actually reaches the persisted registry entry (not just
    // the returned `results` — Story 2.9's addedMembers/branchChanges plumbing).
    expect(updateCalls).toHaveLength(1);
    const persistedMembers = (updateCalls[0]!.patch as { members: Array<{ repoPath: string; branch: string }> }).members;
    expect(persistedMembers).toEqual([{ service: 'service-some-repo', repoPath: '/repos/some-repo', branch: 'feature-requested' }]);
  });

  it('fails an addMembers entry with no matching setBranches entry (story 2.24: branch-required, no silent currentBranch default)', async () => {
    resetEdtStore();
    const git = makeMockGit();
    const manifest = makeMockManifest();
    const currentBranchSpy = vi.spyOn(git, 'currentBranch');
    const assertAllowedBranchSpy = vi.spyOn(git, 'assertAllowedBranch');
    const checkoutSpy = vi.spyOn(git, 'checkout');

    const result = await modifyEdt({
      edtRegistry: {
        list: async () => ok([{ ulid: '01JTEST000000000000006', topic: 'demo', createdAt: '2026-08-18T00:00:00.000Z', status: 'active', members: [] }]),
        add: async () => ok(undefined),
        setStatus: async () => ok(undefined),
        update: async () => ok(undefined),
      } as any,
      registry: makeMockRegistry(new Set(["/repos/some-repo"])),
      manifest,
      git,
      lock: {
        acquire: async () => ok({ ok: true, data: { release: async () => ok(undefined) } }),
        peek: async () => ok({ ok: true, data: { locked: false } }),
        release: async () => ok(undefined),
      } as any,
      edtRegistryResourceKey: '/dev/null',
      topic: 'demo',
      addMembers: ['/repos/some-repo'],
      removeMembers: [],
      setBranches: [],
      renameTo: undefined,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data?.results).toHaveLength(1);
      expect(result.data?.results[0].outcome).toBe('failed');
      expect(result.data?.results[0].detail?.code).toBe('branch-required');
    }
    // Step 1 never falls back to reading the current branch for an unmatched add, and step 3
    // never runs the gate/checkout against it either — there's no setBranches entry to defer
    // to, so nothing in step 3 ever touches this path.
    expect(currentBranchSpy).not.toHaveBeenCalled();
    expect(assertAllowedBranchSpy).not.toHaveBeenCalled();
    expect(checkoutSpy).not.toHaveBeenCalled();
  });

  it('isolates a branch-collision failure from an unrelated successful add in the same call (story 2.24)', async () => {
    resetEdtStore();
    const git = makeMockGit();
    const manifest = makeMockManifest();

    const result = await modifyEdt({
      edtRegistry: {
        list: async () => ok([{ ulid: '01JTEST000000000000007', topic: 'demo', createdAt: '2026-08-18T00:00:00.000Z', status: 'active', members: [] }]),
        add: async () => ok(undefined),
        setStatus: async () => ok(undefined),
        update: async () => ok(undefined),
      } as any,
      registry: makeMockRegistry(new Set(["/repos/some-repo", "/repos/test-shared"])),
      manifest,
      git,
      lock: {
        acquire: async () => ok({ ok: true, data: { release: async () => ok(undefined) } }),
        peek: async () => ok({ ok: true, data: { locked: false } }),
        release: async () => ok(undefined),
      } as any,
      edtRegistryResourceKey: '/dev/null',
      topic: 'demo',
      // Two addMembers entries in the same call, each with a matching setBranches entry: one
      // requests a free branch (succeeds), the other requests a shared/claimed branch (the
      // mock's assertAllowedBranch rejects 'development' whenever an edtId is passed).
      addMembers: ['/repos/some-repo', '/repos/test-shared'],
      removeMembers: [],
      setBranches: [
        { repoPath: '/repos/some-repo', branch: 'feature-ok' },
        { repoPath: '/repos/test-shared', branch: 'development' },
      ],
      renameTo: undefined,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data?.results).toHaveLength(2);
      const okResult = result.data.results.find((r) => r.service === 'service-some-repo');
      const failedResult = result.data.results.find((r) => r.outcome === 'failed');
      // The collision on one repo never aborts the other's independent add.
      expect(okResult?.outcome).toBe('added');
      expect(okResult?.newBranch).toBe('feature-ok');
      expect(failedResult?.detail?.code).toBe('shared-branch-rejected');
    }
  });

  it('removes a member', async () => {
    resetEdtStore();
    // Pre-register an EDT with a member
    resetEdtStore();
    testEdtStore.set('01JTEST000000000000002', {
      topic: 'demo',
      members: [{ service: 'svc-a', repoPath: '/repos/a', branch: 'main' }],
    });

    const git = makeMockGit();
    const manifest = makeMockManifest();

    const result = await modifyEdt({
      edtRegistry: {
        list: async () => ok([{ ulid: '01JTEST000000000000002', topic: 'demo', createdAt: '2026-08-18T00:00:00.000Z', status: 'active', members: [{ service: 'svc-a', repoPath: '/repos/a', branch: 'main' }] }]),
        add: async () => ok(undefined),
        setStatus: async () => ok(undefined),
        update: async () => ok(undefined),
      } as any,
      registry: makeMockRegistry(new Set(["/repos/some-repo"])),
      manifest,
      git,
      lock: {
        acquire: async () => ok({ ok: true, data: { release: async () => ok(undefined) } }),
        peek: async () => ok({ ok: true, data: { locked: false } }),
        release: async () => ok(undefined),
      } as any,
      edtRegistryResourceKey: '/dev/null',
      topic: 'demo',
      addMembers: [],
      removeMembers: ['/repos/a'],
      setBranches: [],
      renameTo: undefined,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data?.results).toHaveLength(1);
      expect(result.data?.results[0].outcome).toBe('removed');
    }
  });

    resetEdtStore();
  it('rejects adding a member whose requested branch is claimed/shared, isolated per-repo (story 2.24)', async () => {
    resetEdtStore();
    testEdtStore.set('01JTEST000000000000003', {
      topic: 'demo',
      members: [],
    });

    const git = makeMockGit(); // development = shared branch
    const manifest = makeMockManifest();

    const result = await modifyEdt({
      edtRegistry: {
        list: async () => ok([{ ulid: '01JTEST000000000000003', topic: 'demo', createdAt: '2026-08-18T00:00:00.000Z', status: 'active', members: [] }]),
        add: async () => ok(undefined),
        setStatus: async () => ok(undefined),
        update: async () => ok(undefined),
      } as any,
      registry: makeMockRegistry(new Set(["/repos/test-shared", "/repos/some-repo"])),
      manifest,
      git,
      lock: {
        acquire: async () => ok({ ok: true, data: { release: async () => ok(undefined) } }),
        peek: async () => ok({ ok: true, data: { locked: false } }),
        release: async () => ok(undefined),
      } as any,
      edtRegistryResourceKey: '/dev/null',
      topic: 'demo',
      addMembers: ['/repos/test-shared'],
      removeMembers: [],
      // Story 2.24: matches, so step 1 defers to step 3 instead of failing with
      // branch-required — the requested branch ('development') is what actually gets
      // gated, isolated as a per-repo failure rather than aborting the whole call.
      setBranches: [{ repoPath: '/repos/test-shared', branch: 'development' }],
      renameTo: undefined,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data?.results).toHaveLength(1);
      expect(result.data?.results[0].outcome).toBe('failed');
      expect(result.data?.results[0].detail?.code).toBe('shared-branch-rejected');
    }
  });
    resetEdtStore();

  it('renames the EDT topic', async () => {
    resetEdtStore();
    testEdtStore.set('01JTEST000000000000004', {
      topic: 'original',
      members: [],
    });

    const git = makeMockGit();
    const manifest = makeMockManifest();

    const result = await modifyEdt({
      edtRegistry: {
        list: async () => ok([{ ulid: '01JTEST000000000000004', topic: 'original', createdAt: '2026-08-18T00:00:00.000Z', status: 'active', members: [] }]),
        add: async () => ok(undefined),
        setStatus: async () => ok(undefined),
        update: async () => ok(undefined),
      } as any,
      registry: makeMockRegistry(new Set(["/repos/some-repo"])),
      manifest,
      git,
      lock: {
        acquire: async () => ok({ ok: true, data: { release: async () => ok(undefined) } }),
        peek: async () => ok({ ok: true, data: { locked: false } }),
        release: async () => ok(undefined),
      } as any,
      edtRegistryResourceKey: '/dev/null',
      topic: 'original',
      addMembers: [],
      removeMembers: [],
      setBranches: [],
      renameTo: 'renamed',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data?.topic).toBe('renamed');
      expect(result.data?.results).toHaveLength(0);
    }
    resetEdtStore();
  });

  it('fails with edt-not-found for unknown topic', async () => {
    resetEdtStore();

    const git = makeMockGit();
    const manifest = makeMockManifest();

    const result = await modifyEdt({
      edtRegistry: {
        list: async () => ok([]),
        add: async () => ok(undefined),
        setStatus: async () => ok(undefined),
        update: async () => ok(undefined),
      } as any,
      registry: makeMockRegistry(new Set(["/repos/some-repo"])),
      manifest,
      git,
      lock: {
        acquire: async () => ok({ ok: true, data: { release: async () => ok(undefined) } }),
        peek: async () => ok({ ok: true, data: { locked: false } }),
        release: async () => ok(undefined),
      } as any,
      edtRegistryResourceKey: '/dev/null',
      topic: 'nonexistent',
      addMembers: [],
      removeMembers: [],
      setBranches: [],
      renameTo: undefined,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('edt-not-found');
    resetEdtStore();
    }
  });

  it('fails with invalid-argument when no operation provided', async () => {
    resetEdtStore();

    const git = makeMockGit();
    const manifest = makeMockManifest();

    const result = await modifyEdt({
      edtRegistry: {
        list: async () => ok([{ ulid: '01JTEST000000000000005', topic: 'demo', createdAt: '2026-08-18T00:00:00.000Z', status: 'active', members: [] }]),
        add: async () => ok(undefined),
        setStatus: async () => ok(undefined),
        update: async () => ok(undefined),
      } as any,
      registry: makeMockRegistry(new Set(["/repos/some-repo"])),
      manifest,
      git,
      lock: {
        acquire: async () => ok({ ok: true, data: { release: async () => ok(undefined) } }),
        peek: async () => ok({ ok: true, data: { locked: false } }),
        release: async () => ok(undefined),
      } as any,
      edtRegistryResourceKey: '/dev/null',
      topic: 'demo',
      addMembers: [],
      removeMembers: [],
      setBranches: [],
      renameTo: undefined,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('invalid-argument');
    }
  });
});

// Story 2.26 --------------------------------------------------------------------------------
describe('modifyEdt — renameBranches (story 2.26)', () => {
  it('renames an existing member\'s own currently-registered branch and records the change', async () => {
    resetEdtStore();
    const renameCalls: Array<{ repoPath: string; oldName: string; newName: string }> = [];
    const git = makeMockGit();
    git.renameBranch = async (repoPath: string, oldName: string, newName: string) => {
      renameCalls.push({ repoPath, oldName, newName });
      return ok(undefined);
    };
    const manifest = makeMockManifest();
    const updateCalls: Array<{ ulid: string; patch: any }> = [];

    const result = await modifyEdt({
      edtRegistry: {
        list: async () => ok([
          {
            ulid: '01JTEST000000000000010',
            topic: 'demo',
            createdAt: '2026-08-18T00:00:00.000Z',
            status: 'active',
            members: [{ service: 'svc-a', repoPath: '/repos/a', branch: 'main' }],
          },
        ]),
        add: async () => ok(undefined),
        setStatus: async () => ok(undefined),
        update: async (ulid: string, patch: any) => {
          updateCalls.push({ ulid, patch });
          return ok(undefined);
        },
      } as any,
      registry: makeMockRegistry(),
      manifest,
      git,
      lock: {
        acquire: async () => ok({ ok: true, data: { release: async () => ok(undefined) } }),
        peek: async () => ok({ ok: true, data: { locked: false } }),
        release: async () => ok(undefined),
      } as any,
      edtRegistryResourceKey: '/dev/null',
      topic: 'demo',
      addMembers: [],
      removeMembers: [],
      setBranches: [],
      renameBranches: [{ repoPath: '/repos/a', newName: 'feature-renamed' }],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.results).toHaveLength(1);
      expect(result.data.results[0]).toMatchObject({ outcome: 'branch-changed', newBranch: 'feature-renamed' });
    }
    // oldName is resolved from this EDT's own membership — never taken from the caller.
    expect(renameCalls).toEqual([{ repoPath: '/repos/a', oldName: 'main', newName: 'feature-renamed' }]);
    // Lock-time assembly applied it: the persisted member now carries the new branch.
    expect(updateCalls[0]?.patch.members).toEqual([{ service: 'svc-a', repoPath: '/repos/a', branch: 'feature-renamed' }]);
  });

  it('fails invalid-member for a repoPath that is not (yet) a member — never resolves an oldName out of thin air', async () => {
    resetEdtStore();
    const git = makeMockGit();
    const manifest = makeMockManifest();

    const result = await modifyEdt({
      edtRegistry: {
        list: async () => ok([{ ulid: '01JTEST000000000000011', topic: 'demo', createdAt: '2026-08-18T00:00:00.000Z', status: 'active', members: [] }]),
        add: async () => ok(undefined),
        setStatus: async () => ok(undefined),
        update: async () => ok(undefined),
      } as any,
      registry: makeMockRegistry(),
      manifest,
      git,
      lock: {
        acquire: async () => ok({ ok: true, data: { release: async () => ok(undefined) } }),
        peek: async () => ok({ ok: true, data: { locked: false } }),
        release: async () => ok(undefined),
      } as any,
      edtRegistryResourceKey: '/dev/null',
      topic: 'demo',
      addMembers: [],
      removeMembers: [],
      setBranches: [],
      renameBranches: [{ repoPath: '/repos/not-a-member', newName: 'feature-y' }],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.results).toHaveLength(1);
      expect(result.data.results[0]).toMatchObject({ outcome: 'failed', detail: { code: 'invalid-member' } });
    }
  });

  it('gates the new name the same way setBranches does (shared/protected -> shared-branch-rejected, no git.renameBranch call)', async () => {
    resetEdtStore();
    const renameCalls: string[] = [];
    const git = makeMockGit();
    git.renameBranch = async (repoPath: string) => {
      renameCalls.push(repoPath);
      return ok(undefined);
    };
    const manifest = makeMockManifest();

    const result = await modifyEdt({
      edtRegistry: {
        list: async () => ok([
          {
            ulid: '01JTEST000000000000012',
            topic: 'demo',
            createdAt: '2026-08-18T00:00:00.000Z',
            status: 'active',
            members: [{ service: 'svc-a', repoPath: '/repos/a', branch: 'main' }],
          },
        ]),
        add: async () => ok(undefined),
        setStatus: async () => ok(undefined),
        update: async () => ok(undefined),
      } as any,
      registry: makeMockRegistry(),
      manifest,
      git,
      lock: {
        acquire: async () => ok({ ok: true, data: { release: async () => ok(undefined) } }),
        peek: async () => ok({ ok: true, data: { locked: false } }),
        release: async () => ok(undefined),
      } as any,
      edtRegistryResourceKey: '/dev/null',
      topic: 'demo',
      addMembers: [],
      removeMembers: [],
      setBranches: [],
      renameBranches: [{ repoPath: '/repos/a', newName: 'development' }],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.results[0]).toMatchObject({ outcome: 'failed', detail: { code: 'shared-branch-rejected' } });
    }
    expect(renameCalls).toEqual([]);
  });

  it('a git.renameBranch failure (e.g. branch-exists) is isolated to that repo\'s result row', async () => {
    resetEdtStore();
    const git = makeMockGit();
    git.renameBranch = async () => err('branch-exists', 'Branch "feature-renamed" already exists');
    const manifest = makeMockManifest();

    const result = await modifyEdt({
      edtRegistry: {
        list: async () => ok([
          {
            ulid: '01JTEST000000000000013',
            topic: 'demo',
            createdAt: '2026-08-18T00:00:00.000Z',
            status: 'active',
            members: [{ service: 'svc-a', repoPath: '/repos/a', branch: 'main' }],
          },
        ]),
        add: async () => ok(undefined),
        setStatus: async () => ok(undefined),
        update: async () => ok(undefined),
      } as any,
      registry: makeMockRegistry(),
      manifest,
      git,
      lock: {
        acquire: async () => ok({ ok: true, data: { release: async () => ok(undefined) } }),
        peek: async () => ok({ ok: true, data: { locked: false } }),
        release: async () => ok(undefined),
      } as any,
      edtRegistryResourceKey: '/dev/null',
      topic: 'demo',
      addMembers: [],
      removeMembers: [],
      setBranches: [],
      renameBranches: [{ repoPath: '/repos/a', newName: 'feature-renamed' }],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.results[0]).toMatchObject({ outcome: 'failed', detail: { code: 'branch-exists' } });
    }
  });
});

describe('createMemberBranch (story 2.26)', () => {
  it('delegates straight to git.createBranch', async () => {
    const calls: Array<{ repoPath: string; branchName: string; baseBranch: string }> = [];
    const git: any = {
      createBranch: async (repoPath: string, branchName: string, baseBranch: string) => {
        calls.push({ repoPath, branchName, baseBranch });
        return ok(undefined);
      },
    };

    const result = await createMemberBranch({ git, repoPath: '/repos/a', branchName: 'feature-x', baseBranch: 'development' });

    expect(result).toEqual({ ok: true, data: undefined });
    expect(calls).toEqual([{ repoPath: '/repos/a', branchName: 'feature-x', baseBranch: 'development' }]);
  });

  it('propagates a git.createBranch failure verbatim', async () => {
    const git: any = { createBranch: async () => err('branch-exists', 'Branch "feature-x" already exists') };

    const result = await createMemberBranch({ git, repoPath: '/repos/a', branchName: 'feature-x', baseBranch: 'development' });

    expect(result).toMatchObject({ ok: false, error: { code: 'branch-exists' } });
  });
});

describe('renameMemberBranch (story 2.26)', () => {
  it('delegates straight to git.renameBranch', async () => {
    const calls: Array<{ repoPath: string; oldName: string; newName: string }> = [];
    const git: any = {
      renameBranch: async (repoPath: string, oldName: string, newName: string) => {
        calls.push({ repoPath, oldName, newName });
        return ok(undefined);
      },
    };

    const result = await renameMemberBranch({ git, repoPath: '/repos/a', oldName: 'feature-x', newName: 'feature-y' });

    expect(result).toEqual({ ok: true, data: undefined });
    expect(calls).toEqual([{ repoPath: '/repos/a', oldName: 'feature-x', newName: 'feature-y' }]);
  });

  it('propagates a git.renameBranch failure verbatim', async () => {
    const git: any = { renameBranch: async () => err('branch-missing', 'Branch "feature-x" does not exist') };

    const result = await renameMemberBranch({ git, repoPath: '/repos/a', oldName: 'feature-x', newName: 'feature-y' });

    expect(result).toMatchObject({ ok: false, error: { code: 'branch-missing' } });
  });
});

describe('listMemberBranches (story 2.26)', () => {
  it('delegates straight to git.listBranches', async () => {
    const git: any = { listBranches: async (repoPath: string) => ok(repoPath === '/repos/a' ? ['development', 'feature-x'] : []) };

    const result = await listMemberBranches(git, '/repos/a');

    expect(result).toEqual({ ok: true, data: ['development', 'feature-x'] });
  });
});

describe('addMemberUnderLock (story 2.39)', () => {
  const base = { ulid: '01JOUT', topic: 'out', createdAt: '2026-09-28T00:00:00.000Z', status: 'active' as const };
  const existing: EdtMember = { service: 'a', repoPath: '/repos/a', branch: 'feat/a' };
  type RegistryPatch = { topic?: string; members?: EdtMember[] };

  function fakeLock(events: string[]): LockPort {
    return {
      acquire: async (key: string) => {
        events.push(`acquire:${key}`);
        return ok({
          release: async () => {
            events.push('release');
            return ok(undefined);
          },
        });
      },
      peek: async () => ok({ locked: false }),
    };
  }

  function fakeEdtRegistry(
    entries: EdtRegistryEntry[],
    update: (ulid: string, patch: RegistryPatch) => Promise<Result<void>>,
    onList: () => void = () => {},
  ): EdtRegistryPort {
    return {
      add: async () => ok(undefined),
      list: async () => {
        onList();
        return ok(entries);
      },
      update,
      setStatus: async () => ok(undefined),
      remove: async () => ok(undefined),
    };
  }

  it('appends the member under the edts.yaml lock, re-reading the authoritative list, never touching git', async () => {
    const events: string[] = [];
    const updates: Array<{ ulid: string; patch: RegistryPatch }> = [];
    const edtRegistry = fakeEdtRegistry(
      [{ ...base, members: [existing] }],
      async (ulid, patch) => {
        events.push('update');
        updates.push({ ulid, patch });
        return ok(undefined);
      },
      () => events.push('list'),
    );

    const result = await addMemberUnderLock({
      edtRegistry,
      lock: fakeLock(events),
      edtRegistryResourceKey: '/cfg/edts.yaml',
      edt: { ...base, members: [] },
      member: { service: 'b', repoPath: '/repos/b/', branch: 'feat/b' },
    });

    expect(result.ok).toBe(true);
    expect(events).toEqual(['acquire:/cfg/edts.yaml', 'list', 'update', 'release']);
    expect(updates).toEqual([
      { ulid: '01JOUT', patch: { topic: 'out', members: [existing, { service: 'b', repoPath: '/repos/b', branch: 'feat/b' }] } },
    ]);
  });

  it('is a no-op add when a racing writer already registered the same repo (no duplicate)', async () => {
    const patches: RegistryPatch[] = [];
    const edtRegistry = fakeEdtRegistry([{ ...base, members: [existing] }], async (_ulid, patch) => {
      patches.push(patch);
      return ok(undefined);
    });

    const result = await addMemberUnderLock({
      edtRegistry,
      lock: fakeLock([]),
      edtRegistryResourceKey: 'k',
      edt: { ...base, members: [] },
      member: { service: 'a', repoPath: '/repos/a', branch: 'other' },
    });

    expect(result.ok).toBe(true);
    expect(patches[0]?.members).toEqual([existing]);
  });

  it('propagates a write failure and an unknown EDT', async () => {
    const failing = fakeEdtRegistry([{ ...base, members: [] }], async () => err('edt-registry-write-error', 'disk full'));
    const written = await addMemberUnderLock({
      edtRegistry: failing,
      lock: fakeLock([]),
      edtRegistryResourceKey: 'k',
      edt: { ...base, members: [] },
      member: { service: 'b', repoPath: '/repos/b', branch: 'feat/b' },
    });
    expect(written).toMatchObject({ ok: false, error: { code: 'edt-registry-write-error' } });

    const gone = fakeEdtRegistry([], async () => ok(undefined));
    const missing = await addMemberUnderLock({
      edtRegistry: gone,
      lock: fakeLock([]),
      edtRegistryResourceKey: 'k',
      edt: { ...base, members: [] },
      member: { service: 'b', repoPath: '/repos/b', branch: 'feat/b' },
    });
    expect(missing).toMatchObject({ ok: false, error: { code: 'edt-not-found' } });
  });
});
