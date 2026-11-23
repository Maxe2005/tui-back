import { afterEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ok } from '../../../../../core/result.js';
import { createGitPort, diffNameOnly, diffStat, headRevision, discardAll, discardPaths, discardPathsToHead, hasUncommittedChanges, listDirtyPaths, stagePaths, commitPaths } from '../index.js';
import { runGit, makeGitRepo, makeCleanGitRepo, makeDirWithManifestOnly, makePlainDir, manifest, commit, cleanupTmpDirs } from '../git.test-support.js';

afterEach(cleanupTmpDirs);

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
