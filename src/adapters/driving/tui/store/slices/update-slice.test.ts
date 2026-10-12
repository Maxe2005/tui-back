// tui/store/slices/update-slice: unit tests for the Update zone's run state — the slice
// calls the real core/scripts/group-update.ts use-case against fake ports (AD-2
// in-process), so these verify the wiring (status transitions, runInProgress guard,
// interrupted marking + edts refresh) rather than re-testing the use-case matrix.
import { describe, expect, it, vi } from 'vitest';
import { ok, err, type Result } from '../../../../../core/result.js';
import { toggleMergeSource } from '../../zones/update/update-config-panels.logic.js';
import type { ContainerPort } from '../../../../../core/ports/container.js';
import type { DockerPort } from '../../../../../core/ports/docker.js';
import type { EdtRegistryPort } from '../../../../../core/ports/edt-registry.js';
import type { GitPort } from '../../../../../core/ports/git.js';
import type { LockPort } from '../../../../../core/ports/lock.js';
import type { ManifestPort } from '../../../../../core/ports/manifest.js';
import type { MigrationPort } from '../../../../../core/ports/migration.js';
import type { RestartPort } from '../../../../../core/ports/restart.js';
import type { RegistryPort } from '../../../../../core/ports/registry.js';
import type { SettingsPort } from '../../../../../core/ports/settings.js';
import type { StatePort } from '../../../../../core/ports/state.js';
import { DEFAULT_SETTINGS } from '../../../../../core/ports/settings.js';
import { createAppStore, type AppStoreDeps } from '../app-store.js';
import { UPDATE_HEALTH_POLL_INTERVAL_MS, parseUpdateServiceArg } from './update-slice.js';

const MEMBERS = [
  { service: 'svc-a', repoPath: '/repo/a', branch: 'feat/a' },
  { service: 'svc-b', repoPath: '/repo/b', branch: 'feat/b' },
];

function fakeDeps(overrides: Partial<AppStoreDeps> = {}): AppStoreDeps {
  const registry: RegistryPort = {
    list: vi.fn(async () => ok(['/repo/a', '/repo/b'])),
    add: vi.fn(async () => ok(undefined)),
    exists: vi.fn(async () => ok(true)),
    scan: vi.fn(async () => ok({ candidates: [], skipped: [] })),
    reset: vi.fn(async () => ok({ path: '/x', backupPath: null })),
    remove: vi.fn(async () => ok(undefined)),
  };
  const manifest: ManifestPort = {
    load: vi.fn(async (repoPath: string) =>
      ok({
        service: `svc-${repoPath.split('/').pop()}`,
        container: `ctr-${repoPath.split('/').pop()}`,
        migrationCommand: 'npm run migration:run',
        sharedBranch: 'development',
        modules: {},
      }),
    ),
  };
  const git: GitPort = {
    assertAllowedBranch: vi.fn(async () => ok(undefined)),
    createBranch: vi.fn(async () => ok(undefined)),
    deleteBranch: vi.fn(async () => ok(undefined)),
    currentBranch: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/b' ? 'feat/b' : 'feat/a')),
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
  };
  const edtRegistry: EdtRegistryPort = {
    add: vi.fn(async () => ok(undefined)),
    list: vi.fn(async () =>
      ok([
        {
          ulid: 'edt-1',
          topic: 'demo',
          createdAt: '2026-09-17T00:00:00.000Z',
          status: 'active' as const,
          members: MEMBERS,
        },
      ]),
    ),
    setStatus: vi.fn(async () => ok(undefined)),
    update: vi.fn(async () => ok(undefined)),
    remove: vi.fn(async () => ok(undefined)),
  };
  const state: StatePort = {
    readActiveEdt: vi.fn(async () => ok('edt-1')),
    writeActiveEdt: vi.fn(async () => ok(undefined)),
    readSplitterRatios: vi.fn(async () => ok(null)),
    writeSplitterRatios: vi.fn(async () => ok(undefined)),
    readFilterHistory: vi.fn(async () => ok(null)),
    writeFilterHistory: vi.fn(async () => ok(undefined)),
    readCommandHistory: vi.fn(async () => ok(null)),
    writeCommandHistory: vi.fn(async () => ok(undefined)),
  };
  const lock: LockPort = {
    acquire: vi.fn(async () => ok({ release: vi.fn(async () => ok(undefined)) })),
    peek: vi.fn(async () => ok({ locked: false })),
  };
  const container: ContainerPort = {
    restart: vi.fn(async () => ok(undefined)),
  };
  const migration: MigrationPort = {
    run: vi.fn(async () => ok({ output: '' })),
  };
  const restart: RestartPort = {
    run: vi.fn(async () => ok({ output: '' })),
  };
  const settings: SettingsPort = {
    load: vi.fn(async () => ok({ settings: DEFAULT_SETTINGS, warning: null })),
    save: vi.fn(async () => ok(undefined)),
  };
  const docker: DockerPort = {
    streamLogs: vi.fn(() => () => {}),
    fetchLogsBefore: vi.fn(async () => ok([])),
    getContainerHealth: vi.fn(async () => ok('up' as const)),
    restartContainer: vi.fn(async () => ok(undefined)),
  };
  return {
    registry,
    manifest,
    manifestCarry: { capture: async () => ({ ok: true, data: { kind: 'absent' } }), restore: async () => ({ ok: true, data: undefined }) },
    git,
    container,
    migration,
    restart,
    docker,
    edtRegistry,
    state,
    lock,
    registryResourceKey: '/config/registry.yaml',
    edtRegistryResourceKey: '/tmp/edts.yaml',
    edtsBaseDir: '/tmp/edts',
    settings,
    ...overrides,
  };
}

describe('update slice', () => {
  it('starts idle with no results, note, error, or raised blocker', () => {
    const store = createAppStore(fakeDeps());

    expect(store.getState().updateStatus).toBe('idle');
    expect(store.getState().updateResults).toEqual([]);
    expect(store.getState().updateNote).toBeNull();
    expect(store.getState().updateError).toBeNull();
    expect(store.getState().updateUlid).toBeNull();
    expect(store.getState().updateBlocker).toBeNull();
  });

  it('runGroupUpdate runs the core use-case in-process and lands done with per-service rows', async () => {
    const store = createAppStore(fakeDeps());

    await store.getState().runGroupUpdate();

    expect(store.getState().updateStatus).toBe('done');
    expect(store.getState().updateTopic).toBe('demo');
    expect(store.getState().updateUlid).toBe('edt-1');
    expect(store.getState().updateResults).toEqual([
      { service: 'svc-a', outcome: 'updated', run: expect.anything() },
      { service: 'svc-b', outcome: 'updated', run: expect.anything() },
    ]);
    expect(store.getState().runInProgress).toBe(false);
  });

  // Exercises the real `lastServiceOutcomes: mergeLastServiceOutcomes(...)` wiring through the
  // actual runGroupUpdate flow — pure merge unit tests and hand-seeded zone render tests don't
  // catch a bug in that wiring itself (e.g. the merge call dropped, or given wrong arguments).
  it('runGroupUpdate populates lastServiceOutcomes with the run\'s own per-service outcomes', async () => {
    const store = createAppStore(fakeDeps());
    expect(store.getState().lastServiceOutcomes).toEqual({});

    await store.getState().runGroupUpdate();

    expect(store.getState().lastServiceOutcomes).toEqual({
      'svc-a': { service: 'svc-a', outcome: 'updated', run: expect.anything() },
      'svc-b': { service: 'svc-b', outcome: 'updated', run: expect.anything() },
    });
  });

  it('runGroupUpdate merges lastServiceOutcomes across runs — a service outside a later scoped run\'s scope keeps its earlier outcome', async () => {
    // The active EDT has only svc-a as a member — the second (default-scoped, 'edt') run
    // below targets svc-a alone, never svc-b.
    const edtRegistry: EdtRegistryPort = {
      add: vi.fn(async () => ok(undefined)),
      list: vi.fn(async () =>
        ok([
          {
            ulid: 'edt-1',
            topic: 'demo',
            createdAt: '2026-09-17T00:00:00.000Z',
            status: 'active' as const,
            members: [MEMBERS[0]!],
          },
        ]),
      ),
      setStatus: vi.fn(async () => ok(undefined)),
      update: vi.fn(async () => ok(undefined)),
      remove: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ edtRegistry }));

    // First run: scope 'all' targets every registered repo (svc-a and svc-b both succeed) —
    // 'all' never reads edtRegistry, so this run is unaffected by the EDT override above.
    await store.getState().runGroupUpdate('all');
    expect(store.getState().lastServiceOutcomes).toEqual({
      'svc-a': { service: 'svc-a', outcome: 'updated', run: expect.anything() },
      'svc-b': { service: 'svc-b', outcome: 'updated', run: expect.anything() },
    });

    // Second run: the default EDT-scoped run, targeting only svc-a (the sole member above).
    await store.getState().runGroupUpdate();
    expect(store.getState().updateResults).toEqual([{ service: 'svc-a', outcome: 'updated', run: expect.anything() }]);

    // svc-b sat outside this second run's scope entirely — its earlier outcome must survive
    // the merge, never be dropped by a wholesale replace.
    expect(store.getState().lastServiceOutcomes).toEqual({
      'svc-a': { service: 'svc-a', outcome: 'updated', run: expect.anything() },
      'svc-b': { service: 'svc-b', outcome: 'updated', run: expect.anything() },
    });
  });

  it('a run ending off the Update zone badges its tab, cleared on visiting it', async () => {
    const store = createAppStore(fakeDeps());
    store.getState().setActiveZone('dashboard');

    await store.getState().runGroupUpdate();

    expect(store.getState().zoneEvents.update).toBe(1);
    store.getState().setActiveZone('update');
    expect(store.getState().zoneEvents.update).toBe(0);

    await store.getState().runGroupUpdate();
    expect(store.getState().zoneEvents.update).toBe(0);
  });

  it('runGroupUpdate threads the scope: runGroupUpdate(all) lands done on the all-repos outcome', async () => {
    const store = createAppStore(fakeDeps());

    await store.getState().runGroupUpdate('all');

    expect(store.getState().updateStatus).toBe('done');
    expect(store.getState().updateTopic).toBe('all-repos');
    expect(store.getState().updateUlid).toBe('all');
    expect(store.getState().updateScope).toBe('all');
    expect(store.getState().updateResults).toEqual([
      { service: 'svc-a', outcome: 'updated', run: expect.anything() },
      { service: 'svc-b', outcome: 'updated', run: expect.anything() },
    ]);
    expect(store.getState().runInProgress).toBe(false);
  });

  it('runGroupUpdate surfaces a top-level use-case failure as error with its code', async () => {
    const state: StatePort = {
      readActiveEdt: vi.fn(async () => ok(null)),
      writeActiveEdt: vi.fn(async () => ok(undefined)),
      readSplitterRatios: vi.fn(async () => ok(null)),
      writeSplitterRatios: vi.fn(async () => ok(undefined)),
      readFilterHistory: vi.fn(async () => ok(null)),
      writeFilterHistory: vi.fn(async () => ok(undefined)),
      readCommandHistory: vi.fn(async () => ok(null)),
      writeCommandHistory: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ state }));

    await store.getState().runGroupUpdate();

    expect(store.getState().updateStatus).toBe('error');
    expect(store.getState().updateErrorCode).toBe('no-active-edt');
    expect(store.getState().updateError).toContain('No active EDT');
    expect(store.getState().runInProgress).toBe(false);
  });

  it('runGroupUpdate degrades to an explicit error, never a throw, when the store is unwired', async () => {
    const store = createAppStore();

    await store.getState().runGroupUpdate();

    expect(store.getState().updateStatus).toBe('error');
    expect(store.getState().updateErrorCode).toBe('store-not-wired');
  });

  it('runGroupUpdate degrades to an explicit error when the container port is missing', async () => {
    const deps = fakeDeps();
    const { container: _dropped, ...withoutContainer } = deps;
    const store = createAppStore(withoutContainer);

    await store.getState().runGroupUpdate();

    expect(store.getState().updateStatus).toBe('error');
    expect(store.getState().updateErrorCode).toBe('store-not-wired');
  });

  it('runGroupUpdate degrades to an explicit error when the migration port is missing', async () => {
    const deps = fakeDeps();
    const { migration: _dropped, ...withoutMigration } = deps;
    const store = createAppStore(withoutMigration);

    await store.getState().runGroupUpdate();

    expect(store.getState().updateStatus).toBe('error');
    expect(store.getState().updateErrorCode).toBe('store-not-wired');
  });

  it('runGroupUpdate degrades to an explicit error when the restart port is missing', async () => {
    const deps = fakeDeps();
    const { restart: _dropped, ...withoutRestart } = deps;
    const store = createAppStore(withoutRestart);

    await store.getState().runGroupUpdate();

    expect(store.getState().updateStatus).toBe('error');
    expect(store.getState().updateErrorCode).toBe('store-not-wired');
  });

  it('a second call while running reports update-already-running, and the in-flight run still lands done', async () => {
    let resolveFetch: (() => void) | undefined;
    const fetchGate = new Promise<void>((resolve) => {
      resolveFetch = resolve;
    });
    const git: GitPort = {
      ...(fakeDeps().git as GitPort),
      fetch: vi.fn(async () => {
        await fetchGate;
        return ok(undefined);
      }),
    };
    const store = createAppStore(fakeDeps({ git }));

    const first = store.getState().runGroupUpdate();
    expect(store.getState().updateStatus).toBe('running');
    expect(store.getState().runInProgress).toBe(true);

    // Double-Enter feedback instead of silence: the second call is rejected with the
    // run-in-flight code while the first run continues underneath.
    await store.getState().runGroupUpdate();
    expect(store.getState().updateStatus).toBe('running');
    expect(store.getState().updateNotice?.code).toBe('update-already-running');

    resolveFetch?.();
    await first;
    expect(store.getState().updateStatus).toBe('done');
    expect(store.getState().runInProgress).toBe(false);
    // Exactly one run processed both members — the second call never started another.
    expect(git.fetch).toHaveBeenCalledTimes(2);
  });

  it('runGroupUpdate surfaces a throwing use-case as internal-error and always clears runInProgress', async () => {
    const manifest: ManifestPort = {
      load: vi.fn(async () => {
        throw new Error('boom');
      }),
    };
    const store = createAppStore(fakeDeps({ manifest }));

    await store.getState().runGroupUpdate();

    expect(store.getState().updateStatus).toBe('error');
    expect(store.getState().updateErrorCode).toBe('internal-error');
    expect(store.getState().updateError).toContain('boom');
    expect(store.getState().runInProgress).toBe(false);
  });

  it('markUpdateInterrupted marks the run EDT interrupted and refreshes edts back to idle', async () => {
    const deps = fakeDeps();
    const store = createAppStore(deps);

    await store.getState().runGroupUpdate();
    // The quit-confirm races real completion in production too — the mark path only runs
    // while the status is still `running`.
    store.setState({ updateStatus: 'running' });
    await store.getState().markUpdateInterrupted();

    expect(deps.edtRegistry.setStatus).toHaveBeenCalledWith('edt-1', 'interrupted');
    expect(store.getState().updateStatus).toBe('idle');
    expect(store.getState().runInProgress).toBe(false);
    expect(store.getState().edts).toHaveLength(1);
  });

  it('markUpdateInterrupted after an all-repos run resets to idle without touching the EDT registry', async () => {
    const deps = fakeDeps();
    const store = createAppStore(deps);

    await store.getState().runGroupUpdate('all');
    expect(store.getState().updateScope).toBe('all');
    // The quit-confirm races real completion — the bypass only runs while still `running`.
    store.setState({ updateStatus: 'running' });
    await store.getState().markUpdateInterrupted();

    expect(deps.edtRegistry.setStatus).not.toHaveBeenCalled();
    expect(store.getState().updateStatus).toBe('idle');
    expect(store.getState().runInProgress).toBe(false);
  });

  it('markUpdateInterrupted never marks a finished run — a quit-confirm racing completion leaves the healthy EDT alone', async () => {
    const deps = fakeDeps();
    const store = createAppStore(deps);

    await store.getState().runGroupUpdate();
    expect(store.getState().updateStatus).toBe('done');
    await store.getState().markUpdateInterrupted();

    expect(deps.edtRegistry.setStatus).not.toHaveBeenCalled();
    expect(store.getState().updateStatus).toBe('done');
    expect(store.getState().updateResults).toHaveLength(2);
  });

  it('markUpdateInterrupted falls back to the active pointer when a run is in flight but targeted no EDT yet', async () => {
    const deps = fakeDeps();
    const store = createAppStore(deps);
    store.setState({ activeEdt: 'edt-1', updateStatus: 'running' });

    await store.getState().markUpdateInterrupted();

    expect(deps.edtRegistry.setStatus).toHaveBeenCalledWith('edt-1', 'interrupted');
  });

  it('markUpdateInterrupted is a no-op (never a throw) when unwired and pointerless', async () => {
    const store = createAppStore();

    await store.getState().markUpdateInterrupted();

    expect(store.getState().updateStatus).toBe('idle');
  });

  it('markUpdateInterrupted surfaces a setStatus failure as error state instead of silently returning to idle', async () => {
    const edtRegistry: EdtRegistryPort = {
      add: vi.fn(async () => ok(undefined)),
      list: vi.fn(async () => ok([])),
      setStatus: vi.fn(async () => err('edt-not-found', 'gone')),
      update: vi.fn(async () => ok(undefined)),
      remove: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ edtRegistry }));
    store.setState({ activeEdt: 'edt-gone', updateStatus: 'running' });

    await store.getState().markUpdateInterrupted();

    expect(store.getState().updateStatus).toBe('error');
    expect(store.getState().updateErrorCode).toBe('edt-not-found');
    expect(store.getState().updateError).toContain('gone');
    expect(store.getState().runInProgress).toBe(false);
  });

  it('markUpdateInterrupted surfaces a throwing setStatus as internal-error', async () => {
    const edtRegistry: EdtRegistryPort = {
      add: vi.fn(async () => ok(undefined)),
      list: vi.fn(async () => ok([])),
      setStatus: vi.fn(async () => {
        throw new Error('disk on fire');
      }),
      update: vi.fn(async () => ok(undefined)),
      remove: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ edtRegistry }));
    store.setState({ activeEdt: 'edt-1', updateStatus: 'running' });

    await store.getState().markUpdateInterrupted();

    expect(store.getState().updateStatus).toBe('error');
    expect(store.getState().updateErrorCode).toBe('internal-error');
    expect(store.getState().runInProgress).toBe(false);
  });

  it('clearUpdate resets every run field to the idle baseline', async () => {
    const store = createAppStore(fakeDeps());

    await store.getState().runGroupUpdate();
    expect(store.getState().updateStatus).toBe('done');
    store.setState({ updateBlocker: { service: 'svc-a', repoPath: '/repo/a', kind: 'dirty-worktree' } });
    store.getState().clearUpdate();

    expect(store.getState().updateStatus).toBe('idle');
    expect(store.getState().updateResults).toEqual([]);
    expect(store.getState().updateNote).toBeNull();
    expect(store.getState().updateTopic).toBeNull();
    expect(store.getState().updateError).toBeNull();
    expect(store.getState().updateUlid).toBeNull();
    expect(store.getState().updateScope).toBeNull();
    expect(store.getState().updateBlocker).toBeNull();
  });

  it('runGroupUpdate raises the blocker on a dirty repo and resumes on resolveUpdateBlocker', async () => {
    const git: GitPort = {
      ...(fakeDeps().git as GitPort),
      listDirtyPaths: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/a' ? ['wip.txt'] : [])),
    };
    const store = createAppStore(fakeDeps({ git }));

    const run = store.getState().runGroupUpdate();
    await vi.waitFor(() => {
      expect(store.getState().updateBlocker).toEqual({
        service: 'svc-a',
        repoPath: '/repo/a',
        kind: 'dirty-worktree',
      });
    });
    expect(store.getState().updateStatus).toBe('running');

    store.getState().resolveUpdateBlocker('cancel-repo');
    await run;

    expect(store.getState().updateStatus).toBe('done');
    expect(store.getState().updateBlocker).toBeNull();
    expect(store.getState().updateResults).toEqual([
      { service: 'svc-a', outcome: 'skipped', detail: expect.objectContaining({ code: 'dirty-worktree' }) },
      { service: 'svc-b', outcome: 'updated', run: expect.anything() },
    ]);
    expect(store.getState().runInProgress).toBe(false);
  });

  it('resolveUpdateBlocker with no raised blocker is a no-op, never a throw', () => {
    const store = createAppStore(fakeDeps());

    store.getState().resolveUpdateBlocker('cancel-repo');

    expect(store.getState().updateBlocker).toBeNull();
    expect(store.getState().updateStatus).toBe('idle');
  });

  it('a throwing git write under a raised blocker settles as internal-error with the menu cleared', async () => {
    const git: GitPort = {
      ...(fakeDeps().git as GitPort),
      listDirtyPaths: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/a' ? ['wip.txt'] : [])),
      stashSave: vi.fn(async () => {
        throw new Error('stash exploded');
      }),
    };
    const store = createAppStore(fakeDeps({ git }));

    const run = store.getState().runGroupUpdate();
    await vi.waitFor(() => {
      expect(store.getState().updateBlocker).not.toBeNull();
    });
    store.getState().resolveUpdateBlocker('stash');
    await run;

    expect(store.getState().updateStatus).toBe('error');
    expect(store.getState().updateErrorCode).toBe('internal-error');
    expect(store.getState().updateError).toContain('stash exploded');
    expect(store.getState().updateBlocker).toBeNull();
    expect(store.getState().runInProgress).toBe(false);
  });
});

// The Update zone's own service-list health poll, tested against fake ports like the logs
// slice's poll, but through startUpdateHealthPolling/stopUpdateHealthPolling/
// updateServiceHealth — this poll is owned by the Update zone and shares nothing with the
// Logs zone's.
describe('update slice: service health polling', () => {
  // A real setTimeout macrotask flush, not fake timers — lets every pending microtask from
  // startUpdateHealthPolling's fire-and-forget pollServiceHealth chain (manifest.load then
  // getContainerHealth, each a resolved-async mock) settle before assertions run.
  async function flushPolls(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  function fakeDocker(getContainerHealth: DockerPort['getContainerHealth']): DockerPort {
    return {
      streamLogs: vi.fn(() => () => {}),
      fetchLogsBefore: vi.fn(async () => ok([])),
      getContainerHealth,
      restartContainer: vi.fn(async () => ok(undefined)),
    };
  }

  it('startUpdateHealthPolling polls every given repoPath\'s container health and reflects it on updateServiceHealth', async () => {
    const getContainerHealth = vi.fn(async () => ok('up' as const));
    const store = createAppStore(fakeDeps({ docker: fakeDocker(getContainerHealth) }));

    store.getState().startUpdateHealthPolling(['/repo/a']);
    await flushPolls();

    expect(getContainerHealth).toHaveBeenCalledWith('ctr-a');
    expect(store.getState().updateServiceHealth['/repo/a']).toBe('up');
  });

  it('polls every given repoPath independently, keyed by its own repoPath', async () => {
    const getContainerHealth = vi.fn(async (container: string) => ok(container === 'ctr-a' ? ('up' as const) : ('down' as const)));
    const store = createAppStore(fakeDeps({ docker: fakeDocker(getContainerHealth) }));

    store.getState().startUpdateHealthPolling(['/repo/a', '/repo/b']);
    await flushPolls();

    expect(store.getState().updateServiceHealth['/repo/a']).toBe('up');
    expect(store.getState().updateServiceHealth['/repo/b']).toBe('down');
  });

  it('manifest.load failing during a health poll leaves updateServiceHealth untouched (silent no-op)', async () => {
    vi.useFakeTimers();
    try {
      const manifestLoad = vi.fn(async (repoPath: string) =>
        ok({
          service: `svc-${repoPath.split('/').pop()}`,
          container: `ctr-${repoPath.split('/').pop()}`,
          migrationCommand: 'npm run migration:run',
          sharedBranch: 'development',
          modules: {},
        }),
      );
      const manifest: ManifestPort = { load: manifestLoad };
      const getContainerHealth = vi.fn(async () => ok('up' as const));
      const store = createAppStore(fakeDeps({ docker: fakeDocker(getContainerHealth), manifest }));

      store.getState().startUpdateHealthPolling(['/repo/a']);
      await vi.advanceTimersByTimeAsync(0);
      // First drive the badge to a known non-default state — asserting the default `'down'`
      // below would also pass vacuously if the failing poll simply never ran.
      expect(store.getState().updateServiceHealth['/repo/a']).toBe('up');

      manifestLoad.mockImplementation(async () => err('manifest-not-found', 'gone'));
      const callsBefore = getContainerHealth.mock.calls.length;
      await vi.advanceTimersByTimeAsync(UPDATE_HEALTH_POLL_INTERVAL_MS);
      await vi.advanceTimersByTimeAsync(0);

      // The poll bailed before ever reaching the docker adapter — no inspect, no crash, and
      // the last-known value is kept (never cleared/reset).
      expect(getContainerHealth.mock.calls.length).toBe(callsBefore);
      expect(store.getState().updateServiceHealth['/repo/a']).toBe('up');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a getServiceHealth/getContainerHealth failure leaves updateServiceHealth untouched (silent no-op, same as manifest-load failure)', async () => {
    vi.useFakeTimers();
    try {
      const getContainerHealth = vi.fn(async () => ok('up' as const));
      const store = createAppStore(fakeDeps({ docker: fakeDocker(getContainerHealth) }));

      store.getState().startUpdateHealthPolling(['/repo/a']);
      await vi.advanceTimersByTimeAsync(0);
      expect(store.getState().updateServiceHealth['/repo/a']).toBe('up');

      getContainerHealth.mockImplementation(async () => err('docker-unavailable', 'daemon down'));
      const callsBefore = getContainerHealth.mock.calls.length;
      await vi.advanceTimersByTimeAsync(UPDATE_HEALTH_POLL_INTERVAL_MS);
      await vi.advanceTimersByTimeAsync(0);

      // The failing poll really ran (guards a vacuous pass where the assertion below would
      // hold simply because no second poll happened yet) and the value kept last-known.
      expect(getContainerHealth.mock.calls.length).toBeGreaterThan(callsBefore);
      expect(store.getState().updateServiceHealth['/repo/a']).toBe('up');
    } finally {
      vi.useRealTimers();
    }
  });

  it('polls repeat on the configured interval and stop entirely once stopUpdateHealthPolling is called', async () => {
    vi.useFakeTimers();
    try {
      const getContainerHealth = vi.fn(async () => ok('up' as const));
      const store = createAppStore(fakeDeps({ docker: fakeDocker(getContainerHealth) }));

      store.getState().startUpdateHealthPolling(['/repo/a']);
      await vi.advanceTimersByTimeAsync(0);
      const afterStart = getContainerHealth.mock.calls.length;
      expect(afterStart).toBeGreaterThanOrEqual(1);

      await vi.advanceTimersByTimeAsync(UPDATE_HEALTH_POLL_INTERVAL_MS);
      expect(getContainerHealth.mock.calls.length).toBeGreaterThan(afterStart);

      const afterInterval = getContainerHealth.mock.calls.length;
      store.getState().stopUpdateHealthPolling();
      await vi.advanceTimersByTimeAsync(UPDATE_HEALTH_POLL_INTERVAL_MS * 4);

      // No further polls fire once stopped — the timer never outlives the zone.
      expect(getContainerHealth.mock.calls.length).toBe(afterInterval);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a manifest without container records no-container and never polls docker for the service', async () => {
    const manifest: ManifestPort = {
      load: vi.fn(async (repoPath: string) =>
        ok({
          service: `svc-${repoPath.split('/').pop()}`,
          sharedBranch: 'development',
          modules: {},
        }),
      ),
    };
    const getContainerHealth = vi.fn(async () => ok('up' as const));
    const store = createAppStore(fakeDeps({ docker: fakeDocker(getContainerHealth), manifest }));

    store.getState().startUpdateHealthPolling(['/repo/a']);
    await flushPolls();

    expect(getContainerHealth).not.toHaveBeenCalled();
    expect(store.getState().updateServiceHealth['/repo/a']).toBe('no-container');
  });

  it('startUpdateHealthPolling on an unwired store is a no-op, never a throw', () => {
    const store = createAppStore();

    expect(() => store.getState().startUpdateHealthPolling(['/repo/a'])).not.toThrow();
    expect(store.getState().updateServiceHealth).toEqual({});
  });
});

// The pre-run configuration screen's store state — opening pre-scoped to the trigger,
// confirming with exactly the confirmed configuration, and rejecting while a run is in flight.
describe('update slice: pre-run configuration screen', () => {
  it('a confirmed single-service config records its selection on the run; an unconfigured run records none', async () => {
    const store = createAppStore(fakeDeps());

    await store.getState().openUpdateConfig({ service: 'svc-a', repoPath: '/repo/a' });
    await store.getState().confirmUpdateConfig();

    // The zone reads this to mark only the selected row `updating` — the scope alone
    // (`edt`) would mark every member.
    expect(store.getState().updateScope).toBe('edt');
    expect(store.getState().updateSelection).toEqual([{ service: 'svc-a', repoPath: '/repo/a', sourceBranch: 'development' }]);

    await store.getState().runGroupUpdate('edt');

    expect(store.getState().updateSelection).toBeNull();
  });

  it('openUpdateConfig(edt) pre-selects every member with the manifest sharedBranch default', async () => {
    const store = createAppStore(fakeDeps());

    await store.getState().openUpdateConfig('edt');

    expect(store.getState().updateConfig).toEqual({
      scope: 'edt',
      rows: [
        { service: 'svc-a', repoPath: '/repo/a', sourceBranch: 'development', sharedBranch: 'development', origin: 'shared', selected: true, migrationDeclared: true, recipeDeclared: false, migrations: 'follow', cleanRestart: 'follow' },
        { service: 'svc-b', repoPath: '/repo/b', sourceBranch: 'development', sharedBranch: 'development', origin: 'shared', selected: true, migrationDeclared: true, recipeDeclared: false, migrations: 'follow', cleanRestart: 'follow' },
      ],
      runMigrations: true,
      cleanRestart: false,
      error: null,
      layout: 'edt-panels',
      strategy: { kind: 'shared' },
    });
    // Opening the screen runs no git/docker action and starts no run.
    expect(store.getState().updateStatus).toBe('idle');
  });

  it('openUpdateConfig(all) lists every managed repo pre-selected', async () => {
    const store = createAppStore(fakeDeps());

    await store.getState().openUpdateConfig('all');

    expect(store.getState().updateConfig).toMatchObject({
      scope: 'all',
      rows: [
        { service: 'svc-a', repoPath: '/repo/a', sourceBranch: 'development', selected: true },
        { service: 'svc-b', repoPath: '/repo/b', sourceBranch: 'development', selected: true },
      ],
      runMigrations: true,
      cleanRestart: false,
      error: null,
    });
  });

  it('openUpdateConfig({service}) pre-scopes to that single service', async () => {
    const store = createAppStore(fakeDeps());

    await store.getState().openUpdateConfig({ service: 'svc-a' });

    expect(store.getState().updateConfig).toMatchObject({
      scope: 'edt',
      rows: [{ service: 'svc-a', repoPath: '/repo/a', sourceBranch: 'development', selected: true }],
    });
  });

  it('openUpdateConfig({service, repoPath}) opens a one-row draft for the pinned repo', async () => {
    const store = createAppStore(fakeDeps());

    await store.getState().openUpdateConfig({ service: 'svc-b', repoPath: '/repo/b' });

    expect(store.getState().updateConfig).toMatchObject({
      scope: 'edt',
      rows: [{ service: 'svc-b', repoPath: '/repo/b', sourceBranch: 'development', selected: true }],
      runMigrations: true,
      cleanRestart: false,
      error: null,
    });
    expect(store.getState().updateStatus).toBe('idle');
  });

  it('openUpdateConfig({service, repoPath}) fails with the underlying error when scope resolution cannot read state', async () => {
    const state: StatePort = {
      readActiveEdt: vi.fn(async () => err('state-invalid-format', 'corrupt')),
      writeActiveEdt: vi.fn(async () => ok(undefined)),
      readSplitterRatios: vi.fn(async () => ok(null)),
      writeSplitterRatios: vi.fn(async () => ok(undefined)),
      readFilterHistory: vi.fn(async () => ok(null)),
      writeFilterHistory: vi.fn(async () => ok(undefined)),
      readCommandHistory: vi.fn(async () => ok(null)),
      writeCommandHistory: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ state }));

    await store.getState().openUpdateConfig({ service: 'svc-a', repoPath: '/repo/a' });

    // Never silently downgraded to `all` (which would drop the edt unexpected-branch
    // gate) — the open fails with the read failure instead.
    expect(store.getState().updateConfig).toBeNull();
    expect(store.getState().updateStatus).toBe('error');
    expect(store.getState().updateErrorCode).toBe('state-invalid-format');
  });

  it('openUpdateConfig({service}) for an unknown service fails service-not-found with no screen', async () => {
    const store = createAppStore(fakeDeps());

    await store.getState().openUpdateConfig({ service: 'svc-nope' });

    expect(store.getState().updateConfig).toBeNull();
    expect(store.getState().updateStatus).toBe('error');
    expect(store.getState().updateErrorCode).toBe('service-not-found');
  });

  it('openUpdateConfig(edt) with no active EDT fails no-active-edt with no screen', async () => {
    const state: StatePort = {
      readActiveEdt: vi.fn(async () => ok(null)),
      writeActiveEdt: vi.fn(async () => ok(undefined)),
      readSplitterRatios: vi.fn(async () => ok(null)),
      writeSplitterRatios: vi.fn(async () => ok(undefined)),
      readFilterHistory: vi.fn(async () => ok(null)),
      writeFilterHistory: vi.fn(async () => ok(undefined)),
      readCommandHistory: vi.fn(async () => ok(null)),
      writeCommandHistory: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ state }));

    await store.getState().openUpdateConfig('edt');

    expect(store.getState().updateConfig).toBeNull();
    expect(store.getState().updateStatus).toBe('error');
    expect(store.getState().updateErrorCode).toBe('no-active-edt');
  });

  it('openUpdateConfig while running is rejected update-already-running with no screen', async () => {
    const store = createAppStore(fakeDeps());
    store.setState({ updateStatus: 'running' });

    await store.getState().openUpdateConfig('edt');

    expect(store.getState().updateConfig).toBeNull();
    expect(store.getState().updateStatus).toBe('running');
    expect(store.getState().updateNotice?.code).toBe('update-already-running');
  });

  it('openUpdateConfig(edt) on a zero-member EDT fails no-services-selected with no screen', async () => {
    const edtRegistry: EdtRegistryPort = {
      add: vi.fn(async () => ok(undefined)),
      list: vi.fn(async () =>
        ok([
          {
            ulid: 'edt-empty',
            topic: 'empty',
            createdAt: '2026-09-17T00:00:00.000Z',
            status: 'active' as const,
            members: [],
          },
        ]),
      ),
      setStatus: vi.fn(async () => ok(undefined)),
      update: vi.fn(async () => ok(undefined)),
      remove: vi.fn(async () => ok(undefined)),
    };
    const state: StatePort = {
      readActiveEdt: vi.fn(async () => ok('edt-empty')),
      writeActiveEdt: vi.fn(async () => ok(undefined)),
      readSplitterRatios: vi.fn(async () => ok(null)),
      writeSplitterRatios: vi.fn(async () => ok(undefined)),
      readFilterHistory: vi.fn(async () => ok(null)),
      writeFilterHistory: vi.fn(async () => ok(undefined)),
      readCommandHistory: vi.fn(async () => ok(null)),
      writeCommandHistory: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ edtRegistry, state }));

    await store.getState().openUpdateConfig('edt');

    expect(store.getState().updateConfig).toBeNull();
    expect(store.getState().updateStatus).toBe('error');
    expect(store.getState().updateErrorCode).toBe('no-services-selected');
    expect(store.getState().updateError).toContain('empty');
  });

  it('openUpdateConfig(all) on an empty registry fails no-services-selected with no screen', async () => {
    const registry: RegistryPort = {
      list: vi.fn(async () => ok([])),
      add: vi.fn(async () => ok(undefined)),
      exists: vi.fn(async () => ok(true)),
      scan: vi.fn(async () => ok({ candidates: [], skipped: [] })),
      reset: vi.fn(async () => ok({ path: '/x', backupPath: null })),
      remove: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ registry }));

    await store.getState().openUpdateConfig('all');

    expect(store.getState().updateConfig).toBeNull();
    expect(store.getState().updateStatus).toBe('error');
    expect(store.getState().updateErrorCode).toBe('no-services-selected');
    expect(store.getState().updateError).toContain('No managed repos');
  });

  it('openUpdateConfig on an unwired store degrades to store-not-wired', async () => {
    const store = createAppStore();

    await store.getState().openUpdateConfig('edt');

    expect(store.getState().updateConfig).toBeNull();
    expect(store.getState().updateStatus).toBe('error');
    expect(store.getState().updateErrorCode).toBe('store-not-wired');
  });

  it('openUpdateConfig degrades to store-not-wired when only the restart port is missing', async () => {
    const deps = fakeDeps();
    const { restart: _dropped, ...withoutRestart } = deps;
    const store = createAppStore(withoutRestart);

    await store.getState().openUpdateConfig('edt');

    expect(store.getState().updateConfig).toBeNull();
    expect(store.getState().updateStatus).toBe('error');
    expect(store.getState().updateErrorCode).toBe('store-not-wired');
  });

  it('confirmUpdateConfig with zero selected is rejected inline: the screen stays open and nothing ran', async () => {
    const deps = fakeDeps();
    const store = createAppStore(deps);
    await store.getState().openUpdateConfig('edt');
    const draft = store.getState().updateConfig;
    expect(draft).not.toBeNull();
    store.getState().setUpdateConfig({
      ...draft!,
      rows: draft!.rows.map((row) => ({ ...row, selected: false })),
    });

    await store.getState().confirmUpdateConfig();

    expect(store.getState().updateConfig).not.toBeNull();
    expect(store.getState().updateConfig?.error).toContain('No services selected');
    expect(store.getState().updateStatus).toBe('idle');
    expect(deps.git.fetch).not.toHaveBeenCalled();
    expect(deps.git.pull).not.toHaveBeenCalled();
    expect(deps.git.mergeBranch).not.toHaveBeenCalled();
    expect(deps.migration!.run).not.toHaveBeenCalled();
    expect(deps.container!.restart).not.toHaveBeenCalled();
  });

  it('confirmUpdateConfig with a blank branch on a selected row is rejected inline and nothing runs', async () => {
    const deps = fakeDeps();
    const store = createAppStore(deps);
    await store.getState().openUpdateConfig('edt');
    const draft = store.getState().updateConfig;
    expect(draft).not.toBeNull();
    store.getState().setUpdateConfig({
      ...draft!,
      rows: draft!.rows.map((row) => (row.service === 'svc-a' ? { ...row, sourceBranch: '   ' } : row)),
    });

    await store.getState().confirmUpdateConfig();

    expect(store.getState().updateConfig).not.toBeNull();
    expect(store.getState().updateConfig?.error).toContain('empty source branch');
    expect(store.getState().updateStatus).toBe('idle');
    expect(deps.git.fetch).not.toHaveBeenCalled();
    expect(deps.git.pull).not.toHaveBeenCalled();
    expect(deps.git.mergeBranch).not.toHaveBeenCalled();
    expect(deps.migration!.run).not.toHaveBeenCalled();
    expect(deps.container!.restart).not.toHaveBeenCalled();
  });

  it('confirmUpdateConfig runs exactly the selected subset: the deselected service is absent from results', async () => {
    const deps = fakeDeps();
    const store = createAppStore(deps);
    await store.getState().openUpdateConfig('edt');
    const draft = store.getState().updateConfig;
    expect(draft).not.toBeNull();
    store.getState().setUpdateConfig({
      ...draft!,
      rows: draft!.rows.map((row) => ({ ...row, selected: row.service === 'svc-a' })),
    });

    await store.getState().confirmUpdateConfig();

    // The screen closed and the run landed with only the selected service reported.
    expect(store.getState().updateConfig).toBeNull();
    expect(store.getState().updateStatus).toBe('done');
    expect(store.getState().updateResults).toEqual([{ service: 'svc-a', outcome: 'updated', run: expect.anything() }]);
    expect(deps.container!.restart).toHaveBeenCalledTimes(1);
    expect(deps.container!.restart).toHaveBeenCalledWith('ctr-a');
  });

  it('confirmUpdateConfig threads the toggles: runMigrations off never runs migrations', async () => {
    const deps = fakeDeps();
    const store = createAppStore(deps);
    await store.getState().openUpdateConfig('edt');
    const draft = store.getState().updateConfig;
    expect(draft).not.toBeNull();
    store.getState().setUpdateConfig({ ...draft!, runMigrations: false });

    await store.getState().confirmUpdateConfig();

    expect(store.getState().updateStatus).toBe('done');
    expect(store.getState().updateResults).toEqual([
      { service: 'svc-a', outcome: 'updated', run: expect.anything() },
      { service: 'svc-b', outcome: 'updated', run: expect.anything() },
    ]);
    expect(deps.migration!.run).not.toHaveBeenCalled();
    expect(deps.container!.restart).toHaveBeenCalledTimes(2);
  });

  it('confirmUpdateConfig threads the clean-restart toggle: cleanRestart on runs the recipe, never the plain restart', async () => {
    const manifest: ManifestPort = {
      load: vi.fn(async (repoPath: string) =>
        ok({
          service: `svc-${repoPath.split('/').pop()}`,
          container: `ctr-${repoPath.split('/').pop()}`,
          migrationCommand: 'npm run migration:run',
          restartCommands: ['npm ci'],
          sharedBranch: 'development',
          modules: {},
        }),
      ),
    };
    const deps = fakeDeps({ manifest });
    const store = createAppStore(deps);
    await store.getState().openUpdateConfig('edt');
    const draft = store.getState().updateConfig;
    expect(draft).not.toBeNull();
    store.getState().setUpdateConfig({ ...draft!, cleanRestart: true });

    await store.getState().confirmUpdateConfig();

    expect(store.getState().updateStatus).toBe('done');
    expect(deps.restart!.run).toHaveBeenCalledTimes(2);
    expect(deps.restart!.run).toHaveBeenCalledWith('/repo/a', 'npm ci');
    expect(deps.restart!.run).toHaveBeenCalledWith('/repo/b', 'npm ci');
    expect(deps.container!.restart).not.toHaveBeenCalled();
  });

  it('confirmUpdateConfig threads a per-service branch override as its merge source', async () => {
    const deps = fakeDeps();
    const store = createAppStore(deps);
    await store.getState().openUpdateConfig('edt');
    const draft = store.getState().updateConfig;
    expect(draft).not.toBeNull();
    store.getState().setUpdateConfig({
      ...draft!,
      rows: draft!.rows.map((row) => (row.service === 'svc-a' ? { ...row, sourceBranch: 'release/1' } : row)),
    });

    await store.getState().confirmUpdateConfig();

    expect(store.getState().updateStatus).toBe('done');
    expect(deps.git.fetch).toHaveBeenCalledWith('/repo/a', 'release/1');
    expect(deps.git.mergeBranch).toHaveBeenCalledWith('/repo/a', 'release/1');
  });

  it('confirmUpdateConfig restores the screen inline on a core unknown-branch rejection: nothing ran', async () => {
    const git: GitPort = {
      ...(fakeDeps().git as GitPort),
      branchExistsLocally: vi.fn(async () => ok(false)),
    };
    const deps = fakeDeps({ git });
    const store = createAppStore(deps);
    await store.getState().openUpdateConfig('edt');
    const draft = store.getState().updateConfig;
    expect(draft).not.toBeNull();
    store.getState().setUpdateConfig({
      ...draft!,
      rows: draft!.rows.map((row) => (row.service === 'svc-a' ? { ...row, sourceBranch: 'nope/not-here' } : row)),
    });

    await store.getState().confirmUpdateConfig();

    // The screen stays open with the rejection inline; the run banner is back to idle.
    expect(store.getState().updateConfig).not.toBeNull();
    expect(store.getState().updateConfig?.error).toContain('nope/not-here');
    expect(store.getState().updateConfig?.rows).toHaveLength(2);
    expect(store.getState().updateConfig?.runMigrations).toBe(true);
    expect(store.getState().updateStatus).toBe('idle');
    expect(store.getState().updateError).toBeNull();
    expect(store.getState().updateErrorCode).toBeNull();
    // Pre-lock rejection means zero git writes, migrations, or restarts anywhere.
    expect(deps.git.fetch).not.toHaveBeenCalled();
    expect(deps.git.pull).not.toHaveBeenCalled();
    expect(deps.git.mergeBranch).not.toHaveBeenCalled();
    expect(deps.migration!.run).not.toHaveBeenCalled();
    expect(deps.container!.restart).not.toHaveBeenCalled();
  });

  it('confirmUpdateConfig restores the screen inline on a core no-services-selected rejection', async () => {
    const listMock = vi.fn(async () =>
      ok([
        {
          ulid: 'edt-1',
          topic: 'demo',
          createdAt: '2026-09-17T00:00:00.000Z',
          status: 'active' as const,
          members: [
            { service: 'svc-a', repoPath: '/repo/a', branch: 'feat/a' },
            { service: 'svc-b', repoPath: '/repo/b', branch: 'feat/b' },
          ],
        },
      ]),
    );
    const edtRegistry: EdtRegistryPort = {
      add: vi.fn(async () => ok(undefined)),
      list: listMock,
      setStatus: vi.fn(async () => ok(undefined)),
      update: vi.fn(async () => ok(undefined)),
      remove: vi.fn(async () => ok(undefined)),
    };
    const deps = fakeDeps({ edtRegistry });
    const store = createAppStore(deps);
    await store.getState().openUpdateConfig('edt');
    expect(store.getState().updateConfig).not.toBeNull();
    // Membership changed out from under the open screen: the confirmed selection matches
    // nothing, so core rejects pre-lock and nothing runs.
    listMock.mockResolvedValue(
      ok([
        {
          ulid: 'edt-1',
          topic: 'demo',
          createdAt: '2026-09-17T00:00:00.000Z',
          status: 'active' as const,
          members: [{ service: 'svc-z', repoPath: '/repo/z', branch: 'feat/z' }],
        },
      ]),
    );

    await store.getState().confirmUpdateConfig();

    expect(store.getState().updateConfig).not.toBeNull();
    expect(store.getState().updateConfig?.error).toContain('None of the selected services');
    expect(store.getState().updateStatus).toBe('idle');
    expect(store.getState().updateErrorCode).toBeNull();
    expect(deps.git.fetch).not.toHaveBeenCalled();
    expect(deps.git.mergeBranch).not.toHaveBeenCalled();
    expect(deps.container!.restart).not.toHaveBeenCalled();
  });

  it('openUpdateConfig clears a stale done banner but keeps per-run history', async () => {
    const store = createAppStore(fakeDeps());
    store.setState({
      updateStatus: 'done',
      updateTopic: 'demo',
      updateResults: [{ service: 'svc-a', outcome: 'updated' }],
      updateNote: 'stale note',
      lastServiceOutcomes: { 'svc-a': { service: 'svc-a', outcome: 'updated' } },
    });

    await store.getState().openUpdateConfig('edt');

    expect(store.getState().updateConfig).not.toBeNull();
    expect(store.getState().updateStatus).toBe('idle');
    expect(store.getState().updateError).toBeNull();
    expect(store.getState().updateErrorCode).toBeNull();
    expect(store.getState().updateNote).toBeNull();
    // History survives: the results list and the per-service outcome map are untouched.
    expect(store.getState().updateResults).toEqual([{ service: 'svc-a', outcome: 'updated' }]);
    expect(store.getState().lastServiceOutcomes).toEqual({ 'svc-a': { service: 'svc-a', outcome: 'updated' } });
  });

  it('openUpdateConfig clears a stale error banner', async () => {
    const store = createAppStore(fakeDeps());
    store.setState({ updateStatus: 'error', updateError: 'stale boom', updateErrorCode: 'internal-error' });

    await store.getState().openUpdateConfig('all');

    expect(store.getState().updateConfig).not.toBeNull();
    expect(store.getState().updateStatus).toBe('idle');
    expect(store.getState().updateError).toBeNull();
    expect(store.getState().updateErrorCode).toBeNull();
  });

  it('confirmUpdateConfig with no open screen is a no-op', async () => {
    const store = createAppStore(fakeDeps());

    await store.getState().confirmUpdateConfig();

    expect(store.getState().updateStatus).toBe('idle');
    expect(store.getState().updateConfig).toBeNull();
  });

  it('closeUpdateConfig closes the screen without starting anything', async () => {
    const deps = fakeDeps();
    const store = createAppStore(deps);
    await store.getState().openUpdateConfig('edt');
    expect(store.getState().updateConfig).not.toBeNull();

    store.getState().closeUpdateConfig();

    expect(store.getState().updateConfig).toBeNull();
    expect(store.getState().updateStatus).toBe('idle');
    expect(deps.git.fetch).not.toHaveBeenCalled();
    expect(deps.container!.restart).not.toHaveBeenCalled();
  });

  it('setUpdateConfig is a no-op without an open screen', () => {
    const store = createAppStore(fakeDeps());

    expect(() => store.getState().setUpdateConfig({
      scope: 'edt',
      rows: [],
      runMigrations: true,
      cleanRestart: false,
      error: null,
      layout: 'service-panels',
      strategy: { kind: 'shared' },
    })).not.toThrow();
    expect(store.getState().updateConfig).toBeNull();
  });

  it('clearUpdate also closes an open configuration screen', async () => {
    const store = createAppStore(fakeDeps());
    await store.getState().openUpdateConfig('edt');
    expect(store.getState().updateConfig).not.toBeNull();

    store.getState().clearUpdate();

    expect(store.getState().updateConfig).toBeNull();
  });

  it('starts with no standalone restart in flight', () => {
    const store = createAppStore(fakeDeps());

    expect(store.getState().serviceRestartInFlight).toEqual({});
  });

  it('runServiceRestart restarts only that service and merges its row into lastServiceOutcomes', async () => {
    const deps = fakeDeps();
    const store = createAppStore(deps);

    await store.getState().runServiceRestart('/repo/a');

    expect(store.getState().lastServiceOutcomes['svc-a']).toEqual({ service: 'svc-a', outcome: 'updated' });
    expect(store.getState().serviceRestartInFlight).toEqual({});
    // Only that service's repo was touched — the plain fallback ran for its container.
    expect(deps.container!.restart).toHaveBeenCalledTimes(1);
    expect(deps.container!.restart).toHaveBeenCalledWith('ctr-a');
    // A standalone restart never fabricates a group run summary.
    expect(store.getState().updateStatus).toBe('idle');
    expect(store.getState().updateResults).toEqual([]);
  });

  it('runServiceRestart merges a failed row without blocking the next service', async () => {
    const restart: RestartPort = { run: vi.fn(async () => err('restart-failed', 'boom')) };
    const manifest: ManifestPort = {
      load: vi.fn(async (repoPath: string) =>
        ok({
          service: `svc-${repoPath.split('/').pop()}`,
          container: `ctr-${repoPath.split('/').pop()}`,
          migrationCommand: 'npm run migration:run',
          restartCommands: ['npm ci'],
          sharedBranch: 'development',
          modules: {},
        }),
      ),
    };
    const store = createAppStore(fakeDeps({ restart, manifest }));

    await store.getState().runServiceRestart('/repo/a');

    expect(store.getState().lastServiceOutcomes['svc-a']).toMatchObject({
      service: 'svc-a',
      outcome: 'failed',
      detail: { code: 'restart-failed' },
    });
    expect(store.getState().serviceRestartInFlight).toEqual({});

    await store.getState().runServiceRestart('/repo/b');

    expect(store.getState().lastServiceOutcomes['svc-b']).toMatchObject({ service: 'svc-b', outcome: 'failed' });
    expect(store.getState().lastServiceOutcomes['svc-a']).toMatchObject({ service: 'svc-a', outcome: 'failed' });
  });

  it('runServiceRestart on a container-less service without a recipe merges the no-container row and touches neither restart path', async () => {
    const manifest: ManifestPort = {
      load: vi.fn(async (repoPath: string) =>
        ok({
          service: `svc-${repoPath.split('/').pop()}`,
          sharedBranch: 'development',
          modules: {},
        }),
      ),
    };
    const container: ContainerPort = { restart: vi.fn(async () => ok(undefined)) };
    const restart: RestartPort = { run: vi.fn(async () => ok({ output: '' })) };
    const store = createAppStore(fakeDeps({ manifest, container, restart }));

    await store.getState().runServiceRestart('/repo/a');

    expect(store.getState().lastServiceOutcomes['svc-a']).toMatchObject({
      service: 'svc-a',
      outcome: 'failed',
      detail: { code: 'no-container' },
    });
    expect(container.restart).not.toHaveBeenCalled();
    expect(restart.run).not.toHaveBeenCalled();
    expect(store.getState().serviceRestartInFlight).toEqual({});
  });

  it('describeServiceRestart offers the restart for a container-less service only with a declared recipe', async () => {
    const manifest: ManifestPort = {
      load: vi.fn(async (repoPath: string) => {
        if (repoPath === '/repo/plain') {
          return ok({ service: 'plain', container: 'ctr-plain', sharedBranch: 'development', modules: {} });
        }
        if (repoPath === '/repo/recipe') {
          return ok({ service: 'recipe', restartCommands: ['npm ci'], sharedBranch: 'development', modules: {} });
        }
        if (repoPath === '/repo/bare') {
          return ok({ service: 'bare', sharedBranch: 'development', modules: {} });
        }
        return err('manifest-not-found', 'gone');
      }),
    };
    const store = createAppStore(fakeDeps({ manifest }));

    await expect(store.getState().describeServiceRestart('/repo/plain')).resolves.toEqual({ restartAvailable: true });
    await expect(store.getState().describeServiceRestart('/repo/recipe')).resolves.toEqual({ restartAvailable: true });
    await expect(store.getState().describeServiceRestart('/repo/bare')).resolves.toEqual({ restartAvailable: false });
    await expect(store.getState().describeServiceRestart('/repo/gone')).resolves.toEqual({ restartAvailable: true });
  });

  it('describeServiceRestart on an unwired store offers the restart, never a throw', async () => {
    const store = createAppStore();

    await expect(store.getState().describeServiceRestart('/repo/a')).resolves.toEqual({ restartAvailable: true });
  });

  it('a second trigger on the same service while its restart runs is rejected update-already-running', async () => {
    let resolveRestart: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      resolveRestart = resolve;
    });
    const restart: RestartPort = {
      run: vi.fn(async () => {
        await gate;
        return ok({ output: '' });
      }),
    };
    const manifest: ManifestPort = {
      load: vi.fn(async (repoPath: string) =>
        ok({
          service: `svc-${repoPath.split('/').pop()}`,
          container: `ctr-${repoPath.split('/').pop()}`,
          migrationCommand: 'npm run migration:run',
          restartCommands: ['npm ci'],
          sharedBranch: 'development',
          modules: {},
        }),
      ),
    };
    const store = createAppStore(fakeDeps({ restart, manifest }));

    const first = store.getState().runServiceRestart('/repo/a');
    expect(store.getState().serviceRestartInFlight).toEqual({ '/repo/a': 'restart' });

    await store.getState().runServiceRestart('/repo/a');
    expect(store.getState().updateStatus).toBe('error');
    expect(store.getState().updateErrorCode).toBe('update-already-running');
    // The first restart still holds its own slot — the rejected second trigger never stole it.
    expect(store.getState().serviceRestartInFlight).toEqual({ '/repo/a': 'restart' });

    resolveRestart?.();
    await first;
    expect(store.getState().serviceRestartInFlight).toEqual({});
    expect(store.getState().lastServiceOutcomes['svc-a']).toMatchObject({ outcome: 'updated' });
    expect(restart.run).toHaveBeenCalledTimes(1);
  });

  it('a different idle service stays triggerable while one restart runs — per-service, not global', async () => {
    let resolveRestart: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      resolveRestart = resolve;
    });
    const restart: RestartPort = {
      run: vi.fn(async (repoPath: string) => {
        if (repoPath === '/repo/a') {
          await gate;
        }
        return ok({ output: '' });
      }),
    };
    const manifest: ManifestPort = {
      load: vi.fn(async (repoPath: string) =>
        ok({
          service: `svc-${repoPath.split('/').pop()}`,
          container: `ctr-${repoPath.split('/').pop()}`,
          migrationCommand: 'npm run migration:run',
          restartCommands: ['npm ci'],
          sharedBranch: 'development',
          modules: {},
        }),
      ),
    };
    const store = createAppStore(fakeDeps({ restart, manifest }));

    const first = store.getState().runServiceRestart('/repo/a');
    await store.getState().runServiceRestart('/repo/b');

    expect(store.getState().lastServiceOutcomes['svc-b']).toMatchObject({ outcome: 'updated' });

    resolveRestart?.();
    await first;
    expect(store.getState().lastServiceOutcomes['svc-a']).toMatchObject({ outcome: 'updated' });
    expect(store.getState().serviceRestartInFlight).toEqual({});
  });

  it('runServiceRestart while a group run is in flight is rejected update-already-running, nothing started', async () => {
    let resolveFetch: (() => void) | undefined;
    const fetchGate = new Promise<void>((resolve) => {
      resolveFetch = resolve;
    });
    const git: GitPort = {
      ...(fakeDeps().git as GitPort),
      fetch: vi.fn(async () => {
        await fetchGate;
        return ok(undefined);
      }),
    };
    const deps = fakeDeps({ git });
    const store = createAppStore(deps);

    const group = store.getState().runGroupUpdate();
    expect(store.getState().updateStatus).toBe('running');

    await store.getState().runServiceRestart('/repo/a');

    expect(store.getState().updateStatus).toBe('running');
    expect(store.getState().updateNotice?.code).toBe('update-already-running');
    expect(deps.container!.restart).not.toHaveBeenCalled();

    resolveFetch?.();
    await group;
  });

  it('runGroupUpdate while a standalone restart is in flight is rejected update-already-running', async () => {
    let resolveRestart: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      resolveRestart = resolve;
    });
    const restart: RestartPort = {
      run: vi.fn(async () => {
        await gate;
        return ok({ output: '' });
      }),
    };
    const manifest: ManifestPort = {
      load: vi.fn(async (repoPath: string) =>
        ok({
          service: `svc-${repoPath.split('/').pop()}`,
          container: `ctr-${repoPath.split('/').pop()}`,
          migrationCommand: 'npm run migration:run',
          restartCommands: ['npm ci'],
          sharedBranch: 'development',
          modules: {},
        }),
      ),
    };
    const store = createAppStore(fakeDeps({ restart, manifest }));

    const standalone = store.getState().runServiceRestart('/repo/a');
    expect(store.getState().serviceRestartInFlight).toEqual({ '/repo/a': 'restart' });

    await store.getState().runGroupUpdate();
    expect(store.getState().updateStatus).toBe('error');
    expect(store.getState().updateErrorCode).toBe('update-already-running');

    resolveRestart?.();
    await standalone;
    expect(store.getState().serviceRestartInFlight).toEqual({});
  });

  it('openUpdateConfig while a standalone restart is in flight is rejected update-already-running', async () => {
    const store = createAppStore(fakeDeps());
    store.setState({ serviceRestartInFlight: { '/repo/a': 'restart' } });

    await store.getState().openUpdateConfig('edt');

    expect(store.getState().updateStatus).toBe('error');
    expect(store.getState().updateErrorCode).toBe('update-already-running');
    expect(store.getState().updateConfig).toBeNull();
  });

  it('runServiceRestart surfaces a core lock-contention backstop as update-already-running', async () => {
    const lock: LockPort = {
      acquire: vi.fn(async () => err('action-in-progress', 'held')),
      peek: vi.fn(async () => ok({ locked: true })),
    };
    const store = createAppStore(fakeDeps({ lock }));

    await store.getState().runServiceRestart('/repo/a');

    expect(store.getState().updateStatus).toBe('error');
    expect(store.getState().updateErrorCode).toBe('update-already-running');
    expect(store.getState().serviceRestartInFlight).toEqual({});
  });

  it('runServiceRestart degrades to store-not-wired when the restart port is missing', async () => {
    const deps = fakeDeps();
    const { restart: _dropped, ...withoutRestart } = deps;
    const store = createAppStore(withoutRestart);

    await store.getState().runServiceRestart('/repo/a');

    expect(store.getState().updateStatus).toBe('error');
    expect(store.getState().updateErrorCode).toBe('store-not-wired');
  });

  it('clearUpdate drops the in-flight map alongside the run state', () => {
    const store = createAppStore(fakeDeps());
    store.setState({ serviceRestartInFlight: { '/repo/a': 'restart' } });

    store.getState().clearUpdate();

    expect(store.getState().serviceRestartInFlight).toEqual({});
  });

  it('confirmUpdateConfig while a standalone restart is in flight stays open with the inline error', async () => {
    const deps = fakeDeps();
    const store = createAppStore(deps);
    await store.getState().openUpdateConfig('edt');
    expect(store.getState().updateConfig).not.toBeNull();
    store.setState({ serviceRestartInFlight: { '/repo/a': 'restart' } });

    await store.getState().confirmUpdateConfig();

    expect(store.getState().updateConfig).not.toBeNull();
    expect(store.getState().updateConfig?.error).toContain('already in progress');
    expect(store.getState().updateStatus).toBe('idle');
    expect(deps.git.fetch).not.toHaveBeenCalled();
    expect(deps.git.pull).not.toHaveBeenCalled();
    expect(deps.git.mergeBranch).not.toHaveBeenCalled();
    expect(deps.migration!.run).not.toHaveBeenCalled();
    expect(deps.container!.restart).not.toHaveBeenCalled();
  });
});

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
    expect(store.getState().liveServicePhase).toEqual({ 'svc-a': 'migrating' });

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
    await waitForCondition(() => store.getState().updateBlocker !== null);

    // Raising the menu appends the unresolved entry before any phase is emitted.
    expect(store.getState().updateBlocker).toMatchObject({ service: 'svc-a', kind: 'dirty-worktree' });
    expect(store.getState().liveServiceIssues).toEqual({
      'svc-a': [{ kind: 'dirty-worktree', detail: '/repo/a', resolved: false }],
    });
    expect(store.getState().liveServicePhase).toEqual({});

    store.getState().resolveUpdateBlocker('edited');
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
        dirtyReads += 1;
        // Still dirty after the stash, clean only once the repo is cancelled.
        return ok(dirtyReads <= 2 && repoPath === '/repo/a' ? ['src/app.ts'] : []);
      }),
    };
    const store = createAppStore({ ...base, git });

    const run = store.getState().runGroupUpdate();
    await waitForCondition(() => store.getState().updateBlocker !== null);
    store.getState().resolveUpdateBlocker('stash');

    // Core re-presents the same menu — the second raise must not duplicate the row.
    await waitForCondition(() => store.getState().updateBlocker !== null && dirtyReads >= 2);
    expect(store.getState().liveServiceIssues).toEqual({
      'svc-a': [{ kind: 'dirty-worktree', detail: '/repo/a', resolved: false }],
    });

    store.getState().resolveUpdateBlocker('cancel-repo');
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
