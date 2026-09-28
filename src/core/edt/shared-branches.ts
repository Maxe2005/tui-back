// core/edt/shared-branches: the single FR-7 definition of a shared/protected branch — the
// fixed set (development / preprod / prod) plus the repo's own manifest `sharedBranch`.
// Story 2.37 moved it here from the driven git adapter (which imports it back for its
// authoritative assertAllowedBranch gate) so the TUI's advisory inline check in the create
// wizard reads the exact same rule, never a second copy that could drift.
export const SHARED_BRANCHES: readonly string[] = ['development', 'preprod', 'prod'];

export function isSharedBranch(branchName: string, manifestSharedBranch: string): boolean {
  return SHARED_BRANCHES.includes(branchName) || branchName === manifestSharedBranch;
}
