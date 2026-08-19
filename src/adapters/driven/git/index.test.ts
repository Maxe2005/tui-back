// adapters/driven/git: integration tests against real temp git repos (AD-13 driven layer).
// node:child_process is deliberately not mocked — this adapter's whole contract is how the
// real `git` binary's exit codes/stderr surface as Result errors, and that the shared-branch
// gate fires before any `git` invocation. The "before any git" property is verified two ways:
// a shared target that does not exist stays absent afterwards (no creation ran), and a
// manifest-only directory that is NOT a git repository still gets the gate error rather than
// a git failure (any git invocation there would have failed as "not a git repository").
import { describe, expect, it, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ok } from '../../../core/result.js';
import type { EdtRegistryEntry, EdtRegistryPort } from '../../../core/ports/edt-registry.js';
import type { ManifestPort } from '../../../core/ports/manifest.js';
import { loadManifest } from '../manifest/index.js';
import {
  assertAllowedBranch,
  branchExistsLocally,
  checkoutBranch,
  createBranch,
  createGitPort,
  currentBranch,
  deleteBranch,
  fetchBranch,
  hasUncommittedChanges,
  restoreStash,
  stashSave,
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

describe('assertAllowedBranch', () => {
  it('rejects every built-in shared branch without any git invocation', async () => {
    const repo = await makeDirWithManifestOnly();

    for (const shared of ['development', 'preprod', 'prod']) {
      const result = await assertAllowedBranch(manifest, repo, shared);
      expect(result).toMatchObject({ ok: false, error: { code: 'shared-branch-rejected' } });
    }
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

// Story 2.4: AD-8's cross-EDT half — passed only when both edtId and edtRegistry are given;
// omitting either preserves the pre-2.4 shared-branch-only behavior exactly (covered above).
function fakeEdtRegistry(entries: EdtRegistryEntry[]): EdtRegistryPort {
  return {
    add: async () => ok(undefined),
    list: async () => ok(entries),
    setStatus: async () => ok(undefined),
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

describe('assertAllowedBranch — cross-EDT gate (story 2.4, AD-8)', () => {
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

  it('detects a conflict even when the registry\'s stored repoPath differs in formatting (trailing slash, review)', async () => {
    const repo = await makeGitRepo();
    // Same repo, unresolved trailing-slash form — as if it were stored at EDT-creation time
    // in a shape that doesn't byte-match the caller's already-resolve()'d repoPath.
    const edtRegistry = fakeEdtRegistry([edtEntry('edt-other', `${repo}/`, 'feat/shared-name')]);

    const result = await assertAllowedBranch(manifest, repo, 'feat/shared-name', 'edt-mine', edtRegistry);

    expect(result).toMatchObject({ ok: false, error: { code: 'branch-owned-by-other-edt' } });
  });

  it('skips the cross-EDT check entirely when edtId/edtRegistry are omitted (pre-2.4 behavior)', async () => {
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
      expect(result.error.code).toBe('git-current-branch-error');
      expect(result.error.message).toContain('detached');
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
  it('deletes an existing non-shared branch ref', async () => {
    const repo = await makeGitRepo();
    expect(runGit(repo, ['branch', 'feat/x']).status).toBe(0);

    const result = await deleteBranch(manifest, repo, 'feat/x');

    expect(result).toEqual({ ok: true, data: undefined });
    expect(branchExists(repo, 'feat/x')).toBe(false);
  });

  it('treats a missing branch as a no-op success (idempotent rollback)', async () => {
    const repo = await makeGitRepo();

    const result = await deleteBranch(manifest, repo, 'feat/never-created');

    expect(result).toEqual({ ok: true, data: undefined });
  });

  it('rejects a built-in shared branch before any git invocation', async () => {
    const repo = await makeGitRepo();

    const result = await deleteBranch(manifest, repo, 'development');

    expect(result).toMatchObject({ ok: false, error: { code: 'shared-branch-rejected' } });
    expect(branchExists(repo, 'development')).toBe(true);
  });

  it('rejects a branch name equal to the repo manifest sharedBranch', async () => {
    const repo = await makeGitRepo('staging');

    const result = await deleteBranch(manifest, repo, 'staging');

    expect(result).toMatchObject({ ok: false, error: { code: 'shared-branch-rejected' } });
  });

  it('rejects a shared branch without touching git at all (manifest-only dir, not a git repo)', async () => {
    const dir = await makeDirWithManifestOnly();

    const result = await deleteBranch(manifest, dir, 'prod');

    expect(result).toMatchObject({ ok: false, error: { code: 'shared-branch-rejected' } });
  });

  it('propagates a manifest load failure from the gate', async () => {
    const repo = await makeGitRepo();
    await rm(join(repo, '.tui-back.yaml'), { force: true });

    const result = await deleteBranch(manifest, repo, 'feat/x');

    expect(result).toMatchObject({ ok: false, error: { code: 'manifest-not-found' } });
  });
});

// Story 2.4 — Moves the working tree onto an existing local branch.
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

// Story 2.4 — `git status --porcelain` is non-empty iff the working tree is dirty.
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

  it('reports a controlled error on a non-git directory', async () => {
    const dir = await makeDirWithManifestOnly();

    const result = await hasUncommittedChanges(dir);

    expect(result).toMatchObject({ ok: false, error: { code: 'git-status-error' } });
  });
});

// Story 2.4 — stashSave/restoreStash: message-tagged (not stack-position), tracked +
// untracked (`-u`).
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

// Story 2.4 — reuses showRef's exit-code taxonomy.
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

// Story 2.4 — fetches a branch from origin into a same-named local branch, never checking it
// out. Only ever used for a non-member repo's manifest sharedBranch when missing locally.
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

describe('createGitPort', () => {
  it('wires all four pre-2.4 methods behind the factory pattern', async () => {
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
    expect(await port.deleteBranch(repo, 'feat/port')).toEqual({ ok: true, data: undefined });
    expect(branchExists(repo, 'feat/port')).toBe(false);
  });

  it('wires the story 2.4 methods (checkout, stash, branchExistsLocally) behind the factory pattern', async () => {
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
});
