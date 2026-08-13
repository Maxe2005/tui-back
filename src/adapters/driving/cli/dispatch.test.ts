import { describe, expect, it, vi } from 'vitest';
import { ok, err } from '../../../core/result.js';
import type { ManifestPort } from '../../../core/ports/manifest.js';
import type { RegistryPort } from '../../../core/ports/registry.js';
import type { LockPort } from '../../../core/ports/lock.js';
import { runCli, type Subcommand } from './dispatch.js';
import { assertUniqueSubcommandNames, buildSubcommands } from './subcommands.js';

function fakeLock(): LockPort {
  return {
    acquire: async (resourceKey) => ok({ release: async () => ok(undefined) }),
  };
}

const fakeSubcommands: Subcommand[] = [
  { name: 'ping', run: async () => ok({ message: 'pong' }) },
  { name: 'fail', run: async () => err('fixture-failure', 'it failed on purpose') },
  {
    name: 'throws',
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
    const unrenderable: Subcommand[] = [{ name: 'unrenderable', run: async () => ok(circular) }];

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
      { name: 'ping', run: async () => ok({}) },
      { name: 'ping', run: async () => ok({}) },
    ];

    expect(() => assertUniqueSubcommandNames(duplicated)).toThrow('Duplicate subcommand name: ping');
  });

  it('assertUniqueSubcommandNames accepts a collision-free registry', () => {
    const clean: Subcommand[] = [
      { name: 'register', run: async () => ok({}) },
      { name: 'scan', run: async () => ok({}) },
    ];

    expect(() => assertUniqueSubcommandNames(clean)).not.toThrow();
  });

  it('buildSubcommands wires register/list-repos/scan/ping without name collisions', () => {
    const registry: RegistryPort = {
      list: async () => ok([]),
      add: async () => ok(undefined),
      exists: async () => ok(false),
      scan: async () => ok({ candidates: [], skipped: [] }),
      reset: async () => ok({ path: '/p', backupPath: null }),
    };
    const manifest: ManifestPort = { load: async () => err('manifest-not-found', 'none') };

    const subcommands = buildSubcommands({ registry, manifest, lock: fakeLock(), registryResourceKey: '/cfg/registry.yaml' });

    expect(subcommands.map((subcommand) => subcommand.name)).toEqual(['register', 'list-repos', 'scan', 'ping']);
    expect(() => assertUniqueSubcommandNames(subcommands)).not.toThrow();
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

    const subcommands = buildSubcommands({ registry, manifest, lock: fakeLock(), registryResourceKey: '/cfg/registry.yaml' });
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
    const registry: RegistryPort = {
      list: async () => ok([]),
      add: async () => ok(undefined),
      exists: async () => ok(false),
      scan: async () => ok({ candidates: [], skipped: [] }),
      reset: async () => ok({ path: '/p', backupPath: null }),
    };
    const manifest: ManifestPort = { load: async () => err('manifest-not-found', 'none') };

    const subcommands = buildSubcommands({ registry, manifest, lock: fakeLock(), registryResourceKey: '/cfg/registry.yaml' });

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
