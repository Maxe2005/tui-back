// core/edt/list: unit tests against fake ports (FR-9) — upstream configured, no upstream,
// offline/unresolvable, member vs. non-member uniformity, and the reachability/manifest-error
// passthrough mirroring core/scripts/list-repos.ts.
import { describe, expect, it, vi } from 'vitest';
import { ok, err } from '../result.js';
import type { EdtRegistryEntry, EdtRegistryPort } from '../ports/edt-registry.js';
import type { GitPort } from '../ports/git.js';
import type { Manifest, ManifestPort } from '../ports/manifest.js';
import type { RegistryPort } from '../ports/registry.js';
import type { StatePort } from '../ports/state.js';
import { listEdtBranchesDivergence } from './list.js';

function manifestFor(repoPath: string): Manifest {
  const name = repoPath.split('/').pop();
  return {
    service: `svc-${name}`,
    container: `ctr-${name}`,
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

function fakeRegistry(paths: string[], overrides: Partial<RegistryPort> = {}): RegistryPort {
  return {
    list: vi.fn(async () => ok(paths)),
    add: vi.fn(async () => ok(undefined)),
    exists: vi.fn(async () => ok(true)),
    scan: vi.fn(async () => ok({ candidates: [], skipped: [] })),
    reset: vi.fn(async () => ok({ path: '/x', backupPath: null })),
    remove: vi.fn(async () => ok(undefined)),
    ...overrides,
  };
}

function fakeEdtRegistry(entries: EdtRegistryEntry[] = [], overrides: Partial<EdtRegistryPort> = {}): EdtRegistryPort {
  return {
    add: vi.fn(async () => ok(undefined)),
    list: vi.fn(async () => ok(entries)),
    setStatus: vi.fn(async () => ok(undefined)),
    update: vi.fn(async () => ok(undefined)),
    remove: vi.fn(async () => ok(undefined)),
    ...overrides,
  };
}

function fakeState(overrides: Partial<StatePort> = {}): StatePort {
  return {
    readActiveEdt: vi.fn(async () => ok(null)),
    writeActiveEdt: vi.fn(async () => ok(undefined)),
    readSplitterRatios: vi.fn(async () => ok(null)),
    writeSplitterRatios: vi.fn(async () => ok(undefined)),
    readFilterHistory: vi.fn(async () => ok(null)),
    writeFilterHistory: vi.fn(async () => ok(undefined)),
    readCommandHistory: vi.fn(async () => ok(null)),
    writeCommandHistory: vi.fn(async () => ok(undefined)),
    ...overrides,
  };
}

function fakeGit(overrides: Partial<GitPort> = {}): GitPort {
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
    finalizeMerge: vi.fn(async () => ok(undefined)),
    listBranches: vi.fn(async () => ok([])),
    renameBranch: vi.fn(async () => ok(undefined)),
    listRemoteBranches: vi.fn(async () => ok([])),
    createTrackingBranch: vi.fn(async () => ok(undefined)),
    stagePaths: vi.fn(async () => ok(undefined)),
    commit: vi.fn(async () => ok(undefined)),
    isBranchMerged: vi.fn(async () => ok(true)),
    hasStash: vi.fn(async () => ok(false)),
    ...overrides,
  };
}

function edtEntry(ulid: string, topic: string, members: EdtRegistryEntry['members']): EdtRegistryEntry {
  return { ulid, topic, createdAt: '2026-08-19T00:00:00.000Z', status: 'active', members };
}

describe('listEdtBranchesDivergence', () => {
  it('shows branch + both ahead/behind counts for a service with a configured upstream', async () => {
    const registry = fakeRegistry(['/repo/a']);
    const git = fakeGit({
      currentBranch: vi.fn(async () => ok('feat/a')),
      aheadBehind: vi.fn(async () => ok({ ahead: 2, behind: 1 })),
    });

    const result = await listEdtBranchesDivergence({
      registry,
      manifest: fakeManifest(),
      git,
      edtRegistry: fakeEdtRegistry(),
      state: fakeState(),
    });

    expect(result).toEqual({
      ok: true,
      data: {
        services: [
          { service: 'svc-a', path: '/repo/a', isMember: false, sharedBranch: 'development', protectedBranches: [], branch: 'feat/a', ahead: 2, behind: 1, status: 'current' },
        ],
        unreachable: [],
        errors: [],
      },
    });
  });

  it('shows an explicit "no upstream" state, not a numeric value, when none is configured', async () => {
    const registry = fakeRegistry(['/repo/a']);
    const git = fakeGit({
      currentBranch: vi.fn(async () => ok('feat/a')),
      aheadBehind: vi.fn(async () => err('no-upstream', 'No upstream configured for branch "feat/a" in /repo/a')),
    });

    const result = await listEdtBranchesDivergence({
      registry,
      manifest: fakeManifest(),
      git,
      edtRegistry: fakeEdtRegistry(),
      state: fakeState(),
    });

    if (!result.ok) throw new Error('expected ok');
    expect(result.data.services).toEqual([
      { service: 'svc-a', path: '/repo/a', isMember: false, sharedBranch: 'development', protectedBranches: [], branch: 'feat/a', ahead: null, behind: null, status: 'no-upstream' },
    ]);
  });

  it('shows an explicit "unknown (offline)" state, not a stale/zero value, when the upstream ref is unresolvable', async () => {
    const registry = fakeRegistry(['/repo/a']);
    const git = fakeGit({
      currentBranch: vi.fn(async () => ok('feat/a')),
      aheadBehind: vi.fn(async () => err('unknown-offline', 'Upstream is configured but its ref cannot be resolved')),
    });

    const result = await listEdtBranchesDivergence({
      registry,
      manifest: fakeManifest(),
      git,
      edtRegistry: fakeEdtRegistry(),
      state: fakeState(),
    });

    if (!result.ok) throw new Error('expected ok');
    expect(result.data.services).toEqual([
      {
        service: 'svc-a',
        path: '/repo/a',
        isMember: false,
        sharedBranch: 'development',
        protectedBranches: [],
        branch: 'feat/a',
        ahead: null,
        behind: null,
        status: 'unknown-offline',
        detail: { code: 'unknown-offline', message: 'Upstream is configured but its ref cannot be resolved' },
      },
    ]);
  });

  it('folds any other git error (e.g. currentBranch failure) into the same "unknown (offline)" treatment', async () => {
    const registry = fakeRegistry(['/repo/a']);
    const git = fakeGit({
      currentBranch: vi.fn(async () => err('git-current-branch-error', 'HEAD is detached')),
    });

    const result = await listEdtBranchesDivergence({
      registry,
      manifest: fakeManifest(),
      git,
      edtRegistry: fakeEdtRegistry(),
      state: fakeState(),
    });

    if (!result.ok) throw new Error('expected ok');
    expect(result.data.services).toEqual([
      {
        service: 'svc-a',
        path: '/repo/a',
        isMember: false,
        sharedBranch: 'development',
        protectedBranches: [],
        branch: null,
        ahead: null,
        behind: null,
        status: 'unknown-offline',
        detail: { code: 'git-current-branch-error', message: 'HEAD is detached' },
      },
    ]);
  });

  it('shows branch/divergence uniformly for an EDT member and a non-member alike', async () => {
    const registry = fakeRegistry(['/repo/member', '/repo/non-member']);
    const edtRegistry = fakeEdtRegistry([edtEntry('edt-1', 'topic-1', [{ service: 'svc-member', repoPath: '/repo/member', branch: 'feat/member' }])]);
    const git = fakeGit({
      currentBranch: vi.fn(async (path: string) => ok(path === '/repo/member' ? 'feat/member' : 'development')),
    });

    const result = await listEdtBranchesDivergence({
      registry,
      manifest: fakeManifest(),
      git,
      edtRegistry,
      state: fakeState({ readActiveEdt: vi.fn(async () => ok('edt-1')) }),
    });

    if (!result.ok) throw new Error('expected ok');
    const byPath = new Map(result.data.services.map((s) => [s.path, s]));
    expect(byPath.get('/repo/member')).toMatchObject({ isMember: true, branch: 'feat/member' });
    expect(byPath.get('/repo/non-member')).toMatchObject({ isMember: false, branch: 'development' });
  });

  it('shows a non-member service correctly kept on development the same as any other service', async () => {
    const registry = fakeRegistry(['/repo/kept-on-development']);
    const edtRegistry = fakeEdtRegistry([edtEntry('edt-1', 'topic-1', [{ service: 'svc-other', repoPath: '/repo/other-member', branch: 'feat/other' }])]);
    const git = fakeGit({ currentBranch: vi.fn(async () => ok('development')) });

    const result = await listEdtBranchesDivergence({
      registry,
      manifest: fakeManifest(),
      git,
      edtRegistry,
      state: fakeState({ readActiveEdt: vi.fn(async () => ok('edt-1')) }),
    });

    if (!result.ok) throw new Error('expected ok');
    expect(result.data.services).toEqual([
      {
        service: 'svc-kept-on-development',
        path: '/repo/kept-on-development',
        isMember: false,
        sharedBranch: 'development',
        protectedBranches: [],
        branch: 'development',
        ahead: 0,
        behind: 0,
        status: 'current',
      },
    ]);
  });

  it('leaves every service isMember: false when no EDT is active', async () => {
    const registry = fakeRegistry(['/repo/a']);

    const result = await listEdtBranchesDivergence({
      registry,
      manifest: fakeManifest(),
      git: fakeGit(),
      edtRegistry: fakeEdtRegistry(),
      state: fakeState({ readActiveEdt: vi.fn(async () => ok(null)) }),
    });

    if (!result.ok) throw new Error('expected ok');
    expect(result.data.services[0].isMember).toBe(false);
  });

  it('silently skips a genuinely unmanaged repo, same as list-repos', async () => {
    const registry = fakeRegistry(['/repo/unmanaged']);
    const manifest = fakeManifest({ load: vi.fn(async () => err('manifest-not-found', 'no manifest')) });

    const result = await listEdtBranchesDivergence({
      registry,
      manifest,
      git: fakeGit(),
      edtRegistry: fakeEdtRegistry(),
      state: fakeState(),
    });

    expect(result).toEqual({ ok: true, data: { services: [], unreachable: [], errors: [] } });
  });

  it('reports an unreachable registered path rather than crashing the listing', async () => {
    const registry = fakeRegistry(['/repo/gone'], { exists: vi.fn(async () => ok(false)) });

    const result = await listEdtBranchesDivergence({
      registry,
      manifest: fakeManifest(),
      git: fakeGit(),
      edtRegistry: fakeEdtRegistry(),
      state: fakeState(),
    });

    expect(result).toEqual({ ok: true, data: { services: [], unreachable: ['/repo/gone'], errors: [] } });
  });

  it('surfaces a failing manifest as an errors entry, not a crash and not a silent skip', async () => {
    const registry = fakeRegistry(['/repo/bad']);
    const manifest = fakeManifest({ load: vi.fn(async () => err('manifest-validation-failed', 'Invalid .tui-back.yaml')) });

    const result = await listEdtBranchesDivergence({
      registry,
      manifest,
      git: fakeGit(),
      edtRegistry: fakeEdtRegistry(),
      state: fakeState(),
    });

    expect(result).toEqual({
      ok: true,
      data: { services: [], unreachable: [], errors: [{ path: '/repo/bad', code: 'manifest-validation-failed', message: 'Invalid .tui-back.yaml' }] },
    });
  });

  it('propagates a registry.list() failure instead of masking it', async () => {
    const registry = fakeRegistry([], { list: vi.fn(async () => err('registry-invalid-yaml', 'bad yaml')) });

    const result = await listEdtBranchesDivergence({
      registry,
      manifest: fakeManifest(),
      git: fakeGit(),
      edtRegistry: fakeEdtRegistry(),
      state: fakeState(),
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'registry-invalid-yaml' } });
  });

  it('propagates a state.readActiveEdt() failure', async () => {
    const registry = fakeRegistry(['/repo/a']);

    const result = await listEdtBranchesDivergence({
      registry,
      manifest: fakeManifest(),
      git: fakeGit(),
      edtRegistry: fakeEdtRegistry(),
      state: fakeState({ readActiveEdt: vi.fn(async () => err('state-read-error', 'cannot read state.json')) }),
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'state-read-error' } });
  });

  // Each repo's own manifest sharedBranch is threaded through, uniformly for member and
  // non-member alike — the EDT zone's base-branch suggestions derive from it.
  it("threads the repo's own manifest-declared sharedBranch through, never a hardcoded literal", async () => {
    const registry = fakeRegistry(['/repo/a', '/repo/b']);
    const manifest = fakeManifest({
      load: vi.fn(async (path: string) =>
        ok({ ...manifestFor(path), sharedBranch: path === '/repo/a' ? 'main' : 'master' }),
      ),
    });

    const result = await listEdtBranchesDivergence({
      registry,
      manifest,
      git: fakeGit(),
      edtRegistry: fakeEdtRegistry(),
      state: fakeState(),
    });

    if (!result.ok) throw new Error('expected ok');
    const byPath = new Map(result.data.services.map((s) => [s.path, s.sharedBranch]));
    expect(byPath.get('/repo/a')).toBe('main');
    expect(byPath.get('/repo/b')).toBe('master');
  });

  // The manifest's protectedBranches ride along next to sharedBranch — an empty array when the
  // manifest declares none.
  it("threads the repo's manifest protectedBranches through, defaulting to an empty list", async () => {
    const registry = fakeRegistry(['/repo/a', '/repo/b']);
    const manifest = fakeManifest({
      load: vi.fn(async (path: string) =>
        ok(path === '/repo/a' ? { ...manifestFor(path), protectedBranches: ['preprod', 'prod'] } : manifestFor(path)),
      ),
    });

    const result = await listEdtBranchesDivergence({
      registry,
      manifest,
      git: fakeGit(),
      edtRegistry: fakeEdtRegistry(),
      state: fakeState(),
    });

    if (!result.ok) throw new Error('expected ok');
    const byPath = new Map(result.data.services.map((s) => [s.path, s.protectedBranches]));
    expect(byPath.get('/repo/a')).toEqual(['preprod', 'prod']);
    expect(byPath.get('/repo/b')).toEqual([]);
  });

  it('propagates an edtRegistry.list() failure once an active EDT is set', async () => {
    const registry = fakeRegistry(['/repo/a']);

    const result = await listEdtBranchesDivergence({
      registry,
      manifest: fakeManifest(),
      git: fakeGit(),
      edtRegistry: fakeEdtRegistry([], { list: vi.fn(async () => err('edt-registry-invalid-format', 'bad shape')) }),
      state: fakeState({ readActiveEdt: vi.fn(async () => ok('edt-1')) }),
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'edt-registry-invalid-format' } });
  });
});
