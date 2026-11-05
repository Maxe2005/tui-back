// core/heal: restart every active-EDT service that is not up. Planning and running are two
// exports so a consumer can show the plan before running it (the Dashboard's confirm overlay).
// Statuses come only from `resolveServiceStatus` (AD-23): heal never combines the probe and the
// container itself. Targets are `down` / `unhealthy` services that declare a container; every
// other member is a `skipped` row with its reason. The run reuses the switch-restart pool and
// report through `runRestartRows`. Heal holds no group-level lock: each target checks its own
// restart lock and the restart-blocking locks right before it restarts, and a held one fails
// that row only. Ports are injected and nothing here rejects.
import { resolve } from 'node:path';
import { runRestartRows, type RestartReport, type RestartRow, type RestartSkipReason } from '../edt/switch-restart.js';
import type { DockerPort } from '../ports/docker.js';
import type { EdtMember, EdtRegistryPort } from '../ports/edt-registry.js';
import type { HealthProbePort } from '../ports/health-probe.js';
import type { LockPort } from '../ports/lock.js';
import type { Manifest, ManifestPort } from '../ports/manifest.js';
import type { StatePort } from '../ports/state.js';
import { err, ok, type Result } from '../result.js';
import { serviceRestartLockKey } from '../scripts/service-restart.js';
import { heldLockName, restartBlockingLocks, type NamedLock, type RestartMode, type ServiceActions } from '../service-actions/index.js';
import { resolveServiceStatus, type ServiceStatus } from '../service-status/index.js';

export const HEAL_NOTHING_TO_DO_MESSAGE = 'every service is up';

// The name a held per-service restart lock is reported under (`service restart in progress`).
export const SERVICE_RESTART_LOCK_NAME = 'service restart';

export interface HealEdt {
  ulid: string;
  topic: string;
}

export interface HealPlan {
  edt: HealEdt;
  // One row per active-EDT member, in member order: targets `pending`, the rest `skipped` with
  // their `skipReason`.
  rows: RestartRow[];
}

export type HealReport = RestartReport & {
  edt: HealEdt;
  // `every service is up` when the plan had no target.
  message?: string;
};

export interface PlanHealParams {
  state: Pick<StatePort, 'readActiveEdt'>;
  edtRegistry: Pick<EdtRegistryPort, 'list'>;
  manifest: ManifestPort;
  docker: Pick<DockerPort, 'getContainerHealth'>;
  // Not wired = statuses are container-only, as if no healthUrl were declared.
  healthProbe?: HealthProbePort;
  // The per-service health-check toggle (`services.healthCheckDisabled`), forwarded to the resolver: a disabled
  // service resolves as if it had no healthUrl, so heal never targets it as `unhealthy`.
  // Not wired = every health check is enabled.
  isHealthCheckEnabled?: (manifest: Manifest) => boolean;
}

export interface RunHealParams {
  plan: HealPlan;
  mode: RestartMode;
  // `update.concurrency`.
  concurrency: number;
  serviceActions: Pick<ServiceActions, 'restart' | 'verifyService'>;
  lock: LockPort;
  // Called with the updated row on every transition, and once per row up front. A throwing
  // callback never breaks the run.
  onPhase?: (row: RestartRow) => void;
}

// The skip reason for a resolved status, or null when the service is a heal target.
export function healSkipReason(status: Result<ServiceStatus>): RestartSkipReason | null {
  if (!status.ok) {
    return 'status unknown';
  }
  const { state, container } = status.data;
  switch (state) {
    case 'up':
      return 'up';
    case 'restarting':
      return 'already restarting';
    case 'inconsistent':
      return 'inconsistent';
    case 'no-container':
      return 'no container';
    case 'down':
    case 'unhealthy':
      return container === 'no-container' ? 'no container' : null;
    default: {
      // A new ServiceStatusState must be classified here: this fails to compile until it is.
      const unclassified: never = state;
      return unclassified;
    }
  }
}

export async function planHeal(params: PlanHealParams): Promise<Result<HealPlan>> {
  try {
    const activeUlid = await params.state.readActiveEdt();
    if (!activeUlid.ok) {
      return activeUlid;
    }
    const edts = await params.edtRegistry.list();
    if (!edts.ok) {
      return edts;
    }
    const active = activeUlid.data === null ? undefined : edts.data.find((entry) => entry.ulid === activeUlid.data);
    if (active === undefined) {
      return err('no-active-edt', 'No active EDT — switch to an EDT before healing its services');
    }
    const deps = {
      manifest: params.manifest,
      docker: params.docker,
      ...(params.healthProbe === undefined ? {} : { healthProbe: params.healthProbe }),
      ...(params.isHealthCheckEnabled === undefined ? {} : { isHealthCheckEnabled: params.isHealthCheckEnabled }),
    };
    // Resolved in parallel; rows keep member order.
    const rows = await Promise.all(active.members.map((member) => planRow(deps, member)));
    return ok({ edt: { ulid: active.ulid, topic: active.topic }, rows });
  } catch (cause) {
    return err('heal-plan-failed', messageOf(cause));
  }
}

// A `status unknown` row carries the cause (resolver error or thrown message) as its detail.
async function planRow(deps: Parameters<typeof resolveServiceStatus>[0], member: EdtMember): Promise<RestartRow> {
  // resolve('') is the process cwd: a blank repoPath is never resolved nor probed.
  if (member.repoPath.trim() === '') {
    return { service: member.service, repoPath: member.repoPath, phase: 'skipped', skipReason: 'status unknown', detail: 'blank repoPath in the EDT registry' };
  }
  const repoPath = resolve(member.repoPath);
  let status: Result<ServiceStatus>;
  try {
    status = await resolveServiceStatus(deps, repoPath);
  } catch (cause) {
    status = err('status-unavailable', messageOf(cause));
  }
  const skipReason = healSkipReason(status);
  if (skipReason === null) {
    return { service: member.service, repoPath, phase: 'pending' };
  }
  return {
    service: member.service,
    repoPath,
    phase: 'skipped',
    skipReason,
    ...(!status.ok ? { detail: status.error.message } : {}),
  };
}

export async function runHeal(params: RunHealParams): Promise<Result<HealReport>> {
  const { plan, mode, concurrency, serviceActions, lock, onPhase } = params;
  const blocking = restartBlockingLocks(plan.edt.ulid);
  const beforeRestart = async (row: RestartRow): Promise<string | null> => {
    const locks: NamedLock[] = [{ key: serviceRestartLockKey(row.repoPath), name: SERVICE_RESTART_LOCK_NAME }, ...blocking];
    const held = await heldLockName(lock, locks);
    return held === null ? null : `${held} in progress`;
  };
  const hasTarget = plan.rows.some((row) => row.phase === 'pending');
  let report: Result<RestartReport>;
  try {
    report = await runRestartRows({
      rows: plan.rows,
      mode,
      concurrency,
      serviceActions,
      beforeRestart,
      failureCode: 'heal-failed',
      ...(onPhase !== undefined ? { onPhase } : {}),
    });
  } catch (cause) {
    return err('heal-failed', messageOf(cause));
  }
  if (!report.ok) {
    return report;
  }
  return ok({ ...report.data, edt: { ...plan.edt }, ...(hasTarget ? {} : { message: HEAL_NOTHING_TO_DO_MESSAGE }) });
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
