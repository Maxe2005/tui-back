// core/edt/shared-branches: the single FR-7 definition of a protected branch — exactly the
// manifest's `protectedBranches` plus its `sharedBranch`, nothing implicit. The git adapter's
// authoritative gate and every TUI advisory check import this one rule so they cannot drift.
import type { Manifest } from '../ports/manifest.js';

// A Manifest, a ServiceBranchDivergence or a SwitchDirtyRepo (with a non-null
// sharedBranch) all satisfy this structurally, so callers pass what they already hold.
export type BranchProtection = Pick<Manifest, 'sharedBranch' | 'protectedBranches'>;

// Exact, case-sensitive match against `protectedBranches ∪ {sharedBranch}`.
export function isProtectedBranch(name: string, manifest: BranchProtection): boolean {
  return name === manifest.sharedBranch || (manifest.protectedBranches ?? []).includes(name);
}
