// Shared fixtures for the git adapter tests: real temp git repos (child_process is not mocked),
// origin/clone pairs and EDT registry fakes. Each test file registers `afterEach(cleanupTmpDirs)`.
import { expect } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ok } from '../../../core/result.js';
import type { EdtRegistryEntry, EdtRegistryPort } from '../../../core/ports/edt-registry.js';
import type { ManifestPort } from '../../../core/ports/manifest.js';
import { loadManifest } from '../manifest/index.js';

export const tmpDirs: string[] = [];

export function runGit(dir: string, args: string[]): { status: number | null; stdout: string; stderr: string } {
  return spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
}

// The protected set is manifest-defined, so the fixture manifest declares
// `protectedBranches: [preprod, prod]` by default (alongside the defaulted `development`
// sharedBranch); pass `protectedBranches: null` to omit the line entirely.
export async function makeGitRepo(
  manifestSharedBranch?: string,
  protectedBranches: readonly string[] | null = ['preprod', 'prod'],
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tui-back-git-'));
  tmpDirs.push(dir);
  const manifest = [
    'service: route-explorer',
    'container: route-explorer',
    'migrationCommand: npm run migration:run',
    ...(manifestSharedBranch !== undefined ? [`sharedBranch: ${manifestSharedBranch}`] : []),
    ...(protectedBranches !== null ? [`protectedBranches: [${protectedBranches.join(', ')}]`] : []),
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

// makeGitRepo() leaves .tui-back.yaml untracked (written before `git init`, never added), so
// its working tree is never actually clean — irrelevant for the shared-branch-gate tests
// above, but wrong as a "clean" baseline for hasUncommittedChanges/stashSave/checkoutBranch/
// branchExistsLocally. This variant commits everything first, for a truly clean start.
export async function makeCleanGitRepo(): Promise<string> {
  const dir = await makeGitRepo();
  runGit(dir, ['add', '.tui-back.yaml']);
  const commit = runGit(dir, ['commit', '-m', 'add manifest']);
  if (commit.status !== 0) {
    throw new Error(`git commit failed: ${commit.stderr}`);
  }
  return dir;
}

export async function makeDirWithManifestOnly(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tui-back-git-manifest-only-'));
  tmpDirs.push(dir);
  await writeFile(
    join(dir, '.tui-back.yaml'),
    'service: s\ncontainer: c\nmigrationCommand: m\nprotectedBranches: [preprod, prod]\nmodules: {}\n',
  );
  return dir;
}

export async function makePlainDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tui-back-git-plain-'));
  tmpDirs.push(dir);
  return dir;
}

export function branchExists(dir: string, branch: string): boolean {
  return runGit(dir, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]).status === 0;
}

// The adapter resolves the protected set through the real manifest loader, so the full
// manifest → gate → git stack is exercised against the repo's actual .tui-back.yaml.
export const manifest: ManifestPort = { load: loadManifest };

// AD-8's cross-EDT half — applied only when both edtId and edtRegistry are given; omitting
// either keeps the shared-branch-only behavior (covered above).
export function fakeEdtRegistry(entries: EdtRegistryEntry[]): EdtRegistryPort {
  return {
    add: async () => ok(undefined),
    list: async () => ok(entries),
    setStatus: async () => ok(undefined),
    update: async () => ok(undefined),
    remove: async () => ok(undefined),
  };
}

export function edtEntry(ulid: string, repoPath: string, branch: string): EdtRegistryEntry {
  return {
    ulid,
    topic: `topic-${ulid}`,
    createdAt: '2026-08-18T00:00:00.000Z',
    status: 'active',
    members: [{ service: 'svc', repoPath, branch }],
  };
}

// Real clone/origin pairs so upstream tracking (branch.<name>.remote/merge, @{u}) is exercised
// for real, not faked. `git clone` auto-configures the cloned repo's initial branch to track
// the matching origin branch, so a bare clone is already the "in sync, upstream configured"
// baseline every other case builds from.
export async function makeOriginAndClone(): Promise<{ origin: string; clone: string }> {
  const origin = await makeGitRepo();
  const clone = await mkdtemp(join(tmpdir(), 'tui-back-git-ahead-behind-clone-'));
  tmpDirs.push(clone);
  const cloned = spawnSync('git', ['clone', origin, clone], { encoding: 'utf8' });
  if (cloned.status !== 0) {
    throw new Error(`git clone failed: ${cloned.stderr}`);
  }
  runGit(clone, ['config', 'user.email', 'ahead-behind@tui-back.test']);
  runGit(clone, ['config', 'user.name', 'tui-back ahead-behind test']);
  return { origin, clone };
}

export function commit(dir: string, message: string): void {
  const result = runGit(dir, ['commit', '--allow-empty', '-m', message]);
  if (result.status !== 0) {
    throw new Error(`git commit failed in ${dir}: ${result.stderr}`);
  }
}

// Fetches a branch from origin into a same-named local branch, never checking it out. Only
// ever used for a non-member repo's manifest sharedBranch when missing locally.
export async function makeGitRepoOriginAndClone(): Promise<{ origin: string; clone: string }> {
  const origin = await makeGitRepo();
  expect(runGit(origin, ['branch', 'feat/remote-only']).status).toBe(0);

  const clone = await mkdtemp(join(tmpdir(), 'tui-back-git-clone-'));
  tmpDirs.push(clone);
  const cloned = spawnSync('git', ['clone', origin, clone], { encoding: 'utf8' });
  if (cloned.status !== 0) {
    throw new Error(`git clone failed: ${cloned.stderr}`);
  }
  runGit(clone, ['config', 'user.email', 'clone@tui-back.test']);
  runGit(clone, ['config', 'user.name', 'tui-back clone']);
  return { origin, clone };
}

// A clone of makeGitRepoOriginAndClone's origin carries no manifest (origin's .tui-back.yaml
// is untracked, so it is never cloned); the gated writes below need one.
export async function makeManagedClone(): Promise<{ origin: string; clone: string }> {
  const pair = await makeGitRepoOriginAndClone();
  await writeFile(
    join(pair.clone, '.tui-back.yaml'),
    'service: clone\ncontainer: clone\nmigrationCommand: m\nprotectedBranches: [preprod, prod]\nmodules: {}\n',
  );
  return pair;
}

export function remoteRefExists(dir: string, ref: string): boolean {
  return runGit(dir, ['show-ref', '--verify', '--quiet', `refs/remotes/${ref}`]).status === 0;
}

export function upstreamOf(dir: string, branch: string): string | null {
  const result = runGit(dir, ['rev-parse', '--abbrev-ref', `${branch}@{u}`]);
  return result.status === 0 ? result.stdout.trim() : null;
}

export async function cleanupTmpDirs(): Promise<void> {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
