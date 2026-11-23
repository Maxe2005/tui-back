import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { tmpDirs, runCli, makeTempDir, makeRepo, cleanupTmpDirs } from './e2e.test-support.js';

afterEach(cleanupTmpDirs);

describe('tui-back list-routes (black-box)', () => {
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

describe('tui-back fire-request (black-box)', () => {
  // Envelope + arg-validation only: every case below rejects before any network call, so no
  // live dev-gateway is needed (the live fire is checked manually).
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

describe('tui-back request-* (black-box)', () => {
  // The saved-request library lives at <dataDir>/global.db, so every case below points
  // XDG_DATA_HOME at a temp dir — the real library is never touched.
  function requestEnv(xdg: string) {
    return { XDG_CONFIG_HOME: xdg, XDG_DATA_HOME: xdg, XDG_STATE_HOME: xdg };
  }

  it('request-list on an empty library returns ok with [] as exactly one JSON line, exit 0', async () => {
    const xdg = await makeTempDir();

    const { status, stdout } = runCli(['request-list'], requestEnv(xdg));

    expect(status).toBe(0);
    expect(stdout.split('\n')).toEqual([stdout.trim(), '']);
    expect(JSON.parse(stdout.trim())).toEqual({ ok: true, data: { requests: [] } });
  });

  it('request-fire and request-delete on unknown names fail saved-request-not-found, exit 1', async () => {
    const xdg = await makeTempDir();
    const env = requestEnv(xdg);

    for (const args of [['request-fire', 'missing'], ['request-delete', 'missing']]) {
      const { status, stdout } = runCli(args, env);

      expect(status).toBe(1);
      expect(stdout.split('\n')).toEqual([stdout.trim(), '']);
      expect(JSON.parse(stdout.trim())).toMatchObject({ ok: false, error: { code: 'saved-request-not-found' } });
    }
  });

  it('request-fire rejects --overwrite together with --save-as as invalid-argument, exit 1', async () => {
    const xdg = await makeTempDir();

    const { status, stdout } = runCli(['request-fire', 'any', '--overwrite', '--save-as', 'other'], requestEnv(xdg));

    expect(status).toBe(1);
    expect(JSON.parse(stdout.trim())).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
  });

  it('request-delete rejects a missing name with missing-argument and an extra one with invalid-argument', async () => {
    const xdg = await makeTempDir();
    const env = requestEnv(xdg);

    expect(runCli(['request-delete'], env).status).toBe(1);
    expect(JSON.parse(runCli(['request-delete'], env).stdout.trim())).toMatchObject({ ok: false, error: { code: 'missing-argument' } });
    expect(JSON.parse(runCli(['request-delete', 'a', 'b'], env).stdout.trim())).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
  });
});
