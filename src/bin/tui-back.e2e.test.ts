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
  it('lists every registered command, including edts, edt, and update, exit 0', () => {
    const { status, stdout } = runCli(['--help']);

    expect(status).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(true);
    const names = (parsed.data.commands as Array<{ name: string }>).map((c) => c.name);
    expect(names).toEqual(['register', 'list-repos', 'scan', 'ping', 'edts', 'edt', 'update']);
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
          { service: 'route-explorer', path: repo, isMember: false, sharedBranch: 'development', branch: 'development', ahead: 1, behind: 0, status: 'current' },
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
      { service: 'route-explorer', path: repo, isMember: false, sharedBranch: 'development', branch: 'development', ahead: null, behind: null, status: 'no-upstream' },
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
    'round-trips uncommitted work across a switch: outgoing member is stashed onto the shared branch, ' +
      'target member checks into its own branch, state.json + edts.yaml both reflect the new active EDT (manual-check scenario, AC)',
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

      // Switch a -> b: r1 is not a member of b, so it must be preserved (stashed) then reset
      // onto the shared branch; r2 (b's member) checks into its own branch.
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

      // r1: reset to the shared branch, working tree clean, uncommitted work preserved in a
      // message-tagged stash (not lost).
      expect(runGit(r1, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim()).toBe('development');
      expect(runGit(r1, ['status', '--porcelain']).stdout.trim()).toBe('');
      const r1Stash = runGit(r1, ['stash', 'list']).stdout;
      expect(r1Stash).toContain(`tui-back:${ulidA}`);

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
    },
  );

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

  // A member repo cloned from its own origin, sitting on a feature branch behind the
  // origin's development — the "member on feature branch, behind shared branch, clean
  // tree" matrix row. The clone carries a committed manifest, so the tree starts clean.
  // `migrationCommand` selects the committed manifest variant: a shell command the update
  // really executes (default `true`), or null for a manifest declaring no migrations.
  async function makeBehindMember(migrationCommand: string | null = 'true'): Promise<{ origin: string; repo: string }> {
    const origin = await makeGitRepo();
    await writeFile(join(origin, '.tui-back.yaml'), manifestYamlWithMigration(migrationCommand));
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
    await writeFile(join(a.repo, 'wip.txt'), 'uncommitted work');
    await registerRepos([a.repo, b.repo], env);
    await createAndSwitchEdt(env, 'demo', [a.repo, b.repo]);
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
    await writeFile(join(a.repo, 'wip.txt'), 'uncommitted work');
    await registerRepos([a.repo, b.repo], env);
    await createAndSwitchEdt(env, 'demo', [a.repo, b.repo]);
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

  it('rejects any flag — bare update only, no --all (story 3.3)', async () => {
    const xdg = await makeTempDir();

    for (const args of [['update', '--all'], ['update', '--force'], ['update', 'extra']]) {
      const { status, stdout } = runCli(args, createEnv(xdg));

      expect(status).toBe(1);
      expect(JSON.parse(stdout.trim())).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
    }
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
});
