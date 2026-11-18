// tui/store/slices/update-slice: unit tests for the Update zone's run state — the slice
// calls the real core/scripts/group-update.ts use-case against fake ports (AD-2
// in-process), so these verify the wiring (status transitions, runInProgress guard,
// interrupted marking + edts refresh) rather than re-testing the use-case matrix.
import { describe, expect, it, vi } from 'vitest';
import { ok, err } from '../../../../../core/result.js';
import type { GitPort } from '../../../../../core/ports/git.js';
import type { ManifestPort } from '../../../../../core/ports/manifest.js';
import type { RestartPort } from '../../../../../core/ports/restart.js';
import { createAppStore, type AppStoreDeps } from '../app-store.js';
import { fakeDeps } from './update-slice.test-support.js';

describe('update slice: smart group update (shared-types first)', () => {
  // svc-a (/repo/a) is the single source, svc-b (/repo/b) its consumer.
  function smartDeps(options: { publishFails?: () => boolean } = {}) {
    const base = fakeDeps();
    const heads = new Map<string, number>();
    const manifest: ManifestPort = {
      load: vi.fn(async (repoPath: string) => {
        const name = repoPath.split('/').pop() ?? '';
        return ok({
          service: `svc-${name}`,
          container: `ctr-${name}`,
          migrationCommand: 'npm run migration:run',
          sharedBranch: 'development',
          modules: (name === 'a' ? { 'src-mod': {} } : { 'cons-mod': {} }) as Record<string, Record<string, unknown>>,
        });
      }),
    };
    const git = {
      ...base.git,
      // Every pull/merge moves HEAD: the merge reads as `advanced`.
      headRevision: vi.fn(async (repoPath: string) => {
        const next = (heads.get(repoPath) ?? 0) + 1;
        heads.set(repoPath, next);
        return ok(`h${String(next)}`);
      }),
      diffStat: vi.fn(async () => ok({ files: 1, insertions: 1, deletions: 0 })),
      // The commit cleans the consumer's worktree again.
      commit: vi.fn(async () => {
        heads.set('written', 0);
        return ok(undefined);
      }),
      listDirtyPaths: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/b' && (heads.get('written') ?? 0) > 0 ? ['package.json'] : [])),
    } as unknown as GitPort;
    const restart: RestartPort = {
      run: vi.fn(async (_repoPath: string, command: string) =>
        command === 'npm run v' && options.publishFails?.() === true ? err('restart-failed', 'npm ERR boom') : ok({ output: '' }),
      ),
    };
    const sharedTypes = {
      port: {
        readVersion: vi.fn(async () => ok('0.1.0')),
        readOwnVersion: vi.fn(async () => ok('0.1.5')),
        writeVersionLine: vi.fn(async () => {
          heads.set('written', 1);
          return ok(undefined);
        }),
        verifyPublished: vi.fn(async () => ok(true)),
      },
      sourceModuleId: 'src-mod',
      parseSourceConfig: () => ok({ publishCommand: 'npm run v', packageName: '@x/types' }),
      consumerModuleId: 'cons-mod',
      parseConsumerConfig: () => ok({ dependency: '@x/types', packageJsonPath: 'package.json' }),
    };
    const deps = fakeDeps({ manifest, git, restart, sharedTypes });
    return { deps, restart, git, sharedTypes };
  }

  const RUN = {
    selection: [
      { service: 'svc-a', repoPath: '/repo/a' },
      { service: 'svc-b', repoPath: '/repo/b' },
    ],
    sharedTypesSource: '/repo/a',
  };

  const order = (fn: unknown, predicate: (args: unknown[]) => boolean): number => {
    const mock = fn as { mock: { calls: unknown[][]; invocationCallOrder: number[] } };
    const index = mock.mock.calls.findIndex(predicate);
    return index === -1 ? -1 : (mock.mock.invocationCallOrder[index] ?? -1);
  };

  it('updates the source alone, publishes, propagates with a commit, then updates the others', async () => {
    const { deps, restart, git } = smartDeps();
    const store = createAppStore(deps);

    await store.getState().runGroupUpdate('edt', { ...RUN, sharedTypes: 'always' });

    expect(store.getState().updateStatus).toBe('done');
    expect(store.getState().updateResults.map((row) => row.outcome)).toEqual(['updated', 'updated']);
    const publish = order(restart.run, (args) => args[1] === 'npm run v');
    const sourceMigration = order(deps.migration!.run, (args) => args[0] === '/repo/a');
    const consumerMigration = order(deps.migration!.run, (args) => args[0] === '/repo/b');
    expect(sourceMigration).toBeGreaterThan(0);
    expect(publish).toBeGreaterThan(sourceMigration);
    expect(consumerMigration).toBeGreaterThan(publish);
    expect(git.commit).toHaveBeenCalledWith('/repo/b', expect.stringContaining('0.1.5'), ['package.json']);
    expect(store.getState().liveSharedTypesPhase).toEqual({});
  });

  it('does nothing extra when the setting is off', async () => {
    const { deps, restart } = smartDeps();
    const store = createAppStore(deps);

    await store.getState().runGroupUpdate('edt', { ...RUN, sharedTypes: 'off' });

    expect(restart.run).not.toHaveBeenCalledWith('/repo/a', 'npm run v');
    expect(deps.git.commit).not.toHaveBeenCalled();
  });

  it('a single-service update of the source still propagates to its consumers without updating them', async () => {
    const { deps, git } = smartDeps();
    const store = createAppStore(deps);

    await store.getState().runGroupUpdate('edt', { selection: [{ service: 'svc-a', repoPath: '/repo/a' }], sharedTypes: 'always', sharedTypesSource: '/repo/a' });

    expect(deps.migration!.run).not.toHaveBeenCalledWith('/repo/b', expect.anything());
    expect(git.commit).toHaveBeenCalledWith('/repo/b', expect.any(String), ['package.json']);
  });

  it('pauses on a phase failure and starts no other service until the developer chooses (retry then skip)', async () => {
    let failing = true;
    const { deps, restart } = smartDeps({ publishFails: () => failing });
    const store = createAppStore(deps);

    const run = store.getState().runGroupUpdate('edt', { ...RUN, sharedTypes: 'always' });
    await vi.waitFor(() => expect(store.getState().incidents).toHaveLength(1));
    expect(store.getState().incidents[0]?.blocker).toMatchObject({ kind: 'shared-types-phase-failed', service: 'svc-a' });
    expect(deps.migration!.run).not.toHaveBeenCalledWith('/repo/b', expect.anything());

    // Retry re-runs the phase; it fails again and pauses again (still blocked).
    store.getState().resolveUpdateIncident(store.getState().incidents[0]?.id ?? 'none', 'edited');
    await vi.waitFor(() => expect(restart.run).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(store.getState().incidents).toHaveLength(1));
    expect(store.getState().incidents[0]?.stillBlocked).toBeDefined();
    expect(deps.migration!.run).not.toHaveBeenCalledWith('/repo/b', expect.anything());

    // Skip continues without the phase: the consumer is updated, nothing was committed.
    failing = false;
    store.getState().resolveUpdateIncident(store.getState().incidents[0]?.id ?? 'none', 'cancel-repo');
    await run;
    expect(store.getState().updateResults.map((row) => `${row.service}:${row.outcome}`)).toEqual(['svc-a:updated', 'svc-b:updated']);
    expect(deps.git.commit).not.toHaveBeenCalled();
  });

  describe('conflict auto-resolution', () => {
    const OURS = '    "@x/types": "0.1.1",\n';
    const THEIRS = '    "@x/types": "0.1.0",\n';
    const conflictText = `{\n  "dependencies": {\n<<<<<<< HEAD\n${OURS}=======\n${THEIRS}>>>>>>> origin/development\n  }\n}\n`;

    // svc-b's merge conflicts on package.json (and the lock) once; the files live in memory.
    function conflictingDeps(options: { writeFails?: boolean; listFailsOnce?: boolean } = {}) {
      const smart = smartDeps();
      if (options.writeFails === true) {
        (smart.sharedTypes.port.writeVersionLine as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(err('package-json-unreadable', 'cannot write'));
      }
      let listFails = false;
      let merging = false;
      let unmerged: string[] = [];
      const files: Record<string, string> = {};
      const git = {
        ...smart.git,
        mergeBranch: vi.fn(async (repoPath: string) => {
          if (repoPath === '/repo/b' && !merging && unmerged.length === 0 && files['package.json'] === undefined) {
            merging = true;
            listFails = options.listFailsOnce === true;
            unmerged = ['package.json', 'package-lock.json'];
            files['package.json'] = conflictText;
            return err('merge-conflict', 'Automatic merge failed');
          }
          return ok(undefined);
        }),
        isMergeInProgress: vi.fn(async () => ok(merging)),
        listUnmergedPaths: vi.fn(async () => ok([...unmerged])),
        hasUnmergedPaths: vi.fn(async () => ok(unmerged.length > 0)),
        readWorktreeFile: vi.fn(async (_repo: string, path: string) => ok(files[path] ?? '<<<<<<< HEAD\n=======\n>>>>>>> x\n')),
        writeResolvedFile: vi.fn(async (_repo: string, path: string, content: string, opts: { stage: boolean }) => {
          files[path] = content;
          if (opts.stage) {
            unmerged = unmerged.filter((entry) => entry !== path);
          }
          return ok(undefined);
        }),
        checkoutSide: vi.fn(async () => ok(undefined)),
        stagePaths: vi.fn(async (_repo: string, paths: string[]) => {
          unmerged = unmerged.filter((entry) => !paths.includes(entry));
          return ok(undefined);
        }),
        finalizeMerge: vi.fn(async () => {
          merging = false;
          return ok(undefined);
        }),
      } as unknown as GitPort;
      const state = {
        ...smart.deps.state,
        readActiveEdt: vi.fn(async () => {
          if (listFails) {
            listFails = false;
            return err('state-read-error', 'state unreadable');
          }
          return smart.deps.state.readActiveEdt();
        }),
      } as AppStoreDeps['state'];
      const deps = fakeDeps({ manifest: smart.deps.manifest, git, restart: smart.restart, sharedTypes: smart.sharedTypes, state });
      return { deps, git, restart: smart.restart, files };
    }

    it('keeps the version published in the run, regenerates the lock and finalizes without a menu', async () => {
      const { deps, git, restart, files } = conflictingDeps();
      const store = createAppStore(deps);

      await store.getState().runGroupUpdate('edt', { ...RUN, sharedTypes: 'always' });

      expect(store.getState().incidents).toEqual([]);
      expect(files['package.json']).toContain('"@x/types": "0.1.5"');
      expect(files['package.json']).not.toContain('<<<<<<<');
      expect(restart.run).toHaveBeenCalledWith('/repo/b', 'npm i');
      expect(git.finalizeMerge).toHaveBeenCalledWith('/repo/b');
      const consumer = store.getState().updateResults.find((row) => row.service === 'svc-b');
      expect(consumer).toMatchObject({ outcome: 'updated', run: { conflict: 'auto-resolved' } });
    });

    it('keeps the published version when the phase failed after the publish and was skipped', async () => {
      const { deps, files } = conflictingDeps({ writeFails: true });
      const store = createAppStore(deps);

      const run = store.getState().runGroupUpdate('edt', { ...RUN, sharedTypes: 'always' });
      await vi.waitFor(() => expect(store.getState().incidents).toHaveLength(1));
      expect(store.getState().incidents[0]?.blocker).toMatchObject({ kind: 'shared-types-phase-failed' });
      store.getState().resolveUpdateIncident(store.getState().incidents[0]?.id ?? 'none', 'cancel-repo');
      await run;

      expect(files['package.json']).toContain('"@x/types": "0.1.5"');
      expect(store.getState().updateResults.find((row) => row.service === 'svc-b')?.run?.conflict).toBe('auto-resolved');
    });

    it('stores the resolver issue note in the issue detail and retries a failed consumer listing after edited', async () => {
      const { deps, files } = conflictingDeps({ listFailsOnce: true });
      const store = createAppStore(deps);

      const run = store.getState().runGroupUpdate('edt', { ...RUN, sharedTypes: 'off' });
      await vi.waitFor(() => expect(store.getState().incidents).toHaveLength(1));
      const blocker = store.getState().incidents[0]?.blocker;
      expect(blocker).toMatchObject({ kind: 'merge-conflict', service: 'svc-b', autoResolveNote: expect.stringContaining('Cannot list the consumers') });
      expect(store.getState().liveServiceIssues['svc-b']?.[0]?.detail).toContain('Cannot list the consumers');
      store.getState().resolveUpdateIncident(store.getState().incidents[0]?.id ?? 'none', 'edited');
      await run;

      // The failed listing was not cached: the pass after `edited` resolved the line.
      expect(files['package.json']).toContain('"@x/types": "0.1.1"');
      expect(store.getState().updateResults.find((row) => row.service === 'svc-b')).toMatchObject({ outcome: 'updated', run: { conflict: 'partial' } });
    });

    it('keeps the consumer own value when nothing was published in the run', async () => {
      const { deps, files } = conflictingDeps();
      const store = createAppStore(deps);

      await store.getState().runGroupUpdate('edt', { ...RUN, sharedTypes: 'off' });

      expect(files['package.json']).toContain('"@x/types": "0.1.1"');
      expect(store.getState().updateResults.find((row) => row.service === 'svc-b')?.run?.conflict).toBe('auto-resolved');
    });
  });

  it('abort cancels the remaining services', async () => {
    const { deps } = smartDeps({ publishFails: () => true });
    const store = createAppStore(deps);

    const run = store.getState().runGroupUpdate('edt', { ...RUN, sharedTypes: 'always' });
    await vi.waitFor(() => expect(store.getState().incidents).toHaveLength(1));
    store.getState().resolveUpdateIncident(store.getState().incidents[0]?.id ?? 'none', 'cancel-run');
    await run;

    expect(store.getState().updateResults.map((row) => `${row.service}:${row.outcome}`)).toEqual(['svc-a:updated', 'svc-b:skipped']);
    expect(deps.migration!.run).not.toHaveBeenCalledWith('/repo/b', expect.anything());
  });

  it('the config draft carries the shared-types row only for a single source among the rows', async () => {
    const { deps } = smartDeps();
    const store = createAppStore(deps);
    await store.getState().openUpdateConfig('edt');
    expect(store.getState().updateConfig?.sharedTypesSource).toBe('/repo/a');
    expect(store.getState().updateConfig?.sharedTypes).toBe('off');
    store.getState().closeUpdateConfig();

    await store.getState().openUpdateConfig({ service: 'svc-b', repoPath: '/repo/b' });
    expect(store.getState().updateConfig?.sharedTypesSource).toBeNull();

    const plain = createAppStore(fakeDeps());
    await plain.getState().openUpdateConfig('edt');
    expect(plain.getState().updateConfig?.sharedTypesSource).toBeNull();
  });

  it('the real confirm path forwards the mode and source: publish runs and the consumer is committed', async () => {
    const { deps, restart, git } = smartDeps();
    const store = createAppStore(deps);
    await store.getState().openUpdateConfig('edt');
    store.getState().setUpdateConfig({ ...store.getState().updateConfig!, sharedTypes: 'always' });
    await store.getState().confirmUpdateConfig();

    expect(store.getState().updateStatus).toBe('done');
    expect(restart.run).toHaveBeenCalledWith('/repo/a', 'npm run v');
    expect(git.commit).toHaveBeenCalledWith('/repo/b', expect.stringContaining('0.1.5'), ['package.json']);
  });

  it('confirming passes the mode through and a deselected source runs nothing extra', async () => {
    const { deps, restart } = smartDeps();
    const store = createAppStore(deps);
    await store.getState().openUpdateConfig('edt');
    const draft = store.getState().updateConfig!;
    store.getState().setUpdateConfig({ ...draft, sharedTypes: 'always', rows: draft.rows.map((row) => (row.repoPath === '/repo/a' ? { ...row, selected: false } : row)) });
    await store.getState().confirmUpdateConfig();
    expect(restart.run).not.toHaveBeenCalledWith('/repo/a', 'npm run v');
  });
});
