// core/ports/git: the git port contract (AD-8). Every git write in the tool passes through
// an implementation of this port — the driven git adapter enforces the branch-scope safety
// gate centrally (it resolves the shared-branch set from the repo's own manifest at write
// time and rejects a shared target before any `git` invocation). Story 2.2 is the seed gate
// (shared-branch rejection at branch creation); Story 2.3 owns the full per-EDT
// self-resolving gate. Core consumes the contract without ever importing the adapter (AD-1).
import type { Result } from '../result.js';

export interface GitPort {
  createBranch(repoPath: string, branchName: string, baseBranch: string): Promise<Result<void>>;
  // Deletes a branch ref that this tool created (rollback path: a failed EDT creation must
  // not leave orphaned branch refs behind). Shares createBranch's shared-branch gate.
  deleteBranch(repoPath: string, branchName: string): Promise<Result<void>>;
  currentBranch(repoPath: string): Promise<Result<string>>;
}
