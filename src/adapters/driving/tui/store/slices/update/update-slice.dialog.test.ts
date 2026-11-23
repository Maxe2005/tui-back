import { describe, expect, it, vi } from 'vitest';
import { ok, err, type Result } from '../../../../../../core/result.js';
import { toggleMergeSource } from '../../../zones/update/config/update-config-panels.logic.js';
import type { RegistryPort } from '../../../../../../core/ports/registry.js';
import { createAppStore } from '../../app-store.js';
import { parseUpdateServiceArg } from './update-slice.js';
import { MEMBERS, fakeDeps } from './update-slice.test-support.js';

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
