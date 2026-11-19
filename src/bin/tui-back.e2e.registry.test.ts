import { afterEach, describe, expect, it } from 'vitest';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import { runCli, makeTempDir, makeRepo, makeGitRepo, cleanupTmpDirs } from './e2e.test-support.js';

afterEach(cleanupTmpDirs);

describe('tui-back registry validate (black-box)', () => {
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

describe('tui-back registry clean (black-box)', () => {
  function createEnv(xdg: string) {
    return { XDG_CONFIG_HOME: xdg, XDG_STATE_HOME: xdg };
  }

  it('--yes --path <p1> --path <p2> removes both stale paths, one outcome row each', async () => {
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

  it('rejects a --path value that looks like another flag or is empty, instead of silently misinterpreting it', async () => {
    const xdg = await makeTempDir();
    const env = createEnv(xdg);

    const looksLikeFlag = runCli(['registry', 'clean', '--yes', '--path', '--yes'], env);
    const empty = runCli(['registry', 'clean', '--yes', '--path', ''], env);

    expect(JSON.parse(looksLikeFlag.stdout.trim()).error.code).toBe('invalid-argument');
    expect(JSON.parse(empty.stdout.trim()).error.code).toBe('invalid-argument');
  });

  it('de-duplicates the same resolved path given via multiple --path flags', async () => {
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

  it('flags a stale candidate that is still an EDT member with a memberOfEdts note, through the real CLI', async () => {
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
