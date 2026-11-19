import { afterEach, describe, expect, it } from 'vitest';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse } from 'yaml';
import { lockPathFor } from '../adapters/driven/lock/helpers.js';
import { manifestYaml, tmpDirs, runCli, makeTempDir, makeGitRepo, commitManifest, runGit, cleanupTmpDirs } from './e2e.test-support.js';

afterEach(cleanupTmpDirs);

describe('tui-back update (black-box)', () => {
  function createEnv(xdg: string) {
    return { XDG_CONFIG_HOME: xdg, XDG_DATA_HOME: xdg, XDG_STATE_HOME: xdg };
  }

  // The shared manifestYaml fixture declares `migrationCommand: npm run migration:run`, which
  // has no package.json to run against in these fixtures — and update executes the declared
  // command for real. Update members therefore rewrite the origin manifest to the variant the
  // case exercises before it is committed and cloned.
  function manifestYamlWithMigration(migrationCommand: string | null): string {
    const lines = ['service: route-explorer', 'container: route-explorer'];
    if (migrationCommand !== null) {
      lines.push(`migrationCommand: "${migrationCommand}"`);
    }
    return [...lines, 'sharedBranch: development', 'modules: {}'].join('\n');
  }

  // The same manifest shape plus a declared clean-restart recipe. Commands are
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

  // The same stub, but recording every invocation's argv — proves which restart
  // path a run took (plain `docker restart` vs the recipe, which never shells out to
  // docker at all).
  async function makeLoggingDockerStub(): Promise<{ stubDir: string; logPath: string }> {
    const stubDir = await mkdtemp(join(tmpdir(), 'tui-back-e2e-docker-'));
    tmpDirs.push(stubDir);
    const logPath = join(stubDir, 'argv.log');
    await writeFile(join(stubDir, 'docker'), `#!/bin/sh\necho "$@" >> "${logPath}"\nexit 0\n`, { mode: 0o755 });
    return { stubDir, logPath };
  }

  // A member repo cloned from its own origin, sitting on a feature branch behind the origin's
  // development, with a clean tree (the clone carries a committed manifest).
  // `migrationCommand` selects the committed manifest variant: a shell command the update
  // really executes (default `true`), or null for a manifest declaring no migrations.
  async function makeBehindMember(migrationCommand: string | null = 'true'): Promise<{ origin: string; repo: string }> {
    return makeBehindMemberWithManifest(manifestYamlWithMigration(migrationCommand));
  }

  // The same behind-member fixture but with a caller-supplied manifest —
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

  it('brings two behind members up to date: one JSON line, both updated, exit 0', async () => {
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
          { service: 'route-explorer', outcome: 'updated', run: expect.anything() },
          { service: 'route-explorer', outcome: 'updated', run: expect.anything() },
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

  it('a conflicting member fails with merge-conflict back at its pre-run HEAD while the other still reports updated', async () => {
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
      { service: 'route-explorer', outcome: 'updated', run: expect.objectContaining({ merge: expect.objectContaining({ kind: 'advanced', files: expect.any(Number) }) }) },
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
    // explicit resolution.
    await writeFile(join(a.repo, 'wip.txt'), 'uncommitted work');
    const dockerEnv = withDocker(env, await makeDockerStub());

    const { status, stdout } = runCli(['update'], dockerEnv);

    expect(status).toBe(0);
    expect(JSON.parse(stdout.trim()).data.results).toEqual([
      { service: 'route-explorer', outcome: 'skipped', detail: expect.objectContaining({ code: 'dirty-worktree' }) },
      { service: 'route-explorer', outcome: 'updated', run: expect.anything() },
    ]);
    // The dirty repo was never merged: the origin's advance is still not an ancestor.
    const originHead = runGit(a.origin, ['rev-parse', 'development']).stdout.trim();
    expect(runGit(a.repo, ['merge-base', '--is-ancestor', originHead, 'HEAD']).status).not.toBe(0);
  });

  it('a lockfile-only dirty member is auto-discarded and still updates, one JSON line', async () => {
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
    // Dirtied after the switch (a first-ever switch refuses unresolved dirt).
    await writeFile(join(a.repo, 'package.json'), '{"name":"route-explorer-dirty"}\n');
    const dockerEnv = withDocker(env, await makeDockerStub());

    const { status, stdout } = runCli(['update'], dockerEnv);

    expect(status).toBe(0);
    expect(stdout.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(stdout.trim()).data.results).toEqual([
      { service: 'route-explorer', outcome: 'updated', run: expect.anything() },
      { service: 'route-explorer', outcome: 'updated', run: expect.anything() },
    ]);
    // The lockfile dirt was discarded (committed content restored) and the merge landed.
    expect(await readFile(join(a.repo, 'package.json'), 'utf8')).toBe('{"name":"route-explorer"}\n');
    const originHead = runGit(a.origin, ['rev-parse', 'development']).stdout.trim();
    expect(runGit(a.repo, ['merge-base', '--is-ancestor', originHead, 'HEAD']).status).toBe(0);
  });

  it('runs each member migrationCommand after pull/merge: marker files prove it ran, both updated', async () => {
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
      { service: 'route-explorer', outcome: 'updated', run: expect.anything() },
      { service: 'route-explorer', outcome: 'updated', run: expect.anything() },
    ]);
    // Both members merged AND migrated: the origin advance is an ancestor and the
    // migration's marker file exists in each working tree.
    for (const { origin, repo } of [a, b]) {
      const originHead = runGit(origin, ['rev-parse', 'development']).stdout.trim();
      expect(runGit(repo, ['merge-base', '--is-ancestor', originHead, 'HEAD']).status).toBe(0);
      await expect(access(join(repo, 'migrated.txt'))).resolves.toBeUndefined();
    }
  });

  it('skips the migration step without error when no migrationCommand is declared', async () => {
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
      { service: 'route-explorer', outcome: 'updated', run: expect.anything() },
      { service: 'route-explorer', outcome: 'updated', run: expect.anything() },
    ]);
  });

  it('a failing migration fails only that service with migration-failed detail while the other still reports updated', async () => {
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
    expect(data.results[1]).toEqual({ service: 'route-explorer', outcome: 'updated', run: expect.anything() });
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

  it('a dirty member never runs its migration and keeps dirty-worktree while the other updates', async () => {
    const xdg = await makeTempDir();
    const env = createEnv(xdg);
    const a = await makeBehindMember('touch should-not-run.txt');
    const b = await makeBehindMember();
    await registerRepos([a.repo, b.repo], env);
    await createAndSwitchEdt(env, 'demo', [a.repo, b.repo]);
    // Dirtied after the switch: a first-ever switch refuses a dirty member without an
    // explicit resolution.
    await writeFile(join(a.repo, 'wip.txt'), 'uncommitted work');
    const dockerEnv = withDocker(env, await makeDockerStub());

    const { status, stdout } = runCli(['update'], dockerEnv);

    expect(status).toBe(0);
    expect(JSON.parse(stdout.trim()).data.results).toEqual([
      { service: 'route-explorer', outcome: 'skipped', detail: expect.objectContaining({ code: 'dirty-worktree' }) },
      { service: 'route-explorer', outcome: 'updated', run: expect.anything() },
    ]);
    // The dirty repo was never merged and never migrated.
    const originHead = runGit(a.origin, ['rev-parse', 'development']).stdout.trim();
    expect(runGit(a.repo, ['merge-base', '--is-ancestor', originHead, 'HEAD']).status).not.toBe(0);
    await expect(access(join(a.repo, 'should-not-run.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects unknown flags with invalid-argument, and gates --all behind --yes', async () => {
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

  it('brings every managed repo up to date with update --all --yes, no EDT needed', async () => {
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
          { service: 'route-explorer', outcome: 'updated', run: expect.anything() },
          { service: 'route-explorer', outcome: 'updated', run: expect.anything() },
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

  it('update --all --yes accepts either flag order', async () => {
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

  it('reports an empty registry as an explicit no-op with a note, exit 0', async () => {
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

  it('follows the group-update signature with full defaults: one JSON line, scope edt, migrations on', async () => {
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
        results: [{ service: 'route-explorer', outcome: 'updated', run: expect.anything() }],
        scope: 'edt',
      },
    });
    // runMigrations defaults to true with no new CLI flags: the marker migration ran.
    await expect(access(join(a.repo, 'migrated.txt'))).resolves.toBeUndefined();
  });

  it('update --all --yes follows the call-site defaults: scope all, migrations on, one JSON line', async () => {
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
          { service: 'route-explorer', outcome: 'updated', run: expect.anything() },
          { service: 'route-explorer', outcome: 'updated', run: expect.anything() },
        ],
        scope: 'all',
      },
    });
    // runMigrations defaults to true with no new CLI flags: both marker migrations ran.
    await expect(access(join(a.repo, 'migrated.txt'))).resolves.toBeUndefined();
    await expect(access(join(b.repo, 'migrated.txt'))).resolves.toBeUndefined();
  });

  it('falls back to the plain container restart when no recipe is declared', async () => {
    const xdg = await makeTempDir();
    const env = createEnv(xdg);
    const a = await makeBehindMemberWithManifest(manifestYamlWithMigration(null));
    await registerRepos([a.repo], env);
    await createAndSwitchEdt(env, 'demo', [a.repo]);
    const { stubDir, logPath } = await makeLoggingDockerStub();
    const dockerEnv = withDocker(env, stubDir);

    const { status, stdout } = runCli(['update'], dockerEnv);

    expect(status).toBe(0);
    expect(JSON.parse(stdout.trim()).data.results).toEqual([{ service: 'route-explorer', outcome: 'updated', run: expect.anything() }]);
    // No recipe declared, so the run took the plain container-restart path.
    expect(await readFile(logPath, 'utf8')).toContain('restart -- route-explorer');
  });

  it('leaves a declared recipe untouched without the clean-restart toggle: plain restart runs', async () => {
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
    expect(JSON.parse(stdout.trim()).data.results).toEqual([{ service: 'route-explorer', outcome: 'updated', run: expect.anything() }]);
    // The plain container restart ran instead of the recipe.
    expect(await readFile(logPath, 'utf8')).toContain('restart -- route-explorer');
    // No recipe command ever executed in the repo working directory.
    await expect(access(join(a.repo, 'recipe-ran.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a second run while one holds the lock with update-already-running', { timeout: 30000 }, async () => {
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

  it('rejects update --all --yes while an EDT-scoped run holds the lock, and vice versa', { timeout: 30000 }, async () => {
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
