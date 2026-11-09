// Black-box tests for install.sh: it runs under a PATH holding only stubs, so no real
// git/node/npx is consulted and nothing is installed.
import { afterEach, describe, expect, it } from 'vitest';
import { accessSync, constants } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const scriptPath = fileURLToPath(new URL('../../install.sh', import.meta.url));
const tmpDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function makeStubs(opts: { git?: boolean; nodeVersion?: string | null; npx?: boolean }): Promise<{ dir: string; log: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'tui-back-installsh-'));
  tmpDirs.push(dir);
  const log = join(dir, 'npx.log');
  const put = (name: string, body: string) => writeFile(join(dir, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  if (opts.git ?? true) await put('git', 'exit 0');
  if (opts.nodeVersion !== null) await put('node', `echo "v${opts.nodeVersion ?? '24.1.0'}"`);
  if (opts.npx ?? true) await put('npx', `echo "$@" >> "${log}"\nexit 7`);
  return { dir, log };
}

function run(dir: string, args: string[] = []) {
  return spawnSync('/bin/bash', [scriptPath, ...args], { encoding: 'utf8', env: { PATH: dir } });
}

async function logOf(path: string): Promise<string | null> {
  return readFile(path, 'utf8').catch(() => null);
}

describe('install.sh', () => {
  it('is executable and passes bash -n', () => {
    accessSync(scriptPath, constants.X_OK);
    expect(spawnSync('bash', ['-n', scriptPath], { encoding: 'utf8' }).status).toBe(0);
  });

  it('runs the npx installer with forwarded args and propagates its exit code', async () => {
    const { dir, log } = await makeStubs({});
    const r = run(dir, ['--uninstall']);
    expect(r.status).toBe(7);
    expect(await logOf(log)).toBe('-y github:Maxe2005/tui-back install --uninstall\n');
  });

  it('exits 1 with install instructions and runs nothing when git is missing', async () => {
    const { dir, log } = await makeStubs({ git: false });
    const r = run(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/apt install git/);
    expect(r.stderr).toMatch(/brew install git/);
    expect(await logOf(log)).toBeNull();
  });

  it('exits 1 with nvm/apt/brew instructions on Node < 24', async () => {
    const { dir, log } = await makeStubs({ nodeVersion: '20.11.0' });
    const r = run(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/nvm/);
    expect(r.stderr).toMatch(/brew/);
    expect(r.stderr).toMatch(/found 20\.11\.0/);
    expect(await logOf(log)).toBeNull();
  });

  it('exits 1 when node is missing', async () => {
    const { dir, log } = await makeStubs({ nodeVersion: null });
    const r = run(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/node .*required/);
    expect(await logOf(log)).toBeNull();
  });

  it('exits 1 with a dedicated message when npx is missing', async () => {
    const { dir } = await makeStubs({ npx: false });
    const r = run(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/npx was not found/);
  });

  it('rejects Node 23 and accepts exactly Node 24.0.0', async () => {
    const old = await makeStubs({ nodeVersion: '23.9.0' });
    expect(run(old.dir).status).toBe(1);
    expect(await logOf(old.log)).toBeNull();
    const ok = await makeStubs({ nodeVersion: '24.0.0' });
    expect(run(ok.dir).status).toBe(7);
    expect(await logOf(ok.log)).not.toBeNull();
  });

  it('exits 1 with the parse-error message on an unparsable Node version', async () => {
    const { dir, log } = await makeStubs({ nodeVersion: 'abc' });
    const r = run(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/could not parse/);
    expect(await logOf(log)).toBeNull();
  });

  it('targets the same repository as package.json', async () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { repository: { url: string } };
    const slug = /github\.com[/:]([^/]+\/[^/.]+)/.exec(pkg.repository.url)?.[1];
    const { dir, log } = await makeStubs({});
    run(dir);
    expect(await logOf(log)).toBe(`-y github:${slug} install\n`);
  });

  it('ships only runtime files according to npm pack', () => {
    const r = spawnSync('npm', ['pack', '--dry-run', '--json'], { encoding: 'utf8', cwd: fileURLToPath(new URL('../../', import.meta.url)) });
    expect(r.status).toBe(0);
    const files = (JSON.parse(r.stdout) as Array<{ files: Array<{ path: string }> }>)[0]!.files.map((f) => f.path);
    expect(files).toContain('src/bin/tui-back.mjs');
    expect(files).toContain('package.json');
    expect(files.filter((f) => /^(_bmad|\.agents|\.claude|\.opencode|\.bmad-loop)/.test(f) || /\.test\.tsx?$/.test(f))).toEqual([]);
  });
});
