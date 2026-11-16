// core/edt/checkout-expected: the one "move a repo onto the branch it should be on" step shared
// by switch and realign — resolve (gate, fetch) the destination, run the caller's preparation of
// the working tree, check out, and let the caller undo its preparation when the checkout fails.
import type { GitPort } from '../ports/git.js';
import { err, ok, type Result, type ResultError } from '../result.js';

// Where a repo goes when an EDT becomes active (FR-8): a member of that EDT goes to its own
// registered branch, any other repo to its manifest `sharedBranch`.
export type TargetBranchSpec = { kind: 'member'; branch: string; edtUlid: string } | { kind: 'shared'; branch: string };

// Makes the destination checkout-ready, from reads only — except the FR-8 fetch of a missing
// shared branch. A member branch is re-verified by the branch-scope gate
// (`assertAllowedBranch(..., edtUlid)`, AD-8, never assumed) and is never fetched or
// auto-created: missing (or unreadable) is `member-branch-missing`. A shared branch absent
// locally is fetched first.
export async function resolveTargetBranch(git: GitPort, repoPath: string, spec: TargetBranchSpec): Promise<Result<void>> {
  if (spec.kind === 'member') {
    const allowed = await git.assertAllowedBranch(repoPath, spec.branch, spec.edtUlid);
    if (!allowed.ok) {
      return allowed;
    }
  }
  const existsLocally = await git.branchExistsLocally(repoPath, spec.branch);
  if (!existsLocally.ok) {
    return existsLocally;
  }
  if (existsLocally.data) {
    return ok(undefined);
  }
  if (spec.kind === 'member') {
    return err('member-branch-missing', `Member branch "${spec.branch}" does not exist locally in ${repoPath} — left untouched`);
  }
  return git.fetch(repoPath, spec.branch);
}

// A preparation step's verdict: carry on with `value`, or stop with the caller's own `row`.
export type CheckoutStep<T, R> = { ok: true; value: T } | { ok: false; row: R };

export interface CheckoutExpectedInput<P, R> {
  git: GitPort;
  repoPath: string;
  spec: TargetBranchSpec;
  // Runs after the destination resolved, before the checkout (switch: its dirty plan).
  prepare: () => Promise<CheckoutStep<P, R>>;
  onResolveFailed: (error: ResultError) => R;
  // Undoes what `prepare` did, when it can, and builds the caller's row.
  onCheckoutFailed: (prepared: P, error: ResultError) => Promise<R>;
}

// Resolve destination → prepare → `git.checkout` → on a checkout failure, undo the preparation.
// Never touches the working tree before the destination is known to be reachable.
export async function checkoutExpectedBranch<P, R>(input: CheckoutExpectedInput<P, R>): Promise<CheckoutStep<P, R>> {
  const { git, repoPath, spec } = input;
  const destination = await resolveTargetBranch(git, repoPath, spec);
  if (!destination.ok) {
    return { ok: false, row: input.onResolveFailed(destination.error) };
  }
  const prepared = await input.prepare();
  if (!prepared.ok) {
    return prepared;
  }
  const checkedOut = await git.checkout(repoPath, spec.branch);
  if (!checkedOut.ok) {
    return { ok: false, row: await input.onCheckoutFailed(prepared.value, checkedOut.error) };
  }
  return prepared;
}
