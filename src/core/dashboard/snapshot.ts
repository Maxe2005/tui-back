// core/dashboard/snapshot: buildDashboardSnapshot assembles everything the Dashboard shows —
// the active EDT's services (container, branch, divergence, working tree, branch flags) and a
// registry-health summary. Read-only; every probed field fails on its own, never the snapshot.
import { resolve } from 'node:path';
import type { DockerPort, HealthState } from '../ports/docker.js';
import type { EdtMember, EdtRegistryEntry, EdtRegistryPort } from '../ports/edt-registry.js';
import type { GitPort } from '../ports/git.js';
import type { Manifest, ManifestPort } from '../ports/manifest.js';
import type { RegistryPort } from '../ports/registry.js';
import type { StatePort } from '../ports/state.js';
import { ok, type Result } from '../result.js';
import { getServiceHealth } from '../logs/use-cases.js';
import { isProtectedBranch } from '../edt/shared-branches.js';
import { readServiceDivergence, type BranchDivergenceStatus } from '../edt/list.js';

export type Probed<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };

export interface DashboardWorkingTree {
  uncommitted: boolean;
  mergeInProgress: boolean;
  rebaseInProgress: boolean;
}

export interface DashboardDivergence {
  status: BranchDivergenceStatus;
  ahead: number | null;
  behind: number | null;
  detail?: { code: string; message: string };
}

export interface DashboardService {
  service: string;
  path: string;
  manifest: Probed<{ sharedBranch: string; protectedBranches: string[] }>;
  container: Probed<HealthState | 'no-container'>;
  branch: string | null;
  divergence: DashboardDivergence;
  workingTree: Probed<DashboardWorkingTree>;
  protectedBranch: boolean;
  // Topics of the other EDTs that own this same repo + branch.
  usedByEdts: string[];
}

export interface DashboardRegistrySummary {
  repoCount: number;
  invalidManifests: number;
  unreachable: number;
  listingIssues: number;
}

export interface DashboardSnapshot {
  status: 'active' | 'no-active-edt';
  edt: { ulid: string; topic: string; serviceCount: number } | null;
  services: DashboardService[];
  registry: DashboardRegistrySummary;
}

export interface BuildDashboardSnapshotParams {
  registry: RegistryPort;
  manifest: ManifestPort;
  git: GitPort;
  docker: DockerPort;
  edtRegistry: EdtRegistryPort;
  state: StatePort;
}

export async function buildDashboardSnapshot(params: BuildDashboardSnapshotParams): Promise<Result<DashboardSnapshot>> {
  const { registry, manifest, edtRegistry, state } = params;

  const registered = await registry.list();
  if (!registered.ok) {
    return registered;
  }
  const activeUlid = await state.readActiveEdt();
  if (!activeUlid.ok) {
    return activeUlid;
  }
  const edts = await edtRegistry.list();
  if (!edts.ok) {
    return edts;
  }

  const summary = await summarizeRegistry(registry, manifest, registered.data);
  const active = activeUlid.data === null ? undefined : edts.data.find((entry) => entry.ulid === activeUlid.data);
  if (active === undefined) {
    return ok({ status: 'no-active-edt', edt: null, services: [], registry: summary });
  }

  const services = await Promise.all(active.members.map((member) => readService(params, member, edts.data, active.ulid)));
  return ok({
    status: 'active',
    edt: { ulid: active.ulid, topic: active.topic, serviceCount: services.length },
    services,
    registry: summary,
  });
}

async function summarizeRegistry(
  registry: RegistryPort,
  manifest: ManifestPort,
  paths: string[],
): Promise<DashboardRegistrySummary> {
  const summary: DashboardRegistrySummary = { repoCount: paths.length, invalidManifests: 0, unreachable: 0, listingIssues: 0 };
  await Promise.all(
    paths.map(async (path) => {
      const exists = await registry.exists(path);
      if (!exists.ok) {
        summary.listingIssues += 1;
        return;
      }
      if (!exists.data) {
        summary.unreachable += 1;
        return;
      }
      const loaded = await manifest.load(path);
      // manifest-not-found is an unmanaged path, not an invalid manifest.
      if (!loaded.ok && loaded.error.code !== 'manifest-not-found') {
        summary.invalidManifests += 1;
      }
    }),
  );
  return summary;
}

async function readService(
  params: BuildDashboardSnapshotParams,
  member: EdtMember,
  edts: EdtRegistryEntry[],
  activeUlid: string,
): Promise<DashboardService> {
  const { manifest, git, docker } = params;
  const path = resolve(member.repoPath);

  const loaded = await manifest.load(path);
  const manifestState: DashboardService['manifest'] = loaded.ok
    ? { ok: true, value: { sharedBranch: loaded.data.sharedBranch, protectedBranches: loaded.data.protectedBranches ?? [] } }
    : { ok: false, error: { code: loaded.error.code, message: loaded.error.message } };

  const [container, divergence, workingTree] = await Promise.all([
    readContainer(docker, loaded.ok ? loaded.data : null, loaded.ok ? null : loaded.error),
    readServiceDivergence(git, member.service, path, true, loaded.ok ? loaded.data.sharedBranch : '', loaded.ok ? (loaded.data.protectedBranches ?? []) : []),
    readWorkingTree(git, path),
  ]);

  return {
    service: loaded.ok ? loaded.data.service : member.service,
    path,
    manifest: manifestState,
    container,
    branch: divergence.branch,
    divergence: {
      status: divergence.status,
      ahead: divergence.ahead,
      behind: divergence.behind,
      ...(divergence.detail === undefined ? {} : { detail: divergence.detail }),
    },
    workingTree,
    protectedBranch: loaded.ok && divergence.branch !== null && isProtectedBranch(divergence.branch, loaded.data),
    usedByEdts:
      divergence.branch === null
        ? []
        : edts
            .filter(
              (entry) =>
                entry.ulid !== activeUlid &&
                entry.members.some((other) => resolve(other.repoPath) === path && other.branch === divergence.branch),
            )
            .map((entry) => entry.topic),
  };
}

async function readContainer(
  docker: DockerPort,
  manifest: Manifest | null,
  manifestError: { code: string; message: string } | null,
): Promise<DashboardService['container']> {
  if (manifest === null) {
    return { ok: false, error: { code: manifestError?.code ?? 'manifest-error', message: manifestError?.message ?? 'manifest unavailable' } };
  }
  const container = manifest.container?.trim() ?? '';
  if (container === '') {
    return { ok: true, value: 'no-container' };
  }
  const health = await getServiceHealth({ docker, container });
  return health.ok ? { ok: true, value: health.data } : { ok: false, error: { code: health.error.code, message: health.error.message } };
}

async function readWorkingTree(git: GitPort, path: string): Promise<Probed<DashboardWorkingTree>> {
  const [uncommitted, merge, rebase] = await Promise.all([
    git.hasUncommittedChanges(path),
    git.isMergeInProgress(path),
    git.isRebaseInProgress(path),
  ]);
  if (!uncommitted.ok) {
    return probeError(uncommitted.error);
  }
  if (!merge.ok) {
    return probeError(merge.error);
  }
  if (!rebase.ok) {
    return probeError(rebase.error);
  }
  return { ok: true, value: { uncommitted: uncommitted.data, mergeInProgress: merge.data, rebaseInProgress: rebase.data } };
}

function probeError(error: { code: string; message: string }): { ok: false; error: { code: string; message: string } } {
  return { ok: false, error: { code: error.code, message: error.message } };
}
