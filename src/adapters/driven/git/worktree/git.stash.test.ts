import { afterEach, describe, expect, it } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ok } from '../../../../core/result.js';
import { hasStash, hasUncommittedChanges, restoreStash, stashSave } from '../index.js';
import { runGit, makeGitRepo, makeDirWithManifestOnly, commit, cleanupTmpDirs } from '../git.test-support.js';

afterEach(cleanupTmpDirs);

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
