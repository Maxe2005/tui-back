// core/scripts/group-update: unit tests against fake ports — pre-run configuration.
import { describe, expect, it, vi } from 'vitest';
import { ok } from '../result.js';
import { groupUpdate, type GroupUpdateParams } from './group-update.js';
import { calls, fakeContainer, fakeLock, fakeMigration, fakeRegistry, fakeRestart } from '../shared/core-ports.test-support.js';
import { fakeGit, makeParams } from './group-update.test-support.js';

describe('groupUpdate — pre-run configuration', () => {
  it('an EDT-scoped selection runs only the selected service: the deselected one is never touched and absent from results', async () => {
    const git = fakeGit();
    const container = fakeContainer();
    const migration = fakeMigration();
    const lock = fakeLock();

    const result = await groupUpdate(
      makeParams({ git, container, migration, lock, selection: [{ service: 'svc-a', repoPath: '/repo/a' }] }),
    );

    expect(result).toEqual({
      ok: true,
      data: { ulid: 'edt-active', topic: 'demo', results: [{ service: 'svc-a', outcome: 'updated', run: expect.anything() }], scope: 'edt' },
    });
    // The deselected service never reached git, migration, or container at all.
    for (const fn of [git.currentBranch, git.fetch, git.pull, git.mergeBranch, git.assertAllowedBranch]) {
      expect(calls(fn).filter(([path]) => path === '/repo/b')).toHaveLength(0);
    }
    expect(calls(migration.run).filter(([path]) => path === '/repo/b')).toHaveLength(0);
    expect(calls(container.restart).filter(([ctr]) => ctr === 'ctr-b')).toHaveLength(0);
    expect(calls(container.restart)).toEqual([['ctr-a']]);
  });

  it('an empty EDT-scoped selection is rejected no-services-selected before any lock or git action', async () => {
    const git = fakeGit();
    const lock = fakeLock();
    const container = fakeContainer();
    const migration = fakeMigration();

    const result = await groupUpdate(makeParams({ git, lock, container, migration, selection: [] }));

    expect(result).toMatchObject({ ok: false, error: { code: 'no-services-selected' } });
    expect(calls(lock.acquire)).toHaveLength(0);
    expect(calls(git.currentBranch)).toHaveLength(0);
    expect(calls(migration.run)).toHaveLength(0);
    expect(calls(container.restart)).toHaveLength(0);
  });

  it('an EDT-scoped selection matching no member is rejected no-services-selected, nothing ran', async () => {
    const git = fakeGit();
    const lock = fakeLock();

    const result = await groupUpdate(makeParams({ git, lock, selection: [{ service: 'svc-nope', repoPath: '/repo/nope' }] }));

    expect(result).toMatchObject({ ok: false, error: { code: 'no-services-selected' } });
    expect(calls(lock.acquire)).toHaveLength(0);
    expect(calls(git.currentBranch)).toHaveLength(0);
  });

  it('a per-service sourceBranch override replaces the manifest sharedBranch as the merge source', async () => {
    const git = fakeGit();
    const container = fakeContainer();

    const result = await groupUpdate(
      makeParams({ git, container, selection: [{ service: 'svc-a', repoPath: '/repo/a', sourceBranch: 'release/1' }] }),
    );

    expect(result).toMatchObject({
      ok: true,
      data: { results: [{ service: 'svc-a', outcome: 'updated' }] },
    });
    // svc-a fetched/merged the override; svc-b (deselected) was never touched.
    expect(calls(git.fetch)).toContainEqual(['/repo/a', 'release/1']);
    expect(calls(git.mergeBranch)).toContainEqual(['/repo/a', 'release/1']);
    expect(calls(git.fetch).filter(([path]) => path === '/repo/b')).toHaveLength(0);
    // The unexpected-branch gate still applies to the member's own recorded branch.
    expect(calls(git.assertAllowedBranch)).toContainEqual(['/repo/a', 'feat/a', 'edt-active']);
  });

  it('a whitespace-padded sourceBranch validates and resolves as trimmed', async () => {
    const git = fakeGit({
      branchExistsLocally: vi.fn(async () => ok(true)),
    });
    const container = fakeContainer();

    const result = await groupUpdate(
      makeParams({ git, container, selection: [{ service: 'svc-a', repoPath: '/repo/a', sourceBranch: '  release/1  ' }] }),
    );

    expect(result).toMatchObject({
      ok: true,
      data: { results: [{ service: 'svc-a', outcome: 'updated' }] },
    });
    // Validation, fetch, and merge all saw the trimmed branch — never the padded one.
    expect(calls(git.branchExistsLocally)).toEqual([['/repo/a', 'release/1']]);
    expect(calls(git.fetch)).toContainEqual(['/repo/a', 'release/1']);
    expect(calls(git.mergeBranch)).toContainEqual(['/repo/a', 'release/1']);
  });

  it('an unresolvable sourceBranch is rejected unknown-branch with no merge, migration, or restart anywhere', async () => {
    const git = fakeGit({
      branchExistsLocally: vi.fn(async (_repoPath: string, branch: string) => ok(branch !== 'nope/not-here')),
    });
    const container = fakeContainer();
    const migration = fakeMigration();
    const lock = fakeLock();

    const result = await groupUpdate(
      makeParams({
        git,
        container,
        migration,
        lock,
        selection: [{ service: 'svc-a', repoPath: '/repo/a', sourceBranch: 'nope/not-here' }],
      }),
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'unknown-branch' } });
    if (!result.ok) {
      expect(result.error.message).toContain('svc-a');
      expect(result.error.message).toContain('nope/not-here');
    }
    // The run never started: no lock, no pull/merge, no migration, no restart.
    expect(calls(lock.acquire)).toHaveLength(0);
    expect(calls(git.fetch)).toHaveLength(0);
    expect(calls(git.pull)).toHaveLength(0);
    expect(calls(git.mergeBranch)).toHaveLength(0);
    expect(calls(migration.run)).toHaveLength(0);
    expect(calls(container.restart)).toHaveLength(0);
  });

  it('runMigrations: false skips every migration.run even for services declaring a migrationCommand', async () => {
    const migration = fakeMigration();
    const container = fakeContainer();

    const result = await groupUpdate(makeParams({ migration, container, runMigrations: false }));

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [{ service: 'svc-a', outcome: 'updated' }, { service: 'svc-b', outcome: 'updated' }],
      },
    });
    expect(calls(migration.run)).toHaveLength(0);
    expect(calls(container.restart)).toHaveLength(2);
  });

  it('a per-service runMigrations override beats the run-wide toggle in both directions', async () => {
    const migration = fakeMigration();

    await groupUpdate(
      makeParams({
        migration,
        runMigrations: true,
        selection: [
          { service: 'svc-a', repoPath: '/repo/a', runMigrations: false },
          { service: 'svc-b', repoPath: '/repo/b' },
        ],
      }),
    );
    expect(calls(migration.run).map(([path]) => path)).toEqual(['/repo/b']);

    const second = fakeMigration();
    await groupUpdate(
      makeParams({
        migration: second,
        runMigrations: false,
        selection: [{ service: 'svc-a', repoPath: '/repo/a', runMigrations: true }, { service: 'svc-b', repoPath: '/repo/b' }],
      }),
    );
    expect(calls(second.run).map(([path]) => path)).toEqual(['/repo/a']);
  });

  it('a per-service cleanRestart: false keeps the plain restart even when the run asks for a clean one', async () => {
    const container = fakeContainer();
    const restart = fakeRestart();

    await groupUpdate(
      makeParams({
        container,
        restart,
        cleanRestart: true,
        selection: [{ service: 'svc-a', repoPath: '/repo/a', cleanRestart: false }],
      }),
    );

    expect(calls(container.restart)).toEqual([['ctr-a']]);
    expect(calls(restart.run)).toHaveLength(0);
  });

  it('cleanRestart: true without a declared recipe falls back to the plain container restart', async () => {
    const container = fakeContainer();
    const restart = fakeRestart();

    const result = await groupUpdate(makeParams({ container, restart, cleanRestart: true }));

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [{ service: 'svc-a', outcome: 'updated' }, { service: 'svc-b', outcome: 'updated' }],
      },
    });
    expect(calls(container.restart)).toEqual([['ctr-a'], ['ctr-b']]);
    expect(calls(restart.run)).toHaveLength(0);
  });

  it('omitting the new params preserves the full default selection with migrations on', async () => {
    const migration = fakeMigration();

    const result = await groupUpdate(makeParams({ migration }));

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [{ service: 'svc-a', outcome: 'updated' }, { service: 'svc-b', outcome: 'updated' }],
      },
    });
    expect(calls(migration.run)).toHaveLength(2);
  });

  it('an all-repos selection filters by service: excluded repos are absent and untouched', async () => {
    const git = fakeGit();
    const container = fakeContainer();
    const params: GroupUpdateParams = {
      ...makeParams({ git, container }),
      registry: fakeRegistry(['/repo/a', '/repo/b']),
      scope: 'all',
      selection: [{ service: 'b' }],
    };

    const result = await groupUpdate(params);

    expect(result).toMatchObject({
      ok: true,
      data: { ulid: 'all', scope: 'all', results: [{ service: 'b', outcome: 'updated' }] },
    });
    expect(calls(git.currentBranch).filter(([path]) => path === '/repo/a')).toHaveLength(0);
    expect(calls(container.restart).filter(([ctr]) => ctr === 'ctr-a')).toHaveLength(0);
  });

  it('an all-repos empty selection is rejected no-services-selected without taking the lock', async () => {
    const lock = fakeLock();
    const git = fakeGit();
    const params: GroupUpdateParams = {
      ...makeParams({ lock, git }),
      registry: fakeRegistry(['/repo/a']),
      scope: 'all',
      selection: [],
    };

    const result = await groupUpdate(params);

    expect(result).toMatchObject({ ok: false, error: { code: 'no-services-selected' } });
    expect(calls(lock.acquire)).toHaveLength(0);
    expect(calls(git.currentBranch)).toHaveLength(0);
  });

  it('an all-repos run with runMigrations: false never runs migrations', async () => {
    const migration = fakeMigration();
    const params: GroupUpdateParams = {
      ...makeParams({ migration }),
      registry: fakeRegistry(['/repo/a', '/repo/b']),
      scope: 'all',
      runMigrations: false,
    };

    const result = await groupUpdate(params);

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [{ service: 'a', outcome: 'updated' }, { service: 'b', outcome: 'updated' }],
      },
    });
    expect(calls(migration.run)).toHaveLength(0);
  });

  it('an all-repos per-service sourceBranch override is merged instead of the shared branch', async () => {
    const git = fakeGit();
    const params: GroupUpdateParams = {
      ...makeParams({ git }),
      registry: fakeRegistry(['/repo/a', '/repo/b']),
      scope: 'all',
      selection: [
        { service: 'a', repoPath: '/repo/a', sourceBranch: 'release/1' },
        { service: 'b', repoPath: '/repo/b' },
      ],
    };

    const result = await groupUpdate(params);

    expect(result).toMatchObject({ ok: true });
    expect(calls(git.fetch)).toContainEqual(['/repo/a', 'release/1']);
    expect(calls(git.mergeBranch)).toContainEqual(['/repo/a', 'release/1']);
    expect(calls(git.fetch)).toContainEqual(['/repo/b', 'development']);
  });

  it('an all-repos per-service toggle override beats the run-wide toggle', async () => {
    const migration = fakeMigration();
    const container = fakeContainer();
    const params: GroupUpdateParams = {
      ...makeParams({ migration, container }),
      registry: fakeRegistry(['/repo/a', '/repo/b']),
      scope: 'all',
      runMigrations: true,
      selection: [
        { service: 'a', repoPath: '/repo/a', runMigrations: false },
        { service: 'b', repoPath: '/repo/b' },
      ],
    };

    await groupUpdate(params);

    expect(calls(migration.run).map(([path]) => path)).toEqual(['/repo/b']);
  });
});
