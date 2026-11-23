// adapters/driven/git/discard: consent-gated destructive primitives (path discard, discard to HEAD, discard all).
import { type Result, err, ok } from '../../../../core/result.js';
import { runProcess } from '../../process.js';
import { LARGE_OUTPUT_BUFFER } from './diff.js';
import { spawnFailureDetail } from '../refs/refs.js';

// How many paths one git invocation receives, so a huge confirmed list never hits E2BIG.
export const PATHS_PER_CALL = 500;

export function chunked(paths: readonly string[]): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < paths.length; index += PATHS_PER_CALL) {
    chunks.push(paths.slice(index, index + PATHS_PER_CALL));
  }
  return chunks;
}

// Path-scoped discard (`git checkout -- <paths>` equivalent) for the lockfile-only auto-fix.
// The `--` terminates option parsing so a path starting with `-` is never treated as a flag.
// An empty list is a no-op success.
export async function discardPaths(repoPath: string, paths: string[]): Promise<Result<void>> {
  if (paths.length === 0) {
    return ok(undefined);
  }
  const result = await runProcess('git', ['checkout', '--', ...paths], { cwd: repoPath });
  if (result.status !== 0) {
    return err('git-discard-error', `git checkout -- failed in ${repoPath}: ${spawnFailureDetail(result)}`);
  }
  return ok(undefined);
}

// Consent-gated, path-scoped discard back to HEAD (see the GitPort doc comment).
// Every call runs with the global `--literal-pathspecs`, so a confirmed path such as
// `src/[id].tsx` is never read as a glob that would also match unconfirmed siblings; paths are
// passed in chunks of PATHS_PER_CALL. Three steps, each scoped by `--` to exactly the paths:
//   1. `git reset -q -- paths` drops any staged content (a no-op for a purely untracked path);
//   2. `git checkout HEAD -- <paths HEAD has>` (found with `ls-tree -r`) restores them;
//   3. `git clean -f -- <the rest>` removes the untracked leftovers (never `-x`, never `-d`).
export async function discardPathsToHead(repoPath: string, paths: string[]): Promise<Result<void>> {
  if (paths.length === 0) {
    return ok(undefined);
  }
  const git = (args: string[], maxBuffer?: number) =>
    runProcess('git', ['--literal-pathspecs', ...args], { cwd: repoPath, ...(maxBuffer ? { maxBuffer } : {}) });
  const chunks = chunked(paths);

  for (const chunk of chunks) {
    const reset = await git(['reset', '-q', '--', ...chunk]);
    if (reset.status !== 0) {
      return err('git-discard-error', `git reset -- failed in ${repoPath}; nothing was discarded: ${spawnFailureDetail(reset)}`);
    }
  }

  const inHead = new Set<string>();
  for (const chunk of chunks) {
    const listed = await git(['ls-tree', '-r', '-z', '--name-only', 'HEAD', '--', ...chunk], LARGE_OUTPUT_BUFFER);
    if (listed.status !== 0) {
      return err(
        'git-discard-error',
        `git ls-tree HEAD failed in ${repoPath}; the paths were unstaged but nothing was discarded: ${spawnFailureDetail(listed)}`,
      );
    }
    for (const path of String(listed.stdout).split('\0')) {
      if (path !== '') {
        inHead.add(path);
      }
    }
  }

  for (const chunk of chunked(paths.filter((path) => inHead.has(path)))) {
    const restored = await git(['checkout', 'HEAD', '--', ...chunk]);
    if (restored.status !== 0) {
      return err('git-discard-error', `git checkout HEAD -- failed in ${repoPath}: ${spawnFailureDetail(restored)}`);
    }
  }
  for (const chunk of chunked(paths.filter((path) => !inHead.has(path)))) {
    const cleaned = await git(['clean', '-f', '-q', '--', ...chunk]);
    if (cleaned.status !== 0) {
      return err(
        'git-discard-error',
        `git clean -f -- failed in ${repoPath} after tracked paths were already restored: ${spawnFailureDetail(cleaned)}`,
      );
    }
  }
  return ok(undefined);
}

// The one consent-gated destructive primitive (see the GitPort doc comment):
// `git reset --hard` drops every tracked modification (staged or not), then `git clean -fd`
// removes untracked files and directories. Never `-x` (ignored files — .env, node_modules,
// build output — always survive) and never `-ff` (a nested repository is never removed).
// Only switch.ts calls this, under an explicit per-repo `discard` resolution.
export async function discardAll(repoPath: string): Promise<Result<void>> {
  const reset = await runProcess('git', ['reset', '--hard'], { cwd: repoPath });
  if (reset.status !== 0) {
    return err(
      'git-discard-error',
      `discardAll step 1/2 (git reset --hard) failed in ${repoPath}; untracked files were not cleaned: ${spawnFailureDetail(reset)}`,
    );
  }
  const clean = await runProcess('git', ['clean', '-fd'], { cwd: repoPath });
  if (clean.status !== 0) {
    return err(
      'git-discard-error',
      `discardAll step 2/2 (git clean -fd) failed in ${repoPath} after tracked changes were already reset: ${spawnFailureDetail(clean)}`,
    );
  }
  return ok(undefined);
}
