import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import { runCli, runCliAsync, makeTempDir, makeRepo, cleanupTmpDirs } from './e2e.test-support.js';

afterEach(cleanupTmpDirs);

describe('tui-back register (black-box)', () => {
  it('persists the path into XDG_CONFIG_HOME/tui-back/registry.yaml and exits 0', async () => {
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
