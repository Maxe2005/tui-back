import { describe, expect, it, vi } from 'vitest';
import { ok, err } from '../../../core/result.js';
import type { ContainerPort } from '../../../core/ports/container.js';
import type { ManifestPort } from '../../../core/ports/manifest.js';
import type { MigrationPort } from '../../../core/ports/migration.js';
import type { RegistryPort } from '../../../core/ports/registry.js';
import type { EdtRegistryPort } from '../../../core/ports/edt-registry.js';
import type { GitPort } from '../../../core/ports/git.js';
import type { LockPort } from '../../../core/ports/lock.js';
import type { RouteScannerPort } from '../../../core/ports/route-scanner.js';
import type { StatePort } from '../../../core/ports/state.js';
import { runCli, type Subcommand } from './dispatch.js';
import { assertUniqueSubcommandNames, buildSubcommands } from './subcommands.js';

function fakeLock(): LockPort {
  return {
    acquire: async (resourceKey) => ok({ release: async () => ok(undefined) }),
    peek: async () => ok({ locked: false }),
  };
}

function fakeState(): StatePort {
  return {
    readActiveEdt: async () => ok(null),
    writeActiveEdt: async () => ok(undefined),
    readSplitterRatios: async () => ok(null),
    writeSplitterRatios: async () => ok(undefined),
    readFilterHistory: async () => ok(null),
    writeFilterHistory: async () => ok(undefined),
  };
}

const fakeSubcommands: Subcommand[] = [
  { name: 'ping', usage: 'tui-back ping', run: async () => ok({ message: 'pong' }) },
  { name: 'fail', usage: 'tui-back fail', run: async () => err('fixture-failure', 'it failed on purpose') },
  {
    name: 'throws',
    usage: 'tui-back throws',
    run: async () => {
      throw new Error('boom');
    },
  },
];

describe('runCli', () => {
  it('routes a known subcommand success through renderResult, exit 0', async () => {
    const { output, exitCode } = await runCli(['ping'], fakeSubcommands, false);

    expect(JSON.parse(output)).toEqual({ ok: true, data: { message: 'pong' } });
    expect(exitCode).toBe(0);
  });

  it('routes a known subcommand failure through renderResult, exit 1', async () => {
    const { output, exitCode } = await runCli(['fail'], fakeSubcommands, false);

    expect(JSON.parse(output)).toEqual({
      ok: false,
      error: { code: 'fixture-failure', message: 'it failed on purpose' },
    });
    expect(exitCode).toBe(1);
  });

  it('converts a thrown error into an internal-error failure envelope, never propagates', async () => {
    const { output, exitCode } = await runCli(['throws'], fakeSubcommands, false);
    const parsed = JSON.parse(output);

    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('internal-error');
    expect(parsed.error.message).toContain('boom');
    expect(exitCode).toBe(1);
  });

  it('treats an unknown subcommand name as a failure listing available subcommands, exit 1', async () => {
    const { output, exitCode } = await runCli(['bogus'], fakeSubcommands, false);
    const parsed = JSON.parse(output);

    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('unknown-subcommand');
    expect(parsed.error.message).toContain('bogus');
    expect(parsed.error.message).toContain('ping');
    expect(parsed.error.message).toContain('fail');
    expect(exitCode).toBe(1);
  });

  it('treats empty argv the same as an unknown subcommand, exit 1', async () => {
    const { output, exitCode } = await runCli([], fakeSubcommands, false);
    const parsed = JSON.parse(output);

    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('unknown-subcommand');
    expect(exitCode).toBe(1);
  });

  it('--help lists every registered subcommand and its usage, exit 0', async () => {
    const { output, exitCode } = await runCli(['--help'], fakeSubcommands, false);
    const parsed = JSON.parse(output);

    expect(exitCode).toBe(0);
    expect(parsed).toEqual({
      ok: true,
      data: {
        usage: 'tui-back <command> [args]',
        commands: fakeSubcommands.map((subcommand) => ({ name: subcommand.name, usage: subcommand.usage })),
      },
    });
  });

  it('-h is the same as --help, exit 0', async () => {
    const { output, exitCode } = await runCli(['-h'], fakeSubcommands, false);
    const parsed = JSON.parse(output);

    expect(exitCode).toBe(0);
    expect(parsed.ok).toBe(true);
  });

  it('logs a thrown error to stderr instead of discarding it', async () => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await runCli(['throws'], fakeSubcommands, false);

      expect(stderr).toHaveBeenCalledWith(new Error('boom'));
    } finally {
      stderr.mockRestore();
    }
  });

  it('converts a rendering failure into an internal-error envelope instead of letting it escape', async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const unrenderable: Subcommand[] = [{ name: 'unrenderable', usage: 'tui-back unrenderable', run: async () => ok(circular) }];

    const { output, exitCode } = await runCli(['unrenderable'], unrenderable, false);
    const parsed = JSON.parse(output);

    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('internal-error');
    expect(exitCode).toBe(1);
  });
});

describe('subcommand registry guards', () => {
  it('assertUniqueSubcommandNames throws when two subcommands share a name', () => {
    const duplicated: Subcommand[] = [
      { name: 'ping', usage: 'tui-back ping', run: async () => ok({}) },
      { name: 'ping', usage: 'tui-back ping', run: async () => ok({}) },
    ];

    expect(() => assertUniqueSubcommandNames(duplicated)).toThrow('Duplicate subcommand name: ping');
  });

  it('assertUniqueSubcommandNames accepts a collision-free registry', () => {
    const clean: Subcommand[] = [
      { name: 'register', usage: 'tui-back register <path>', run: async () => ok({}) },
      { name: 'scan', usage: 'tui-back scan <root>', run: async () => ok({}) },
    ];

    expect(() => assertUniqueSubcommandNames(clean)).not.toThrow();
  });

  function fakeEdtRegistry(): EdtRegistryPort {
    return {
      add: async () => ok(undefined),
      list: async () => ok([]),
      setStatus: async () => ok(undefined),
      update: async () => ok(undefined),
      remove: async () => ok(undefined),
    };
  }

  function buildTestSubcommands(overrides: Partial<Parameters<typeof buildSubcommands>[0]> = {}) {
    const registry: RegistryPort = {
      list: async () => ok([]),
      add: async () => ok(undefined),
      exists: async () => ok(false),
      scan: async () => ok({ candidates: [], skipped: [] }),
      reset: async () => ok({ path: '/p', backupPath: null }),
    };
    const manifest: ManifestPort = { load: async () => err('manifest-not-found', 'none') };
    const container: ContainerPort = { restart: async () => ok(undefined) };
    const migration: MigrationPort = { run: async () => ok({ output: '' }) };
    const scanner: RouteScannerPort = { scan: async () => ok([]) };
    const git: GitPort = {
      assertAllowedBranch: async () => ok(undefined),
      createBranch: async () => ok(undefined),
      deleteBranch: async () => ok(undefined),
      currentBranch: async () => ok('development'),
      aheadBehind: async () => ok({ ahead: 0, behind: 0 }),
      checkout: async () => ok(undefined),
      hasUncommittedChanges: async () => ok(false),
      stashSave: async () => ok(undefined),
      restoreStash: async () => ok(undefined),
      branchExistsLocally: async () => ok(true),
      fetch: async () => ok(undefined),
      pull: async () => ok(undefined),
      mergeBranch: async () => ok(undefined),
      abortMerge: async () => ok(undefined),
      isMergeInProgress: async () => ok(false),
      listDirtyPaths: async () => ok([]),
      discardPaths: async () => ok(undefined),
      isRebaseInProgress: async () => ok(false),
      hasUnmergedPaths: async () => ok(false),
      finalizeMerge: async () => ok(undefined),
      listBranches: async () => ok([]),
      renameBranch: async () => ok(undefined),
      isBranchMerged: async () => ok(true),
      hasStash: async () => ok(false),
    };

    return buildSubcommands({
      registry,
      manifest,
      lock: fakeLock(),
      registryResourceKey: '/cfg/registry.yaml',
      edtsBaseDir: '/data/edts',
      edtRegistry: fakeEdtRegistry(),
      edtRegistryResourceKey: '/cfg/edts.yaml',
      git,
      container,
      migration,
      state: fakeState(),
      scanner,
      ...overrides,
    });
  }

  it('buildSubcommands wires register/list-repos/scan/ping/edts/edt/update/list-routes without name collisions', () => {
    const subcommands = buildTestSubcommands();

    expect(subcommands.map((subcommand) => subcommand.name)).toEqual([
      'register',
      'list-repos',
      'scan',
      'ping',
      'edts',
      'edt',
      'update',
      'list-routes',
    ]);
    expect(() => assertUniqueSubcommandNames(subcommands)).not.toThrow();
  });

  it('edts (story 2.6) rejects excess arguments and otherwise runs the divergence use-case', async () => {
    const subcommands = buildTestSubcommands();
    const edts = subcommands.find((subcommand) => subcommand.name === 'edts');
    if (!edts) throw new Error('expected edts subcommand');

    const excess = await edts.run(['extra']);
    expect(excess).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });

    const result = await edts.run([]);
    expect(result).toMatchObject({ ok: true, data: { services: [], unreachable: [], errors: [] } });
  });

  it('list-routes (story 6.1) rejects missing/excess arguments and otherwise delegates to the use-case', async () => {
    const subcommands = buildTestSubcommands();
    const listRoutesCmd = subcommands.find((subcommand) => subcommand.name === 'list-routes');
    if (!listRoutesCmd) throw new Error('expected list-routes subcommand');

    expect(listRoutesCmd.usage).toBe('tui-back list-routes <repoPath>');

    const missing = await listRoutesCmd.run([]);
    expect(missing).toMatchObject({ ok: false, error: { code: 'missing-argument' } });

    const excess = await listRoutesCmd.run(['/a', '/b']);
    expect(excess).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });

    // The fixture manifest answers manifest-not-found, which the use-case propagates —
    // proving the wrapper reached the use-case itself rather than rejecting locally.
    const result = await listRoutesCmd.run(['/repos/gateway']);
    expect(result).toMatchObject({ ok: false, error: { code: 'manifest-not-found' } });
  });

  it('edt rejects an unknown action and excess arguments with invalid-argument', async () => {
    const subcommands = buildTestSubcommands();
    const edt = subcommands.find((subcommand) => subcommand.name === 'edt');
    if (!edt) throw new Error('expected edt subcommand');

    const unknown = await edt.run(['bogus']);
    expect(unknown).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });

    const noAction = await edt.run([]);
    expect(noAction).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });

    const excess = await edt.run(['create', 'extra']);
    expect(excess).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
  });

  it('edt delete dispatches to the delete use-case, parsing the positional topic and --branches flags', async () => {
    const subcommands = buildTestSubcommands();
    const edt = subcommands.find((subcommand) => subcommand.name === 'edt');
    if (!edt) throw new Error('expected edt subcommand');

    const missingTopic = await edt.run(['delete']);
    expect(missingTopic).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });

    const malformedBranches = await edt.run(['delete', 'demo', '--branches', 'no-equals-sign']);
    expect(malformedBranches).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });

    const badDisposition = await edt.run(['delete', 'demo', '--branches', '/repo/a=maybe']);
    expect(badDisposition).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });

    const unknownFlag = await edt.run(['delete', 'demo', '--bogus']);
    expect(unknownFlag).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });

    // A well-formed call reaches the use-case itself, which reports edt-not-found for a
    // topic the fake registry doesn't know about — proving dispatch/parsing succeeded.
    const notFound = await edt.run(['delete', 'no-such-topic', '--branches', '/repo/a=delete']);
    expect(notFound).toMatchObject({ ok: false, error: { code: 'edt-not-found' } });
  });

  // Review fix (story 2.29): three previously-silent --branches mistakes now reject with
  // invalid-argument instead of resolving to a surprising default.
  describe('edt delete --branches validation (story 2.29 review fixes)', () => {
    function fakeEdtRegistryWithTarget(): EdtRegistryPort {
      const target = {
        ulid: 'ulid-1',
        topic: 'demo',
        createdAt: '2026-08-18T00:00:00.000Z',
        status: 'inactive' as const,
        members: [{ service: 'svc-a', repoPath: '/repo/a', branch: 'feat/a' }],
      };
      return {
        add: async () => ok(undefined),
        list: async () => ok([target]),
        setStatus: async () => ok(undefined),
        update: async () => ok(undefined),
        remove: async () => ok(undefined),
      };
    }

    it('rejects an empty repoPath before "=" instead of resolving it to process.cwd()', async () => {
      const subcommands = buildTestSubcommands();
      const edt = subcommands.find((subcommand) => subcommand.name === 'edt');
      if (!edt) throw new Error('expected edt subcommand');

      const result = await edt.run(['delete', 'demo', '--branches', '=delete']);

      expect(result).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
    });

    it('rejects a --branches repoPath that is not one of the target EDT\'s own members', async () => {
      const subcommands = buildTestSubcommands({ edtRegistry: fakeEdtRegistryWithTarget() });
      const edt = subcommands.find((subcommand) => subcommand.name === 'edt');
      if (!edt) throw new Error('expected edt subcommand');

      const result = await edt.run(['delete', 'demo', '--branches', '/repo/not-a-member=delete']);

      expect(result).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
    });

    it('accepts a --branches repoPath that does match a target member', async () => {
      const subcommands = buildTestSubcommands({ edtRegistry: fakeEdtRegistryWithTarget() });
      const edt = subcommands.find((subcommand) => subcommand.name === 'edt');
      if (!edt) throw new Error('expected edt subcommand');

      const result = await edt.run(['delete', 'demo', '--branches', '/repo/a=delete']);

      // Reaches the use-case (never rejected at the CLI-validation layer above).
      expect(result).toMatchObject({ ok: true });
    });

    it('rejects a --branches repeated for the same resolved repoPath instead of letting the later value win', async () => {
      const subcommands = buildTestSubcommands({ edtRegistry: fakeEdtRegistryWithTarget() });
      const edt = subcommands.find((subcommand) => subcommand.name === 'edt');
      if (!edt) throw new Error('expected edt subcommand');

      const result = await edt.run(['delete', 'demo', '--branches', '/repo/a=leave', '--branches', '/repo/a=delete']);

      expect(result).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
    });

    it('rejects a --branches repeated for the same repoPath even under a differently-shaped (trailing-slash) spelling', async () => {
      const subcommands = buildTestSubcommands({ edtRegistry: fakeEdtRegistryWithTarget() });
      const edt = subcommands.find((subcommand) => subcommand.name === 'edt');
      if (!edt) throw new Error('expected edt subcommand');

      const result = await edt.run(['delete', 'demo', '--branches', '/repo/a=leave', '--branches', '/repo/a/=delete']);

      expect(result).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
    });
  });

  it('register --reset routes to the reset use-case, rejecting extra arguments', async () => {
    const reset = vi.fn(async () => ok({ path: '/p', backupPath: '/c/registry.yaml.bak-1' }));
    const registry: RegistryPort = {
      list: async () => ok([]),
      add: async () => ok(undefined),
      exists: async () => ok(false),
      scan: async () => ok({ candidates: [], skipped: [] }),
      reset,
    };
    const manifest: ManifestPort = { load: async () => err('manifest-not-found', 'none') };

    const subcommands = buildTestSubcommands({ registry, manifest });
    const register = subcommands.find((subcommand) => subcommand.name === 'register');
    if (!register) throw new Error('expected register subcommand');

    const recovered = await register.run(['--reset', '/p']);
    expect(recovered).toEqual({
      ok: true,
      data: { path: '/p', backupPath: '/c/registry.yaml.bak-1' },
    });
    expect(reset).toHaveBeenCalledWith('/p');

    const extra = await register.run(['--reset', '/p', '/extra']);
    expect(extra).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });

    const extraArg = await register.run(['/p', '/q']);
    expect(extraArg).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
  });

  it('list-repos, scan, and ping reject excess arguments with invalid-argument', async () => {
    const subcommands = buildTestSubcommands();

    const excessArgs: Record<string, string[]> = {
      'list-repos': ['extra'],
      scan: ['a', 'b'],
      ping: ['extra'],
    };
    for (const [name, args] of Object.entries(excessArgs)) {
      const subcommand = subcommands.find((candidate) => candidate.name === name);
      if (!subcommand) throw new Error(`expected subcommand ${name}`);
      const result = await subcommand.run(args);
      expect(result).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
    }
  });

  it('update (story 3.3) gates the all-repos mode behind confirmation, rejecting unknown flags', async () => {
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

  it('update (story 3.3) runs the all-repos scope with --all --yes in any order', async () => {
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

  it('update (story 3.1) fails with no-active-edt when no EDT is active', async () => {
    const subcommands = buildTestSubcommands();
    const update = subcommands.find((subcommand) => subcommand.name === 'update');
    if (!update) throw new Error('expected update subcommand');

    const result = await update.run([]);

    expect(result).toMatchObject({ ok: false, error: { code: 'no-active-edt' } });
  });
});
