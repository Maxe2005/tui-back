import { afterEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ok } from '../../../../core/result.js';
import { abortMerge, createGitPort, finalizeMerge, hasUnmergedPaths, isMergeInProgress, isRebaseInProgress, mergeBranch, listUnmergedPaths, readWorktreeFile, writeResolvedFile, checkoutSide } from '../index.js';
import { tmpDirs, runGit, makeCleanGitRepo, makeDirWithManifestOnly, manifest, commit, cleanupTmpDirs } from '../git.test-support.js';

afterEach(cleanupTmpDirs);

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
