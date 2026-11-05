import { describe, expect, it, vi } from 'vitest';
import { ok, err } from '../../../core/result.js';
import type { ContainerPort } from '../../../core/ports/container.js';
import type { DevAuthPort } from '../../../core/ports/dev-auth.js';
import type { ManifestPort } from '../../../core/ports/manifest.js';
import type { MigrationPort } from '../../../core/ports/migration.js';
import type { RestartPort } from '../../../core/ports/restart.js';
import type { RegistryPort } from '../../../core/ports/registry.js';
import type { EdtRegistryPort } from '../../../core/ports/edt-registry.js';
import type { GitPort } from '../../../core/ports/git.js';
import type { LockPort } from '../../../core/ports/lock.js';
import type { RouteScannerPort } from '../../../core/ports/route-scanner.js';
import type { SavedRequest, SavedRequestPort } from '../../../core/ports/saved-request.js';
import { DEFAULT_SETTINGS, type Settings, type SettingsPort } from '../../../core/ports/settings.js';
import type { StatePort } from '../../../core/ports/state.js';
import { runCli, type Subcommand } from './dispatch.js';
import type { DockerPort } from '../../../core/ports/docker.js';
import { assertUniqueSubcommandNames, buildSubcommands } from './subcommands.js';

// `registry clean`'s interactive TTY branch drives a real `node:readline/promises` prompt —
// mocked here so the list-then-confirm flow is exercised under test (the e2e suite's
// spawnSync stdin is never a real TTY).
vi.mock('node:readline/promises', () => ({
  createInterface: vi.fn(),
}));
import { createInterface } from 'node:readline/promises';

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
    readCommandHistory: async () => ok(null),
    writeCommandHistory: async () => ok(undefined),
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

  function fakeSavedRequests(): SavedRequestPort {
    return {
      save: async (request) => ok(request),
      overwrite: async (_name, request) => ok(request),
      get: async (name) => err('saved-request-not-found', `No saved request named "${name}"`),
      list: async () => ok([]),
      remove: async (name) => err('saved-request-not-found', `No saved request named "${name}"`),
    };
  }

  function fakeGitPort(overrides: Partial<GitPort> = {}): GitPort {
    return {
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
      discardAll: async () => ok(undefined),
      diffNameOnly: async () => ok([]),
      headRevision: async () => ok('head-a'),
      diffStat: async () => ok({ files: 0, insertions: 0, deletions: 0 }),
      discardPathsToHead: async () => ok(undefined),
      isRebaseInProgress: async () => ok(false),
      hasUnmergedPaths: async () => ok(false),
      listUnmergedPaths: async () => ok([] as string[]),
      readWorktreeFile: async () => ok(""),
      writeResolvedFile: async () => ok(undefined),
      checkoutSide: async () => ok(undefined),
      finalizeMerge: async () => ok(undefined),
      listBranches: async () => ok([]),
      renameBranch: async () => ok(undefined),
      listRemoteBranches: async () => ok([]),
      createTrackingBranch: async () => ok(undefined),
      stagePaths: async () => ok(undefined),
      commit: async () => ok(undefined),
      isBranchMerged: async () => ok(true),
      hasStash: async () => ok(false),
      fetchRemote: async () => ok(undefined),
      listUnpushedCommits: async () => ok([] as string[]),
      listVersionBumpCommits: async () => ok({ endedBy: "exhausted" as const, scanned: 0 }),
      listBranchesContaining: async () => ok([] as string[]),
      ...overrides,
    };
  }

  function buildTestSubcommands(overrides: Partial<Parameters<typeof buildSubcommands>[0]> = {}) {
    const registry: RegistryPort = {
      list: async () => ok([]),
      add: async () => ok(undefined),
      exists: async () => ok(false),
      scan: async () => ok({ candidates: [], skipped: [] }),
      reset: async () => ok({ path: '/p', backupPath: null }),
      remove: async () => ok(undefined),
    };
    const manifest: ManifestPort = { load: async () => err('manifest-not-found', 'none') };
    const container: ContainerPort = { restart: async () => ok(undefined) };
    const migration: MigrationPort = { run: async () => ok({ output: '' }) };
    const restart: RestartPort = { run: async () => ok({ output: '' }) };
    const scanner: RouteScannerPort = { scan: async () => ok([]) };
    const auth: DevAuthPort = { getSession: async () => ok({ cookie: 'sid=abc' }) };
    const git: GitPort = fakeGitPort();

    return buildSubcommands({
      registry,
      manifest,
      manifestCarry: { capture: async () => ({ ok: true, data: { kind: 'absent' } }), restore: async () => ({ ok: true, data: undefined }) },
      lock: fakeLock(),
      registryResourceKey: '/cfg/registry.yaml',
      edtsBaseDir: '/data/edts',
      edtRegistry: fakeEdtRegistry(),
      edtRegistryResourceKey: '/cfg/edts.yaml',
      git,
      container,
      docker: { getContainerHealth: async () => ok('up' as const) } as unknown as DockerPort,
      migration,
      restart,
      state: fakeState(),
      settings: { load: async () => ok({ settings: DEFAULT_SETTINGS, warning: null }), save: async () => ok(undefined) },
      scanner,
      auth,
      savedRequests: fakeSavedRequests(),
      ...overrides,
    });
  }

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
      'registry',
      'list-routes',
      'fire-request',
      'request-list',
      'request-fire',
      'request-delete',
    ]);
    expect(() => assertUniqueSubcommandNames(subcommands)).not.toThrow();
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

  it('list-routes rejects missing/excess arguments and otherwise delegates to the use-case', async () => {
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

  it('fire-request rejects missing/bad-arity/blank arguments and otherwise delegates to the use-case', async () => {
    const subcommands = buildTestSubcommands();
    const fireRequestCmd = subcommands.find((subcommand) => subcommand.name === 'fire-request');
    if (!fireRequestCmd) throw new Error('expected fire-request subcommand');

    expect(fireRequestCmd.usage).toBe(
      "tui-back fire-request <repoPath> <METHOD> <path> [--body <json>] [--query name=value]... [--header 'Name: value']... [--save <name>]",
    );

    const missing = await fireRequestCmd.run([]);
    expect(missing).toMatchObject({ ok: false, error: { code: 'missing-argument' } });

    for (const args of [['/a'], ['/a', 'GET'], ['/a', 'GET', '/x', 'extra'], ['/a', '  ', '/x']]) {
      const rejected = await fireRequestCmd.run(args);
      expect(rejected).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
    }

    // The fixture manifest answers manifest-not-found, which the use-case propagates —
    // proving the wrapper reached the use-case itself rather than rejecting locally.
    const result = await fireRequestCmd.run(['/repos/gateway', 'GET', '/users']);
    expect(result).toMatchObject({ ok: false, error: { code: 'manifest-not-found' } });
  });

  it('fire-request parses --body/--query/--header and rejects malformed flags', async () => {
    const subcommands = buildTestSubcommands();
    const fireRequestCmd = subcommands.find((subcommand) => subcommand.name === 'fire-request');
    if (!fireRequestCmd) throw new Error('expected fire-request subcommand');

    for (const args of [
      ['/a', 'POST', '/x', '--body', '{oops'],
      ['/a', 'POST', '/x', '--body'],
      ['/a', 'POST', '/x', '--body', '{}', '--body', '{}'],
      ['/a', 'GET', '/x', '--query', 'novalue'],
      ['/a', 'GET', '/x', '--query', '=v'],
      ['/a', 'GET', '/x', '--header', 'NoColon'],
      ['/a', 'GET', '/x', '--bogus', 'v'],
      ['/a', '--body', '{}'],
      ['/a', 'GET', '/x', '--header', '--body'],
      ['/a', 'GET', '/x', '--query', 'q=1', '--query', 'q=2'],
      ['/a', 'GET', '/x', '--header', 'X-A: 1', '--header', 'x-a: 2'],
    ]) {
      const rejected = await fireRequestCmd.run(args);
      expect(rejected).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
    }

    // Well-formed flags reach the use-case (manifest-not-found from the fixture).
    const result = await fireRequestCmd.run([
      '/repos/gateway', 'POST', '/users', '--body', '{"a":1}', '--query', 'q=a=b', '--header', 'X-Trace: t1',
    ]);
    expect(result).toMatchObject({ ok: false, error: { code: 'manifest-not-found' } });
  });

  it('fire-request sends the parsed flags as the request body, query and headers', async () => {
    const fetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    try {
      const subcommands = buildTestSubcommands({
        manifest: { load: async () => ok({ service: 'gw', container: 'gw', sharedBranch: 'development', modules: { 'route-explorer': { baseUrl: 'http://localhost:3000' } } }) },
        scanner: { scan: async () => ok([{ method: 'POST', path: '/users/{id}' }]) },
        auth: { getSession: async () => ok({ cookie: 'sid=abc' }) },
      });
      const fireRequestCmd = subcommands.find((subcommand) => subcommand.name === 'fire-request');
      if (!fireRequestCmd) throw new Error('expected fire-request subcommand');

      const result = await fireRequestCmd.run([
        '/repos/gateway', 'POST', '/users/7', '--body', '{"a":1}', '--query', 'q=a=b', '--header', 'X-Trace:  t1 ',
      ]);

      expect(result).toMatchObject({ ok: true, data: { status: 200 } });
      const [url, init] = fetch.mock.calls[0] ?? [];
      expect(url).toBe('http://localhost:3000/users/7?q=a%3Db');
      expect(init?.body).toBe('{"a":1}');
      const headers = new Headers(init?.headers);
      expect(headers.get('x-trace')).toBe('t1');
      expect(headers.get('content-type')).toBe('application/json');
      expect(headers.get('cookie')).toBe('sid=abc');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('fire-request --save persists the fired request and rejects a colliding name with duplicate-request-name', async () => {
    const fetch = vi.fn(async () => new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    try {
      const saved: SavedRequest[] = [];
      const subcommands = buildTestSubcommands({
        manifest: { load: async () => ok({ service: 'gw', container: 'gw', sharedBranch: 'development', modules: { 'route-explorer': { baseUrl: 'http://localhost:3000' } } }) },
        scanner: { scan: async () => ok([{ method: 'POST', path: '/users' }]) },
        auth: { getSession: async () => ok({ cookie: 'sid=abc' }) },
        savedRequests: {
          ...fakeSavedRequests(),
          get: async (name) => {
            const found = saved.find((item) => item.name === name);
            return found === undefined ? err('saved-request-not-found', `No saved request named "${name}"`) : ok({ ...found });
          },
          save: async (request) => {
            if (saved.some((item) => item.name === request.name)) {
              return err('duplicate-request-name', `A request named "${request.name}" already exists`);
            }
            saved.push({ ...request });
            return ok(request);
          },
        },
      });
      const fireRequestCmd = subcommands.find((subcommand) => subcommand.name === 'fire-request');
      if (!fireRequestCmd) throw new Error('expected fire-request subcommand');

      const first = await fireRequestCmd.run([
        '/repos/gateway',
        'POST',
        '/users',
        '--query',
        'q=1',
        '--header',
        'X-Trace: t1',
        '--body',
        '{"a":1}',
        '--save',
        'create-user',
      ]);
      expect(first).toMatchObject({ ok: true, data: { status: 200 } });
      expect(saved).toHaveLength(1);
      expect(saved[0]).toMatchObject({
        name: 'create-user',
        repoPath: '/repos/gateway',
        method: 'POST',
        path: '/users',
        query: { q: '1' },
        headers: { 'X-Trace': 't1' },
        bodyText: '{"a":1}',
        contentType: 'application/json',
      });

      // A colliding name is rejected before anything is fired: no second fetch, same record kept.
      const callsBefore = fetch.mock.calls.length;
      const second = await fireRequestCmd.run(['/repos/gateway', 'POST', '/users', '--save', 'create-user']);
      expect(second).toMatchObject({ ok: false, error: { code: 'duplicate-request-name' } });
      expect(fetch.mock.calls.length).toBe(callsBefore);
      expect(saved).toHaveLength(1);

      expect(await fireRequestCmd.run(['/repos/gateway', 'GET', '/users', '--save'])).toMatchObject({
        ok: false,
        error: { code: 'invalid-argument' },
      });
      expect(await fireRequestCmd.run(['/repos/gateway', 'GET', '/users', '--save', 'a', '--save', 'b'])).toMatchObject({
        ok: false,
        error: { code: 'invalid-argument' },
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('request-list shows stale flags and narrows with --repo', async () => {
    const subcommands = buildTestSubcommands({
      manifest: { load: async () => ok({ service: 'gw', container: 'gw', sharedBranch: 'development', modules: { 'route-explorer': {} } }) },
      scanner: { scan: async () => ok([{ method: 'GET', path: '/users' }]) },
      savedRequests: {
        ...fakeSavedRequests(),
        list: async () =>
          ok([
            { id: 'id-1', name: 'kept', repoPath: '/repos/gateway', method: 'GET', path: '/users', createdAt: '2026-10-06T00:00:00.000Z', updatedAt: '2026-10-06T00:00:00.000Z' },
            { id: 'id-2', name: 'gone', repoPath: '/repos/gateway', method: 'GET', path: '/vanished', createdAt: '2026-10-06T00:00:00.000Z', updatedAt: '2026-10-06T00:00:00.000Z' },
          ]),
      },
    });
    const requestList = subcommands.find((subcommand) => subcommand.name === 'request-list');
    if (!requestList) throw new Error('expected request-list subcommand');

    const listed = await requestList.run([]);
    expect(listed).toMatchObject({
      ok: true,
      data: { requests: [{ name: 'kept', stale: false }, { name: 'gone', stale: true }] },
    });

    const narrowed = await requestList.run(['--repo', '/repos/other']);
    expect(narrowed).toMatchObject({ ok: true, data: { requests: [] } });

    expect(await requestList.run(['--bogus'])).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
    expect(await requestList.run(['--repo'])).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
  });

  it('request-fire re-fires by name with overrides, persistence flags and the stale hard gate', async () => {
    const fetch = vi.fn(async () => new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    try {
      const subcommands = buildTestSubcommands({
        manifest: { load: async () => ok({ service: 'gw', container: 'gw', sharedBranch: 'development', modules: { 'route-explorer': { baseUrl: 'http://localhost:3000' } } }) },
        scanner: { scan: async () => ok([{ method: 'GET', path: '/users' }]) },
        auth: { getSession: async () => ok({ cookie: 'sid=abc' }) },
        savedRequests: {
          ...fakeSavedRequests(),
          get: async (name) =>
            name === 'list-users'
              ? ok({ id: 'id-1', name, repoPath: '/repos/gateway', method: 'GET', path: '/users', createdAt: '2026-10-06T00:00:00.000Z', updatedAt: '2026-10-06T00:00:00.000Z' })
              : name === 'stale-one'
                ? ok({ id: 'id-2', name, repoPath: '/repos/gateway', method: 'GET', path: '/vanished', createdAt: '2026-10-06T00:00:00.000Z', updatedAt: '2026-10-06T00:00:00.000Z' })
                : err('saved-request-not-found', `No saved request named "${name}"`),
        },
      });
      const requestFire = subcommands.find((subcommand) => subcommand.name === 'request-fire');
      if (!requestFire) throw new Error('expected request-fire subcommand');

      expect(await requestFire.run([])).toMatchObject({ ok: false, error: { code: 'missing-argument' } });
      expect(await requestFire.run(['missing'])).toMatchObject({ ok: false, error: { code: 'saved-request-not-found' } });
      expect(fetch).not.toHaveBeenCalled();

      const fired = await requestFire.run(['list-users', '--query', 'q=1']);
      expect(fired).toMatchObject({ ok: true, data: { status: 200 } });

      const stale = await requestFire.run(['stale-one']);
      expect(stale).toMatchObject({ ok: false, error: { code: 'unknown-route' } });

      expect(await requestFire.run(['list-users', '--overwrite', '--save-as', 'other'])).toMatchObject({
        ok: false,
        error: { code: 'invalid-argument' },
      });
      expect(await requestFire.run(['list-users', '--bogus', 'v'])).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('request-fire --overwrite updates the original and --save-as stores a new record', async () => {
    const fetch = vi.fn(async () => new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    try {
      const rows = new Map<string, SavedRequest>([
        ['base', { id: 'id-1', name: 'base', repoPath: '/repos/gateway', method: 'GET', path: '/users', query: { q: '1' }, createdAt: '2026-10-06T00:00:00.000Z', updatedAt: '2026-10-06T00:00:00.000Z' }],
        ['taken', { id: 'id-2', name: 'taken', repoPath: '/repos/gateway', method: 'GET', path: '/users', createdAt: '2026-10-06T00:00:00.000Z', updatedAt: '2026-10-06T00:00:00.000Z' }],
      ]);
      const overwritten: string[] = [];
      const created: string[] = [];
      const subcommands = buildTestSubcommands({
        manifest: { load: async () => ok({ service: 'gw', container: 'gw', sharedBranch: 'development', modules: { 'route-explorer': { baseUrl: 'http://localhost:3000' } } }) },
        scanner: { scan: async () => ok([{ method: 'GET', path: '/users' }]) },
        auth: { getSession: async () => ok({ cookie: 'sid=abc' }) },
        savedRequests: {
          ...fakeSavedRequests(),
          save: async (request) => {
            created.push(request.name);
            const record = { ...request };
            rows.set(request.name, record);
            return ok(record);
          },
          overwrite: async (name, request) => {
            overwritten.push(name);
            const existing = rows.get(name);
            if (existing === undefined) {
              return err('saved-request-not-found', `No saved request named "${name}"`);
            }
            const next = { ...request, id: existing.id, createdAt: existing.createdAt, name };
            rows.set(name, next);
            return ok(next);
          },
          get: async (name) => {
            const found = rows.get(name);
            return found === undefined ? err('saved-request-not-found', `No saved request named "${name}"`) : ok({ ...found });
          },
        },
      });
      const requestFire = subcommands.find((subcommand) => subcommand.name === 'request-fire');
      if (!requestFire) throw new Error('expected request-fire subcommand');

      const updated = await requestFire.run(['base', '--query', 'q=2', '--overwrite']);
      expect(updated).toMatchObject({ ok: true, data: { status: 200 } });
      expect(overwritten).toEqual(['base']);
      expect(rows.get('base')).toMatchObject({ query: { q: '2' } });

      const forked = await requestFire.run(['base', '--query', 'q=3', '--save-as', 'copy']);
      expect(forked).toMatchObject({ ok: true, data: { status: 200 } });
      expect(created).toEqual(['copy']);
      expect(rows.get('copy')).toMatchObject({ name: 'copy', query: { q: '3' } });
      expect(rows.get('base')).toMatchObject({ query: { q: '2' } });

      const callsBefore = fetch.mock.calls.length;
      const collision = await requestFire.run(['base', '--save-as', 'taken']);
      expect(collision).toMatchObject({ ok: false, error: { code: 'duplicate-request-name' } });
      expect(fetch.mock.calls.length).toBe(callsBefore);
      expect(created).toEqual(['copy']);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('request-delete removes by exact name and reports unknown names', async () => {
    const removed: string[] = [];
    const subcommands = buildTestSubcommands({
      savedRequests: {
        ...fakeSavedRequests(),
        remove: async (name) =>
          name === 'list-users' ? (removed.push(name), ok(undefined)) : err('saved-request-not-found', `No saved request named "${name}"`),
      },
    });
    const requestDelete = subcommands.find((subcommand) => subcommand.name === 'request-delete');
    if (!requestDelete) throw new Error('expected request-delete subcommand');

    expect(await requestDelete.run([])).toMatchObject({ ok: false, error: { code: 'missing-argument' } });
    expect(await requestDelete.run(['a', 'b'])).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
    expect(await requestDelete.run(['missing'])).toMatchObject({ ok: false, error: { code: 'saved-request-not-found' } });
    expect(await requestDelete.run(['list-users'])).toEqual({ ok: true, data: { name: 'list-users' } });
    expect(removed).toEqual(['list-users']);
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

  // --branches mistakes reject with invalid-argument instead of resolving to a surprising
  // default.
  describe('edt delete --branches validation', () => {
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

  describe('edt switch --restart (FR-37)', () => {
    const target = {
      ulid: 'ulid-1',
      topic: 'demo',
      createdAt: '2026-08-18T00:00:00.000Z',
      status: 'inactive' as const,
      members: [{ service: 'svc-a', repoPath: '/repo/a', branch: 'feat/a' }],
    };

    function restartSetup(opts: { healthy?: boolean; mode?: 'none' | 'simple' | 'clean'; withHealthUrl?: boolean; healthCheckDisabled?: string[] } = {}) {
      const writeActiveEdt = vi.fn(async () => ok(undefined));
      const containerRestart = vi.fn(async () => ok(undefined));
      const probe = vi.fn(async () => ok({ healthy: opts.healthy ?? true, status: opts.healthy === false ? 503 : 200, ...(opts.healthy === false ? { reason: 'HTTP 503' } : {}) }));
      const subcommands = buildTestSubcommands({
        registry: {
          list: async () => ok(['/repo/a', '/repo/b']),
          add: async () => ok(undefined),
          exists: async () => ok(true),
          scan: async () => ok({ candidates: [], skipped: [] }),
          reset: async () => ok({ path: '/p', backupPath: null }),
          remove: async () => ok(undefined),
        },
        manifest: {
          load: async (repoPath: string) =>
            ok({
              service: repoPath === '/repo/a' ? 'svc-a' : 'svc-b',
              container: repoPath === '/repo/a' ? 'ctr-a' : undefined,
              ...(opts.withHealthUrl === false ? {} : { healthUrl: 'http://localhost:1/health' }),
              sharedBranch: 'development',
              modules: {},
            }),
        },
        edtRegistry: { ...fakeEdtRegistry(), list: async () => ok([target]) },
        state: { ...fakeState(), writeActiveEdt },
        container: { restart: containerRestart },
        settings: {
          load: async () =>
            ok({
              settings: { ...DEFAULT_SETTINGS, switch: { restartMode: opts.mode ?? 'none' }, services: { healthCheckDisabled: opts.healthCheckDisabled ?? [] } },
              warning: null,
            }),
          save: async () => ok(undefined),
        },
        docker: {
          streamLogs: () => () => {},
          fetchLogsBefore: async () => ok([]),
          getContainerHealth: async () => ok('up' as const),
          restartContainer: async () => ok(undefined),
        },
        healthProbe: { probe },
      });
      const edt = subcommands.find((subcommand) => subcommand.name === 'edt');
      if (!edt) throw new Error('expected edt subcommand');
      return { edt, writeActiveEdt, containerRestart, probe, subcommands };
    }

    it('rejects an unknown --restart value before anything is touched', async () => {
      const { edt, writeActiveEdt } = restartSetup();
      const result = await edt.run(['switch', '--to', 'demo', '--restart', 'bogus']);
      expect(result).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
      expect(writeActiveEdt).not.toHaveBeenCalled();
      expect(await edt.run(['switch', '--to', 'demo', '--restart'])).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
    });

    it('without the flag and with the default none, the output is exactly the switch result — no restart key', async () => {
      const { edt, containerRestart } = restartSetup();
      const result = await edt.run(['switch', '--to', 'demo']);
      expect(result.ok).toBe(true);
      expect(result.ok && 'restart' in (result.data as object)).toBe(false);
      expect(containerRestart).not.toHaveBeenCalled();
    });

    it('--restart simple restarts changed services, verifies them and emits rows in the envelope', async () => {
      const { edt, containerRestart, probe } = restartSetup();
      const result = await edt.run(['switch', '--to', 'demo', '--restart', 'simple']);
      expect(result.ok).toBe(true);
      expect(containerRestart).toHaveBeenCalledWith('ctr-a');
      expect(probe).toHaveBeenCalledWith('http://localhost:1/health', expect.any(Number));
      expect(result.ok && (result.data as { restart: unknown[] }).restart).toEqual(
        expect.arrayContaining([{ service: 'svc-a', mode: 'simple', state: 'functional' }]),
      );
    });

    it('--restart never probes a service whose health check is disabled in settings', async () => {
      const { edt, containerRestart, probe } = restartSetup({ healthy: false, healthCheckDisabled: ['svc-a'] });
      const result = await edt.run(['switch', '--to', 'demo', '--restart', 'simple']);
      expect(result.ok).toBe(true);
      expect(containerRestart).toHaveBeenCalledWith('ctr-a');
      expect(probe).not.toHaveBeenCalled();
      expect(result.ok && (result.data as { restart: unknown[] }).restart).toEqual(
        expect.arrayContaining([{ service: 'svc-a', mode: 'simple', state: 'up-unverified' }]),
      );
    });

    it('the flag overrides the setting, and an absent flag uses it', async () => {
      const viaSetting = restartSetup({ mode: 'clean', withHealthUrl: false });
      const fromSetting = await viaSetting.edt.run(['switch', '--to', 'demo']);
      expect(fromSetting.ok && (fromSetting.data as { restart: Array<{ mode: string; state: string; detail?: string }> }).restart[0]).toMatchObject({
        service: 'svc-a',
        mode: 'clean',
        state: 'up-unverified',
        detail: expect.stringContaining('no clean-restart recipe'),
      });
      const overridden = restartSetup({ mode: 'clean' });
      const none = await overridden.edt.run(['switch', '--to', 'demo', '--restart', 'none']);
      expect(none.ok && 'restart' in (none.data as object)).toBe(false);
    });

    it('exits non-zero with the rows in the envelope when a targeted service ends unhealthy', async () => {
      const { subcommands } = restartSetup({ healthy: false });
      // The unhealthy verdict only lands once the 30 s verification budget is spent.
      let rendered: Awaited<ReturnType<typeof runCli>>;
      vi.useFakeTimers();
      try {
        const pending = runCli(['edt', 'switch', '--to', 'demo', '--restart', 'simple'], subcommands, false);
        await vi.advanceTimersByTimeAsync(31_000);
        rendered = await pending;
      } finally {
        vi.useRealTimers();
      }
      expect(rendered.exitCode).toBe(1);
      const line = JSON.parse(rendered.output) as { ok: boolean; error: { code: string; details: { restart: Array<{ service: string; state: string }> } } };
      expect(line.error.code).toBe('switch-restart-needs-attention');
      expect(line.error.details.restart).toEqual(expect.arrayContaining([expect.objectContaining({ service: 'svc-a', state: 'unhealthy' })]));
    });

    it('rejects a restart request up front when the Docker port is not wired', async () => {
      const subcommands = buildTestSubcommands({ edtRegistry: { ...fakeEdtRegistry(), list: async () => ok([target]) } });
      const edt = subcommands.find((subcommand) => subcommand.name === 'edt');
      if (!edt) throw new Error('expected edt subcommand');
      expect(await edt.run(['switch', '--to', 'demo', '--restart', 'simple'])).toMatchObject({ ok: false, error: { code: 'restart-unavailable' } });
    });
  });

  describe('realign', () => {
    const active = {
      ulid: 'e1',
      topic: 'demo',
      createdAt: '2026-08-18T00:00:00.000Z',
      status: 'active' as const,
      members: [{ service: 'svc-a', repoPath: '/repo/a', branch: 'feat/a' }],
    };

    function realignSetup(
      opts: { checkout?: GitPort['checkout']; healthy?: boolean; withDocker?: boolean; registryList?: RegistryPort['list']; settings?: SettingsPort } = {},
    ) {
      const checkout = vi.fn(opts.checkout ?? (async () => ok(undefined)));
      const acquire = vi.fn(async () => ok({ release: async () => ok(undefined) }));
      const probe = vi.fn(async () => ok({ healthy: opts.healthy ?? true, status: 200 }));
      const containerRestart = vi.fn(async () => ok(undefined));
      const logAction = vi.fn(async () => ok(undefined));
      const subcommands = buildTestSubcommands({
        registry: {
          list: opts.registryList ?? (async () => ok(['/repo/a', '/repo/b'])),
          add: async () => ok(undefined),
          exists: async () => ok(true),
          scan: async () => ok({ candidates: [], skipped: [] }),
          reset: async () => ok({ path: '/p', backupPath: null }),
          remove: async () => ok(undefined),
        },
        ...(opts.settings !== undefined ? { settings: opts.settings } : {}),
        manifest: {
          load: async (repoPath: string) =>
            ok({
              service: repoPath === '/repo/a' ? 'svc-a' : 'svc-b',
              container: repoPath === '/repo/a' ? 'ctr-a' : undefined,
              healthUrl: 'http://localhost:1/health',
              sharedBranch: 'develop',
              modules: {},
            }),
        },
        // Both repos sit on `development`: svc-a drifted from feat/a, svc-b from develop.
        git: fakeGitPort({ checkout }),
        lock: { acquire, peek: async () => ok({ locked: false }) },
        edtRegistry: { ...fakeEdtRegistry(), list: async () => ok([active]), logAction },
        state: { ...fakeState(), readActiveEdt: async () => ok('e1') },
        container: { restart: containerRestart },
        ...(opts.withDocker === false
          ? {}
          : {
              docker: {
                streamLogs: () => () => {},
                fetchLogsBefore: async () => ok([]),
                getContainerHealth: async () => ok('up' as const),
                restartContainer: async () => ok(undefined),
              },
              healthProbe: { probe },
            }),
      });
      const realign = subcommands.find((subcommand) => subcommand.name === 'realign');
      if (!realign) throw new Error('expected realign subcommand');
      return { realign, checkout, acquire, containerRestart, logAction, probe, subcommands };
    }

    it.each([
      [['--scope', 'foo']],
      [['--scope']],
      [['--scope', 'edt', '--scope', 'all']],
      [['--restart', 'bogus']],
      [['--restart', 'simple', '--restart', 'none']],
      [['--service']],
      [['--service', '--scope']],
      [['--bogus']],
      [['extra']],
      [['--service', 'nope']],
    ])('rejects %j with invalid-argument before locking or touching anything', async (args) => {
      const { realign, checkout, acquire } = realignSetup();
      expect(await realign.run(args)).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
      expect(acquire).not.toHaveBeenCalled();
      expect(checkout).not.toHaveBeenCalled();
    });

    it('defaults to scope edt with no restart and returns {rows}', async () => {
      const { realign, checkout, containerRestart, logAction } = realignSetup();
      const result = await realign.run([]);
      expect(result).toEqual({
        ok: true,
        data: { rows: [{ service: 'svc-a', outcome: 'realigned', detail: { code: 'realigned', message: 'Checked out "feat/a"' } }] },
      });
      expect(checkout).toHaveBeenCalledWith('/repo/a', 'feat/a');
      expect(containerRestart).not.toHaveBeenCalled();
      expect(logAction).toHaveBeenCalledWith('e1', 'realign', 'success', expect.stringContaining('svc-a realigned'));
    });

    it('--scope none with no service is an empty success', async () => {
      const { realign, checkout } = realignSetup();
      expect(await realign.run(['--scope', 'none'])).toEqual({ ok: true, data: { rows: [] } });
      expect(checkout).not.toHaveBeenCalled();
    });

    it('--service adds a managed other to the scope', async () => {
      const { realign, checkout } = realignSetup();
      const result = await realign.run(['--scope', 'none', '--service', 'svc-b']);
      expect(result).toMatchObject({ ok: true, data: { rows: [{ service: 'svc-b', outcome: 'realigned' }] } });
      expect(checkout).toHaveBeenCalledWith('/repo/b', 'develop');
    });

    it('exits non-zero with the rows when a service fails', async () => {
      const { subcommands } = realignSetup({ checkout: async () => err('git-checkout-error', 'refused') });
      const rendered = await runCli(['realign'], subcommands, false);
      expect(rendered.exitCode).toBe(1);
      const line = JSON.parse(rendered.output) as { error: { code: string; details: { rows: unknown[] } } };
      expect(line.error.code).toBe('realign-failed');
      expect(line.error.details.rows).toEqual([{ service: 'svc-a', outcome: 'failed', detail: { code: 'git-checkout-error', message: 'refused' } }]);
    });

    it('--restart simple restarts the realigned container services and emits restart rows', async () => {
      const { realign, containerRestart } = realignSetup();
      const result = await realign.run(['--scope', 'all', '--restart', 'simple']);
      expect(result.ok).toBe(true);
      expect(containerRestart).toHaveBeenCalledWith('ctr-a');
      expect(result.ok && (result.data as { restart: unknown[] }).restart).toEqual(
        expect.arrayContaining([
          { service: 'svc-a', mode: 'simple', state: 'functional' },
          { service: 'svc-b', mode: 'simple', state: 'skipped', detail: 'no container' },
        ]),
      );
    });

    it('exits non-zero when a restarted service ends unhealthy', async () => {
      const { subcommands } = realignSetup({ healthy: false });
      let rendered: Awaited<ReturnType<typeof runCli>>;
      vi.useFakeTimers();
      try {
        const pending = runCli(['realign', '--restart', 'simple'], subcommands, false);
        await vi.advanceTimersByTimeAsync(31_000);
        rendered = await pending;
      } finally {
        vi.useRealTimers();
      }
      expect(rendered.exitCode).toBe(1);
      const line = JSON.parse(rendered.output) as { error: { code: string; details: { rows: unknown[]; restart: unknown[] } } };
      expect(line.error.code).toBe('realign-restart-needs-attention');
      expect(line.error.details.rows).toEqual([expect.objectContaining({ service: 'svc-a', outcome: 'realigned' })]);
    });

    it('exits non-zero with realign-restart-needs-attention when the restart phase cannot run', async () => {
      const list = vi
        .fn<RegistryPort['list']>()
        .mockResolvedValueOnce(ok(['/repo/a', '/repo/b']))
        .mockResolvedValueOnce(ok(['/repo/a', '/repo/b']))
        .mockResolvedValue(err('registry-read-error', 'registry.yaml vanished'));
      const { subcommands, containerRestart } = realignSetup({ registryList: list });
      const rendered = await runCli(['realign', '--restart', 'simple'], subcommands, false);
      expect(rendered.exitCode).toBe(1);
      const line = JSON.parse(rendered.output) as { error: { code: string; details: { rows: unknown[]; restartError: unknown } } };
      expect(line.error.code).toBe('realign-restart-needs-attention');
      expect(line.error.details.rows).toEqual([expect.objectContaining({ service: 'svc-a', outcome: 'realigned' })]);
      expect(line.error.details.restartError).toEqual({ code: 'registry-read-error', message: 'registry.yaml vanished' });
      expect(containerRestart).not.toHaveBeenCalled();
    });

    it('reports a failed registry listing as itself, not as an unknown service', async () => {
      const { realign, checkout } = realignSetup({ registryList: async () => err('registry-read-error', 'registry.yaml unreadable') });
      expect(await realign.run(['--service', 'svc-b'])).toEqual({
        ok: false,
        error: { code: 'registry-read-error', message: 'registry.yaml unreadable' },
      });
      expect(checkout).not.toHaveBeenCalled();
    });

    it('warns on stderr when settings cannot be read for the restart, then uses the defaults', async () => {
      const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const { realign, containerRestart } = realignSetup({
          settings: { load: async () => err('settings-read-error', 'settings.yaml unreadable'), save: async () => ok(undefined) },
        });
        const result = await realign.run(['--restart', 'simple']);
        expect(result.ok).toBe(true);
        expect(containerRestart).toHaveBeenCalledWith('ctr-a');
        expect(stderr).toHaveBeenCalledWith(expect.stringContaining('could not read settings, using defaults: settings.yaml unreadable'));
      } finally {
        stderr.mockRestore();
      }
    });

    function realignSettings(realign: { defaultScope: 'none' | 'edt' | 'all'; restartMode: 'none' | 'simple' | 'clean' }): SettingsPort {
      return { load: async () => ok({ settings: { ...DEFAULT_SETTINGS, realign }, warning: null }), save: async () => ok(undefined) };
    }

    it('uses realign.defaultScope and realign.restartMode when --scope and --restart are absent', async () => {
      const { realign, checkout, containerRestart } = realignSetup({ settings: realignSettings({ defaultScope: 'all', restartMode: 'clean' }) });
      const result = await realign.run([]);
      expect(result).toMatchObject({ ok: true, data: { rows: [{ service: 'svc-a', outcome: 'realigned' }, { service: 'svc-b', outcome: 'realigned' }] } });
      expect(checkout).toHaveBeenCalledTimes(2);
      expect(containerRestart).toHaveBeenCalledWith('ctr-a');
      expect(result.ok && (result.data as { restart: unknown[] }).restart).toEqual(
        expect.arrayContaining([expect.objectContaining({ service: 'svc-a', mode: 'clean', state: 'functional' })]),
      );
    });

    it('a restart never probes a service whose health check is disabled in settings', async () => {
      const settings: SettingsPort = {
        load: async () => ok({ settings: { ...DEFAULT_SETTINGS, services: { healthCheckDisabled: ['svc-a'] } }, warning: null }),
        save: async () => ok(undefined),
      };
      const { realign, containerRestart, probe } = realignSetup({ settings, healthy: false });
      const result = await realign.run(['--restart', 'simple']);
      expect(containerRestart).toHaveBeenCalledWith('ctr-a');
      expect(probe).not.toHaveBeenCalled();
      expect(result.ok && (result.data as { restart: unknown[] }).restart).toEqual(
        expect.arrayContaining([expect.objectContaining({ service: 'svc-a', mode: 'simple', state: 'up-unverified' })]),
      );
    });

    it('lets explicit --scope and --restart override the settings', async () => {
      const { realign, checkout, containerRestart } = realignSetup({ settings: realignSettings({ defaultScope: 'all', restartMode: 'clean' }) });
      const result = await realign.run(['--scope', 'edt', '--restart', 'none']);
      expect(result).toEqual({
        ok: true,
        data: { rows: [{ service: 'svc-a', outcome: 'realigned', detail: { code: 'realigned', message: 'Checked out "feat/a"' } }] },
      });
      expect(checkout).toHaveBeenCalledTimes(1);
      expect(containerRestart).not.toHaveBeenCalled();
    });

    it('warns on stderr and applies the built-in scope and restart when settings cannot be read', async () => {
      const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const { realign, checkout, containerRestart } = realignSetup({
          settings: { load: async () => err('settings-read-error', 'settings.yaml unreadable'), save: async () => ok(undefined) },
        });
        expect(await realign.run([])).toMatchObject({ ok: true, data: { rows: [{ service: 'svc-a', outcome: 'realigned' }] } });
        expect(checkout).toHaveBeenCalledTimes(1);
        expect(containerRestart).not.toHaveBeenCalled();
        expect(stderr).toHaveBeenCalledWith(expect.stringContaining('could not read settings, using defaults'));
      } finally {
        stderr.mockRestore();
      }
    });

    it('reads no settings when --scope and --restart none are both explicit', async () => {
      const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const load = vi.fn(async () => err('settings-read-error', 'settings.yaml unreadable'));
        const { realign } = realignSetup({ settings: { load, save: async () => ok(undefined) } });
        expect(await realign.run(['--scope', 'edt', '--restart', 'none'])).toMatchObject({ ok: true });
        expect(load).not.toHaveBeenCalled();
        expect(stderr).not.toHaveBeenCalled();
      } finally {
        stderr.mockRestore();
      }
    });

    it('prints a settings warning on stderr and still applies the loaded defaults', async () => {
      const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const { realign, checkout } = realignSetup({
          settings: {
            load: async () => ok({ settings: { ...DEFAULT_SETTINGS, realign: { defaultScope: 'all', restartMode: 'none' } }, warning: 'settings.yaml: realign.defaultScope invalid' }),
            save: async () => ok(undefined),
          },
        });
        expect(await realign.run([])).toMatchObject({ ok: true });
        expect(checkout).toHaveBeenCalledTimes(2);
        expect(stderr).toHaveBeenCalledWith('tui-back: settings.yaml: realign.defaultScope invalid');
        expect(stderr).toHaveBeenCalledTimes(1);
      } finally {
        stderr.mockRestore();
      }
    });

    it('rejects a restart request up front when the Docker port is not wired', async () => {
      const { realign, acquire } = realignSetup({ withDocker: false });
      expect(await realign.run(['--restart', 'clean'])).toMatchObject({ ok: false, error: { code: 'restart-unavailable' } });
      expect(acquire).not.toHaveBeenCalled();
    });

    it('is rejected while an update, switch or realign holds the lock', async () => {
      const checkout = vi.fn(async () => ok(undefined));
      const blocked = buildTestSubcommands({
        registry: { list: async () => ok(['/repo/a']), exists: async () => ok(true) } as unknown as RegistryPort,
        manifest: { load: async () => ok({ service: 'svc-a', sharedBranch: 'develop', modules: {} }) },
        git: fakeGitPort({ checkout }),
        lock: { acquire: async () => err('action-in-progress', 'busy'), peek: async () => ok({ locked: true }) },
        edtRegistry: { ...fakeEdtRegistry(), list: async () => ok([active]) },
        state: { ...fakeState(), readActiveEdt: async () => ok('e1') },
      }).find((subcommand) => subcommand.name === 'realign');
      expect(await blocked?.run([])).toMatchObject({ ok: false, error: { code: 'realign-blocked-action-in-progress' } });
      expect(checkout).not.toHaveBeenCalled();
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

  describe('registry clean', () => {
    function findRegistry(subcommands: ReturnType<typeof buildTestSubcommands>) {
      const registry = subcommands.find((subcommand) => subcommand.name === 'registry');
      if (!registry) throw new Error('expected registry subcommand');
      return registry;
    }

    it('rejects an unknown registry action', async () => {
      const registry = findRegistry(buildTestSubcommands());

      const result = await registry.run(['bogus']);

      expect(result).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
    });

    it('rejects an unknown registry clean flag', async () => {
      const registry = findRegistry(buildTestSubcommands());

      const result = await registry.run(['clean', '--force']);

      expect(result).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
    });

    it('rejects --path given without --yes, and --yes given without --path', async () => {
      const registry = findRegistry(buildTestSubcommands());

      const pathOnly = await registry.run(['clean', '--path', '/repo/a']);
      const yesOnly = await registry.run(['clean', '--yes']);

      expect(pathOnly).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
      expect(yesOnly).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
    });

    it('rejects --path with a missing value', async () => {
      const registry = findRegistry(buildTestSubcommands());

      const result = await registry.run(['clean', '--yes', '--path']);

      expect(result).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
    });

    it('rejects a --path value that looks like another flag instead of silently consuming it as a literal path', async () => {
      const registry = findRegistry(buildTestSubcommands());

      const looksLikeYes = await registry.run(['clean', '--yes', '--path', '--yes']);
      const looksLikePath = await registry.run(['clean', '--yes', '--path', '--path']);

      expect(looksLikeYes).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
      expect(looksLikePath).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
    });

    it('rejects an empty-string --path value instead of silently resolving it to cwd', async () => {
      const registry = findRegistry(buildTestSubcommands());

      const empty = await registry.run(['clean', '--yes', '--path', '']);
      const blank = await registry.run(['clean', '--yes', '--path', '   ']);

      expect(empty).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
      expect(blank).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
    });

    it('de-duplicates the same resolved path given via multiple --path flags, never a duplicate outcome row', async () => {
      const remove = vi.fn(async () => ok(undefined));
      const registryPort: RegistryPort = {
        list: async () => ok([]),
        add: async () => ok(undefined),
        exists: async () => ok(false),
        scan: async () => ok({ candidates: [], skipped: [] }),
        reset: async () => ok({ path: '/p', backupPath: null }),
        remove,
      };
      const registry = findRegistry(buildTestSubcommands({ registry: registryPort }));

      const result = await registry.run(['clean', '--yes', '--path', '/repo/a', '--path', '/repo/a']);

      expect(result).toEqual({ ok: true, data: { results: [{ path: '/repo/a', outcome: 'removed' }] } });
      expect(remove).toHaveBeenCalledTimes(1);
    });

    it('--yes --path <p1> --path <p2> removes each path via RegistryPort.remove, one path failing never blocking the other', async () => {
      const remove = vi.fn(async (path: string) =>
        path === '/repo/bad' ? err('registry-write-error', 'disk full') : ok(undefined),
      );
      const registryPort: RegistryPort = {
        list: async () => ok([]),
        add: async () => ok(undefined),
        exists: async () => ok(false),
        scan: async () => ok({ candidates: [], skipped: [] }),
        reset: async () => ok({ path: '/p', backupPath: null }),
        remove,
      };
      const registry = findRegistry(buildTestSubcommands({ registry: registryPort }));

      const result = await registry.run(['clean', '--yes', '--path', '/repo/good', '--path', '/repo/bad']);

      expect(result).toEqual({
        ok: true,
        data: {
          results: [
            { path: '/repo/good', outcome: 'removed' },
            { path: '/repo/bad', outcome: 'failed', detail: { code: 'registry-write-error', message: 'disk full' } },
          ],
        },
      });
      expect(remove).toHaveBeenCalledWith('/repo/good');
      expect(remove).toHaveBeenCalledWith('/repo/bad');
    });

    it('scripted removal is a no-op success for a path that is not currently registered', async () => {
      const registry = findRegistry(buildTestSubcommands());

      const result = await registry.run(['clean', '--yes', '--path', '/repo/never-registered']);

      expect(result).toEqual({ ok: true, data: { results: [{ path: '/repo/never-registered', outcome: 'removed' }] } });
    });

    it('bare invocation on a fully healthy registry reports zero candidates explicitly, never silently', async () => {
      const registryPort: RegistryPort = {
        list: async () => ok(['/repo/a']),
        add: async () => ok(undefined),
        exists: async () => ok(true),
        scan: async () => ok({ candidates: [], skipped: [] }),
        reset: async () => ok({ path: '/p', backupPath: null }),
        remove: async () => ok(undefined),
      };
      const manifest: ManifestPort = { load: async () => ok({ service: 'svc', container: 'ctr', sharedBranch: 'development', modules: {} }) };
      const registry = findRegistry(buildTestSubcommands({ registry: registryPort, manifest }));

      const result = await registry.run(['clean']);

      expect(result).toEqual({ ok: true, data: { candidates: [], errors: [], results: [] } });
    });

    it('bare invocation off a TTY (isTTY not set) requires confirmation instead of silently doing nothing, and names the candidates', async () => {
      // buildTestSubcommands' default registry.exists() -> ok(false) and manifest.load() ->
      // manifest-not-found together make the default fixture path classify as unreachable,
      // so no override is needed to produce a candidate.
      const registryPort: RegistryPort = {
        list: async () => ok(['/repo/gone']),
        add: async () => ok(undefined),
        exists: async () => ok(false),
        scan: async () => ok({ candidates: [], skipped: [] }),
        reset: async () => ok({ path: '/p', backupPath: null }),
        remove: async () => ok(undefined),
      };
      const registry = findRegistry(buildTestSubcommands({ registry: registryPort }));

      const result = await registry.run(['clean']);

      expect(result).toMatchObject({ ok: false, error: { code: 'confirmation-required' } });
      if (!result.ok) {
        expect(result.error.message).toContain('--yes');
        expect(result.error.details).toMatchObject({
          candidates: [{ path: '/repo/gone', reason: 'unreachable' }],
          errors: [],
        });
      }
    });

    it('surfaces a path that could not even be checked in `errors`, never silently dropped', async () => {
      const registryPort: RegistryPort = {
        list: async () => ok(['/repo/gone', '/repo/unknown']),
        add: async () => ok(undefined),
        exists: async (path: string) => (path === '/repo/unknown' ? err('registry-stat-error', 'permission denied') : ok(false)),
        scan: async () => ok({ candidates: [], skipped: [] }),
        reset: async () => ok({ path: '/p', backupPath: null }),
        remove: async () => ok(undefined),
      };
      const registry = findRegistry(buildTestSubcommands({ registry: registryPort }));

      const result = await registry.run(['clean']);

      expect(result).toMatchObject({
        ok: false,
        error: {
          code: 'confirmation-required',
          details: {
            candidates: [{ path: '/repo/gone', reason: 'unreachable' }],
            errors: [{ path: '/repo/unknown', code: 'registry-stat-error', message: 'permission denied' }],
          },
        },
      });
    });
  });

  describe('registry validate', () => {
    function findRegistry(subcommands: ReturnType<typeof buildTestSubcommands>) {
      const registry = subcommands.find((subcommand) => subcommand.name === 'registry');
      if (!registry) throw new Error('expected registry subcommand');
      return registry;
    }

    function healthyDeps() {
      const registryPort: RegistryPort = {
        list: async () => ok(['/repo/a']),
        add: async () => ok(undefined),
        exists: async () => ok(true),
        scan: async () => ok({ candidates: [], skipped: [] }),
        reset: async () => ok({ path: '/p', backupPath: null }),
        remove: async () => ok(undefined),
      };
      const manifest: ManifestPort = {
        load: async () => ok({ service: 'svc', container: 'ctr', sharedBranch: 'development', modules: {} }),
      };
      return { registry: registryPort, manifest };
    }

    it('validates a healthy repo as valid', async () => {
      const registry = findRegistry(buildTestSubcommands(healthyDeps()));

      const result = await registry.run(['validate']);

      expect(result).toEqual({ ok: true, data: { results: [{ path: '/repo/a', outcome: 'valid' }] } });
    });

    it('reports a missing sharedBranch as invalid with shared-branch-missing', async () => {
      const registryPort: RegistryPort = {
        list: async () => ok(['/repo/a']),
        add: async () => ok(undefined),
        exists: async () => ok(true),
        scan: async () => ok({ candidates: [], skipped: [] }),
        reset: async () => ok({ path: '/p', backupPath: null }),
        remove: async () => ok(undefined),
      };
      const manifest: ManifestPort = {
        load: async () => ok({ service: 'svc', container: 'ctr', sharedBranch: 'release', modules: {} }),
      };
      const subcommands = buildTestSubcommands({
        registry: registryPort,
        manifest,
        git: fakeGitPort({ branchExistsLocally: async () => ok(false) }),
      });
      const validate = subcommands.find((subcommand) => subcommand.name === 'registry');
      if (!validate) throw new Error('expected registry subcommand');

      const result = await validate.run(['validate']);

      expect(result).toMatchObject({
        ok: true,
        data: { results: [{ path: '/repo/a', outcome: 'invalid', detail: { code: 'shared-branch-missing' } }] },
      });
    });

    it('reports an unreachable path as unreachable', async () => {
      const registryPort: RegistryPort = {
        list: async () => ok(['/repo/gone']),
        add: async () => ok(undefined),
        exists: async () => ok(false),
        scan: async () => ok({ candidates: [], skipped: [] }),
        reset: async () => ok({ path: '/p', backupPath: null }),
        remove: async () => ok(undefined),
      };
      const registry = findRegistry(buildTestSubcommands({ registry: registryPort }));

      const result = await registry.run(['validate']);

      expect(result).toEqual({ ok: true, data: { results: [{ path: '/repo/gone', outcome: 'unreachable' }] } });
    });

    it('surfaces a loader failure with its exact code as invalid', async () => {
      const registryPort: RegistryPort = {
        list: async () => ok(['/repo/a']),
        add: async () => ok(undefined),
        exists: async () => ok(true),
        scan: async () => ok({ candidates: [], skipped: [] }),
        reset: async () => ok({ path: '/p', backupPath: null }),
        remove: async () => ok(undefined),
      };
      const manifest: ManifestPort = { load: async () => err('unknown-module', 'Unknown module id "bogus"') };
      const registry = findRegistry(buildTestSubcommands({ registry: registryPort, manifest }));

      const result = await registry.run(['validate']);

      expect(result).toEqual({
        ok: true,
        data: { results: [{ path: '/repo/a', outcome: 'invalid', detail: { code: 'unknown-module', message: 'Unknown module id "bogus"' } }] },
      });
    });

    it('maps a git-read error to inconclusive', async () => {
      const registryPort: RegistryPort = {
        list: async () => ok(['/repo/a']),
        add: async () => ok(undefined),
        exists: async () => ok(true),
        scan: async () => ok({ candidates: [], skipped: [] }),
        reset: async () => ok({ path: '/p', backupPath: null }),
        remove: async () => ok(undefined),
      };
      const manifest: ManifestPort = {
        load: async () => ok({ service: 'svc', container: 'ctr', sharedBranch: 'development', modules: {} }),
      };
      const git = fakeGitPort({
        branchExistsLocally: async () => err('git-branch-check-error', 'Cannot verify branch state'),
      });
      const registry = findRegistry(buildTestSubcommands({ registry: registryPort, manifest, git }));

      const result = await registry.run(['validate']);

      expect(result).toMatchObject({
        ok: true,
        data: { results: [{ path: '/repo/a', outcome: 'inconclusive', detail: { code: 'git-branch-check-error' } }] },
      });
    });

    it('rejects excess args with invalid-argument and a validate usage', async () => {
      const registry = findRegistry(buildTestSubcommands());

      const result = await registry.run(['validate', 'extra']);

      expect(result).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
      if (!result.ok) {
        expect(result.error.message).toContain('tui-back registry validate');
      }
    });

    it('returns an explicit empty results list for an empty registry, exit 0 shape', async () => {
      const registry = findRegistry(buildTestSubcommands());

      const result = await registry.run(['validate']);

      expect(result).toEqual({ ok: true, data: { results: [] } });
    });
  });

  describe('registry clean — interactive TTY flow', () => {
    function findRegistry(subcommands: ReturnType<typeof buildTestSubcommands>) {
      const registry = subcommands.find((subcommand) => subcommand.name === 'registry');
      if (!registry) throw new Error('expected registry subcommand');
      return registry;
    }

    it('a confirmed ("y") answer prints the candidate list and removes exactly those paths', async () => {
      const remove = vi.fn(async () => ok(undefined));
      const registryPort: RegistryPort = {
        list: async () => ok(['/repo/gone']),
        add: async () => ok(undefined),
        exists: async () => ok(false),
        scan: async () => ok({ candidates: [], skipped: [] }),
        reset: async () => ok({ path: '/p', backupPath: null }),
        remove,
      };
      const question = vi.fn(async () => 'y');
      const close = vi.fn();
      vi.mocked(createInterface).mockReturnValue({ question, close } as unknown as ReturnType<typeof createInterface>);
      const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

      try {
        const registry = findRegistry(buildTestSubcommands({ registry: registryPort, isTTY: true }));

        const result = await registry.run(['clean']);

        expect(result).toEqual({
          ok: true,
          data: {
            candidates: [{ path: '/repo/gone', reason: 'unreachable', memberOfEdts: [] }],
            errors: [],
            results: [{ path: '/repo/gone', outcome: 'removed' }],
          },
        });
        expect(remove).toHaveBeenCalledWith('/repo/gone');
        expect(close).toHaveBeenCalled();
        expect(question).toHaveBeenCalled();
        const printed = writeSpy.mock.calls.map((call) => String(call[0])).join('');
        expect(printed).toContain('/repo/gone');
        expect(printed).toContain('unreachable');
      } finally {
        writeSpy.mockRestore();
      }
    });

    it('a declined ("n") answer prints the list but never calls registry.remove, returning empty results', async () => {
      const remove = vi.fn(async () => ok(undefined));
      const registryPort: RegistryPort = {
        list: async () => ok(['/repo/gone']),
        add: async () => ok(undefined),
        exists: async () => ok(false),
        scan: async () => ok({ candidates: [], skipped: [] }),
        reset: async () => ok({ path: '/p', backupPath: null }),
        remove,
      };
      const question = vi.fn(async () => 'n');
      const close = vi.fn();
      vi.mocked(createInterface).mockReturnValue({ question, close } as unknown as ReturnType<typeof createInterface>);
      const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

      try {
        const registry = findRegistry(buildTestSubcommands({ registry: registryPort, isTTY: true }));

        const result = await registry.run(['clean']);

        expect(result).toEqual({
          ok: true,
          data: {
            candidates: [{ path: '/repo/gone', reason: 'unreachable', memberOfEdts: [] }],
            errors: [],
            results: [],
          },
        });
        expect(remove).not.toHaveBeenCalled();
        expect(close).toHaveBeenCalled();
        const printed = writeSpy.mock.calls.map((call) => String(call[0])).join('');
        expect(printed).toContain('/repo/gone');
      } finally {
        writeSpy.mockRestore();
      }
    });
  });
});
