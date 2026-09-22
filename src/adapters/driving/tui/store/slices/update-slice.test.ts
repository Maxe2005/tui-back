// tui/store/slices/update-slice: unit tests for the Update zone's run state — the slice
// calls the real core/scripts/group-update.ts use-case against fake ports (AD-2
// in-process), so these verify the wiring (status transitions, runInProgress guard,
// interrupted marking + edts refresh) rather than re-testing the use-case matrix.
import { describe, expect, it, vi } from 'vitest';
import { ok, err } from '../../../../../core/result.js';
import type { ContainerPort } from '../../../../../core/ports/container.js';
import type { DockerPort } from '../../../../../core/ports/docker.js';
import type { EdtRegistryPort } from '../../../../../core/ports/edt-registry.js';
import type { GitPort } from '../../../../../core/ports/git.js';
import type { LockPort } from '../../../../../core/ports/lock.js';
import type { ManifestPort } from '../../../../../core/ports/manifest.js';
import type { MigrationPort } from '../../../../../core/ports/migration.js';
import type { RegistryPort } from '../../../../../core/ports/registry.js';
import type { SettingsPort } from '../../../../../core/ports/settings.js';
import type { StatePort } from '../../../../../core/ports/state.js';
import { DEFAULT_SETTINGS } from '../../../../../core/ports/settings.js';
import { createAppStore, type AppStoreDeps } from '../app-store.js';
import { UPDATE_HEALTH_POLL_INTERVAL_MS } from './update-slice.js';

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
    isRebaseInProgress: vi.fn(async () => ok(false)),
    hasUnmergedPaths: vi.fn(async () => ok(false)),
    finalizeMerge: vi.fn(async () => ok(undefined)),
    listBranches: vi.fn(async () => ok([])),
    renameBranch: vi.fn(async () => ok(undefined)),
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
    git,
    container,
    migration,
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
      { service: 'svc-a', outcome: 'updated' },
      { service: 'svc-b', outcome: 'updated' },
    ]);
    expect(store.getState().runInProgress).toBe(false);
  });

  // Review fix (story 3.6): exercises the real `set((state) => ({ ..., lastServiceOutcomes:
  // mergeLastServiceOutcomes(...) }))` wiring through the actual runGroupUpdate flow —
  // pure mergeLastServiceOutcomes unit tests and hand-seeded store.setState calls in zone
  // render tests don't catch a bug in that wiring itself (e.g. the merge call dropped, or
  // given the wrong arguments).
  it('runGroupUpdate populates lastServiceOutcomes with the run\'s own per-service outcomes', async () => {
    const store = createAppStore(fakeDeps());
    expect(store.getState().lastServiceOutcomes).toEqual({});

    await store.getState().runGroupUpdate();

    expect(store.getState().lastServiceOutcomes).toEqual({
      'svc-a': { service: 'svc-a', outcome: 'updated' },
      'svc-b': { service: 'svc-b', outcome: 'updated' },
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
      'svc-a': { service: 'svc-a', outcome: 'updated' },
      'svc-b': { service: 'svc-b', outcome: 'updated' },
    });

    // Second run: the default EDT-scoped run, targeting only svc-a (the sole member above).
    await store.getState().runGroupUpdate();
    expect(store.getState().updateResults).toEqual([{ service: 'svc-a', outcome: 'updated' }]);

    // svc-b sat outside this second run's scope entirely — its earlier outcome must survive
    // the merge, never be dropped by a wholesale replace.
    expect(store.getState().lastServiceOutcomes).toEqual({
      'svc-a': { service: 'svc-a', outcome: 'updated' },
      'svc-b': { service: 'svc-b', outcome: 'updated' },
    });
  });

  it('runGroupUpdate threads the scope: runGroupUpdate(all) lands done on the all-repos outcome', async () => {
    const store = createAppStore(fakeDeps());

    await store.getState().runGroupUpdate('all');

    expect(store.getState().updateStatus).toBe('done');
    expect(store.getState().updateTopic).toBe('all-repos');
    expect(store.getState().updateUlid).toBe('all');
    expect(store.getState().updateScope).toBe('all');
    expect(store.getState().updateResults).toEqual([
      { service: 'svc-a', outcome: 'updated' },
      { service: 'svc-b', outcome: 'updated' },
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
    expect(store.getState().updateStatus).toBe('error');
    expect(store.getState().updateErrorCode).toBe('update-already-running');

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

  it('runGroupUpdate raises the blocker on a dirty repo and resumes on resolveUpdateBlocker (story 3.4)', async () => {
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
      { service: 'svc-b', outcome: 'updated' },
    ]);
    expect(store.getState().runInProgress).toBe(false);
  });

  it('resolveUpdateBlocker with no raised blocker is a no-op, never a throw (story 3.4)', () => {
    const store = createAppStore(fakeDeps());

    store.getState().resolveUpdateBlocker('cancel-repo');

    expect(store.getState().updateBlocker).toBeNull();
    expect(store.getState().updateStatus).toBe('idle');
  });

  it('a throwing git write under a raised blocker settles as internal-error with the menu cleared (story 3.4)', async () => {
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

// Story 3.6: the Update zone's own service-list health poll — mirrors app-store.test.ts's
// "logs slice: inline service health & restart (story 5.3)" describe block (that story's own
// precedent for testing a slice's fire-and-forget poll-timer behavior against fake ports),
// but against startUpdateHealthPolling/stopUpdateHealthPolling/updateServiceHealth instead of
// subscribeLogsPane/logsPanes — this poll is Update-zone-owned and independent (Never: "no
// shared subscription" with Logs zone's own poll).
describe('update slice: service health polling (story 3.6)', () => {
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

  it('I/O matrix "Manifest load fails during health poll for a service": manifest.load failing leaves updateServiceHealth untouched (silent no-op)', async () => {
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

  it('startUpdateHealthPolling on an unwired store is a no-op, never a throw', () => {
    const store = createAppStore();

    expect(() => store.getState().startUpdateHealthPolling(['/repo/a'])).not.toThrow();
    expect(store.getState().updateServiceHealth).toEqual({});
  });
});
