// The publish side of the shared-types slice: source wiring, single-execution publish,
// already-published re-trigger without re-run, guard notices and distinct errors.
import { describe, expect, it, vi } from 'vitest';
import { err, ok } from '../../../../../core/result.js';
import { createAppStore, type AppStoreDeps } from '../app-store.js';

const CONSUMER = 'consumer-module';
const SOURCE = 'source-module';

function makeDeps(overrides: { published?: boolean; runFails?: boolean; members?: { service: string; repoPath: string }[] } = {}) {
  const git = {
    currentBranch: vi.fn(async () => ok('feat/x')),
    assertAllowedBranch: vi.fn(async () => ok(undefined)),
  };
  const restart = {
    run: vi.fn(async () => (overrides.runFails === true ? err('restart-failed', 'npm ERR boom') : ok({ output: 'ok' }))),
  };
  const port = {
    readVersion: vi.fn(async () => ok('0.1.0')),
    readOwnVersion: vi.fn(async () => ok('0.1.3674')),
    writeVersionLine: vi.fn(async () => ok(undefined)),
    verifyPublished: vi.fn(async () => ok(overrides.published ?? true)),
  };
  const members = overrides.members ?? [{ service: 'source', repoPath: '/r/source' }];
  const deps = {
    git,
    restart,
    container: {},
    manifest: {
      load: vi.fn(async (repoPath: string) => {
        if (repoPath === '/r/source') {
          return ok({ service: 'source', sharedBranch: 'development', modules: { [SOURCE]: { publishCommand: 'npm run v', packageName: '@ianord/shared-types' } } });
        }
        return ok({ service: 'other', sharedBranch: 'development', modules: {} });
      }),
    },
    state: { readActiveEdt: vi.fn(async () => ok('E1')) },
    edtRegistry: {
      list: vi.fn(async () => ok([{ ulid: 'E1', topic: 't', createdAt: '', status: 'active', members: members.map((member) => ({ ...member, branch: 'feat/x' })) }])),
    },
    sharedTypes: {
      port,
      consumerModuleId: CONSUMER,
      parseConsumerConfig: () => ok({ dependency: '@ianord/shared-types', packageJsonPath: 'package.json' }),
      sourceModuleId: SOURCE,
      parseSourceConfig: () => ok({ publishCommand: 'npm run v', packageName: '@ianord/shared-types' }),
    },
  } as unknown as AppStoreDeps;
  return { deps, port, restart };
}

describe('shared-types publish', () => {
  it('loads a single source and publishes with exactly one execution', async () => {
    const { deps, restart } = makeDeps();
    const store = createAppStore(deps);
    await store.getState().loadSharedTypesSource();
    expect(store.getState().sharedTypesSourcesStatus).toBe('ready');
    expect(store.getState().sharedTypesSources.map((entry) => entry.service)).toEqual(['source']);

    await store.getState().runSharedTypesPublish();
    expect(store.getState().sharedTypesPublish).toMatchObject({ status: 'done', version: '0.1.3674' });
    expect(restart.run).toHaveBeenCalledTimes(1);
    expect(store.getState().runInProgress).toBe(false);
  });

  it('blocks with ambiguous-source when several sources share the active EDT', async () => {
    const { deps, restart } = makeDeps({ members: [{ service: 'a', repoPath: '/r/a' }, { service: 'b', repoPath: '/r/b' }] });
    (deps.manifest.load as ReturnType<typeof vi.fn>).mockImplementation(async (repoPath: string) =>
      ok({ service: repoPath.slice(3), sharedBranch: 'development', modules: { [SOURCE]: { publishCommand: 'npm run v', packageName: '@ianord/shared-types' } } }),
    );
    const store = createAppStore(deps);
    await store.getState().loadSharedTypesSource();
    expect(store.getState().sharedTypesSourcesError).toMatchObject({ code: 'ambiguous-source' });

    await store.getState().runSharedTypesPublish();
    expect(store.getState().sharedTypesPublish.error).toMatchObject({ code: 'ambiguous-source' });
    expect(restart.run).not.toHaveBeenCalled();
  });

  it('reports publish-failed without naming a sub-step', async () => {
    const { deps } = makeDeps({ published: true, runFails: true });
    const store = createAppStore(deps);
    await store.getState().runSharedTypesPublish();
    expect(store.getState().sharedTypesPublish).toMatchObject({ status: 'blocked', error: { code: 'publish-failed' } });
  });

  it('does not mark published when the version is absent from the registry', async () => {
    const { deps, restart, port } = makeDeps({ published: false });
    (port.verifyPublished as ReturnType<typeof vi.fn>).mockResolvedValue(ok(false));
    const store = createAppStore(deps);
    await store.getState().runSharedTypesPublish();
    expect(store.getState().sharedTypesPublish.error).toMatchObject({ code: 'version-not-published' });
    expect(restart.run).toHaveBeenCalledTimes(1);
  });

  it('detects an already-published version on retry without re-running the command', async () => {
    const { deps, restart, port } = makeDeps({ runFails: true });
    const store = createAppStore(deps);
    await store.getState().runSharedTypesPublish();
    expect(store.getState().sharedTypesPublish.status).toBe('blocked');
    expect(restart.run).toHaveBeenCalledTimes(1);

    port.verifyPublished.mockResolvedValue(ok(true));
    port.readOwnVersion.mockResolvedValue(ok('0.1.3674'));
    await store.getState().retrySharedTypesPublish();
    expect(store.getState().sharedTypesPublish).toMatchObject({ status: 'done', version: '0.1.3674' });
    expect(restart.run).toHaveBeenCalledTimes(1);
  });

  it('surfaces a visible notice when a run is already in progress, never a silent no-op', async () => {
    const { deps } = makeDeps();
    const store = createAppStore(deps);
    store.setState({ runInProgress: true });
    await store.getState().runSharedTypesPublish();
    expect(store.getState().sharedTypesPublish.notice).toContain('already in progress');
  });

  it('retry whose pre-check verify fails blocks with that code without re-running', async () => {
    const { deps, restart, port } = makeDeps({ runFails: true });
    const store = createAppStore(deps);
    await store.getState().runSharedTypesPublish();
    expect(store.getState().sharedTypesPublish.status).toBe('blocked');
    expect(restart.run).toHaveBeenCalledTimes(1);

    (port.verifyPublished as ReturnType<typeof vi.fn>).mockResolvedValue(err('registry-unreachable', 'down'));
    await store.getState().retrySharedTypesPublish();
    expect(store.getState().sharedTypesPublish).toMatchObject({ status: 'blocked', error: { code: 'registry-unreachable' } });
    expect(restart.run).toHaveBeenCalledTimes(1);
  });

  it('retry whose pre-check readOwnVersion fails blocks with that code without re-running', async () => {
    const { deps, restart, port } = makeDeps({ runFails: true });
    const store = createAppStore(deps);
    await store.getState().runSharedTypesPublish();
    expect(restart.run).toHaveBeenCalledTimes(1);

    (port.readOwnVersion as ReturnType<typeof vi.fn>).mockResolvedValue(err('package-json-unreadable', 'gone'));
    await store.getState().retrySharedTypesPublish();
    expect(store.getState().sharedTypesPublish).toMatchObject({ status: 'blocked', error: { code: 'package-json-unreadable' } });
    expect(restart.run).toHaveBeenCalledTimes(1);
  });

  it('a failing manifest load surfaces its code on source load and blocks publish without running', async () => {
    const { deps, restart } = makeDeps();
    (deps.manifest.load as ReturnType<typeof vi.fn>).mockResolvedValue(err('manifest-not-found', 'gone'));
    const store = createAppStore(deps);
    await store.getState().loadSharedTypesSource();
    expect(store.getState().sharedTypesSourcesStatus).toBe('error');
    expect(store.getState().sharedTypesSourcesError).toMatchObject({ code: 'manifest-not-found' });

    await store.getState().runSharedTypesPublish();
    expect(store.getState().sharedTypesPublish).toMatchObject({ status: 'blocked', error: { code: 'manifest-not-found' } });
    expect(restart.run).not.toHaveBeenCalled();
  });

  it('a failing active-EDT read surfaces its code on retry without running', async () => {
    const { deps, restart } = makeDeps();
    const store = createAppStore(deps);
    (deps.state.readActiveEdt as ReturnType<typeof vi.fn>).mockResolvedValue(err('state-read-error', 'bad'));
    await store.getState().loadSharedTypesSource();
    expect(store.getState().sharedTypesSourcesError).toMatchObject({ code: 'state-read-error' });

    await store.getState().retrySharedTypesPublish();
    expect(store.getState().sharedTypesPublish).toMatchObject({ status: 'blocked', error: { code: 'state-read-error' } });
    expect(restart.run).not.toHaveBeenCalled();
  });

  it('clears stale errors on the next attempt', async () => {
    const { deps, restart } = makeDeps({ runFails: true });
    const store = createAppStore(deps);
    await store.getState().runSharedTypesPublish();
    expect(store.getState().sharedTypesPublish.error).toMatchObject({ code: 'publish-failed' });

    (restart.run as ReturnType<typeof vi.fn>).mockResolvedValue(ok({ output: 'ok' }));
    await store.getState().runSharedTypesPublish();
    expect(store.getState().sharedTypesPublish).toMatchObject({ status: 'done', error: null });
  });
});
