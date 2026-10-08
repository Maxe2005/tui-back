// The shared-types slice wires listConsumers/propagateVersion in-process (their behaviour is
// covered in core), so these verify the wiring: loading, blocked runs, run tracking, retry.
import { describe, expect, it, vi } from 'vitest';
import { err, ok } from '../../../../../core/result.js';
import { createAppStore, type AppStoreDeps } from '../app-store.js';

const MODULE = 'consumer-module';

function makeDeps(overrides: { published?: boolean; installFails?: boolean } = {}) {
  let written = false;
  const git = {
    currentBranch: vi.fn(async () => ok('feat/x')),
    assertAllowedBranch: vi.fn(async () => ok(undefined)),
    listDirtyPaths: vi.fn(async () => ok(written ? ['package.json'] : [])),
    stagePaths: vi.fn(async () => ok(undefined)),
    commit: vi.fn(async () => ok(undefined)),
  };
  const restart = {
    run: vi.fn(async () => (overrides.installFails === true ? err('restart-failed', 'npm ERR') : ok({ output: '' }))),
  };
  const port = {
    readVersion: vi.fn(),
    writeVersionLine: vi.fn(async () => {
      written = true;
      return ok(undefined);
    }),
    verifyPublished: vi.fn(async () => ok(overrides.published ?? true)),
  };
  const deps = {
    git,
    restart,
    container: {},
    manifest: { load: vi.fn(async () => ok({ service: 'api', sharedBranch: 'development', modules: { [MODULE]: {} } })) },
    state: { readActiveEdt: vi.fn(async () => ok('E1')) },
    edtRegistry: {
      list: vi.fn(async () =>
        ok([{ ulid: 'E1', topic: 't', createdAt: '', status: 'active', members: [{ service: 'api', repoPath: '/r/api', branch: 'feat/x' }] }]),
      ),
    },
    sharedTypes: {
      port,
      consumerModuleId: MODULE,
      parseConsumerConfig: () => ok({ dependency: '@ianord/shared-types', packageJsonPath: 'package.json' }),
    },
  } as unknown as AppStoreDeps;
  return { deps, port, git };
}

const OPTIONS = { install: true, cleanRestart: false, commit: false };

describe('shared-types slice', () => {
  it('degrades to an explicit error without wiring', async () => {
    const store = createAppStore();
    await store.getState().loadSharedTypesConsumers();
    expect(store.getState().sharedTypesConsumersStatus).toBe('error');
  });

  it('loads the active EDT consumers', async () => {
    const store = createAppStore(makeDeps().deps);
    await store.getState().loadSharedTypesConsumers();
    expect(store.getState().sharedTypesConsumersStatus).toBe('ready');
    expect(store.getState().sharedTypesConsumers.map((consumer) => consumer.service)).toEqual(['api']);
  });

  it('blocks an unpublished version without writing and clears runInProgress', async () => {
    const { deps, port } = makeDeps({ published: false });
    const store = createAppStore(deps);
    await store.getState().loadSharedTypesConsumers();
    await store.getState().runSharedTypesPropagation({ version: '0.1.9', repoPaths: ['/r/api'], options: OPTIONS });
    expect(store.getState().sharedTypesRun).toMatchObject({ status: 'blocked', blocked: { code: 'version-not-published' } });
    expect(port.writeVersionLine).not.toHaveBeenCalled();
    expect(store.getState().runInProgress).toBe(false);
  });

  it('records per-service results and retries a failed service resuming at the failed step', async () => {
    const { deps, port } = makeDeps({ installFails: true });
    const store = createAppStore(deps);
    await store.getState().loadSharedTypesConsumers();
    await store.getState().runSharedTypesPropagation({ version: '0.1.9', repoPaths: ['/r/api'], options: OPTIONS });
    expect(store.getState().sharedTypesRun.results[0]).toMatchObject({ outcome: 'failed', failedStep: 'install' });

    await store.getState().retrySharedTypesService('/r/api');
    expect(port.writeVersionLine).toHaveBeenCalledTimes(1);
    expect(store.getState().sharedTypesRun.results[0]).toMatchObject({ outcome: 'failed', failedStep: 'install' });
  });
});
