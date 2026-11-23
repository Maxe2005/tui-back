// Black-box CLI tests (AD-13): spawns the real, shipped binary as a child process and asserts
// the envelope. spawnSync's stdout is a pipe and there is no pty library, so only the non-TTY
// JSON branch runs here (envelope.test.ts covers TTY rendering) and the fullscreen TUI binary
// is never spawned — its alt-screen and resize behavior are verified manually.

import { afterEach, describe, expect, it } from 'vitest';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { manifestYaml, tmpDirs, runCli, makeTempDir, makeRepo, makeGitRepo, commitManifest, runGit, cleanupTmpDirs } from './e2e.test-support.js';

afterEach(cleanupTmpDirs);

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

  it("package.json's bin field exposes exactly one executable binary, tui-back (AD-2)", async () => {
    const pkg = await import('../../../package.json', { with: { type: 'json' } });
    expect(Object.keys(pkg.default.bin)).toEqual(['tui-back']);
    const target = fileURLToPath(new URL(`../../../${pkg.default.bin['tui-back']}`, import.meta.url));
    await access(target, constants.X_OK);
  });

  it('`tui` with non-TTY stdin exits 1 with an interactive-terminal message', () => {
    const { status, stdout, stderr } = runCli(['tui']);

    expect(status).toBe(1);
    expect(stdout).toBe('');
    expect(stderr).toContain('tui-back tui requires an interactive terminal');
  });

  it('--help lists the static tui entry', () => {
    const parsed = JSON.parse(runCli(['--help']).stdout.trim());

    expect(parsed.data.commands.map((c: { name: string }) => c.name)).toContain('tui');
  });
});

describe('tui-back --help (black-box)', () => {
  it('lists every registered command, including edts, edt, update, list-routes, and fire-request, exit 0', () => {
    const { status, stdout } = runCli(['--help']);

    expect(status).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(true);
    const names = (parsed.data.commands as Array<{ name: string }>).map((c) => c.name);
    expect(names).toEqual(['register', 'list-repos', 'scan', 'ping', 'edts', 'dashboard', 'edt', 'update', 'realign', 'heal', 'registry', 'list-routes', 'fire-request', 'request-list', 'request-fire', 'request-delete', 'install', 'completion', 'tui', 'mcp']);
  });
});

describe('tui-back list-repos (black-box)', () => {
  it('lists managed repos, silently skips unmanaged, and reports unreachable', async () => {
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

  it('surfaces moduleIds in the JSON envelope for a module-free managed repo', async () => {
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

  it('lists a container-less repo with container null in the JSON envelope', async () => {
    const xdg = await makeTempDir();
    const repo = await makeRepo(false);
    const env = { XDG_CONFIG_HOME: xdg, XDG_STATE_HOME: xdg };
    await writeFile(
      join(repo, '.tui-back.yaml'),
      ['service: shared-types', 'sharedBranch: development', 'modules: {}', ''].join('\n'),
    );
    expect(runCli(['register', repo], env).status).toBe(0);

    const { status, stdout } = runCli(['list-repos'], env);

    expect(status).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(true);
    expect(parsed.data.repos).toEqual([
      { path: repo, service: 'shared-types', container: null, sharedBranch: 'development', moduleIds: [] },
    ]);
  });

  it('surfaces a manifest with a non-empty modules map as an unknown-module error', async () => {
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

describe('tui-back edts (black-box)', () => {
  it('shows branch + ahead/behind for a service with a configured upstream', async () => {
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

  it('shows an explicit "no upstream" state for a repo with no remote configured', async () => {
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

  it('edt list shows a system-shared row only while edts.sharedBranchesEdtEnabled is on', async () => {
    const xdg = await makeTempDir();
    const env = { XDG_CONFIG_HOME: xdg, XDG_STATE_HOME: xdg };
    const repo = await makeGitRepo();
    expect(runCli(['register', repo], env).status).toBe(0);
    const kinds = () => {
      const { status, stdout } = runCli(['edt', 'list'], env);
      expect(status).toBe(0);
      return JSON.parse(stdout.trim()).data.edts.map((edt: { kind: string; topic: string }) => [edt.topic, edt.kind]);
    };

    expect(kinds()).toEqual([]);

    await writeFile(join(xdg, 'tui-back', 'settings.yaml'), 'edts:\n  sharedBranchesEdtEnabled: true\n');
    expect(kinds()).toEqual([['Shared branches', 'system-shared']]);

    await writeFile(join(xdg, 'tui-back', 'settings.yaml'), 'edts:\n  sharedBranchesEdtEnabled: false\n');
    expect(kinds()).toEqual([]);
  });

  it('with no registry.yaml returns an empty listing and exits 0', async () => {
    const xdg = await makeTempDir();

    const { status, stdout } = runCli(['edts'], { XDG_CONFIG_HOME: xdg, XDG_STATE_HOME: xdg });

    expect(status).toBe(0);
    expect(JSON.parse(stdout.trim())).toEqual({ ok: true, data: { services: [], unreachable: [], errors: [] } });
  });

  it('marks the active EDT\'s member service isMember: true, uniformly alongside a non-member', async () => {
    const xdg = await makeTempDir();
    const env = { XDG_CONFIG_HOME: xdg, XDG_STATE_HOME: xdg };
    const member = await makeGitRepo();
    commitManifest(member);
    // The default flow (no --create-branches) reuses the member's *current* branch as its
    // own EDT branch — which must not be the shared `development` branch (the gate rejects
    // it), so check it out onto an ordinary feature branch first.
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
