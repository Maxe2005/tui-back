import { describe, expect, it, vi } from 'vitest';
import { ok, err } from '../../../core/result.js';
import type { ManifestPort } from '../../../core/ports/manifest.js';
import type { MigrationPort } from '../../../core/ports/migration.js';
import type { RegistryPort } from '../../../core/ports/registry.js';
import type { GitPort } from '../../../core/ports/git.js';
import { DEFAULT_SETTINGS, type Settings, type SettingsPort } from '../../../core/ports/settings.js';
import { fakeState, buildTestSubcommands } from './dispatch.test-support.js';

describe('subcommand registry guards — update', () => {
  it('update gates the all-repos mode behind confirmation, rejecting unknown flags', async () => {
    const subcommands = buildTestSubcommands();
    const update = subcommands.find((subcommand) => subcommand.name === 'update');
    if (!update) throw new Error('expected update subcommand');

    // --all alone never runs: confirmation-required naming --yes.
    const confirm = await update.run(['--all']);
    expect(confirm).toMatchObject({ ok: false, error: { code: 'confirmation-required' } });
    if (!confirm.ok) {
      expect(confirm.error.message).toContain('--yes');
    }

    // Unknown flags are never ignored.
    for (const args of [['--force'], ['extra'], ['--all', '--yes', 'extra']]) {
      const result = await update.run(args);
      expect(result).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
    }
  });

  it('update runs the all-repos scope with --all --yes in any order', async () => {
    const subcommands = buildTestSubcommands();
    const update = subcommands.find((subcommand) => subcommand.name === 'update');
    if (!update) throw new Error('expected update subcommand');

    // The fixture registry is empty, so both orders land on the explicit no-op success.
    for (const args of [['--all', '--yes'], ['--yes', '--all']]) {
      const result = await update.run(args);
      expect(result).toMatchObject({ ok: true, data: { ulid: 'all', topic: 'all-repos', scope: 'all', results: [] } });
      if (result.ok) {
        expect(typeof (result.data as { note?: unknown }).note).toBe('string');
      }
    }
  });

  it('update carries the per-service run detail additively on each result row', async () => {
    const registry: RegistryPort = {
      list: async () => ok(['/repo/a']),
      add: async () => ok(undefined),
      exists: async () => ok(false),
      scan: async () => ok({ candidates: [], skipped: [] }),
      reset: async () => ok({ path: '/p', backupPath: null }),
      remove: async () => ok(undefined),
    };
    const manifest: ManifestPort = {
      load: async () => ok({ service: 'svc-a', container: 'ctr-a', migrationCommand: 'npm run m', sharedBranch: 'main', modules: {} }),
    };
    const migration: MigrationPort = { run: async () => ok({ output: 'migrated\n' }) };
    const subcommands = buildTestSubcommands({ registry, manifest, migration });
    const update = subcommands.find((subcommand) => subcommand.name === 'update');
    if (!update) throw new Error('expected update subcommand');

    const result = await update.run(['--all', '--yes']);

    expect(result).toMatchObject({
      ok: true,
      data: {
        results: [
          {
            service: 'svc-a',
            outcome: 'updated',
            run: { merge: { kind: 'up-to-date' }, migrations: { kind: 'ran', command: 'npm run m', outputExcerpt: 'migrated' } },
          },
        ],
      },
    });
  });

  describe('update settings defaults and override flags', () => {
    function wiredUpdate(update: Partial<Settings['update']>) {
      const registry: RegistryPort = {
        list: async () => ok(['/repo/a']),
        add: async () => ok(undefined),
        exists: async () => ok(false),
        scan: async () => ok({ candidates: [], skipped: [] }),
        reset: async () => ok({ path: '/p', backupPath: null }),
        remove: async () => ok(undefined),
      };
      const manifest: ManifestPort = {
        load: async () => ok({ service: 'svc-a', container: 'ctr-a', migrationCommand: 'npm run m', sharedBranch: 'main', modules: {} }),
      };
      const migrationRun = vi.fn(async () => ok({ output: 'migrated\n' }));
      const settings: SettingsPort = {
        load: async () => ok({ settings: { ...DEFAULT_SETTINGS, update: { ...DEFAULT_SETTINGS.update, ...update } }, warning: null }),
        save: async () => ok(undefined),
      };
      const subcommands = buildTestSubcommands({ registry, manifest, migration: { run: migrationRun }, settings });
      const run = subcommands.find((subcommand) => subcommand.name === 'update')?.run;
      if (!run) throw new Error('expected update subcommand');
      return { run, migrationRun };
    }

    it('real update with a ctx forwards phases to onPhase and stops on an aborted signal', async () => {
      const registry: RegistryPort = {
        list: async () => ok(['/repo/a', '/repo/b']),
        add: async () => ok(undefined),
        exists: async () => ok(false),
        scan: async () => ok({ candidates: [], skipped: [] }),
        reset: async () => ok({ path: '/p', backupPath: null }),
        remove: async () => ok(undefined),
      };
      const manifest: ManifestPort = {
        load: async (repoPath) => {
          const service = repoPath.split('/').pop() ?? repoPath;
          return ok({ service, container: `ctr-${service}`, migrationCommand: 'npm run m', sharedBranch: 'main', modules: {} });
        },
      };
      const controller = new AbortController();
      const migration: MigrationPort = {
        run: async () => {
          controller.abort();
          return ok({ output: '' });
        },
      };
      const run = buildTestSubcommands({ registry, manifest, migration }).find((s) => s.name === 'update')!.run;
      const phases: string[] = [];
      const result = await run(['--all', '--yes'], { signal: controller.signal, onPhase: (service, phase) => phases.push(`${service}:${phase}`) });
      expect(phases).toContain('a:migrating');
      expect(result).toMatchObject({ ok: true });
      const rows = (result as { data: { results: Array<{ service: string; outcome: string; detail?: { code: string } }> } }).data.results;
      expect(rows.find((r) => r.service === 'b')).toMatchObject({ outcome: 'skipped', detail: { code: 'run-cancelled' } });
      expect(phases.some((p) => p.startsWith('b:'))).toBe(false);
    });

    it('runs migrations by default and skips them when settings turn them off', async () => {
      const on = wiredUpdate({});
      await on.run(['--all', '--yes']);
      expect(on.migrationRun).toHaveBeenCalledTimes(1);

      const off = wiredUpdate({ runMigrations: false });
      await off.run(['--all', '--yes']);
      expect(off.migrationRun).not.toHaveBeenCalled();
    });

    it('explicit flags win over the settings defaults, in any position', async () => {
      const forcedOn = wiredUpdate({ runMigrations: false });
      await forcedOn.run(['--migrations', '--all', '--yes']);
      expect(forcedOn.migrationRun).toHaveBeenCalledTimes(1);

      const forcedOff = wiredUpdate({ runMigrations: true });
      await forcedOff.run(['--all', '--no-migrations', '--yes']);
      expect(forcedOff.migrationRun).not.toHaveBeenCalled();
    });

    it('rejects a flag together with its negation as invalid-argument', async () => {
      const { run } = wiredUpdate({});
      expect(await run(['--migrations', '--no-migrations'])).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
      expect(await run(['--clean-restart', '--no-clean-restart', '--all', '--yes'])).toMatchObject({
        ok: false,
        error: { code: 'invalid-argument' },
      });
    });

    it('rejects an unknown flag alongside the override flags', async () => {
      const { run } = wiredUpdate({});
      expect(await run(['--all', '--yes', '--no-migrations', '--bogus'])).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
    });

    it('falls back to defaults and reports on stderr when settings fail to load or carry a warning', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        for (const load of [
          async () => err('io-error', 'disk on fire'),
          async () => ok({ settings: { ...DEFAULT_SETTINGS, update: { ...DEFAULT_SETTINGS.update, runMigrations: false } }, warning: 'Invalid settings: update.cleanRestart' }),
        ]) {
          errorSpy.mockClear();
          const migrationRun = vi.fn(async () => ok({ output: '' }));
          const subcommands = buildTestSubcommands({
            registry: { list: async () => ok(['/repo/a']), add: async () => ok(undefined), exists: async () => ok(false), scan: async () => ok({ candidates: [], skipped: [] }), reset: async () => ok({ path: '/p', backupPath: null }), remove: async () => ok(undefined) },
            manifest: { load: async () => ok({ service: 'svc-a', container: 'ctr-a', migrationCommand: 'npm run m', sharedBranch: 'main', modules: {} }) },
            migration: { run: migrationRun },
            settings: { load: load as never, save: async () => ok(undefined) },
          });
          const run = subcommands.find((subcommand) => subcommand.name === 'update')!.run;
          await run(['--all', '--yes']);
          expect(errorSpy).toHaveBeenCalledTimes(1);
          // The failing load uses the built-in defaults (migrations on); the warned load keeps its parsed settings.
          expect(migrationRun).toHaveBeenCalledTimes(load.toString().includes('io-error') ? 1 : 0);
        }
      } finally {
        errorSpy.mockRestore();
      }
    });

    describe('clean restart wiring', () => {
      function wiredRestart(update: Partial<Settings['update']>) {
        const restartRun = vi.fn(async () => ok({ output: '' }));
        const containerRestart = vi.fn(async () => ok(undefined));
        const subcommands = buildTestSubcommands({
          registry: { list: async () => ok(['/repo/a']), add: async () => ok(undefined), exists: async () => ok(false), scan: async () => ok({ candidates: [], skipped: [] }), reset: async () => ok({ path: '/p', backupPath: null }), remove: async () => ok(undefined) },
          manifest: { load: async () => ok({ service: 'svc-a', container: 'ctr-a', sharedBranch: 'main', restartCommands: ['npm run clean'], modules: {} }) },
          restart: { run: restartRun },
          container: { restart: containerRestart },
          settings: {
            load: async () => ok({ settings: { ...DEFAULT_SETTINGS, update: { ...DEFAULT_SETTINGS.update, ...update } }, warning: null }),
            save: async () => ok(undefined),
          },
        });
        const run = subcommands.find((subcommand) => subcommand.name === 'update')!.run;
        return { run, restartRun, containerRestart };
      }

      it('settings cleanRestart: true runs the recipe; --no-clean-restart overrides it; --clean-restart forces it', async () => {
        const fromSettings = wiredRestart({ cleanRestart: true });
        await fromSettings.run(['--all', '--yes']);
        expect(fromSettings.restartRun).toHaveBeenCalled();

        const overridden = wiredRestart({ cleanRestart: true });
        await overridden.run(['--all', '--yes', '--no-clean-restart']);
        expect(overridden.restartRun).not.toHaveBeenCalled();

        const forced = wiredRestart({});
        await forced.run(['--clean-restart', '--all', '--yes']);
        expect(forced.restartRun).toHaveBeenCalled();
      });
    });

    it('still gates --all behind --yes when only override flags are added', async () => {
      const { run } = wiredUpdate({});
      expect(await run(['--all', '--no-clean-restart'])).toMatchObject({ ok: false, error: { code: 'confirmation-required' } });
    });
  });

  it('update fails with no-active-edt when no EDT is active', async () => {
    const subcommands = buildTestSubcommands();
    const update = subcommands.find((subcommand) => subcommand.name === 'update');
    if (!update) throw new Error('expected update subcommand');

    const result = await update.run([]);

    expect(result).toMatchObject({ ok: false, error: { code: 'no-active-edt' } });
  });

  it('update --from-edt without a topic is rejected and the flag is documented', async () => {
    const subcommands = buildTestSubcommands();
    const update = subcommands.find((subcommand) => subcommand.name === 'update');
    if (!update) throw new Error('expected update subcommand');

    expect(update.usage).toContain('--from-edt <topic>');
    expect(await update.run(['--from-edt'])).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
    expect(await update.run(['--from-edt', 'a', '--all'])).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
  });

  it('update --from-edt fails with no-active-edt when no EDT is active', async () => {
    const subcommands = buildTestSubcommands();
    const update = subcommands.find((subcommand) => subcommand.name === 'update');
    if (!update) throw new Error('expected update subcommand');

    expect(await update.run(['--from-edt', 'sibling'])).toMatchObject({ ok: false, error: { code: 'no-active-edt' } });
  });

  describe('update --from-edt', () => {
    const entry = (ulid: string, topic: string, branch: string) => ({
      ulid,
      topic,
      createdAt: '2026-10-01T00:00:00.000Z',
      status: 'inactive' as const,
      members: [{ service: 'svc-a', repoPath: '/repo/a', branch }],
    });

    function wired(localBranches: string[], update: Partial<Settings['update']> = {}) {
      const merges: [string, string][] = [];
      const restartRun = vi.fn(async () => ok({ output: '' }));
      const migrationRun = vi.fn(async () => ok({ output: '' }));
      // Every GitPort method answers ok(undefined) unless overridden below.
      const git = new Proxy(
        {
          currentBranch: async () => ok('feat/mine'),
          branchExistsLocally: async () => ok(true),
          hasUncommittedChanges: async () => ok(false),
          isMergeInProgress: async () => ok(false),
          isRebaseInProgress: async () => ok(false),
          listDirtyPaths: async () => ok([]),
          listBranches: async () => ok(localBranches),
          mergeBranch: async (path: string, branch: string) => {
            merges.push([path, branch]);
            return ok(undefined);
          },
        } as Record<string, unknown>,
        { get: (target, key: string) => target[key] ?? (async () => ok(undefined)) },
      ) as unknown as GitPort;
      const subcommands = buildTestSubcommands({
        git,
        edtRegistry: {
          add: async () => ok(undefined),
          list: async () => ok([entry('A', 'mine', 'feat/mine'), entry('B', 'sibling', 'feat/x')]),
          setStatus: async () => ok(undefined),
          update: async () => ok(undefined),
          remove: async () => ok(undefined),
        },
        state: { ...fakeState(), readActiveEdt: async () => ok('A') },
        manifest: {
          load: async () =>
            ok({ service: 'svc-a', container: 'ctr-a', migrationCommand: 'npm run m', restartCommands: ['npm run clean'], sharedBranch: 'development', modules: {} }),
        },
        restart: { run: restartRun },
        migration: { run: migrationRun },
        settings: {
          load: async () => ok({ settings: { ...DEFAULT_SETTINGS, update: { ...DEFAULT_SETTINGS.update, ...update } }, warning: null }),
          save: async () => ok(undefined),
        },
      });
      const updateCommand = subcommands.find((subcommand) => subcommand.name === 'update');
      if (!updateCommand) throw new Error('expected update subcommand');
      return { update: updateCommand, merges, restartRun, migrationRun };
    }

    it('applies the settings defaults and explicit override flags to the toggles', async () => {
      const fromSettings = wired(['feat/x'], { cleanRestart: true, runMigrations: false });
      await fromSettings.update.run(['--from-edt', 'sibling']);
      expect(fromSettings.restartRun).toHaveBeenCalled();
      expect(fromSettings.migrationRun).not.toHaveBeenCalled();

      const overridden = wired(['feat/x'], { cleanRestart: true, runMigrations: false });
      await overridden.update.run(['--from-edt', 'sibling', '--no-clean-restart', '--migrations']);
      expect(overridden.restartRun).not.toHaveBeenCalled();
      expect(overridden.migrationRun).toHaveBeenCalled();
    });

    it('merges the sibling EDT branch instead of the shared branch', async () => {
      const { update, merges } = wired(['feat/x']);

      const result = await update.run(['--from-edt', ' sibling ']);

      expect(result).toMatchObject({ ok: true, data: { scope: 'edt', results: [{ service: 'svc-a', outcome: 'updated' }] } });
      expect(merges).toEqual([['/repo/a', 'feat/x']]);
    });

    it('fails update-source-unresolved with no git write when a member has no branch', async () => {
      const { update, merges } = wired(['development']);

      const result = await update.run(['--from-edt', 'sibling']);

      expect(result).toMatchObject({ ok: false, error: { code: 'update-source-unresolved' } });
      expect(merges).toEqual([]);
    });

    it('rejects an unknown topic and the active EDT own topic', async () => {
      const { update } = wired(['feat/x']);

      expect(await update.run(['--from-edt', 'nope'])).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
      expect(await update.run(['--from-edt', 'mine'])).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
    });
  });

});
