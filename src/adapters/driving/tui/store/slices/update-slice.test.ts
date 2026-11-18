// tui/store/slices/update-slice: unit tests for the Update zone's run state — the slice
// calls the real core/scripts/group-update.ts use-case against fake ports (AD-2
// in-process), so these verify the wiring (status transitions, runInProgress guard,
// interrupted marking + edts refresh) rather than re-testing the use-case matrix.
import { describe, expect, it, vi } from 'vitest';
import { ok, err, type Result } from '../../../../../core/result.js';
import { toggleMergeSource } from '../../zones/update/update-config-panels.logic.js';
import type { ContainerPort } from '../../../../../core/ports/container.js';
import type { GitPort } from '../../../../../core/ports/git.js';
import type { ManifestPort } from '../../../../../core/ports/manifest.js';
import type { MigrationPort } from '../../../../../core/ports/migration.js';
import type { RestartPort } from '../../../../../core/ports/restart.js';
import type { RegistryPort } from '../../../../../core/ports/registry.js';
import type { StatePort } from '../../../../../core/ports/state.js';
import { createAppStore, type AppStoreDeps } from '../app-store.js';
import { parseUpdateServiceArg } from './update-slice.js';
import { MEMBERS, fakeDeps } from './update-slice.test-support.js';

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

// The `:update-service [name]` entry point — an arg resolves to a pre-scoped single-service
// config, no arg raises the zone-consumed selection request, and every trigger honors the
// running/restart guards with no screen opened.
describe('update slice: single-service command dialog', () => {
  describe('parseUpdateServiceArg', () => {
    it('returns null for a bare command with no argument', () => {
      expect(parseUpdateServiceArg('update-service')).toBeNull();
      expect(parseUpdateServiceArg('  update-service  ')).toBeNull();
    });

    it('returns the service name after the command', () => {
      expect(parseUpdateServiceArg('update-service svc-a')).toBe('svc-a');
    });

    it('joins a multi-word tail and trims it', () => {
      expect(parseUpdateServiceArg('update-service   my service  ')).toBe('my service');
    });
  });

  it('openUpdateServiceDialog with a known name pre-scopes a one-row config and runs nothing', async () => {
    const store = createAppStore(fakeDeps());

    await store.getState().openUpdateServiceDialog('update-service svc-a');

    expect(store.getState().updateConfig).toMatchObject({
      scope: 'edt',
      rows: [{ service: 'svc-a', repoPath: '/repo/a', sourceBranch: 'development', selected: true }],
    });
    expect(store.getState().updateServiceSelectRequest).toBe(false);
    expect(store.getState().updateServicePick).toBeNull();
    expect(store.getState().updateStatus).toBe('idle');
  });

  it('openUpdateServiceDialog matches the service name case-insensitively', async () => {
    const store = createAppStore(fakeDeps());

    await store.getState().openUpdateServiceDialog('update-service SVC-A');

    expect(store.getState().updateConfig).toMatchObject({
      scope: 'edt',
      rows: [{ service: 'svc-a', repoPath: '/repo/a', sourceBranch: 'development', selected: true }],
    });
    expect(store.getState().updateStatus).toBe('idle');
  });

  it('openUpdateServiceDialog with an unknown name fails service-not-found with no screen and nothing running', async () => {
    const deps = fakeDeps();
    const store = createAppStore(deps);

    await store.getState().openUpdateServiceDialog('update-service svc-nope');

    expect(store.getState().updateConfig).toBeNull();
    expect(store.getState().updateServiceSelectRequest).toBe(false);
    expect(store.getState().updateServicePick).toBeNull();
    expect(store.getState().updateStatus).toBe('error');
    expect(store.getState().updateErrorCode).toBe('service-not-found');
    expect(store.getState().updateError).toContain('svc-nope');
    expect(deps.git.fetch).not.toHaveBeenCalled();
    expect(deps.git.pull).not.toHaveBeenCalled();
  });

  it('openUpdateServiceDialog with no arg raises the selection request with no screen', async () => {
    const store = createAppStore(fakeDeps());

    await store.getState().openUpdateServiceDialog('update-service');

    expect(store.getState().updateConfig).toBeNull();
    expect(store.getState().updateServiceSelectRequest).toBe(true);
    expect(store.getState().updateServicePick).toBeNull();
    expect(store.getState().updateStatus).toBe('idle');
  });

  it('clearUpdateServiceSelectionRequest consumes the pending request', async () => {
    const store = createAppStore(fakeDeps());
    await store.getState().openUpdateServiceDialog('update-service');
    expect(store.getState().updateServiceSelectRequest).toBe(true);

    store.getState().clearUpdateServiceSelectionRequest();

    expect(store.getState().updateServiceSelectRequest).toBe(false);
  });

  it('openUpdateServiceDialog with an arg clears a previously raised selection request', async () => {
    const store = createAppStore(fakeDeps());
    await store.getState().openUpdateServiceDialog('update-service');
    expect(store.getState().updateServiceSelectRequest).toBe(true);

    await store.getState().openUpdateServiceDialog('update-service svc-a');

    expect(store.getState().updateServiceSelectRequest).toBe(false);
    expect(store.getState().updateConfig).toMatchObject({
      rows: [{ service: 'svc-a', repoPath: '/repo/a', selected: true }],
    });
  });

  it('openUpdateServiceDialog while running is rejected update-already-running with no screen and no request', async () => {
    const store = createAppStore(fakeDeps());
    store.setState({ updateStatus: 'running' });

    await store.getState().openUpdateServiceDialog('update-service svc-a');

    expect(store.getState().updateConfig).toBeNull();
    expect(store.getState().updateServiceSelectRequest).toBe(false);
    expect(store.getState().updateStatus).toBe('running');
    expect(store.getState().updateNotice?.code).toBe('update-already-running');
  });

  it('openUpdateServiceDialog on an unwired store degrades to store-not-wired', async () => {
    const store = createAppStore();

    await store.getState().openUpdateServiceDialog('update-service svc-a');

    expect(store.getState().updateConfig).toBeNull();
    expect(store.getState().updateServiceSelectRequest).toBe(false);
    expect(store.getState().updateStatus).toBe('error');
    expect(store.getState().updateErrorCode).toBe('store-not-wired');
  });

  it('openUpdateServicePick lists every managed repo and starts no run', async () => {
    const store = createAppStore(fakeDeps());

    await store.getState().openUpdateServicePick();

    expect(store.getState().updateServicePick).toEqual([
      { service: 'svc-a', repoPath: '/repo/a' },
      { service: 'svc-b', repoPath: '/repo/b' },
    ]);
    expect(store.getState().updateConfig).toBeNull();
    expect(store.getState().updateStatus).toBe('idle');
  });

  it('openUpdateServiceDialog while a standalone restart is in flight is rejected update-already-running', async () => {
    const store = createAppStore(fakeDeps());
    store.setState({ serviceRestartInFlight: { '/repo/a': 'restart' } });

    await store.getState().openUpdateServiceDialog('update-service svc-a');

    expect(store.getState().updateStatus).toBe('error');
    expect(store.getState().updateErrorCode).toBe('update-already-running');
    expect(store.getState().updateConfig).toBeNull();
    expect(store.getState().updateServiceSelectRequest).toBe(false);
  });

  it('openUpdateServicePick while a standalone restart is in flight is rejected update-already-running', async () => {
    const store = createAppStore(fakeDeps());
    store.setState({ serviceRestartInFlight: { '/repo/a': 'restart' } });

    await store.getState().openUpdateServicePick();

    expect(store.getState().updateStatus).toBe('error');
    expect(store.getState().updateErrorCode).toBe('update-already-running');
    expect(store.getState().updateServicePick).toBeNull();
  });

  it('openUpdateServicePick with an empty registry fails no-services-selected with no pick', async () => {
    const registry: RegistryPort = {
      list: vi.fn(async () => ok([])),
      add: vi.fn(async () => ok(undefined)),
      remove: vi.fn(async () => ok(undefined)),
      exists: vi.fn(async () => ok(true)),
      scan: vi.fn(async () => ok({ candidates: [], skipped: [] })),
      reset: vi.fn(async () => ok({ path: '/x', backupPath: null })),
    };
    const store = createAppStore(fakeDeps({ registry }));

    await store.getState().openUpdateServicePick();

    expect(store.getState().updateServicePick).toBeNull();
    expect(store.getState().updateStatus).toBe('error');
    expect(store.getState().updateErrorCode).toBe('no-services-selected');
  });

  it('openUpdateServicePick while running is rejected update-already-running with no pick', async () => {
    const store = createAppStore(fakeDeps());
    store.setState({ updateStatus: 'running' });

    await store.getState().openUpdateServicePick();

    expect(store.getState().updateServicePick).toBeNull();
    expect(store.getState().updateStatus).toBe('running');
    expect(store.getState().updateNotice?.code).toBe('update-already-running');
  });

  it('closeUpdateServicePick closes an open pick and is a no-op when closed', async () => {
    const store = createAppStore(fakeDeps());
    await store.getState().openUpdateServicePick();
    expect(store.getState().updateServicePick).not.toBeNull();

    store.getState().closeUpdateServicePick();

    expect(store.getState().updateServicePick).toBeNull();
    expect(() => store.getState().closeUpdateServicePick()).not.toThrow();
  });

  it('a pick open cancelled before its enumeration resolves never pops open', async () => {
    const deps = fakeDeps();
    let releaseList: ((value: Result<string[]>) => void) | undefined;
    const gate = new Promise<Result<string[]>>((resolve) => {
      releaseList = resolve;
    });
    deps.registry.list = vi.fn(async () => gate);
    const store = createAppStore(deps);

    const opening = store.getState().openUpdateServicePick();
    store.getState().closeUpdateServicePick();
    expect(store.getState().updateServicePick).toBeNull();
    releaseList!(ok(['/repo/a']));
    await opening;

    expect(store.getState().updateServicePick).toBeNull();
    expect(store.getState().updateStatus).toBe('idle');
  });

  it('clearUpdate drops the selection request and the open pick alongside the run state', async () => {
    const store = createAppStore(fakeDeps());
    await store.getState().openUpdateServiceDialog('update-service');
    await store.getState().openUpdateServicePick();

    store.getState().clearUpdate();

    expect(store.getState().updateServiceSelectRequest).toBe(false);
    expect(store.getState().updateServicePick).toBeNull();
  });
});

describe('update slice: merge source from another EDT', () => {
  function depsWithSibling() {
    const deps = fakeDeps();
    const base = deps.edtRegistry!.list as ReturnType<typeof vi.fn>;
    base.mockImplementation(async () =>
      ok([
        { ulid: 'edt-1', topic: 'demo', createdAt: '', status: 'active' as const, members: MEMBERS },
        {
          ulid: 'edt-2',
          topic: 'sibling',
          createdAt: '',
          status: 'inactive' as const,
          members: [{ service: 'svc-a', repoPath: '/repo/a', branch: 'feat/sib' }],
        },
      ]),
    );
    (deps.git!.listBranches as ReturnType<typeof vi.fn>).mockImplementation(async (path: string) =>
      ok(path === '/repo/a' ? ['development', 'feat/sib'] : ['development']),
    );
    return deps;
  }

  it('lists every EDT except the one being updated', async () => {
    const store = createAppStore(depsWithSibling());
    expect(await store.getState().listMergeSourceEdts()).toEqual([{ ulid: 'edt-2', topic: 'sibling' }]);
  });

  it('resolves rows from the chosen EDT and flags services it does not cover', async () => {
    const store = createAppStore(depsWithSibling());
    await store.getState().openUpdateConfig('edt');
    store.getState().setUpdateConfig(toggleMergeSource(store.getState().updateConfig!));

    await store.getState().chooseMergeSourceEdt('edt-2');

    const rows = store.getState().updateConfig!.rows;
    expect(rows[0]).toMatchObject({ sourceBranch: 'feat/sib', origin: 'edt' });
    expect(rows[1]).toMatchObject({ sourceBranch: '', sourceError: 'not-in-edt' });
  });

  it('refuses the active EDT as its own merge source and reports a vanished EDT', async () => {
    const store = createAppStore(depsWithSibling());
    await store.getState().openUpdateConfig('edt');

    await store.getState().chooseMergeSourceEdt('edt-1');
    expect(store.getState().updateConfig!.strategy.kind).toBe('shared');
    expect(store.getState().updateConfig!.error).toContain('own merge source');

    await store.getState().chooseMergeSourceEdt('gone');
    expect(store.getState().updateConfig!.error).toContain('no longer exists');
  });

  it('drops a resolution that lands after the developer went back to shared branches', async () => {
    const deps = depsWithSibling();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate;
    });
    (deps.git!.listBranches as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      await gate;
      return ok(['development', 'feat/sib']);
    });
    const store = createAppStore(deps);
    await store.getState().openUpdateConfig('edt');

    const pending = store.getState().chooseMergeSourceEdt('edt-2');
    await Promise.resolve();
    release();
    await pending;

    // The draft was still on shared branches when git answered: the late result is ignored.
    expect(store.getState().updateConfig!.strategy.kind).toBe('shared');
  });

  it('offers no EDT when the active EDT cannot be read', async () => {
    const deps = depsWithSibling();
    (deps.state!.readActiveEdt as ReturnType<typeof vi.fn>).mockImplementation(async () => err('state-read-error', 'boom'));
    const store = createAppStore(deps);
    expect(await store.getState().listMergeSourceEdts()).toEqual([]);
  });

  it('opens the two-panel screen without the merge source on a single-service config', async () => {
    const store = createAppStore(depsWithSibling());
    await store.getState().openUpdateConfig({ service: 'svc-a', repoPath: '/repo/a' });
    expect(store.getState().updateConfig!.layout).toBe('service-panels');
  });
});

describe('update slice: smart group update (shared-types first)', () => {
  // svc-a (/repo/a) is the single source, svc-b (/repo/b) its consumer.
  function smartDeps(options: { publishFails?: () => boolean } = {}) {
    const base = fakeDeps();
    const heads = new Map<string, number>();
    const manifest: ManifestPort = {
      load: vi.fn(async (repoPath: string) => {
        const name = repoPath.split('/').pop() ?? '';
        return ok({
          service: `svc-${name}`,
          container: `ctr-${name}`,
          migrationCommand: 'npm run migration:run',
          sharedBranch: 'development',
          modules: (name === 'a' ? { 'src-mod': {} } : { 'cons-mod': {} }) as Record<string, Record<string, unknown>>,
        });
      }),
    };
    const git = {
      ...base.git,
      // Every pull/merge moves HEAD: the merge reads as `advanced`.
      headRevision: vi.fn(async (repoPath: string) => {
        const next = (heads.get(repoPath) ?? 0) + 1;
        heads.set(repoPath, next);
        return ok(`h${String(next)}`);
      }),
      diffStat: vi.fn(async () => ok({ files: 1, insertions: 1, deletions: 0 })),
      // The commit cleans the consumer's worktree again.
      commit: vi.fn(async () => {
        heads.set('written', 0);
        return ok(undefined);
      }),
      listDirtyPaths: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/b' && (heads.get('written') ?? 0) > 0 ? ['package.json'] : [])),
    } as unknown as GitPort;
    const restart: RestartPort = {
      run: vi.fn(async (_repoPath: string, command: string) =>
        command === 'npm run v' && options.publishFails?.() === true ? err('restart-failed', 'npm ERR boom') : ok({ output: '' }),
      ),
    };
    const sharedTypes = {
      port: {
        readVersion: vi.fn(async () => ok('0.1.0')),
        readOwnVersion: vi.fn(async () => ok('0.1.5')),
        writeVersionLine: vi.fn(async () => {
          heads.set('written', 1);
          return ok(undefined);
        }),
        verifyPublished: vi.fn(async () => ok(true)),
      },
      sourceModuleId: 'src-mod',
      parseSourceConfig: () => ok({ publishCommand: 'npm run v', packageName: '@x/types' }),
      consumerModuleId: 'cons-mod',
      parseConsumerConfig: () => ok({ dependency: '@x/types', packageJsonPath: 'package.json' }),
    };
    const deps = fakeDeps({ manifest, git, restart, sharedTypes });
    return { deps, restart, git, sharedTypes };
  }

  const RUN = {
    selection: [
      { service: 'svc-a', repoPath: '/repo/a' },
      { service: 'svc-b', repoPath: '/repo/b' },
    ],
    sharedTypesSource: '/repo/a',
  };

  const order = (fn: unknown, predicate: (args: unknown[]) => boolean): number => {
    const mock = fn as { mock: { calls: unknown[][]; invocationCallOrder: number[] } };
    const index = mock.mock.calls.findIndex(predicate);
    return index === -1 ? -1 : (mock.mock.invocationCallOrder[index] ?? -1);
  };

  it('updates the source alone, publishes, propagates with a commit, then updates the others', async () => {
    const { deps, restart, git } = smartDeps();
    const store = createAppStore(deps);

    await store.getState().runGroupUpdate('edt', { ...RUN, sharedTypes: 'always' });

    expect(store.getState().updateStatus).toBe('done');
    expect(store.getState().updateResults.map((row) => row.outcome)).toEqual(['updated', 'updated']);
    const publish = order(restart.run, (args) => args[1] === 'npm run v');
    const sourceMigration = order(deps.migration!.run, (args) => args[0] === '/repo/a');
    const consumerMigration = order(deps.migration!.run, (args) => args[0] === '/repo/b');
    expect(sourceMigration).toBeGreaterThan(0);
    expect(publish).toBeGreaterThan(sourceMigration);
    expect(consumerMigration).toBeGreaterThan(publish);
    expect(git.commit).toHaveBeenCalledWith('/repo/b', expect.stringContaining('0.1.5'), ['package.json']);
    expect(store.getState().liveSharedTypesPhase).toEqual({});
  });

  it('does nothing extra when the setting is off', async () => {
    const { deps, restart } = smartDeps();
    const store = createAppStore(deps);

    await store.getState().runGroupUpdate('edt', { ...RUN, sharedTypes: 'off' });

    expect(restart.run).not.toHaveBeenCalledWith('/repo/a', 'npm run v');
    expect(deps.git.commit).not.toHaveBeenCalled();
  });

  it('a single-service update of the source still propagates to its consumers without updating them', async () => {
    const { deps, git } = smartDeps();
    const store = createAppStore(deps);

    await store.getState().runGroupUpdate('edt', { selection: [{ service: 'svc-a', repoPath: '/repo/a' }], sharedTypes: 'always', sharedTypesSource: '/repo/a' });

    expect(deps.migration!.run).not.toHaveBeenCalledWith('/repo/b', expect.anything());
    expect(git.commit).toHaveBeenCalledWith('/repo/b', expect.any(String), ['package.json']);
  });

  it('pauses on a phase failure and starts no other service until the developer chooses (retry then skip)', async () => {
    let failing = true;
    const { deps, restart } = smartDeps({ publishFails: () => failing });
    const store = createAppStore(deps);

    const run = store.getState().runGroupUpdate('edt', { ...RUN, sharedTypes: 'always' });
    await vi.waitFor(() => expect(store.getState().incidents).toHaveLength(1));
    expect(store.getState().incidents[0]?.blocker).toMatchObject({ kind: 'shared-types-phase-failed', service: 'svc-a' });
    expect(deps.migration!.run).not.toHaveBeenCalledWith('/repo/b', expect.anything());

    // Retry re-runs the phase; it fails again and pauses again (still blocked).
    store.getState().resolveUpdateIncident(store.getState().incidents[0]?.id ?? 'none', 'edited');
    await vi.waitFor(() => expect(restart.run).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(store.getState().incidents).toHaveLength(1));
    expect(store.getState().incidents[0]?.stillBlocked).toBeDefined();
    expect(deps.migration!.run).not.toHaveBeenCalledWith('/repo/b', expect.anything());

    // Skip continues without the phase: the consumer is updated, nothing was committed.
    failing = false;
    store.getState().resolveUpdateIncident(store.getState().incidents[0]?.id ?? 'none', 'cancel-repo');
    await run;
    expect(store.getState().updateResults.map((row) => `${row.service}:${row.outcome}`)).toEqual(['svc-a:updated', 'svc-b:updated']);
    expect(deps.git.commit).not.toHaveBeenCalled();
  });

  describe('conflict auto-resolution', () => {
    const OURS = '    "@x/types": "0.1.1",\n';
    const THEIRS = '    "@x/types": "0.1.0",\n';
    const conflictText = `{\n  "dependencies": {\n<<<<<<< HEAD\n${OURS}=======\n${THEIRS}>>>>>>> origin/development\n  }\n}\n`;

    // svc-b's merge conflicts on package.json (and the lock) once; the files live in memory.
    function conflictingDeps(options: { writeFails?: boolean; listFailsOnce?: boolean } = {}) {
      const smart = smartDeps();
      if (options.writeFails === true) {
        (smart.sharedTypes.port.writeVersionLine as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(err('package-json-unreadable', 'cannot write'));
      }
      let listFails = false;
      let merging = false;
      let unmerged: string[] = [];
      const files: Record<string, string> = {};
      const git = {
        ...smart.git,
        mergeBranch: vi.fn(async (repoPath: string) => {
          if (repoPath === '/repo/b' && !merging && unmerged.length === 0 && files['package.json'] === undefined) {
            merging = true;
            listFails = options.listFailsOnce === true;
            unmerged = ['package.json', 'package-lock.json'];
            files['package.json'] = conflictText;
            return err('merge-conflict', 'Automatic merge failed');
          }
          return ok(undefined);
        }),
        isMergeInProgress: vi.fn(async () => ok(merging)),
        listUnmergedPaths: vi.fn(async () => ok([...unmerged])),
        hasUnmergedPaths: vi.fn(async () => ok(unmerged.length > 0)),
        readWorktreeFile: vi.fn(async (_repo: string, path: string) => ok(files[path] ?? '<<<<<<< HEAD\n=======\n>>>>>>> x\n')),
        writeResolvedFile: vi.fn(async (_repo: string, path: string, content: string, opts: { stage: boolean }) => {
          files[path] = content;
          if (opts.stage) {
            unmerged = unmerged.filter((entry) => entry !== path);
          }
          return ok(undefined);
        }),
        checkoutSide: vi.fn(async () => ok(undefined)),
        stagePaths: vi.fn(async (_repo: string, paths: string[]) => {
          unmerged = unmerged.filter((entry) => !paths.includes(entry));
          return ok(undefined);
        }),
        finalizeMerge: vi.fn(async () => {
          merging = false;
          return ok(undefined);
        }),
      } as unknown as GitPort;
      const state = {
        ...smart.deps.state,
        readActiveEdt: vi.fn(async () => {
          if (listFails) {
            listFails = false;
            return err('state-read-error', 'state unreadable');
          }
          return smart.deps.state.readActiveEdt();
        }),
      } as AppStoreDeps['state'];
      const deps = fakeDeps({ manifest: smart.deps.manifest, git, restart: smart.restart, sharedTypes: smart.sharedTypes, state });
      return { deps, git, restart: smart.restart, files };
    }

    it('keeps the version published in the run, regenerates the lock and finalizes without a menu', async () => {
      const { deps, git, restart, files } = conflictingDeps();
      const store = createAppStore(deps);

      await store.getState().runGroupUpdate('edt', { ...RUN, sharedTypes: 'always' });

      expect(store.getState().incidents).toEqual([]);
      expect(files['package.json']).toContain('"@x/types": "0.1.5"');
      expect(files['package.json']).not.toContain('<<<<<<<');
      expect(restart.run).toHaveBeenCalledWith('/repo/b', 'npm i');
      expect(git.finalizeMerge).toHaveBeenCalledWith('/repo/b');
      const consumer = store.getState().updateResults.find((row) => row.service === 'svc-b');
      expect(consumer).toMatchObject({ outcome: 'updated', run: { conflict: 'auto-resolved' } });
    });

    it('keeps the published version when the phase failed after the publish and was skipped', async () => {
      const { deps, files } = conflictingDeps({ writeFails: true });
      const store = createAppStore(deps);

      const run = store.getState().runGroupUpdate('edt', { ...RUN, sharedTypes: 'always' });
      await vi.waitFor(() => expect(store.getState().incidents).toHaveLength(1));
      expect(store.getState().incidents[0]?.blocker).toMatchObject({ kind: 'shared-types-phase-failed' });
      store.getState().resolveUpdateIncident(store.getState().incidents[0]?.id ?? 'none', 'cancel-repo');
      await run;

      expect(files['package.json']).toContain('"@x/types": "0.1.5"');
      expect(store.getState().updateResults.find((row) => row.service === 'svc-b')?.run?.conflict).toBe('auto-resolved');
    });

    it('stores the resolver issue note in the issue detail and retries a failed consumer listing after edited', async () => {
      const { deps, files } = conflictingDeps({ listFailsOnce: true });
      const store = createAppStore(deps);

      const run = store.getState().runGroupUpdate('edt', { ...RUN, sharedTypes: 'off' });
      await vi.waitFor(() => expect(store.getState().incidents).toHaveLength(1));
      const blocker = store.getState().incidents[0]?.blocker;
      expect(blocker).toMatchObject({ kind: 'merge-conflict', service: 'svc-b', autoResolveNote: expect.stringContaining('Cannot list the consumers') });
      expect(store.getState().liveServiceIssues['svc-b']?.[0]?.detail).toContain('Cannot list the consumers');
      store.getState().resolveUpdateIncident(store.getState().incidents[0]?.id ?? 'none', 'edited');
      await run;

      // The failed listing was not cached: the pass after `edited` resolved the line.
      expect(files['package.json']).toContain('"@x/types": "0.1.1"');
      expect(store.getState().updateResults.find((row) => row.service === 'svc-b')).toMatchObject({ outcome: 'updated', run: { conflict: 'partial' } });
    });

    it('keeps the consumer own value when nothing was published in the run', async () => {
      const { deps, files } = conflictingDeps();
      const store = createAppStore(deps);

      await store.getState().runGroupUpdate('edt', { ...RUN, sharedTypes: 'off' });

      expect(files['package.json']).toContain('"@x/types": "0.1.1"');
      expect(store.getState().updateResults.find((row) => row.service === 'svc-b')?.run?.conflict).toBe('auto-resolved');
    });
  });

  it('abort cancels the remaining services', async () => {
    const { deps } = smartDeps({ publishFails: () => true });
    const store = createAppStore(deps);

    const run = store.getState().runGroupUpdate('edt', { ...RUN, sharedTypes: 'always' });
    await vi.waitFor(() => expect(store.getState().incidents).toHaveLength(1));
    store.getState().resolveUpdateIncident(store.getState().incidents[0]?.id ?? 'none', 'cancel-run');
    await run;

    expect(store.getState().updateResults.map((row) => `${row.service}:${row.outcome}`)).toEqual(['svc-a:updated', 'svc-b:skipped']);
    expect(deps.migration!.run).not.toHaveBeenCalledWith('/repo/b', expect.anything());
  });

  it('the config draft carries the shared-types row only for a single source among the rows', async () => {
    const { deps } = smartDeps();
    const store = createAppStore(deps);
    await store.getState().openUpdateConfig('edt');
    expect(store.getState().updateConfig?.sharedTypesSource).toBe('/repo/a');
    expect(store.getState().updateConfig?.sharedTypes).toBe('off');
    store.getState().closeUpdateConfig();

    await store.getState().openUpdateConfig({ service: 'svc-b', repoPath: '/repo/b' });
    expect(store.getState().updateConfig?.sharedTypesSource).toBeNull();

    const plain = createAppStore(fakeDeps());
    await plain.getState().openUpdateConfig('edt');
    expect(plain.getState().updateConfig?.sharedTypesSource).toBeNull();
  });

  it('the real confirm path forwards the mode and source: publish runs and the consumer is committed', async () => {
    const { deps, restart, git } = smartDeps();
    const store = createAppStore(deps);
    await store.getState().openUpdateConfig('edt');
    store.getState().setUpdateConfig({ ...store.getState().updateConfig!, sharedTypes: 'always' });
    await store.getState().confirmUpdateConfig();

    expect(store.getState().updateStatus).toBe('done');
    expect(restart.run).toHaveBeenCalledWith('/repo/a', 'npm run v');
    expect(git.commit).toHaveBeenCalledWith('/repo/b', expect.stringContaining('0.1.5'), ['package.json']);
  });

  it('confirming passes the mode through and a deselected source runs nothing extra', async () => {
    const { deps, restart } = smartDeps();
    const store = createAppStore(deps);
    await store.getState().openUpdateConfig('edt');
    const draft = store.getState().updateConfig!;
    store.getState().setUpdateConfig({ ...draft, sharedTypes: 'always', rows: draft.rows.map((row) => (row.repoPath === '/repo/a' ? { ...row, selected: false } : row)) });
    await store.getState().confirmUpdateConfig();
    expect(restart.run).not.toHaveBeenCalledWith('/repo/a', 'npm run v');
  });
});
