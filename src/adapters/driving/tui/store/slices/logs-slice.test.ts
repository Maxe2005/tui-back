// tui/store/slices/logs-slice: unit tests for the Logs zone's pane lifecycle — the slice
// calls core/logs use-cases against fake ports, so these verify the container-less guards
// (no subscribe, no poll, no restart, no history fetch) rather than re-testing the manager.
import { describe, expect, it, vi } from 'vitest';
import { err, ok } from '../../../../../core/result.js';
import type { DockerPort } from '../../../../../core/ports/docker.js';
import type { ManifestPort } from '../../../../../core/ports/manifest.js';
import type { StatePort } from '../../../../../core/ports/state.js';
import { createAppStore, type AppStoreDeps } from '../app-store.js';
import { LOGS_LISTED_HEALTH_POLL_INTERVAL_MS } from './logs-slice.js';

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
      finalizeMerge: vi.fn(async () => ok(undefined)),
      listBranches: vi.fn(async () => ok([])),
      renameBranch: vi.fn(async () => ok(undefined)),
      listRemoteBranches: vi.fn(async () => ok([])),
      createTrackingBranch: vi.fn(async () => ok(undefined)),
      isBranchMerged: vi.fn(async () => ok(true)),
      hasStash: vi.fn(async () => ok(false)),
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
