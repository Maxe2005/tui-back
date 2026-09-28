import { basename, resolve } from 'node:path';
import { withActionLock } from '../locking.js';
import type { ContainerPort } from '../ports/container.js';
import type { LockPort } from '../ports/lock.js';
import type { ManifestPort } from '../ports/manifest.js';
import type { RestartPort } from '../ports/restart.js';
import { err, ok, type Result } from '../result.js';
import { runRestartStep, type GroupUpdateRepoResult, type OnUpdatePhase } from './group-update.js';

// core/scripts/service-restart: the standalone single-service clean restart (story 3.9).
// Runs story 3.8's recipe-or-fallback for exactly one service — the manifest's
// `restartCommands` recipe in order when declared, else today's plain container restart —
// and returns its `{service, outcome, detail?}` row for the last-outcome view. One
// service's failure never blocks or rolls back others (there are no others).
//
// Locking: a per-service `service:<resolved-repoPath>` key via `withActionLock` (beside
// `GROUP_UPDATE_LOCK_KEY`), matching `matchSelectionItem`'s path-first identity, so a
// second trigger on the same service serializes as `update-already-running`. Cross-scope
// exclusion (group run vs standalone, either direction) lives in the TUI store's own
// in-flight map — core only backstops same-service contention here. Restart decision
// stays core-side via the shared `runRestartStep`: never both ports for one action.
export interface ServiceRestartParams {
  manifest: ManifestPort;
  container: ContainerPort;
  restart: RestartPort;
  lock: LockPort;
  repoPath: string;
  // Story 3.10: the same live-phase observer the group update threads through
  // `runRestartStep` — absent by default; the TUI store backs it with its live phase map
  // so the standalone path reports `restarting` through the identical channel.
  onPhase?: OnUpdatePhase;
}

export function serviceRestartLockKey(repoPath: string): string {
  return `service:${resolve(repoPath)}`;
}

function serviceFallback(repoPath: string): string {
  const base = basename(repoPath);
  // Two repos can share a directory basename (/x/api vs /y/api) while lastServiceOutcomes
  // is keyed by `service` — qualify with the full path so the merged row can never
  // misattribute to the wrong service. A path with no basename keeps the bare repoPath.
  return base !== '' ? `${base} (${repoPath})` : repoPath;
}

export async function serviceRestart(params: ServiceRestartParams): Promise<Result<GroupUpdateRepoResult>> {
  const { manifest, container, restart, lock, repoPath, onPhase } = params;
  // A blank repoPath would resolve to the process cwd and lock/target the wrong directory
  // before manifest.load ever fails — reject before acquiring anything.
  if (repoPath.trim() === '') {
    return err('invalid-argument', 'repoPath must not be empty — pass the service repo directory');
  }
  const run = await withActionLock(lock, serviceRestartLockKey(repoPath), async () => {
    const loaded = await manifest.load(repoPath);
    if (!loaded.ok) {
      return ok({
        service: serviceFallback(repoPath),
        outcome: 'failed',
        detail: { code: loaded.error.code, message: loaded.error.message },
      } as GroupUpdateRepoResult);
    }
    const { service, container: containerName, restartCommands } = loaded.data;
    const restarted = await runRestartStep({
      container,
      restart,
      containerName,
      restartCommands,
      repoPath,
      cleanRestart: true,
      service,
      onPhase,
    });
    if (!restarted.ok) {
      return ok({ service, outcome: 'failed', detail: { code: restarted.error.code, message: restarted.error.message } } as GroupUpdateRepoResult);
    }
    return ok({ service, outcome: 'updated' } as GroupUpdateRepoResult);
  });
  if (!run.ok && run.error.code === 'action-in-progress') {
    return err(
      'update-already-running',
      `A restart for ${repoPath} is already in progress — wait for it to finish before starting another.`,
    );
  }
  return run;
}
