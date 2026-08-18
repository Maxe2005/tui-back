// core/ports/git: the git port contract (AD-8). Every git write in the tool passes through
// an implementation of this port — the driven git adapter enforces the branch-scope safety
// gate centrally (it resolves the shared-branch set from the repo's own manifest at write
// time and rejects a shared target before any `git` invocation). `assertAllowedBranch` is the
// reusable gate itself (adapter-resolved, never caller-trusted); `createBranch`/`deleteBranch`
// delegate to it, and any call site recording a branch as an EDT's own (e.g. the
// branch-creation-disabled path at EDT creation) must call it first too. Core consumes the
// contract without ever importing the adapter (AD-1).
import type { Result } from '../result.js';

export interface GitPort {
  // Rejects (before any git write) a branchName that is shared/protected for this repo — the
  // shared-branch set (development/preprod/prod ∪ the repo's manifest sharedBranch) is
  // resolved by the adapter itself at check time, never trusted from the caller.
  assertAllowedBranch(repoPath: string, branchName: string): Promise<Result<void>>;
  createBranch(repoPath: string, branchName: string, baseBranch: string): Promise<Result<void>>;
  // Deletes a branch ref that this tool created (rollback path: a failed EDT creation must
  // not leave orphaned branch refs behind). Shares createBranch's shared-branch gate.
  deleteBranch(repoPath: string, branchName: string): Promise<Result<void>>;
  currentBranch(repoPath: string): Promise<Result<string>>;
}
