// tui/zones/update: service-status derivation, EDT-members-first row ordering, live detail and last-outcome merge.
import { resolve } from 'node:path';
import type { ServiceBranchDivergence } from '../../../../../../core/edt/lifecycle/list.js';
import type { EdtRegistryEntry } from '../../../../../../core/ports/edt-registry.js';
import type { GroupUpdateRepoResult, GroupUpdateScope, GroupUpdateSelectionItem, UpdateBlockerKind, UpdatePhase } from '../../../../../../core/scripts/group-update.js';
import type { SharedTypesStage } from '../../../../../../core/shared-types/consumers/smart-update.js';
import type { ServiceStatusState } from '../../../../../../core/service-status/index.js';
import { partitionServicesByEdtMembership } from '../../edts/logic/edts-zone.logic.js';

// The Update zone's own closed per-service status set: the health-first ServiceStatusState
// passthrough (AD-23, `unhealthy` and `inconsistent` included), plus
// 'updating' (a run currently targets this service), 'migrating' (the run's live phase for this
// service is the migrate step) and 'error' (derived from the last completed run's outcome, not
// raw health — a container can report `up` immediately after a failed migration).
// 'no-container' comes from ServiceStatusState: a manifest declaring neither a container nor a
// probed `healthUrl` (a container-less service with one reads up/down) — dim, never the down
// treatment.
export type UpdateServiceStatus = ServiceStatusState | 'updating' | 'migrating' | 'awaiting' | 'error';

// A service paused on a pending incident ('awaiting') outranks everything: it is
// the one state that needs the developer, not the run.
// Precedence: a run currently targeting this service wins ('updating', or 'migrating' during the
// live migrate phase — outranking even a stale 'error' from a previous run); otherwise a
// standalone clean restart in flight wins ('restarting'); otherwise a failed last outcome
// outranks the resolved status (a container can report `up` right after a failed migration —
// the old process is still running); otherwise the resolved status passes through unchanged,
// 'no-container' included.
export function deriveUpdateServiceStatus(
  health: ServiceStatusState,
  lastOutcome: GroupUpdateRepoResult['outcome'] | undefined,
  isTargetedByRunningRun: boolean,
  isRestarting = false,
  livePhase?: UpdatePhase,
  isAwaiting = false,
): UpdateServiceStatus {
  if (isAwaiting) {
    return 'awaiting';
  }
  if (isTargetedByRunningRun) {
    // The list glyph stays `updating` for every live step except the migrate phase, which
    // produces `migrating`.
    if (livePhase === 'migrating') {
      return 'migrating';
    }
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

// The words a list row prints next to its glyph, for the states whose glyph alone is ambiguous
// (`unhealthy` shares `◐` with `awaiting`) or dim by design; null for every other state.
export function updateStatusText(status: UpdateServiceStatus): string | null {
  switch (status) {
    case 'no-container':
      return 'no container';
    case 'unhealthy':
      return 'unhealthy';
    case 'inconsistent':
      return 'inconsistent';
    default:
      return null;
  }
}

// Whether the in-flight run actually targets this list row. The scope alone is not enough: a run
// confirmed through the pre-run configuration screen carries a `selection` that narrows the
// scope down to exactly the confirmed services — a single-service run (`p`, the row-local menu,
// `:update-service`) is scoped `edt` or `all` but selects one row only. The match mirrors core's
// `matchSelectionItem` (resolved repoPath when the item carries one, service name otherwise). A
// null selection is the unfiltered default: every row in scope is targeted.
export function isServiceTargetedByRun(
  row: { service: string; path: string },
  run: {
    scope: GroupUpdateScope | null;
    memberPaths: ReadonlySet<string>;
    selection: readonly GroupUpdateSelectionItem[] | null;
  },
): boolean {
  const inScope = run.scope === 'all' || run.memberPaths.has(row.path);
  if (!inScope) {
    return false;
  }
  if (run.selection === null) {
    return true;
  }
  return run.selection.some((item) =>
    item.repoPath !== undefined ? resolve(item.repoPath) === resolve(row.path) : item.service === row.service,
  );
}

// One row of the Update zone's always-visible service list — a ServiceBranchDivergence row
// plus the `isMember` flag the list-ordering below partitions on, kept on the row itself so
// a render never has to re-derive membership from `focusedEdt` a second time.
export type UpdateServiceRow = ServiceBranchDivergence & { isMember: boolean };

// The list partition: the same active-EDT-scoped `edtsBranches` rows logs-zone.tsx partitions
// (partitionServicesByEdtMembership against the *active* EDT, not a selector), flattened into
// one EDT-members-first ordering for the Update zone's single always-visible list.
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

// The detail pane's per-service body line: "idle" when `lastServiceOutcomes` carries no entry
// for this service yet, else the outcome word plus whatever code/message detail the last
// completed run reported for it.
export function formatServiceOutcomeDetail(lastOutcome: GroupUpdateRepoResult | undefined): string {
  if (lastOutcome === undefined) {
    return 'idle';
  }
  const runLines = formatRunDetailLines(lastOutcome.run);
  if (lastOutcome.outcome === 'updated') {
    return ['updated', ...runLines].join('\n');
  }
  const code = lastOutcome.detail?.code ?? lastOutcome.outcome;
  const message = lastOutcome.detail?.message !== undefined ? `: ${lastOutcome.detail.message}` : '';
  return [`${lastOutcome.outcome} (${code})${message}`, ...runLines].join('\n');
}

export const CONFLICT_OUTCOME_LABELS = {
  'auto-resolved': 'auto-resolved',
  partial: 'partial — the rest was left to you',
  'left-to-user': 'left to you',
} as const;

// The merge and migrate lines of the last run; either is absent when core could not read it.
// The migration excerpt is collapsed to one line for the pane.
function formatRunDetailLines(run: GroupUpdateRepoResult['run']): string[] {
  const lines: string[] = [];
  const merge = run?.merge;
  if (merge?.kind === 'up-to-date') {
    lines.push('merge: already up to date');
  } else if (merge?.kind === 'advanced') {
    lines.push(
      merge.files === undefined || merge.insertions === undefined || merge.deletions === undefined
        ? 'merge: updated (diff unavailable)'
        : `merge: +${merge.insertions}/\u2212${merge.deletions} lines, ${merge.files} ${merge.files === 1 ? 'file' : 'files'}`,
    );
  }
  if (run?.conflict !== undefined) {
    lines.push(`conflict: ${CONFLICT_OUTCOME_LABELS[run.conflict]}`);
  }
  const migrations = run?.migrations;
  if (migrations?.kind === 'none') {
    lines.push('migrations: none');
  } else if (migrations?.kind === 'ran') {
    const excerpt = migrations.outputExcerpt.replace(/\s*\r?\n\s*/g, ' \u21b5 ').trim();
    lines.push(`migrations: ran (${migrations.command})${excerpt !== '' ? ` \u2014 ${excerpt}` : ''}`);
  }
  return lines;
}

// One entry of the live per-service issue log. `kind` is the blocker kind
// core's `onUpdateBlocker` seam reported, or `migration-failed` for a mid-run migration
// failure; `detail` names the repo (blockers) or carries the failure message
// (migrations). Entries start `resolved: false` and flip to `true` once the run
// re-verifies the service after the developer acted — a failed re-verify keeps them
// unresolved. The log is store-side derivation (never core state) and is cleared per run.
export type ServiceIssueKind = UpdateBlockerKind | 'migration-failed' | 'shared-types-phase-failed';

export interface ServiceIssue {
  kind: ServiceIssueKind;
  detail: string;
  resolved: boolean;
}

// The detail pane's live body: the current step plus the issue log with resolved/unresolved
// marking — replacing the last-outcome view while a run targets the selected service. A targeted
// service with no phase emitted yet (the run just started) reports `starting`.
export function formatLiveServiceDetail(
  phase: UpdatePhase | undefined,
  issues: readonly ServiceIssue[],
  sharedTypesStage?: SharedTypesStage,
): string {
  // The `shared-types` phase runs after the service's own update: it replaces the core step.
  const lines = [sharedTypesStage !== undefined ? `step: ${sharedTypesStage} shared-types` : `step: ${phase ?? 'starting'}`];
  for (const issue of issues) {
    const mark = issue.resolved ? '✔' : '○';
    const state = issue.resolved ? 'resolved' : 'unresolved';
    // Migration output can carry embedded newlines — collapse them so one issue stays one row
    // inside the overflow-hidden detail pane.
    lines.push(`${mark} ${issue.kind} — ${issue.detail.replace(/\s+/g, ' ')} (${state})`);
  }
  return lines.join('\n');
}

// Merged, never wholesale-replaced, so outcomes for services outside a partial-scope run survive.
// Keyed by `service` (the only stable identifier a GroupUpdateRepoResult row carries — results
// never carry a repoPath).
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

// The two service panes (EDT members above, other services below), each a contiguous slice of
// the members-first flat row array — the selection cursor stays an index into that flat array,
// so `offset` converts a pane-local index and back.
export const UPDATE_MEMBERS_HEADER = 'EDT MEMBERS';

export const UPDATE_OTHERS_HEADER = 'OTHER SERVICES';

export interface UpdateServicePanes {
  members: UpdateServiceRow[];
  others: UpdateServiceRow[];
}

export function splitUpdateServiceRows(rows: readonly UpdateServiceRow[]): UpdateServicePanes {
  return { members: rows.filter((row) => row.isMember), others: rows.filter((row) => !row.isMember) };
}

// The rows each pane may draw, from the total list budget and the splitter ratio: the header
// takes one line per pane and a pane never gets less than one list row.
export function resolveUpdatePaneRows(totalRows: number, membersRatio: number): { members: number; others: number } {
  const usable = Math.max(2, Math.floor(totalRows) - 2);
  const members = Math.min(usable - 1, Math.max(1, Math.round(usable * membersRatio)));
  return { members, others: Math.max(1, usable - members) };
}
