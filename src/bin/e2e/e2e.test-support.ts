// Shared helpers for the black-box CLI tests: spawn the shipped binary, build temp repos with or
// without a manifest. Every case points XDG_CONFIG_HOME at a temp dir so the real config dir is
// never touched. Each test file registers `afterEach(cleanupTmpDirs)`.
import { expect } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runGit, branchExists } from '../../adapters/driven/vcs/git/git.test-support.js';

export const scriptPath = fileURLToPath(new URL('../tui-back.mjs', import.meta.url));

export const manifestYaml = [
  'service: route-explorer',
  'container: route-explorer',
  'migrationCommand: npm run migration:run',
  'sharedBranch: development',
  'modules: {}',
].join('\n');

export const tmpDirs: string[] = [];

export function runCli(args: string[], env: NodeJS.ProcessEnv = {}, cwd?: string) {
  return spawnSync('node', [scriptPath, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    cwd,
  });
}

export async function runCliAsync(args: string[], env: NodeJS.ProcessEnv = {}): Promise<{ status: number | null; stdout: string }> {
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

export async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tui-back-e2e-'));
  tmpDirs.push(dir);
  return dir;
}

export async function makeRepo(withManifest: boolean): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tui-back-e2e-repo-'));
  tmpDirs.push(dir);
  if (withManifest) {
    await writeFile(join(dir, '.tui-back.yaml'), manifestYaml);
  }
  return dir;
}

export async function makeGitRepo(): Promise<string> {
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

// commits the manifest `makeGitRepo()` leaves untracked — needed whenever a repo is either
// cloned (an untracked file in the source working tree is never copied by `git clone`) or
// put through `edt switch` (which would otherwise stash an untracked .tui-back.yaml away as
// "uncommitted work", deleting it from the working tree and breaking every later manifest
// read for that repo).
export function commitManifest(dir: string): void {
  expect(runGit(dir, ['add', '.tui-back.yaml']).status).toBe(0);
  expect(runGit(dir, ['commit', '-m', 'add manifest']).status).toBe(0);
}

export async function cleanupTmpDirs(): Promise<void> {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

export { branchExists, runGit };
