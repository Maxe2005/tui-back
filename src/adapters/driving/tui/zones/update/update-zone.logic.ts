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
import type { SharedTypesStage } from '../../../../../core/shared-types/smart-update.js';
import type { ServiceStatusState } from '../../../../../core/service-status/index.js';
import type { FooterContextId } from '../../keybindings/index.js';
import { partitionServicesByEdtMembership } from '../edts/edts-zone.logic.js';
import { computeLineRowCount, sliceVisibleWindow } from '../../shared/scrollable-output/index.js';

// The Update zone's own closed per-service status set: the health-first ServiceStatusState
// passthrough (AD-23, `unhealthy` and `inconsistent` included), plus
// 'updating' (a run currently targets this service), 'migrating' (the run's live phase for this
// service is the migrate step) and 'error' (derived from the last completed run's outcome, not
// raw health — a container can report `up` immediately after a failed migration).
// 'no-container' is the TUI-side state for a service whose manifest declares no Docker
// runtime — dim, never the down treatment.
export type UpdateServiceStatus = ServiceStatusState | 'updating' | 'migrating' | 'awaiting' | 'error';

// A service paused on a pending incident ('awaiting') outranks everything: it is
// the one state that needs the developer, not the run.
// Precedence: a run currently targeting this service wins ('updating', or 'migrating' during the
// live migrate phase — outranking even a stale 'error' from a previous run); otherwise a
// standalone clean restart in flight wins ('restarting'); otherwise a failed last outcome
// outranks raw health (a container can report `up` right after a failed migration — the old
// process is still running); otherwise a container-less service reads 'no-container';
// otherwise the resolved status passes through unchanged.
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

const CONFLICT_OUTCOME_LABELS = {
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

// The recap view's body: the last run's context (who it covered, from which sources to which
// branches) followed by one line per covered service. `sources` are the confirmed per-service
// merge sources (empty: the manifest shared branches); `branches` the services' current
// branches. Null when no run has finished in this session.
export interface LastUpdateRecap {
  title: string;
  contextLines: string[];
  resultLines: string[];
}

export function formatLastUpdateRecap(
  topic: string | null,
  results: readonly GroupUpdateRepoResult[],
  selection: readonly GroupUpdateSelectionItem[] | null,
  branchByService: Readonly<Record<string, string | null>>,
): LastUpdateRecap | null {
  if (topic === null) {
    return null;
  }
  const isAll = topic === 'all-repos';
  const title = isAll ? 'Last update — all repos' : `Last update — EDT "${topic}"`;
  const contextLines = [
    isAll ? 'Scope: every managed repo' : `Scope: members of EDT "${topic}"`,
    `Services covered: ${String(results.length)}`,
  ];
  const resultLines = results.map((row) => {
    const glyph = row.outcome === 'updated' ? '✔' : row.outcome === 'skipped' ? '○' : '✖';
    const source = selection?.find((item) => item.service === row.service)?.sourceBranch ?? 'shared branch';
    const target = branchByService[row.service] ?? '?';
    const detail =
      row.detail !== undefined ? ` (${row.detail.code})${row.detail.message !== '' ? `: ${row.detail.message.replace(/\s+/g, ' ').trim()}` : ''}` : '';
    return `${glyph} ${row.service}  ${source} → ${target}  ${row.outcome}${detail}`;
  });
  return { title, contextLines, resultLines };
}

// The recap view toggle: `Esc` drops service focus (the right pane shows the last-update
// recap); any list-navigation key hands focus back to the remembered service without moving it.
// `handled` tells the dispatcher the key is consumed.
export function resolveRecapToggle(
  recapActive: boolean,
  key: { ctrl?: boolean; meta?: boolean; escape?: boolean; upArrow?: boolean; downArrow?: boolean; home?: boolean; end?: boolean },
): { recapActive: boolean; handled: boolean } {
  if (key.escape === true) {
    return { recapActive: true, handled: !recapActive };
  }
  const navigates = key.upArrow === true || key.downArrow === true || key.home === true || key.end === true;
  if (recapActive && navigates) {
    return { recapActive: false, handled: true };
  }
  return { recapActive, handled: false };
}

// The per-service step tracker behind the detail pane. One service's update is three
// user-visible steps: the merge (core's `pulling` and `merging` phases are both "bringing the
// source in"), the migration, and the restart. Each step is pending, running, done, failed or
// skipped (never reached, or switched off for the run).
export type UpdateStepKey = 'merge' | 'migration' | 'restart';
export type UpdateStepState = 'pending' | 'running' | 'done' | 'failed' | 'skipped';
export type ServiceStepStates = Record<UpdateStepKey, UpdateStepState>;

export const UPDATE_STEP_ORDER: readonly UpdateStepKey[] = ['merge', 'migration', 'restart'];

export const PENDING_STEPS: ServiceStepStates = Object.freeze({ merge: 'pending', migration: 'pending', restart: 'pending' });

function stepOfPhase(phase: UpdatePhase): UpdateStepKey {
  return phase === 'pulling' || phase === 'merging' ? 'merge' : phase === 'migrating' ? 'migration' : 'restart';
}

// A live phase emission: every earlier step that is still pending or running is done (a step
// that was switched off, e.g. migrations disabled, is marked skipped when the next one starts
// without it ever running), and the emitted phase's step runs.
export function advanceServiceSteps(current: ServiceStepStates | undefined, phase: UpdatePhase): ServiceStepStates {
  const next: ServiceStepStates = { ...(current ?? PENDING_STEPS) };
  const active = stepOfPhase(phase);
  const activeIndex = UPDATE_STEP_ORDER.indexOf(active);
  UPDATE_STEP_ORDER.forEach((step, index) => {
    if (index < activeIndex) {
      if (next[step] === 'running') {
        next[step] = 'done';
      } else if (next[step] === 'pending') {
        next[step] = 'skipped';
      }
    }
  });
  next[active] = 'running';
  return next;
}

// The run's final row settles whatever was still in flight: an updated service finished every
// step it started; a failed one fails the step it died in (a pending step stays skipped); a
// skipped one never ran anything.
export function finalizeServiceSteps(current: ServiceStepStates | undefined, result: GroupUpdateRepoResult): ServiceStepStates {
  const next: ServiceStepStates = { ...(current ?? PENDING_STEPS) };
  for (const step of UPDATE_STEP_ORDER) {
    if (next[step] === 'running') {
      next[step] = result.outcome === 'updated' ? 'done' : result.outcome === 'failed' ? 'failed' : 'skipped';
    } else if (next[step] === 'pending') {
      next[step] = 'skipped';
    }
  }
  return next;
}

// Step states for a settled result that has no live-step snapshot (e.g. only the recap row
// survives): an updated service finished everything, a skipped one ran nothing, and a failed one
// failed the first step core's run detail gives no evidence of completing.
export function inferSettledSteps(result: GroupUpdateRepoResult): ServiceStepStates {
  if (result.outcome === 'updated') {
    return { merge: 'done', migration: 'done', restart: 'done' };
  }
  if (result.outcome === 'skipped') {
    return { merge: 'skipped', migration: 'skipped', restart: 'skipped' };
  }
  if (result.run?.merge === undefined) {
    return { merge: 'failed', migration: 'skipped', restart: 'skipped' };
  }
  if (result.run.migrations?.kind === 'none') {
    return { merge: 'done', migration: 'done', restart: 'failed' };
  }
  return { merge: 'done', migration: 'failed', restart: 'skipped' };
}

export const UPDATE_STEP_LABELS: Record<UpdateStepKey, string> = {
  merge: 'Merge',
  migration: 'Migration',
  restart: 'Restart',
};

export const UPDATE_STEP_GLYPHS: Record<UpdateStepState, string> = {
  pending: '○',
  running: '◐',
  done: '✔',
  failed: '✖',
  skipped: '–',
};

const UPDATE_STEP_WORDS: Record<UpdateStepState, string> = {
  pending: 'waiting',
  running: 'in progress',
  done: 'done',
  failed: 'failed',
  skipped: 'not run',
};

// One step's headline + optional detail lines, built from the state and the run detail core
// reported (merge diff, migration command/excerpt) once the service finished.
export interface UpdateStepView {
  key: UpdateStepKey;
  state: UpdateStepState;
  headline: string;
  detail: string[];
}

// `full` keeps the migration output and the failure message exactly as core reported them
// (newlines included) instead of flattening each to a single line — the full-screen report's
// fidelity; the inline pane keeps the flattened default.
export function buildServiceStepViews(
  steps: ServiceStepStates,
  result: GroupUpdateRepoResult | undefined,
  options: { full?: boolean } = {},
): UpdateStepView[] {
  const full = options.full === true;
  return UPDATE_STEP_ORDER.map((key) => {
    const state = steps[key];
    const headline = `${UPDATE_STEP_GLYPHS[state]} ${UPDATE_STEP_LABELS[key]} — ${UPDATE_STEP_WORDS[state]}`;
    const detail: string[] = [];
    if (key === 'merge' && state === 'done') {
      const merge = result?.run?.merge;
      if (merge?.kind === 'up-to-date') {
        detail.push('already up to date');
      } else if (merge?.kind === 'advanced') {
        detail.push(
          merge.files === undefined || merge.insertions === undefined || merge.deletions === undefined
            ? 'updated (diff unavailable)'
            : `+${merge.insertions} / −${merge.deletions} lines in ${merge.files} ${merge.files === 1 ? 'file' : 'files'}`,
        );
      }
    }
    if (key === 'merge' && state === 'done' && result?.run?.conflict !== undefined) {
      detail.push(`conflict: ${CONFLICT_OUTCOME_LABELS[result.run.conflict]}`);
    }
    if (key === 'migration' && state === 'done') {
      const migrations = result?.run?.migrations;
      if (migrations?.kind === 'none') {
        detail.push('no migration command');
      } else if (migrations?.kind === 'ran') {
        detail.push(`ran: ${migrations.command}`);
        const excerpt = full ? migrations.outputExcerpt.trim() : migrations.outputExcerpt.replace(/\s*\r?\n\s*/g, ' ↵ ').trim();
        if (excerpt !== '') {
          detail.push(excerpt);
        }
      }
    }
    if (state === 'failed' && result?.detail !== undefined) {
      detail.push(`${result.detail.code}: ${full ? result.detail.message.trim() : result.detail.message.replace(/\s+/g, ' ').trim()}`);
    }
    return { key, state, headline, detail };
  });
}

// The last-update context line: where the service came from and where it went. `source` is the
// confirmed override, else the manifest's shared branch; `target` the service's branch, and the
// EDT topic of the run when it had one.
export function formatServiceUpdateContext(source: string | undefined, target: string | null, topic: string | null): string {
  const edt = topic !== null && topic !== 'all-repos' ? ` (EDT ${topic})` : '';
  return `${source ?? 'shared branch'} → ${target ?? '?'}${edt}`;
}
export type UpdateFooterInput = {
  // The incident popup is open on a guided menu / on its incident list.
  blocker: boolean;
  incidentList?: boolean;
  // The pre-run config screen's own context when it is open (see updateConfigFooterContext).
  config: FooterContextId | null;
  servicePick: boolean;
  quitConfirm: boolean;
  serviceMenu: boolean;
  // A `:update-service` request waiting for its service list or pick: nothing to press yet.
  selectRequest: boolean;
  // The full-screen service report is open.
  report: boolean;
};

// The layer that owns the keyboard, in the same priority order as the zone's key handler.
export function updateFooterContext(input: UpdateFooterInput): FooterContextId | null {
  if (input.blocker) {
    return 'menu';
  }
  if (input.incidentList === true) {
    return 'update-incidents';
  }
  if (input.config !== null) {
    return input.config;
  }
  if (input.servicePick) {
    return 'menu';
  }
  if (input.quitConfirm) {
    return 'confirm';
  }
  if (input.serviceMenu) {
    return 'menu';
  }
  if (input.report) {
    return 'update-report';
  }
  return input.selectRequest ? 'busy' : null;
}

// ---------------------------------------------------------------------------------------------
// The full-screen service report: the same step views and issue log as the inline
// pane, with nothing capped or flattened. Built as a flat line model so windowing, wrap row
// counts and failed-step jumps share one structure.
export type ReportLineKind = 'title' | 'context' | 'step' | 'step-failed' | 'detail' | 'detail-failed' | 'issue' | 'issue-resolved' | 'heading' | 'dim';

export interface ReportLine {
  kind: ReportLineKind;
  text: string;
}

export interface ServiceReport {
  lines: ReportLine[];
  // Indices (into `lines`) of the failed steps' headlines — the `n`/`p` jump targets.
  failedLines: number[];
}

export interface ServiceReportInput {
  service: string;
  mode: 'live' | 'last' | 'never';
  context: string | null;
  steps: ServiceStepStates | undefined;
  result: GroupUpdateRepoResult | undefined;
  issues: readonly ServiceIssue[];
}

// A blank line still takes one row — an empty Ink Text would collapse to none.
function reportText(text: string): string {
  return text === '' ? ' ' : text;
}

// ANSI escape sequences (colourised tool output) and the remaining C0 control characters would
// corrupt the frame; tabs become spaces, and a bare CR or CRLF is a line break.
const ANSI_SEQUENCE = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[@-Z\\-_])/g;
// eslint-disable-next-line no-control-regex
const C0_CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

export function splitReportText(text: string): string[] {
  return text
    .replace(ANSI_SEQUENCE, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '  ')
    .replace(C0_CONTROLS, '')
    .split('\n')
    .map(reportText);
}

export function buildServiceReport(input: ServiceReportInput): ServiceReport {
  const lines: ReportLine[] = [];
  const failedLines: number[] = [];
  const push = (kind: ReportLineKind, text: string): void => {
    lines.push({ kind, text });
  };
  const modeLabel = input.mode === 'live' ? '  · UPDATE IN PROGRESS' : input.mode === 'last' ? '  · last update' : '';
  push('title', `${input.service}${modeLabel}`);
  if (input.mode === 'never' && input.issues.length === 0) {
    push('dim', 'No update has run for this service yet.');
    return { lines, failedLines };
  }
  if (input.context !== null) {
    push('context', input.context);
  }
  // Without a run there are no steps to list — only the issue log.
  const views = input.mode === 'never' ? [] : buildServiceStepViews(input.steps ?? PENDING_STEPS, input.result, { full: true });
  for (const view of views) {
    push('dim', ' ');
    const failed = view.state === 'failed';
    if (failed) {
      failedLines.push(lines.length);
    }
    push(failed ? 'step-failed' : 'step', view.headline);
    for (const detail of view.detail) {
      for (const line of splitReportText(detail)) {
        push(failed ? 'detail-failed' : 'detail', `   ${line}`);
      }
    }
  }
  if (input.issues.length > 0) {
    push('dim', ' ');
    push('heading', `Issues (${String(input.issues.length)})`);
    for (const issue of input.issues) {
      const [first = ' ', ...rest] = splitReportText(issue.detail);
      const kind: ReportLineKind = issue.resolved ? 'issue-resolved' : 'issue';
      push(kind, `${issue.resolved ? '✔' : '⚠'} ${issue.kind} — ${first.trim() === '' ? '(no detail)' : first} (${issue.resolved ? 'resolved' : 'needs your input'})`);
      for (const line of rest) {
        push(kind, `    ${line}`);
      }
    }
  }
  return { lines, failedLines };
}

// The row cost of a report line under the current wrap mode.
export function reportLineRows(line: ReportLine, width: number, wrap: boolean): number {
  return computeLineRowCount(line.text, width, wrap);
}

// The greatest top offset whose window still fills the budget (the tail window's first line).
export function reportMaxOffset(lines: readonly ReportLine[], budget: number, width: number, wrap: boolean): number {
  const tail = sliceVisibleWindow(lines, 0, budget, (line) => reportLineRows(line, width, wrap));
  return Math.max(0, lines.length - tail.length);
}

// The lines drawn for a top-anchored offset: as many as fit the row budget (at least one).
export function reportWindow(lines: readonly ReportLine[], offset: number, budget: number, width: number, wrap: boolean): { start: number; visibleLines: ReportLine[] } {
  const start = Math.min(Math.max(0, offset), reportMaxOffset(lines, budget, width, wrap));
  let used = 0;
  let end = start;
  while (end < lines.length) {
    const rows = reportLineRows(lines[end] as ReportLine, width, wrap);
    if (used + rows > budget && end > start) {
      break;
    }
    used += rows;
    end += 1;
  }
  return { start, visibleLines: lines.slice(start, end) };
}

// "lines 1–12 of 340 (4%)" — the scroll position, 1-based and inclusive.
export function formatReportPosition(start: number, visibleRows: number, total: number): string {
  if (total === 0 || visibleRows === 0) {
    return 'empty';
  }
  const last = start + visibleRows;
  return `lines ${String(start + 1)}–${String(last)} of ${String(total)} (${String(Math.round((last / total) * 100))}%)`;
}

export type ReportKeyAction = 'close' | 'up' | 'down' | 'page-up' | 'page-down' | 'top' | 'bottom' | 'toggle-wrap' | 'next-failed' | 'prev-failed';

export function resolveReportKey(
  input: string,
  key: { ctrl?: boolean; meta?: boolean; escape?: boolean; upArrow?: boolean; downArrow?: boolean; pageUp?: boolean; pageDown?: boolean; home?: boolean; end?: boolean },
): ReportKeyAction | null {
  if (key.ctrl === true || key.meta === true) return null;
  if (key.escape === true) return 'close';
  if (key.upArrow === true) return 'up';
  if (key.downArrow === true) return 'down';
  if (key.pageUp === true) return 'page-up';
  if (key.pageDown === true) return 'page-down';
  if (key.home === true) return 'top';
  if (key.end === true) return 'bottom';
  if (input === 'w' || input === 'W') return 'toggle-wrap';
  if (input === 'n' || input === 'N') return 'next-failed';
  if (input === 'p' || input === 'P') return 'prev-failed';
  return null;
}

// The next top offset for a scroll action, clamped to [0, maxOffset]. `page` is the row budget.
export function applyReportScroll(offset: number, action: 'up' | 'down' | 'page-up' | 'page-down' | 'top' | 'bottom', maxOffset: number, page: number): number {
  const clamp = (value: number): number => Math.min(Math.max(0, value), maxOffset);
  const current = clamp(offset);
  switch (action) {
    case 'up':
      return clamp(current - 1);
    case 'down':
      return clamp(current + 1);
    case 'page-up':
      return clamp(current - Math.max(1, page - 1));
    case 'page-down':
      return clamp(current + Math.max(1, page - 1));
    case 'top':
      return 0;
    case 'bottom':
      return maxOffset;
  }
}

// The offset of the next/previous failed step relative to `offset`, wrapping around; null when
// the report has no failed step.
export function jumpToFailedStep(failedLines: readonly number[], offset: number, direction: 'next' | 'prev'): number | null {
  if (failedLines.length === 0) {
    return null;
  }
  if (direction === 'next') {
    return failedLines.find((index) => index > offset) ?? (failedLines[0] as number);
  }
  return [...failedLines].reverse().find((index) => index < offset) ?? (failedLines.at(-1) as number);
}
