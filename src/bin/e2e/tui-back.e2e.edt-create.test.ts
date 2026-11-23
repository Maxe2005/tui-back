import { afterEach, describe, expect, it } from 'vitest';
import { access, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import { manifestYaml, runCli, runCliAsync, makeTempDir, makeGitRepo, runGit, branchExists, cleanupTmpDirs } from './e2e.test-support.js';

afterEach(cleanupTmpDirs);

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

  it('creates the EDT skeleton (state.json, manifest, db) and registers topic + member branch', async () => {
    const xdg = await makeTempDir();
    const repo = await makeGitRepo();
    // makeGitRepo() leaves the repo on `development` (shared); check out an ordinary branch
    // so this skeleton/registration test isn't itself exercising the shared-branch gate (that
    // has its own dedicated case below).
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

  it('creates one shared branch in every member from the base (grouped mode)', async () => {
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

  it('creates one branch per member by path=name pairs (individual mode)', async () => {
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

  it('a missing base branch fails that member only; the other member and the EDT succeed', async () => {
    const xdg = await makeTempDir();
    const repoA = await makeGitRepo();
    const repoB = await makeGitRepo();
    const env = createEnv(xdg);
    await registerRepos([repoA, repoB], env);
    // The base is missing in repo A only — repo B carries it.
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

    // repo A's branch creation failed, so it is excluded from members entirely — only repo B,
    // which succeeded, is registered.
    const edtRegistry = parse(await readFile(join(xdg, 'tui-back', 'edts.yaml'), 'utf8'));
    expect(edtRegistry.edts[0].members).toHaveLength(1);
    expect(edtRegistry.edts[0].members[0]).toMatchObject({ repoPath: repoB, branch: 'feat/x' });
  });

  it('a name collision fails that member only (branch-exists); the other proceeds', async () => {
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
    // The protected set is manifest-defined — this fixture's manifest lists `prod`.
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

  it('rejects a member whose current branch is shared when branch-creation is disabled (FR-7)', async () => {
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

  it('rejects a duplicate topic with edt-topic-exists before any write', async () => {
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

  it('rejects zero members with invalid-member before any write', async () => {
    const xdg = await makeTempDir();
    const env = createEnv(xdg);

    const { status, stdout } = runCli(['edt', 'create', '--topic', 'demo'], env);

    expect(status).toBe(1);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('invalid-member');
    await expectNoEdtState(xdg);
  });

  it('rejects an unregistered member with invalid-member before any write', async () => {
    const xdg = await makeTempDir();
    const env = createEnv(xdg);

    const { status, stdout } = runCli(['edt', 'create', '--topic', 'demo', '--member', '/not/registered'], env);

    expect(status).toBe(1);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('invalid-member');
    await expectNoEdtState(xdg);
  });

  it('rejects duplicate --member values with invalid-argument', async () => {
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

  it('rejects an empty --member value with invalid-argument', async () => {
    const xdg = await makeTempDir();
    const env = createEnv(xdg);

    const { status, stdout } = runCli(['edt', 'create', '--topic', 'demo', '--member', ''], env);

    expect(status).toBe(1);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('invalid-argument');
    await expectNoEdtState(xdg);
  });

  it('rejects an empty grouped --branch-name with invalid-argument before touching git', async () => {
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

  it('rejects a missing --topic with invalid-argument and exits 1', async () => {
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

  it('rejects an invalid --branch-mode value with invalid-argument and exits 1', async () => {
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

  it('rejects --branch-name without --create-branches with invalid-argument and exits 1', async () => {
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

  it('rejects two grouped --branch-name values with invalid-argument and exits 1', async () => {
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

  it('rejects an individual --branch-name naming a non-member with invalid-argument', async () => {
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

  it('two racing same-topic edt create subprocesses: exactly one registers, the other fails with edt-topic-exists (race)', async () => {
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
