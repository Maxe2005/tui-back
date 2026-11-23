// core/edt/switch/member: per-repo switching. A target member goes to its own registered branch
// (then its target-tagged stash is popped back in); any other repo goes to its manifest
// `sharedBranch`. Dirty work is delegated to dirty.ts; this module owns the checkout and the
// failure/success result rows that depend on how far the dirty plan got.
import type { EdtMember } from '../../ports/storage/edt-registry.js';
import type { GitPort } from '../../ports/vcs/git.js';
import type { Manifest } from '../../ports/vcs/manifest.js';
import type { Result, ResultError } from '../../result.js';
import { checkoutExpectedBranch, memberTargetSpec } from '../branches/checkout-expected.js';
import { executeDirtyPlan, planDirtyWork, restoreAndFail, stashMessage, type Prepared } from './dirty.js';
import {
  failed,
  type ClassifiedSwitchRepo,
  type DirtyResolution,
  type RepoSwitchContext,
  type SwitchEdtRepoResult,
} from './types.js';

// Checkout failed after the dirty plan ran: undo what can be undone and say what was kept.
async function failAfterPrepare(
  git: GitPort,
  service: string,
  repoPath: string,
  prepared: Prepared,
  error: ResultError,
): Promise<SwitchEdtRepoResult> {
  if (prepared.outcome === 'discarded') {
    return {
      service,
      outcome: 'failed',
      detail: {
        code: error.code,
        message: `${error.message}. The uncommitted changes had already been discarded.`,
        discardedPaths: prepared.discardedPaths,
      },
    };
  }
  if (prepared.stashTag === undefined) {
    return failed(service, error);
  }
  const note =
    prepared.adoptedInto !== undefined
      ? ` Membership in "${prepared.adoptedInto.topic}" on branch "${prepared.adoptedBranch}" is kept (the branch exists and is registered).`
      : '';
  return restoreAndFail(git, service, repoPath, prepared.stashTag, error, note);
}

// The checkout landed but a later step (the target-stash pop) failed: nothing is undone —
// the row keeps what the dirty plan already did so it is never silently lost from the report.
function failAfterCheckout(service: string, prepared: Prepared, error: ResultError): SwitchEdtRepoResult {
  if (prepared.outcome === 'discarded') {
    return {
      service,
      outcome: 'failed',
      detail: {
        code: error.code,
        message: `${error.message}. The uncommitted changes had already been discarded.`,
        discardedPaths: prepared.discardedPaths,
      },
    };
  }
  if (prepared.adoptedInto !== undefined) {
    return failed(service, {
      code: error.code,
      message: `${error.message}. The adoption into "${prepared.adoptedInto.topic}" on "${prepared.adoptedBranch}" succeeded; the adopted work sits in its stash "${prepared.stashTag}".`,
    });
  }
  return failed(service, error);
}

function succeeded(service: string, prepared: Prepared): SwitchEdtRepoResult {
  if (prepared.outcome === 'discarded') {
    const paths = prepared.discardedPaths ?? [];
    return {
      service,
      outcome: 'discarded',
      detail: {
        code: 'discarded',
        message: `Discarded ${paths.length} uncommitted path(s)`,
        discardedPaths: paths,
      },
    };
  }
  if (prepared.outcome === 'adopted' && prepared.adoptedBranch !== undefined) {
    const into = prepared.adoptedInto !== undefined ? ` into "${prepared.adoptedInto.topic}"` : '';
    return {
      service,
      outcome: 'adopted',
      detail: {
        code: 'adopted',
        message: `Uncommitted work adopted${into} on branch "${prepared.adoptedBranch}"`,
        adoptedBranch: prepared.adoptedBranch,
      },
    };
  }
  return { service, outcome: prepared.outcome };
}

// A target member: re-verified against the branch-scope gate (AD-8, never assumed), its dirty
// work handled per its state, checked into its own registered branch, then its target-tagged
// stash (left by a past switch away from the target) popped back in.
export async function switchMemberRepo(
  context: RepoSwitchContext,
  repo: ClassifiedSwitchRepo,
  member: EdtMember,
  resolution: DirtyResolution | undefined,
): Promise<SwitchEdtRepoResult> {
  const { git, target } = context;
  const { service, repoPath, branch } = member;
  let alreadyThere = false;
  let skipped = false;

  // Resolve (and gate) the destination before touching the working tree, so a missing member
  // branch never follows an irreversible discard (or a needless stash).
  const checkedOut = await checkoutExpectedBranch({
    git,
    repoPath,
    spec: memberTargetSpec(target.ulid, branch),
    prepare: async () => {
      // Read before the dirty plan (which never changes the branch).
      alreadyThere = await isAlreadyOn(git, repoPath, branch);
      const plan = await planDirtyWork(context, service, repo, resolution);
      return plan.ok ? executeDirtyPlan(context, service, repoPath, plan.value) : plan;
    },
    skipCheckout: async (prepared) => {
      if (!alreadyThere || !prepared.untouched) {
        return false;
      }
      // A target-tagged stash would be popped: the working tree changes, so not `unchanged`.
      const stashed = await git.hasStash(repoPath, stashMessage(target.ulid));
      skipped = stashed.ok && !stashed.data;
      return skipped;
    },
    onResolveFailed: (error) => failed(service, error),
    onCheckoutFailed: (prepared, error) => failAfterPrepare(git, service, repoPath, prepared, error),
  });
  if (!checkedOut.ok) {
    return checkedOut.row;
  }

  if (skipped) {
    return unchangedRow(service, branch);
  }

  const popped = await git.restoreStash(repoPath, stashMessage(target.ulid));
  if (!popped.ok) {
    return failAfterCheckout(service, checkedOut.value, popped.error);
  }

  return succeeded(service, checkedOut.value);
}

// True when the repo already sits on `target` (a failed or detached read counts as "no": the
// caller then keeps today's checkout path).
async function isAlreadyOn(git: GitPort, repoPath: string, target: string): Promise<boolean> {
  const current = await git.currentBranch(repoPath);
  return current.ok && current.data !== '' && current.data !== 'HEAD' && current.data === target;
}

function unchangedRow(service: string, branch: string): SwitchEdtRepoResult {
  return { service, outcome: 'unchanged', detail: { code: 'unchanged', message: `already on \`${branch}\`` } };
}

// Any repo that is not a target member: its dirty work handled per its state, then checked
// out to its manifest sharedBranch (fetched first if absent locally). Nothing is popped —
// its outgoing-tagged stash (if any) waits for a return into the outgoing EDT.
export async function switchNonMemberRepo(
  context: RepoSwitchContext,
  repo: ClassifiedSwitchRepo,
  resolution: DirtyResolution | undefined,
  loaded: Result<Manifest>,
): Promise<SwitchEdtRepoResult> {
  const { git } = context;
  const { repoPath } = repo;

  const service = loaded.ok ? loaded.data.service : repoPath;
  if (!loaded.ok) {
    return failed(service, loaded.error);
  }
  const sharedBranch = loaded.data.sharedBranch;

  const plan = await planDirtyWork(context, service, repo, resolution);
  if (!plan.ok) {
    return plan.row;
  }

  let skipped = false;

  // Resolve the destination before touching the working tree, so a failed fetch never
  // follows an irreversible discard.
  const checkedOut = await checkoutExpectedBranch({
    git,
    repoPath,
    spec: { kind: 'shared', branch: sharedBranch },
    prepare: () => executeDirtyPlan(context, service, repoPath, plan.value),
    // Non-members never pop a stash: only the (untouched) plan matters.
    skipCheckout: async (prepared) => {
      skipped = prepared.untouched && (await isAlreadyOn(git, repoPath, sharedBranch));
      return skipped;
    },
    onResolveFailed: (error) => failed(service, error),
    onCheckoutFailed: (prepared, error) => failAfterPrepare(git, service, repoPath, prepared, error),
  });
  if (!checkedOut.ok) {
    return checkedOut.row;
  }

  if (skipped) {
    return unchangedRow(service, sharedBranch);
  }

  return succeeded(service, checkedOut.value);
}
