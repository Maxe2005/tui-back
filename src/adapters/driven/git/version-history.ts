// adapters/driven/git/version-history: read-only package.json version-bump walk and branches-containing lookup.
import { type VersionBumpWalkOptions, type VersionBumpWalkSummary, type VersionWalkEnd } from '../../../core/ports/git.js';
import { type Result, err, ok } from '../../../core/result.js';
import { streamProcess } from '../process.js';
import { spawnFailureDetail } from './refs.js';

export const BUMP_HEADER = '@@bump@@';
// Any indentation and spacing around the colon, or a whole minified one-line file.
export const ADDED_VERSION_LINE = /^\+.*?"version"\s*:\s*"([^"]+)"/;
export const COMMIT_SHA = /^[0-9a-f]{4,64}$/i;
export const HISTORY_GIT_OPTIONS = ['--no-color', '--no-ext-diff', '--no-textconv', '--no-show-signature'];

export function escapeRegexLiteral(text: string): string {
  return text.replace(/[.[\]\\^$*+?(){}|]/g, '\\$&');
}

// Read-only walk of the commits touching `package.json` (see GitPort.listVersionBumpCommits).
// One `git log -p -U0` child is streamed; a commit header line opens a commit and its added
// `"version"` line (if any) emits the bump. Asking git for one commit more than `maxScanned`
// tells "bound reached" apart from "history exhausted" without scanning further.
export async function listVersionBumpCommits(
  repoPath: string,
  ref: string,
  opts: VersionBumpWalkOptions,
): Promise<Result<VersionBumpWalkSummary>> {
  if (opts.allRefs !== true && (ref.startsWith('-') || ref.trim() === '')) {
    return err('git-history-error', `Invalid ref "${ref}".`);
  }
  const args = [
    'log',
    ...(opts.allRefs === true ? ['--branches', '--remotes'] : [ref]),
    `-n${String(opts.maxScanned + 1)}`,
    `--format=${BUMP_HEADER}%H%x09%aI`,
    '-p',
    '-U0',
    ...HISTORY_GIT_OPTIONS,
  ];
  if (opts.pickaxeVersion !== undefined) {
    args.push(`-G"version"[[:space:]]*:[[:space:]]*"${escapeRegexLiteral(opts.pickaxeVersion)}"`);
  }
  args.push('--', 'package.json');
  let scanned = 0;
  let current: { commit: string; date: string } | null = null;
  let emitted = 0;
  let endedBy: VersionWalkEnd | null = null;
  let callbackError: Error | null = null;
  const result = await streamProcess('git', args, {
    cwd: repoPath,
    ...(opts.signal === undefined ? {} : { signal: opts.signal }),
    onLine: (line) => {
      if (line.startsWith(BUMP_HEADER)) {
        const [commit = '', date = ''] = line.slice(BUMP_HEADER.length).split('\t');
        scanned += 1;
        if (scanned > opts.maxScanned) {
          endedBy = 'scanned';
          scanned = opts.maxScanned;
          return false;
        }
        current = { commit, date };
        return true;
      }
      const match = current !== null ? ADDED_VERSION_LINE.exec(line) : null;
      if (match !== null && current !== null) {
        const version = match[1] as string;
        const commit = current;
        current = null;
        if (opts.pickaxeVersion === undefined || opts.pickaxeVersion === version) {
          emitted += 1;
          try {
            opts.onEntry({ version, commit: commit.commit, date: commit.date });
          } catch (error) {
            callbackError = error instanceof Error ? error : new Error(String(error));
            return false;
          }
          if (emitted >= opts.limit) {
            endedBy = 'limit';
            return false;
          }
        }
      }
      return true;
    },
  });
  if (callbackError !== null) {
    return err('git-history-error', `Handling a version bump failed: ${(callbackError as Error).message}`);
  }
  if (result.aborted) {
    return ok({ endedBy: 'aborted', scanned });
  }
  if (endedBy !== null) {
    return ok({ endedBy, scanned });
  }
  if (result.error !== undefined || result.status !== 0) {
    return err('git-history-error', `git log failed in ${repoPath}: ${spawnFailureDetail(result)}`);
  }
  return ok({ endedBy: 'exhausted', scanned });
}

export async function listBranchesContaining(repoPath: string, commit: string, signal?: AbortSignal): Promise<Result<string[]>> {
  if (!COMMIT_SHA.test(commit)) {
    return err('git-history-error', `Invalid commit "${commit}".`);
  }
  const refs: string[] = [];
  const result = await streamProcess(
    'git',
    ['for-each-ref', `--contains=${commit}`, '--format=%(refname)', 'refs/heads/', 'refs/remotes/'],
    { cwd: repoPath, ...(signal === undefined ? {} : { signal }), onLine: (line) => { refs.push(line.trim()); } },
  );
  if (result.aborted) {
    return err('git-history-aborted', 'The branch lookup was cancelled.');
  }
  if (result.error !== undefined || result.status !== 0) {
    return err('git-history-error', `git for-each-ref failed in ${repoPath}: ${spawnFailureDetail(result)}`);
  }
  const names: string[] = [];
  for (const ref of refs) {
    if (ref.startsWith('refs/heads/')) {
      names.push(ref.slice('refs/heads/'.length));
    } else if (ref.startsWith('refs/remotes/') && !/^refs\/remotes\/[^/]+\/HEAD$/.test(ref)) {
      names.push(ref.slice('refs/remotes/'.length));
    }
  }
  return ok(names);
}
