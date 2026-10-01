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
