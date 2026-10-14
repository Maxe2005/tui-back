// core/scripts/validate-registry: unit tests against fake ports (AD-13) — every I/O-matrix
// row of story 2.28: local hit, remote-only hit, missing branch, unreachable, all five
// loader codes, all three inconclusive codes, empty registry, per-path isolation.
import { describe, expect, it, vi } from 'vitest';
import { ok, err, type Result } from '../result.js';
import type { GitPort } from '../ports/git.js';
import type { Manifest, ManifestPort } from '../ports/manifest.js';
import type { RegistryPort } from '../ports/registry.js';
import { validateRegistry } from './validate-registry.js';

function manifestFor(sharedBranch = 'development'): Manifest {
  return { service: 'svc', container: 'ctr', sharedBranch, modules: {} };
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

function fakeManifest(byPath: Record<string, Result<Manifest>>, overrides: Partial<ManifestPort> = {}): ManifestPort {
  return {
    load: vi.fn(async (path: string) => byPath[path] ?? ok(manifestFor())),
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
    discardPathsToHead: vi.fn(async () => ok(undefined)),
    isRebaseInProgress: vi.fn(async () => ok(false)),
    hasUnmergedPaths: vi.fn(async () => ok(false)),
    finalizeMerge: vi.fn(async () => ok(undefined)),
    listBranches: vi.fn(async () => ok([])),
    renameBranch: vi.fn(async () => ok(undefined)),
    listRemoteBranches: vi.fn(async () => ok([])),
    createTrackingBranch: vi.fn(async () => ok(undefined)),
    isBranchMerged: vi.fn(async () => ok(true)),
    hasStash: vi.fn(async () => ok(false)),
    ...overrides,
  } as GitPort;
}

describe('validateRegistry', () => {
  it('marks a repo valid when sharedBranch exists locally (remote never consulted)', async () => {
    const registry = fakeRegistry(['/repo/a']);
    const manifest = fakeManifest({});
    const listRemoteBranches = vi.fn(async () => ok([]));
    const git = fakeGit({ branchExistsLocally: vi.fn(async () => ok(true)), listRemoteBranches });

    const result = await validateRegistry({ registry, manifest, git });

    expect(result).toEqual({ ok: true, data: { results: [{ path: '/repo/a', outcome: 'valid' }] } });
    expect(listRemoteBranches).not.toHaveBeenCalled();
  });

  it('marks a repo valid when sharedBranch is remote-only (origin/<branch>)', async () => {
    const registry = fakeRegistry(['/repo/a']);
    const manifest = fakeManifest({ '/repo/a': ok(manifestFor('release')) });
    const git = fakeGit({
      branchExistsLocally: vi.fn(async () => ok(false)),
      listRemoteBranches: vi.fn(async () => ok(['origin/release', 'origin/other'])),
    });

    const result = await validateRegistry({ registry, manifest, git });

    expect(result).toEqual({ ok: true, data: { results: [{ path: '/repo/a', outcome: 'valid' }] } });
  });

  it('marks a repo invalid with shared-branch-missing when the branch is nowhere', async () => {
    const registry = fakeRegistry(['/repo/a']);
    const manifest = fakeManifest({ '/repo/a': ok(manifestFor('release')) });
    const git = fakeGit({
      branchExistsLocally: vi.fn(async () => ok(false)),
      listRemoteBranches: vi.fn(async () => ok(['origin/other'])),
    });

    const result = await validateRegistry({ registry, manifest, git });

    expect(result).toEqual({
      ok: true,
      data: {
        results: [
          {
            path: '/repo/a',
            outcome: 'invalid',
            detail: { code: 'shared-branch-missing', message: expect.stringContaining('release') },
          },
        ],
      },
    });
    if (result.ok) {
      expect(result.data.results[0].detail?.message).toBe('sharedBranch "release" not found locally nor on origin');
    }
  });

  it('anchors the remote half on origin/ only — a same-named branch on another remote is still missing', async () => {
    const registry = fakeRegistry(['/repo/a']);
    const manifest = fakeManifest({ '/repo/a': ok(manifestFor('release')) });
    const git = fakeGit({
      branchExistsLocally: vi.fn(async () => ok(false)),
      listRemoteBranches: vi.fn(async () => ok(['upstream/release'])),
    });

    const result = await validateRegistry({ registry, manifest, git });

    expect(result).toMatchObject({
      ok: true,
      data: { results: [{ path: '/repo/a', outcome: 'invalid', detail: { code: 'shared-branch-missing' } }] },
    });
  });

  it('marks an unreachable path unreachable without touching manifest or git', async () => {
    const load = vi.fn(async () => ok(manifestFor()));
    const branchExistsLocally = vi.fn(async () => ok(true));
    const registry = fakeRegistry(['/repo/gone'], { exists: vi.fn(async () => ok(false)) });
    const manifest = fakeManifest({}, { load });
    const git = fakeGit({ branchExistsLocally });

    const result = await validateRegistry({ registry, manifest, git });

    expect(result).toEqual({ ok: true, data: { results: [{ path: '/repo/gone', outcome: 'unreachable' }] } });
    expect(load).not.toHaveBeenCalled();
    expect(branchExistsLocally).not.toHaveBeenCalled();
  });

  it.each([
    ['manifest-not-found', 'No .tui-back.yaml found'],
    ['manifest-read-error', 'Failed to read'],
    ['manifest-invalid-yaml', 'Invalid YAML'],
    ['unknown-module', 'Unknown module id'],
    ['manifest-validation-failed', 'Invalid .tui-back.yaml'],
  ])('surfaces loader failure %s with its exact code + message as invalid', async (code, message) => {
    const registry = fakeRegistry(['/repo/a']);
    const manifest = fakeManifest({ '/repo/a': err(code, `${message} in /repo/a`) });
    const git = fakeGit();

    const result = await validateRegistry({ registry, manifest, git });

    expect(result).toEqual({
      ok: true,
      data: { results: [{ path: '/repo/a', outcome: 'invalid', detail: { code, message: `${message} in /repo/a` } }] },
    });
  });

  it('maps an exists() error to inconclusive, never valid/invalid, never dropped', async () => {
    const registry = fakeRegistry(['/repo/a'], {
      exists: vi.fn(async () => err('registry-stat-error', 'permission denied')),
    });
    const manifest = fakeManifest({});
    const git = fakeGit();

    const result = await validateRegistry({ registry, manifest, git });

    expect(result).toEqual({
      ok: true,
      data: {
        results: [{ path: '/repo/a', outcome: 'inconclusive', detail: { code: 'registry-stat-error', message: 'permission denied' } }],
      },
    });
  });

  it('maps a branchExistsLocally error to inconclusive', async () => {
    const registry = fakeRegistry(['/repo/a']);
    const manifest = fakeManifest({});
    const git = fakeGit({
      branchExistsLocally: vi.fn(async () => err('git-branch-check-error', 'Cannot verify branch state')),
    });

    const result = await validateRegistry({ registry, manifest, git });

    expect(result).toMatchObject({
      ok: true,
      data: { results: [{ path: '/repo/a', outcome: 'inconclusive', detail: { code: 'git-branch-check-error' } }] },
    });
  });

  it('maps a listRemoteBranches error to inconclusive (remote only on local miss)', async () => {
    const registry = fakeRegistry(['/repo/a']);
    const manifest = fakeManifest({});
    const git = fakeGit({
      branchExistsLocally: vi.fn(async () => ok(false)),
      listRemoteBranches: vi.fn(async () => err('git-list-remote-branches-error', 'for-each-ref failed')),
    });

    const result = await validateRegistry({ registry, manifest, git });

    expect(result).toMatchObject({
      ok: true,
      data: { results: [{ path: '/repo/a', outcome: 'inconclusive', detail: { code: 'git-list-remote-branches-error' } }] },
    });
  });

  it('returns an explicit empty results list for an empty registry', async () => {
    const registry = fakeRegistry([]);
    const manifest = fakeManifest({});
    const git = fakeGit();

    const result = await validateRegistry({ registry, manifest, git });

    expect(result).toEqual({ ok: true, data: { results: [] } });
  });

  it('keeps per-path isolation in registry order — one failure never blocks the others', async () => {
    const registry = fakeRegistry(['/repo/valid', '/repo/missing', '/repo/gone', '/repo/broken'], {
      exists: vi.fn(async (path: string) => ok(path !== '/repo/gone')),
    });
    const manifest = fakeManifest({
      '/repo/broken': err('unknown-module', 'Unknown module id "bogus" in /repo/broken'),
      '/repo/missing': ok(manifestFor('release')),
    });
    const git = fakeGit({
      branchExistsLocally: vi.fn(async (path: string, branch: string) => ok(!(path === '/repo/missing' && branch === 'release'))),
      listRemoteBranches: vi.fn(async () => ok([])),
    });

    const result = await validateRegistry({ registry, manifest, git });

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [
          { path: '/repo/valid', outcome: 'valid' },
          { path: '/repo/missing', outcome: 'invalid', detail: { code: 'shared-branch-missing' } },
          { path: '/repo/gone', outcome: 'unreachable' },
          { path: '/repo/broken', outcome: 'invalid', detail: { code: 'unknown-module' } },
        ],
      },
    });
  });

  it('propagates a registry.list() failure unchanged', async () => {
    const registry = fakeRegistry([], { list: vi.fn(async () => err('registry-invalid-yaml', 'bad yaml')) });
    const manifest = fakeManifest({});
    const git = fakeGit();

    const result = await validateRegistry({ registry, manifest, git });

    expect(result).toMatchObject({ ok: false, error: { code: 'registry-invalid-yaml' } });
  });
});
