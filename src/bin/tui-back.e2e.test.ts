// Black-box test per AD-13: "adapters/driving/cli tested black-box (invoke subcommand as
// child process, assert AD-3 envelope)". Spawns the real, shipped binary — no npm link
// required; node resolves package imports (tsx/esm/api) upward from the script's own
// location regardless of this test's cwd.
//
// Deliberately does not attempt to simulate a real TTY (no pty library in the Stack table).
// spawnSync's stdout is a pipe by default, so every case here exercises the non-TTY
// JSON-line branch; the TTY/human-text branch is covered directly by envelope.test.ts.
//
// Story 1.5's register/list-repos/scan cases all override XDG_CONFIG_HOME with a temp dir
// so the child process never touches the real config dir (registry.yaml writes are scoped
// to the fixture).
import { describe, expect, it, afterEach } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const scriptPath = fileURLToPath(new URL('./tui-back.mjs', import.meta.url));
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

afterEach(async () => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe('tui-back CLI (black-box)', () => {
  it('ping succeeds with the AD-3 envelope on stdout and exits 0', () => {
    const { status, stdout } = runCli(['ping']);

    expect(status).toBe(0);
    expect(JSON.parse(stdout.trim())).toEqual({ ok: true, data: { message: 'pong' } });
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

  it("package.json's bin field has exactly one entry — no per-action executable (AD-2)", async () => {
    const pkg = await import('../../package.json', { with: { type: 'json' } });
    expect(Object.keys(pkg.default.bin)).toEqual(['tui-back']);
  });
});

describe('tui-back register (black-box)', () => {
  it('persists the path into XDG_CONFIG_HOME/tui-back/registry.yaml and exits 0 (AC1)', async () => {
    const xdg = await makeTempDir();
    const repo = await makeRepo(false);

    const { status, stdout } = runCli(['register', repo], { XDG_CONFIG_HOME: xdg });

    expect(status).toBe(0);
    expect(JSON.parse(stdout.trim())).toEqual({ ok: true, data: { path: repo } });
    expect(parse(await readFile(join(xdg, 'tui-back', 'registry.yaml'), 'utf8'))).toEqual({ repos: [repo] });
  });

  it('register twice is a deduped no-op and list-repos twice is byte-identical (FR-1)', async () => {
    const xdg = await makeTempDir();
    const repo = await makeRepo(true);
    const env = { XDG_CONFIG_HOME: xdg };

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

  it('register with no path fails with missing-argument and exits 1', () => {
    const { status, stdout } = runCli(['register']);

    expect(status).toBe(1);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('missing-argument');
  });

  it('register rejects a relative path with invalid-argument and exits 1', async () => {
    const xdg = await makeTempDir();

    const { status, stdout } = runCli(['register', './relative'], { XDG_CONFIG_HOME: xdg });

    expect(status).toBe(1);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('invalid-argument');
  });

  it('register rejects excess arguments with invalid-argument and exits 1', () => {
    const { status, stdout } = runCli(['register', '/a', '/b']);

    expect(status).toBe(1);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('invalid-argument');
  });
});

describe('tui-back register --reset (black-box)', () => {
  it('backs up a corrupt registry, re-initializes it, and list-repos works again', async () => {
    const xdg = await makeTempDir();
    const repo = await makeRepo(true);
    const env = { XDG_CONFIG_HOME: xdg };
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
    const env = { XDG_CONFIG_HOME: xdg };
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

    const { status, stdout } = runCli(['register', '--reset', repo], { XDG_CONFIG_HOME: xdg });

    expect(status).toBe(0);
    expect(JSON.parse(stdout.trim())).toEqual({ ok: true, data: { path: repo, backupPath: null } });
  });

  it('rejects a missing path after --reset with missing-argument and exits 1', () => {
    const { status, stdout } = runCli(['register', '--reset']);

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
    const env = { XDG_CONFIG_HOME: xdg };

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
    const env = { XDG_CONFIG_HOME: xdg };
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
    const env = { XDG_CONFIG_HOME: xdg };
    await writeFile(
      join(repo, '.tui-back.yaml'),
      [
        'service: route-explorer',
        'container: route-explorer',
        'migrationCommand: npm run migration:run',
        'sharedBranch: development',
        'modules:',
        '  route-explorer: {}',
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

    const { status, stdout } = runCli(['list-repos'], { XDG_CONFIG_HOME: xdg });

    expect(status).toBe(0);
    expect(JSON.parse(stdout.trim())).toEqual({ ok: true, data: { repos: [], unreachable: [], errors: [] } });
  });

  it('with malformed registry.yaml fails registry-invalid-yaml and exits 1', async () => {
    const xdg = await makeTempDir();
    await mkdir(join(xdg, 'tui-back'), { recursive: true });
    await writeFile(join(xdg, 'tui-back', 'registry.yaml'), 'a: [unclosed');

    const { status, stdout } = runCli(['list-repos'], { XDG_CONFIG_HOME: xdg });

    expect(status).toBe(1);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('registry-invalid-yaml');
  });

  it('with a wrong-shaped registry.yaml fails registry-invalid-format and exits 1', async () => {
    const xdg = await makeTempDir();
    await mkdir(join(xdg, 'tui-back'), { recursive: true });
    await writeFile(join(xdg, 'tui-back', 'registry.yaml'), 'repositories: []\n');

    const { status, stdout } = runCli(['list-repos'], { XDG_CONFIG_HOME: xdg });

    expect(status).toBe(1);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('registry-invalid-format');
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

    const { status, stdout } = runCli(['scan', root], { XDG_CONFIG_HOME: xdg });

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

    const { status, stdout } = runCli(['scan', './workspace'], { XDG_CONFIG_HOME: xdg }, xdg);

    expect(status).toBe(0);
    expect(JSON.parse(stdout.trim())).toEqual({ ok: true, data: { candidates: [repo], skipped: [] } });
  });

  it('over a manifest-less root returns ok with empty candidates and exits 0', async () => {
    const xdg = await makeTempDir();
    const root = join(xdg, 'empty-workspace');
    await mkdir(root, { recursive: true });

    const { status, stdout } = runCli(['scan', root], { XDG_CONFIG_HOME: xdg });

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

    const { status, stdout } = runCli(['scan', join(xdg, 'does-not-exist')], { XDG_CONFIG_HOME: xdg });

    expect(status).toBe(1);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('scan-root-not-found');
  });
});
