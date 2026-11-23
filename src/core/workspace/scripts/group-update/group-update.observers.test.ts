// core/scripts/group-update: unit tests against fake ports — result observer, live phase tracking, run detail and the parallel pool.
import { describe, expect, it, vi } from 'vitest';
import { err, ok } from '../../../result.js';
import type { GitPort } from '../../../ports/vcs/git.js';
import type { ManifestPort } from '../../../ports/vcs/manifest.js';
import type { MigrationPort } from '../../../ports/vcs/migration.js';
import { groupUpdate, type OnUpdateBlocker, type UpdateBlockerChoice, type UpdatePhase } from './group-update.js';
import { calls, fakeLock, fakeManifest, fakeMigration, fakeRestart, manifestFor } from '../../../shared/core-ports.test-support.js';
import { fakeGit, makeParams } from './group-update.test-support.js';

describe('groupUpdate — per-service result observer', () => {
  it('emits each service row as soon as it is final, in order, before the run returns', async () => {
    const rows: string[] = [];
    const onServiceResult = vi.fn((row: { service: string; outcome: string }) => {
      rows.push(`${row.service}:${row.outcome}`);
    });

    const result = await groupUpdate(makeParams({ onServiceResult }));

    expect(result).toMatchObject({ ok: true });
    expect(rows).toEqual(['svc-a:updated', 'svc-b:updated']);
  });

  it('a throwing observer never breaks the run', async () => {
    const onServiceResult = vi.fn(() => {
      throw new Error('observer bug');
    });

    const result = await groupUpdate(makeParams({ onServiceResult }));

    expect(result).toMatchObject({ ok: true });
    expect(onServiceResult).toHaveBeenCalledTimes(2);
  });
});

describe('groupUpdate — live per-service phase tracking', () => {
  function recordPhases() {
    const seen: Array<[string, UpdatePhase]> = [];
    const onPhase = vi.fn((service: string, phase: UpdatePhase) => {
      seen.push([service, phase]);
    });
    return { seen, onPhase };
  }

  it('fetch+merge path emits merging → migrating → restarting in order per service', async () => {
    const { seen, onPhase } = recordPhases();

    const result = await groupUpdate(makeParams({ onPhase }));

    expect(result).toMatchObject({ ok: true });
    expect(seen).toEqual([
      ['svc-a', 'merging'],
      ['svc-a', 'migrating'],
      ['svc-a', 'restarting'],
      ['svc-b', 'merging'],
      ['svc-b', 'migrating'],
      ['svc-b', 'restarting'],
    ]);
  });

  it('pull path emits pulling instead of merging when already on the shared branch', async () => {
    const { seen, onPhase } = recordPhases();
    // Each member's configured merge source equals its own recorded branch (the EDT
    // unexpected-branch gate still passes), so every service pulls.
    const manifest: ManifestPort = {
      load: vi.fn(async (repoPath: string) =>
        ok({ ...manifestFor(repoPath.split('/').pop() ?? repoPath), sharedBranch: repoPath === '/repo/b' ? 'feat/b' : 'feat/a' }),
      ),
    };
    const git = fakeGit();

    const result = await groupUpdate(makeParams({ git, manifest, onPhase }));

    expect(result).toMatchObject({ ok: true });
    expect(calls(git.pull)).toHaveLength(2);
    expect(seen).toEqual([
      ['svc-a', 'pulling'],
      ['svc-a', 'migrating'],
      ['svc-a', 'restarting'],
      ['svc-b', 'pulling'],
      ['svc-b', 'migrating'],
      ['svc-b', 'restarting'],
    ]);
  });

  it('runMigrations off skips the migrating phase without touching migration.run', async () => {
    const { seen, onPhase } = recordPhases();
    const migration = fakeMigration();

    const result = await groupUpdate(makeParams({ migration, runMigrations: false, onPhase }));

    expect(result).toMatchObject({ ok: true });
    expect(seen).toEqual([
      ['svc-a', 'merging'],
      ['svc-a', 'restarting'],
      ['svc-b', 'merging'],
      ['svc-b', 'restarting'],
    ]);
    expect(calls(migration.run)).toHaveLength(0);
  });

  it('a blank migrationCommand skips the migrating phase', async () => {
    const { seen, onPhase } = recordPhases();
    const manifest: ManifestPort = {
      load: vi.fn(async (repoPath: string) => ok({ ...manifestFor(repoPath.split('/').pop() ?? repoPath), migrationCommand: '  ' })),
    };

    const result = await groupUpdate(makeParams({ manifest, onPhase }));

    expect(result).toMatchObject({ ok: true });
    expect(seen).toEqual([
      ['svc-a', 'merging'],
      ['svc-a', 'restarting'],
      ['svc-b', 'merging'],
      ['svc-b', 'restarting'],
    ]);
  });

  it('a throwing observer never breaks the pipeline — both services still update', async () => {
    const onPhase = vi.fn(() => {
      throw new Error('driving-side bug');
    });

    const result = await groupUpdate(makeParams({ onPhase }));

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [{ service: 'svc-a', outcome: 'updated' }, { service: 'svc-b', outcome: 'updated' }],
      },
    });
  });

  it('mid-recipe stop still emits restarting exactly once per service and fails only that service', async () => {
    const { seen, onPhase } = recordPhases();
    const restart = fakeRestart({
      run: vi.fn(async (repoPath: string, command: string) =>
        repoPath === '/repo/a' && command === 'npm ci' ? err('restart-failed', 'compose up blew up') : ok({ output: '' }),
      ),
    });
    const manifest: ManifestPort = {
      load: vi.fn(async (repoPath: string) =>
        ok({ ...manifestFor(repoPath.split('/').pop() ?? repoPath), restartCommands: ['npm ci', 'docker compose up -d --build'] }),
      ),
    };

    const result = await groupUpdate(makeParams({ manifest, restart, cleanRestart: true, onPhase }));

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [
          { service: 'svc-a', outcome: 'failed', detail: { code: 'restart-failed' } },
          { service: 'svc-b', outcome: 'updated' },
        ],
      },
    });
    // One `restarting` emission per service even though svc-a's recipe stopped mid-way.
    expect(seen.filter(([, phase]) => phase === 'restarting')).toEqual([
      ['svc-a', 'restarting'],
      ['svc-b', 'restarting'],
    ]);
  });

  it('an observer returning a rejected promise never breaks the pipeline nor leaks an unhandled rejection', async () => {
    const onPhase = vi.fn(() => Promise.reject(new Error('driving-side bug')));

    const result = await groupUpdate(makeParams({ onPhase }));
    // Flush the rejection microtask — an unhandled rejection would fail the run.
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(onPhase).toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [{ service: 'svc-a', outcome: 'updated' }, { service: 'svc-b', outcome: 'updated' }],
      },
    });
  });

  it('lock contention emits no phase — a rejected run starts nothing', async () => {
    const { seen, onPhase } = recordPhases();
    const lock = fakeLock({ acquire: async () => err('action-in-progress', 'held') });

    const result = await groupUpdate(makeParams({ lock, onPhase }));

    expect(result).toMatchObject({ ok: false, error: { code: 'update-already-running' } });
    expect(seen).toEqual([]);
  });

  it('no-callback default runs the full flow with no observer and unchanged rows', async () => {
    const result = await groupUpdate(makeParams({}));

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [{ service: 'svc-a', outcome: 'updated' }, { service: 'svc-b', outcome: 'updated' }],
      },
    });
  });
});

describe('groupUpdate — per-service run detail', () => {
  const headSequence = (before: string, after: string) => {
    const fn = vi.fn();
    fn.mockResolvedValueOnce(ok(before)).mockResolvedValue(ok(after));
    return fn as unknown as GitPort['headRevision'];
  };
  const rowOf = (result: Awaited<ReturnType<typeof groupUpdate>>, service: string) =>
    result.ok ? result.data.results.find((row) => row.service === service) : undefined;

  it('reports up-to-date with no diffstat when HEAD is unchanged', async () => {
    const git = fakeGit();

    const result = await groupUpdate(makeParams({ git }));

    expect(rowOf(result, 'svc-a')?.run?.merge).toEqual({ kind: 'up-to-date' });
    expect(calls(git.diffStat)).toHaveLength(0);
  });

  it('reports the advanced diffstat between the before and after HEAD', async () => {
    const git = fakeGit({
      headRevision: headSequence('aaa', 'bbb'),
      diffStat: vi.fn(async () => ok({ files: 3, insertions: 10, deletions: 4 })),
    });

    const result = await groupUpdate(makeParams({ git }));

    expect(rowOf(result, 'svc-a')?.run?.merge).toEqual({ kind: 'advanced', files: 3, insertions: 10, deletions: 4 });
    expect(calls(git.diffStat)[0]).toEqual(['/repo/a', 'aaa', 'bbb']);
  });

  it('keeps advanced without counts when the diff read fails, never failing the row', async () => {
    const git = fakeGit({
      headRevision: headSequence('aaa', 'bbb'),
      diffStat: vi.fn(async () => err('git-diff-error', 'boom')),
    });

    const result = await groupUpdate(makeParams({ git }));

    expect(rowOf(result, 'svc-a')).toMatchObject({ outcome: 'updated', run: { merge: { kind: 'advanced' } } });
    expect(rowOf(result, 'svc-a')?.run?.merge).toEqual({ kind: 'advanced' });
  });

  it('omits merge detail when HEAD is unreadable, without failing the row', async () => {
    const git = fakeGit({ headRevision: vi.fn(async () => err('git-rev-parse-error', 'no head')) });

    const result = await groupUpdate(makeParams({ git }));

    expect(rowOf(result, 'svc-a')).toMatchObject({ outcome: 'updated' });
    expect(rowOf(result, 'svc-a')?.run?.merge).toBeUndefined();
  });

  it('reports a ran migration with its command and the last three non-empty output lines', async () => {
    const migration = fakeMigration({
      run: vi.fn(async () => ok({ output: 'one\n\ntwo\nthree\nfour\n' })),
    });

    const result = await groupUpdate(makeParams({ migration }));

    expect(rowOf(result, 'svc-a')?.run?.migrations).toEqual({
      kind: 'ran',
      command: 'npm run migration:run',
      outputExcerpt: 'two\nthree\nfour',
    });
  });

  it('caps the output excerpt at 200 characters', async () => {
    const migration = fakeMigration({ run: vi.fn(async () => ok({ output: 'x'.repeat(500) })) });

    const result = await groupUpdate(makeParams({ migration }));

    const migrations = rowOf(result, 'svc-a')?.run?.migrations;
    expect(migrations?.kind === 'ran' && migrations.outputExcerpt.length).toBe(200);
  });

  it('keeps the tail of a long excerpt and strips ANSI escapes', async () => {
    const output = `${'x'.repeat(300)}\u001b[31mDONE\u001b[0m`;
    const migration = fakeMigration({ run: vi.fn(async () => ok({ output })) });

    const result = await groupUpdate(makeParams({ migration }));

    const migrations = rowOf(result, 'svc-a')?.run?.migrations;
    expect(migrations?.kind === 'ran' && migrations.outputExcerpt.endsWith('xxDONE')).toBe(true);
    expect(migrations?.kind === 'ran' && migrations.outputExcerpt.includes('\u001b')).toBe(false);
  });

  it('reports migrations none when disabled or undeclared', async () => {
    const disabled = await groupUpdate(makeParams({ runMigrations: false }));
    const manifest = fakeManifest({
      load: vi.fn(async () => ok({ ...manifestFor('svc-x'), migrationCommand: '  ' })),
    });
    const blank = await groupUpdate(makeParams({ manifest }));

    expect(rowOf(disabled, 'svc-a')?.run?.migrations).toEqual({ kind: 'none' });
    expect(rowOf(blank, 'svc-a')?.run?.migrations).toEqual({ kind: 'none' });
  });

  it('keeps the run detail on a container-less updated row', async () => {
    const manifest: ManifestPort = {
      load: vi.fn(async () => ok({ service: 'svc-x', migrationCommand: 'm', sharedBranch: 'development', modules: {} })),
    };

    const result = await groupUpdate(makeParams({ manifest }));

    expect(rowOf(result, 'svc-a')).toMatchObject({
      outcome: 'updated',
      run: { merge: { kind: 'up-to-date' }, migrations: { kind: 'ran', command: 'm' } },
    });
  });

  it('carries no run detail on a failed migration row', async () => {
    const migration = fakeMigration({ run: vi.fn(async () => err('migration-failed', 'nope')) });

    const result = await groupUpdate(makeParams({ migration }));

    expect(rowOf(result, 'svc-a')?.outcome).toBe('failed');
    expect(rowOf(result, 'svc-a')?.run).toBeUndefined();
  });
});

describe('groupUpdate — parallel pool', () => {
  const tickMs = () => new Promise<void>((resolveTick) => setTimeout(resolveTick, 2));

  function trackedMigration(): { migration: MigrationPort; peak: () => number } {
    let inFlight = 0;
    let peak = 0;
    const migration = fakeMigration({
      run: vi.fn(async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await tickMs();
        inFlight -= 1;
        return ok({ output: '' });
      }),
    });
    return { migration, peak: () => peak };
  }

  it('runs the services in parallel up to the concurrency and keeps configuration order', async () => {
    const { migration, peak } = trackedMigration();
    const result = await groupUpdate(makeParams({ migration, concurrency: 2 }));
    expect(peak()).toBe(2);
    expect(result).toMatchObject({
      ok: true,
      data: { results: [{ service: 'svc-a', outcome: 'updated' }, { service: 'svc-b', outcome: 'updated' }] },
    });
  });

  it('concurrency 1 never overlaps services', async () => {
    const { migration, peak } = trackedMigration();
    await groupUpdate(makeParams({ migration, concurrency: 1 }));
    expect(peak()).toBe(1);
  });

  it('a worker that throws becomes that service failed row, the other still runs', async () => {
    const git = fakeGit({
      currentBranch: vi.fn(async (repoPath: string) => {
        if (repoPath === '/repo/a') {
          throw new Error('git exploded');
        }
        return ok('feat/b');
      }),
    });
    const result = await groupUpdate(makeParams({ git, concurrency: 2 }));
    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [
          { service: 'svc-a', outcome: 'failed', detail: { code: 'internal-error' } },
          { service: 'svc-b', outcome: 'updated' },
        ],
      },
    });
  });

  it('a service waiting on the developer does not stop the others (pool > 1)', async () => {
    let answer: (choice: UpdateBlockerChoice) => void = () => {};
    const seam: OnUpdateBlocker = (blocker) =>
      blocker.service === 'svc-a'
        ? new Promise<UpdateBlockerChoice>((resolveChoice) => {
            answer = resolveChoice;
          })
        : Promise.resolve('cancel-repo');
    const git = fakeGit({
      listDirtyPaths: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/a' ? ['wip.txt'] : [])),
    });
    const done: string[] = [];
    const run = groupUpdate(
      makeParams({ git, onUpdateBlocker: seam, concurrency: 2, onServiceResult: (row) => done.push(row.service) }),
    );
    await tickMs();
    await tickMs();
    // svc-b completed while svc-a waited on the developer.
    expect(done).toEqual(['svc-b']);
    answer('cancel-repo');
    const result = await run;
    expect(result).toMatchObject({
      ok: true,
      data: { results: [{ service: 'svc-a', outcome: 'skipped' }, { service: 'svc-b', outcome: 'updated' }] },
    });
  });

  it('cancel-run lets in-flight services finish their step and skips the rest', async () => {
    const seam: OnUpdateBlocker = async () => 'cancel-run';
    const git = fakeGit({
      listDirtyPaths: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/a' ? ['wip.txt'] : [])),
    });
    const result = await groupUpdate(makeParams({ git, onUpdateBlocker: seam, concurrency: 1 }));
    expect(result).toMatchObject({
      ok: true,
      data: { results: [{ service: 'svc-a', outcome: 'skipped' }, { service: 'svc-b', outcome: 'skipped', detail: { code: 'run-cancelled' } }] },
    });
  });

  it('the ordering hook runs a stage alone before the next one', async () => {
    const started: string[] = [];
    const migration = fakeMigration({
      run: vi.fn(async (repoPath: string) => {
        started.push(`start:${repoPath}`);
        await tickMs();
        started.push(`end:${repoPath}`);
        return ok({ output: '' });
      }),
    });
    await groupUpdate(makeParams({ migration, concurrency: 3, ordering: ({ service }) => (service === 'svc-b' ? 0 : 1) }));
    expect(started).toEqual(['start:/repo/b', 'end:/repo/b', 'start:/repo/a', 'end:/repo/a']);
  });

  it('afterStage sees the stage rows; a cancel there skips the later stage and its hook', async () => {
    const seen: string[] = [];
    const result = await groupUpdate(
      makeParams({
        concurrency: 3,
        ordering: ({ service }) => (service === 'svc-b' ? 0 : 1),
        afterStage: (stage, rows, control) => {
          seen.push(`${stage}:${rows.map((row) => row.service).join(',')}`);
          if (stage === 0) {
            control.cancel();
          }
        },
      }),
    );
    expect(seen).toEqual(['0:svc-b']);
    expect(result).toMatchObject({
      ok: true,
      data: { results: [{ service: 'svc-a', outcome: 'skipped', detail: { code: 'run-cancelled' } }, { service: 'svc-b', outcome: 'updated' }] },
    });
  });
});
