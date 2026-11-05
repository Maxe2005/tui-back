// tui/store/slices/logs-slice: unit tests for the Logs zone's pane lifecycle — the slice
// calls core/logs use-cases against fake ports, so these verify the container-less guards
// (no subscribe, no poll, no restart, no history fetch) rather than re-testing the manager.
import { describe, expect, it, vi } from 'vitest';
import { err, ok } from '../../../../../core/result.js';
import type { DockerPort } from '../../../../../core/ports/docker.js';
import type { ManifestPort } from '../../../../../core/ports/manifest.js';
import type { StatePort } from '../../../../../core/ports/state.js';
import { createAppStore, type AppStoreDeps } from '../app-store.js';
import { LOGS_HEALTH_POLL_INTERVAL_MS, LOGS_LISTED_HEALTH_POLL_INTERVAL_MS } from './logs-slice.js';

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

function fakeDocker(overrides: Partial<DockerPort> = {}): DockerPort {
  return {
    streamLogs: vi.fn(() => () => {}),
    fetchLogsBefore: vi.fn(async () => ok([])),
    getContainerHealth: vi.fn(async () => ok('up' as const)),
    restartContainer: vi.fn(async () => ok(undefined)),
    ...overrides,
  };
}

function fakeState(): StatePort {
  return {
    readActiveEdt: vi.fn(async () => ok(null)),
    writeActiveEdt: vi.fn(async () => ok(undefined)),
    readSplitterRatios: vi.fn(async () => ok(null)),
    writeSplitterRatios: vi.fn(async () => ok(undefined)),
    readFilterHistory: vi.fn(async () => ok(null)),
    writeFilterHistory: vi.fn(async () => ok(undefined)),
    readCommandHistory: vi.fn(async () => ok(null)),
    writeCommandHistory: vi.fn(async () => ok(undefined)),
  };
}

function manifestWithoutContainer(): ManifestPort {
  return {
    load: vi.fn(async (repoPath: string) =>
      ok({ service: repoPath.split('/').pop() ?? repoPath, sharedBranch: 'development', modules: {} }),
    ),
  };
}

function manifestWithContainer(): ManifestPort {
  return {
    load: vi.fn(async (repoPath: string) =>
      ok({
        service: repoPath.split('/').pop() ?? repoPath,
        container: `ctr-${repoPath.split('/').pop()}`,
        sharedBranch: 'development',
        modules: {},
      }),
    ),
  };
}

function fakeDeps(overrides: Partial<AppStoreDeps> = {}): AppStoreDeps {
  return {
    registry: {
      list: vi.fn(async () => ok([])),
      add: vi.fn(async () => ok(undefined)),
      exists: vi.fn(async () => ok(true)),
      scan: vi.fn(async () => ok({ candidates: [], skipped: [] })),
      reset: vi.fn(async () => ok({ path: '/p', backupPath: null })),
      remove: vi.fn(async () => ok(undefined)),
    },
    manifest: manifestWithContainer(),
    git: {
      assertAllowedBranch: vi.fn(async () => ok(undefined)),
      createBranch: vi.fn(async () => ok(undefined)),
      deleteBranch: vi.fn(async () => ok(undefined)),
      currentBranch: vi.fn(async () => ok('feat/a')),
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
      listUnmergedPaths: vi.fn(async () => ok([] as string[])),
      readWorktreeFile: vi.fn(async () => ok("")),
      writeResolvedFile: vi.fn(async () => ok(undefined)),
      checkoutSide: vi.fn(async () => ok(undefined)),
      finalizeMerge: vi.fn(async () => ok(undefined)),
      listBranches: vi.fn(async () => ok([])),
      renameBranch: vi.fn(async () => ok(undefined)),
      listRemoteBranches: vi.fn(async () => ok([])),
      createTrackingBranch: vi.fn(async () => ok(undefined)),
      stagePaths: vi.fn(async () => ok(undefined)),
      commit: vi.fn(async () => ok(undefined)),
      isBranchMerged: vi.fn(async () => ok(true)),
      hasStash: vi.fn(async () => ok(false)),
      fetchRemote: vi.fn(async () => ok(undefined)),
      listUnpushedCommits: vi.fn(async () => ok([] as string[])),
      listVersionBumpCommits: vi.fn(async () => ok({ endedBy: "exhausted" as const, scanned: 0 })),
      listBranchesContaining: vi.fn(async () => ok([] as string[])),
    },
    edtRegistry: {
      add: vi.fn(async () => ok(undefined)),
      list: vi.fn(async () => ok([])),
      setStatus: vi.fn(async () => ok(undefined)),
      update: vi.fn(async () => ok(undefined)),
      remove: vi.fn(async () => ok(undefined)),
    },
    state: fakeState(),
    lock: {
      acquire: vi.fn(async () => ok({ release: vi.fn(async () => ok(undefined)) })),
      peek: vi.fn(async () => ok({ locked: false })),
    },
    registryResourceKey: '/config/registry.yaml',
    edtRegistryResourceKey: '/tmp/edts.yaml',
    edtsBaseDir: '/tmp/edts',
    docker: fakeDocker(),
    ...overrides,
  } as AppStoreDeps;
}

describe('logs slice: panes without a declared container', () => {
  it('subscribing records the no-container state with no stream, no health poll, and no docker call', async () => {
    const docker = fakeDocker();
    const store = createAppStore(fakeDeps({ docker, manifest: manifestWithoutContainer() }));

    await store.getState().subscribeLogsPane('/repo/lib', 'lib');
    await flush();

    expect(store.getState().logsPanes['/repo/lib']?.health).toBe('no-container');
    expect(store.getState().logsPanes['/repo/lib']?.lines).toEqual([]);
    expect(docker.streamLogs).not.toHaveBeenCalled();
    expect(docker.getContainerHealth).not.toHaveBeenCalled();
    expect(docker.fetchLogsBefore).not.toHaveBeenCalled();
  });

  it('a restart on such a pane is a no-op that never reaches docker', async () => {
    const docker = fakeDocker();
    const store = createAppStore(fakeDeps({ docker, manifest: manifestWithoutContainer() }));
    await store.getState().subscribeLogsPane('/repo/lib', 'lib');

    await store.getState().restartLogsPane('/repo/lib');

    expect(docker.restartContainer).not.toHaveBeenCalled();
    expect(store.getState().logsPanes['/repo/lib']?.restarting).toBe(false);
    expect(store.getState().logsPanes['/repo/lib']?.health).toBe('no-container');
  });

  it('loading older history on such a pane never reaches docker', async () => {
    const docker = fakeDocker();
    const store = createAppStore(fakeDeps({ docker, manifest: manifestWithoutContainer() }));
    await store.getState().subscribeLogsPane('/repo/lib', 'lib');

    await store.getState().loadOlderLogsPane('/repo/lib');

    expect(docker.fetchLogsBefore).not.toHaveBeenCalled();
    expect(store.getState().logsPanes['/repo/lib']?.health).toBe('no-container');
  });

  it('control: a container-ful subscribe still streams and polls docker', async () => {
    const docker = fakeDocker();
    const store = createAppStore(fakeDeps({ docker, manifest: manifestWithContainer() }));

    await store.getState().subscribeLogsPane('/repo/a', 'a');
    await flush();

    expect(store.getState().logsPanes['/repo/a']?.health).not.toBe('no-container');
    expect(docker.streamLogs).toHaveBeenCalledTimes(1);
    expect(docker.getContainerHealth).toHaveBeenCalledWith('ctr-a');
  });
});

describe('logs slice: other-list select-all', () => {
  it('select-all replaces the other-list selection without touching the EDT-members selection', () => {
    const store = createAppStore(fakeDeps());
    store.setState({ logsEdtSelected: ['/repo/edt'] });

    store.getState().selectAllLogsOtherServices(['/repo/a', '/repo/b']);

    expect(store.getState().logsOtherSelected).toEqual(['/repo/a', '/repo/b']);
    expect(store.getState().logsEdtSelected).toEqual(['/repo/edt']);
  });

  it('deselect-all clears only the other-list selection', () => {
    const store = createAppStore(fakeDeps());
    store.setState({ logsEdtSelected: ['/repo/edt'], logsOtherSelected: ['/repo/a'] });

    store.getState().deselectAllLogsOtherServices();

    expect(store.getState().logsOtherSelected).toEqual([]);
    expect(store.getState().logsEdtSelected).toEqual(['/repo/edt']);
  });
});

describe('logs slice: container-presence resolution', () => {
  function mixedManifest() {
    return {
      load: vi.fn(async (repoPath: string) => {
        if (repoPath === '/repo/gone') {
          return err('manifest-not-found', 'gone');
        }
        if (repoPath === '/repo/lib') {
          return ok({ service: 'lib', sharedBranch: 'development', modules: {} });
        }
        return ok({
          service: repoPath.split('/').pop() ?? repoPath,
          container: `ctr-${repoPath.split('/').pop()}`,
          sharedBranch: 'development',
          modules: {},
        });
      }),
    };
  }

  it('records true for a manifest without container, false with one, and leaves a failed load absent', async () => {
    const store = createAppStore(fakeDeps({ manifest: mixedManifest() }));

    store.getState().resolveLogsContainerPresence(['/repo/a', '/repo/lib', '/repo/gone']);
    await flush();

    expect(store.getState().logsNoContainer['/repo/a']).toBe(false);
    expect(store.getState().logsNoContainer['/repo/lib']).toBe(true);
    expect('/repo/gone' in store.getState().logsNoContainer).toBe(false);
  });

  it('caches answers — a repeat resolve reloads only the still-unknown row', async () => {
    const manifest = mixedManifest();
    const store = createAppStore(fakeDeps({ manifest }));

    store.getState().resolveLogsContainerPresence(['/repo/a', '/repo/gone']);
    await flush();
    expect(manifest.load).toHaveBeenCalledTimes(2);

    store.getState().resolveLogsContainerPresence(['/repo/a', '/repo/gone']);
    await flush();
    expect(manifest.load).toHaveBeenCalledTimes(3);
  });
});

describe('logs slice: listed-row health polling', () => {
  it('polls every listed row and reflects container health on logsListedHealth', async () => {
    const docker = fakeDocker();
    const store = createAppStore(fakeDeps({ docker, manifest: manifestWithContainer() }));

    store.getState().startLogsListedHealthPolling(['/repo/a']);
    await flush();

    expect(docker.getContainerHealth).toHaveBeenCalledWith('ctr-a');
    expect(store.getState().logsListedHealth['/repo/a']).toBe('up');
    store.getState().stopLogsListedHealthPolling();
  });

  it('a listed row without container records no-container (presence and health) and never reaches docker', async () => {
    const docker = fakeDocker();
    const store = createAppStore(fakeDeps({ docker, manifest: manifestWithoutContainer() }));

    store.getState().startLogsListedHealthPolling(['/repo/lib']);
    await flush();

    expect(store.getState().logsListedHealth['/repo/lib']).toBe('no-container');
    expect(store.getState().logsNoContainer['/repo/lib']).toBe(true);
    expect(docker.getContainerHealth).not.toHaveBeenCalled();
    expect(docker.streamLogs).not.toHaveBeenCalled();
    store.getState().stopLogsListedHealthPolling();
  });

  it('a manifest-load failure mid-poll keeps last-known health and never clears it', async () => {
    vi.useFakeTimers();
    try {
      const manifestLoad = vi.fn(async (repoPath: string) =>
        ok({
          service: `svc-${repoPath.split('/').pop()}`,
          container: `ctr-${repoPath.split('/').pop()}`,
          sharedBranch: 'development',
          modules: {},
        }),
      );
      const manifest: ManifestPort = { load: manifestLoad };
      const getContainerHealth = vi.fn(async () => ok('up' as const));
      const docker = fakeDocker();
      docker.getContainerHealth = getContainerHealth;
      const store = createAppStore(fakeDeps({ docker, manifest }));

      store.getState().startLogsListedHealthPolling(['/repo/a']);
      await vi.advanceTimersByTimeAsync(0);
      expect(store.getState().logsListedHealth['/repo/a']).toBe('up');

      manifestLoad.mockImplementation(async () => err('manifest-not-found', 'gone'));
      const callsBefore = getContainerHealth.mock.calls.length;
      await vi.advanceTimersByTimeAsync(LOGS_LISTED_HEALTH_POLL_INTERVAL_MS);
      await vi.advanceTimersByTimeAsync(0);

      expect(getContainerHealth.mock.calls.length).toBe(callsBefore);
      expect(store.getState().logsListedHealth['/repo/a']).toBe('up');
      store.getState().stopLogsListedHealthPolling();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a docker failure mid-poll keeps last-known health', async () => {
    vi.useFakeTimers();
    try {
      const getContainerHealth = vi.fn(async () => ok('up' as const));
      const docker = fakeDocker();
      docker.getContainerHealth = getContainerHealth;
      const store = createAppStore(fakeDeps({ docker, manifest: manifestWithContainer() }));

      store.getState().startLogsListedHealthPolling(['/repo/a']);
      await vi.advanceTimersByTimeAsync(0);
      expect(store.getState().logsListedHealth['/repo/a']).toBe('up');

      getContainerHealth.mockImplementation(async () => err('docker-unavailable', 'daemon down'));
      await vi.advanceTimersByTimeAsync(LOGS_LISTED_HEALTH_POLL_INTERVAL_MS);
      await vi.advanceTimersByTimeAsync(0);

      expect(store.getState().logsListedHealth['/repo/a']).toBe('up');
      store.getState().stopLogsListedHealthPolling();
    } finally {
      vi.useRealTimers();
    }
  });

  it('polls repeat on the interval, retarget on a new list, and stop entirely once stopped', async () => {
    vi.useFakeTimers();
    try {
      const getContainerHealth = vi.fn(async (_container: string) => ok('up' as const));
      const docker = fakeDocker();
      docker.getContainerHealth = getContainerHealth;
      const store = createAppStore(fakeDeps({ docker, manifest: manifestWithContainer() }));

      store.getState().startLogsListedHealthPolling(['/repo/a']);
      await vi.advanceTimersByTimeAsync(0);
      const afterStart = getContainerHealth.mock.calls.length;
      expect(afterStart).toBeGreaterThanOrEqual(1);

      await vi.advanceTimersByTimeAsync(LOGS_LISTED_HEALTH_POLL_INTERVAL_MS);
      expect(getContainerHealth.mock.calls.length).toBeGreaterThan(afterStart);

      store.getState().startLogsListedHealthPolling(['/repo/b']);
      await vi.advanceTimersByTimeAsync(0);
      expect(getContainerHealth).toHaveBeenCalledWith('ctr-b');
      const aCallsAfterRetarget = getContainerHealth.mock.calls.filter((call) => call[0] === 'ctr-a').length;
      await vi.advanceTimersByTimeAsync(LOGS_LISTED_HEALTH_POLL_INTERVAL_MS);
      await vi.advanceTimersByTimeAsync(0);
      expect(getContainerHealth.mock.calls.filter((call) => call[0] === 'ctr-a').length).toBe(aCallsAfterRetarget);

      const afterRetarget = getContainerHealth.mock.calls.length;
      store.getState().stopLogsListedHealthPolling();
      await vi.advanceTimersByTimeAsync(LOGS_LISTED_HEALTH_POLL_INTERVAL_MS * 4);

      expect(getContainerHealth.mock.calls.length).toBe(afterRetarget);
    } finally {
      vi.useRealTimers();
    }
  });

  it('retargeting prunes stale rows from both maps, and an empty list leaves no keys behind', async () => {
    const store = createAppStore(fakeDeps({ manifest: manifestWithContainer() }));

    store.getState().startLogsListedHealthPolling(['/repo/a']);
    await flush();
    expect(store.getState().logsListedHealth['/repo/a']).toBe('up');

    store.getState().startLogsListedHealthPolling(['/repo/b']);
    await flush();
    expect('/repo/a' in store.getState().logsListedHealth).toBe(false);
    expect('/repo/a' in store.getState().logsNoContainer).toBe(false);
    expect(store.getState().logsListedHealth['/repo/b']).toBe('up');

    store.getState().startLogsListedHealthPolling([]);
    await flush();
    expect(store.getState().logsListedHealth).toEqual({});
    expect(store.getState().logsNoContainer).toEqual({});
    store.getState().stopLogsListedHealthPolling();
  });

  it('a positively-resolved container-less row never reloads its manifest on later ticks', async () => {
    const manifestLoad = vi.fn(async (repoPath: string) =>
      ok({ service: repoPath.split('/').pop() ?? repoPath, sharedBranch: 'development', modules: {} }),
    );
    const manifest: ManifestPort = { load: manifestLoad };
    const store = createAppStore(fakeDeps({ manifest }));

    store.getState().resolveLogsContainerPresence(['/repo/lib']);
    await flush();
    expect(store.getState().logsNoContainer['/repo/lib']).toBe(true);
    const loadsAfterResolve = manifestLoad.mock.calls.length;

    store.getState().startLogsListedHealthPolling(['/repo/lib']);
    await flush();
    expect(manifestLoad.mock.calls.length).toBe(loadsAfterResolve);
    expect(store.getState().logsListedHealth['/repo/lib']).toBe('no-container');
    store.getState().stopLogsListedHealthPolling();
  });
});

describe('logs slice: health-first status', () => {
  function manifestWithHealth(container: boolean): ManifestPort {
    return {
      load: vi.fn(async (repoPath: string) =>
        ok({
          service: repoPath.split('/').pop() ?? repoPath,
          ...(container ? { container: `ctr-${repoPath.split('/').pop()}` } : {}),
          healthUrl: 'http://svc/health',
          sharedBranch: 'development',
          modules: {},
        }),
      ),
    };
  }

  it('a listed row whose container runs but whose route fails reads unhealthy', async () => {
    const probe = vi.fn(async () => ok({ healthy: false, status: 503, reason: 'HTTP 503' }));
    const store = createAppStore(fakeDeps({ manifest: manifestWithHealth(true), healthProbe: { probe } }));
    store.getState().startLogsListedHealthPolling(['/repo/a']);
    await flush();
    expect(probe).toHaveBeenCalledWith('http://svc/health', expect.any(Number));
    expect(store.getState().logsListedHealth['/repo/a']).toBe('unhealthy');
    store.getState().stopLogsListedHealthPolling();
  });

  it('a container-less row declaring a healthUrl gets a real up/down state', async () => {
    const docker = fakeDocker();
    const probe = vi.fn(async () => ok({ healthy: true, status: 200 }));
    const store = createAppStore(fakeDeps({ docker, manifest: manifestWithHealth(false), healthProbe: { probe } }));
    store.getState().resolveLogsContainerPresence(['/repo/lib']);
    await flush();
    store.getState().startLogsListedHealthPolling(['/repo/lib']);
    await flush();
    expect(store.getState().logsNoContainer['/repo/lib']).toBe(true);
    expect(store.getState().logsListedHealth['/repo/lib']).toBe('up');
    expect(docker.getContainerHealth).not.toHaveBeenCalled();
    store.getState().stopLogsListedHealthPolling();
  });

  it('skips a tick while the previous probe for that repo is still awaiting, keeping the last state', async () => {
    vi.useFakeTimers();
    try {
      let release: (() => void) | null = null;
      const probe = vi.fn(
        () =>
          new Promise<ReturnType<typeof ok<{ healthy: boolean }>>>((resolve) => {
            release = () => resolve(ok({ healthy: true }));
          }),
      );
      const store = createAppStore(fakeDeps({ manifest: manifestWithHealth(true), healthProbe: { probe } }));
      store.setState({ logsListedHealth: { '/repo/a': 'down' } });
      store.getState().startLogsListedHealthPolling(['/repo/a']);
      await vi.advanceTimersByTimeAsync(0);
      expect(probe).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(LOGS_LISTED_HEALTH_POLL_INTERVAL_MS * 2);
      expect(probe).toHaveBeenCalledTimes(1);
      expect(store.getState().logsListedHealth['/repo/a']).toBe('down');

      release!();
      await vi.advanceTimersByTimeAsync(0);
      expect(store.getState().logsListedHealth['/repo/a']).toBe('up');
      await vi.advanceTimersByTimeAsync(LOGS_LISTED_HEALTH_POLL_INTERVAL_MS);
      expect(probe).toHaveBeenCalledTimes(2);
      store.getState().stopLogsListedHealthPolling();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a pane poll is guarded per repo too', async () => {
    vi.useFakeTimers();
    try {
      const probe = vi.fn(() => new Promise<never>(() => {}));
      const store = createAppStore(fakeDeps({ manifest: manifestWithHealth(true), healthProbe: { probe } }));
      await store.getState().subscribeLogsPane('/repo/a', 'a');
      await vi.advanceTimersByTimeAsync(0);
      expect(probe).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(LOGS_HEALTH_POLL_INTERVAL_MS * 3);
      expect(probe).toHaveBeenCalledTimes(1);
      expect(store.getState().logsPanes['/repo/a']?.health).toBe('down');
      store.getState().stopAllLogsPanes();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a container-less pane declaring a healthUrl polls a real up/down and keeps its timer', async () => {
    vi.useFakeTimers();
    try {
      const docker = fakeDocker();
      let healthy = true;
      const probe = vi.fn(async () => ok(healthy ? { healthy: true } : { healthy: false, reason: 'timeout' }));
      const store = createAppStore(fakeDeps({ docker, manifest: manifestWithHealth(false), healthProbe: { probe } }));
      await store.getState().subscribeLogsPane('/repo/lib', 'lib');
      await vi.advanceTimersByTimeAsync(0);
      expect(store.getState().logsPanes['/repo/lib']).toMatchObject({ health: 'up', noContainer: true });

      healthy = false;
      await vi.advanceTimersByTimeAsync(LOGS_HEALTH_POLL_INTERVAL_MS);
      expect(store.getState().logsPanes['/repo/lib']?.health).toBe('down');
      expect(docker.getContainerHealth).not.toHaveBeenCalled();
      expect(docker.streamLogs).not.toHaveBeenCalled();

      // Container-less: R stays a no-op whatever the status.
      await store.getState().restartLogsPane('/repo/lib');
      expect(store.getState().logsPanes['/repo/lib']?.streamError).toBeNull();
      store.getState().stopAllLogsPanes();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a listed row whose health check is disabled reads its container state without probing', async () => {
    const probe = vi.fn(async () => ok({ healthy: false, status: 503, reason: 'HTTP 503' }));
    const store = createAppStore(fakeDeps({ manifest: manifestWithHealth(true), healthProbe: { probe } }));
    store.setState((state) => ({ settings: { ...state.settings, services: { healthCheckDisabled: ['a'] } } }));
    store.getState().startLogsListedHealthPolling(['/repo/a']);
    await flush();
    expect(store.getState().logsListedHealth['/repo/a']).toBe('up');
    expect(probe).not.toHaveBeenCalled();
    store.getState().stopLogsListedHealthPolling();
  });

  it('a disabled container-less pane reads no-container, and re-enabling probes it at the next poll', async () => {
    vi.useFakeTimers();
    try {
      const probe = vi.fn(async () => ok({ healthy: true }));
      const store = createAppStore(fakeDeps({ docker: fakeDocker(), manifest: manifestWithHealth(false), healthProbe: { probe } }));
      store.setState((state) => ({ settings: { ...state.settings, services: { healthCheckDisabled: ['lib'] } } }));
      await store.getState().subscribeLogsPane('/repo/lib', 'lib');
      await vi.advanceTimersByTimeAsync(0);
      expect(store.getState().logsPanes['/repo/lib']).toMatchObject({ health: 'no-container', noContainer: true });
      expect(probe).not.toHaveBeenCalled();

      store.setState((state) => ({ settings: { ...state.settings, services: { healthCheckDisabled: [] } } }));
      await vi.advanceTimersByTimeAsync(LOGS_HEALTH_POLL_INTERVAL_MS);
      expect(store.getState().logsPanes['/repo/lib']?.health).toBe('up');
      expect(probe).toHaveBeenCalled();
      store.getState().stopAllLogsPanes();
    } finally {
      vi.useRealTimers();
    }
  });

  it('releases the listed-row guard after a rejected poll, so the next tick polls again', async () => {
    vi.useFakeTimers();
    try {
      const load = vi.fn(async (): Promise<never> => {
        throw new Error('io');
      });
      const store = createAppStore(fakeDeps({ manifest: { load } }));
      store.getState().startLogsListedHealthPolling(['/repo/a']);
      await vi.advanceTimersByTimeAsync(0);
      expect(load).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(LOGS_LISTED_HEALTH_POLL_INTERVAL_MS);
      expect(load).toHaveBeenCalledTimes(2);
      store.getState().stopLogsListedHealthPolling();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a listed poll settling after stop writes nothing, and a restarted poll is not blocked by it', async () => {
    vi.useFakeTimers();
    try {
      const releases: Array<() => void> = [];
      const probe = vi.fn(
        () =>
          new Promise<ReturnType<typeof ok<{ healthy: boolean }>>>((resolve) => {
            releases.push(() => resolve(ok({ healthy: true })));
          }),
      );
      const store = createAppStore(fakeDeps({ manifest: manifestWithHealth(true), healthProbe: { probe } }));
      store.getState().startLogsListedHealthPolling(['/repo/a']);
      await vi.advanceTimersByTimeAsync(0);
      store.getState().stopLogsListedHealthPolling();

      store.getState().startLogsListedHealthPolling(['/repo/a']);
      await vi.advanceTimersByTimeAsync(0);
      expect(probe).toHaveBeenCalledTimes(2);

      store.setState({ logsListedHealth: { '/repo/a': 'down' } });
      releases[0]!();
      await vi.advanceTimersByTimeAsync(0);
      // The stale poll neither wrote nor freed the live poll's entry.
      expect(store.getState().logsListedHealth['/repo/a']).toBe('down');
      await vi.advanceTimersByTimeAsync(LOGS_LISTED_HEALTH_POLL_INTERVAL_MS);
      expect(probe).toHaveBeenCalledTimes(2);

      releases[1]!();
      await vi.advanceTimersByTimeAsync(0);
      expect(store.getState().logsListedHealth['/repo/a']).toBe('up');
      store.getState().stopLogsListedHealthPolling();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a pane poll settling after the pane stopped writes nothing', async () => {
    vi.useFakeTimers();
    try {
      const releases: Array<() => void> = [];
      const probe = vi.fn(
        () =>
          new Promise<ReturnType<typeof ok<{ healthy: boolean }>>>((resolve) => {
            releases.push(() => resolve(ok({ healthy: true })));
          }),
      );
      const store = createAppStore(fakeDeps({ manifest: manifestWithHealth(true), healthProbe: { probe } }));
      await store.getState().subscribeLogsPane('/repo/a', 'a');
      await vi.advanceTimersByTimeAsync(0);
      store.getState().unsubscribeLogsPane('/repo/a');
      await store.getState().subscribeLogsPane('/repo/a', 'a');
      await vi.advanceTimersByTimeAsync(0);
      expect(probe).toHaveBeenCalledTimes(2);
      store.setState((state) => ({ logsPanes: { ...state.logsPanes, '/repo/a': { ...state.logsPanes['/repo/a']!, health: 'unhealthy' } } }));
      releases[0]!();
      await vi.advanceTimersByTimeAsync(0);
      expect(store.getState().logsPanes['/repo/a']?.health).toBe('unhealthy');
      releases[1]!();
      await vi.advanceTimersByTimeAsync(0);
      expect(store.getState().logsPanes['/repo/a']?.health).toBe('up');
      store.getState().stopAllLogsPanes();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('logs display settings (session-only)', () => {
  const spec = { mode: 'text' as const, query: 'boom', level: null };

  function seed() {
    const store = createAppStore();
    const s = store.getState();
    s.toggleLogsEdtSelection('/repo/api');
    s.toggleLogsEdtSelection('/repo/web');
    s.setLogsVisibility((current) => ({ ...current, showTimestamps: false }));
    s.setLogsGlobalFilter(spec);
    s.setLogsPaneWrap(() => ({ '/repo/api': true, '/repo/web': true }));
    s.setLogsPaneFilterEngaged(() => ({ '/repo/api': false }));
    s.setLogsPaneFilters(() => ({ '/repo/api': spec, '/repo/web': spec }));
    return store;
  }

  it('deselecting a service drops its own settings but keeps the global ones and other services', () => {
    const store = seed();
    store.getState().toggleLogsEdtSelection('/repo/api');
    const state = store.getState();
    expect(state.logsPaneWrap).toEqual({ '/repo/web': true });
    expect(state.logsPaneFilterEngaged).toEqual({});
    expect(state.logsPaneFilters).toEqual({ '/repo/web': spec });
    expect(state.logsVisibility.showTimestamps).toBe(false);
    expect(state.logsGlobalFilter).toEqual(spec);
  });

  it('deselect-all and select-all drop the settings of every service that leaves the selection', () => {
    const store = seed();
    store.getState().selectAllLogsEdtServices(['/repo/web']);
    expect(Object.keys(store.getState().logsPaneFilters)).toEqual(['/repo/web']);
    store.getState().deselectAllLogsEdtServices();
    expect(store.getState().logsPaneFilters).toEqual({});
    expect(store.getState().logsPaneWrap).toEqual({});
    expect(store.getState().logsVisibility.showTimestamps).toBe(false);
  });

  it('closing an ad hoc fullscreen preview of an unselected service drops its settings', () => {
    const store = seed();
    store.getState().setLogsPaneWrap((current) => ({ ...current, '/repo/lib': true }));
    store.getState().openLogsFullscreen('/repo/lib', 'lib');
    store.getState().closeLogsFullscreen();
    expect(store.getState().logsPaneWrap['/repo/lib']).toBeUndefined();
    store.getState().openLogsFullscreen('/repo/web', 'web');
    store.getState().closeLogsFullscreen();
    expect(store.getState().logsPaneWrap['/repo/web']).toBe(true);
  });
});
