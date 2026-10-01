// core/edt/shared-branches: the single FR-7 definition of a protected branch. Story 2.42
// made the set manifest-defined per service: exactly the manifest's `protectedBranches`
// plus its `sharedBranch` — nothing is protected implicitly. Story 2.37 moved the rule
// here from the driven git adapter (which imports it back for its authoritative
// assertAllowedBranch gate) so every TUI advisory inline check reads the exact same rule,
// never a second copy that could drift.
import type { Manifest } from '../ports/manifest.js';

// A Manifest, a ServiceBranchDivergence or a SwitchDirtyRepo (with a non-null
// sharedBranch) all satisfy this structurally, so callers pass what they already hold.
export type BranchProtection = Pick<Manifest, 'sharedBranch' | 'protectedBranches'>;

// Exact, case-sensitive match against `protectedBranches ∪ {sharedBranch}`.
export function isProtectedBranch(name: string, manifest: BranchProtection): boolean {
  return name === manifest.sharedBranch || (manifest.protectedBranches ?? []).includes(name);
}
