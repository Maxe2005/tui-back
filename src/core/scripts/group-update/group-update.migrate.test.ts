// core/scripts/group-update: unit tests against fake ports — the migrate phase.
import { describe, expect, it, type Mock, vi } from 'vitest';
import { err, ok } from '../../result.js';
import { groupUpdate } from './group-update.js';
import type { GitPort } from '../../ports/git.js';
import { calls, edtEntry, fakeContainer, fakeEdtRegistry, fakeManifest, fakeMigration, fakeState, manifestFor, member } from '../../shared/core-ports.test-support.js';
import { fakeGit, makeParams } from './group-update.test-support.js';

describe('groupUpdate — migrate phase', () => {
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

  describe('active EDT is the system shared-branches EDT', () => {
    const SYSTEM = {
      ...edtEntry('01SHAREDBRANCHES0000000000', 'Shared branches', [
        member('svc-a', '/repo/a', 'development'),
        member('svc-b', '/repo/b', 'development'),
      ]),
      kind: 'system-shared' as const,
    };
    const systemParams = (git: GitPort, migration = fakeMigration()) =>
      makeParams({
        git,
        migration,
        edtRegistry: fakeEdtRegistry({ list: vi.fn(async () => ok([SYSTEM])) }),
        state: fakeState({ readActiveEdt: vi.fn(async () => ok(SYSTEM.ulid)) }),
      });

    it('pulls every service on its shared branch (fast-forward pull, no merge, no gate call)', async () => {
      const git = fakeGit({ currentBranch: vi.fn(async () => ok('development')) });

      const result = await groupUpdate(systemParams(git));

      expect(result).toMatchObject({ ok: true, data: { results: [{ outcome: 'updated' }, { outcome: 'updated' }] } });
      expect(calls(git.pull).map(([path]) => path)).toEqual(['/repo/a', '/repo/b']);
      expect(calls(git.mergeBranch)).toHaveLength(0);
    });

    it('reports a service checked out elsewhere as skipped (not-on-shared-branch), never switched, no migration', async () => {
      const git = fakeGit({
        currentBranch: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/a' ? 'feat/wip' : 'development')),
      });
      const migration = fakeMigration();

      const result = await groupUpdate(systemParams(git, migration));

      expect(result).toMatchObject({
        ok: true,
        data: {
          results: [
            { service: 'svc-a', outcome: 'skipped', detail: { code: 'not-on-shared-branch' } },
            { service: 'svc-b', outcome: 'updated' },
          ],
        },
      });
      expect(calls(git.checkout)).toHaveLength(0);
      expect(calls(git.pull).map(([path]) => path)).toEqual(['/repo/b']);
      expect(calls(migration.run).filter(([path]) => path === '/repo/a')).toHaveLength(0);
    });
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
