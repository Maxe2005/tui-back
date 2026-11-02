// core/realign: puts a selection of drifted services back on the branch they should be on
// (active-EDT members: their EDT branch; other managed repos: their sharedBranch), then
// optionally restarts the realigned ones. Work is never stashed, discarded or moved: a dirty or
// mid-merge repo is skipped. One closed row per selected service; the run never rejects.
import { resolve } from 'node:path';
import { listDriftCandidates, type DriftCandidate, type DriftCandidates } from '../dashboard/drift.js';
import { checkoutExpectedBranch, type TargetBranchSpec } from '../edt/checkout-expected.js';
import { MANIFEST_FILE, withCarriedManifest } from '../edt/manifest-carry.js';
import { listSwitchRestartRepos, restartAfterSwitch, restartNeedsAttention, type RestartReport, type RestartRow } from '../edt/switch-restart.js';
import { withActionLock } from '../locking.js';
import type { EdtRegistryPort } from '../ports/edt-registry.js';
import type { GitPort } from '../ports/git.js';
import type { LockPort } from '../ports/lock.js';
import type { ManifestCarryPort } from '../ports/manifest-carry.js';
import type { ManifestPort } from '../ports/manifest.js';
import type { RegistryPort } from '../ports/registry.js';
import type { StatePort } from '../ports/state.js';
import { err, ok, type Result } from '../result.js';
import { edtUpdateLockKey, GROUP_UPDATE_LOCK_KEY } from '../scripts/group-update.js';
import type { RestartMode, ServiceActions } from '../service-actions/index.js';

export type RealignScope = 'none' | 'edt' | 'all';

export const REALIGN_SCOPES: readonly RealignScope[] = ['none', 'edt', 'all'];

export type RealignOutcome = 'realigned' | 'unchanged' | 'skipped' | 'failed';

export interface RealignRow {
  service: string;
  outcome: RealignOutcome;
  detail?: { code: string; message: string };
}

export interface RealignRestartOptions {
  mode: RestartMode;
  // `update.concurrency`.
  concurrency: number;
  serviceActions: Pick<ServiceActions, 'restart' | 'verifyService'>;
  onPhase?: (row: RestartRow) => void;
}

export interface RealignServicesParams {
  registry: RegistryPort;
  manifest: ManifestPort;
  manifestCarry: ManifestCarryPort;
  git: GitPort;
  lock: LockPort;
  state: StatePort;
  edtRegistry: EdtRegistryPort;
  scope: RealignScope;
  // Service names added to the scope's list (members or managed others, any drift state).
  services?: readonly string[];
  // Absent: no restart phase.
  restart?: RealignRestartOptions;
  // Called once per finished row, in selection order. A throwing callback never breaks the run.
  onRow?: (row: RealignRow) => void;
}

export interface RealignServicesData {
  edt: { ulid: string; topic: string };
  // The selected service names, in run order.
  selection: string[];
  rows: RealignRow[];
  restart?: RestartReport;
  // Set when the restart phase itself could not run; the realign rows stand.
  restartError?: { code: string; message: string };
}

// The scope's drifted candidates (`edt`: members, `all`: members then others; `none`: nothing)
// plus every named service, deduplicated by path, members first. An unknown scope, an unknown
// name or a name matching several repos is an `invalid-argument`.
export function resolveRealignSelection(
  candidates: Pick<DriftCandidates, 'members' | 'others'>,
  scope: string,
  services: readonly string[] = [],
): Result<DriftCandidate[]> {
  if (!(REALIGN_SCOPES as readonly string[]).includes(scope)) {
    return err('invalid-argument', `Unknown realign scope "${scope}" — expected none, edt or all`);
  }
  const all = [...candidates.members, ...candidates.others];
  const unknown = services.filter((name) => !all.some((candidate) => candidate.service === name));
  if (unknown.length > 0) {
    return err(
      'invalid-argument',
      `Unknown service ${unknown.map((name) => `"${name}"`).join(', ')} — not a member of the active EDT nor a managed service`,
    );
  }
  for (const name of new Set(services)) {
    const matches = all.filter((candidate) => candidate.service === name);
    if (matches.length > 1) {
      return err(
        'invalid-argument',
        `Service name "${name}" is ambiguous — it matches ${matches.map((candidate) => candidate.path).join(', ')}; nothing was realigned`,
      );
    }
  }
  const inScope = (candidate: DriftCandidate): boolean =>
    candidate.drift === 'drifted' && (scope === 'all' || (scope === 'edt' && candidate.kind === 'member'));
  const named = new Set(services);
  const seen = new Set<string>();
  return ok(
    all.filter((candidate) => {
      if (seen.has(candidate.path) || !(inScope(candidate) || named.has(candidate.service))) {
        return false;
      }
      seen.add(candidate.path);
      return true;
    }),
  );
}

// Turns a throwing port call into an error Result, so the run never rejects.
async function guarded<T>(code: string, call: () => Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await call();
  } catch (error) {
    return err(code, messageOf(error));
  }
}

// The selection re-judged on fresh candidates read under the locks, matched by resolved path; a
// selected repo no longer among them is reported `realign-candidate-gone`.
function refreshSelection(selection: readonly DriftCandidate[], fresh: DriftCandidates): Array<DriftCandidate | { gone: DriftCandidate }> {
  const byPath = new Map([...fresh.members, ...fresh.others].map((candidate) => [resolve(candidate.path), candidate]));
  return selection.map((candidate) => byPath.get(resolve(candidate.path)) ?? { gone: candidate });
}

export async function realignServices(params: RealignServicesParams): Promise<Result<RealignServicesData>> {
  const candidates = await guarded('realign-failed', () => listDriftCandidates(params));
  if (!candidates.ok) {
    return candidates;
  }
  const active = candidates.data.active;
  if (active === null) {
    return err('no-active-edt', 'No active EDT — switch to an EDT before running tui-back realign');
  }
  const selected = resolveRealignSelection(candidates.data, params.scope, params.services);
  if (!selected.ok) {
    return selected;
  }
  const selection = selected.data;

  const run = await withActionLock(params.lock, GROUP_UPDATE_LOCK_KEY, () =>
    withActionLock(params.lock, edtUpdateLockKey(active.ulid), async (): Promise<Result<RealignServicesData>> => {
      // The selection was read before the locks: a switch that completed meanwhile made it stale.
      const stillActive = await guarded('realign-failed', () => params.state.readActiveEdt());
      if (!stillActive.ok) {
        return stillActive;
      }
      if (stillActive.data !== active.ulid) {
        return err('realign-active-edt-changed', 'The active EDT changed while realign was starting — nothing was touched, run it again');
      }
      // Drift read before the locks may be stale: every selected repo is judged on a fresh read.
      const fresh = await guarded('realign-failed', () => listDriftCandidates(params));
      if (!fresh.ok) {
        return fresh;
      }
      const refreshed = refreshSelection(selection, fresh.data);
      const rows: RealignRow[] = [];
      for (const entry of refreshed) {
        const row =
          'gone' in entry
            ? skippedRow(entry.gone.service, 'realign-candidate-gone', `${entry.gone.path} is no longer an active-EDT member nor a managed service — left untouched`)
            : await realignOne(params, active.ulid, entry).catch((error: unknown) => failedRow(entry.service, 'realign-failed', messageOf(error)));
        rows.push(row);
        try {
          params.onRow?.({ ...row });
        } catch {
          // A failing observer must not break the run.
        }
      }
      const data: RealignServicesData = { edt: active, selection: selection.map((candidate) => candidate.service), rows };
      if (params.restart !== undefined) {
        const current = refreshed.map((entry) => ('gone' in entry ? entry.gone : entry));
        await runRestartPhase(params, params.restart, current, rows, data);
      }
      await logRun(params.edtRegistry, active.ulid, data);
      return ok(data);
    }),
  );
  if (!run.ok && run.error.code === 'action-in-progress') {
    return err(
      'realign-blocked-action-in-progress',
      `Cannot realign: an update, switch or realign is in progress on "${active.topic}". Nothing was touched.`,
    );
  }
  return run;
}

function failedRow(service: string, code: string, message: string): RealignRow {
  return { service, outcome: 'failed', detail: { code, message } };
}

function skippedRow(service: string, code: string, message: string): RealignRow {
  return { service, outcome: 'skipped', detail: { code, message } };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Reads first (nothing written before every check passed), then the shared checkout step with
// a dirty `.tui-back.yaml` carried over exactly as switch does.
async function realignOne(params: RealignServicesParams, activeUlid: string, candidate: DriftCandidate): Promise<RealignRow> {
  const { git } = params;
  const { service, path, expectedBranch } = candidate;
  if (candidate.unregistered === true) {
    return failedRow(service, 'repo-not-registered', `Member ${path} is no longer in the managed-repo registry — left untouched`);
  }
  if (candidate.drift === 'aligned') {
    return { service, outcome: 'unchanged' };
  }
  if (candidate.drift === 'unknown') {
    const why = candidate.detail !== undefined ? `: ${candidate.detail.message}` : '';
    return skippedRow(service, 'realign-drift-unknown', `The current branch of ${path} could not be read${why} — left untouched`);
  }

  const merge = await git.isMergeInProgress(path);
  if (!merge.ok) {
    return failedRow(service, merge.error.code, merge.error.message);
  }
  if (merge.data) {
    return skippedRow(service, 'realign-merge-in-progress', `A merge is in progress in ${path} — finish or abort it first; left untouched`);
  }
  const rebase = await git.isRebaseInProgress(path);
  if (!rebase.ok) {
    return failedRow(service, rebase.error.code, rebase.error.message);
  }
  if (rebase.data) {
    return skippedRow(service, 'realign-rebase-in-progress', `A rebase is in progress in ${path} — finish or abort it first; left untouched`);
  }
  const unmerged = await git.hasUnmergedPaths(path);
  if (!unmerged.ok) {
    return failedRow(service, unmerged.error.code, unmerged.error.message);
  }
  if (unmerged.data) {
    return skippedRow(service, 'realign-unmerged-paths', `${path} has unmerged paths — resolve them first; left untouched`);
  }
  const dirty = await git.hasUncommittedChanges(path, { excludePaths: [MANIFEST_FILE] });
  if (!dirty.ok) {
    return failedRow(service, dirty.error.code, dirty.error.message);
  }
  if (dirty.data) {
    return skippedRow(
      service,
      'realign-dirty-work',
      `${path} has uncommitted changes — commit or stash them, then realign again; left untouched`,
    );
  }

  const spec: TargetBranchSpec =
    candidate.kind === 'member' ? { kind: 'member', branch: expectedBranch, edtUlid: activeUlid } : { kind: 'shared', branch: expectedBranch };
  const carried = await withCarriedManifest({ git, carry: params.manifestCarry }, path, service, async () => {
    const checkedOut = await checkoutExpectedBranch({
      git,
      repoPath: path,
      spec,
      prepare: async () => ({ ok: true as const, value: undefined }),
      onResolveFailed: (error) => error,
      onCheckoutFailed: async (_prepared, error) => error,
    });
    return checkedOut.ok
      ? { service, outcome: 'switched' as const }
      : { service, outcome: 'failed' as const, detail: { code: checkedOut.row.code, message: checkedOut.row.message } };
  });
  if (carried.outcome === 'failed') {
    return failedRow(service, carried.detail?.code ?? 'realign-failed', carried.detail?.message ?? 'realign failed');
  }
  return { service, outcome: 'realigned', detail: { code: 'realigned', message: `Checked out "${expectedBranch}"` } };
}

// The post-switch restart phase, targeting the realigned services only; the report covers the
// selection (every other selected service `skipped`). A failure here never undoes a realign.
async function runRestartPhase(
  params: RealignServicesParams,
  options: RealignRestartOptions,
  selection: readonly DriftCandidate[],
  rows: readonly RealignRow[],
  data: RealignServicesData,
): Promise<void> {
  const repos = await listSwitchRestartRepos({ registry: params.registry, manifest: params.manifest }).catch(
    (error: unknown): Result<never> => err('realign-restart-failed', messageOf(error)),
  );
  if (!repos.ok) {
    data.restartError = { code: repos.error.code, message: repos.error.message };
    return;
  }
  // Paths are compared resolve()'d on both sides, so a trailing slash never drops a target.
  const selectedPaths = new Set(selection.map((candidate) => resolve(candidate.path)));
  const realignedPaths = new Set(
    selection.filter((_, index) => rows[index]?.outcome === 'realigned').map((candidate) => resolve(candidate.path)),
  );
  const covered = repos.data.filter((repo) => selectedPaths.has(resolve(repo.repoPath)));
  const report = await restartAfterSwitch({
    results: [],
    repos: covered,
    mode: options.mode,
    concurrency: options.concurrency,
    serviceActions: options.serviceActions,
    changedServices: covered.filter((repo) => realignedPaths.has(resolve(repo.repoPath))).map((repo) => repo.service),
    ...(options.onPhase !== undefined ? { onPhase: options.onPhase } : {}),
  });
  if (report.ok) {
    data.restart = report.data;
  } else {
    data.restartError = { code: report.error.code, message: report.error.message };
  }
}

function describeRun(data: RealignServicesData): string {
  const selection = data.selection.length > 0 ? data.selection.join(', ') : '(none)';
  const outcomes = data.rows
    .map((row) => (row.outcome === 'realigned' || row.outcome === 'unchanged' || row.detail === undefined ? `${row.service} ${row.outcome}` : `${row.service} ${row.outcome} (${row.detail.code})`))
    .join('; ');
  const restart =
    data.restart !== undefined
      ? ` — restart ${data.restart.mode}: ${data.restart.rows.map((row) => `${row.service} ${row.phase}`).join('; ')}`
      : data.restartError !== undefined
        ? ` — restart failed: ${data.restartError.message}`
        : '';
  return `Selection: ${selection} — ${outcomes === '' ? 'nothing to realign' : outcomes}${restart}`;
}

// One action-log entry per run, `failed` exactly when the CLI exits non-zero; a log failure (or
// a port without a log) never fails the run.
async function logRun(edtRegistry: EdtRegistryPort, ulid: string, data: RealignServicesData): Promise<void> {
  if (edtRegistry.logAction === undefined) {
    return;
  }
  const outcome =
    data.rows.some((row) => row.outcome === 'failed') ||
    data.restartError !== undefined ||
    (data.restart !== undefined && restartNeedsAttention(data.restart.summary))
      ? 'failed'
      : 'success';
  try {
    await edtRegistry.logAction(ulid, 'realign', outcome, describeRun(data));
  } catch {
    // Logging is best-effort.
  }
}
