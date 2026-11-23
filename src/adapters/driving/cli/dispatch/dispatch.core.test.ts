import { describe, expect, it, vi } from 'vitest';
import { ok, err } from '../../../../core/result.js';
import type { ManifestPort } from '../../../../core/ports/vcs/manifest.js';
import type { RegistryPort } from '../../../../core/ports/storage/registry.js';
import type { EdtRegistryPort } from '../../../../core/ports/storage/edt-registry.js';
import { DEFAULT_SETTINGS } from '../../../../core/ports/storage/settings.js';
import { runCli, type Subcommand } from './dispatch.js';
import type { DockerPort } from '../../../../core/ports/runtime/docker.js';
import { assertUniqueSubcommandNames, buildSubcommands } from '../subcommands.js';
import { fakeState, fakeSubcommands, fakeEdtRegistry, fakeGitPort, buildTestSubcommands } from './dispatch.test-support.js';

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
        commands: [
          ...fakeSubcommands.map((subcommand) => ({ name: subcommand.name, usage: subcommand.usage })),
          { name: 'tui', usage: 'tui-back tui' },
          { name: 'mcp', usage: 'tui-back mcp' },
        ],
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

describe('runCli humanText hook', () => {
  const sub: Subcommand = {
    name: 'raw',
    usage: 'tui-back raw',
    run: async () => ok({ script: 'echo raw\n' }),
    humanText: (data) => (data as { script: string }).script,
  };

  it('prints the raw text on a TTY and the envelope when piped', async () => {
    expect((await runCli(['raw'], [sub], true)).output).toBe('echo raw\n');
    expect((await runCli(['raw'], [sub], false)).output).toBe('{"ok":true,"data":{"script":"echo raw\\n"}}\n');
  });
});


describe('subcommand registry guards — core', () => {
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


  it('buildSubcommands wires register/list-repos/scan/ping/edts/edt/update/realign/registry/list-routes/fire-request/dashboard without name collisions', () => {
    const subcommands = buildTestSubcommands();

    expect(subcommands.map((subcommand) => subcommand.name)).toEqual([
      'register',
      'list-repos',
      'scan',
      'ping',
      'edts',
      'dashboard',
      'edt',
      'update',
      'realign',
      'heal',
      'registry',
      'list-routes',
      'fire-request',
      'request-list',
      'request-fire',
      'request-delete',
      'install',
      'completion',
    ]);
    expect(() => assertUniqueSubcommandNames(subcommands)).not.toThrow();
  });

  it('completion bash returns the script (raw on a TTY, enveloped when piped) and rejects other args', async () => {
    const subcommands = buildTestSubcommands();
    const piped = await runCli(['completion', 'bash'], subcommands, false);
    const parsed = JSON.parse(piped.output);
    expect(piped.exitCode).toBe(0);
    expect(parsed.data.script).toContain('complete -o default -F _tui_back tui-back tb');
    expect(parsed.data.script).toContain('completion');

    const tty = await runCli(['completion', 'bash'], subcommands, true);
    expect(tty.output).toBe(parsed.data.script);

    for (const argv of [['completion'], ['completion', 'zsh'], ['completion', 'bash', 'x']]) {
      const bad = await runCli(argv, subcommands, false);
      expect(bad.exitCode).toBe(1);
      expect(JSON.parse(bad.output).error).toEqual({ code: 'invalid-argument', message: 'Usage: tui-back completion bash' });
    }
  });

  it('completion script derives the real edt/registry verbs and flags from the live registry', async () => {
    const piped = await runCli(['completion', 'bash'], buildTestSubcommands(), false);
    const script: string = JSON.parse(piped.output).data.script;
    expect(script).toContain('edt) words="create switch modify delete list fast-forward-shared" ;;');
    expect(script).toContain('registry) words="clean validate" ;;');
    expect(script).toContain('completion) words="bash" ;;');
    expect(script).toMatch(/"edt switch"\) words="[^"]*--to[^"]*--force/);
    expect(script).toMatch(/"edt create"\) words="[^"]*--topic[^"]*--member/);
    expect(script).toMatch(/"registry clean"\) words="[^"]*--yes[^"]*--path/);
    // Flag-only usages (e.g. update, register) stay flat, never verb-style.
    expect(script).not.toMatch(/\n\s+(update|register|realign|heal)\) words=/);
    expect(script).toMatch(/"update"\) words="[^"]*--migrations/);
  });

  it('edts rejects excess arguments and otherwise runs the divergence use-case', async () => {
    const subcommands = buildTestSubcommands();
    const edts = subcommands.find((subcommand) => subcommand.name === 'edts');
    if (!edts) throw new Error('expected edts subcommand');

    const excess = await edts.run(['extra']);
    expect(excess).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });

    const result = await edts.run([]);
    expect(result).toMatchObject({ ok: true, data: { services: [], unreachable: [], errors: [] } });
  });

  it('dashboard rejects arguments and otherwise returns the snapshot', async () => {
    const subcommands = buildTestSubcommands();
    const dashboard = subcommands.find((subcommand) => subcommand.name === 'dashboard');
    if (!dashboard) throw new Error('expected dashboard subcommand');

    expect(await dashboard.run(['extra'])).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });

    const result = await dashboard.run([]);
    expect(result).toMatchObject({
      ok: true,
      data: { status: 'no-active-edt', edt: null, services: [], others: [], registry: { repoCount: 0 } },
    });
  });

  it('dashboard passes its ports through to a populated snapshot', async () => {
    const edtRegistry: EdtRegistryPort = {
      ...fakeEdtRegistry(),
      list: async () =>
        ok([
          { ulid: 'e1', topic: 'topic-a', createdAt: '2026-01-01T00:00:00Z', status: 'active' as const, members: [{ service: 'svc-a', repoPath: '/r/a', branch: 'feat/x' }] },
        ]),
    };
    const subcommands = buildTestSubcommands({
      edtRegistry,
      state: { ...fakeState(), readActiveEdt: async () => ok('e1') },
      registry: {
        list: async () => ok(['/r/a', '/r/o']),
        add: async () => ok(undefined),
        exists: async () => ok(true),
        scan: async () => ok({ candidates: [], skipped: [] }),
        reset: async () => ok({ path: '/p', backupPath: null }),
        remove: async () => ok(undefined),
      },
      manifest: {
        load: async (path: string) =>
          ok({ service: path === '/r/o' ? 'svc-o' : 'svc-a', container: 'ctr-a', healthUrl: 'http://a/h', sharedBranch: 'development', modules: {} }),
      },
      git: fakeGitPort({ currentBranch: async (path: string) => ok(path === '/r/o' ? 'hotfix' : 'main') }),
      docker: { getContainerHealth: async () => ok('restarting' as const) } as unknown as DockerPort,
      healthProbe: { probe: async () => ok({ healthy: true, status: 200 }) },
    });
    const dashboard = subcommands.find((subcommand) => subcommand.name === 'dashboard');
    if (!dashboard) throw new Error('expected dashboard subcommand');

    const result = await dashboard.run([]);
    expect(result).toMatchObject({
      ok: true,
      data: {
        status: 'active',
        edt: { topic: 'topic-a', serviceCount: 1 },
        services: [{ service: 'svc-a', status: { ok: true, value: { state: 'inconsistent', verified: true, container: 'restarting' } }, branch: 'main', expectedBranch: 'feat/x', drift: 'drifted' }],
        others: [{ service: 'svc-o', path: '/r/o', branch: 'hotfix', expectedBranch: 'development', drift: 'drifted' }],
      },
    });
  });

  it('dashboard reads the health check toggle from settings: JSON carries healthCheck "disabled"', async () => {
    const probe = vi.fn(async () => ok({ healthy: false, status: 503, reason: 'HTTP 503' }));
    const subcommands = buildTestSubcommands({
      edtRegistry: {
        ...fakeEdtRegistry(),
        list: async () =>
          ok([{ ulid: 'e1', topic: 'topic-a', createdAt: '2026-01-01T00:00:00Z', status: 'active' as const, members: [{ service: 'svc-a', repoPath: '/r/a', branch: 'main' }] }]),
      },
      state: { ...fakeState(), readActiveEdt: async () => ok('e1') },
      manifest: { load: async () => ok({ service: 'svc-a', container: 'ctr-a', healthUrl: 'http://a/h', sharedBranch: 'development', modules: {} }) },
      git: fakeGitPort({ currentBranch: async () => ok('main') }),
      docker: { getContainerHealth: async () => ok('up' as const) } as unknown as DockerPort,
      healthProbe: { probe },
      settings: {
        load: async () => ok({ settings: { ...DEFAULT_SETTINGS, services: { healthCheckDisabled: ['svc-a'] } }, warning: null }),
        save: async () => ok(undefined),
      },
    });
    const dashboard = subcommands.find((subcommand) => subcommand.name === 'dashboard');
    if (!dashboard) throw new Error('expected dashboard subcommand');

    const result = await dashboard.run([]);
    expect(result).toMatchObject({
      ok: true,
      data: { services: [{ service: 'svc-a', status: { ok: true, value: { state: 'up', verified: false, container: 'up', healthCheck: 'disabled' } } }] },
    });
    expect(probe).not.toHaveBeenCalled();
  });

  it('dashboard falls back to default settings with a stderr warning when settings cannot be read', async () => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const subcommands = buildTestSubcommands({
        settings: { load: async () => err('settings-read-error', 'settings.yaml unreadable'), save: async () => ok(undefined) },
      });
      const dashboard = subcommands.find((subcommand) => subcommand.name === 'dashboard');
      if (!dashboard) throw new Error('expected dashboard subcommand');
      expect((await dashboard.run([])).ok).toBe(true);
      expect(stderr).toHaveBeenCalledWith(expect.stringContaining('could not read settings, using defaults: settings.yaml unreadable'));
    } finally {
      stderr.mockRestore();
    }
  });


  it('register --reset routes to the reset use-case, rejecting extra arguments', async () => {
    const reset = vi.fn(async () => ok({ path: '/p', backupPath: '/c/registry.yaml.bak-1' }));
    const registry: RegistryPort = {
      list: async () => ok([]),
      add: async () => ok(undefined),
      exists: async () => ok(false),
      scan: async () => ok({ candidates: [], skipped: [] }),
      reset,
      remove: async () => ok(undefined),
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
