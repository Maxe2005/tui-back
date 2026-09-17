// tui/store/slices/update-slice: unit tests for the Update zone's run state — the slice
// calls the real core/scripts/group-update.ts use-case against fake ports (AD-2
// in-process), so these verify the wiring (status transitions, runInProgress guard,
// interrupted marking + edts refresh) rather than re-testing the use-case matrix.
import { describe, expect, it, vi } from 'vitest';
import { ok, err } from '../../../../../core/result.js';
import type { ContainerPort } from '../../../../../core/ports/container.js';
import type { EdtRegistryPort } from '../../../../../core/ports/edt-registry.js';
import type { GitPort } from '../../../../../core/ports/git.js';
import type { LockPort } from '../../../../../core/ports/lock.js';
import type { ManifestPort } from '../../../../../core/ports/manifest.js';
import type { RegistryPort } from '../../../../../core/ports/registry.js';
import type { SettingsPort } from '../../../../../core/ports/settings.js';
import type { StatePort } from '../../../../../core/ports/state.js';
import { DEFAULT_SETTINGS } from '../../../../../core/ports/settings.js';
import { createAppStore, type AppStoreDeps } from '../app-store.js';

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
    listBranches: vi.fn(async () => ok([])),
    renameBranch: vi.fn(async () => ok(undefined)),
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
  };
  const state: StatePort = {
    readActiveEdt: vi.fn(async () => ok('edt-1')),
    writeActiveEdt: vi.fn(async () => ok(undefined)),
    readSplitterRatios: vi.fn(async () => ok(null)),
    writeSplitterRatios: vi.fn(async () => ok(undefined)),
  };
  const lock: LockPort = {
    acquire: vi.fn(async () => ok({ release: vi.fn(async () => ok(undefined)) })),
    peek: vi.fn(async () => ok({ locked: false })),
  };
  const container: ContainerPort = {
    restart: vi.fn(async () => ok(undefined)),
  };
  const settings: SettingsPort = {
    load: vi.fn(async () => ok({ settings: DEFAULT_SETTINGS, warning: null })),
    save: vi.fn(async () => ok(undefined)),
  };
  return {
    registry,
    manifest,
    git,
    container,
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
  it('starts idle with no results, note, or error', () => {
    const store = createAppStore(fakeDeps());

    expect(store.getState().updateStatus).toBe('idle');
    expect(store.getState().updateResults).toEqual([]);
    expect(store.getState().updateNote).toBeNull();
    expect(store.getState().updateError).toBeNull();
    expect(store.getState().updateUlid).toBeNull();
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

  it('runGroupUpdate surfaces a top-level use-case failure as error with its code', async () => {
    const state: StatePort = {
      readActiveEdt: vi.fn(async () => ok(null)),
      writeActiveEdt: vi.fn(async () => ok(undefined)),
      readSplitterRatios: vi.fn(async () => ok(null)),
      writeSplitterRatios: vi.fn(async () => ok(undefined)),
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
    store.getState().clearUpdate();

    expect(store.getState().updateStatus).toBe('idle');
    expect(store.getState().updateResults).toEqual([]);
    expect(store.getState().updateNote).toBeNull();
    expect(store.getState().updateTopic).toBeNull();
    expect(store.getState().updateError).toBeNull();
    expect(store.getState().updateUlid).toBeNull();
  });
});
