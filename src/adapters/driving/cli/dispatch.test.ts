import { describe, expect, it, vi } from 'vitest';
import { ok, err } from '../../../core/result.js';
import type { ManifestPort } from '../../../core/ports/manifest.js';
import type { RegistryPort } from '../../../core/ports/registry.js';
import type { EdtRegistryPort } from '../../../core/ports/edt-registry.js';
import type { GitPort } from '../../../core/ports/git.js';
import type { LockPort } from '../../../core/ports/lock.js';
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
    return { add: async () => ok(undefined), list: async () => ok([]), setStatus: async () => ok(undefined), update: async () => ok(undefined) };
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
      listBranches: async () => ok([]),
      renameBranch: async () => ok(undefined),
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
      state: fakeState(),
      ...overrides,
    });
  }

  it('buildSubcommands wires register/list-repos/scan/ping/edts/edt without name collisions', () => {
    const subcommands = buildTestSubcommands();

    expect(subcommands.map((subcommand) => subcommand.name)).toEqual([
      'register',
      'list-repos',
      'scan',
      'ping',
      'edts',
      'edt',
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
});
