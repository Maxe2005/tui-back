import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ok } from '../../../core/result.js';
import { aheadBehind, createTrackingBranch, fetchBranch, fetchRemoteBranch, listUnpushedCommits, listRemoteBranches, pullBranch } from './index.js';
import { tmpDirs, runGit, makeGitRepo, makePlainDir, branchExists, manifest, makeOriginAndClone, commit, makeGitRepoOriginAndClone, makeManagedClone, remoteRefExists, upstreamOf, cleanupTmpDirs } from './git.test-support.js';

afterEach(cleanupTmpDirs);

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
