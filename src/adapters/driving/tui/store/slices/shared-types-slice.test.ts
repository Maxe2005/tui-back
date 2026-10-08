// The shared-types slice wires listConsumers/propagateVersion in-process (their behaviour is
// covered in core), so these verify the wiring: loading, blocked runs, run tracking, retry.
import { describe, expect, it, vi } from 'vitest';
import { err, ok } from '../../../../../core/result.js';
import { createAppStore, type AppStoreDeps } from '../app-store.js';

const MODULE = 'consumer-module';

function makeDeps(overrides: { published?: boolean; installFails?: boolean } = {}) {
  const written = new Set<string>();
  const git = {
    currentBranch: vi.fn(async () => ok('feat/x')),
    assertAllowedBranch: vi.fn(async () => ok(undefined)),
    listDirtyPaths: vi.fn(async (repoPath: string) => ok(written.has(repoPath) ? ['package.json'] : [])),
    stagePaths: vi.fn(async () => ok(undefined)),
    commit: vi.fn(async () => ok(undefined)),
  };
  const restart = {
    run: vi.fn(async () => (overrides.installFails === true ? err('restart-failed', 'npm ERR') : ok({ output: '' }))),
  };
  const port = {
    readVersion: vi.fn(),
    writeVersionLine: vi.fn(async (path: string) => {
      written.add(path.replace('/package.json', ''));
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

  it('keeps the other services\' results and turns the retried one done when the retry succeeds', async () => {
    const { deps } = makeDeps();
    const members = [
      { service: 'api', repoPath: '/r/api', branch: 'feat/x' },
      { service: 'web', repoPath: '/r/web', branch: 'feat/x' },
    ];
    (deps.edtRegistry.list as ReturnType<typeof vi.fn>).mockResolvedValue(
      ok([{ ulid: 'E1', topic: 't', createdAt: '', status: 'active', members }]),
    );
    let failWeb = true;
    (deps.restart!.run as ReturnType<typeof vi.fn>).mockImplementation(async (repoPath: string) =>
      repoPath === '/r/web' && failWeb ? err('restart-failed', 'npm ERR') : ok({ output: '' }),
    );
    const store = createAppStore(deps);
    await store.getState().loadSharedTypesConsumers();
    await store.getState().runSharedTypesPropagation({ version: '0.1.9', repoPaths: ['/r/api', '/r/web'], options: OPTIONS });
    expect(store.getState().sharedTypesRun.results.map((r) => r.outcome)).toEqual(['done', 'failed']);

    failWeb = false;
    await store.getState().retrySharedTypesService('/r/web');

    const run = store.getState().sharedTypesRun;
    expect(run.status).toBe('done');
    expect(run.results.map((r) => [r.repoPath, r.outcome])).toEqual([
      ['/r/api', 'done'],
      ['/r/web', 'done'],
    ]);
  });

  it('keeps the previous results and restores done with a notice when a retry is blocked', async () => {
    const { deps, port } = makeDeps({ installFails: true });
    const store = createAppStore(deps);
    await store.getState().loadSharedTypesConsumers();
    await store.getState().runSharedTypesPropagation({ version: '0.1.9', repoPaths: ['/r/api'], options: OPTIONS });
    port.verifyPublished.mockResolvedValue(err('registry-unreachable', 'down'));

    await store.getState().retrySharedTypesService('/r/api');

    const run = store.getState().sharedTypesRun;
    expect(run.status).toBe('done');
    expect(run.results[0]).toMatchObject({ outcome: 'failed' });
    expect(run.notice).toContain('Registry unreachable');
  });
});
