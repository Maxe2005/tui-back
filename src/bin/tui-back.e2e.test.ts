// Black-box test per AD-13: "adapters/driving/cli tested black-box (invoke subcommand as
// child process, assert AD-3 envelope)". Spawns the real, shipped binary — no npm link
// required; node resolves package imports (tsx/esm/api) upward from the script's own
// location regardless of this test's cwd.
//
// Deliberately does not attempt to simulate a real TTY (no pty library in the Stack table).
// spawnSync's stdout is a pipe by default, so every case here exercises the non-TTY
// JSON-line branch; the TTY/human-text branch is covered directly by envelope.test.ts.
//
// Story 2.8 (fullscreen TUI rendering): the interactive `tui-back-tui` binary itself is never
// spawned by this suite (its own `process.stdin.isTTY` guard would just make it exit 1 under
// spawnSync's piped stdin), so alt-screen enter/exit and live-resize behavior are NOT covered
// here — there's no pty lib in this repo's stack to give a child process a real TTY. That
// coverage is intentionally left to the manual verification steps in
// spec-2-8-fullscreen-tui-rendering.md's `## Verification` section.
//
// Story 1.5's register/list-repos/scan cases all override XDG_CONFIG_HOME with a temp dir
// so the child process never touches the real config dir (registry.yaml writes are scoped
// to the fixture).
import { describe, expect, it, afterEach } from 'vitest';
import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { lockPathFor } from '../adapters/driven/lock/helpers.js';

const scriptPath = fileURLToPath(new URL('./cli-back.mjs', import.meta.url));
const manifestYaml = [
  'service: route-explorer',
  'container: route-explorer',
  'migrationCommand: npm run migration:run',
  'sharedBranch: development',
  'modules: {}',
].join('\n');

const tmpDirs: string[] = [];

function runCli(args: string[], env: NodeJS.ProcessEnv = {}, cwd?: string) {
  return spawnSync('node', [scriptPath, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    cwd,
  });
}

async function runCliAsync(args: string[], env: NodeJS.ProcessEnv = {}): Promise<{ status: number | null; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [scriptPath, ...args], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let stdout = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`tui-back child process timed out: ${['node', scriptPath, ...args].join(' ')}`));
    }, 10_000);
    timer.unref();
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ status: code, stdout });
    });
  });
}

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tui-back-e2e-'));
  tmpDirs.push(dir);
  return dir;
}

async function makeRepo(withManifest: boolean): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tui-back-e2e-repo-'));
  tmpDirs.push(dir);
  if (withManifest) {
    await writeFile(join(dir, '.tui-back.yaml'), manifestYaml);
  }
  return dir;
}

// The edt create e2e cases need repos the tool can actually branch against: a real git repo
// (git init with an initial commit on `development`, the default base branch) that also
// carries a manifest. No checkout/working-tree state beyond the initial commit is needed —
// branch creation only creates refs.
function runGit(dir: string, args: string[]): { status: number | null; stdout: string; stderr: string } {
  return spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
}

async function makeGitRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tui-back-e2e-git-'));
  tmpDirs.push(dir);
  await writeFile(join(dir, '.tui-back.yaml'), manifestYaml);
  const init = runGit(dir, ['init', '-b', 'development']);
  if (init.status !== 0) {
    throw new Error(`git init failed: ${init.stderr}`);
  }
  runGit(dir, ['config', 'user.email', 'e2e@tui-back.test']);
  runGit(dir, ['config', 'user.name', 'tui-back e2e']);
  const commit = runGit(dir, ['commit', '--allow-empty', '-m', 'initial']);
  if (commit.status !== 0) {
    throw new Error(`git commit failed: ${commit.stderr}`);
  }
  return dir;
}

function branchExists(dir: string, branch: string): boolean {
  return runGit(dir, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]).status === 0;
}

afterEach(async () => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe('tui-back CLI (black-box)', () => {
  it('ping succeeds with the AD-3 envelope on stdout and exits 0', async () => {
    const xdg = await makeTempDir();
    const { status, stdout } = runCli(['ping'], { XDG_STATE_HOME: xdg });

    expect(status).toBe(0);
    expect(JSON.parse(stdout.trim())).toEqual({ ok: true, data: { message: 'pong' } });
    // read-only commands must not create state: the lock dir must not exist after ping
    await expect(access(join(xdg, 'tui-back', 'locks'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('an unknown subcommand fails with the AD-3 envelope and exits 1, without crashing', () => {
    const { status, stdout, stderr } = runCli(['bogus']);

    expect(status).toBe(1);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('unknown-subcommand');
    expect(stderr).not.toMatch(/at .*\(.*:\d+:\d+\)/); // no raw stack trace
  });

  it('no subcommand at all follows the same unknown-subcommand path and exits 1', () => {
    const { status, stdout } = runCli([]);

    expect(status).toBe(1);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('unknown-subcommand');
  });

  it("package.json's bin field exposes the umbrella CLI and the interactive TUI entry point (AD-2)", async () => {
    const pkg = await import('../../package.json', { with: { type: 'json' } });
    expect(Object.keys(pkg.default.bin).sort()).toEqual([
      'tui-back',
      'tui-back-tui',
    ]);
  });
});

describe('tui-back register (black-box)', () => {
  it('persists the path into XDG_CONFIG_HOME/tui-back/registry.yaml and exits 0 (AC1)', async () => {
    const xdg = await makeTempDir();
    const repo = await makeRepo(false);

    const { status, stdout } = runCli(['register', repo], { XDG_CONFIG_HOME: xdg, XDG_STATE_HOME: xdg });

    expect(status).toBe(0);
    expect(JSON.parse(stdout.trim())).toEqual({ ok: true, data: { path: repo } });
    expect(parse(await readFile(join(xdg, 'tui-back', 'registry.yaml'), 'utf8'))).toEqual({ repos: [repo] });
  });

  it('register twice is a deduped no-op and list-repos twice is byte-identical (FR-1)', async () => {
    const xdg = await makeTempDir();
    const repo = await makeRepo(true);
    const env = { XDG_CONFIG_HOME: xdg, XDG_STATE_HOME: xdg };

    const first = runCli(['register', repo], env);
    const second = runCli(['register', repo], env);

    expect(first.status).toBe(0);
    expect(second.status).toBe(0);
    expect(parse(await readFile(join(xdg, 'tui-back', 'registry.yaml'), 'utf8'))).toEqual({ repos: [repo] });

    const listA = runCli(['list-repos'], env);
    const listB = runCli(['list-repos'], env);
    expect(listA.status).toBe(0);
    expect(listB.status).toBe(0);
    expect(listA.stdout).toBe(listB.stdout);
  });

  it('register with no path fails with missing-argument and exits 1', async () => {
    const xdg = await makeTempDir();
    const { status, stdout } = runCli(['register'], { XDG_STATE_HOME: xdg });

    expect(status).toBe(1);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('missing-argument');
  });

  it('register rejects a relative path with invalid-argument and exits 1', async () => {
    const xdg = await makeTempDir();

    const { status, stdout } = runCli(['register', './relative'], { XDG_CONFIG_HOME: xdg, XDG_STATE_HOME: xdg });

    expect(status).toBe(1);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('invalid-argument');
  });

  it('register rejects excess arguments with invalid-argument and exits 1', async () => {
    const xdg = await makeTempDir();
    const { status, stdout } = runCli(['register', '/a', '/b'], { XDG_STATE_HOME: xdg });

    expect(status).toBe(1);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('invalid-argument');
  });
});

describe('tui-back register concurrency (black-box)', () => {
  it('two racing register subprocesses are serialized — both paths survive, no lost update', async () => {
    const xdg = await makeTempDir();
    const repoA = await makeRepo(false);
    const repoB = await makeRepo(false);
    const env = { XDG_CONFIG_HOME: xdg, XDG_STATE_HOME: xdg };

    const [a, b] = await Promise.all([runCliAsync(['register', repoA], env), runCliAsync(['register', repoB], env)]);

    expect(a.status).toBe(0);
    expect(b.status).toBe(0);

    const parsedA = JSON.parse(a.stdout.trim());
    const parsedB = JSON.parse(b.stdout.trim());
    expect(parsedA).toEqual({ ok: true, data: { path: repoA } });
    expect(parsedB).toEqual({ ok: true, data: { path: repoB } });

    const registry = parse(await readFile(join(xdg, 'tui-back', 'registry.yaml'), 'utf8'));
    expect([...(registry.repos as string[])].sort()).toEqual([repoA, repoB].sort());
  });
});

describe('tui-back register --reset (black-box)', () => {
  it('backs up a corrupt registry, re-initializes it, and list-repos works again', async () => {
    const xdg = await makeTempDir();
    const repo = await makeRepo(true);
    const env = { XDG_CONFIG_HOME: xdg, XDG_STATE_HOME: xdg };
    await mkdir(join(xdg, 'tui-back'), { recursive: true });
    const registryFile = join(xdg, 'tui-back', 'registry.yaml');
    const corrupt = 'a: [unclosed';
    await writeFile(registryFile, corrupt);

    const { status, stdout } = runCli(['register', '--reset', repo], env);

    expect(status).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(true);
    expect(parsed.data.path).toBe(repo);
    expect(parsed.data.backupPath).not.toBeNull();

    const backup = parsed.data.backupPath as string;
    expect(backup.startsWith(registryFile + '.bak-')).toBe(true);
    expect(await readFile(backup, 'utf8')).toBe(corrupt);
    expect(parse(await readFile(registryFile, 'utf8'))).toEqual({ repos: [repo] });

    const listed = runCli(['list-repos'], env);
    expect(listed.status).toBe(0);
    expect(JSON.parse(listed.stdout.trim())).toMatchObject({ ok: true });
  });

  it('refuses a healthy registry with registry-not-corrupt and exits 1', async () => {
    const xdg = await makeTempDir();
    const repo = await makeRepo(false);
    const env = { XDG_CONFIG_HOME: xdg, XDG_STATE_HOME: xdg };
    expect(runCli(['register', repo], env).status).toBe(0);

    const { status, stdout } = runCli(['register', '--reset', repo], env);

    expect(status).toBe(1);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('registry-not-corrupt');
  });

  it('registers a path on a missing registry with no backup needed', async () => {
    const xdg = await makeTempDir();
    const repo = await makeRepo(false);

    const { status, stdout } = runCli(['register', '--reset', repo], { XDG_CONFIG_HOME: xdg, XDG_STATE_HOME: xdg });

    expect(status).toBe(0);
    expect(JSON.parse(stdout.trim())).toEqual({ ok: true, data: { path: repo, backupPath: null } });
  });

  it('rejects a missing path after --reset with missing-argument and exits 1', async () => {
    const xdg = await makeTempDir();
    const { status, stdout } = runCli(['register', '--reset'], { XDG_STATE_HOME: xdg });

    expect(status).toBe(1);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('missing-argument');
  });
});

describe('tui-back list-repos (black-box)', () => {
  it('lists managed repos, silently skips unmanaged, and reports unreachable (AC2)', async () => {
    const xdg = await makeTempDir();
    const managed = await makeRepo(true);
    const unmanaged = await makeRepo(false);
    const gone = join(xdg, 'gone-repo');
    const env = { XDG_CONFIG_HOME: xdg, XDG_STATE_HOME: xdg };

    for (const repo of [managed, unmanaged, gone]) {
      expect(runCli(['register', repo], env).status).toBe(0);
    }

    const { status, stdout } = runCli(['list-repos'], env);

    expect(status).toBe(0);
    expect(JSON.parse(stdout.trim())).toEqual({
      ok: true,
      data: {
        repos: [
          {
            path: managed,
            service: 'route-explorer',
            container: 'route-explorer',
            sharedBranch: 'development',
            moduleIds: [],
          },
        ],
        unreachable: [gone],
        errors: [],
      },
    });
  });

  it('surfaces moduleIds in the JSON envelope for a module-free managed repo (AC4)', async () => {
    const xdg = await makeTempDir();
    const repo = await makeRepo(true);
    const env = { XDG_CONFIG_HOME: xdg, XDG_STATE_HOME: xdg };
    expect(runCli(['register', repo], env).status).toBe(0);

    const { status, stdout } = runCli(['list-repos'], env);

    expect(status).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(true);
    expect(parsed.data.repos).toHaveLength(1);
    expect(parsed.data.repos[0].moduleIds).toEqual([]);
  });

  it('surfaces a manifest with a non-empty modules map as an unknown-module error (AC3)', async () => {
    const xdg = await makeTempDir();
    const repo = await makeRepo(false);
    const env = { XDG_CONFIG_HOME: xdg, XDG_STATE_HOME: xdg };
    await writeFile(
      join(repo, '.tui-back.yaml'),
      [
        'service: route-explorer',
        'container: route-explorer',
        'migrationCommand: npm run migration:run',
        'sharedBranch: development',
        'modules:',
        '  bogus-module: {}',
        '',
      ].join('\n'),
    );
    expect(runCli(['register', repo], env).status).toBe(0);

    const { status, stdout } = runCli(['list-repos'], env);

    expect(status).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(true);
    expect(parsed.data.errors).toHaveLength(1);
    expect(parsed.data.errors[0].code).toBe('unknown-module');
  });

  it('with no registry.yaml returns empty repos/unreachable/errors and exits 0', async () => {
    const xdg = await makeTempDir();

    const { status, stdout } = runCli(['list-repos'], { XDG_CONFIG_HOME: xdg, XDG_STATE_HOME: xdg });

    expect(status).toBe(0);
    expect(JSON.parse(stdout.trim())).toEqual({ ok: true, data: { repos: [], unreachable: [], errors: [] } });
  });

  it('with malformed registry.yaml fails registry-invalid-yaml and exits 1', async () => {
    const xdg = await makeTempDir();
    await mkdir(join(xdg, 'tui-back'), { recursive: true });
    await writeFile(join(xdg, 'tui-back', 'registry.yaml'), 'a: [unclosed');

    const { status, stdout } = runCli(['list-repos'], { XDG_CONFIG_HOME: xdg, XDG_STATE_HOME: xdg });

    expect(status).toBe(1);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('registry-invalid-yaml');
  });

  it('with a wrong-shaped registry.yaml fails registry-invalid-format and exits 1', async () => {
    const xdg = await makeTempDir();
    await mkdir(join(xdg, 'tui-back'), { recursive: true });
    await writeFile(join(xdg, 'tui-back', 'registry.yaml'), 'repositories: []\n');

    const { status, stdout } = runCli(['list-repos'], { XDG_CONFIG_HOME: xdg, XDG_STATE_HOME: xdg });

    expect(status).toBe(1);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('registry-invalid-format');
  });
});

describe('tui-back registry validate (black-box, story 2.28)', () => {
  it('validates a healthy repo as valid in exactly one JSON line, exit 0', async () => {
    const xdg = await makeTempDir();
    const repo = await makeGitRepo();
    const env = { XDG_CONFIG_HOME: xdg, XDG_STATE_HOME: xdg };
    expect(runCli(['register', repo], env).status).toBe(0);

    const { status, stdout } = runCli(['registry', 'validate'], env);

    expect(status).toBe(0);
    expect(stdout.split('\n')).toEqual([stdout.trim(), '']);
    expect(JSON.parse(stdout.trim())).toEqual({ ok: true, data: { results: [{ path: repo, outcome: 'valid' }] } });
  });

  it('reports a missing sharedBranch as invalid with shared-branch-missing, exit 0', async () => {
    const xdg = await makeTempDir();
    const repo = await makeGitRepo();
    await writeFile(
      join(repo, '.tui-back.yaml'),
      ['service: route-explorer', 'container: route-explorer', 'sharedBranch: release', 'modules: {}'].join('\n'),
    );
    const env = { XDG_CONFIG_HOME: xdg, XDG_STATE_HOME: xdg };
    expect(runCli(['register', repo], env).status).toBe(0);

    const { status, stdout } = runCli(['registry', 'validate'], env);

    expect(status).toBe(0);
    expect(stdout.split('\n')).toEqual([stdout.trim(), '']);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed).toMatchObject({
      ok: true,
      data: { results: [{ path: repo, outcome: 'invalid', detail: { code: 'shared-branch-missing' } }] },
    });
    expect(parsed.data.results[0].detail.message).toContain('release');
  });

  it('surfaces an invalid manifest with the loader exact code as invalid, exit 0', async () => {
    const xdg = await makeTempDir();
    const repo = await makeRepo(false);
    await writeFile(join(repo, '.tui-back.yaml'), 'service: [unclosed\n');
    const env = { XDG_CONFIG_HOME: xdg, XDG_STATE_HOME: xdg };
    expect(runCli(['register', repo], env).status).toBe(0);

    const { status, stdout } = runCli(['registry', 'validate'], env);

    expect(status).toBe(0);
    expect(stdout.split('\n')).toEqual([stdout.trim(), '']);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(true);
    expect(parsed.data.results).toHaveLength(1);
    expect(parsed.data.results[0].outcome).toBe('invalid');
    expect(['manifest-invalid-yaml', 'manifest-validation-failed']).toContain(parsed.data.results[0].detail.code);
  });

  it('reports an unreachable path as unreachable and an empty registry as empty results, exit 0', async () => {
    const xdg = await makeTempDir();
    const env = { XDG_CONFIG_HOME: xdg, XDG_STATE_HOME: xdg };
    const gone = join(xdg, 'gone-repo');
    expect(runCli(['register', gone], env).status).toBe(0);

    const unreachable = runCli(['registry', 'validate'], env);
    expect(unreachable.status).toBe(0);
    expect(JSON.parse(unreachable.stdout.trim())).toEqual({
      ok: true,
      data: { results: [{ path: gone, outcome: 'unreachable' }] },
    });

    const emptyXdg = await makeTempDir();
    const emptyEnv = { XDG_CONFIG_HOME: emptyXdg, XDG_STATE_HOME: emptyXdg };
    const { status, stdout } = runCli(['registry', 'validate'], emptyEnv);
    expect(status).toBe(0);
    expect(JSON.parse(stdout.trim())).toEqual({ ok: true, data: { results: [] } });
  });

  it('rejects excess args with invalid-argument as exactly one JSON line, exit 1', async () => {
    const xdg = await makeTempDir();
    const env = { XDG_CONFIG_HOME: xdg, XDG_STATE_HOME: xdg };

    const { status, stdout } = runCli(['registry', 'validate', 'extra'], env);

    expect(status).toBe(1);
    expect(stdout.split('\n')).toEqual([stdout.trim(), '']);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('invalid-argument');
    expect(parsed.error.message).toContain('tui-back registry validate');
  });
});

describe('tui-back list-routes (black-box, story 6.1)', () => {
  const routesManifest = [
    'service: api-gateway',
    'container: api-gateway',
    'sharedBranch: development',
    'modules:',
    '  route-explorer: {}',
    '',
  ].join('\n');

  const spec = {
    openapi: '3.0.0',
    info: { title: 'Gateway', version: '1.0.0' },
    paths: {
      '/users': { get: { summary: 'List users' }, post: { summary: 'Create a user' } },
      '/health': { get: {} },
    },
  };

  async function makeRoutesRepo(specContent: string | null): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'tui-back-e2e-routes-'));
    tmpDirs.push(dir);
    await writeFile(join(dir, '.tui-back.yaml'), routesManifest);
    if (specContent !== null) {
      await writeFile(join(dir, 'openapi.json'), specContent);
    }
    return dir;
  }

  it('lists every discovered METHOD + path row as exactly one JSON line, exit 0', async () => {
    const xdg = await makeTempDir();
    const repo = await makeRoutesRepo(JSON.stringify(spec));
    const env = { XDG_CONFIG_HOME: xdg, XDG_STATE_HOME: xdg };

    const { status, stdout } = runCli(['list-routes', repo], env);

    expect(status).toBe(0);
    expect(stdout.split('\n')).toEqual([stdout.trim(), '']);
    expect(JSON.parse(stdout.trim())).toEqual({
      ok: true,
      data: {
        routes: [
          { method: 'GET', path: '/users', summary: 'List users' },
          { method: 'POST', path: '/users', summary: 'Create a user' },
          { method: 'GET', path: '/health' },
        ],
      },
    });
  });

  it('rejects a repo whose manifest does not activate route-explorer with route-exploration-not-activated, exit 1', async () => {
    const xdg = await makeTempDir();
    const repo = await makeRepo(true);
    const env = { XDG_CONFIG_HOME: xdg, XDG_STATE_HOME: xdg };

    const { status, stdout } = runCli(['list-routes', repo], env);

    expect(status).toBe(1);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('route-exploration-not-activated');
    expect(parsed.error.message).toContain('No route list for this repo');
  });

  it('reports an unparsable spec as route-scan-failed, never as an empty list, exit 1', async () => {
    const xdg = await makeTempDir();
    const repo = await makeRoutesRepo('{ not valid json, [unclosed');
    const env = { XDG_CONFIG_HOME: xdg, XDG_STATE_HOME: xdg };

    const { status, stdout } = runCli(['list-routes', repo], env);

    expect(status).toBe(1);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('route-scan-failed');
  });

  it('returns a genuinely-empty ok list for a spec with zero paths, exit 0', async () => {
    const xdg = await makeTempDir();
    const repo = await makeRoutesRepo(JSON.stringify({ openapi: '3.0.0', info: {}, paths: {} }));
    const env = { XDG_CONFIG_HOME: xdg, XDG_STATE_HOME: xdg };

    const { status, stdout } = runCli(['list-routes', repo], env);

    expect(status).toBe(0);
    expect(JSON.parse(stdout.trim())).toEqual({ ok: true, data: { routes: [] } });
  });

  it('rejects a missing repoPath with missing-argument and an excess argument with invalid-argument', async () => {
    const xdg = await makeTempDir();
    const env = { XDG_CONFIG_HOME: xdg, XDG_STATE_HOME: xdg };

    const missing = runCli(['list-routes'], env);
    expect(missing.status).toBe(1);
    expect(JSON.parse(missing.stdout.trim())).toMatchObject({ ok: false, error: { code: 'missing-argument' } });

    const excess = runCli(['list-routes', '/a', '/b'], env);
    expect(excess.status).toBe(1);
    expect(JSON.parse(excess.stdout.trim())).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
  });
});

describe('tui-back fire-request (black-box, story 6.2)', () => {
  // AD-3 envelope + arg-validation only: every case below rejects before any network
  // call, so no live dev-gateway is needed (the manual live-fire check stays a human
  // step per the spec's Ask First constraint).
  it('rejects a missing repoPath with missing-argument as exactly one JSON line, exit 1', async () => {
    const xdg = await makeTempDir();
    const env = { XDG_CONFIG_HOME: xdg, XDG_STATE_HOME: xdg };

    const { status, stdout } = runCli(['fire-request'], env);

    expect(status).toBe(1);
    expect(stdout.split('\n')).toEqual([stdout.trim(), '']);
    expect(JSON.parse(stdout.trim())).toMatchObject({ ok: false, error: { code: 'missing-argument' } });
  });

  it('rejects bad arity and blank arguments with invalid-argument as exactly one JSON line, exit 1', async () => {
    const xdg = await makeTempDir();
    const env = { XDG_CONFIG_HOME: xdg, XDG_STATE_HOME: xdg };

    for (const args of [
      ['fire-request', '/a'],
      ['fire-request', '/a', 'GET'],
      ['fire-request', '/a', 'GET', '/x', 'extra'],
      ['fire-request', '/a', '  ', '/x'],
    ]) {
      const { status, stdout } = runCli(args, env);

      expect(status).toBe(1);
      expect(stdout.split('\n')).toEqual([stdout.trim(), '']);
      expect(JSON.parse(stdout.trim())).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
    }
  });

  it('rejects a repo whose manifest does not activate route-explorer with route-exploration-not-activated, exit 1', async () => {
    const xdg = await makeTempDir();
    const repo = await makeRepo(true);
    const env = { XDG_CONFIG_HOME: xdg, XDG_STATE_HOME: xdg };

    const { status, stdout } = runCli(['fire-request', repo, 'GET', '/users'], env);

    expect(status).toBe(1);
    expect(stdout.split('\n')).toEqual([stdout.trim(), '']);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('route-exploration-not-activated');
  });
});

describe('tui-back scan (black-box)', () => {
  it('proposes candidate manifest-carrying dirs, sorted, without auto-registering (AD-6)', async () => {
    const xdg = await makeTempDir();
    const root = join(xdg, 'workspace');
    const repoA = join(root, 'a-repo');
    const repoB = join(root, 'b-repo');
    await mkdir(repoA, { recursive: true });
    await mkdir(repoB, { recursive: true });
    await writeFile(join(repoA, '.tui-back.yaml'), manifestYaml);
    await writeFile(join(repoB, '.tui-back.yaml'), manifestYaml);
    await mkdir(join(repoA, 'node_modules', 'dep'), { recursive: true });
    await writeFile(join(repoA, 'node_modules', 'dep', '.tui-back.yaml'), manifestYaml);

    const { status, stdout } = runCli(['scan', root], { XDG_CONFIG_HOME: xdg, XDG_STATE_HOME: xdg });

    expect(status).toBe(0);
    expect(JSON.parse(stdout.trim())).toEqual({ ok: true, data: { candidates: [repoA, repoB], skipped: [] } });
    await expect(readFile(join(xdg, 'tui-back', 'registry.yaml'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('resolves a relative root against the caller cwd into absolute candidates', async () => {
    const xdg = await makeTempDir();
    const root = join(xdg, 'workspace');
    const repo = join(root, 'a-repo');
    await mkdir(repo, { recursive: true });
    await writeFile(join(repo, '.tui-back.yaml'), manifestYaml);

    const { status, stdout } = runCli(['scan', './workspace'], { XDG_CONFIG_HOME: xdg, XDG_STATE_HOME: xdg }, xdg);

    expect(status).toBe(0);
    expect(JSON.parse(stdout.trim())).toEqual({ ok: true, data: { candidates: [repo], skipped: [] } });
  });

  it('over a manifest-less root returns ok with empty candidates and exits 0', async () => {
    const xdg = await makeTempDir();
    const root = join(xdg, 'empty-workspace');
    await mkdir(root, { recursive: true });

    const { status, stdout } = runCli(['scan', root], { XDG_CONFIG_HOME: xdg, XDG_STATE_HOME: xdg });

    expect(status).toBe(0);
    expect(JSON.parse(stdout.trim())).toEqual({ ok: true, data: { candidates: [], skipped: [] } });
  });

  it('with no root fails with missing-argument and exits 1', () => {
    const { status, stdout } = runCli(['scan']);

    expect(status).toBe(1);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('missing-argument');
  });

  it('with a nonexistent root fails scan-root-not-found and exits 1', async () => {
    const xdg = await makeTempDir();

    const { status, stdout } = runCli(['scan', join(xdg, 'does-not-exist')], { XDG_CONFIG_HOME: xdg, XDG_STATE_HOME: xdg });

    expect(status).toBe(1);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('scan-root-not-found');
  });
});

describe('tui-back --help (black-box)', () => {
  it('lists every registered command, including edts, edt, update, list-routes, and fire-request, exit 0', () => {
    const { status, stdout } = runCli(['--help']);

    expect(status).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(true);
    const names = (parsed.data.commands as Array<{ name: string }>).map((c) => c.name);
    expect(names).toEqual(['register', 'list-repos', 'scan', 'ping', 'edts', 'edt', 'update', 'registry', 'list-routes', 'fire-request']);
  });
});

// commits the manifest `makeGitRepo()` leaves untracked — needed whenever a repo is either
// cloned (an untracked file in the source working tree is never copied by `git clone`) or
// put through `edt switch` (which would otherwise stash an untracked .tui-back.yaml away as
// "uncommitted work", deleting it from the working tree and breaking every later manifest
// read for that repo).
function commitManifest(dir: string): void {
  expect(runGit(dir, ['add', '.tui-back.yaml']).status).toBe(0);
  expect(runGit(dir, ['commit', '-m', 'add manifest']).status).toBe(0);
}

describe('tui-back edts (black-box, story 2.6)', () => {
  it('shows branch + ahead/behind for a service with a configured upstream (AC1)', async () => {
    const xdg = await makeTempDir();
    const env = { XDG_CONFIG_HOME: xdg, XDG_STATE_HOME: xdg };
    const origin = await makeGitRepo();
    commitManifest(origin);
    const repo = await mkdtemp(join(tmpdir(), 'tui-back-e2e-clone-'));
    tmpDirs.push(repo);
    expect(spawnSync('git', ['clone', origin, repo], { encoding: 'utf8' }).status).toBe(0);
    runGit(repo, ['config', 'user.email', 'e2e@tui-back.test']);
    runGit(repo, ['config', 'user.name', 'tui-back e2e']);
    runGit(repo, ['commit', '--allow-empty', '-m', 'local-only commit']);
    expect(runCli(['register', repo], env).status).toBe(0);

    const { status, stdout } = runCli(['edts'], env);

    expect(status).toBe(0);
    expect(JSON.parse(stdout.trim())).toEqual({
      ok: true,
      data: {
        services: [
          { service: 'route-explorer', path: repo, isMember: false, sharedBranch: 'development', protectedBranches: [], branch: 'development', ahead: 1, behind: 0, status: 'current' },
        ],
        unreachable: [],
        errors: [],
      },
    });
  });

  it('shows an explicit "no upstream" state for a repo with no remote configured (AC2)', async () => {
    const xdg = await makeTempDir();
    const env = { XDG_CONFIG_HOME: xdg, XDG_STATE_HOME: xdg };
    const repo = await makeGitRepo();
    expect(runCli(['register', repo], env).status).toBe(0);

    const { status, stdout } = runCli(['edts'], env);

    expect(status).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(true);
    expect(parsed.data.services).toEqual([
      { service: 'route-explorer', path: repo, isMember: false, sharedBranch: 'development', protectedBranches: [], branch: 'development', ahead: null, behind: null, status: 'no-upstream' },
    ]);
  });

  it('with no registry.yaml returns an empty listing and exits 0', async () => {
    const xdg = await makeTempDir();

    const { status, stdout } = runCli(['edts'], { XDG_CONFIG_HOME: xdg, XDG_STATE_HOME: xdg });

    expect(status).toBe(0);
    expect(JSON.parse(stdout.trim())).toEqual({ ok: true, data: { services: [], unreachable: [], errors: [] } });
  });

  it('marks the active EDT\'s member service isMember: true, uniformly alongside a non-member (AC4)', async () => {
    const xdg = await makeTempDir();
    const env = { XDG_CONFIG_HOME: xdg, XDG_STATE_HOME: xdg };
    const member = await makeGitRepo();
    commitManifest(member);
    // The default flow (no --create-branches) reuses the member's *current* branch as its
    // own EDT branch — which must not be the shared `development` branch (story 2.3's gate),
    // so check it out onto an ordinary feature branch first.
    expect(runGit(member, ['checkout', '-b', 'feat/member']).status).toBe(0);
    const nonMember = await makeGitRepo();
    commitManifest(nonMember);
    expect(runCli(['register', member], env).status).toBe(0);
    expect(runCli(['register', nonMember], env).status).toBe(0);

    const created = runCli(['edt', 'create', '--topic', 'demo', '--member', member], env);
    expect(created.status).toBe(0);
    expect(runCli(['edt', 'switch', '--to', 'demo'], env).status).toBe(0);

    const { status, stdout } = runCli(['edts'], env);

    expect(status).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(true);
    const byPath = new Map((parsed.data.services as Array<{ path: string; isMember: boolean }>).map((s) => [s.path, s.isMember]));
    expect(byPath.get(member)).toBe(true);
    expect(byPath.get(nonMember)).toBe(false);
  });

  it('rejects excess arguments with invalid-argument', async () => {
    const xdg = await makeTempDir();

    const { status, stdout } = runCli(['edts', 'extra'], { XDG_CONFIG_HOME: xdg, XDG_STATE_HOME: xdg });

    expect(status).toBe(1);
    expect(JSON.parse(stdout.trim())).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
  });
});

describe('tui-back edt create (black-box)', () => {
  const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

  function createEnv(xdg: string) {
    return { XDG_CONFIG_HOME: xdg, XDG_DATA_HOME: xdg, XDG_STATE_HOME: xdg };
  }

  async function registerRepos(repos: string[], env: NodeJS.ProcessEnv): Promise<void> {
    for (const repo of repos) {
      expect(runCli(['register', repo], env).status).toBe(0);
    }
  }

  // A rejection "before any write" must leave no EDT dir/db and no edts.yaml behind.
  async function expectNoEdtState(xdg: string): Promise<void> {
    await expect(access(join(xdg, 'tui-back', 'edts'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(join(xdg, 'tui-back', 'edts.yaml'))).rejects.toMatchObject({ code: 'ENOENT' });
  }

  it('creates the EDT skeleton (state.json, manifest, db) and registers topic + member branch (AC1/AC2)', async () => {
    const xdg = await makeTempDir();
    const repo = await makeGitRepo();
    // makeGitRepo() leaves the repo on `development` (shared); check out an ordinary branch
    // so this skeleton/registration test isn't itself exercising story 2.3's gate (that has
    // its own dedicated case below).
    expect(runGit(repo, ['checkout', '-b', 'feature-x']).status).toBe(0);
    const env = createEnv(xdg);
    await registerRepos([repo], env);

    const { status, stdout } = runCli(['edt', 'create', '--topic', 'demo', '--member', repo], env);

    expect(status).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(true);
    const data = parsed.data;
    expect(data.topic).toBe('demo');
    expect(data.ulid).toMatch(ULID_RE);
    expect(data.results).toEqual([{ service: 'route-explorer', outcome: 'existing-branch' }]);

    const edtDir = join(xdg, 'tui-back', 'edts', data.ulid);
    expect(JSON.parse(await readFile(join(edtDir, 'state.json'), 'utf8'))).toMatchObject({
      ulid: data.ulid,
      status: 'active',
    });
    const manifest = parse(await readFile(join(edtDir, '.tui-back.yaml'), 'utf8'));
    expect(manifest).toEqual({
      service: `edt-${data.ulid}`,
      container: `edt-${data.ulid}`,
      migrationCommand: 'true',
      modules: {},
    });
    await expect(access(join(xdg, 'tui-back', 'edts', `${data.ulid}.db`))).resolves.toBeUndefined();

    const edtRegistry = parse(await readFile(join(xdg, 'tui-back', 'edts.yaml'), 'utf8'));
    expect(edtRegistry.edts).toEqual([
      expect.objectContaining({
        ulid: data.ulid,
        topic: 'demo',
        status: 'active',
        members: [{ service: 'route-explorer', repoPath: repo, branch: 'feature-x' }],
      }),
    ]);
  });

  it('creates one shared branch in every member from the base (grouped mode, AC1)', async () => {
    const xdg = await makeTempDir();
    const repoA = await makeGitRepo();
    const repoB = await makeGitRepo();
    const env = createEnv(xdg);
    await registerRepos([repoA, repoB], env);

    const { status, stdout } = runCli(
      [
        'edt', 'create', '--topic', 'demo', '--member', repoA, '--member', repoB,
        '--create-branches', '--branch-name', 'feat/demo', '--base', 'development',
      ],
      env,
    );

    expect(status).toBe(0);
    const data = JSON.parse(stdout.trim()).data;
    expect(data.results).toEqual([
      { service: 'route-explorer', outcome: 'created' },
      { service: 'route-explorer', outcome: 'created' },
    ]);
    expect(branchExists(repoA, 'feat/demo')).toBe(true);
    expect(branchExists(repoB, 'feat/demo')).toBe(true);

    const edtRegistry = parse(await readFile(join(xdg, 'tui-back', 'edts.yaml'), 'utf8'));
    expect(edtRegistry.edts[0].members).toEqual([
      { service: 'route-explorer', repoPath: repoA, branch: 'feat/demo' },
      { service: 'route-explorer', repoPath: repoB, branch: 'feat/demo' },
    ]);
  });

  it('creates one branch per member by path=name pairs (individual mode, AC1)', async () => {
    const xdg = await makeTempDir();
    const repoA = await makeGitRepo();
    const repoB = await makeGitRepo();
    const env = createEnv(xdg);
    await registerRepos([repoA, repoB], env);

    const { status, stdout } = runCli(
      [
        'edt', 'create', '--topic', 'demo', '--member', repoA, '--member', repoB,
        '--create-branches', '--branch-mode', 'individual',
        '--branch-name', `${repoA}=feat/a`, '--branch-name', `${repoB}=feat/b`,
      ],
      env,
    );

    expect(status).toBe(0);
    const data = JSON.parse(stdout.trim()).data;
    expect(data.results).toEqual([
      { service: 'route-explorer', outcome: 'created' },
      { service: 'route-explorer', outcome: 'created' },
    ]);
    expect(branchExists(repoA, 'feat/a')).toBe(true);
    expect(branchExists(repoB, 'feat/b')).toBe(true);
    expect(branchExists(repoA, 'feat/b')).toBe(false);

    const edtRegistry = parse(await readFile(join(xdg, 'tui-back', 'edts.yaml'), 'utf8'));
    expect(edtRegistry.edts[0].members).toEqual([
      { service: 'route-explorer', repoPath: repoA, branch: 'feat/a' },
      { service: 'route-explorer', repoPath: repoB, branch: 'feat/b' },
    ]);
  });

  it('a missing base branch fails that member only; the other member and the EDT succeed (AC3)', async () => {
    const xdg = await makeTempDir();
    const repoA = await makeGitRepo();
    const repoB = await makeGitRepo();
    const env = createEnv(xdg);
    await registerRepos([repoA, repoB], env);
    // Matrix row: the base is missing in repo A only — repo B carries it.
    expect(runGit(repoB, ['branch', 'nope']).status).toBe(0);

    const { status, stdout } = runCli(
      [
        'edt', 'create', '--topic', 'demo', '--member', repoA, '--member', repoB,
        '--create-branches', '--branch-name', 'feat/x', '--base', 'nope',
      ],
      env,
    );

    expect(status).toBe(0);
    const data = JSON.parse(stdout.trim()).data;
    expect(data.results[0]).toMatchObject({
      service: 'route-explorer',
      outcome: 'failed',
      detail: { code: 'base-branch-missing' },
    });
    expect(data.results[1]).toEqual({ service: 'route-explorer', outcome: 'created' });

    // repo A's branch creation failed, so it is excluded from members entirely (story 2.3)
    // — only repo B, which succeeded, is registered.
    const edtRegistry = parse(await readFile(join(xdg, 'tui-back', 'edts.yaml'), 'utf8'));
    expect(edtRegistry.edts[0].members).toHaveLength(1);
    expect(edtRegistry.edts[0].members[0]).toMatchObject({ repoPath: repoB, branch: 'feat/x' });
  });

  it('a name collision fails that member only (branch-exists); the other proceeds (matrix)', async () => {
    const xdg = await makeTempDir();
    const repoA = await makeGitRepo();
    const repoB = await makeGitRepo();
    const env = createEnv(xdg);
    await registerRepos([repoA, repoB], env);
    expect(runGit(repoA, ['branch', 'feat/x']).status).toBe(0);

    const { status, stdout } = runCli(
      [
        'edt', 'create', '--topic', 'demo', '--member', repoA, '--member', repoB,
        '--create-branches', '--branch-name', 'feat/x',
      ],
      env,
    );

    expect(status).toBe(0);
    const data = JSON.parse(stdout.trim()).data;
    expect(data.results[0]).toMatchObject({
      service: 'route-explorer',
      outcome: 'failed',
      detail: { code: 'branch-exists' },
    });
    expect(data.results[1]).toEqual({ service: 'route-explorer', outcome: 'created' });
  });

  it('rejects a shared-branch target before any git invocation (shared-branch-rejected, FR-7)', async () => {
    const xdg = await makeTempDir();
    const repo = await makeGitRepo();
    // Story 2.42: the protected set is manifest-defined — this fixture's manifest lists `prod`.
    await writeFile(join(repo, '.tui-back.yaml'), `${manifestYaml}\nprotectedBranches: [preprod, prod]\n`);
    const env = createEnv(xdg);
    await registerRepos([repo], env);

    const { status, stdout } = runCli(
      ['edt', 'create', '--topic', 'demo', '--member', repo, '--create-branches', '--branch-name', 'prod'],
      env,
    );

    expect(status).toBe(0); // EDT creation still succeeds
    const data = JSON.parse(stdout.trim()).data;
    expect(data.results).toEqual([
      expect.objectContaining({
        service: 'route-explorer',
        outcome: 'failed',
        detail: expect.objectContaining({ code: 'shared-branch-rejected' }),
      }),
    ]);
    // `prod` does not exist in the fixture and stays absent — the gate fired before git.
    expect(branchExists(repo, 'prod')).toBe(false);
  });

  it('rejects a member whose current branch is shared when branch-creation is disabled (story 2.3, FR-7)', async () => {
    const xdg = await makeTempDir();
    // makeGitRepo() leaves the repo on `development` (its default base branch) with no
    // other branch created — its current branch is the shared branch itself.
    const repo = await makeGitRepo();
    const env = createEnv(xdg);
    await registerRepos([repo], env);

    const { status, stdout } = runCli(
      ['edt', 'create', '--topic', 'demo', '--member', repo],
      env,
    );

    expect(status).toBe(0); // EDT creation still succeeds, with zero registered members
    const data = JSON.parse(stdout.trim()).data;
    expect(data.results).toEqual([
      expect.objectContaining({
        service: 'route-explorer',
        outcome: 'failed',
        detail: expect.objectContaining({ code: 'shared-branch-rejected' }),
      }),
    ]);

    const edtRegistry = parse(await readFile(join(xdg, 'tui-back', 'edts.yaml'), 'utf8'));
    expect(edtRegistry.edts).toEqual([
      expect.objectContaining({ ulid: data.ulid, topic: 'demo', members: [] }),
    ]);
  });

  it('rejects a duplicate topic with edt-topic-exists before any write (AC2)', async () => {
    const xdg = await makeTempDir();
    const repo = await makeGitRepo();
    const env = createEnv(xdg);
    await registerRepos([repo], env);
    expect(runCli(['edt', 'create', '--topic', 'demo', '--member', repo], env).status).toBe(0);

    const registryBefore = await readFile(join(xdg, 'tui-back', 'edts.yaml'), 'utf8');
    const ulidsBefore = await readdir(join(xdg, 'tui-back', 'edts'));

    const second = runCli(['edt', 'create', '--topic', 'demo', '--member', repo], env);

    expect(second.status).toBe(1);
    const parsed = JSON.parse(second.stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('edt-topic-exists');
    // No new EDT dir/db and no registry change — the rejection happened before any write.
    expect(await readdir(join(xdg, 'tui-back', 'edts'))).toEqual(ulidsBefore);
    expect(await readFile(join(xdg, 'tui-back', 'edts.yaml'), 'utf8')).toBe(registryBefore);
  });

  it('rejects zero members with invalid-member before any write (AC3)', async () => {
    const xdg = await makeTempDir();
    const env = createEnv(xdg);

    const { status, stdout } = runCli(['edt', 'create', '--topic', 'demo'], env);

    expect(status).toBe(1);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('invalid-member');
    await expectNoEdtState(xdg);
  });

  it('rejects an unregistered member with invalid-member before any write (matrix)', async () => {
    const xdg = await makeTempDir();
    const env = createEnv(xdg);

    const { status, stdout } = runCli(['edt', 'create', '--topic', 'demo', '--member', '/not/registered'], env);

    expect(status).toBe(1);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('invalid-member');
    await expectNoEdtState(xdg);
  });

  it('rejects duplicate --member values with invalid-argument (review)', async () => {
    const xdg = await makeTempDir();
    const repo = await makeGitRepo();
    const env = createEnv(xdg);
    await registerRepos([repo], env);

    const { status, stdout } = runCli(
      ['edt', 'create', '--topic', 'demo', '--member', repo, '--member', repo],
      env,
    );

    expect(status).toBe(1);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('invalid-argument');
    await expectNoEdtState(xdg);
  });

  it('rejects an empty --member value with invalid-argument (review)', async () => {
    const xdg = await makeTempDir();
    const env = createEnv(xdg);

    const { status, stdout } = runCli(['edt', 'create', '--topic', 'demo', '--member', ''], env);

    expect(status).toBe(1);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('invalid-argument');
    await expectNoEdtState(xdg);
  });

  it('rejects an empty grouped --branch-name with invalid-argument before touching git (review)', async () => {
    const xdg = await makeTempDir();
    const repo = await makeGitRepo();
    const env = createEnv(xdg);
    await registerRepos([repo], env);

    const { status, stdout } = runCli(
      ['edt', 'create', '--topic', 'demo', '--member', repo, '--create-branches', '--branch-name', ''],
      env,
    );

    expect(status).toBe(1);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('invalid-argument');
    await expectNoEdtState(xdg);
  });

  it('rejects a missing --topic with invalid-argument and exits 1 (review)', async () => {
    const xdg = await makeTempDir();
    const repo = await makeGitRepo();
    const env = createEnv(xdg);
    await registerRepos([repo], env);

    const { status, stdout } = runCli(['edt', 'create', '--member', repo], env);

    expect(status).toBe(1);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('invalid-argument');
    await expectNoEdtState(xdg);
  });

  it('rejects an invalid --branch-mode value with invalid-argument and exits 1 (review)', async () => {
    const xdg = await makeTempDir();
    const repo = await makeGitRepo();
    const env = createEnv(xdg);
    await registerRepos([repo], env);

    const { status, stdout } = runCli(
      ['edt', 'create', '--topic', 'demo', '--member', repo, '--create-branches', '--branch-mode', 'per-member'],
      env,
    );

    expect(status).toBe(1);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('invalid-argument');
    await expectNoEdtState(xdg);
  });

  it('rejects --branch-name without --create-branches with invalid-argument and exits 1 (review)', async () => {
    const xdg = await makeTempDir();
    const repo = await makeGitRepo();
    const env = createEnv(xdg);
    await registerRepos([repo], env);

    const { status, stdout } = runCli(
      ['edt', 'create', '--topic', 'demo', '--member', repo, '--branch-name', 'feat/x'],
      env,
    );

    expect(status).toBe(1);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('invalid-argument');
    await expectNoEdtState(xdg);
  });

  it('rejects two grouped --branch-name values with invalid-argument and exits 1 (review)', async () => {
    const xdg = await makeTempDir();
    const repo = await makeGitRepo();
    const env = createEnv(xdg);
    await registerRepos([repo], env);

    const { status, stdout } = runCli(
      ['edt', 'create', '--topic', 'demo', '--member', repo, '--create-branches', '--branch-name', 'feat/a', '--branch-name', 'feat/b'],
      env,
    );

    expect(status).toBe(1);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('invalid-argument');
    await expectNoEdtState(xdg);
  });

  it('rejects an individual --branch-name naming a non-member with invalid-argument (review)', async () => {
    const xdg = await makeTempDir();
    const repo = await makeGitRepo();
    const env = createEnv(xdg);
    await registerRepos([repo], env);

    const { status, stdout } = runCli(
      ['edt', 'create', '--topic', 'demo', '--member', repo, '--create-branches', '--branch-mode', 'individual', '--branch-name', `${join(xdg, 'not-a-member')}=feat/x`],
      env,
    );

    expect(status).toBe(1);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('invalid-argument');
    await expectNoEdtState(xdg);
  });

  it('two racing same-topic edt create subprocesses: exactly one registers, the other fails with edt-topic-exists (race, review)', async () => {
    const xdg = await makeTempDir();
    const repo = await makeGitRepo();
    const env = createEnv(xdg);
    await registerRepos([repo], env);

    const [a, b] = await Promise.all([
      runCliAsync(['edt', 'create', '--topic', 'demo', '--member', repo], env),
      runCliAsync(['edt', 'create', '--topic', 'demo', '--member', repo], env),
    ]);

    const okRun = [a, b].find((r) => r.status === 0);
    const failRun = [a, b].find((r) => r.status !== 0);
    expect(okRun).toBeDefined();
    expect(failRun).toBeDefined();
    const failParsed = JSON.parse(failRun!.stdout.trim());
    expect(failParsed.ok).toBe(false);
    expect(failParsed.error.code).toBe('edt-topic-exists');

    // Exactly one entry, from the winning run.
    const edtRegistry = parse(await readFile(join(xdg, 'tui-back', 'edts.yaml'), 'utf8'));
    expect(edtRegistry.edts).toHaveLength(1);
  });

  it('two racing edt create subprocesses each get their own ulid, both registered', async () => {
    const xdg = await makeTempDir();
    const repo = await makeGitRepo();
    const env = createEnv(xdg);
    await registerRepos([repo], env);

    const [a, b] = await Promise.all([
      runCliAsync(['edt', 'create', '--topic', 'alpha', '--member', repo], env),
      runCliAsync(['edt', 'create', '--topic', 'beta', '--member', repo], env),
    ]);

    expect(a.status).toBe(0);
    expect(b.status).toBe(0);
    const ulidA = JSON.parse(a.stdout.trim()).data.ulid;
    const ulidB = JSON.parse(b.stdout.trim()).data.ulid;
    expect(ulidA).not.toBe(ulidB);

    const edtRegistry = parse(await readFile(join(xdg, 'tui-back', 'edts.yaml'), 'utf8'));
    expect((edtRegistry.edts as Array<{ ulid: string }>).map((e) => e.ulid).sort()).toEqual([ulidA, ulidB].sort());
  });

  it('rejects an unknown edt action with invalid-argument and exits 1', () => {
    const { status, stdout } = runCli(['edt', 'bogus']);

    expect(status).toBe(1);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('invalid-argument');
  });
});

describe('tui-back edt switch (black-box)', () => {
  function createEnv(xdg: string) {
    return { XDG_CONFIG_HOME: xdg, XDG_DATA_HOME: xdg, XDG_STATE_HOME: xdg };
  }

  async function registerRepos(repos: string[], env: NodeJS.ProcessEnv): Promise<void> {
    for (const repo of repos) {
      expect(runCli(['register', repo], env).status).toBe(0);
    }
  }

  // makeGitRepo() (module-level) leaves .tui-back.yaml untracked (written before `git init`,
  // never added), so a fresh repo is never actually clean — irrelevant to edt-create's own
  // tests, but it would make every repo here look "dirty" from the moment it's registered,
  // confounding this describe's dirty/clean assertions. This variant commits everything
  // first for a truly clean starting point.
  async function makeCleanGitRepo(): Promise<string> {
    const dir = await makeGitRepo();
    runGit(dir, ['add', '.tui-back.yaml']);
    const commit = runGit(dir, ['commit', '-m', 'add manifest']);
    if (commit.status !== 0) {
      throw new Error(`git commit failed: ${commit.stderr}`);
    }
    return dir;
  }

  async function readEdtsYaml(xdg: string): Promise<{ edts: Array<{ ulid: string; topic: string; status: string }> }> {
    return parse(await readFile(join(xdg, 'tui-back', 'edts.yaml'), 'utf8'));
  }

  async function readStateJson(xdg: string): Promise<{ activeEdt: string | null }> {
    return JSON.parse(await readFile(join(xdg, 'tui-back', 'state.json'), 'utf8'));
  }

  it('fails upfront with edt-not-found for an unregistered topic, touching no repo (AC)', async () => {
    const xdg = await makeTempDir();
    const { status, stdout } = runCli(['edt', 'switch', '--to', 'no-such-topic'], createEnv(xdg));

    expect(status).toBe(1);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('edt-not-found');
    await expect(access(join(xdg, 'tui-back', 'state.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it(
    'round-trips uncommitted work across a switch: an outgoing member (state 1) is stashed under the outgoing tag, ' +
      'lands clean on its shared branch, and pops back onto its own branch when switching back (story 2.39, manual-check scenario, AC)',
    async () => {
      const xdg = await makeTempDir();
      const env = createEnv(xdg);
      const r1 = await makeCleanGitRepo();
      const r2 = await makeCleanGitRepo();
      await registerRepos([r1, r2], env);

      const createA = runCli(
        ['edt', 'create', '--topic', 'a', '--member', r1, '--create-branches', '--branch-name', 'feat/r1'],
        env,
      );
      expect(createA.status).toBe(0);
      const ulidA = JSON.parse(createA.stdout.trim()).data.ulid;

      const createB = runCli(
        ['edt', 'create', '--topic', 'b', '--member', r2, '--create-branches', '--branch-name', 'feat/r2'],
        env,
      );
      expect(createB.status).toBe(0);
      const ulidB = JSON.parse(createB.stdout.trim()).data.ulid;

      // First-ever switch: no outgoing EDT yet. r1 (a's member) moves onto its own branch;
      // r2 (not a member of a) stays on the shared branch (already there).
      const switchToA = runCli(['edt', 'switch', '--to', 'a'], env);
      expect(switchToA.status).toBe(0);
      expect(JSON.parse(switchToA.stdout.trim()).data).toMatchObject({
        ulid: ulidA,
        // r1 (a's member) checks into feat/r1; r2 (registered, but not a's member) is forced
        // onto the shared branch too — it just happens to already be there.
        results: [
          { service: 'route-explorer', outcome: 'switched' },
          { service: 'route-explorer', outcome: 'switched' },
        ],
        wasInterrupted: false,
      });
      expect(runGit(r1, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim()).toBe('feat/r1');
      expect((await readStateJson(xdg)).activeEdt).toBe(ulidA);

      // Dirty r1's working tree while "a" is active and r1 sits on feat/r1.
      await writeFile(join(r1, 'wip.txt'), 'uncommitted work');

      // Switch a -> b: r1 is a's member (state 1) and not b's, so its work is stashed under
      // `tui-back:<a>` for a's return and r1 lands clean on the shared branch; r2 (b's
      // member) checks into its own branch.
      const switchToB = runCli(['edt', 'switch', '--to', 'b'], env);

      expect(switchToB.status).toBe(0);
      const dataB = JSON.parse(switchToB.stdout.trim()).data;
      expect(dataB).toMatchObject({
        ulid: ulidB,
        results: [
          { service: 'route-explorer', outcome: 'switched' },
          { service: 'route-explorer', outcome: 'switched' },
        ],
        wasInterrupted: false,
      });

      // r1: on the shared branch, clean — the work never leaks out of its EDT (D1 gone).
      expect(runGit(r1, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim()).toBe('development');
      expect(runGit(r1, ['status', '--porcelain']).stdout.trim()).toBe('');
      expect(runGit(r1, ['stash', 'list']).stdout.trim()).toContain(`tui-back:${ulidA}`);

      // r2: checked into its own branch (b's).
      expect(runGit(r2, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim()).toBe('feat/r2');

      // state.json + edts.yaml both reflect exactly one active EDT (AD-10).
      expect((await readStateJson(xdg)).activeEdt).toBe(ulidB);
      const edtsAfterB = await readEdtsYaml(xdg);
      expect(edtsAfterB.edts.find((e) => e.ulid === ulidA)?.status).toBe('inactive');
      expect(edtsAfterB.edts.find((e) => e.ulid === ulidB)?.status).toBe('active');

      // Switching to the already-active EDT is a no-op success (FR-1).
      const noop = runCli(['edt', 'switch', '--to', 'b'], env);
      expect(noop.status).toBe(0);
      expect(JSON.parse(noop.stdout.trim()).data).toEqual({
        ulid: ulidB,
        topic: 'b',
        results: [],
        wasInterrupted: false,
      });

      // Switch back b -> a: r1 is a's member again and its a-tagged stash pops onto feat/r1.
      const switchBackToA = runCli(['edt', 'switch', '--to', 'a'], env);
      expect(switchBackToA.status).toBe(0);
      expect(runGit(r1, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim()).toBe('feat/r1');
      expect(await readFile(join(r1, 'wip.txt'), 'utf8')).toBe('uncommitted work');
      expect(runGit(r1, ['stash', 'list']).stdout.trim()).toBe('');
    },
  );

  it('fails safe on a dirty non-member: exits non-zero with switch-dirty-services-unresolved, touching nothing (story 2.39, AC)', async () => {
    const xdg = await makeTempDir();
    const env = createEnv(xdg);
    const r1 = await makeCleanGitRepo();
    const r2 = await makeCleanGitRepo();
    await registerRepos([r1, r2], env);

    const createA = runCli(
      ['edt', 'create', '--topic', 'a', '--member', r1, '--create-branches', '--branch-name', 'feat/r1'],
      env,
    );
    expect(createA.status).toBe(0);
    const edtsBefore = await readFile(join(xdg, 'tui-back', 'edts.yaml'), 'utf8');

    // r2 belongs to no EDT: its uncommitted work may only move under an explicit resolution.
    await writeFile(join(r2, 'orphan.txt'), 'nobody owns this');

    const switched = runCli(['edt', 'switch', '--to', 'a'], env);

    expect(switched.status).not.toBe(0);
    const parsed = JSON.parse(switched.stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('switch-dirty-services-unresolved');
    expect(parsed.error.details).toEqual([
      { service: 'route-explorer', repoPath: expect.stringContaining(r2.split('/').pop() as string), scope: 'non-member', currentBranch: 'development' },
    ]);

    // Zero repos touched, state.json/edts.yaml untouched.
    expect(runGit(r1, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim()).toBe('development');
    expect(runGit(r2, ['status', '--porcelain']).stdout.trim()).toContain('orphan.txt');
    expect(runGit(r2, ['stash', 'list']).stdout.trim()).toBe('');
    await expect(access(join(xdg, 'tui-back', 'state.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(xdg, 'tui-back', 'edts.yaml'), 'utf8')).toBe(edtsBefore);
  });

  describe('dirty flags (story 2.40)', () => {
    async function dirtyNonMemberSetup() {
      const xdg = await makeTempDir();
      const env = createEnv(xdg);
      const r1 = await makeCleanGitRepo();
      const r2 = await makeCleanGitRepo();
      await registerRepos([r1, r2], env);
      const created = runCli(
        ['edt', 'create', '--topic', 'a', '--member', r1, '--create-branches', '--branch-name', 'feat/r1'],
        env,
      );
      expect(created.status).toBe(0);
      await writeFile(join(r2, 'orphan.txt'), 'nobody owns this');
      return { xdg, env, r1, r2 };
    }

    it('--discard-dirty discards the non-member work and lists the paths in detail.discardedPaths', async () => {
      const { env, r2 } = await dirtyNonMemberSetup();

      const switched = runCli(['edt', 'switch', '--to', 'a', '--discard-dirty'], env);

      expect(switched.status).toBe(0);
      const parsed = JSON.parse(switched.stdout.trim());
      expect(parsed.ok).toBe(true);
      const row = parsed.data.results.find((r: { outcome: string }) => r.outcome === 'discarded');
      expect(row.detail.discardedPaths).toEqual(['orphan.txt']);
      expect(runGit(r2, ['status', '--porcelain']).stdout.trim()).toBe('');
    });

    it('--adopt-dirty without --adopt-branch on a shared branch fails with missing-argument, zero writes', async () => {
      const { r2, env } = await dirtyNonMemberSetup();

      const switched = runCli(['edt', 'switch', '--to', 'a', '--adopt-dirty'], env);

      expect(switched.status).not.toBe(0);
      expect(JSON.parse(switched.stdout.trim()).error.code).toBe('missing-argument');
      expect(runGit(r2, ['status', '--porcelain']).stdout.trim()).toContain('orphan.txt');
    });

    it('--adopt-dirty --adopt-branch adopts onto a new branch, never checking out the work away', async () => {
      const { env, r2 } = await dirtyNonMemberSetup();
      // Outgoing EDT needed: activate a first, then adopt into it while switching to b.
      const r3 = await makeCleanGitRepo();
      await registerRepos([r3], env);
      expect(runCli(['edt', 'switch', '--to', 'a', '--discard-dirty'], env).status).toBe(0);
      expect(runCli(['edt', 'create', '--topic', 'b', '--member', r3, '--create-branches', '--branch-name', 'feat/r3'], env).status).toBe(0);
      await writeFile(join(r2, 'orphan2.txt'), 'rescue me');

      const switched = runCli(['edt', 'switch', '--to', 'b', '--adopt-dirty', '--adopt-branch', 'feat/rescue'], env);

      expect(switched.status).toBe(0);
      const parsed = JSON.parse(switched.stdout.trim());
      expect(parsed.data.results).toContainEqual(
        expect.objectContaining({ outcome: 'adopted', detail: expect.objectContaining({ adoptedBranch: 'feat/rescue' }) }),
      );
      expect(runGit(r2, ['branch', '--list', 'feat/rescue']).stdout).toContain('feat/rescue');
    });

    it('--adopt-dirty with --discard-dirty is invalid-argument, zero writes', async () => {
      const { env, r2 } = await dirtyNonMemberSetup();

      const switched = runCli(['edt', 'switch', '--to', 'a', '--adopt-dirty', '--discard-dirty'], env);

      expect(switched.status).not.toBe(0);
      expect(JSON.parse(switched.stdout.trim()).error.code).toBe('invalid-argument');
      expect(runGit(r2, ['status', '--porcelain']).stdout.trim()).toContain('orphan.txt');
    });

    it('--adopt-dirty with no outgoing EDT fails with switch-adopt-without-outgoing', async () => {
      const { env } = await dirtyNonMemberSetup();

      const switched = runCli(['edt', 'switch', '--to', 'a', '--adopt-dirty', '--adopt-branch', 'feat/x'], env);

      expect(switched.status).not.toBe(0);
      expect(JSON.parse(switched.stdout.trim()).error.code).toBe('switch-adopt-without-outgoing');
    });
  });

  it('a target member whose own branch is missing locally is `failed` in data.results, never a thrown error (AC)', async () => {
    const xdg = await makeTempDir();
    const env = createEnv(xdg);
    const repo = await makeCleanGitRepo();
    await registerRepos([repo], env);

    const created = runCli(
      ['edt', 'create', '--topic', 'demo', '--member', repo, '--create-branches', '--branch-name', 'feat/demo'],
      env,
    );
    expect(created.status).toBe(0);
    // Simulate the branch having gone missing locally after registration (e.g. manually
    // deleted) — the registry still records it as this member's own branch.
    expect(runGit(repo, ['branch', '-D', 'feat/demo']).status).toBe(0);

    const switched = runCli(['edt', 'switch', '--to', 'demo'], env);

    expect(switched.status).toBe(0);
    const data = JSON.parse(switched.stdout.trim()).data;
    expect(data.results).toEqual([
      expect.objectContaining({ service: 'route-explorer', outcome: 'failed' }),
    ]);
    // state.json is still updated despite the per-repo failure (independent of repo outcomes).
    expect((await readStateJson(xdg)).activeEdt).toBe(data.ulid);
  });

  it(
    "rejects a target member whose branch is already registered as a different, still-registered EDT's own " +
      'branch for the same repo (AD-8 cross-EDT gate, review)',
    async () => {
      const xdg = await makeTempDir();
      const env = createEnv(xdg);
      const repo = await makeCleanGitRepo();
      await registerRepos([repo], env);

      // EDT "a" claims repo on feat/shared. Branch creation only creates the ref, never
      // checks the working tree out to it — the repo stays on `development` after this.
      const createA = runCli(
        ['edt', 'create', '--topic', 'a', '--member', repo, '--create-branches', '--branch-name', 'feat/shared'],
        env,
      );
      expect(createA.status).toBe(0);
      expect(runGit(repo, ['checkout', 'feat/shared']).status).toBe(0);

      // EDT "b" is created without --create-branches: the repo's current branch is now
      // feat/shared, and create.ts's branch-creation-disabled path has no edtId to
      // re-verify against — so "b" registers the very same repo+branch as its own, too.
      // This reproduces the ambiguous-ownership state the cross-EDT gate exists to catch at
      // switch time, since `assertAllowedBranch` is only ever re-verified (with an edtId)
      // inside switchActiveEdt, never at creation.
      const createB = runCli(['edt', 'create', '--topic', 'b', '--member', repo], env);
      expect(createB.status).toBe(0);
      expect(JSON.parse(createB.stdout.trim()).data.results).toEqual([
        expect.objectContaining({ outcome: 'existing-branch' }),
      ]);

      // main.ts's composition-root wiring (createGitPort(manifest, edtRegistry)) is what
      // makes this rejection real through the actual CLI binary — a regression there would
      // let this switch through undetected by any unit test, since those construct their own
      // EdtRegistryPort/GitPort directly rather than going through main.ts.
      const switched = runCli(['edt', 'switch', '--to', 'b'], env);

      expect(switched.status).toBe(0);
      const data = JSON.parse(switched.stdout.trim()).data;
      expect(data.results).toEqual([
        expect.objectContaining({
          service: 'route-explorer',
          outcome: 'failed',
          detail: expect.objectContaining({ code: 'branch-owned-by-other-edt' }),
        }),
      ]);
    },
  );

  it('blocks by default on a held outgoing lock; --force proceeds and marks it interrupted; returning reports wasInterrupted (AC)', async () => {
    const xdg = await makeTempDir();
    const env = createEnv(xdg);
    const r1 = await makeCleanGitRepo();
    const r2 = await makeCleanGitRepo();
    await registerRepos([r1, r2], env);

    const createA = runCli(['edt', 'create', '--topic', 'a', '--member', r1], env);
    expect(createA.status).toBe(0);
    const ulidA = JSON.parse(createA.stdout.trim()).data.ulid;
    const createB = runCli(['edt', 'create', '--topic', 'b', '--member', r2], env);
    expect(createB.status).toBe(0);

    expect(runCli(['edt', 'switch', '--to', 'a'], env).status).toBe(0);

    // Simulate an in-progress action holding edt:<ulidA>'s lock (this story only reserves the
    // convention — nothing acquires it yet, so the held lock is constructed directly here).
    const lockDir = join(xdg, 'tui-back', 'locks');
    const lockPath = lockPathFor(lockDir, `edt:${ulidA}`);
    await mkdir(lockPath, { recursive: true });
    await writeFile(join(lockPath, 'owner.json'), JSON.stringify({ pid: process.pid, timestamp: Date.now() }), 'utf8');

    const blocked = runCli(['edt', 'switch', '--to', 'b'], env);
    expect(blocked.status).toBe(1);
    const blockedParsed = JSON.parse(blocked.stdout.trim());
    expect(blockedParsed.ok).toBe(false);
    expect(blockedParsed.error.code).toBe('switch-blocked-action-in-progress');
    expect((await readStateJson(xdg)).activeEdt).toBe(ulidA);

    const forced = runCli(['edt', 'switch', '--to', 'b', '--force'], env);
    expect(forced.status).toBe(0);
    expect((await readStateJson(xdg)).activeEdt).not.toBe(ulidA);
    const edtsAfterForce = await readEdtsYaml(xdg);
    expect(edtsAfterForce.edts.find((e) => e.ulid === ulidA)?.status).toBe('interrupted');

    const backToA = runCli(['edt', 'switch', '--to', 'a'], env);
    expect(backToA.status).toBe(0);
    const backToAData = JSON.parse(backToA.stdout.trim()).data;
    expect(backToAData.wasInterrupted).toBe(true);
    const edtsAfterReturn = await readEdtsYaml(xdg);
    expect(edtsAfterReturn.edts.find((e) => e.ulid === ulidA)?.status).toBe('active');
  });
});

describe('tui-back edt delete (black-box, story 2.29)', () => {
  function createEnv(xdg: string) {
    return { XDG_CONFIG_HOME: xdg, XDG_DATA_HOME: xdg, XDG_STATE_HOME: xdg };
  }

  async function registerRepos(repos: string[], env: NodeJS.ProcessEnv): Promise<void> {
    for (const repo of repos) {
      expect(runCli(['register', repo], env).status).toBe(0);
    }
  }

  async function readEdtsYaml(xdg: string): Promise<{ edts: Array<{ ulid: string; topic: string; status: string }> }> {
    return parse(await readFile(join(xdg, 'tui-back', 'edts.yaml'), 'utf8'));
  }

  it('fails upfront with edt-not-found for an unregistered topic, touching no repo', async () => {
    const xdg = await makeTempDir();

    const result = runCli(['edt', 'delete', 'no-such-topic'], createEnv(xdg));

    expect(result.status).toBe(1);
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('edt-not-found');
  });

  it('rejects deleting the active EDT, never touching a member branch or the registry entry (AC)', async () => {
    const xdg = await makeTempDir();
    const env = createEnv(xdg);
    const repo = await makeGitRepo();
    // Story 2.39: a first-ever switch refuses a dirty target member without a resolution, so
    // the untracked manifest makeGitRepo() leaves behind is committed first.
    commitManifest(repo);
    await registerRepos([repo], env);
    const created = runCli(
      ['edt', 'create', '--topic', 'demo', '--member', repo, '--create-branches', '--branch-name', 'feat/demo'],
      env,
    );
    expect(created.status).toBe(0);
    expect(runCli(['edt', 'switch', '--to', 'demo'], env).status).toBe(0);

    const deleted = runCli(['edt', 'delete', 'demo'], env);

    expect(deleted.status).toBe(1);
    const parsed = JSON.parse(deleted.stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('edt-delete-active-rejected');
    expect(branchExists(repo, 'feat/demo')).toBe(true);
    expect((await readEdtsYaml(xdg)).edts.some((e) => e.topic === 'demo')).toBe(true);
  });

  it('deletes the EDT record and its SQLite file, leaving a member branch untouched by default (AC)', async () => {
    const xdg = await makeTempDir();
    const env = createEnv(xdg);
    const repo = await makeGitRepo();
    await registerRepos([repo], env);
    const created = runCli(
      ['edt', 'create', '--topic', 'demo', '--member', repo, '--create-branches', '--branch-name', 'feat/demo'],
      env,
    );
    expect(created.status).toBe(0);
    const ulid = JSON.parse(created.stdout.trim()).data.ulid;

    const deleted = runCli(['edt', 'delete', 'demo'], env);

    expect(deleted.status).toBe(0);
    const parsed = JSON.parse(deleted.stdout.trim());
    expect(parsed.data).toMatchObject({ ulid, topic: 'demo', results: [{ outcome: 'left' }] });
    expect((await readEdtsYaml(xdg)).edts.some((e) => e.topic === 'demo')).toBe(false);
    await expect(access(join(xdg, 'tui-back', 'edts', `${ulid}.db`))).rejects.toMatchObject({ code: 'ENOENT' });
    // Omitting --branches for the member leaves its branch untouched (AC).
    expect(branchExists(repo, 'feat/demo')).toBe(true);
  });

  it('deletes a member branch when --branches <repoPath>=delete is passed (AC)', async () => {
    const xdg = await makeTempDir();
    const env = createEnv(xdg);
    const repo = await makeGitRepo();
    await registerRepos([repo], env);
    const created = runCli(
      ['edt', 'create', '--topic', 'demo', '--member', repo, '--create-branches', '--branch-name', 'feat/demo'],
      env,
    );
    expect(created.status).toBe(0);

    const deleted = runCli(['edt', 'delete', 'demo', '--branches', `${repo}=delete`], env);

    expect(deleted.status).toBe(0);
    const parsed = JSON.parse(deleted.stdout.trim());
    expect(parsed.data.results).toEqual([{ service: 'route-explorer', outcome: 'deleted' }]);
    expect(branchExists(repo, 'feat/demo')).toBe(false);
  });

  it('reports invalid-argument for a missing topic or a malformed --branches value', async () => {
    const xdg = await makeTempDir();
    const env = createEnv(xdg);

    const missingTopic = runCli(['edt', 'delete'], env);
    expect(JSON.parse(missingTopic.stdout.trim()).error.code).toBe('invalid-argument');

    const malformed = runCli(['edt', 'delete', 'demo', '--branches', 'no-equals-sign'], env);
    expect(JSON.parse(malformed.stdout.trim()).error.code).toBe('invalid-argument');

    const badDisposition = runCli(['edt', 'delete', 'demo', '--branches', '/repo/a=maybe'], env);
    expect(JSON.parse(badDisposition.stdout.trim()).error.code).toBe('invalid-argument');
  });
});

describe('tui-back update (black-box, stories 3.1-3.2)', () => {
  function createEnv(xdg: string) {
    return { XDG_CONFIG_HOME: xdg, XDG_DATA_HOME: xdg, XDG_STATE_HOME: xdg };
  }

  // The shared manifestYaml fixture declares `migrationCommand: npm run migration:run`,
  // which has no package.json to run against in these fixtures — and story 3.2 executes
  // the declared command for real. Update members therefore rewrite the origin manifest
  // to the variant the case exercises before it is committed and cloned.
  function manifestYamlWithMigration(migrationCommand: string | null): string {
    const lines = ['service: route-explorer', 'container: route-explorer'];
    if (migrationCommand !== null) {
      lines.push(`migrationCommand: "${migrationCommand}"`);
    }
    return [...lines, 'sharedBranch: development', 'modules: {}'].join('\n');
  }

  // Story 3.8: the same manifest shape plus a declared clean-restart recipe. Commands are
  // double-quoted so shell metacharacters survive the YAML round-trip.
  function manifestYamlWithRestart(migrationCommand: string | null, restartCommands: string[]): string {
    const lines = ['service: route-explorer', 'container: route-explorer'];
    if (migrationCommand !== null) {
      lines.push(`migrationCommand: "${migrationCommand}"`);
    }
    lines.push('sharedBranch: development', 'restartCommands:');
    for (const command of restartCommands) {
      lines.push(`  - "${command}"`);
    }
    return [...lines, 'modules: {}'].join('\n');
  }

  async function registerRepos(repos: string[], env: NodeJS.ProcessEnv): Promise<void> {
    for (const repo of repos) {
      expect(runCli(['register', repo], env).status).toBe(0);
    }
  }

  // A stub `docker` on PATH so container restarts succeed deterministically without a real
  // runtime — the adapter's whole contract is the exit-code taxonomy, covered against the
  // real `docker` absence by the driven adapter's own tests.
  async function makeDockerStub(): Promise<string> {
    const stubDir = await mkdtemp(join(tmpdir(), 'tui-back-e2e-docker-'));
    tmpDirs.push(stubDir);
    await writeFile(join(stubDir, 'docker'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    return stubDir;
  }

  // Story 3.8: the same stub, but recording every invocation's argv — proves which restart
  // path a run took (plain `docker restart` vs the recipe, which never shells out to
  // docker at all).
  async function makeLoggingDockerStub(): Promise<{ stubDir: string; logPath: string }> {
    const stubDir = await mkdtemp(join(tmpdir(), 'tui-back-e2e-docker-'));
    tmpDirs.push(stubDir);
    const logPath = join(stubDir, 'argv.log');
    await writeFile(join(stubDir, 'docker'), `#!/bin/sh\necho "$@" >> "${logPath}"\nexit 0\n`, { mode: 0o755 });
    return { stubDir, logPath };
  }

  // A member repo cloned from its own origin, sitting on a feature branch behind the
  // origin's development — the "member on feature branch, behind shared branch, clean
  // tree" matrix row. The clone carries a committed manifest, so the tree starts clean.
  // `migrationCommand` selects the committed manifest variant: a shell command the update
  // really executes (default `true`), or null for a manifest declaring no migrations.
  async function makeBehindMember(migrationCommand: string | null = 'true'): Promise<{ origin: string; repo: string }> {
    return makeBehindMemberWithManifest(manifestYamlWithMigration(migrationCommand));
  }

  // Story 3.8: the same behind-member fixture but with a caller-supplied manifest —
  // the recipe variants commit a manifest declaring `restartCommands`.
  async function makeBehindMemberWithManifest(manifestYaml: string): Promise<{ origin: string; repo: string }> {
    const origin = await makeGitRepo();
    await writeFile(join(origin, '.tui-back.yaml'), manifestYaml);
    commitManifest(origin);
    const repo = await mkdtemp(join(tmpdir(), 'tui-back-e2e-clone-'));
    tmpDirs.push(repo);
    expect(spawnSync('git', ['clone', origin, repo], { encoding: 'utf8' }).status).toBe(0);
    runGit(repo, ['config', 'user.email', 'e2e@tui-back.test']);
    runGit(repo, ['config', 'user.name', 'tui-back e2e']);
    expect(runGit(repo, ['checkout', '-b', 'feat/member']).status).toBe(0);
    // Advance the shared branch on the origin only — the member is now behind.
    await writeFile(join(origin, 'shared.txt'), 'shared change');
    runGit(origin, ['add', 'shared.txt']);
    expect(runGit(origin, ['commit', '-m', 'advance shared']).status).toBe(0);
    return { origin, repo };
  }

  async function createAndSwitchEdt(env: NodeJS.ProcessEnv, topic: string, members: string[]): Promise<string> {
    const created = runCli(['edt', 'create', '--topic', topic, ...members.flatMap((m) => ['--member', m])], env);
    expect(created.status).toBe(0);
    const ulid = JSON.parse(created.stdout.trim()).data.ulid as string;
    expect(runCli(['edt', 'switch', '--to', topic], env).status).toBe(0);
    return ulid;
  }

  function withDocker(env: NodeJS.ProcessEnv, stubDir: string): NodeJS.ProcessEnv {
    return { ...env, PATH: `${stubDir}${delimiter}${process.env.PATH}` };
  }

  it('brings two behind members up to date: one JSON line, both updated, exit 0 (AC1)', async () => {
    const xdg = await makeTempDir();
    const env = createEnv(xdg);
    const a = await makeBehindMember();
    const b = await makeBehindMember();
    await registerRepos([a.repo, b.repo], env);
    await createAndSwitchEdt(env, 'demo', [a.repo, b.repo]);
    const dockerEnv = withDocker(env, await makeDockerStub());

    const { status, stdout } = runCli(['update'], dockerEnv);

    expect(status).toBe(0);
    expect(stdout.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(stdout.trim())).toEqual({
      ok: true,
      data: {
        ulid: expect.any(String),
        topic: 'demo',
        results: [
          { service: 'route-explorer', outcome: 'updated' },
          { service: 'route-explorer', outcome: 'updated' },
        ],
        scope: 'edt',
      },
    });
    // Both members now contain the origin's shared-branch advance.
    for (const { origin, repo } of [a, b]) {
      const originHead = runGit(origin, ['rev-parse', 'development']).stdout.trim();
      expect(runGit(repo, ['merge-base', '--is-ancestor', originHead, 'HEAD']).status).toBe(0);
    }
  });

  it('a conflicting member fails with merge-conflict back at its pre-run HEAD while the other still reports updated (AC4)', async () => {
    const xdg = await makeTempDir();
    const env = createEnv(xdg);
    // The conflicted member declares a marker-writing migration: its absence afterwards
    // proves the migration never ran for a member that never cleared pull/merge.
    const a = await makeBehindMember('touch should-not-run.txt');
    const b = await makeBehindMember();
    // Conflicting change on the same file the origin advanced, committed on the member side.
    await writeFile(join(a.repo, 'shared.txt'), 'member side');
    runGit(a.repo, ['add', 'shared.txt']);
    expect(runGit(a.repo, ['commit', '-m', 'member change']).status).toBe(0);
    const headBefore = runGit(a.repo, ['rev-parse', 'HEAD']).stdout.trim();
    await registerRepos([a.repo, b.repo], env);
    await createAndSwitchEdt(env, 'demo', [a.repo, b.repo]);
    const dockerEnv = withDocker(env, await makeDockerStub());

    const { status, stdout } = runCli(['update'], dockerEnv);

    expect(status).toBe(0);
    const data = JSON.parse(stdout.trim()).data;
    expect(data.results).toEqual([
      { service: 'route-explorer', outcome: 'failed', detail: expect.objectContaining({ code: 'merge-conflict' }) },
      { service: 'route-explorer', outcome: 'updated' },
    ]);
    // The conflicting repo is back at its pre-run HEAD with no merge in progress.
    expect(runGit(a.repo, ['rev-parse', 'HEAD']).stdout.trim()).toBe(headBefore);
    expect(runGit(a.repo, ['rev-parse', '--verify', 'MERGE_HEAD']).status).not.toBe(0);
    // Its migration never ran: the row kept merge-conflict and no marker file exists.
    await expect(access(join(a.repo, 'should-not-run.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('a dirty member is skipped with dirty-worktree detail, untouched, while the other updates', async () => {
    const xdg = await makeTempDir();
    const env = createEnv(xdg);
    const a = await makeBehindMember();
    const b = await makeBehindMember();
    await registerRepos([a.repo, b.repo], env);
    await createAndSwitchEdt(env, 'demo', [a.repo, b.repo]);
    // Dirtied after the switch: a first-ever switch refuses a dirty member without an
    // explicit resolution (story 2.39).
    await writeFile(join(a.repo, 'wip.txt'), 'uncommitted work');
    const dockerEnv = withDocker(env, await makeDockerStub());

    const { status, stdout } = runCli(['update'], dockerEnv);

    expect(status).toBe(0);
    expect(JSON.parse(stdout.trim()).data.results).toEqual([
      { service: 'route-explorer', outcome: 'skipped', detail: expect.objectContaining({ code: 'dirty-worktree' }) },
      { service: 'route-explorer', outcome: 'updated' },
    ]);
    // The dirty repo was never merged: the origin's advance is still not an ancestor.
    const originHead = runGit(a.origin, ['rev-parse', 'development']).stdout.trim();
    expect(runGit(a.repo, ['merge-base', '--is-ancestor', originHead, 'HEAD']).status).not.toBe(0);
  });

  it('a lockfile-only dirty member is auto-discarded and still updates, one JSON line (story 3.4)', async () => {
    const xdg = await makeTempDir();
    const env = createEnv(xdg);
    const a = await makeBehindMember();
    const b = await makeBehindMember();
    // Tracked lockfile dirt only: commit a package.json on the member branch, then modify
    // it without committing — the update must discard it silently and proceed.
    await writeFile(join(a.repo, 'package.json'), '{"name":"route-explorer"}\n');
    runGit(a.repo, ['add', 'package.json']);
    expect(runGit(a.repo, ['commit', '-m', 'add package.json']).status).toBe(0);
    await registerRepos([a.repo, b.repo], env);
    await createAndSwitchEdt(env, 'demo', [a.repo, b.repo]);
    // Dirtied after the switch (story 2.39: a first-ever switch refuses unresolved dirt).
    await writeFile(join(a.repo, 'package.json'), '{"name":"route-explorer-dirty"}\n');
    const dockerEnv = withDocker(env, await makeDockerStub());

    const { status, stdout } = runCli(['update'], dockerEnv);

    expect(status).toBe(0);
    expect(stdout.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(stdout.trim()).data.results).toEqual([
      { service: 'route-explorer', outcome: 'updated' },
      { service: 'route-explorer', outcome: 'updated' },
    ]);
    // The lockfile dirt was discarded (committed content restored) and the merge landed.
    expect(await readFile(join(a.repo, 'package.json'), 'utf8')).toBe('{"name":"route-explorer"}\n');
    const originHead = runGit(a.origin, ['rev-parse', 'development']).stdout.trim();
    expect(runGit(a.repo, ['merge-base', '--is-ancestor', originHead, 'HEAD']).status).toBe(0);
  });

  it('runs each member migrationCommand after pull/merge: marker files prove it ran, both updated (story 3.2 AC1)', async () => {
    const xdg = await makeTempDir();
    const env = createEnv(xdg);
    const a = await makeBehindMember('touch migrated.txt');
    const b = await makeBehindMember('touch migrated.txt');
    await registerRepos([a.repo, b.repo], env);
    await createAndSwitchEdt(env, 'demo', [a.repo, b.repo]);
    const dockerEnv = withDocker(env, await makeDockerStub());

    const { status, stdout } = runCli(['update'], dockerEnv);

    expect(status).toBe(0);
    expect(JSON.parse(stdout.trim()).data.results).toEqual([
      { service: 'route-explorer', outcome: 'updated' },
      { service: 'route-explorer', outcome: 'updated' },
    ]);
    // Both members merged AND migrated: the origin advance is an ancestor and the
    // migration's marker file exists in each working tree.
    for (const { origin, repo } of [a, b]) {
      const originHead = runGit(origin, ['rev-parse', 'development']).stdout.trim();
      expect(runGit(repo, ['merge-base', '--is-ancestor', originHead, 'HEAD']).status).toBe(0);
      await expect(access(join(repo, 'migrated.txt'))).resolves.toBeUndefined();
    }
  });

  it('skips the migration step without error when no migrationCommand is declared (story 3.2 AC2)', async () => {
    const xdg = await makeTempDir();
    const env = createEnv(xdg);
    const a = await makeBehindMember(null);
    const b = await makeBehindMember(null);
    await registerRepos([a.repo, b.repo], env);
    await createAndSwitchEdt(env, 'demo', [a.repo, b.repo]);
    const dockerEnv = withDocker(env, await makeDockerStub());

    const { status, stdout } = runCli(['update'], dockerEnv);

    expect(status).toBe(0);
    expect(JSON.parse(stdout.trim()).data.results).toEqual([
      { service: 'route-explorer', outcome: 'updated' },
      { service: 'route-explorer', outcome: 'updated' },
    ]);
  });

  it('a failing migration fails only that service with migration-failed detail while the other still reports updated (story 3.2 AC3)', async () => {
    const xdg = await makeTempDir();
    const env = createEnv(xdg);
    const a = await makeBehindMember('echo migration-boom >&2; exit 3');
    const b = await makeBehindMember('touch migrated.txt');
    await registerRepos([a.repo, b.repo], env);
    await createAndSwitchEdt(env, 'demo', [a.repo, b.repo]);
    const dockerEnv = withDocker(env, await makeDockerStub());

    const { status, stdout } = runCli(['update'], dockerEnv);

    expect(status).toBe(0);
    const data = JSON.parse(stdout.trim()).data;
    expect(data.results[1]).toEqual({ service: 'route-explorer', outcome: 'updated' });
    expect(data.results[0].service).toBe('route-explorer');
    expect(data.results[0].outcome).toBe('failed');
    expect(data.results[0].detail.code).toBe('migration-failed');
    // The detail names the command and carries the error output.
    expect(data.results[0].detail.message).toContain('echo migration-boom >&2; exit 3');
    expect(data.results[0].detail.message).toContain('migration-boom');
    // The failed repo stays on its merged code (migration runs after pull/merge).
    const originHead = runGit(a.origin, ['rev-parse', 'development']).stdout.trim();
    expect(runGit(a.repo, ['merge-base', '--is-ancestor', originHead, 'HEAD']).status).toBe(0);
    // The healthy member merged and migrated.
    await expect(access(join(b.repo, 'migrated.txt'))).resolves.toBeUndefined();
  });

  it('a dirty member never runs its migration and keeps dirty-worktree while the other updates (story 3.2 AC4)', async () => {
    const xdg = await makeTempDir();
    const env = createEnv(xdg);
    const a = await makeBehindMember('touch should-not-run.txt');
    const b = await makeBehindMember();
    await registerRepos([a.repo, b.repo], env);
    await createAndSwitchEdt(env, 'demo', [a.repo, b.repo]);
    // Dirtied after the switch: a first-ever switch refuses a dirty member without an
    // explicit resolution (story 2.39).
    await writeFile(join(a.repo, 'wip.txt'), 'uncommitted work');
    const dockerEnv = withDocker(env, await makeDockerStub());

    const { status, stdout } = runCli(['update'], dockerEnv);

    expect(status).toBe(0);
    expect(JSON.parse(stdout.trim()).data.results).toEqual([
      { service: 'route-explorer', outcome: 'skipped', detail: expect.objectContaining({ code: 'dirty-worktree' }) },
      { service: 'route-explorer', outcome: 'updated' },
    ]);
    // The dirty repo was never merged and never migrated.
    const originHead = runGit(a.origin, ['rev-parse', 'development']).stdout.trim();
    expect(runGit(a.repo, ['merge-base', '--is-ancestor', originHead, 'HEAD']).status).not.toBe(0);
    await expect(access(join(a.repo, 'should-not-run.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects unknown flags with invalid-argument, and gates --all behind --yes (story 3.3)', async () => {
    const xdg = await makeTempDir();

    for (const args of [['update', '--force'], ['update', 'extra']]) {
      const { status, stdout } = runCli(args, createEnv(xdg));

      expect(status).toBe(1);
      expect(JSON.parse(stdout.trim())).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
    }

    // --all without --yes never runs: one JSON line, confirmation-required, exit 1.
    const { status, stdout } = runCli(['update', '--all'], createEnv(xdg));

    expect(status).toBe(1);
    expect(stdout.trim().split('\n')).toHaveLength(1);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('confirmation-required');
    expect(parsed.error.message).toContain('--yes');
  });

  it('brings every managed repo up to date with update --all --yes, no EDT needed (story 3.3 AC1)', async () => {
    const xdg = await makeTempDir();
    const env = createEnv(xdg);
    const a = await makeBehindMember();
    const b = await makeBehindMember();
    await registerRepos([a.repo, b.repo], env);
    const dockerEnv = withDocker(env, await makeDockerStub());

    const { status, stdout } = runCli(['update', '--all', '--yes'], dockerEnv);

    expect(status).toBe(0);
    expect(stdout.trim().split('\n')).toHaveLength(1);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed).toEqual({
      ok: true,
      data: {
        ulid: 'all',
        topic: 'all-repos',
        results: [
          { service: 'route-explorer', outcome: 'updated' },
          { service: 'route-explorer', outcome: 'updated' },
        ],
        scope: 'all',
      },
    });
    // Both repos now contain the origin's shared-branch advance — the same per-service flow.
    for (const { origin, repo } of [a, b]) {
      const originHead = runGit(origin, ['rev-parse', 'development']).stdout.trim();
      expect(runGit(repo, ['merge-base', '--is-ancestor', originHead, 'HEAD']).status).toBe(0);
    }
  });

  it('update --all --yes accepts either flag order (story 3.3)', async () => {
    const xdg = await makeTempDir();
    const env = createEnv(xdg);
    const a = await makeBehindMember();
    await registerRepos([a.repo], env);
    const dockerEnv = withDocker(env, await makeDockerStub());

    const { status, stdout } = runCli(['update', '--yes', '--all'], dockerEnv);

    expect(status).toBe(0);
    expect(JSON.parse(stdout.trim())).toMatchObject({
      ok: true,
      data: { ulid: 'all', topic: 'all-repos', scope: 'all' },
    });
  });

  it('reports an empty registry as an explicit no-op with a note, exit 0 (story 3.3 AC4)', async () => {
    const xdg = await makeTempDir();
    const env = createEnv(xdg);

    const { status, stdout } = runCli(['update', '--all', '--yes'], env);

    expect(status).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(true);
    expect(parsed.data.ulid).toBe('all');
    expect(parsed.data.topic).toBe('all-repos');
    expect(parsed.data.scope).toBe('all');
    expect(parsed.data.results).toEqual([]);
    expect(typeof parsed.data.note).toBe('string');
    expect(parsed.data.note.length).toBeGreaterThan(0);
  });

  it('fails with no-active-edt when no EDT is active', async () => {
    const xdg = await makeTempDir();

    const { status, stdout } = runCli(['update'], createEnv(xdg));

    expect(status).toBe(1);
    expect(JSON.parse(stdout.trim())).toMatchObject({ ok: false, error: { code: 'no-active-edt' } });
  });

  it('reports a zero-member EDT as an explicit no-op with a note, exit 0', async () => {
    const xdg = await makeTempDir();
    const env = createEnv(xdg);
    const a = await makeBehindMember();
    await registerRepos([a.repo], env);
    await createAndSwitchEdt(env, 'demo', [a.repo]);
    // Empty the EDT via modify — creation itself always requires >=1 member.
    expect(runCli(['edt', 'modify', '--topic', 'demo', '--remove-member', a.repo], env).status).toBe(0);
    const dockerEnv = withDocker(env, await makeDockerStub());

    const { status, stdout } = runCli(['update'], dockerEnv);

    expect(status).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(true);
    expect(parsed.data.results).toEqual([]);
    expect(typeof parsed.data.note).toBe('string');
    expect(parsed.data.note.length).toBeGreaterThan(0);
  });

  it('follows the new group-update signature with full defaults: one JSON line, scope edt, migrations on (story 3.7)', async () => {
    const xdg = await makeTempDir();
    const env = createEnv(xdg);
    const a = await makeBehindMember('touch migrated.txt');
    await registerRepos([a.repo], env);
    await createAndSwitchEdt(env, 'demo', [a.repo]);
    const dockerEnv = withDocker(env, await makeDockerStub());

    const { status, stdout } = runCli(['update'], dockerEnv);

    expect(status).toBe(0);
    expect(stdout.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(stdout.trim())).toEqual({
      ok: true,
      data: {
        ulid: expect.any(String),
        topic: 'demo',
        results: [{ service: 'route-explorer', outcome: 'updated' }],
        scope: 'edt',
      },
    });
    // runMigrations defaults to true with no new CLI flags: the marker migration ran.
    await expect(access(join(a.repo, 'migrated.txt'))).resolves.toBeUndefined();
  });

  it('update --all --yes follows the new call-site defaults: scope all, migrations on, one JSON line (story 3.7)', async () => {
    const xdg = await makeTempDir();
    const env = createEnv(xdg);
    const a = await makeBehindMember('touch migrated.txt');
    const b = await makeBehindMember('touch migrated.txt');
    await registerRepos([a.repo, b.repo], env);
    const dockerEnv = withDocker(env, await makeDockerStub());

    const { status, stdout } = runCli(['update', '--all', '--yes'], dockerEnv);

    expect(status).toBe(0);
    expect(stdout.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(stdout.trim())).toEqual({
      ok: true,
      data: {
        ulid: 'all',
        topic: 'all-repos',
        results: [
          { service: 'route-explorer', outcome: 'updated' },
          { service: 'route-explorer', outcome: 'updated' },
        ],
        scope: 'all',
      },
    });
    // runMigrations defaults to true with no new CLI flags: both marker migrations ran.
    await expect(access(join(a.repo, 'migrated.txt'))).resolves.toBeUndefined();
    await expect(access(join(b.repo, 'migrated.txt'))).resolves.toBeUndefined();
  });

  it('falls back to the plain container restart when no recipe is declared (story 3.8)', async () => {
    const xdg = await makeTempDir();
    const env = createEnv(xdg);
    const a = await makeBehindMemberWithManifest(manifestYamlWithMigration(null));
    await registerRepos([a.repo], env);
    await createAndSwitchEdt(env, 'demo', [a.repo]);
    const { stubDir, logPath } = await makeLoggingDockerStub();
    const dockerEnv = withDocker(env, stubDir);

    const { status, stdout } = runCli(['update'], dockerEnv);

    expect(status).toBe(0);
    expect(JSON.parse(stdout.trim()).data.results).toEqual([{ service: 'route-explorer', outcome: 'updated' }]);
    // No recipe declared, so the run took the plain container-restart path.
    expect(await readFile(logPath, 'utf8')).toContain('restart -- route-explorer');
  });

  it('leaves a declared recipe untouched without the clean-restart toggle: plain restart runs (story 3.8)', async () => {
    const xdg = await makeTempDir();
    const env = createEnv(xdg);
    // The recipe would fail loudly (and mark the working tree) if it ever ran — the CLI
    // takes no configuration, so clean restart stays OFF and the recipe must stay untouched.
    const a = await makeBehindMemberWithManifest(manifestYamlWithRestart(null, ['touch recipe-ran.txt', 'exit 3']));
    await registerRepos([a.repo], env);
    await createAndSwitchEdt(env, 'demo', [a.repo]);
    const { stubDir, logPath } = await makeLoggingDockerStub();
    const dockerEnv = withDocker(env, stubDir);

    const { status, stdout } = runCli(['update'], dockerEnv);

    expect(status).toBe(0);
    expect(JSON.parse(stdout.trim()).data.results).toEqual([{ service: 'route-explorer', outcome: 'updated' }]);
    // The plain container restart ran instead of the recipe.
    expect(await readFile(logPath, 'utf8')).toContain('restart -- route-explorer');
    // No recipe command ever executed in the repo working directory.
    await expect(access(join(a.repo, 'recipe-ran.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a second run while one holds the lock with update-already-running (AC2)', { timeout: 30000 }, async () => {
    const xdg = await makeTempDir();
    const env = createEnv(xdg);
    const a = await makeBehindMember();
    await registerRepos([a.repo], env);
    await createAndSwitchEdt(env, 'demo', [a.repo]);
    // Simulate an in-progress group update holding the global key (a real run finishes in
    // milliseconds — too fast to race black-box — so the held lock is constructed directly,
    // mirroring the edt-switch lock test above).
    const lockDir = join(xdg, 'tui-back', 'locks');
    const lockPath = lockPathFor(lockDir, 'group-update');
    await mkdir(lockPath, { recursive: true });
    await writeFile(join(lockPath, 'owner.json'), JSON.stringify({ pid: process.pid, timestamp: Date.now() }), 'utf8');
    const dockerEnv = withDocker(env, await makeDockerStub());

    const { status, stdout } = runCli(['update'], dockerEnv);

    expect(status).toBe(1);
    expect(JSON.parse(stdout.trim())).toMatchObject({ ok: false, error: { code: 'update-already-running' } });
  });

  it('rejects update --all --yes while an EDT-scoped run holds the lock, and vice versa (story 3.3 AC3)', { timeout: 30000 }, async () => {
    const xdg = await makeTempDir();
    const env = createEnv(xdg);
    const a = await makeBehindMember();
    await registerRepos([a.repo], env);
    await createAndSwitchEdt(env, 'demo', [a.repo]);
    // A held global key blocks both scopes — the all-repos trigger serializes on the same
    // key, never on a per-EDT key.
    const lockDir = join(xdg, 'tui-back', 'locks');
    const lockPath = lockPathFor(lockDir, 'group-update');
    await mkdir(lockPath, { recursive: true });
    await writeFile(join(lockPath, 'owner.json'), JSON.stringify({ pid: process.pid, timestamp: Date.now() }), 'utf8');
    const dockerEnv = withDocker(env, await makeDockerStub());

    const blocked = runCli(['update', '--all', '--yes'], dockerEnv);

    expect(blocked.status).toBe(1);
    expect(JSON.parse(blocked.stdout.trim())).toMatchObject({ ok: false, error: { code: 'update-already-running' } });
  });
});

describe('tui-back registry clean (black-box, story 2.33)', () => {
  function createEnv(xdg: string) {
    return { XDG_CONFIG_HOME: xdg, XDG_STATE_HOME: xdg };
  }

  it('AC4: --yes --path <p1> --path <p2> removes both stale paths, one outcome row each', async () => {
    const xdg = await makeTempDir();
    const env = createEnv(xdg);
    const unreachable = await makeRepo(true);
    const unmanaged = await makeRepo(false);
    expect(runCli(['register', unreachable], env).status).toBe(0);
    expect(runCli(['register', unmanaged], env).status).toBe(0);
    await rm(unreachable, { recursive: true, force: true });

    const { status, stdout } = runCli(['registry', 'clean', '--yes', '--path', unreachable, '--path', unmanaged], env);

    expect(status).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed).toEqual({
      ok: true,
      data: {
        results: [
          { path: unreachable, outcome: 'removed' },
          { path: unmanaged, outcome: 'removed' },
        ],
      },
    });
    expect(parse(await readFile(join(xdg, 'tui-back', 'registry.yaml'), 'utf8'))).toEqual({ repos: [] });
  });

  it('scripted removal of an unregistered path is a no-op success, never touching the others', async () => {
    const xdg = await makeTempDir();
    const env = createEnv(xdg);
    const kept = await makeRepo(true);
    expect(runCli(['register', kept], env).status).toBe(0);

    const { status, stdout } = runCli(['registry', 'clean', '--yes', '--path', join(xdg, 'never-registered')], env);

    expect(status).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.data.results).toEqual([{ path: join(xdg, 'never-registered'), outcome: 'removed' }]);
    expect(parse(await readFile(join(xdg, 'tui-back', 'registry.yaml'), 'utf8'))).toEqual({ repos: [kept] });
  });

  it('a bare, non-interactive run on a fully healthy registry reports zero candidates explicitly, exit 0', async () => {
    const xdg = await makeTempDir();
    const env = createEnv(xdg);
    const healthy = await makeRepo(true);
    expect(runCli(['register', healthy], env).status).toBe(0);

    const { status, stdout } = runCli(['registry', 'clean'], env);

    expect(status).toBe(0);
    expect(JSON.parse(stdout.trim())).toEqual({ ok: true, data: { candidates: [], errors: [], results: [] } });
  });

  it('a bare, non-interactive run with stale entries present requires confirmation instead of silently removing anything', async () => {
    const xdg = await makeTempDir();
    const env = createEnv(xdg);
    const unreachable = await makeRepo(true);
    expect(runCli(['register', unreachable], env).status).toBe(0);
    await rm(unreachable, { recursive: true, force: true });

    const { status, stdout } = runCli(['registry', 'clean'], env);

    expect(status).toBe(1);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('confirmation-required');
    expect(parsed.error.details.candidates).toEqual([{ path: unreachable, reason: 'unreachable', memberOfEdts: [] }]);
    // Reporting the candidates is never itself a removal — the registry file is untouched.
    expect(parse(await readFile(join(xdg, 'tui-back', 'registry.yaml'), 'utf8'))).toEqual({ repos: [unreachable] });
  });

  it('rejects --path without --yes, and --yes without --path, with invalid-argument', async () => {
    const xdg = await makeTempDir();
    const env = createEnv(xdg);

    const pathOnly = runCli(['registry', 'clean', '--path', '/repo/a'], env);
    const yesOnly = runCli(['registry', 'clean', '--yes'], env);

    expect(JSON.parse(pathOnly.stdout.trim()).error.code).toBe('invalid-argument');
    expect(JSON.parse(yesOnly.stdout.trim()).error.code).toBe('invalid-argument');
  });

  it('rejects a --path value that looks like another flag or is empty, instead of silently misinterpreting it (review fix)', async () => {
    const xdg = await makeTempDir();
    const env = createEnv(xdg);

    const looksLikeFlag = runCli(['registry', 'clean', '--yes', '--path', '--yes'], env);
    const empty = runCli(['registry', 'clean', '--yes', '--path', ''], env);

    expect(JSON.parse(looksLikeFlag.stdout.trim()).error.code).toBe('invalid-argument');
    expect(JSON.parse(empty.stdout.trim()).error.code).toBe('invalid-argument');
  });

  it('de-duplicates the same resolved path given via multiple --path flags (review fix)', async () => {
    const xdg = await makeTempDir();
    const env = createEnv(xdg);
    const unreachable = await makeRepo(true);
    expect(runCli(['register', unreachable], env).status).toBe(0);
    await rm(unreachable, { recursive: true, force: true });

    const { status, stdout } = runCli(
      ['registry', 'clean', '--yes', '--path', unreachable, '--path', unreachable],
      env,
    );

    expect(status).toBe(0);
    expect(JSON.parse(stdout.trim())).toEqual({ ok: true, data: { results: [{ path: unreachable, outcome: 'removed' }] } });
  });

  it('flags a stale candidate that is still an EDT member with a memberOfEdts note, through the real CLI (AC3/AC6, review fix)', async () => {
    const xdg = await makeTempDir();
    const env = { XDG_CONFIG_HOME: xdg, XDG_DATA_HOME: xdg, XDG_STATE_HOME: xdg };
    const repo = await makeGitRepo();
    expect(runCli(['register', repo], env).status).toBe(0);
    const created = runCli(
      ['edt', 'create', '--topic', 'demo', '--member', repo, '--create-branches', '--branch-name', 'feat/demo'],
      env,
    );
    expect(created.status).toBe(0);
    await rm(repo, { recursive: true, force: true });

    const { status, stdout } = runCli(['registry', 'clean'], env);

    expect(status).toBe(1);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.error.code).toBe('confirmation-required');
    expect(parsed.error.details.candidates).toEqual([{ path: repo, reason: 'unreachable', memberOfEdts: ['demo'] }]);
  });
});
