import { describe, expect, it, vi } from 'vitest';
import { ok, err } from '../../../../../core/result.js';
import type { ContainerPort } from '../../../../../core/ports/container.js';
import type { EdtRegistryPort } from '../../../../../core/ports/edt-registry.js';
import type { GitPort } from '../../../../../core/ports/git.js';
import type { LockPort } from '../../../../../core/ports/lock.js';
import type { ManifestPort } from '../../../../../core/ports/manifest.js';
import type { RestartPort } from '../../../../../core/ports/restart.js';
import type { RegistryPort } from '../../../../../core/ports/registry.js';
import type { StatePort } from '../../../../../core/ports/state.js';
import { createAppStore } from '../app-store.js';
import { fakeDeps } from './update/update-slice.test-support.js';

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
      sharedTypes: 'off',
      sharedTypesSource: null,
    });
    // Opening the screen runs no git/docker action and starts no run.
    expect(store.getState().updateStatus).toBe('idle');
  });

  it('openUpdateConfig seeds the run-wide globals from settings.update and never writes them back', async () => {
    const deps = fakeDeps();
    const store = createAppStore(deps);
    const savesBefore = vi.mocked(deps.settings!.save).mock.calls.length;
    store.setState({
      settings: { ...store.getState().settings, update: { concurrency: 3, runMigrations: false, cleanRestart: true, mergeSource: 'edt-pending' as const } },
    });

    await store.getState().openUpdateConfig('edt');

    const draft = store.getState().updateConfig;
    expect(draft).toMatchObject({ runMigrations: false, cleanRestart: true, strategy: { kind: 'edt-pending' } });
    expect(draft?.rows.every((row) => row.migrations === 'follow' && row.cleanRestart === 'follow')).toBe(true);

    // The all-repos screen has no merge-source line: it opens on shared regardless.
    await store.getState().openUpdateConfig('all');
    expect(store.getState().updateConfig).toMatchObject({ runMigrations: false, cleanRestart: true, strategy: { kind: 'shared' } });

    // Per-run edits stay in the draft: settings in the store and on disk are untouched.
    expect(store.getState().settings.update.runMigrations).toBe(false);
    expect(vi.mocked(deps.settings!.save).mock.calls.length).toBe(savesBefore);
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
      readLogRules: vi.fn(async () => ok(null)),
      writeLogRules: vi.fn(async () => ok(undefined)),
      readLogRuleSets: vi.fn(async () => ok(null)),
      writeLogRuleSets: vi.fn(async () => ok(undefined)),
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
      readLogRules: vi.fn(async () => ok(null)),
      writeLogRules: vi.fn(async () => ok(undefined)),
      readLogRuleSets: vi.fn(async () => ok(null)),
      writeLogRuleSets: vi.fn(async () => ok(undefined)),
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
      readLogRules: vi.fn(async () => ok(null)),
      writeLogRules: vi.fn(async () => ok(undefined)),
      readLogRuleSets: vi.fn(async () => ok(null)),
      writeLogRuleSets: vi.fn(async () => ok(undefined)),
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
      sharedTypes: 'off',
      sharedTypesSource: null,
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
