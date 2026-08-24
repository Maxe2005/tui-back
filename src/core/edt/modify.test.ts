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
import { modifyEdt } from './modify.js';
import type { ModifyEdtResult, ModifyEdtData } from './modify.js';
import type { RegistryPort } from '../ports/registry.js';
import type { ManifestPort } from '../ports/manifest.js';
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

  it('adds a member with gated branch', async () => {
    resetEdtStore();
    // Pre-register an EDT
    const file = await makeRegistryFile();
    const port = {
      list: async () => ok([{ ulid: '01JTEST000000000000001', topic: 'demo', createdAt: '2026-08-18T00:00:00.000Z', status: 'active', members: [] }]),
      add: async () => ok(undefined),
      setStatus: async () => ok(undefined),
      update: async () => ok(undefined),
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
      setBranches: [],
      renameTo: undefined,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data?.results).toHaveLength(1);
      expect(result.data?.results[0].outcome).toBe('added');
      expect(result.data?.results[0].newBranch).toBe('feature-x');
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
  it('rejects adding a member on a shared branch', async () => {
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
      setBranches: [],
      renameTo: undefined,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('shared-branch-rejected');
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