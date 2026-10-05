// tui/zones/update: pure logic behind the Update zone — service-status derivation, EDT-members-
// first list ordering, the live detail and issue log, the editor command line, and the
// lastServiceOutcomes merge the store applies on run completion. The useInput callback stays a
// thin dispatcher over these unit-tested functions.
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

// The Update zone's own closed per-service status set: a raw HealthState passthrough, plus
// 'updating' (a run currently targets this service), 'migrating' (the run's live phase for this
// service is the migrate step) and 'error' (derived from the last completed run's outcome, not
// raw health — a container can report `up` immediately after a failed migration).
// 'no-container' is the TUI-side state for a service whose manifest declares no Docker
// runtime — dim, never the down treatment.
export type UpdateServiceStatus = HealthState | 'updating' | 'migrating' | 'error' | 'no-container';

// Precedence: a run currently targeting this service wins ('updating', or 'migrating' during the
// live migrate phase — outranking even a stale 'error' from a previous run); otherwise a
// standalone clean restart in flight wins ('restarting'); otherwise a failed last outcome
// outranks raw health (a container can report `up` right after a failed migration — the old
// process is still running); otherwise a container-less service reads 'no-container';
// otherwise raw health passes through unchanged.
export function deriveUpdateServiceStatus(
  health: HealthState | 'no-container',
  lastOutcome: GroupUpdateRepoResult['outcome'] | undefined,
  isTargetedByRunningRun: boolean,
  isRestarting = false,
  livePhase?: UpdatePhase,
): UpdateServiceStatus {
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
  if (health === 'no-container') {
    return 'no-container';
  }
  return health;
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
  if (lastOutcome.outcome === 'updated') {
    return 'updated';
  }
  const code = lastOutcome.detail?.code ?? lastOutcome.outcome;
  const message = lastOutcome.detail?.message !== undefined ? `: ${lastOutcome.detail.message}` : '';
  return `${lastOutcome.outcome} (${code})${message}`;
}

// One entry of the live per-service issue log. `kind` is the blocker kind
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

// The detail pane's live body: the current step plus the issue log with resolved/unresolved
// marking — replacing the last-outcome view while a run targets the selected service. A targeted
// service with no phase emitted yet (the run just started) reports `starting`.
export function formatLiveServiceDetail(phase: UpdatePhase | undefined, issues: readonly ServiceIssue[]): string {
  const lines = [`step: ${phase ?? 'starting'}`];
  for (const issue of issues) {
    const mark = issue.resolved ? '✔' : '○';
    const state = issue.resolved ? 'resolved' : 'unresolved';
    // Migration output can carry embedded newlines — collapse them so one issue stays one row
    // inside the overflow-hidden detail pane.
    lines.push(`${mark} ${issue.kind} — ${issue.detail.replace(/\s+/g, ' ')} (${state})`);
  }
  return lines.join('\n');
}

// The placeholder a configured editor command carries where the blocked repo's path goes
// (`code <repo>`, `idea --line 1 <repo>`, `--folder-uri=<repo>`).
export const EDITOR_REPO_PLACEHOLDER = '<repo>';

// Splits a command line into argv tokens on whitespace, honoring single/double quotes so a
// binary or argument containing spaces stays one token (`"/opt/My Editor/bin/ed" <repo>`).
// No shell is ever involved (the command is spawned directly), so there is no escaping,
// globbing, or variable expansion to emulate — quotes only group.
export function tokenizeCommandLine(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let started = false;
  let quote: '"' | "'" | null = null;
  for (const char of command) {
    if (quote !== null) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      started = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (started) {
        tokens.push(current);
        current = '';
        started = false;
      }
      continue;
    }
    current += char;
    started = true;
  }
  if (started) {
    tokens.push(current);
  }
  return tokens;
}

// Resolves the argv the "Open in editor" choice spawns on a blocked repo. Precedence: the
// `general.editorCommand` setting, then `$EDITOR`, then `vi` — a blank value at any level
// falls through to the next. Every `<repo>` occurrence is replaced by the repo path; a
// command without the placeholder gets the path appended as its last argument (the
// `$EDITOR` convention: `code --wait` -> `code --wait <path>`).
export function resolveEditorCommand(
  configured: string,
  envEditor: string | undefined,
  repoPath: string,
): { binary: string; args: string[] } {
  const source = [configured, envEditor ?? ''].map((candidate) => tokenizeCommandLine(candidate)).find((tokens) => tokens.length > 0);
  const [binary = 'vi', ...rest] = source ?? [];
  if (!rest.some((token) => token.includes(EDITOR_REPO_PLACEHOLDER))) {
    return { binary, args: [...rest, repoPath] };
  }
  return { binary, args: rest.map((token) => token.split(EDITOR_REPO_PLACEHOLDER).join(repoPath)) };
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
