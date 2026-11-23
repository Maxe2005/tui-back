// core/scripts/group-update: unit tests against fake ports — all-repos scope and services without a declared container.
import { describe, expect, it, vi } from 'vitest';
import { err, ok } from '../../../result.js';
import type { Manifest, ManifestPort } from '../../../ports/vcs/manifest.js';
import type { RegistryPort } from '../../../ports/storage/registry.js';
import { GROUP_UPDATE_LOCK_KEY, groupUpdate, type GroupUpdateParams } from './group-update.js';
import { calls, fakeContainer, fakeLock, fakeManifest, fakeRegistry, fakeRestart, manifestFor } from '../../../shared/core-ports.test-support.js';
import { fakeGit, makeParams } from './group-update.test-support.js';

describe('groupUpdate — all-repos scope', () => {
  function allParams(overrides: Partial<GroupUpdateParams> = {}): GroupUpdateParams {
    return {
      ...makeParams(),
      registry: overrides.registry ?? fakeRegistry(['/repo/a', '/repo/b']),
      scope: 'all',
      ...overrides,
    };
  }

  it('forwards ordering and afterStage: the hook sees the stage rows and a cancel there cancels later stages', async () => {
    const seen: string[] = [];
    const result = await groupUpdate(
      allParams({
        concurrency: 3,
        ordering: ({ repoPath }) => (repoPath === '/repo/b' ? 0 : 1),
        afterStage: (stage, rows, control) => {
          seen.push(`${stage}:${rows.map((row) => row.service).join(',')}`);
          if (stage === 0) {
            control.cancel();
          }
        },
      }),
    );
    expect(seen).toEqual(['0:b']);
    expect(result).toMatchObject({
      ok: true,
      data: { results: [{ service: 'a', outcome: 'skipped', detail: { code: 'run-cancelled' } }, { service: 'b', outcome: 'updated' }] },
    });
  });

  it('shouldCancel stops the run cooperatively: nothing after the flip runs, rows are skipped not failed', async () => {
    let cancelled = false;
    const result = await groupUpdate(
      allParams({
        shouldCancel: () => cancelled,
        onServiceResult: () => {
          cancelled = true;
        },
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.results.length).toBeGreaterThan(1);
      expect(result.data.results[0].outcome).toBe('updated');
      expect(result.data.results.slice(1).every((row) => row.outcome === 'skipped' && row.detail?.code === 'run-cancelled')).toBe(true);
    }
  });

  it('shouldCancel in EDT scope skips the remaining members as run-cancelled', async () => {
    let cancelled = false;
    const result = await groupUpdate(
      makeParams({
        shouldCancel: () => cancelled,
        onServiceResult: () => {
          cancelled = true;
        },
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      data: { results: [{ service: 'svc-a', outcome: 'updated' }, { service: 'svc-b', outcome: 'skipped', detail: { code: 'run-cancelled' } }] },
    });
  });

  it('a throwing shouldCancel is logged and treated as cancelled', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const result = await groupUpdate(makeParams({ shouldCancel: () => { throw new Error('bad predicate'); } }));
      expect(result).toMatchObject({ ok: true, data: { results: [{ outcome: 'skipped', detail: { code: 'run-cancelled' } }, { outcome: 'skipped', detail: { code: 'run-cancelled' } }] } });
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

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
          { service: 'a', outcome: 'updated', run: expect.anything() },
          { service: 'b', outcome: 'updated', run: expect.anything() },
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

describe('groupUpdate — services without a declared container', () => {
  const RECIPE = ['npm ci', 'docker compose up -d --build'];

  function containerLessManifest(service: string, restartCommands?: string[]): Manifest {
    return {
      service,
      migrationCommand: 'npm run migration:run',
      ...(restartCommands !== undefined ? { restartCommands } : {}),
      sharedBranch: 'development',
      modules: {},
    };
  }

  it('a container-less service without a recipe skips the restart with a repo-naming row, never failed, and the container port is never called', async () => {
    const git = fakeGit();
    const container = fakeContainer();
    const restart = fakeRestart();
    const manifest: ManifestPort = {
      load: vi.fn(async (repoPath: string) =>
        repoPath === '/repo/a' ? ok(containerLessManifest('svc-a')) : ok(manifestFor(repoPath.split('/').pop() ?? repoPath)),
      ),
    };

    const result = await groupUpdate(makeParams({ manifest, git, container, restart }));

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [
          { service: 'svc-a', outcome: 'updated' },
          { service: 'svc-b', outcome: 'updated' },
        ],
      },
    });
    // Pull/merge and migrations still ran for the container-less service — only the restart
    // phase was skipped.
    expect(calls(git.mergeBranch)).toContainEqual(['/repo/a', 'development']);
    expect(calls(container.restart)).toEqual([['ctr-b']]);
    expect(calls(restart.run)).toHaveLength(0);
  });

  it('a container-less service with a declared recipe runs the recipe when clean-restart is on', async () => {
    const container = fakeContainer();
    const restart = fakeRestart();
    const manifest: ManifestPort = {
      load: vi.fn(async (repoPath: string) =>
        ok(containerLessManifest(repoPath.split('/').pop() ?? repoPath, RECIPE)),
      ),
    };

    const result = await groupUpdate(makeParams({ manifest, restart, container, cleanRestart: true }));

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [{ service: 'svc-a', outcome: 'updated' }, { service: 'svc-b', outcome: 'updated' }],
      },
    });
    expect(calls(restart.run)).toEqual([
      ['/repo/a', 'npm ci'],
      ['/repo/a', 'docker compose up -d --build'],
      ['/repo/b', 'npm ci'],
      ['/repo/b', 'docker compose up -d --build'],
    ]);
    expect(calls(container.restart)).toHaveLength(0);
  });

  it('a container-less service with a declared recipe still skips when clean-restart is off', async () => {
    const container = fakeContainer();
    const restart = fakeRestart();
    const manifest: ManifestPort = {
      load: vi.fn(async (repoPath: string) =>
        ok(containerLessManifest(repoPath.split('/').pop() ?? repoPath, RECIPE)),
      ),
    };

    const result = await groupUpdate(makeParams({ manifest, restart, container, cleanRestart: false }));

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [
          { service: 'svc-a', outcome: 'updated' },
          { service: 'svc-b', outcome: 'updated' },
        ],
      },
    });
    expect(calls(restart.run)).toHaveLength(0);
    expect(calls(container.restart)).toHaveLength(0);
  });

  it('a failing recipe on a container-less service fails the row like any other recipe failure', async () => {
    const container = fakeContainer();
    const restart = fakeRestart({
      run: vi.fn(async () => err('restart-failed', 'compose up blew up')),
    });
    const manifest: ManifestPort = {
      load: vi.fn(async (repoPath: string) =>
        ok(containerLessManifest(repoPath.split('/').pop() ?? repoPath, RECIPE)),
      ),
    };

    const result = await groupUpdate(makeParams({ manifest, restart, container, cleanRestart: true }));

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [
          { service: 'svc-a', outcome: 'failed', detail: { code: 'restart-failed' } },
          { service: 'svc-b', outcome: 'failed', detail: { code: 'restart-failed' } },
        ],
      },
    });
    expect(calls(container.restart)).toHaveLength(0);
  });
});
