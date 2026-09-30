// tui/zones/update: story 3.6 — pure logic backing the Update zone's new list/detail shell
// (service-status derivation, EDT-members-first list ordering, and the
// lastServiceOutcomes merge the store applies on run completion). Extracted the same way
// edts-zone.logic.ts is (that file's own header): the useInput callback stays a thin
// dispatcher, everything it — or a render — needs to decide is a standalone, independently
// unit-testable function.
import { resolve } from 'node:path';
import type { ServiceBranchDivergence } from '../../../../../core/edt/list.js';
import type { EdtRegistryEntry } from '../../../../../core/ports/edt-registry.js';
import type {
  GroupUpdateRepoResult,
  GroupUpdateScope,
  GroupUpdateSelectionItem,
  UpdateBlockerKind,
  UpdatePhase,
} from '../../../../../core/scripts/group-update.js';
import type { HealthState } from '../../../../../core/ports/docker.js';
import { partitionServicesByEdtMembership } from '../edts/edts-zone.logic.js';

// The Update zone's own closed per-service status set (Design Notes): a raw HealthState
// passthrough, plus 'updating' (a run currently targets this service) and 'migrating'
// (story 3.10: produced when the run's live phase for this service is the migrate step —
// the first producer of the glyph story 3.6 reserved in the type) and 'error' (derived
// from the last completed run's outcome, not raw health — Design Notes: a container can
// report `up` immediately after a failed migration).
export type UpdateServiceStatus = HealthState | 'updating' | 'migrating' | 'error';

// Precedence (Design Notes): a run currently targeting this service always wins ('updating'
// outranks everything, including a stale 'error' from a previous run — except the live
// `migrating` phase, which produces the long-reserved `migrating` glyph for the first
// time in story 3.10); otherwise a standalone clean restart in flight on this service wins
// ('restarting' — story 3.9's coarse in-flight flag, no step detail until story 3.10);
// otherwise a failed last outcome outranks raw health (a container can report `up` right
// after a failed migration — the old process is still running); otherwise raw health
// passes through unchanged.
export function deriveUpdateServiceStatus(
  health: HealthState,
  lastOutcome: GroupUpdateRepoResult['outcome'] | undefined,
  isTargetedByRunningRun: boolean,
  isRestarting = false,
  livePhase?: UpdatePhase,
): UpdateServiceStatus {
  if (isTargetedByRunningRun) {
    // Story 3.10: the list glyph stays `updating` for every live step except the migrate
    // phase, which finally produces the reserved `migrating` glyph.
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

// Whether the in-flight run actually targets this list row. The scope alone is not enough:
// a run confirmed through the pre-run configuration screen (story 3.7) carries a
// `selection` that narrows the scope down to exactly the confirmed services — a
// single-service run (`p`, the row-local menu, `:update-service`) is scoped `edt` or `all`
// but selects one row only, so every other row in that scope must keep its own glyph.
// The selection match mirrors core's own `matchSelectionItem` (resolved repoPath when the
// item carries one, service name otherwise). A null selection is the unfiltered default:
// every row in scope is targeted.
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

// Story 3.10: one entry of the live per-service issue log. `kind` is the blocker kind
// core's `onUpdateBlocker` seam reported, or `migration-failed` for a mid-run migration
// failure; `detail` names the repo (blockers) or carries the failure message
// (migrations). Entries start `resolved: false` and flip to `true` once the run
// re-verifies the service after the developer acted — a failed re-verify keeps them
// unresolved. The log is store-side derivation (never core state) and is cleared per run.
export type ServiceIssueKind = UpdateBlockerKind | 'migration-failed';

export interface ServiceIssue {
  kind: ServiceIssueKind;
  detail: string;
  resolved: boolean;
}

// The detail pane's live body (I/O matrix): the current step plus the issue log with
// resolved/unresolved marking — replacing the last-outcome view while a run targets the
// selected service. A targeted service with no phase emitted yet (the run just started)
// reports `starting`.
export function formatLiveServiceDetail(phase: UpdatePhase | undefined, issues: readonly ServiceIssue[]): string {
  const lines = [`step: ${phase ?? 'starting'}`];
  for (const issue of issues) {
    const mark = issue.resolved ? '✔' : '○';
    const state = issue.resolved ? 'resolved' : 'unresolved';
    // Review hardening: migration output can carry embedded newlines — collapse them so
    // one issue stays one row inside the overflow-hidden detail pane.
    lines.push(`${mark} ${issue.kind} — ${issue.detail.replace(/\s+/g, ' ')} (${state})`);
  }
  return lines.join('\n');
}

// Story 3.11: the service quick-pick's filter — case-insensitive substring match over
// the trimmed query against the service name or the repo path (the same convention as
// the shared branch picker's own matchBranchesBySubstring, extended to the path so
// path-distinguished duplicate service names stay narrowable). An empty query matches
// every service, so a freshly opened pick proposes the whole managed list.
export function matchServicesBySubstring(
  query: string,
  candidates: readonly { service: string; repoPath: string }[],
): { service: string; repoPath: string }[] {
  const needle = query.trim().toLowerCase();
  return candidates.filter(
    (candidate) => candidate.service.toLowerCase().includes(needle) || candidate.repoPath.toLowerCase().includes(needle),
  );
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
