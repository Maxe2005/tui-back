// adapters/driven/git/stash: tagged stash operations (save, find, restore, existence check).
import { type Result, err, ok } from '../../../core/result.js';
import { runProcess } from '../process.js';
import { spawnFailureDetail } from './refs.js';

// `-u` stashes untracked files too (tracked + untracked); `-m` tags the stash with `message`
// so restoreStash can find it later by content, not stack position.
export async function stashSave(repoPath: string, message: string): Promise<Result<void>> {
  const result = await runProcess('git', ['stash', 'push', '-u', '-m', message], { cwd: repoPath });
  if (result.status !== 0) {
    return err('git-stash-error', `git stash push failed in ${repoPath}: ${spawnFailureDetail(result)}`);
  }
  return ok(undefined);
}

// Finds the stash entry whose subject contains `message` (git renders a `-m`-tagged push as
// "On <branch>: <message>", so a substring match is exactly right — not stack position, so
// this is safe even if the developer's own unrelated stashes exist) and pops it. No matching
// stash is a no-op success: not every switch pops one, only a return into an EDT that owns one.
export async function restoreStash(repoPath: string, message: string): Promise<Result<void>> {
  const found = await findStashRef(repoPath, message);
  if (!found.ok) {
    return found;
  }
  if (found.data === null) {
    return ok(undefined);
  }

  const popped = await runProcess('git', ['stash', 'pop', found.data], { cwd: repoPath });
  if (popped.status !== 0) {
    return err('git-stash-pop-error', `git stash pop ${found.data} failed in ${repoPath}: ${spawnFailureDetail(popped)}`);
  }
  return ok(undefined);
}

// The list-and-match-by-message-substring logic shared by restoreStash and hasStash. Returns
// the stash ref (e.g. `stash@{0}`) of the first match, or null when none of repoPath's
// stashes carry `tag` in their subject.
export async function findStashRef(repoPath: string, tag: string): Promise<Result<string | null>> {
  const list = await runProcess('git', ['stash', 'list', '--format=%gd %s'], { cwd: repoPath });
  if (list.status !== 0) {
    return err('git-stash-list-error', `git stash list failed in ${repoPath}: ${spawnFailureDetail(list)}`);
  }

  const lines = String(list.stdout).split('\n').filter((line) => line.trim() !== '');
  const match = lines.find((line) => line.includes(tag));
  if (match === undefined) {
    return ok(null);
  }
  return ok(match.slice(0, match.indexOf(' ')));
}

// Non-destructive existence check: true iff a stash tagged `tag` exists in repoPath. Never
// pops anything, unlike restoreStash — EDT delete reads it to decide a member's
// disposition, not to act on the stash itself.
export async function hasStash(repoPath: string, tag: string): Promise<Result<boolean>> {
  const found = await findStashRef(repoPath, tag);
  if (!found.ok) {
    return found;
  }
  return ok(found.data !== null);
}
