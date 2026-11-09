// adapters/driven/git: integration tests against real temp git repos; child_process is not
// mocked. The gate firing "before any git" is checked two ways: a protected target that does
// not exist stays absent, and a manifest-only directory that is NOT a git repository still
// gets the gate error rather than a "not a git repository" failure.
import { describe, expect, it, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ok } from '../../../core/result.js';
import type { EdtRegistryEntry, EdtRegistryPort } from '../../../core/ports/edt-registry.js';
import type { ManifestPort } from '../../../core/ports/manifest.js';
import { loadManifest } from '../manifest/index.js';
import {
  aheadBehind,
  abortMerge,
  assertAllowedBranch,
  branchExistsLocally,
  checkoutBranch,
  createBranch,
  createGitPort,
  createTrackingBranch,
  currentBranch,
  deleteBranch,
  diffNameOnly,
  diffStat,
  headRevision,
  discardAll,
  discardPaths,
  discardPathsToHead,
  fetchBranch,
  fetchRemoteBranch,
  listUnpushedCommits,
  finalizeMerge,
  hasStash,
  hasUncommittedChanges,
  hasUnmergedPaths,
  isBranchMerged,
  isMergeInProgress,
  isRebaseInProgress,
  listBranches,
  listDirtyPaths,
  listRemoteBranches,
  mergeBranch,
  pullBranch,
  renameBranch,
  restoreStash,
  stagePaths,
  commitPaths,
  stashSave,
  listUnmergedPaths,
  readWorktreeFile,
  writeResolvedFile,
  checkoutSide,
} from './index.js';

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

// The protected set is manifest-defined, so the fixture manifest declares
// `protectedBranches: [preprod, prod]` by default (alongside the defaulted `development`
// sharedBranch); pass `protectedBranches: null` to omit the line entirely.
async function makeGitRepo(
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
async function makeCleanGitRepo(): Promise<string> {
  const dir = await makeGitRepo();
  runGit(dir, ['add', '.tui-back.yaml']);
  const commit = runGit(dir, ['commit', '-m', 'add manifest']);
  if (commit.status !== 0) {
    throw new Error(`git commit failed: ${commit.stderr}`);
  }
  return dir;
}

async function makeDirWithManifestOnly(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tui-back-git-manifest-only-'));
  tmpDirs.push(dir);
  await writeFile(
    join(dir, '.tui-back.yaml'),
    'service: s\ncontainer: c\nmigrationCommand: m\nprotectedBranches: [preprod, prod]\nmodules: {}\n',
  );
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

// The adapter resolves the protected set through the real manifest loader, so the full
// manifest → gate → git stack is exercised against the repo's actual .tui-back.yaml.
const manifest: ManifestPort = { load: loadManifest };

describe('assertAllowedBranch', () => {
  it('rejects every manifest-protected branch and the sharedBranch without any git invocation', async () => {
    const repo = await makeDirWithManifestOnly();

    for (const shared of ['development', 'preprod', 'prod']) {
      const result = await assertAllowedBranch(manifest, repo, shared);
      expect(result).toMatchObject({ ok: false, error: { code: 'shared-branch-rejected' } });
    }
  });

  it("names the branch and the service's manifest in the rejection", async () => {
    const repo = await makeGitRepo();

    const result = await assertAllowedBranch(manifest, repo, 'preprod');

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'shared-branch-rejected', message: `Branch "preprod" is protected by route-explorer's manifest (repo ${repo})` },
    });
  });

  it('allows a formerly implicit branch when the manifest does not list it', async () => {
    const repo = await makeGitRepo('main', null);

    for (const formerlyImplicit of ['development', 'preprod', 'prod']) {
      expect(await assertAllowedBranch(manifest, repo, formerlyImplicit)).toEqual({ ok: true, data: undefined });
    }
    expect(await assertAllowedBranch(manifest, repo, 'main')).toMatchObject({
      ok: false,
      error: { code: 'shared-branch-rejected' },
    });
  });

  it('allows prod with no protectedBranches line and the default development sharedBranch', async () => {
    const repo = await makeGitRepo(undefined, null);

    expect(await assertAllowedBranch(manifest, repo, 'prod')).toEqual({ ok: true, data: undefined });
    expect(await assertAllowedBranch(manifest, repo, 'development')).toMatchObject({
      ok: false,
      error: { code: 'shared-branch-rejected' },
    });
  });

  it('rejects a branch name equal to the repo manifest sharedBranch', async () => {
    const repo = await makeGitRepo('staging');

    const result = await assertAllowedBranch(manifest, repo, 'staging');

    expect(result).toMatchObject({ ok: false, error: { code: 'shared-branch-rejected' } });
  });

  it('passes an ordinary branch name (not in the shared set)', async () => {
    const repo = await makeGitRepo();

    const result = await assertAllowedBranch(manifest, repo, 'feat/ordinary');

    expect(result).toEqual({ ok: true, data: undefined });
  });

  it('propagates a manifest load failure from the gate (sharedBranch cannot be resolved)', async () => {
    const repo = await makeGitRepo();
    await rm(join(repo, '.tui-back.yaml'), { force: true });

    const result = await assertAllowedBranch(manifest, repo, 'feat/x');

    expect(result).toMatchObject({ ok: false, error: { code: 'manifest-not-found' } });
  });
});

// AD-8's cross-EDT half — applied only when both edtId and edtRegistry are given; omitting
// either keeps the shared-branch-only behavior (covered above).
function fakeEdtRegistry(entries: EdtRegistryEntry[]): EdtRegistryPort {
  return {
    add: async () => ok(undefined),
    list: async () => ok(entries),
    setStatus: async () => ok(undefined),
    update: async () => ok(undefined),
    remove: async () => ok(undefined),
  };
}

function edtEntry(ulid: string, repoPath: string, branch: string): EdtRegistryEntry {
  return {
    ulid,
    topic: `topic-${ulid}`,
    createdAt: '2026-08-18T00:00:00.000Z',
    status: 'active',
    members: [{ service: 'svc', repoPath, branch }],
  };
}

describe('assertAllowedBranch — cross-EDT gate (AD-8)', () => {
  it('rejects a branch already registered as a different EDT\'s own branch for this repo', async () => {
    const repo = await makeGitRepo();
    const edtRegistry = fakeEdtRegistry([edtEntry('edt-other', repo, 'feat/shared-name')]);

    const result = await assertAllowedBranch(manifest, repo, 'feat/shared-name', 'edt-mine', edtRegistry);

    expect(result).toMatchObject({ ok: false, error: { code: 'branch-owned-by-other-edt' } });
  });

  it('passes when the branch is registered as the SAME edtId\'s own branch', async () => {
    const repo = await makeGitRepo();
    const edtRegistry = fakeEdtRegistry([edtEntry('edt-mine', repo, 'feat/shared-name')]);

    const result = await assertAllowedBranch(manifest, repo, 'feat/shared-name', 'edt-mine', edtRegistry);

    expect(result).toEqual({ ok: true, data: undefined });
  });

  it('passes when no other EDT has registered this branch for this repo', async () => {
    const repo = await makeGitRepo();
    const edtRegistry = fakeEdtRegistry([edtEntry('edt-other', repo, 'feat/unrelated')]);

    const result = await assertAllowedBranch(manifest, repo, 'feat/mine', 'edt-mine', edtRegistry);

    expect(result).toEqual({ ok: true, data: undefined });
  });

  it('ignores a same-name branch registered by another EDT for a DIFFERENT repo', async () => {
    const repo = await makeGitRepo();
    const otherRepo = await makeGitRepo();
    const edtRegistry = fakeEdtRegistry([edtEntry('edt-other', otherRepo, 'feat/shared-name')]);

    const result = await assertAllowedBranch(manifest, repo, 'feat/shared-name', 'edt-mine', edtRegistry);

    expect(result).toEqual({ ok: true, data: undefined });
  });

  it('detects a conflict even when the registry\'s stored repoPath differs in formatting (trailing slash)', async () => {
    const repo = await makeGitRepo();
    // Same repo, unresolved trailing-slash form — as if it were stored at EDT-creation time
    // in a shape that doesn't byte-match the caller's already-resolve()'d repoPath.
    const edtRegistry = fakeEdtRegistry([edtEntry('edt-other', `${repo}/`, 'feat/shared-name')]);

    const result = await assertAllowedBranch(manifest, repo, 'feat/shared-name', 'edt-mine', edtRegistry);

    expect(result).toMatchObject({ ok: false, error: { code: 'branch-owned-by-other-edt' } });
  });

  it('skips the cross-EDT check entirely when edtId/edtRegistry are omitted (shared-branch gate only)', async () => {
    const repo = await makeGitRepo();

    const result = await assertAllowedBranch(manifest, repo, 'feat/ordinary');

    expect(result).toEqual({ ok: true, data: undefined });
  });

  it('still rejects a shared branch even when edtId/edtRegistry are supplied', async () => {
    const repo = await makeGitRepo();
    const edtRegistry = fakeEdtRegistry([]);

    const result = await assertAllowedBranch(manifest, repo, 'development', 'edt-mine', edtRegistry);

    expect(result).toMatchObject({ ok: false, error: { code: 'shared-branch-rejected' } });
  });

  it('propagates an edtRegistry.list() failure', async () => {
    const repo = await makeGitRepo();
    const edtRegistry: EdtRegistryPort = {
      add: async () => ok(undefined),
      list: async () => ({ ok: false, error: { code: 'edt-registry-invalid-format', message: 'bad shape' } }),
      setStatus: async () => ok(undefined),
      update: async () => ok(undefined),
      remove: async () => ok(undefined),
    };

    const result = await assertAllowedBranch(manifest, repo, 'feat/x', 'edt-mine', edtRegistry);

    expect(result).toMatchObject({ ok: false, error: { code: 'edt-registry-invalid-format' } });
  });
});

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

  it('rejects every manifest-protected branch before any git invocation', async () => {
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

  it('errors on an unborn HEAD (git init, no commits yet) instead of recording "HEAD"', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'tui-back-git-unborn-'));
    tmpDirs.push(repo);
    expect(runGit(repo, ['init', '-b', 'development']).status).toBe(0);

    const result = await currentBranch(repo);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('git-current-branch-error');
    }
  });

  it('errors on a detached HEAD instead of recording the literal "HEAD"', async () => {
    const repo = await makeGitRepo();
    expect(runGit(repo, ['checkout', '--detach']).status).toBe(0);

    const result = await currentBranch(repo);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('git-detached-head');
      expect(result.error.message).toContain('detached');
    }
  });
});

// Real clone/origin pairs so upstream tracking (branch.<name>.remote/merge, @{u}) is exercised
// for real, not faked. `git clone` auto-configures the cloned repo's initial branch to track
// the matching origin branch, so a bare clone is already the "in sync, upstream configured"
// baseline every other case builds from.
async function makeOriginAndClone(): Promise<{ origin: string; clone: string }> {
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

function commit(dir: string, message: string): void {
  const result = runGit(dir, ['commit', '--allow-empty', '-m', message]);
  if (result.status !== 0) {
    throw new Error(`git commit failed in ${dir}: ${result.stderr}`);
  }
}

describe('aheadBehind', () => {
  it('reports 0 ahead / 0 behind for a clone freshly in sync with its upstream', async () => {
    const { clone } = await makeOriginAndClone();

    expect(await aheadBehind(clone)).toEqual({ ok: true, data: { ahead: 0, behind: 0 } });
  });

  it('reports an ahead count for local commits not yet on the upstream', async () => {
    const { clone } = await makeOriginAndClone();
    commit(clone, 'local-only commit');

    expect(await aheadBehind(clone)).toEqual({ ok: true, data: { ahead: 1, behind: 0 } });
  });

  it('reports a behind count once a fetch updates the remote-tracking ref (cached-values read, no live fetch of its own)', async () => {
    const { origin, clone } = await makeOriginAndClone();
    commit(origin, 'upstream-only commit');
    expect(runGit(clone, ['fetch', 'origin']).status).toBe(0);

    expect(await aheadBehind(clone)).toEqual({ ok: true, data: { ahead: 0, behind: 1 } });
  });

  it('reports both ahead and behind together when the two sides have each diverged', async () => {
    const { origin, clone } = await makeOriginAndClone();
    commit(origin, 'upstream-only commit');
    expect(runGit(clone, ['fetch', 'origin']).status).toBe(0);
    commit(clone, 'local-only commit');

    expect(await aheadBehind(clone)).toEqual({ ok: true, data: { ahead: 1, behind: 1 } });
  });

  it('rejects computing ahead/behind without a configured upstream (no-upstream, never a fabricated value)', async () => {
    const repo = await makeGitRepo();

    const result = await aheadBehind(repo);

    expect(result).toMatchObject({ ok: false, error: { code: 'no-upstream' } });
  });

  it('reports unknown-offline when an upstream is configured but its ref cannot currently be resolved', async () => {
    const { clone } = await makeOriginAndClone();
    // Simulate "configured but unresolvable" (never fetched after a remote branch was
    // deleted, or genuinely offline before the first fetch): the tracking config
    // (branch.development.remote/merge) stays in place, but the actual remote-tracking ref
    // is gone.
    expect(runGit(clone, ['branch', '-d', '-r', 'origin/development']).status).toBe(0);

    const result = await aheadBehind(clone);

    expect(result).toMatchObject({ ok: false, error: { code: 'unknown-offline' } });
  });

  it('reports a controlled git-ahead-behind-error when the current branch itself cannot be determined', async () => {
    const dir = await makePlainDir();

    const result = await aheadBehind(dir);

    expect(result).toMatchObject({ ok: false, error: { code: 'git-ahead-behind-error' } });
  });

  // `git config --get`'s exit-code taxonomy is 0 = found, 1 = key genuinely not set — every
  // OTHER status (including a real spawn/git failure) must never be folded into "not
  // configured". A shim `git` binary that fails only the `config --get` subcommand
  // (forwarding every other subcommand to the real binary) exercises the "config read itself
  // failed" branch for real.
  it('surfaces a real git-config read failure as unknown-offline, never a silent no-upstream', async () => {
    const { clone } = await makeOriginAndClone();
    const realGit = spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim();
    const shimDir = await mkdtemp(join(tmpdir(), 'tui-back-git-shim-'));
    tmpDirs.push(shimDir);
    const shimPath = join(shimDir, 'git');
    await writeFile(
      shimPath,
      `#!/bin/sh\nif [ "$1" = "config" ] && [ "$2" = "--get" ]; then\n  exit 2\nfi\nexec "${realGit}" "$@"\n`,
      { mode: 0o755 },
    );
    const originalPath = process.env.PATH;
    process.env.PATH = `${shimDir}${delimiter}${originalPath}`;
    try {
      const result = await aheadBehind(clone);
      expect(result).toMatchObject({ ok: false, error: { code: 'unknown-offline' } });
    } finally {
      process.env.PATH = originalPath;
    }
  });
});

describe('spawn failure diagnostics (status === null)', () => {
  it('currentBranch surfaces the real spawn cause when git is missing, not a bare stderr', async () => {
    const repo = await makeGitRepo();
    const originalPath = process.env.PATH;
    process.env.PATH = join(tmpdir(), 'tui-back-no-bin');
    try {
      const result = await currentBranch(repo);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('git-current-branch-error');
        expect(result.error.message).toMatch(/ENOENT/);
      }
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it('createBranch surfaces the real spawn cause when branch state cannot be verified', async () => {
    const repo = await makeGitRepo();
    const originalPath = process.env.PATH;
    process.env.PATH = join(tmpdir(), 'tui-back-no-bin');
    try {
      const result = await createBranch(manifest, repo, 'feat/x', 'development');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('git-create-branch-error');
        expect(result.error.message).toMatch(/ENOENT/);
      }
    } finally {
      process.env.PATH = originalPath;
    }
  });
});

describe('deleteBranch', () => {
  it('deletes an existing non-shared branch ref (force: true -> git branch -D)', async () => {
    const repo = await makeGitRepo();
    expect(runGit(repo, ['branch', 'feat/x']).status).toBe(0);

    const result = await deleteBranch(manifest, repo, 'feat/x', true);

    expect(result).toEqual({ ok: true, data: undefined });
    expect(branchExists(repo, 'feat/x')).toBe(false);
  });

  // force: false selects `git branch -d`, which refuses to delete a branch not yet merged
  // into the current HEAD — surfaced as a controlled git-delete-branch-error, never a throw,
  // and the ref survives untouched.
  it('force: false (-d) refuses to delete an unmerged branch, leaving the ref intact', async () => {
    const repo = await makeGitRepo();
    expect(runGit(repo, ['checkout', '-b', 'feat/unmerged']).status).toBe(0);
    await writeFile(join(repo, 'unmerged.txt'), 'x');
    runGit(repo, ['add', 'unmerged.txt']);
    expect(runGit(repo, ['commit', '-m', 'unmerged work']).status).toBe(0);
    expect(runGit(repo, ['checkout', 'development']).status).toBe(0);

    const result = await deleteBranch(manifest, repo, 'feat/unmerged', false);

    expect(result).toMatchObject({ ok: false, error: { code: 'git-delete-branch-error' } });
    expect(branchExists(repo, 'feat/unmerged')).toBe(true);
  });

  it('force: false (-d) deletes a branch already merged into HEAD', async () => {
    const repo = await makeGitRepo();
    expect(runGit(repo, ['branch', 'feat/merged']).status).toBe(0);

    const result = await deleteBranch(manifest, repo, 'feat/merged', false);

    expect(result).toEqual({ ok: true, data: undefined });
    expect(branchExists(repo, 'feat/merged')).toBe(false);
  });

  it('treats a missing branch as a no-op success (idempotent rollback)', async () => {
    const repo = await makeGitRepo();

    const result = await deleteBranch(manifest, repo, 'feat/never-created', true);

    expect(result).toEqual({ ok: true, data: undefined });
  });

  it('rejects a built-in shared branch before any git invocation', async () => {
    const repo = await makeGitRepo();

    const result = await deleteBranch(manifest, repo, 'development', true);

    expect(result).toMatchObject({ ok: false, error: { code: 'shared-branch-rejected' } });
    expect(branchExists(repo, 'development')).toBe(true);
  });

  it('rejects a branch name equal to the repo manifest sharedBranch', async () => {
    const repo = await makeGitRepo('staging');

    const result = await deleteBranch(manifest, repo, 'staging', true);

    expect(result).toMatchObject({ ok: false, error: { code: 'shared-branch-rejected' } });
  });

  it('rejects a shared branch without touching git at all (manifest-only dir, not a git repo)', async () => {
    const dir = await makeDirWithManifestOnly();

    const result = await deleteBranch(manifest, dir, 'prod', true);

    expect(result).toMatchObject({ ok: false, error: { code: 'shared-branch-rejected' } });
  });

  it('propagates a manifest load failure from the gate', async () => {
    const repo = await makeGitRepo();
    await rm(join(repo, '.tui-back.yaml'), { force: true });

    const result = await deleteBranch(manifest, repo, 'feat/x', true);

    expect(result).toMatchObject({ ok: false, error: { code: 'manifest-not-found' } });
  });
});

// Local-only ancestor check backing the EDT-delete use-case's -d/-D decision.
describe('isBranchMerged', () => {
  it('reports true when branchName is an ancestor of into (merged, no divergent commits)', async () => {
    const repo = await makeGitRepo();
    expect(runGit(repo, ['branch', 'feat/merged']).status).toBe(0);

    const result = await isBranchMerged(repo, 'feat/merged', 'development');

    expect(result).toEqual({ ok: true, data: true });
  });

  it('reports false when branchName has commits development does not have (unmerged)', async () => {
    const repo = await makeGitRepo();
    expect(runGit(repo, ['checkout', '-b', 'feat/unmerged']).status).toBe(0);
    await writeFile(join(repo, 'unmerged.txt'), 'x');
    runGit(repo, ['add', 'unmerged.txt']);
    expect(runGit(repo, ['commit', '-m', 'unmerged work']).status).toBe(0);

    const result = await isBranchMerged(repo, 'feat/unmerged', 'development');

    expect(result).toEqual({ ok: true, data: false });
  });

  it('reports a controlled git error for a non-existent ref, never a throw', async () => {
    const repo = await makeGitRepo();

    const result = await isBranchMerged(repo, 'feat/does-not-exist', 'development');

    expect(result).toMatchObject({ ok: false, error: { code: 'git-merge-base-error' } });
  });
});

// Moves the working tree onto an existing local branch.
describe('checkoutBranch', () => {
  it('moves the working tree onto an existing branch', async () => {
    const repo = await makeGitRepo();
    expect(runGit(repo, ['branch', 'feat/x']).status).toBe(0);

    const result = await checkoutBranch(repo, 'feat/x');

    expect(result).toEqual({ ok: true, data: undefined });
    expect(runGit(repo, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim()).toBe('feat/x');
  });

  it('reports a controlled error for a branch that does not exist locally, never a throw', async () => {
    const repo = await makeGitRepo();

    const result = await checkoutBranch(repo, 'feat/does-not-exist');

    expect(result).toMatchObject({ ok: false, error: { code: 'git-checkout-error' } });
  });
});

// `git status --porcelain` is non-empty iff the working tree is dirty.
describe('hasUncommittedChanges', () => {
  it('reports false for a clean working tree', async () => {
    const repo = await makeCleanGitRepo();

    expect(await hasUncommittedChanges(repo)).toEqual({ ok: true, data: false });
  });

  it('reports true when an untracked file is present', async () => {
    const repo = await makeGitRepo();
    await writeFile(join(repo, 'untracked.txt'), 'hi');

    expect(await hasUncommittedChanges(repo)).toEqual({ ok: true, data: true });
  });

  it('reports true when a tracked file is modified', async () => {
    const repo = await makeGitRepo();
    await writeFile(join(repo, 'tracked.txt'), 'v1');
    runGit(repo, ['add', 'tracked.txt']);
    expect(runGit(repo, ['commit', '-m', 'add tracked']).status).toBe(0);
    await writeFile(join(repo, 'tracked.txt'), 'v2');

    expect(await hasUncommittedChanges(repo)).toEqual({ ok: true, data: true });
  });

  it('ignores excludePaths literally, but still sees other dirty paths', async () => {
    const repo = await makeCleanGitRepo();
    await writeFile(join(repo, '.tui-back.yaml'), 'service: changed\n');

    expect(await hasUncommittedChanges(repo, { excludePaths: ['.tui-back.yaml'] })).toEqual({ ok: true, data: false });
    expect(await listDirtyPaths(repo, { excludePaths: ['.tui-back.yaml'] })).toEqual({ ok: true, data: [] });

    await writeFile(join(repo, 'other.txt'), 'x');
    expect(await hasUncommittedChanges(repo, { excludePaths: ['.tui-back.yaml'] })).toEqual({ ok: true, data: true });
    expect(await listDirtyPaths(repo, { excludePaths: ['.tui-back.yaml'] })).toEqual({ ok: true, data: ['other.txt'] });
  });

  it('reports a controlled error on a non-git directory', async () => {
    const dir = await makeDirWithManifestOnly();

    const result = await hasUncommittedChanges(dir);

    expect(result).toMatchObject({ ok: false, error: { code: 'git-status-error' } });
  });
});

// stashSave/restoreStash: message-tagged (not stack-position), tracked + untracked (`-u`).
describe('stashSave / restoreStash', () => {
  it('stashes tracked + untracked changes and restores them by message match', async () => {
    const repo = await makeGitRepo();
    await writeFile(join(repo, 'tracked.txt'), 'v1');
    runGit(repo, ['add', 'tracked.txt']);
    expect(runGit(repo, ['commit', '-m', 'add tracked']).status).toBe(0);
    await writeFile(join(repo, 'tracked.txt'), 'v2');
    await writeFile(join(repo, 'untracked.txt'), 'new');

    const stashed = await stashSave(repo, 'tui-back:01ULIDEXAMPLE');

    expect(stashed).toEqual({ ok: true, data: undefined });
    expect(await hasUncommittedChanges(repo)).toEqual({ ok: true, data: false });
    expect(await readFile(join(repo, 'tracked.txt'), 'utf8')).toBe('v1');
    await expect(readFile(join(repo, 'untracked.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });

    const restored = await restoreStash(repo, 'tui-back:01ULIDEXAMPLE');

    expect(restored).toEqual({ ok: true, data: undefined });
    expect(await readFile(join(repo, 'tracked.txt'), 'utf8')).toBe('v2');
    expect(await readFile(join(repo, 'untracked.txt'), 'utf8')).toBe('new');
  });

  it('is a no-op success when no stash matches the message', async () => {
    const repo = await makeGitRepo();

    const result = await restoreStash(repo, 'tui-back:no-such-tag');

    expect(result).toEqual({ ok: true, data: undefined });
  });

  it('matches by message content, not stack position — a developer\'s own unrelated stash on top is skipped', async () => {
    const repo = await makeGitRepo();
    await writeFile(join(repo, 'tracked.txt'), 'v1');
    runGit(repo, ['add', 'tracked.txt']);
    expect(runGit(repo, ['commit', '-m', 'add tracked']).status).toBe(0);

    await writeFile(join(repo, 'tracked.txt'), 'mine');
    expect((await stashSave(repo, 'tui-back:mine')).ok).toBe(true);

    await writeFile(join(repo, 'tracked.txt'), 'unrelated');
    expect((await stashSave(repo, 'developer own stash')).ok).toBe(true);

    const restored = await restoreStash(repo, 'tui-back:mine');

    expect(restored).toEqual({ ok: true, data: undefined });
    expect(await readFile(join(repo, 'tracked.txt'), 'utf8')).toBe('mine');
    expect(runGit(repo, ['stash', 'list']).stdout).toContain('developer own stash');
  });

  it('reports a controlled error when git stash push fails (not a git repo)', async () => {
    const dir = await makeDirWithManifestOnly();

    const result = await stashSave(dir, 'tui-back:x');

    expect(result).toMatchObject({ ok: false, error: { code: 'git-stash-error' } });
  });
});

// hasStash: the non-destructive existence check behind EDT delete's clean detection (a
// member's own `tui-back:<edtUlid>` stash signals real uncommitted work, whatever the repo
// currently has checked out). Same list-and-match logic as restoreStash; never pops.
describe('hasStash', () => {
  it('reports true when a stash tagged with the given tag exists, without popping it', async () => {
    const repo = await makeGitRepo();
    await writeFile(join(repo, 'tracked.txt'), 'v1');
    runGit(repo, ['add', 'tracked.txt']);
    expect(runGit(repo, ['commit', '-m', 'add tracked']).status).toBe(0);
    await writeFile(join(repo, 'tracked.txt'), 'dirty');
    expect((await stashSave(repo, 'tui-back:01ULIDEXAMPLE')).ok).toBe(true);

    const result = await hasStash(repo, 'tui-back:01ULIDEXAMPLE');

    expect(result).toEqual({ ok: true, data: true });
    // Never destructive: the stash is still present afterwards.
    expect(runGit(repo, ['stash', 'list']).stdout).toContain('01ULIDEXAMPLE');
  });

  it('reports false when no stash matches the tag (absent-tag case)', async () => {
    const repo = await makeGitRepo();

    const result = await hasStash(repo, 'tui-back:no-such-tag');

    expect(result).toEqual({ ok: true, data: false });
  });

  it('reports a controlled error when git stash list fails (not a git repo)', async () => {
    const dir = await makeDirWithManifestOnly();

    const result = await hasStash(dir, 'tui-back:x');

    expect(result).toMatchObject({ ok: false, error: { code: 'git-stash-list-error' } });
  });
});

// Reuses showRef's exit-code taxonomy.
describe('branchExistsLocally', () => {
  it('reports true for an existing branch', async () => {
    const repo = await makeGitRepo();
    expect(runGit(repo, ['branch', 'feat/x']).status).toBe(0);

    expect(await branchExistsLocally(repo, 'feat/x')).toEqual({ ok: true, data: true });
  });

  it('reports false for a missing branch', async () => {
    const repo = await makeGitRepo();

    expect(await branchExistsLocally(repo, 'feat/does-not-exist')).toEqual({ ok: true, data: false });
  });

  it('reports a controlled error on a non-git directory', async () => {
    const dir = await makeDirWithManifestOnly();

    const result = await branchExistsLocally(dir, 'development');

    expect(result).toMatchObject({ ok: false, error: { code: 'git-branch-check-error' } });
  });
});

// Fetches a branch from origin into a same-named local branch, never checking it out. Only
// ever used for a non-member repo's manifest sharedBranch when missing locally.
async function makeGitRepoOriginAndClone(): Promise<{ origin: string; clone: string }> {
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

describe('listBranches', () => {
  it('lists every local branch, local-only (never refs/remotes/...)', async () => {
    const { clone } = await makeGitRepoOriginAndClone();
    expect(runGit(clone, ['branch', 'feat/local-only']).status).toBe(0);

    const result = await listBranches(clone);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toContain('development');
      expect(result.data).toContain('feat/local-only');
      // Never a remote-tracking ref, even one that exists (origin/development, set up by the
      // clone): listBranches is local-only, like branchExistsLocally.
      expect(result.data.some((branch) => branch.includes('origin/'))).toBe(false);
    }
  });

  it('reports a controlled git error when the branch list cannot be read (not a git repo)', async () => {
    const dir = await makeDirWithManifestOnly();

    const result = await listBranches(dir);

    expect(result).toMatchObject({ ok: false, error: { code: 'git-list-branches-error' } });
  });
});

describe('renameBranch', () => {
  it('renames a local branch ref via git branch -m', async () => {
    const repo = await makeGitRepo();
    expect(runGit(repo, ['branch', 'feat/old']).status).toBe(0);

    const result = await renameBranch(manifest, repo, 'feat/old', 'feat/new');

    expect(result).toEqual({ ok: true, data: undefined });
    expect(branchExists(repo, 'feat/old')).toBe(false);
    expect(branchExists(repo, 'feat/new')).toBe(true);
  });

  it('rejects an already-existing newName with branch-exists (reuses createBranch\'s exact code)', async () => {
    const repo = await makeGitRepo();
    expect(runGit(repo, ['branch', 'feat/old']).status).toBe(0);
    expect(runGit(repo, ['branch', 'feat/taken']).status).toBe(0);

    const result = await renameBranch(manifest, repo, 'feat/old', 'feat/taken');

    expect(result).toMatchObject({ ok: false, error: { code: 'branch-exists' } });
    // Neither ref was touched by the rejected rename.
    expect(branchExists(repo, 'feat/old')).toBe(true);
  });

  it('rejects a missing oldName with a distinct branch-missing code', async () => {
    const repo = await makeGitRepo();

    const result = await renameBranch(manifest, repo, 'feat/does-not-exist', 'feat/new');

    expect(result).toMatchObject({ ok: false, error: { code: 'branch-missing' } });
  });

  it('treats renaming a branch to its own current name as a no-op success, not branch-exists', async () => {
    const repo = await makeGitRepo();
    expect(runGit(repo, ['branch', 'feat/old']).status).toBe(0);

    const result = await renameBranch(manifest, repo, 'feat/old', 'feat/old');

    expect(result).toEqual({ ok: true, data: undefined });
    expect(branchExists(repo, 'feat/old')).toBe(true);
  });

  it('still rejects a same-name rename with branch-missing when oldName does not actually exist', async () => {
    const repo = await makeGitRepo();

    const result = await renameBranch(manifest, repo, 'feat/does-not-exist', 'feat/does-not-exist');

    expect(result).toMatchObject({ ok: false, error: { code: 'branch-missing' } });
  });

  it('rejects a newName that is a shared/protected branch before any git invocation', async () => {
    const repo = await makeGitRepo();
    expect(runGit(repo, ['branch', 'feat/old']).status).toBe(0);

    const result = await renameBranch(manifest, repo, 'feat/old', 'development');

    expect(result).toMatchObject({ ok: false, error: { code: 'shared-branch-rejected' } });
    expect(branchExists(repo, 'feat/old')).toBe(true);
  });

  it('rejects an oldName that is a shared/protected branch before any git invocation', async () => {
    const repo = await makeGitRepo();

    const result = await renameBranch(manifest, repo, 'development', 'feat/renamed');

    expect(result).toMatchObject({ ok: false, error: { code: 'shared-branch-rejected' } });
    expect(branchExists(repo, 'development')).toBe(true);
    expect(branchExists(repo, 'feat/renamed')).toBe(false);
  });

  it('rejects an oldName equal to the repo manifest sharedBranch', async () => {
    const repo = await makeGitRepo('staging');
    expect(runGit(repo, ['branch', 'staging']).status).toBe(0);

    const result = await renameBranch(manifest, repo, 'staging', 'feat/renamed');

    expect(result).toMatchObject({ ok: false, error: { code: 'shared-branch-rejected' } });
    expect(branchExists(repo, 'staging')).toBe(true);
  });
});

describe('renameBranch — cross-EDT gate', () => {
  it('rejects an old name owned by another EDT before any git call', async () => {
    const repo = await makeGitRepo();
    expect(runGit(repo, ['branch', 'feat/old']).status).toBe(0);
    const registry = fakeEdtRegistry([edtEntry('U1', repo, 'feat/old')]);

    const result = await renameBranch(manifest, repo, 'feat/old', 'feat/new', 'U2', registry);

    expect(result).toMatchObject({ ok: false, error: { code: 'branch-owned-by-other-edt' } });
    expect(branchExists(repo, 'feat/old')).toBe(true);
    expect(branchExists(repo, 'feat/new')).toBe(false);
  });

  it('rejects a new name owned by another EDT', async () => {
    const repo = await makeGitRepo();
    expect(runGit(repo, ['branch', 'feat/old']).status).toBe(0);
    const registry = fakeEdtRegistry([edtEntry('U1', repo, 'feat/new')]);

    const result = await renameBranch(manifest, repo, 'feat/old', 'feat/new', 'U2', registry);

    expect(result).toMatchObject({ ok: false, error: { code: 'branch-owned-by-other-edt' } });
    expect(branchExists(repo, 'feat/old')).toBe(true);
  });

  it('without edtId any registered owner blocks', async () => {
    const repo = await makeGitRepo();
    expect(runGit(repo, ['branch', 'feat/old']).status).toBe(0);
    const registry = fakeEdtRegistry([edtEntry('U1', repo, 'feat/old')]);

    const result = await renameBranch(manifest, repo, 'feat/old', 'feat/new', undefined, registry);

    expect(result).toMatchObject({ ok: false, error: { code: 'branch-owned-by-other-edt' } });
  });

  it('lets the owning EDT rename its own branch', async () => {
    const repo = await makeGitRepo();
    expect(runGit(repo, ['branch', 'feat/old']).status).toBe(0);
    const registry = fakeEdtRegistry([edtEntry('U1', repo, 'feat/old')]);

    const result = await renameBranch(manifest, repo, 'feat/old', 'feat/new', 'U1', registry);

    expect(result).toEqual({ ok: true, data: undefined });
    expect(branchExists(repo, 'feat/new')).toBe(true);
  });

  it('is wired through the factory with the registry', async () => {
    const repo = await makeGitRepo();
    expect(runGit(repo, ['branch', 'feat/old']).status).toBe(0);
    const port = createGitPort(manifest, fakeEdtRegistry([edtEntry('U1', repo, 'feat/old')]));

    expect(await port.renameBranch(repo, 'feat/old', 'feat/new', 'U2')).toMatchObject({
      ok: false,
      error: { code: 'branch-owned-by-other-edt' },
    });
  });
});

// A clone of makeGitRepoOriginAndClone's origin carries no manifest (origin's .tui-back.yaml
// is untracked, so it is never cloned); the gated writes below need one.
async function makeManagedClone(): Promise<{ origin: string; clone: string }> {
  const pair = await makeGitRepoOriginAndClone();
  await writeFile(
    join(pair.clone, '.tui-back.yaml'),
    'service: clone\ncontainer: clone\nmigrationCommand: m\nprotectedBranches: [preprod, prod]\nmodules: {}\n',
  );
  return pair;
}

function remoteRefExists(dir: string, ref: string): boolean {
  return runGit(dir, ['show-ref', '--verify', '--quiet', `refs/remotes/${ref}`]).status === 0;
}

function upstreamOf(dir: string, branch: string): string | null {
  const result = runGit(dir, ['rev-parse', '--abbrev-ref', `${branch}@{u}`]);
  return result.status === 0 ? result.stdout.trim() : null;
}

describe('listRemoteBranches', () => {
  it('lists remote-tracking refs as <remote>/<branch>, excluding the symbolic <remote>/HEAD', async () => {
    const { clone } = await makeGitRepoOriginAndClone();
    expect(remoteRefExists(clone, 'origin/HEAD')).toBe(true);

    const result = await listRemoteBranches(clone);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect([...result.data].sort()).toEqual(['origin/development', 'origin/feat/remote-only']);
      expect(result.data).not.toContain('origin');
      expect(result.data).not.toContain('origin/HEAD');
    }
  });

  it('keeps a real branch whose name ends in /HEAD, dropping only the symbolic origin/HEAD', async () => {
    const origin = await makeGitRepo();
    expect(runGit(origin, ['branch', 'release/HEAD']).status).toBe(0);
    const clone = await mkdtemp(join(tmpdir(), 'tui-back-git-clone-head-'));
    tmpDirs.push(clone);
    expect(spawnSync('git', ['clone', origin, clone], { encoding: 'utf8' }).status).toBe(0);
    expect(remoteRefExists(clone, 'origin/HEAD')).toBe(true);
    expect(remoteRefExists(clone, 'origin/release/HEAD')).toBe(true);

    const result = await listRemoteBranches(clone);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect([...result.data].sort()).toEqual(['origin/development', 'origin/release/HEAD']);
    }
  });

  it('never fetches — a branch pushed to origin after the clone is not listed', async () => {
    const { origin, clone } = await makeGitRepoOriginAndClone();
    expect(runGit(origin, ['branch', 'feat/after-clone']).status).toBe(0);

    const result = await listRemoteBranches(clone);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).not.toContain('origin/feat/after-clone');
    }
    expect(remoteRefExists(clone, 'origin/feat/after-clone')).toBe(false);
  });

  it('returns an empty list for a repo with no remotes', async () => {
    const repo = await makeGitRepo();

    expect(await listRemoteBranches(repo)).toEqual({ ok: true, data: [] });
  });

  it('reports a controlled error outside a git repository', async () => {
    const dir = await makePlainDir();

    expect(await listRemoteBranches(dir)).toMatchObject({
      ok: false,
      error: { code: 'git-list-remote-branches-error' },
    });
  });
});

describe('createTrackingBranch', () => {
  it('creates a local branch tracking the remote ref, without checking it out', async () => {
    const { clone } = await makeManagedClone();

    const result = await createTrackingBranch(manifest, clone, 'feat/remote-only', 'origin/feat/remote-only');

    expect(result).toEqual({ ok: true, data: undefined });
    expect(branchExists(clone, 'feat/remote-only')).toBe(true);
    expect(upstreamOf(clone, 'feat/remote-only')).toBe('origin/feat/remote-only');
    expect(runGit(clone, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim()).toBe('development');
  });

  it('accepts a local name different from the remote branch name', async () => {
    const { clone } = await makeManagedClone();

    const result = await createTrackingBranch(manifest, clone, 'mine', 'origin/feat/remote-only');

    expect(result).toEqual({ ok: true, data: undefined });
    expect(upstreamOf(clone, 'mine')).toBe('origin/feat/remote-only');
  });

  it('rejects a shared/protected local name before any git invocation', async () => {
    const { clone } = await makeManagedClone();

    const result = await createTrackingBranch(manifest, clone, 'preprod', 'origin/feat/remote-only');

    expect(result).toMatchObject({ ok: false, error: { code: 'shared-branch-rejected' } });
    expect(branchExists(clone, 'preprod')).toBe(false);
  });

  it('rejects an already-existing local name with branch-exists', async () => {
    const { clone } = await makeManagedClone();
    expect(runGit(clone, ['branch', 'feat/remote-only']).status).toBe(0);

    const result = await createTrackingBranch(manifest, clone, 'feat/remote-only', 'origin/feat/remote-only');

    expect(result).toMatchObject({ ok: false, error: { code: 'branch-exists' } });
    expect(upstreamOf(clone, 'feat/remote-only')).toBeNull();
  });

  it('rejects a missing remote ref with remote-branch-missing (never fetches it)', async () => {
    const { origin, clone } = await makeManagedClone();
    expect(runGit(origin, ['branch', 'feat/after-clone']).status).toBe(0);

    const result = await createTrackingBranch(manifest, clone, 'feat/after-clone', 'origin/feat/after-clone');

    expect(result).toMatchObject({ ok: false, error: { code: 'remote-branch-missing' } });
    expect(branchExists(clone, 'feat/after-clone')).toBe(false);
    expect(remoteRefExists(clone, 'origin/feat/after-clone')).toBe(false);
  });
});

describe('createBranch — remote-tracking base', () => {
  it('creates a branch from a remote-tracking ref with no local counterpart, without an upstream', async () => {
    const { clone } = await makeManagedClone();
    expect(branchExists(clone, 'feat/remote-only')).toBe(false);

    const result = await createBranch(manifest, clone, 'feat/cut', 'origin/feat/remote-only');

    expect(result).toEqual({ ok: true, data: undefined });
    expect(branchExists(clone, 'feat/cut')).toBe(true);
    expect(runGit(clone, ['rev-parse', 'feat/cut']).stdout.trim()).toBe(
      runGit(clone, ['rev-parse', 'refs/remotes/origin/feat/remote-only']).stdout.trim(),
    );
    expect(upstreamOf(clone, 'feat/cut')).toBeNull();
    expect(runGit(clone, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim()).toBe('development');
  });

  it('still reports base-branch-missing when neither a local nor a remote-tracking ref exists', async () => {
    const { clone } = await makeManagedClone();

    const result = await createBranch(manifest, clone, 'feat/cut', 'origin/nope');

    expect(result).toMatchObject({ ok: false, error: { code: 'base-branch-missing' } });
    expect(branchExists(clone, 'feat/cut')).toBe(false);
  });
});

describe('fetchBranch', () => {
  it('fetches a branch from origin into a same-named local branch without checking it out', async () => {
    const { clone } = await makeGitRepoOriginAndClone();
    expect(branchExists(clone, 'feat/remote-only')).toBe(false);

    const result = await fetchBranch(clone, 'feat/remote-only');

    expect(result).toEqual({ ok: true, data: undefined });
    expect(branchExists(clone, 'feat/remote-only')).toBe(true);
    expect(runGit(clone, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim()).toBe('development');
  });

  it('reports a controlled error when the branch does not exist on origin', async () => {
    const { clone } = await makeGitRepoOriginAndClone();

    const result = await fetchBranch(clone, 'feat/does-not-exist-anywhere');

    expect(result).toMatchObject({ ok: false, error: { code: 'git-fetch-error' } });
  });

  it('reports a controlled error when there is no origin remote', async () => {
    const repo = await makeGitRepo();

    const result = await fetchBranch(repo, 'development');

    expect(result).toMatchObject({ ok: false, error: { code: 'git-fetch-error' } });
  });
});

describe('fetchBranch with unpushed local commits', () => {
  it('is rejected on a diverged branch, while fetchRemoteBranch succeeds and listUnpushedCommits names the local-only commits', async () => {
    const { origin, clone } = await makeGitRepoOriginAndClone();
    const commitOn = (dir: string, branch: string, message: string): void => {
      const tip = runGit(dir, ['commit-tree', `${branch}^{tree}`, '-p', branch, '-m', message]).stdout.trim();
      expect(runGit(dir, ['update-ref', `refs/heads/${branch}`, tip]).status).toBe(0);
    };
    expect(runGit(clone, ['branch', 'feat/remote-only', 'origin/feat/remote-only']).status).toBe(0);
    commitOn(origin, 'feat/remote-only', 'remote only');
    commitOn(clone, 'feat/remote-only', 'local only');

    expect(await fetchBranch(clone, 'feat/remote-only')).toMatchObject({ ok: false, error: { code: 'git-fetch-error' } });
    expect(await fetchRemoteBranch(clone, 'feat/remote-only')).toEqual({ ok: true, data: undefined });

    const listed = await listUnpushedCommits(clone, 'feat/remote-only');
    expect(listed.ok && listed.data).toHaveLength(1);
    expect(listed.ok && listed.data[0]).toMatch(/^[0-9a-f]+ local only$/);
  });

  it('lists nothing when the local branch has no commits origin lacks', async () => {
    const { clone } = await makeGitRepoOriginAndClone();

    expect(await listUnpushedCommits(clone, 'development')).toEqual({ ok: true, data: [] });
  });

  it('reports a controlled error when the remote-tracking ref is unknown', async () => {
    const repo = await makeGitRepo();

    expect(await listUnpushedCommits(repo, 'development')).toMatchObject({
      ok: false,
      error: { code: 'git-unpushed-commits-error' },
    });
  });
});

// Plain `git pull` on the current branch, only for a member already sitting on its shared
// branch.
describe('pullBranch', () => {
  it('pulls new upstream commits into the current branch', async () => {
    const { origin, clone } = await makeOriginAndClone();
    commit(origin, 'upstream-only commit');

    const result = await pullBranch(clone);

    expect(result).toEqual({ ok: true, data: undefined });
    expect(await aheadBehind(clone)).toEqual({ ok: true, data: { ahead: 0, behind: 0 } });
  });

  it('is a no-op success when already up to date', async () => {
    const { clone } = await makeOriginAndClone();

    expect(await pullBranch(clone)).toEqual({ ok: true, data: undefined });
  });

  it('reports a controlled error when there is no origin remote', async () => {
    const repo = await makeGitRepo();

    const result = await pullBranch(repo);

    expect(result).toMatchObject({ ok: false, error: { code: 'git-pull-error' } });
  });

  it('rejects a diverged shared branch with git-pull-error (never merges, never rebases)', async () => {
    const { origin, clone } = await makeOriginAndClone();
    commit(origin, 'upstream-only commit');
    // A local-only commit on the same branch diverges it — --ff-only refuses.
    commit(clone, 'local-only commit');

    const result = await pullBranch(clone);

    expect(result).toMatchObject({ ok: false, error: { code: 'git-pull-error' } });
    // Neither side moved: no merge commit was created to paper over the divergence.
    expect(await aheadBehind(clone)).toEqual({ ok: true, data: { ahead: 1, behind: 1 } });
  });
});

// `git merge` of the fetched shared branch into the member's own branch, never a rebase;
// conflicts surface as `merge-conflict` so the caller can abort.
describe('mergeBranch', () => {
  // A feature branch behind development with no overlapping change — merges cleanly.
  async function makeBehindRepo(): Promise<string> {
    const repo = await makeCleanGitRepo();
    expect(runGit(repo, ['checkout', '-b', 'feat/member']).status).toBe(0);
    expect(runGit(repo, ['checkout', 'development']).status).toBe(0);
    await writeFile(join(repo, 'shared.txt'), 'shared change');
    runGit(repo, ['add', 'shared.txt']);
    expect(runGit(repo, ['commit', '-m', 'advance shared']).status).toBe(0);
    expect(runGit(repo, ['checkout', 'feat/member']).status).toBe(0);
    return repo;
  }

  it('merges the shared branch into the member branch', async () => {
    const repo = await makeBehindRepo();

    const result = await mergeBranch(repo, 'development');

    expect(result).toEqual({ ok: true, data: undefined });
    expect(runGit(repo, ['merge-base', '--is-ancestor', 'development', 'feat/member']).status).toBe(0);
  });

  it('is a no-op success when the member already contains the shared branch', async () => {
    const repo = await makeCleanGitRepo();
    expect(runGit(repo, ['checkout', '-b', 'feat/member']).status).toBe(0);

    const result = await mergeBranch(repo, 'development');

    expect(result).toEqual({ ok: true, data: undefined });
  });

  it('surfaces a conflicting merge as merge-conflict, leaving the merge in progress for the caller to abort', async () => {
    const repo = await makeCleanGitRepo();
    await writeFile(join(repo, 'conflict.txt'), 'base');
    runGit(repo, ['add', 'conflict.txt']);
    expect(runGit(repo, ['commit', '-m', 'base file']).status).toBe(0);
    expect(runGit(repo, ['checkout', '-b', 'feat/member']).status).toBe(0);
    await writeFile(join(repo, 'conflict.txt'), 'member side');
    runGit(repo, ['add', 'conflict.txt']);
    expect(runGit(repo, ['commit', '-m', 'member change']).status).toBe(0);
    expect(runGit(repo, ['checkout', 'development']).status).toBe(0);
    await writeFile(join(repo, 'conflict.txt'), 'shared side');
    runGit(repo, ['add', 'conflict.txt']);
    expect(runGit(repo, ['commit', '-m', 'shared change']).status).toBe(0);
    expect(runGit(repo, ['checkout', 'feat/member']).status).toBe(0);

    const result = await mergeBranch(repo, 'development');

    expect(result).toMatchObject({ ok: false, error: { code: 'merge-conflict' } });
    // The merge is still in progress — MERGE_HEAD exists — so abortMerge has work to do.
    expect(runGit(repo, ['rev-parse', '--verify', 'MERGE_HEAD']).status).toBe(0);
  });

  it('reports a non-conflict failure as git-merge-error (never merge-conflict)', async () => {
    const repo = await makeCleanGitRepo();

    const result = await mergeBranch(repo, 'feat/does-not-exist');

    expect(result).toMatchObject({ ok: false, error: { code: 'git-merge-error' } });
  });
});

// `git merge --abort` restores the pre-run HEAD after a conflicting merge.
describe('abortMerge', () => {
  it('cancels an in-progress conflicting merge, restoring the pre-run HEAD', async () => {
    const repo = await makeCleanGitRepo();
    await writeFile(join(repo, 'conflict.txt'), 'base');
    runGit(repo, ['add', 'conflict.txt']);
    expect(runGit(repo, ['commit', '-m', 'base file']).status).toBe(0);
    expect(runGit(repo, ['checkout', '-b', 'feat/member']).status).toBe(0);
    await writeFile(join(repo, 'conflict.txt'), 'member side');
    runGit(repo, ['add', 'conflict.txt']);
    expect(runGit(repo, ['commit', '-m', 'member change']).status).toBe(0);
    expect(runGit(repo, ['checkout', 'development']).status).toBe(0);
    await writeFile(join(repo, 'conflict.txt'), 'shared side');
    runGit(repo, ['add', 'conflict.txt']);
    expect(runGit(repo, ['commit', '-m', 'shared change']).status).toBe(0);
    expect(runGit(repo, ['checkout', 'feat/member']).status).toBe(0);
    const headBefore = runGit(repo, ['rev-parse', 'HEAD']).stdout.trim();
    expect((await mergeBranch(repo, 'development')).ok).toBe(false);

    const result = await abortMerge(repo);

    expect(result).toEqual({ ok: true, data: undefined });
    expect(runGit(repo, ['rev-parse', 'HEAD']).stdout.trim()).toBe(headBefore);
    expect(runGit(repo, ['rev-parse', '--verify', 'MERGE_HEAD']).status).not.toBe(0);
  });

  it('reports a controlled error when no merge is in progress', async () => {
    const repo = await makeCleanGitRepo();

    const result = await abortMerge(repo);

    expect(result).toMatchObject({ ok: false, error: { code: 'git-merge-abort-error' } });
  });

  it('falls back to the exit status when git fails with blank stderr', async () => {
    const repo = await makeCleanGitRepo();
    const realGit = spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim();
    const shimDir = await mkdtemp(join(tmpdir(), 'tui-back-git-shim-blank-'));
    tmpDirs.push(shimDir);
    const shimPath = join(shimDir, 'git');
    // A shim `git` that fails only the `merge --abort` subcommand with zero output
    // (forwarding every other subcommand to the real binary), exercising the exact
    // "non-zero exit, blank stderr" branch for real.
    await writeFile(
      shimPath,
      `#!/bin/sh\nif [ "$1" = "merge" ] && [ "$2" = "--abort" ]; then\n  exit 1\nfi\nexec "${realGit}" "$@"\n`,
      { mode: 0o755 },
    );
    const originalPath = process.env.PATH;
    process.env.PATH = `${shimDir}${delimiter}${originalPath}`;
    try {
      const result = await abortMerge(repo);
      expect(result).toMatchObject({ ok: false, error: { code: 'git-merge-abort-error' } });
      if (!result.ok) {
        expect(result.error.message).toContain('exit 1');
      }
    } finally {
      process.env.PATH = originalPath;
    }
  });
});

// The MERGE_HEAD classifier the group-update pull path uses to tell a conflicting pull
// (abort + merge-conflict) from any other pull failure.
describe('isMergeInProgress', () => {
  it('reports true while a conflicting merge is in progress', async () => {
    const repo = await makeCleanGitRepo();
    await writeFile(join(repo, 'conflict.txt'), 'base');
    runGit(repo, ['add', 'conflict.txt']);
    expect(runGit(repo, ['commit', '-m', 'base file']).status).toBe(0);
    expect(runGit(repo, ['checkout', '-b', 'feat/member']).status).toBe(0);
    await writeFile(join(repo, 'conflict.txt'), 'member side');
    runGit(repo, ['add', 'conflict.txt']);
    expect(runGit(repo, ['commit', '-m', 'member change']).status).toBe(0);
    expect(runGit(repo, ['checkout', 'development']).status).toBe(0);
    await writeFile(join(repo, 'conflict.txt'), 'shared side');
    runGit(repo, ['add', 'conflict.txt']);
    expect(runGit(repo, ['commit', '-m', 'shared change']).status).toBe(0);
    expect(runGit(repo, ['checkout', 'feat/member']).status).toBe(0);
    expect((await mergeBranch(repo, 'development')).ok).toBe(false);

    expect(await isMergeInProgress(repo)).toEqual({ ok: true, data: true });

    expect((await abortMerge(repo)).ok).toBe(true);
    expect(await isMergeInProgress(repo)).toEqual({ ok: true, data: false });
  });

  it('reports false when no merge is in progress', async () => {
    const repo = await makeCleanGitRepo();

    expect(await isMergeInProgress(repo)).toEqual({ ok: true, data: false });
  });
});

describe('createGitPort', () => {
  it('wires assertAllowedBranch, currentBranch, createBranch and deleteBranch behind the factory pattern', async () => {
    const repo = await makeGitRepo();
    const port = createGitPort(manifest);

    expect(await port.assertAllowedBranch(repo, 'development')).toMatchObject({
      ok: false,
      error: { code: 'shared-branch-rejected' },
    });
    expect(await port.assertAllowedBranch(repo, 'feat/ordinary')).toEqual({ ok: true, data: undefined });
    expect(await port.currentBranch(repo)).toEqual({ ok: true, data: 'development' });
    expect(await port.createBranch(repo, 'feat/port', 'development')).toEqual({ ok: true, data: undefined });
    expect(branchExists(repo, 'feat/port')).toBe(true);
    expect(await port.deleteBranch(repo, 'feat/port', true)).toEqual({ ok: true, data: undefined });
    expect(branchExists(repo, 'feat/port')).toBe(false);
  });

  it('wires isBranchMerged behind the factory pattern', async () => {
    const repo = await makeGitRepo();
    const port = createGitPort(manifest);
    expect(runGit(repo, ['branch', 'feat/merged']).status).toBe(0);

    expect(await port.isBranchMerged(repo, 'feat/merged', 'development')).toEqual({ ok: true, data: true });
  });

  it('wires hasStash behind the factory pattern', async () => {
    const repo = await makeGitRepo();
    const port = createGitPort(manifest);

    expect(await port.hasStash(repo, 'tui-back:no-such-tag')).toEqual({ ok: true, data: false });
  });

  it('wires aheadBehind behind the factory pattern', async () => {
    const { clone } = await makeOriginAndClone();
    const port = createGitPort(manifest);

    expect(await port.aheadBehind(clone)).toEqual({ ok: true, data: { ahead: 0, behind: 0 } });
    commit(clone, 'local-only commit');
    expect(await port.aheadBehind(clone)).toEqual({ ok: true, data: { ahead: 1, behind: 0 } });
  });

  it('wires checkout, stash and branchExistsLocally behind the factory pattern', async () => {
    const repo = await makeCleanGitRepo();
    const port = createGitPort(manifest);
    expect(runGit(repo, ['branch', 'feat/x']).status).toBe(0);

    expect(await port.hasUncommittedChanges(repo)).toEqual({ ok: true, data: false });
    await writeFile(join(repo, 'dirty.txt'), 'x');
    expect(await port.hasUncommittedChanges(repo)).toEqual({ ok: true, data: true });
    expect(await port.stashSave(repo, 'tui-back:port-test')).toEqual({ ok: true, data: undefined });
    expect(await port.hasUncommittedChanges(repo)).toEqual({ ok: true, data: false });

    expect(await port.branchExistsLocally(repo, 'feat/x')).toEqual({ ok: true, data: true });
    expect(await port.checkout(repo, 'feat/x')).toEqual({ ok: true, data: undefined });
    expect(runGit(repo, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim()).toBe('feat/x');

    expect(await port.restoreStash(repo, 'tui-back:port-test')).toEqual({ ok: true, data: undefined });
    expect(await readFile(join(repo, 'dirty.txt'), 'utf8')).toBe('x');
  });

  it('wires assertAllowedBranch\'s cross-EDT gate when constructed with an EdtRegistryPort', async () => {
    const repo = await makeGitRepo();
    const edtRegistry = fakeEdtRegistry([edtEntry('edt-other', repo, 'feat/taken')]);
    const port = createGitPort(manifest, edtRegistry);

    expect(await port.assertAllowedBranch(repo, 'feat/taken', 'edt-mine')).toMatchObject({
      ok: false,
      error: { code: 'branch-owned-by-other-edt' },
    });
    expect(await port.assertAllowedBranch(repo, 'feat/taken', 'edt-other')).toEqual({ ok: true, data: undefined });
  });

  it('wires pull, mergeBranch and abortMerge behind the factory pattern', async () => {
    const repo = await makeCleanGitRepo();
    const port = createGitPort(manifest);
    expect(runGit(repo, ['checkout', '-b', 'feat/x']).status).toBe(0);

    // feat/x already contains development — a merge no-op success.
    expect(await port.mergeBranch(repo, 'development')).toEqual({ ok: true, data: undefined });
    // No merge in progress — abort reports a controlled error.
    expect(await port.abortMerge(repo)).toMatchObject({ ok: false, error: { code: 'git-merge-abort-error' } });
    expect(await port.isMergeInProgress(repo)).toEqual({ ok: true, data: false });
    // No origin remote — pull reports a controlled error, never a throw.
    expect(await port.pull(repo)).toMatchObject({ ok: false, error: { code: 'git-pull-error' } });
  });

  it('wires listBranches/renameBranch behind the factory pattern', async () => {
    const repo = await makeGitRepo();
    const port = createGitPort(manifest);
    expect(runGit(repo, ['branch', 'feat/x']).status).toBe(0);

    const listed = await port.listBranches(repo);
    expect(listed.ok).toBe(true);
    if (listed.ok) {
      expect(listed.data).toContain('feat/x');
    }

    expect(await port.renameBranch(repo, 'feat/x', 'feat/y')).toEqual({ ok: true, data: undefined });
    expect(branchExists(repo, 'feat/x')).toBe(false);
    expect(branchExists(repo, 'feat/y')).toBe(true);
  });

  it('wires listRemoteBranches/createTrackingBranch behind the factory pattern', async () => {
    const { clone } = await makeManagedClone();
    const port = createGitPort(manifest);

    const listed = await port.listRemoteBranches(clone);
    expect(listed.ok).toBe(true);
    if (listed.ok) {
      expect(listed.data).toContain('origin/feat/remote-only');
    }
    expect(await port.createTrackingBranch(clone, 'feat/q', 'origin/feat/remote-only')).toEqual({
      ok: true,
      data: undefined,
    });
    expect(upstreamOf(clone, 'feat/q')).toBe('origin/feat/remote-only');
  });

  it('wires listDirtyPaths, isRebaseInProgress and hasUnmergedPaths behind the factory pattern', async () => {
    const repo = await makeCleanGitRepo();
    const port = createGitPort(manifest);
    await writeFile(join(repo, 'wip.txt'), 'uncommitted work');

    const dirty = await port.listDirtyPaths(repo);
    expect(dirty.ok).toBe(true);
    if (dirty.ok) {
      expect(dirty.data).toContain('wip.txt');
    }
    expect(await port.isRebaseInProgress(repo)).toEqual({ ok: true, data: false });
    expect(await port.hasUnmergedPaths(repo)).toEqual({ ok: true, data: false });
  });
});

// Porcelain file list backing the lockfile-only classifier.
describe('listDirtyPaths', () => {
  it('reports an empty list for a clean working tree', async () => {
    const repo = await makeCleanGitRepo();

    expect(await listDirtyPaths(repo)).toEqual({ ok: true, data: [] });
  });

  it('lists modified tracked files and untracked files by path', async () => {
    const repo = await makeGitRepo();
    await writeFile(join(repo, 'tracked.txt'), 'v1');
    runGit(repo, ['add', 'tracked.txt']);
    expect(runGit(repo, ['commit', '-m', 'add tracked']).status).toBe(0);
    await writeFile(join(repo, 'tracked.txt'), 'v2');
    await writeFile(join(repo, 'untracked.txt'), 'new');

    const result = await listDirtyPaths(repo);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toContain('tracked.txt');
      expect(result.data).toContain('untracked.txt');
    }
  });

  it('collapses an untracked directory by default, expands it file by file on opt-in', async () => {
    const repo = await makeCleanGitRepo();
    await mkdir(join(repo, 'newdir', 'nested'), { recursive: true });
    await writeFile(join(repo, 'newdir', 'a.txt'), 'a');
    await writeFile(join(repo, 'newdir', 'nested', 'b.txt'), 'b');

    expect(await listDirtyPaths(repo)).toEqual({ ok: true, data: ['newdir/'] });
    const expanded = await listDirtyPaths(repo, { expandUntracked: true });
    expect(expanded.ok).toBe(true);
    if (expanded.ok) {
      expect([...expanded.data].sort()).toEqual(['newdir/a.txt', 'newdir/nested/b.txt']);
    }
  });

  it('reports a controlled error on a non-git directory', async () => {
    const dir = await makeDirWithManifestOnly();

    const result = await listDirtyPaths(dir);

    expect(result).toMatchObject({ ok: false, error: { code: 'git-status-error' } });
  });
});

// The consent-gated destructive primitive, proven against real git.
describe('discardAll', () => {
  it('drops tracked modifications, untracked files and untracked dirs, but never ignored files', async () => {
    const repo = await makeCleanGitRepo();
    await writeFile(join(repo, '.gitignore'), '.env\n');
    await writeFile(join(repo, 'tracked.txt'), 'v1');
    runGit(repo, ['add', '.gitignore', 'tracked.txt']);
    expect(runGit(repo, ['commit', '-m', 'add tracked + ignore']).status).toBe(0);

    await writeFile(join(repo, 'tracked.txt'), 'v2');
    await writeFile(join(repo, 'staged.txt'), 'staged');
    runGit(repo, ['add', 'staged.txt']);
    await writeFile(join(repo, 'untracked.txt'), 'new');
    await mkdir(join(repo, 'newdir'), { recursive: true });
    await writeFile(join(repo, 'newdir', 'inner.txt'), 'inner');
    await writeFile(join(repo, '.env'), 'SECRET=1');

    expect(await discardAll(repo)).toEqual({ ok: true, data: undefined });

    expect(await readFile(join(repo, 'tracked.txt'), 'utf8')).toBe('v1');
    expect(existsSync(join(repo, 'staged.txt'))).toBe(false);
    expect(existsSync(join(repo, 'untracked.txt'))).toBe(false);
    expect(existsSync(join(repo, 'newdir'))).toBe(false);
    expect(await readFile(join(repo, '.env'), 'utf8')).toBe('SECRET=1');
    expect(await hasUncommittedChanges(repo)).toEqual({ ok: true, data: false });
  });

  it('is wired behind the factory', async () => {
    const repo = await makeCleanGitRepo();
    await writeFile(join(repo, 'wip.txt'), 'work');

    expect(await createGitPort(manifest).discardAll(repo)).toEqual({ ok: true, data: undefined });
    expect(existsSync(join(repo, 'wip.txt'))).toBe(false);
  });

  it('reports git-discard-error naming the reset step on a non-git directory', async () => {
    const dir = await makeDirWithManifestOnly();

    expect(await discardAll(dir)).toMatchObject({
      ok: false,
      error: { code: 'git-discard-error', message: expect.stringContaining('step 1/2 (git reset --hard)') },
    });
  });

  // Root ignores directory permissions, so the clean could not be made to fail there.
  it.skipIf(process.getuid?.() === 0)('names the clean step, after the reset already ran, when an untracked file cannot be removed', async () => {
    const repo = await makeCleanGitRepo();
    await writeFile(join(repo, 'tracked.txt'), 'v1');
    runGit(repo, ['add', 'tracked.txt']);
    expect(runGit(repo, ['commit', '-m', 'add tracked']).status).toBe(0);
    await writeFile(join(repo, 'tracked.txt'), 'v2');
    await mkdir(join(repo, 'locked'));
    await writeFile(join(repo, 'locked', 'f.txt'), 'x');
    await chmod(join(repo, 'locked'), 0o500);
    try {
      const result = await discardAll(repo);

      expect(result).toMatchObject({
        ok: false,
        error: { code: 'git-discard-error', message: expect.stringContaining('step 2/2 (git clean -fd)') },
      });
      expect(await readFile(join(repo, 'tracked.txt'), 'utf8')).toBe('v1');
    } finally {
      await chmod(join(repo, 'locked'), 0o700);
    }
  });
});

// Path-scoped discard for the lockfile-only auto-fix.
describe('discardPaths', () => {
  it('restores a modified tracked file to its committed content', async () => {
    const repo = await makeCleanGitRepo();
    await writeFile(join(repo, 'package.json'), '{"name":"x"}\n');
    runGit(repo, ['add', 'package.json']);
    expect(runGit(repo, ['commit', '-m', 'add package.json']).status).toBe(0);
    await writeFile(join(repo, 'package.json'), '{"name":"dirty"}\n');

    const result = await discardPaths(repo, ['package.json']);

    expect(result).toEqual({ ok: true, data: undefined });
    expect(await readFile(join(repo, 'package.json'), 'utf8')).toBe('{"name":"x"}\n');
    expect(await listDirtyPaths(repo)).toEqual({ ok: true, data: [] });
  });

  it('leaves paths outside the given list untouched', async () => {
    const repo = await makeCleanGitRepo();
    await writeFile(join(repo, 'package.json'), '{"name":"x"}\n');
    await writeFile(join(repo, 'wip.txt'), 'work');
    runGit(repo, ['add', 'package.json', 'wip.txt']);
    expect(runGit(repo, ['commit', '-m', 'add files']).status).toBe(0);
    await writeFile(join(repo, 'package.json'), '{"name":"dirty"}\n');
    await writeFile(join(repo, 'wip.txt'), 'changed');

    expect(await discardPaths(repo, ['package.json'])).toEqual({ ok: true, data: undefined });

    expect(await readFile(join(repo, 'package.json'), 'utf8')).toBe('{"name":"x"}\n');
    expect(await readFile(join(repo, 'wip.txt'), 'utf8')).toBe('changed');
  });

  it('is a no-op success for an empty path list', async () => {
    const repo = await makeCleanGitRepo();

    expect(await discardPaths(repo, [])).toEqual({ ok: true, data: undefined });
  });

  it('reports a controlled error for an unknown path', async () => {
    const repo = await makeCleanGitRepo();

    const result = await discardPaths(repo, ['no-such-file.txt']);

    expect(result).toMatchObject({ ok: false, error: { code: 'git-discard-error' } });
  });
});

// The activation pre-flight's read-only diff.
describe('diffNameOnly', () => {
  it('lists every path that differs between two branches, including spaces and nested dirs', async () => {
    const repo = await makeCleanGitRepo();
    await writeFile(join(repo, 'same.txt'), 'same');
    await writeFile(join(repo, 'a.ts'), 'v1');
    runGit(repo, ['add', 'same.txt', 'a.ts']);
    expect(runGit(repo, ['commit', '-m', 'base']).status).toBe(0);
    expect(runGit(repo, ['checkout', '-q', '-b', 'feat/x']).status).toBe(0);
    await writeFile(join(repo, 'a.ts'), 'v2');
    await mkdir(join(repo, 'dir'));
    await writeFile(join(repo, 'dir', 'with space.txt'), 'n');
    runGit(repo, ['add', '.']);
    expect(runGit(repo, ['commit', '-m', 'change']).status).toBe(0);

    const result = await diffNameOnly(repo, 'development', 'feat/x');

    expect(result.ok).toBe(true);
    expect(result.ok && [...result.data].sort()).toEqual(['a.ts', 'dir/with space.txt']);
    expect(await createGitPort(manifest).diffNameOnly(repo, 'feat/x', 'feat/x')).toEqual({ ok: true, data: [] });
  });

  it('lists both sides of a rename, so a dirty old-side path is visible', async () => {
    const repo = await makeCleanGitRepo();
    await writeFile(join(repo, 'old.ts'), 'content that stays the same across the rename\n'.repeat(5));
    runGit(repo, ['add', 'old.ts']);
    expect(runGit(repo, ['commit', '-m', 'old']).status).toBe(0);
    expect(runGit(repo, ['checkout', '-q', '-b', 'feat/rename']).status).toBe(0);
    expect(runGit(repo, ['mv', 'old.ts', 'new.ts']).status).toBe(0);
    expect(runGit(repo, ['commit', '-m', 'rename']).status).toBe(0);

    const result = await diffNameOnly(repo, 'development', 'feat/rename');

    expect(result.ok && [...result.data].sort()).toEqual(['new.ts', 'old.ts']);
  });

  it('reports git-diff-error for an unknown revision', async () => {
    const repo = await makeCleanGitRepo();

    expect(await diffNameOnly(repo, 'development', 'no-such-branch')).toMatchObject({
      ok: false,
      error: { code: 'git-diff-error' },
    });
  });
});

describe('headRevision', () => {
  it('returns the commit HEAD points at, and fails on an unborn HEAD', async () => {
    const repo = await makeCleanGitRepo();
    const expected = String(runGit(repo, ['rev-parse', 'HEAD']).stdout).trim();

    expect(await headRevision(repo)).toEqual({ ok: true, data: expected });
    expect(await createGitPort(manifest).headRevision(repo)).toEqual({ ok: true, data: expected });

    const empty = await mkdtemp(join(tmpdir(), 'tui-back-empty-'));
    expect(runGit(empty, ['init', '-q']).status).toBe(0);
    expect(await headRevision(empty)).toMatchObject({ ok: false, error: { code: 'git-rev-parse-error' } });
    await rm(empty, { recursive: true, force: true });
  });
});

describe('diffStat', () => {
  it('totals files, insertions and deletions, counting a binary file with 0 lines', async () => {
    const repo = await makeCleanGitRepo();
    await writeFile(join(repo, 'a.ts'), 'l1\nl2\nl3\n');
    runGit(repo, ['add', 'a.ts']);
    expect(runGit(repo, ['commit', '-m', 'base']).status).toBe(0);
    expect(runGit(repo, ['checkout', '-q', '-b', 'feat/x']).status).toBe(0);
    await writeFile(join(repo, 'a.ts'), 'l1\nchanged\n');
    await writeFile(join(repo, 'new file.txt'), 'n1\nn2\n');
    await writeFile(join(repo, 'bin.dat'), Buffer.from([0, 1, 2, 0, 3]));
    runGit(repo, ['add', '.']);
    expect(runGit(repo, ['commit', '-m', 'change']).status).toBe(0);

    const result = await diffStat(repo, 'development', 'feat/x');

    expect(result).toEqual({ ok: true, data: { files: 3, insertions: 3, deletions: 2 } });
    expect(await createGitPort(manifest).diffStat(repo, 'feat/x', 'feat/x')).toEqual({
      ok: true,
      data: { files: 0, insertions: 0, deletions: 0 },
    });
  });

  it('reports git-diff-error for an unknown revision', async () => {
    const repo = await makeCleanGitRepo();

    expect(await diffStat(repo, 'development', 'no-such-branch')).toMatchObject({ ok: false, error: { code: 'git-diff-error' } });
  });
});

// Path-scoped discard back to HEAD (the activation overwrite).
describe('discardPathsToHead', () => {
  it('discards exactly the given tracked, staged and untracked paths and nothing else', async () => {
    const repo = await makeCleanGitRepo();
    await writeFile(join(repo, '.gitignore'), '.env\n');
    await writeFile(join(repo, 'tracked.txt'), 'v1');
    await writeFile(join(repo, 'staged-mod.txt'), 'v1');
    await writeFile(join(repo, 'keep.txt'), 'v1');
    runGit(repo, ['add', '.gitignore', 'tracked.txt', 'staged-mod.txt', 'keep.txt']);
    expect(runGit(repo, ['commit', '-m', 'files']).status).toBe(0);

    await writeFile(join(repo, 'tracked.txt'), 'v2');
    await writeFile(join(repo, 'staged-mod.txt'), 'v2');
    runGit(repo, ['add', 'staged-mod.txt']);
    await writeFile(join(repo, 'staged-new.txt'), 'new');
    runGit(repo, ['add', 'staged-new.txt']);
    await mkdir(join(repo, 'dir'));
    await writeFile(join(repo, 'dir', 'untracked.txt'), 'u');
    await writeFile(join(repo, 'keep.txt'), 'mine');
    await writeFile(join(repo, 'other-untracked.txt'), 'mine');
    await writeFile(join(repo, '.env'), 'SECRET=1');

    const result = await createGitPort(manifest).discardPathsToHead(repo, [
      'tracked.txt',
      'staged-mod.txt',
      'staged-new.txt',
      'dir/untracked.txt',
    ]);

    expect(result).toEqual({ ok: true, data: undefined });
    expect(await readFile(join(repo, 'tracked.txt'), 'utf8')).toBe('v1');
    expect(await readFile(join(repo, 'staged-mod.txt'), 'utf8')).toBe('v1');
    expect(existsSync(join(repo, 'staged-new.txt'))).toBe(false);
    expect(existsSync(join(repo, 'dir', 'untracked.txt'))).toBe(false);
    expect(await readFile(join(repo, 'keep.txt'), 'utf8')).toBe('mine');
    expect(await readFile(join(repo, 'other-untracked.txt'), 'utf8')).toBe('mine');
    expect(await readFile(join(repo, '.env'), 'utf8')).toBe('SECRET=1');
    const dirty = await listDirtyPaths(repo, { expandUntracked: true });
    expect(dirty.ok && [...dirty.data].sort()).toEqual(['keep.txt', 'other-untracked.txt']);
  });

  it('treats paths literally — a glob-character name never matches its siblings', async () => {
    const repo = await makeCleanGitRepo();
    await mkdir(join(repo, 'src'));
    await writeFile(join(repo, 'src', 'i.tsx'), 'v1');
    runGit(repo, ['add', 'src']);
    expect(runGit(repo, ['commit', '-m', 'pages']).status).toBe(0);
    // Confirmed: an untracked `[id].tsx`. Unconfirmed siblings its glob reading would match:
    // an untracked `d.tsx` and a staged modification of `i.tsx`.
    await writeFile(join(repo, 'src', '[id].tsx'), 'new page');
    await writeFile(join(repo, 'src', 'd.tsx'), 'untracked sibling');
    await writeFile(join(repo, 'src', 'i.tsx'), 'staged sibling');
    runGit(repo, ['add', 'src/i.tsx']);

    expect(await discardPathsToHead(repo, ['src/[id].tsx'])).toEqual({ ok: true, data: undefined });

    expect(existsSync(join(repo, 'src', '[id].tsx'))).toBe(false);
    expect(await readFile(join(repo, 'src', 'd.tsx'), 'utf8')).toBe('untracked sibling');
    expect(await readFile(join(repo, 'src', 'i.tsx'), 'utf8')).toBe('staged sibling');
    expect(runGit(repo, ['diff', '--cached', '--name-only']).stdout.trim()).toBe('src/i.tsx');
  });

  it('handles a path list larger than one chunk', async () => {
    const repo = await makeCleanGitRepo();
    const paths = Array.from({ length: 1203 }, (_, index) => `u${index}.txt`);
    await Promise.all(paths.map((path) => writeFile(join(repo, path), 'x')));
    await writeFile(join(repo, 'keep.txt'), 'x');

    expect(await discardPathsToHead(repo, paths)).toEqual({ ok: true, data: undefined });

    expect(await listDirtyPaths(repo)).toEqual({ ok: true, data: ['keep.txt'] });
  });

  it('restores a tracked file deleted from the working tree', async () => {
    const repo = await makeCleanGitRepo();
    await writeFile(join(repo, 'gone.txt'), 'v1');
    runGit(repo, ['add', 'gone.txt']);
    expect(runGit(repo, ['commit', '-m', 'gone']).status).toBe(0);
    await rm(join(repo, 'gone.txt'));

    expect(await discardPathsToHead(repo, ['gone.txt'])).toEqual({ ok: true, data: undefined });
    expect(await readFile(join(repo, 'gone.txt'), 'utf8')).toBe('v1');
  });

  it('is a no-op success for an empty path list', async () => {
    const repo = await makeCleanGitRepo();

    expect(await discardPathsToHead(repo, [])).toEqual({ ok: true, data: undefined });
  });

  it('reports git-discard-error on a non-git directory', async () => {
    const dir = await makePlainDir();

    expect(await discardPathsToHead(dir, ['a.txt'])).toMatchObject({ ok: false, error: { code: 'git-discard-error' } });
  });
});

// Mid-rebase detector (detection only: the tool never touches a rebase).
describe('isRebaseInProgress', () => {
  it('reports false for an ordinary repo with no rebase in progress', async () => {
    const repo = await makeCleanGitRepo();

    expect(await isRebaseInProgress(repo)).toEqual({ ok: true, data: false });
  });

  it('reports true while a rebase-merge state dir exists', async () => {
    const repo = await makeCleanGitRepo();
    const gitDir = runGit(repo, ['rev-parse', '--git-dir']).stdout.trim();
    await mkdir(join(repo, gitDir, 'rebase-merge'), { recursive: true });

    expect(await isRebaseInProgress(repo)).toEqual({ ok: true, data: true });
  });

  it('reports true while a rebase-apply state dir exists', async () => {
    const repo = await makeCleanGitRepo();
    const gitDir = runGit(repo, ['rev-parse', '--git-dir']).stdout.trim();
    await mkdir(join(repo, gitDir, 'rebase-apply'), { recursive: true });

    expect(await isRebaseInProgress(repo)).toEqual({ ok: true, data: true });
  });

  it('reads a missing git dir as no rebase in progress, never a throw', async () => {
    const dir = await makeDirWithManifestOnly();

    expect(await isRebaseInProgress(dir)).toEqual({ ok: true, data: false });
  });
});

// Unmerged-path verification gate before merge finalization.
describe('hasUnmergedPaths', () => {
  it('reports false for a clean repo', async () => {
    const repo = await makeCleanGitRepo();

    expect(await hasUnmergedPaths(repo)).toEqual({ ok: true, data: false });
  });

  it('reports true while a conflicting merge leaves unmerged paths', async () => {
    const repo = await makeCleanGitRepo();
    await writeFile(join(repo, 'conflict.txt'), 'base');
    runGit(repo, ['add', 'conflict.txt']);
    expect(runGit(repo, ['commit', '-m', 'base file']).status).toBe(0);
    expect(runGit(repo, ['checkout', '-b', 'feat/member']).status).toBe(0);
    await writeFile(join(repo, 'conflict.txt'), 'member side');
    runGit(repo, ['add', 'conflict.txt']);
    expect(runGit(repo, ['commit', '-m', 'member change']).status).toBe(0);
    expect(runGit(repo, ['checkout', 'development']).status).toBe(0);
    await writeFile(join(repo, 'conflict.txt'), 'shared side');
    runGit(repo, ['add', 'conflict.txt']);
    expect(runGit(repo, ['commit', '-m', 'shared change']).status).toBe(0);
    expect(runGit(repo, ['checkout', 'feat/member']).status).toBe(0);
    expect((await mergeBranch(repo, 'development')).ok).toBe(false);

    expect(await hasUnmergedPaths(repo)).toEqual({ ok: true, data: true });

    expect((await abortMerge(repo)).ok).toBe(true);
    expect(await hasUnmergedPaths(repo)).toEqual({ ok: true, data: false });
  });
});

// finalizeMerge commits a human-resolved merge without opening an editor.
describe('finalizeMerge', () => {
  it('commits a hand-resolved merge (zero unmerged paths) with --no-edit', async () => {
    const repo = await makeCleanGitRepo();
    await writeFile(join(repo, 'conflict.txt'), 'base');
    runGit(repo, ['add', 'conflict.txt']);
    expect(runGit(repo, ['commit', '-m', 'base file']).status).toBe(0);
    expect(runGit(repo, ['checkout', '-b', 'feat/member']).status).toBe(0);
    await writeFile(join(repo, 'conflict.txt'), 'member side');
    runGit(repo, ['add', 'conflict.txt']);
    expect(runGit(repo, ['commit', '-m', 'member change']).status).toBe(0);
    expect(runGit(repo, ['checkout', 'development']).status).toBe(0);
    await writeFile(join(repo, 'conflict.txt'), 'shared side');
    runGit(repo, ['add', 'conflict.txt']);
    expect(runGit(repo, ['commit', '-m', 'shared change']).status).toBe(0);
    expect(runGit(repo, ['checkout', 'feat/member']).status).toBe(0);
    expect((await mergeBranch(repo, 'development')).ok).toBe(false);
    // Resolve by hand exactly as a developer would: write the merged content, stage it.
    await writeFile(join(repo, 'conflict.txt'), 'resolved');
    expect(runGit(repo, ['add', 'conflict.txt']).status).toBe(0);
    expect(await hasUnmergedPaths(repo)).toEqual({ ok: true, data: false });

    const result = await finalizeMerge(repo);

    expect(result).toEqual({ ok: true, data: undefined });
    expect(await isMergeInProgress(repo)).toEqual({ ok: true, data: false });
    expect(runGit(repo, ['merge-base', '--is-ancestor', 'development', 'feat/member']).status).toBe(0);
  });

  it('reports a controlled error when no merge is waiting to be committed', async () => {
    const repo = await makeCleanGitRepo();

    const result = await finalizeMerge(repo);

    expect(result).toMatchObject({ ok: false, error: { code: 'git-commit-error' } });
  });
});

// stagePaths / commitPaths: the path-scoped write pair behind version propagation. Both are
// gated on the current branch and touch only the listed paths.
describe('stagePaths and commitPaths', () => {
  async function dirtyRepo(): Promise<string> {
    const repo = await makeCleanGitRepo();
    expect(runGit(repo, ['checkout', '-b', 'feat/x']).status).toBe(0);
    await writeFile(join(repo, 'package.json'), '{}');
    await writeFile(join(repo, 'package-lock.json'), '{}');
    await writeFile(join(repo, 'other.txt'), 'unrelated');
    return repo;
  }

  it('stages exactly the listed paths and commits only them, leaving other dirty files alone', async () => {
    const repo = await dirtyRepo();

    expect(await stagePaths(manifest, repo, ['package.json', 'package-lock.json'])).toEqual({ ok: true, data: undefined });
    expect(runGit(repo, ['diff', '--cached', '--name-only']).stdout.trim().split('\n').sort()).toEqual([
      'package-lock.json',
      'package.json',
    ]);
    const committed = await commitPaths(manifest, repo, 'chore(deps): bump x [tui-back]', ['package.json', 'package-lock.json']);

    expect(committed).toEqual({ ok: true, data: undefined });
    expect(runGit(repo, ['log', '-1', '--format=%s']).stdout.trim()).toBe('chore(deps): bump x [tui-back]');
    expect(runGit(repo, ['show', '--name-only', '--format=', 'HEAD']).stdout.trim().split('\n').sort()).toEqual([
      'package-lock.json',
      'package.json',
    ]);
    expect(runGit(repo, ['status', '--porcelain']).stdout).toContain('?? other.txt');
  });

  it('leaves an already-staged unrelated file out of the commit', async () => {
    const repo = await dirtyRepo();
    expect(runGit(repo, ['add', 'other.txt']).status).toBe(0);
    await stagePaths(manifest, repo, ['package.json']);

    expect((await commitPaths(manifest, repo, 'msg', ['package.json'])).ok).toBe(true);

    expect(runGit(repo, ['show', '--name-only', '--format=', 'HEAD']).stdout.trim()).toBe('package.json');
  });

  it('refuses on a protected or shared branch before touching git', async () => {
    const repo = await makeCleanGitRepo();
    await writeFile(join(repo, 'package.json'), '{}');

    expect(await stagePaths(manifest, repo, ['package.json'])).toMatchObject({ ok: false, error: { code: 'shared-branch-rejected' } });
    expect(await commitPaths(manifest, repo, 'msg', ['package.json'])).toMatchObject({ ok: false, error: { code: 'shared-branch-rejected' } });
    expect(runGit(repo, ['diff', '--cached', '--name-only']).stdout).toBe('');
  });

  it('reports git-commit-error when there is nothing to commit', async () => {
    const repo = await makeCleanGitRepo();
    expect(runGit(repo, ['checkout', '-b', 'feat/x']).status).toBe(0);

    expect(await commitPaths(manifest, repo, 'msg', ['.tui-back.yaml'])).toMatchObject({ ok: false, error: { code: 'git-commit-error' } });
  });
});

// Conflict primitives backing the shared-types conflict auto-resolver.
describe('conflict primitives', () => {
  async function conflictedRepo(): Promise<string> {
    const repo = await makeCleanGitRepo();
    await writeFile(join(repo, 'conflict.txt'), 'base\n');
    runGit(repo, ['add', 'conflict.txt']);
    expect(runGit(repo, ['commit', '-m', 'base file']).status).toBe(0);
    expect(runGit(repo, ['checkout', '-b', 'feat/member']).status).toBe(0);
    await writeFile(join(repo, 'conflict.txt'), 'member side\n');
    runGit(repo, ['add', 'conflict.txt']);
    expect(runGit(repo, ['commit', '-m', 'member change']).status).toBe(0);
    expect(runGit(repo, ['checkout', 'development']).status).toBe(0);
    await writeFile(join(repo, 'conflict.txt'), 'shared side\n');
    runGit(repo, ['add', 'conflict.txt']);
    expect(runGit(repo, ['commit', '-m', 'shared change']).status).toBe(0);
    expect(runGit(repo, ['checkout', 'feat/member']).status).toBe(0);
    expect((await mergeBranch(repo, 'development')).ok).toBe(false);
    return repo;
  }

  it('lists the unmerged paths, none on a clean repo', async () => {
    expect(await listUnmergedPaths(await makeCleanGitRepo())).toEqual({ ok: true, data: [] });
    const repo = await conflictedRepo();

    expect(await listUnmergedPaths(repo)).toEqual({ ok: true, data: ['conflict.txt'] });
  });

  it('reads a worktree file with its conflict markers, and refuses a path outside the repo', async () => {
    const repo = await conflictedRepo();

    const read = await readWorktreeFile(repo, 'conflict.txt');
    expect(read.ok && read.data).toContain('<<<<<<<');
    expect((await readWorktreeFile(repo, 'missing.txt')).ok).toBe(false);
    expect(await readWorktreeFile(repo, '../escape.txt')).toMatchObject({ ok: false, error: { code: 'git-read-error' } });
  });

  it('writes a resolved file and stages it only on request', async () => {
    const repo = await conflictedRepo();

    expect(await writeResolvedFile(manifest, repo, 'conflict.txt', 'merged\n', { stage: false })).toEqual({ ok: true, data: undefined });
    expect(await readFile(join(repo, 'conflict.txt'), 'utf8')).toBe('merged\n');
    expect(await listUnmergedPaths(repo)).toEqual({ ok: true, data: ['conflict.txt'] });

    expect(await writeResolvedFile(manifest, repo, 'conflict.txt', 'merged\n', { stage: true })).toEqual({ ok: true, data: undefined });
    expect(await listUnmergedPaths(repo)).toEqual({ ok: true, data: [] });
  });

  it('takes the current branch side of a conflicted path without staging it', async () => {
    const repo = await conflictedRepo();

    expect(await checkoutSide(manifest, repo, 'conflict.txt', 'ours')).toEqual({ ok: true, data: undefined });
    expect(await readFile(join(repo, 'conflict.txt'), 'utf8')).toBe('member side\n');
    expect(await listUnmergedPaths(repo)).toEqual({ ok: true, data: ['conflict.txt'] });
  });

  it('gates both writes on the current branch: a protected branch is refused before anything is written', async () => {
    const repo = await makeCleanGitRepo();
    await writeFile(join(repo, 'f.txt'), 'x');

    expect(await writeResolvedFile(manifest, repo, 'f.txt', 'changed', { stage: true })).toMatchObject({ ok: false, error: { code: 'shared-branch-rejected' } });
    expect(await readFile(join(repo, 'f.txt'), 'utf8')).toBe('x');
    expect(await checkoutSide(manifest, repo, 'f.txt', 'ours')).toMatchObject({ ok: false, error: { code: 'shared-branch-rejected' } });
  });

  it('refuses to write outside the repo and writes nothing', async () => {
    const repo = await conflictedRepo();
    const escaped = join(repo, '..', 'escape.txt');

    expect(await writeResolvedFile(manifest, repo, '../escape.txt', 'x', { stage: false })).toMatchObject({ ok: false, error: { code: 'git-write-error' } });
    expect(existsSync(escaped)).toBe(false);
  });

  it('wires the primitives behind the factory', async () => {
    const repo = await conflictedRepo();
    const port = createGitPort(manifest);

    expect(await port.listUnmergedPaths(repo)).toEqual({ ok: true, data: ['conflict.txt'] });
    expect((await port.readWorktreeFile(repo, 'conflict.txt')).ok).toBe(true);
    expect((await port.checkoutSide(repo, 'conflict.txt', 'ours')).ok).toBe(true);
    expect((await port.writeResolvedFile(repo, 'conflict.txt', 'merged\n', { stage: true })).ok).toBe(true);
  });
});
