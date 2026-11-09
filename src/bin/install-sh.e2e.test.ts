// Black-box tests for install.sh: it runs under a PATH holding only stubs, so no real
// git/node/npx is consulted and nothing is installed.
import { afterEach, describe, expect, it } from 'vitest';
import { accessSync, constants } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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
    expect(run(dir).status).toBe(1);
    expect(await logOf(log)).toBeNull();
  });

  it('exits 1 when npx is missing', async () => {
    const { dir } = await makeStubs({ npx: false });
    expect(run(dir).status).toBe(1);
  });
});
