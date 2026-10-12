// core/shared-types/smart-update: the `shared-types` phase of a smart group update. Once the
// source repo has been updated alone, this publishes its version (runPublish), then propagates
// it to every consumer of the EDT with a commit (propagateVersion) — install and clean restart
// off, nothing ever pushed. It has no I/O of its own: every port is injected, and a failure is
// returned as a Result (never thrown) so the driving side can route it to its pause seam.
import type { ContainerPort } from '../ports/container.js';
import type { GitPort } from '../ports/git.js';
import type { ManifestPort } from '../ports/manifest.js';
import type { RestartPort } from '../ports/restart.js';
import type { SharedTypesPort } from '../ports/shared-types.js';
import { err, ok, type Result } from '../result.js';
import type { GroupUpdateRepoResult } from '../scripts/group-update.js';
import type { DependencyConsumer, SourceEntry } from './list-consumers.js';
import { propagateVersion, type PropagateServiceResult } from './propagate-version.js';
import { runPublish } from './publish-version.js';

// The run-wide setting: never, only when the source's merge changed something, or every time.
export type SharedTypesMode = 'off' | 'if-changed' | 'always';

export const SHARED_TYPES_PHASE_FAILED = 'shared-types-phase-failed';

// What the phase is doing right now, for the live tracking of the source service.
export type SharedTypesStage = 'publishing' | 'propagating';

export interface SharedTypesPhaseParams {
  git: GitPort;
  manifest: ManifestPort;
  container: ContainerPort;
  restart: RestartPort;
  shared: SharedTypesPort;
  mode: Exclude<SharedTypesMode, 'off'>;
  source: SourceEntry;
  // The source's final row from the stage-0 update; undefined when it produced none.
  sourceRow: GroupUpdateRepoResult | undefined;
  // Every consumer of the active EDT (selected for the run or not).
  consumers: DependencyConsumer[];
  registries?: Readonly<Record<string, string>>;
  // Retry after a propagation failure: the version an earlier attempt already published, so
  // the publish command is never run twice for the same run.
  publishedVersion?: string;
  onStage?: (stage: SharedTypesStage) => void;
  // Test seam, forwarded to propagateVersion.
  fileExists?: (repoPath: string, relativePath: string) => boolean;
}

export type SharedTypesPhaseOutcome =
  | { status: 'skipped'; reason: string }
  | { status: 'done'; version: string; results: PropagateServiceResult[] };

// Carried in the `details` of a failed phase.
export interface SharedTypesPhaseFailure {
  stage: SharedTypesStage;
  // Set once the publish step succeeded (a retry reuses it).
  publishedVersion?: string;
  failedServices: string[];
}

// Whether the phase must run for this source row under `mode`: a skipped/failed source never
// publishes, and `if-changed` needs a merge that advanced.
export function shouldRunSharedTypesPhase(mode: SharedTypesMode, row: GroupUpdateRepoResult | undefined): boolean {
  if (mode === 'off' || row === undefined || row.outcome !== 'updated') {
    return false;
  }
  return mode === 'always' || row.run?.merge?.kind === 'advanced';
}

function fail(message: string, details: SharedTypesPhaseFailure): Result<never> {
  return err(SHARED_TYPES_PHASE_FAILED, message, details);
}

export async function runSharedTypesPhase(params: SharedTypesPhaseParams): Promise<Result<SharedTypesPhaseOutcome>> {
  const { source, sourceRow, mode } = params;
  if (!shouldRunSharedTypesPhase(mode, sourceRow)) {
    const reason =
      sourceRow === undefined || sourceRow.outcome !== 'updated'
        ? `${source.service} was not updated — nothing to publish`
        : `${source.service} merge changed nothing — nothing to publish`;
    return ok({ status: 'skipped', reason });
  }

  let version = params.publishedVersion;
  if (version === undefined) {
    params.onStage?.('publishing');
    const published = await runPublish({
      git: params.git,
      restart: params.restart,
      shared: params.shared,
      sourceRepoPath: source.repoPath,
      publishCommand: source.publishCommand,
      packageName: source.packageName,
      ...(source.registry !== undefined ? { registry: source.registry } : {}),
    });
    if (!published.ok) {
      return fail(`Publishing ${source.packageName} failed: ${published.error.message}`, { stage: 'publishing', failedServices: [source.service] });
    }
    version = published.data.version;
  }

  params.onStage?.('propagating');
  const report = await propagateVersion({
    git: params.git,
    manifest: params.manifest,
    container: params.container,
    restart: params.restart,
    shared: params.shared,
    version,
    consumers: params.consumers,
    ...(params.registries !== undefined ? { registries: params.registries } : {}),
    options: { install: false, cleanRestart: false, commit: true },
    ...(params.fileExists !== undefined ? { fileExists: params.fileExists } : {}),
  });
  if (report.status === 'blocked') {
    // A blocked propagation (no consumer, registry unreachable...) wrote nothing.
    if (report.error.code === 'no-service-selected') {
      return ok({ status: 'done', version, results: [] });
    }
    return fail(`Propagating ${version} failed: ${report.error.message}`, { stage: 'propagating', publishedVersion: version, failedServices: [] });
  }
  const failed = report.results.filter((result) => result.outcome === 'failed');
  if (failed.length > 0) {
    const detail = failed.map((result) => `${result.service} (${result.error?.message ?? 'failed'})`).join(', ');
    return fail(`Propagating ${version} failed for: ${detail}`, {
      stage: 'propagating',
      publishedVersion: version,
      failedServices: failed.map((result) => result.service),
    });
  }
  return ok({ status: 'done', version, results: report.results });
}
