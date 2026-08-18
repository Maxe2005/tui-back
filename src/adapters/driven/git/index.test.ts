// adapters/driven/git: integration tests against real temp git repos (AD-13 driven layer).
// node:child_process is deliberately not mocked — this adapter's whole contract is how the
// real `git` binary's exit codes/stderr surface as Result errors, and that the shared-branch
// gate fires before any `git` invocation. The "before any git" property is verified two ways:
// a shared target that does not exist stays absent afterwards (no creation ran), and a
// manifest-only directory that is NOT a git repository still gets the gate error rather than
// a git failure (any git invocation there would have failed as "not a git repository").
import { describe, expect, it, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { ManifestPort } from '../../../core/ports/manifest.js';
import { loadManifest } from '../manifest/index.js';
import { createBranch, createGitPort, currentBranch } from './index.js';

const tmpDirs: string[] = [];

afterEach(async () => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

function runGit(dir: string, args: string[]): { status: number | null; stdout: string; stderr: string } {
  return spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
}

async function makeGitRepo(manifestSharedBranch?: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tui-back-git-'));
  tmpDirs.push(dir);
  const manifest = [
    'service: route-explorer',
    'container: route-explorer',
    'migrationCommand: npm run migration:run',
    ...(manifestSharedBranch !== undefined ? [`sharedBranch: ${manifestSharedBranch}`] : []),
    'modules: {}',
  ].join('\n');
  await writeFile(join(dir, '.tui-back.yaml'), manifest);
  const init = runGit(dir, ['init', '-b', 'development']);
  if (init.status !== 0) {
    throw new Error(`git init failed: ${init.stderr}`);
  }
  runGit(dir, ['config', 'user.email', 'git-adapter@tui-back.test']);
  runGit(dir, ['config', 'user.name', 'git adapter test']);
  const commit = runGit(dir, ['commit', '--allow-empty', '-m', 'initial']);
  if (commit.status !== 0) {
    throw new Error(`git commit failed: ${commit.stderr}`);
  }
  return dir;
}

async function makeDirWithManifestOnly(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tui-back-git-manifest-only-'));
  tmpDirs.push(dir);
  await writeFile(join(dir, '.tui-back.yaml'), 'service: s\ncontainer: c\nmigrationCommand: m\nmodules: {}\n');
  return dir;
}

async function makePlainDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tui-back-git-plain-'));
  tmpDirs.push(dir);
  return dir;
}

function branchExists(dir: string, branch: string): boolean {
  return runGit(dir, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]).status === 0;
}

// The adapter resolves the shared-branch set through the real manifest loader, so the full
// manifest → gate → git stack is exercised against the repo's actual .tui-back.yaml.
const manifest: ManifestPort = { load: loadManifest };

describe('createBranch', () => {
  it('creates a branch ref from the base without checking it out', async () => {
    const repo = await makeGitRepo();

    const result = await createBranch(manifest, repo, 'feat/demo', 'development');

    expect(result).toEqual({ ok: true, data: undefined });
    expect(branchExists(repo, 'feat/demo')).toBe(true);
    expect(runGit(repo, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim()).toBe('development');
  });

  it('rejects an existing branch name with branch-exists', async () => {
    const repo = await makeGitRepo();
    expect(runGit(repo, ['branch', 'feat/taken']).status).toBe(0);

    const result = await createBranch(manifest, repo, 'feat/taken', 'development');

    expect(result).toMatchObject({ ok: false, error: { code: 'branch-exists' } });
  });

  it('rejects a missing base branch with base-branch-missing', async () => {
    const repo = await makeGitRepo();

    const result = await createBranch(manifest, repo, 'feat/x', 'nope');

    expect(result).toMatchObject({ ok: false, error: { code: 'base-branch-missing' } });
  });

  it('rejects every built-in shared branch before any git invocation', async () => {
    const repo = await makeGitRepo();

    for (const shared of ['development', 'preprod', 'prod']) {
      const result = await createBranch(manifest, repo, shared, 'development');
      expect(result).toMatchObject({ ok: false, error: { code: 'shared-branch-rejected' } });
      // A shared target that does not exist stays absent — the creation never ran.
      expect(branchExists(repo, shared)).toBe(shared === 'development');
    }
  });

  it('rejects a branch name equal to the repo manifest sharedBranch', async () => {
    const repo = await makeGitRepo('staging');

    const result = await createBranch(manifest, repo, 'staging', 'development');

    expect(result).toMatchObject({ ok: false, error: { code: 'shared-branch-rejected' } });
    expect(branchExists(repo, 'staging')).toBe(false);
  });

  it('rejects a shared branch without touching git at all (manifest-only dir, not a git repo)', async () => {
    const dir = await makeDirWithManifestOnly();

    const result = await createBranch(manifest, dir, 'prod', 'development');

    expect(result).toMatchObject({ ok: false, error: { code: 'shared-branch-rejected' } });
  });

  it('propagates a manifest load failure from the gate (sharedBranch cannot be resolved)', async () => {
    const repo = await makeGitRepo();
    await rm(join(repo, '.tui-back.yaml'), { force: true });

    const result = await createBranch(manifest, repo, 'feat/x', 'development');

    expect(result).toMatchObject({ ok: false, error: { code: 'manifest-not-found' } });
  });

  it('reports a controlled git error when branch state cannot be verified (not a git repo)', async () => {
    const dir = await makeDirWithManifestOnly();

    const result = await createBranch(manifest, dir, 'feat/x', 'development');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('git-create-branch-error');
    }
  });
});

describe('currentBranch', () => {
  it('reports the current branch via rev-parse --abbrev-ref HEAD', async () => {
    const repo = await makeGitRepo();

    expect(await currentBranch(repo)).toEqual({ ok: true, data: 'development' });

    // Creating another branch never changes the working tree's branch.
    expect(runGit(repo, ['branch', 'other']).status).toBe(0);
    expect(await currentBranch(repo)).toEqual({ ok: true, data: 'development' });
  });

  it('reports a controlled error on a non-git directory, never a throw', async () => {
    const dir = await makePlainDir();

    const result = await currentBranch(dir);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('git-current-branch-error');
    }
  });
});

describe('createGitPort', () => {
  it('wires both methods behind the factory pattern', async () => {
    const repo = await makeGitRepo();
    const port = createGitPort(manifest);

    expect(await port.currentBranch(repo)).toEqual({ ok: true, data: 'development' });
    expect(await port.createBranch(repo, 'feat/port', 'development')).toEqual({ ok: true, data: undefined });
    expect(branchExists(repo, 'feat/port')).toBe(true);
  });
});
