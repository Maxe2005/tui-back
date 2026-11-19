import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ok } from '../../../core/result.js';
import { branchExistsLocally, checkoutBranch, createBranch, createGitPort, currentBranch, deleteBranch, isBranchMerged, listBranches, renameBranch } from './index.js';
import { tmpDirs, runGit, makeGitRepo, makeDirWithManifestOnly, makePlainDir, branchExists, manifest, fakeEdtRegistry, edtEntry, commit, makeGitRepoOriginAndClone, makeManagedClone, upstreamOf, cleanupTmpDirs } from './git.test-support.js';

afterEach(cleanupTmpDirs);

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
