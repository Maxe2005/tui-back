// tui/zones/update: story 3.6 — pure logic backing the Update zone's new list/detail shell
// (service-status derivation, EDT-members-first list ordering, and the
// lastServiceOutcomes merge the store applies on run completion). Extracted the same way
// edts-zone.logic.ts is (that file's own header): the useInput callback stays a thin
// dispatcher, everything it — or a render — needs to decide is a standalone, independently
// unit-testable function.
import type { ServiceBranchDivergence } from '../../../../../core/edt/list.js';
import type { EdtRegistryEntry } from '../../../../../core/ports/edt-registry.js';
import type { GroupUpdateRepoResult } from '../../../../../core/scripts/group-update.js';
import type { HealthState } from '../../../../../core/ports/docker.js';
import { partitionServicesByEdtMembership } from '../edts/edts-zone.logic.js';

// The Update zone's own closed per-service status set (Design Notes): a raw HealthState
// passthrough, plus 'updating' (a run currently targets this service — deliberately coarse,
// no per-step tracking until story 3.10) and 'migrating' (reserved in the type so
// StatusBadge stays exhaustive; never produced by deriveUpdateServiceStatus in this story)
// and 'error' (derived from the last completed run's outcome, not raw health — Design
// Notes: a container can report `up` immediately after a failed migration).
export type UpdateServiceStatus = HealthState | 'updating' | 'migrating' | 'error';

// Precedence (Design Notes): a run currently targeting this service always wins ('updating'
// outranks everything, including a stale 'error' from a previous run); otherwise a
// standalone clean restart in flight on this service wins ('restarting' — story 3.9's
// coarse in-flight flag, no step detail until story 3.10); otherwise a failed last
// outcome outranks raw health (a container can report `up` right after a failed
// migration — the old process is still running); otherwise raw health passes through
// unchanged ('migrating' is never returned here — see the type's own comment above).
export function deriveUpdateServiceStatus(
  health: HealthState,
  lastOutcome: GroupUpdateRepoResult['outcome'] | undefined,
  isTargetedByRunningRun: boolean,
  isRestarting = false,
): UpdateServiceStatus {
  if (isTargetedByRunningRun) {
    return 'updating';
  }
  if (isRestarting) {
    return 'restarting';
  }
  if (lastOutcome === 'failed') {
    return 'error';
  }
  return health;
}

// One row of the Update zone's always-visible service list — a ServiceBranchDivergence row
// plus the `isMember` flag the list-ordering below partitions on, kept on the row itself so
// a render never has to re-derive membership from `focusedEdt` a second time.
export type UpdateServiceRow = ServiceBranchDivergence & { isMember: boolean };

// The list partition (Code Map): the same active-EDT-scoped `edtsBranches` rows logs-zone.tsx
// partitions (partitionServicesByEdtMembership against the *active* EDT, not a selector — no
// new registry/enumeration logic), flattened into one EDT-members-first ordering for the
// Update zone's single always-visible list (unlike Logs/EDTs zones' two separately-focusable
// panes — this shell has no per-row focus toggle).
export function partitionUpdateServiceRows(
  rows: readonly ServiceBranchDivergence[],
  focusedEdt: EdtRegistryEntry | undefined,
): UpdateServiceRow[] {
  const { edtServices, otherServices } = partitionServicesByEdtMembership(rows, focusedEdt);
  return [
    ...edtServices.map((row) => ({ ...row, isMember: true })),
    ...otherServices.map((row) => ({ ...row, isMember: false })),
  ];
}

// The detail pane's per-service body line (I/O matrix): "idle" when `lastServiceOutcomes`
// carries no entry for this service yet, else the outcome word plus whatever code/message
// detail the last completed run reported for it.
export function formatServiceOutcomeDetail(lastOutcome: GroupUpdateRepoResult | undefined): string {
  if (lastOutcome === undefined) {
    return 'idle';
  }
  if (lastOutcome.outcome === 'updated') {
    return 'updated';
  }
  const code = lastOutcome.detail?.code ?? lastOutcome.outcome;
  const message = lastOutcome.detail?.message !== undefined ? `: ${lastOutcome.detail.message}` : '';
  return `${lastOutcome.outcome} (${code})${message}`;
}

// update-slice.ts's own merge (Code Map): "merged — never wholesale-replaced — ... so
// outcomes for services outside a partial-scope run survive." Keyed by `service` (the only
// stable identifier a GroupUpdateRepoResult row itself carries — results never carry a
// repoPath).
export function mergeLastServiceOutcomes(
  current: Readonly<Record<string, GroupUpdateRepoResult>>,
  results: readonly GroupUpdateRepoResult[],
): Record<string, GroupUpdateRepoResult> {
  const next = { ...current };
  for (const result of results) {
    next[result.service] = result;
  }
  return next;
}
