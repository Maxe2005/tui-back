// core/edt/fast-forward-shared: the "fast-forward the shared branches" quick action.
// For each member of the system "Shared branches" EDT it brings the local shared branch up to
// date with its `origin` counterpart — and nothing else: no checkout, stash, force, migration or
// restart, and the active EDT, other branches and worktrees are never touched. Only a
// fast-forward from the branch's own `origin` counterpart is ever performed (AD-8 carve-out:
// `fetch` and `pull --ff-only` carry no write-gate, see adapters/driven/git/remote.ts).
import { err, ok, type Result } from '../../result.js';
import type { GitPort } from '../../ports/git.js';
import type { EdtRegistryPort } from '../../ports/edt-registry.js';
import { isSystemEdt } from '../shared-edt/shared-edt.js';

export type FastForwardOutcome = 'fast-forwarded' | 'up-to-date' | 'skipped' | 'failed';
export type FastForwardSkipReason = 'dirty' | 'diverged';

export interface FastForwardSharedRow {
  service: string;
  repoPath: string;
  branch: string;
  outcome: FastForwardOutcome;
  // Set only when outcome is 'skipped'.
  reason?: FastForwardSkipReason;
  // Human-readable detail: the git failure for 'failed', the unpushed commits for 'diverged'.
  detail?: string;
}

export const FAST_FORWARD_FAILED_CODE = 'fast-forward-failed';

export function anyFastForwardFailed(rows: readonly FastForwardSharedRow[]): boolean {
  return rows.some((row) => row.outcome === 'failed');
}

export interface FastForwardSharedInput {
  edtRegistry: EdtRegistryPort;
  git: GitPort;
}

async function fastForwardOne(
  git: GitPort,
  member: { service: string; repoPath: string; branch: string },
): Promise<FastForwardSharedRow> {
  const { service, repoPath, branch } = member;
  const row = (outcome: FastForwardOutcome, extra: Partial<FastForwardSharedRow> = {}): FastForwardSharedRow => ({
    service,
    repoPath,
    branch,
    outcome,
    ...extra,
  });
  const failed = (message: string) => row('failed', { detail: message });

  const exists = await git.branchExistsLocally(repoPath, branch);
  if (!exists.ok) {
    return failed(exists.error.message);
  }
  if (!exists.data) {
    // No local shared branch yet: fetch creates it from origin.
    const created = await git.fetch(repoPath, branch);
    return created.ok ? row('fast-forwarded') : failed(created.error.message);
  }

  const refreshed = await git.fetchRemote(repoPath, branch);
  if (!refreshed.ok) {
    return failed(refreshed.error.message);
  }
  const unpushed = await git.listUnpushedCommits(repoPath, branch);
  if (!unpushed.ok) {
    return failed(unpushed.error.message);
  }
  if (unpushed.data.length > 0) {
    return row('skipped', { reason: 'diverged', detail: unpushed.data.join('\n') });
  }
  // No local-only commit: origin/<branch> is either equal to or ahead of the local branch.
  const upToDate = await git.isBranchMerged(repoPath, `refs/remotes/origin/${branch}`, `refs/heads/${branch}`);
  if (!upToDate.ok) {
    return failed(upToDate.error.message);
  }
  if (upToDate.data) {
    return row('up-to-date');
  }

  // A detached HEAD or an unreadable current branch simply means "not checked out here".
  const current = await git.currentBranch(repoPath);
  if (current.ok && current.data === branch) {
    const dirty = await git.hasUncommittedChanges(repoPath);
    if (!dirty.ok) {
      return failed(dirty.error.message);
    }
    if (dirty.data) {
      return row('skipped', { reason: 'dirty' });
    }
    const pulled = await git.pull(repoPath);
    return pulled.ok ? row('fast-forwarded') : failed(pulled.error.message);
  }
  const fetched = await git.fetch(repoPath, branch);
  return fetched.ok ? row('fast-forwarded') : failed(fetched.error.message);
}

// Resolves the system EDT from the registry (absent when the setting is off: `edt-not-found`),
// then processes its members one by one — a failure on one service never stops the others.
export async function fastForwardShared(input: FastForwardSharedInput): Promise<Result<{ rows: FastForwardSharedRow[] }>> {
  const listed = await input.edtRegistry.list();
  if (!listed.ok) {
    return listed;
  }
  const system = listed.data.find((entry) => isSystemEdt(entry));
  if (system === undefined) {
    return err('edt-not-found', 'The "Shared branches" EDT is not enabled (see edts.sharedBranchesEdtEnabled in the settings).');
  }
  const rows: FastForwardSharedRow[] = [];
  for (const member of system.members) {
    rows.push(await fastForwardOne(input.git, member));
  }
  return ok({ rows });
}
