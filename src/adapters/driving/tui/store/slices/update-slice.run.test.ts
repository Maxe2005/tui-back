import { describe, expect, it, vi } from 'vitest';
import { ok, err } from '../../../../../core/result.js';
import type { ContainerPort } from '../../../../../core/ports/container.js';
import type { GitPort } from '../../../../../core/ports/git.js';
import type { MigrationPort } from '../../../../../core/ports/migration.js';
import type { StatePort } from '../../../../../core/ports/state.js';
import { createAppStore } from '../app-store.js';
import { fakeDeps } from './update-slice.test-support.js';

describe('live per-service run tracking', () => {
  async function waitForCondition(condition: () => boolean): Promise<void> {
    for (let i = 0; i < 200 && !condition(); i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  it('starts with empty live phase and issue maps', () => {
    const store = createAppStore(fakeDeps());

    expect(store.getState().liveServicePhase).toEqual({});
    expect(store.getState().liveServiceIssues).toEqual({});
  });

  it('tracks the live phase mid-run and clears it when the run lands done', async () => {
    let releaseMigration: (() => void) | undefined;
    const migrationGate = new Promise<void>((resolve) => {
      releaseMigration = resolve;
    });
    const migration: MigrationPort = {
      run: vi.fn(async () => {
        await migrationGate;
        return ok({ output: '' });
      }),
    };
    const store = createAppStore(fakeDeps({ migration }));

    const run = store.getState().runGroupUpdate();
    // svc-a advances merge → migrate, then blocks inside migration.run: its live step is
    // observable while the run is still in flight (default fakes take the merge path).
    await waitForCondition(() => store.getState().liveServicePhase['svc-a'] === 'migrating');
    expect(store.getState().updateStatus).toBe('running');
    // The default pool runs both services at once: each one is in its migrate step.
    await waitForCondition(() => store.getState().liveServicePhase['svc-b'] === 'migrating');
    expect(store.getState().liveServicePhase).toEqual({ 'svc-a': 'migrating', 'svc-b': 'migrating' });

    releaseMigration?.();
    await run;

    expect(store.getState().updateStatus).toBe('done');
    expect(store.getState().liveServicePhase).toEqual({});
  });

  it('steps advance live and settle into the last-run snapshot', async () => {
    let releaseMigration: (() => void) | undefined;
    const migrationGate = new Promise<void>((resolve) => {
      releaseMigration = resolve;
    });
    const migration: MigrationPort = {
      run: vi.fn(async () => {
        await migrationGate;
        return ok({ output: '' });
      }),
    };
    const store = createAppStore(fakeDeps({ migration }));

    const run = store.getState().runGroupUpdate();
    await waitForCondition(() => store.getState().liveServicePhase['svc-a'] === 'migrating');
    expect(store.getState().liveServiceSteps['svc-a']).toEqual({ merge: 'done', migration: 'running', restart: 'pending' });

    releaseMigration?.();
    await run;

    expect(store.getState().liveServiceSteps).toEqual({});
    expect(store.getState().lastServiceRuns['svc-a']?.steps).toEqual({ merge: 'done', migration: 'done', restart: 'done' });
  });

  it('a finished service flips to its last-run view while another is still running', async () => {
    let releaseB: (() => void) | undefined;
    const gateB = new Promise<void>((resolve) => {
      releaseB = resolve;
    });
    const migration: MigrationPort = {
      run: vi.fn(async (repoPath: string) => {
        if (repoPath === '/repo/b') {
          await gateB;
        }
        return ok({ output: '' });
      }),
    };
    const store = createAppStore(fakeDeps({ migration }));

    const run = store.getState().runGroupUpdate();
    await waitForCondition(() => store.getState().liveServiceDone['svc-a'] === true);

    expect(store.getState().updateStatus).toBe('running');
    expect(store.getState().lastServiceRuns['svc-a']?.steps).toEqual({ merge: 'done', migration: 'done', restart: 'done' });
    expect(store.getState().lastServiceOutcomes['svc-a']?.outcome).toBe('updated');
    expect(store.getState().liveServiceDone['svc-b']).toBeUndefined();

    releaseB?.();
    await run;
    expect(store.getState().liveServiceDone).toEqual({});
  });

  it('a blocker appends an unresolved issue, resolved once the run re-verifies and moves on', async () => {
    const base = fakeDeps();
    let dirtyReads = 0;
    const git: GitPort = {
      ...(base.git as GitPort),
      listDirtyPaths: vi.fn(async (repoPath: string) => {
        dirtyReads += 1;
        // Only the first read sees the dirt — every re-verification reads clean.
        return ok(dirtyReads === 1 && repoPath === '/repo/a' ? ['src/app.ts'] : []);
      }),
    };
    const store = createAppStore({ ...base, git });

    const run = store.getState().runGroupUpdate();
    await waitForCondition(() => store.getState().incidents.length > 0);

    // Raising the menu appends the unresolved entry before any phase is emitted.
    expect(store.getState().incidents[0]?.blocker).toMatchObject({ service: 'svc-a', kind: 'dirty-worktree' });
    expect(store.getState().liveServiceIssues).toEqual({
      'svc-a': [{ kind: 'dirty-worktree', detail: '/repo/a', resolved: false }],
    });
    expect(store.getState().liveServicePhase).toEqual({});

    store.getState().resolveUpdateIncident(store.getState().incidents[0]?.id ?? 'none', 'edited');
    await run;

    expect(store.getState().updateStatus).toBe('done');
    expect(store.getState().updateResults).toEqual([
      { service: 'svc-a', outcome: 'updated', run: expect.anything() },
      { service: 'svc-b', outcome: 'updated', run: expect.anything() },
    ]);
    // Core resumed past the blocker (the next phase fired), so the entry flipped.
    expect(store.getState().liveServiceIssues).toEqual({
      'svc-a': [{ kind: 'dirty-worktree', detail: '/repo/a', resolved: true }],
    });
    expect(store.getState().liveServicePhase).toEqual({});
  });

  it('a re-presented menu for the same kind stacks no duplicate entry and stays unresolved on cancel', async () => {
    const base = fakeDeps();
    let dirtyReads = 0;
    const git: GitPort = {
      ...(base.git as GitPort),
      listDirtyPaths: vi.fn(async (repoPath: string) => {
        if (repoPath !== '/repo/a') {
          return ok([]);
        }
        dirtyReads += 1;
        // Still dirty after the stash, clean only once the repo is cancelled.
        return ok(dirtyReads <= 2 ? ['src/app.ts'] : []);
      }),
    };
    const store = createAppStore({ ...base, git });

    const run = store.getState().runGroupUpdate();
    await waitForCondition(() => store.getState().incidents.length > 0);
    store.getState().resolveUpdateIncident(store.getState().incidents[0]?.id ?? 'none', 'stash');

    // Core re-presents the same menu — the second raise must not duplicate the row.
    await waitForCondition(() => store.getState().incidents.length > 0 && dirtyReads >= 2);
    expect(store.getState().liveServiceIssues).toEqual({
      'svc-a': [{ kind: 'dirty-worktree', detail: '/repo/a', resolved: false }],
    });

    store.getState().resolveUpdateIncident(store.getState().incidents[0]?.id ?? 'none', 'cancel-repo');
    await run;

    expect(store.getState().updateResults).toEqual([
      { service: 'svc-a', outcome: 'skipped', detail: { code: 'dirty-worktree', message: expect.any(String) } },
      { service: 'svc-b', outcome: 'updated', run: expect.anything() },
    ]);
    // No further phase ever fired for the cancelled repo — the entry stays unresolved.
    expect(store.getState().liveServiceIssues).toEqual({
      'svc-a': [{ kind: 'dirty-worktree', detail: '/repo/a', resolved: false }],
    });
  });

  it('a migration failure lands an unresolved migration-failed entry while the live phase clears', async () => {
    const migration: MigrationPort = {
      run: vi.fn(async (repoPath: string) =>
        repoPath === '/repo/a' ? err('sh-spawn-error', 'relation missing') : ok({ output: '' }),
      ),
    };
    const store = createAppStore(fakeDeps({ migration }));

    await store.getState().runGroupUpdate();

    expect(store.getState().updateStatus).toBe('done');
    expect(store.getState().updateResults).toEqual([
      { service: 'svc-a', outcome: 'failed', detail: { code: 'migration-failed', message: expect.any(String) } },
      { service: 'svc-b', outcome: 'updated', run: expect.anything() },
    ]);
    expect(store.getState().liveServicePhase).toEqual({});
    expect(store.getState().liveServiceIssues['svc-a']).toHaveLength(1);
    expect(store.getState().liveServiceIssues['svc-a']?.[0]).toMatchObject({ kind: 'migration-failed', resolved: false });
    expect(store.getState().liveServiceIssues['svc-a']?.[0]?.detail).toContain('relation missing');
  });

  it('a fresh run clears the previous run’s issue log at start', async () => {
    let migrationCalls = 0;
    const migration: MigrationPort = {
      run: vi.fn(async () => {
        migrationCalls += 1;
        return migrationCalls === 1 ? err('sh-spawn-error', 'boom') : ok({ output: '' });
      }),
    };
    const store = createAppStore(fakeDeps({ migration }));

    await store.getState().runGroupUpdate();
    expect(store.getState().liveServiceIssues['svc-a']).toMatchObject([{ kind: 'migration-failed', resolved: false }]);

    await store.getState().runGroupUpdate();
    expect(store.getState().updateStatus).toBe('done');
    expect(store.getState().liveServiceIssues).toEqual({});
    expect(store.getState().liveServicePhase).toEqual({});
  });

  it('a top-level rejection clears the live maps — nothing ran', async () => {
    const state: StatePort = {
      readActiveEdt: vi.fn(async () => ok(null)),
      writeActiveEdt: vi.fn(async () => ok(undefined)),
      readSplitterRatios: vi.fn(async () => ok(null)),
      writeSplitterRatios: vi.fn(async () => ok(undefined)),
      readFilterHistory: vi.fn(async () => ok(null)),
      writeFilterHistory: vi.fn(async () => ok(undefined)),
      readCommandHistory: vi.fn(async () => ok(null)),
      writeCommandHistory: vi.fn(async () => ok(undefined)),
      readLogRules: vi.fn(async () => ok(null)),
      writeLogRules: vi.fn(async () => ok(undefined)),
      readLogRuleSets: vi.fn(async () => ok(null)),
      writeLogRuleSets: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ state }));
    store.setState({ liveServicePhase: { 'svc-a': 'pulling' }, liveServiceIssues: { 'svc-a': [] } });

    await store.getState().runGroupUpdate();

    expect(store.getState().updateStatus).toBe('error');
    expect(store.getState().updateErrorCode).toBe('no-active-edt');
    expect(store.getState().liveServicePhase).toEqual({});
    expect(store.getState().liveServiceIssues).toEqual({});
  });

  it('clearUpdate drops the live maps alongside the run state', () => {
    const store = createAppStore(fakeDeps());
    store.setState({
      liveServicePhase: { 'svc-a': 'migrating' },
      liveServiceIssues: { 'svc-a': [{ kind: 'dirty-worktree', detail: '/repo/a', resolved: true }] },
    });

    store.getState().clearUpdate();

    expect(store.getState().liveServicePhase).toEqual({});
    expect(store.getState().liveServiceIssues).toEqual({});
  });

  it('a standalone restart reports restarting live and clears it when done', async () => {
    let releaseRestart: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseRestart = resolve;
    });
    const container: ContainerPort = {
      restart: vi.fn(async () => {
        await gate;
        return ok(undefined);
      }),
    };
    const store = createAppStore(fakeDeps({ container }));

    const run = store.getState().runServiceRestart('/repo/a');
    await waitForCondition(() => store.getState().liveServicePhase['svc-a'] === 'restarting');
    expect(store.getState().serviceRestartInFlight).toEqual({ '/repo/a': 'restart' });

    releaseRestart?.();
    await run;

    expect(store.getState().lastServiceOutcomes['svc-a']).toMatchObject({ outcome: 'updated' });
    expect(store.getState().liveServicePhase).toEqual({});
    expect(store.getState().serviceRestartInFlight).toEqual({});
  });

  it('a standalone restart opens with a fresh issue log for its service, keeping other services', async () => {
    const store = createAppStore(fakeDeps());
    store.setState({
      liveServiceIssues: {
        'svc-a': [{ kind: 'dirty-worktree', detail: '/repo/a', resolved: false }],
        'svc-b': [{ kind: 'migration-failed', detail: 'boom', resolved: false }],
      },
    });

    await store.getState().runServiceRestart('/repo/a');

    expect(store.getState().liveServiceIssues['svc-a']).toBeUndefined();
    expect(store.getState().liveServiceIssues['svc-b']).toEqual([
      { kind: 'migration-failed', detail: 'boom', resolved: false },
    ]);
  });
});
