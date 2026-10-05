// tui/store/slices/logs-slice: unit tests for the Logs zone's pane lifecycle — the slice
// calls core/logs use-cases against fake ports, so these verify the container-less guards
// (no subscribe, no poll, no restart, no history fetch) rather than re-testing the manager.
import { describe, expect, it, vi } from 'vitest';
import { ok } from '../../../../../core/result.js';
import type { DockerPort } from '../../../../../core/ports/docker.js';
import type { ManifestPort } from '../../../../../core/ports/manifest.js';
import type { StatePort } from '../../../../../core/ports/state.js';
import { createAppStore, type AppStoreDeps } from '../app-store.js';

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
