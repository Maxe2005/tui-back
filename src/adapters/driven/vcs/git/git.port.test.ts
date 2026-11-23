import { afterEach, describe, expect, it } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ok } from '../../../../core/result.js';
import type { EdtRegistryPort } from '../../../../core/ports/storage/edt-registry.js';
import { aheadBehind, abortMerge, assertAllowedBranch, branchExistsLocally, createBranch, createGitPort, createTrackingBranch, currentBranch, deleteBranch, hasStash, hasUncommittedChanges, hasUnmergedPaths, isBranchMerged, isMergeInProgress, isRebaseInProgress, listBranches, listDirtyPaths, listRemoteBranches, mergeBranch, renameBranch, restoreStash, stashSave } from './index.js';
import { runGit, makeGitRepo, makeCleanGitRepo, branchExists, manifest, fakeEdtRegistry, edtEntry, makeOriginAndClone, commit, makeManagedClone, upstreamOf, cleanupTmpDirs } from './git.test-support.js';

afterEach(cleanupTmpDirs);

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
