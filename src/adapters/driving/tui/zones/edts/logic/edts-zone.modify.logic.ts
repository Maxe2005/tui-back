// tui/zones/edts: modify-flow operations, candidate-list state and failed-result summaries.
import type { EdtRegistryEntry } from '../../../../../../core/ports/storage/edt-registry.js';
import { resolveAssistedAction, type FailedResultRow } from '../../../shared/components/lists/failed-result-list.js';
import type { FormFocus } from './edts-zone.focus.logic.js';
import { suggestBranchForNewMember } from './edts-zone.focus.logic.js';

export function isSwitchBlockedError(code: string): boolean {
  return code === 'switch-blocked-action-in-progress';
}

// createEdt/switchActiveEdt/modifyEdt are per-repo/per-member isolated — one repo's failure (a
// protected-branch rejection, a stash/checkout error, a manifest-load failure) never fails the
// overall action, so `result.ok === true` can still carry `results` rows with `outcome:
// 'failed'`. Every submit handler inspects `results` rather than closing the dialog as if every
// requested change had applied.
type FailableResultRow = { service: string; outcome: string; detail?: { code: string; message: string } };

// Returns a structured FailedResultRow[] (never a `; `-joined string) — one row per failed repo,
// rendered by the shared FailedResultList at every partial-failure call site. `code` is carried
// through as-is (resolveAssistedAction decides from it whether a row gets a guided action); a
// `failed` row's `detail` is always set in practice, but a defensive fallback keeps this total.
export function summarizeFailedResults(results: readonly FailableResultRow[]): FailedResultRow[] {
  return results
    .filter((row) => row.outcome === 'failed')
    .map((row) => ({
      service: row.service,
      ...(row.detail?.code !== undefined ? { code: row.detail.code } : {}),
      message: row.detail?.message ?? 'Failed',
    }));
}

// Create and Switch never get the "try a different branch" retry — `resolveMemberBranch` never
// passes an `edtId` to `assertAllowedBranch` at create time, and `switchActiveEdt` carries no
// per-member branch override to retry into. Stripping `code` here (used only at those two call
// sites) makes `resolveAssistedAction` treat every row as unregistered — even
// `branch-owned-by-other-edt` — rather than `FailedResultList` knowing which dialogs may offer
// the affordance.
export function stripAssistedActionCodes(rows: readonly FailedResultRow[]): FailedResultRow[] {
  return rows.map((row) => ({ service: row.service, message: row.message }));
}

// Shared by the Modify and service-actions "try a different branch" Enter handlers — both need
// the same "first row with a registered action" lookup.
export function findRetryableFailedRow(failedRows: readonly FailedResultRow[]): FailedResultRow | undefined {
  return failedRows.find((row) => resolveAssistedAction(row.code) !== null);
}

// The candidate list's four distinct states — a still-loading fetch, a genuinely-empty registry,
// a load failure, and a ready-with-rows list — never conflated (a failed or pending load must
// never read as "No registered services available.").
export type CandidateListState = 'loading' | 'error' | 'empty' | 'ready';

export function resolveCandidateListState(
  status: 'idle' | 'loading' | 'error',
  candidateCount: number,
): CandidateListState {
  if (status === 'loading') {
    return 'loading';
  }
  if (status === 'error') {
    return 'error';
  }
  return candidateCount === 0 ? 'empty' : 'ready';
}

// A row is branch-editable when it's currently checked AND it wasn't already a member when the
// dialog opened — an unchecked row's edit would be dropped at submit anyway, and an existing
// member's branch is changed via the EDT SERVICES row's "Change branch for this EDT" menu. A
// newly checked candidate auto-stages a branchEdits entry (suggestBranchForNewMember), so Enter
// opens the branch-edit flow on it. `originalMemberPaths` (the dialog-open-time membership
// snapshot) excludes already-checked existing members, so Enter on them submits the form.
export function canEditMemberBranch(repoPath: string, selectedMembers: readonly string[], originalMemberPaths: ReadonlySet<string>): boolean {
  return selectedMembers.includes(repoPath) && !originalMemberPaths.has(repoPath);
}

export type ModifyEnterAction = { type: 'submit' } | { type: 'edit-branch'; repoPath: string };

// Members-focus Enter is contextual: on a branch-editable row it opens the branch-edit flow;
// everywhere else (topic-focus always, or a row that isn't branch-editable) it submits the whole
// form — Enter always confirms *something* (UX-DR8), never a dead key.
export function resolveModifyEnterAction(
  formFocus: FormFocus,
  selectedMembers: readonly string[],
  focusedPath: string | undefined,
  originalMemberPaths: ReadonlySet<string>,
): ModifyEnterAction {
  if (formFocus === 'members' && focusedPath !== undefined && canEditMemberBranch(focusedPath, selectedMembers, originalMemberPaths)) {
    return { type: 'edit-branch', repoPath: focusedPath };
  }
  return { type: 'submit' };
}

export interface ResolvedModifyOps {
  addMembers: string[];
  removeMembers: string[];
  setBranches: Array<{ repoPath: string; branch: string }>;
  renameBranches: Array<{ repoPath: string; newName: string }>;
  renameTo?: string;
}

// The modify form's submit-op derivation, a pure function so the rule "drop any staged
// branch-edit for a member no longer in the current selection" is unit-testable without an async
// submit round-trip. `branchRenames` is a sibling of `branchEdits`, never overlapping (a rename
// on an *existing* member stages into branchRenames only, since modifyEdt's renameBranches step
// both renames the ref and records the branch change). The same drop-if-unselected rule applies.
export function resolveModifyOps(
  target: EdtRegistryEntry,
  topic: string,
  selectedMembers: readonly string[],
  branchEdits: Readonly<Record<string, string>>,
  branchRenames: Readonly<Record<string, string>> = {},
): ResolvedModifyOps {
  const originalPaths = new Set(target.members.map((member) => member.repoPath));
  const selectedPaths = new Set(selectedMembers);

  const addMembers = selectedMembers.filter((path) => !originalPaths.has(path));
  const removeMembers = target.members.map((member) => member.repoPath).filter((path) => !selectedPaths.has(path));

  // A branch edit staged for a since-unchecked member must never reach modifyEdt — dropped here,
  // before any setBranches entry is built (a real `git checkout` on a repo the developer just
  // told the form to drop). Conversely, every checked non-member (addMembers) always carries a
  // setBranches entry, so modify.ts's step 1 always finds a match instead of failing
  // `branch-required`. Confirm is blocked when that staged value is empty (submitModify), so the
  // '' fallback below is a safety net, not the normal path.
  const branchEditsForSelected = new Map(Object.entries(branchEdits).filter(([path]) => selectedPaths.has(path)));
  for (const path of addMembers) {
    if (!branchEditsForSelected.has(path)) {
      branchEditsForSelected.set(path, '');
    }
  }
  const setBranches = Array.from(branchEditsForSelected.entries()).map(([repoPath, branch]) => ({ repoPath, branch }));

  const renameBranches = Object.entries(branchRenames)
    .filter(([path]) => selectedPaths.has(path))
    .map(([repoPath, newName]) => ({ repoPath, newName }));

  const trimmedTopic = topic.trim();
  const renameTo = trimmedTopic !== '' && trimmedTopic !== target.topic ? trimmedTopic : undefined;

  return {
    addMembers,
    removeMembers,
    setBranches,
    renameBranches,
    ...(renameTo !== undefined ? { renameTo } : {}),
  };
}

// ---- Dialog state -----------------------------------------------------------------------
