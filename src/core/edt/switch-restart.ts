// core/edt/switch-restart: the optional post-switch service restart (FR-37). It is a SECOND call
// made after a successful `switchActiveEdt` — the switch's atomicity and tests stay untouched.
// Pure orchestration over `runPool`: every target (a service whose branch changed in the switch
// and that declares a container) is restarted through `ServiceActions.restart`, then verified
// through `ServiceActions.verifyService`; every other managed service is reported `skipped`
// with its reason, never `failed`. Ports are injected and the run never rejects.
import { resolve } from 'node:path';
import type { ManifestPort } from '../ports/manifest.js';
import type { RegistryPort } from '../ports/registry.js';
import { err, ok, type Result } from '../result.js';
import { runPool } from '../scripts/run-pool.js';
import type { RestartMode, ServiceActions, ServiceFinalState } from '../service-actions/index.js';
import type { SwitchEdtRepoResult } from './switch.js';

export type SwitchRestartRunMode = 'none' | RestartMode;

export const SWITCH_RESTART_RUN_MODES: readonly SwitchRestartRunMode[] = ['none', 'simple', 'clean'];

// `pending → restarting → verifying → final state`; `skipped` rows never leave their phase.
export type RestartRowPhase = 'pending' | 'restarting' | 'verifying' | ServiceFinalState | 'skipped';

export type RestartSkipReason = 'unchanged' | 'no container';

export interface RestartRow {
  service: string;
  repoPath: string;
  phase: RestartRowPhase;
  // Set on a `skipped` row.
  skipReason?: RestartSkipReason;
  // Why the state is not green, or the failure's message; `NO_CLEAN_RECIPE_NOTICE` rides here
  // on a clean restart that had no recipe.
  detail?: string;
}

// A managed repo the report must account for (members and non-members alike).
export interface SwitchRestartRepo {
  service: string;
  repoPath: string;
  hasContainer: boolean;
}

export interface RestartSummary {
  functional: number;
  'up-unverified': number;
  unhealthy: number;
  restarting: number;
  down: number;
  failed: number;
  skipped: number;
}

export interface RestartReport {
  mode: RestartMode;
  // Non-green first (see `orderRestartRows`), each with its detail.
  rows: RestartRow[];
  summary: RestartSummary;
}

const PHASE_ORDER: readonly RestartRowPhase[] = [
  'failed',
  'down',
  'unhealthy',
  'restarting',
  'up-unverified',
  'functional',
  'skipped',
];

// Stable sort: failed, down, unhealthy, restarting, up-unverified, functional, skipped.
export function orderRestartRows(rows: readonly RestartRow[]): RestartRow[] {
  const rank = (row: RestartRow): number => {
    const index = PHASE_ORDER.indexOf(row.phase);
    return index === -1 ? PHASE_ORDER.length : index;
  };
  return rows.map((row, index) => ({ row, index })).sort((a, b) => rank(a.row) - rank(b.row) || a.index - b.index).map((entry) => entry.row);
}

export function summarizeRestartRows(rows: readonly RestartRow[]): RestartSummary {
  const summary: RestartSummary = { functional: 0, 'up-unverified': 0, unhealthy: 0, restarting: 0, down: 0, failed: 0, skipped: 0 };
  for (const row of rows) {
    if (row.phase in summary) {
      summary[row.phase as keyof RestartSummary] += 1;
    }
  }
  return summary;
}

// True when the run ended on something the developer must look at (CLI exit code, TUI banner).
export function restartNeedsAttention(summary: RestartSummary): boolean {
  return summary.failed + summary.down + summary.unhealthy > 0;
}

const CHANGED_OUTCOMES: ReadonlySet<SwitchEdtRepoResult['outcome']> = new Set(['switched', 'adopted', 'discarded']);

// The one definition of "this service's branch changed in the switch" — the restart targets, the
// store's in-flight marking and the dialog's decision to start a phase all use it.
export function isChangedSwitchOutcome(outcome: SwitchEdtRepoResult['outcome']): boolean {
  return CHANGED_OUTCOMES.has(outcome);
}

export interface RestartAfterSwitchParams {
  results: readonly SwitchEdtRepoResult[];
  repos: readonly SwitchRestartRepo[];
  mode: SwitchRestartRunMode;
  // `update.concurrency`.
  concurrency: number;
  serviceActions: Pick<ServiceActions, 'restart' | 'verifyService'>;
  // Called with the updated row on every transition, and once per row up front (`pending` or
  // `skipped`). A throwing callback never breaks the run.
  onPhase?: (row: RestartRow) => void;
}

export async function restartAfterSwitch(params: RestartAfterSwitchParams): Promise<Result<RestartReport>> {
  const { results, repos, mode, concurrency, serviceActions, onPhase } = params;
  if (!SWITCH_RESTART_RUN_MODES.includes(mode)) {
    return err('invalid-argument', `Unknown restart mode "${String(mode)}" — expected none, simple or clean`);
  }
  if (mode === 'none') {
    return err('invalid-argument', 'restartAfterSwitch needs mode simple or clean — mode none means no restart phase');
  }
  const emit = (row: RestartRow): void => {
    try {
      onPhase?.({ ...row });
    } catch {
      // A failing observer must not break the restart run.
    }
  };

  const changed = new Set(results.filter((result) => isChangedSwitchOutcome(result.outcome)).map((result) => result.service));
  const rows: RestartRow[] = repos.map((repo) => {
    const row: RestartRow = { service: repo.service, repoPath: repo.repoPath, phase: 'pending' };
    if (!changed.has(repo.service)) {
      return { ...row, phase: 'skipped', skipReason: 'unchanged' };
    }
    if (!repo.hasContainer) {
      return { ...row, phase: 'skipped', skipReason: 'no container' };
    }
    return row;
  });
  rows.forEach(emit);

  const targets = rows.map((row, index) => ({ row, index })).filter((entry) => entry.row.phase === 'pending');
  const set = (index: number, patch: Partial<RestartRow>): RestartRow => {
    const next = { ...(rows[index] as RestartRow), ...patch };
    rows[index] = next;
    emit(next);
    return next;
  };
  const fail = (index: number, message: string): RestartRow => set(index, { phase: 'failed', detail: message });

  try {
    await runPool(
      targets,
      {
        concurrency,
        keyOf: (target) => resolve(target.row.repoPath),
        onCancelled: (target) => fail(target.index, 'restart cancelled'),
        onError: (target, error) => fail(target.index, error instanceof Error ? error.message : String(error)),
      },
      async (target) => {
        const { index, row } = target;
        set(index, { phase: 'restarting' });
        const restarted = await serviceActions.restart(row.repoPath, mode);
        if (!restarted.ok) {
          return fail(index, restarted.error.message);
        }
        const notice = restarted.data.notice;
        set(index, { phase: 'verifying', ...(notice !== undefined ? { detail: notice } : {}) });
        const verified = await serviceActions.verifyService(row.repoPath);
        if (!verified.ok) {
          return fail(index, verified.error.message);
        }
        const detail = [notice, verified.data.detail].filter((part): part is string => part !== undefined).join(' — ');
        const { detail: _previous, ...rest } = rows[index] as RestartRow;
        return set(index, { ...rest, phase: verified.data.state, ...(detail !== '' ? { detail } : {}) });
      },
    );
  } catch (error) {
    // runPool never rejects; guard anyway so the never-throw invariant holds.
    return err('switch-restart-failed', error instanceof Error ? error.message : String(error));
  }

  const ordered = orderRestartRows(rows);
  return ok({ mode, rows: ordered, summary: summarizeRestartRows(ordered) });
}

// Every managed repo with its manifest service name and whether it declares a container — what
// the report must account for. An unreadable manifest is reported by the switch itself; here
// such a repo is simply treated as container-less (skipped, never failed).
export async function listSwitchRestartRepos(deps: {
  registry: RegistryPort;
  manifest: ManifestPort;
}): Promise<Result<SwitchRestartRepo[]>> {
  const listed = await deps.registry.list();
  if (!listed.ok) {
    return listed;
  }
  const repos: SwitchRestartRepo[] = [];
  for (const rawPath of listed.data) {
    const repoPath = resolve(rawPath);
    const loaded = await deps.manifest.load(repoPath);
    repos.push(
      loaded.ok
        ? { service: loaded.data.service, repoPath, hasContainer: (loaded.data.container ?? '').trim() !== '' }
        : { service: repoPath, repoPath, hasContainer: false },
    );
  }
  return ok(repos);
}
