// adapters/driven/git/diff: read-only working-tree and revision inspection (status, dirty paths, name-only diff, stat, HEAD).
import { type Result, err, ok } from '../../../core/result.js';
import { runProcess } from '../process.js';
import { spawnFailureDetail } from './refs.js';

// 64 MiB: the stdout budget of the path-listing calls above/below (spawnSync's default is 1 MiB).
export const LARGE_OUTPUT_BUFFER = 64 * 1024 * 1024;

// Trailing pathspec args that hide `paths` from a `git status` (`:(exclude,literal)` — no glob).
export function excludePathspecs(paths: readonly string[] | undefined): string[] {
  return paths === undefined || paths.length === 0 ? [] : ['--', '.', ...paths.map((path) => `:(exclude,literal)${path}`)];
}

// `git status --porcelain` is non-empty iff the working tree has tracked or untracked
// changes; this is the trigger for stashSave before any checkout touches the repo.
export async function hasUncommittedChanges(
  repoPath: string,
  opts?: { excludePaths?: string[] },
): Promise<Result<boolean>> {
  const result = await runProcess('git', ['status', '--porcelain', ...excludePathspecs(opts?.excludePaths)], {
    cwd: repoPath,
  });
  if (result.status !== 0) {
    return err('git-status-error', `git status failed in ${repoPath}: ${spawnFailureDetail(result)}`);
  }
  return ok(String(result.stdout).trim().length > 0);
}

// Porcelain file list backing the lockfile-only classifier: one entry per dirty path parsed
// from `git status --porcelain` (each line is `XY<space>path`; renames surface as
// `old -> new` and contribute both sides so the classifier stays conservative). Empty output
// means a clean tree. A non-zero exit is a controlled git-status-error. `expandUntracked`
// adds `--untracked-files=all`, so an untracked directory is listed file by file (the
// discard resolution's captured `discardedPaths`); the default is git's collapsed `dir/`.
export async function listDirtyPaths(
  repoPath: string,
  opts?: { expandUntracked?: boolean; excludePaths?: string[] },
): Promise<Result<string[]>> {
  const args = [
    'status',
    '--porcelain',
    ...(opts?.expandUntracked === true ? ['--untracked-files=all'] : []),
    ...excludePathspecs(opts?.excludePaths),
  ];
  const result = await runProcess('git', args, { cwd: repoPath });
  if (result.status !== 0) {
    return err('git-status-error', `git status failed in ${repoPath}: ${spawnFailureDetail(result)}`);
  }
  const paths: string[] = [];
  for (const line of String(result.stdout).split('\n')) {
    if (line.trim() === '') {
      continue;
    }
    const entry = line.length > 3 ? line.slice(3).trim() : '';
    if (entry === '') {
      continue;
    }
    // Rename/copy entries surface as `old -> new` — keep both sides (conservative: a
    // non-lockfile on either side blocks the lockfile-only auto-fix).
    if (entry.includes(' -> ')) {
      for (const side of entry.split(' -> ')) {
        const trimmed = side.trim().replace(/^"|"$/g, '');
        if (trimmed !== '') {
          paths.push(trimmed);
        }
      }
    } else {
      paths.push(entry.replace(/^"|"$/g, ''));
    }
  }
  return ok(paths);
}

// Read-only list of the paths differing between two revisions, used by the
// activation pre-flight. `-z` keeps paths with spaces/quotes/non-ASCII bytes raw (no C-style
// quoting); `--no-renames` lists BOTH sides of a rename (with rename detection only the new
// side shows, so a dirty old-side path would never be flagged at risk); the trailing `--`
// forces both arguments to be read as revisions. A large maxBuffer keeps a big diff from
// failing with ENOBUFS.
export async function diffNameOnly(repoPath: string, from: string, to: string): Promise<Result<string[]>> {
  const result = await runProcess('git', ['diff', '--name-only', '--no-renames', '-z', from, to, '--'], {
    cwd: repoPath,
    maxBuffer: LARGE_OUTPUT_BUFFER,
  });
  if (result.status !== 0) {
    return err('git-diff-error', `git diff --name-only ${from} ${to} failed in ${repoPath}: ${spawnFailureDetail(result)}`);
  }
  return ok(String(result.stdout).split('\0').filter((path) => path !== ''));
}

export async function headRevision(repoPath: string): Promise<Result<string>> {
  const result = await runProcess('git', ['rev-parse', 'HEAD'], { cwd: repoPath });
  if (result.status !== 0) {
    return err('git-rev-parse-error', `git rev-parse HEAD failed in ${repoPath}: ${spawnFailureDetail(result)}`);
  }
  return ok(String(result.stdout).trim());
}

// `--numstat -z` rows are `ins\tdel\tpath\0`; binary files report `-` for both counts and
// count as a file with 0 lines. `--no-renames` keeps one row per path, no extra NUL fields.
export async function diffStat(
  repoPath: string,
  from: string,
  to: string,
): Promise<Result<{ files: number; insertions: number; deletions: number }>> {
  const result = await runProcess('git', ['diff', '--numstat', '--no-renames', '-z', from, to, '--'], {
    cwd: repoPath,
    maxBuffer: LARGE_OUTPUT_BUFFER,
  });
  if (result.status !== 0) {
    return err('git-diff-error', `git diff --numstat ${from} ${to} failed in ${repoPath}: ${spawnFailureDetail(result)}`);
  }
  let files = 0;
  let insertions = 0;
  let deletions = 0;
  for (const row of String(result.stdout).split('\0')) {
    if (row === '') {
      continue;
    }
    const [ins, del] = row.split('\t');
    files += 1;
    insertions += Number(ins) || 0;
    deletions += Number(del) || 0;
  }
  return ok({ files, insertions, deletions });
}
