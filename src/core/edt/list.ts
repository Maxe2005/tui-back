// core/edt/list: listEdtBranchesDivergence (FR-9) — every managed repo's current branch and
// ahead/behind divergence from its upstream, uniformly for EDT members and non-members.
// Branch and divergence are read live from git on every call, never cached in the EDT
// registry; the registry only tells which repos belong to the active EDT (isMember).
import { resolve } from 'node:path';
import type { EdtRegistryPort } from '../ports/edt-registry.js';
import type { GitPort } from '../ports/git.js';
import type { ManifestPort } from '../ports/manifest.js';
import type { RegistryPort } from '../ports/registry.js';
import type { StatePort } from '../ports/state.js';
import { ok, type Result } from '../result.js';

// Mirrors GitPort.aheadBehind's Result contract 1:1 (see core/ports/git.ts):
//   'current'          -> upstream resolved; ahead/behind are real counts.
//   'no-upstream'       -> no upstream is configured for the branch at all.
//   'unknown-offline'  -> upstream configured but currently unresolvable, or any other git
//                          read failure (currentBranch included) — never a stale/zero value.
export type BranchDivergenceStatus = 'current' | 'no-upstream' | 'unknown-offline';

export interface ServiceBranchDivergence {
  service: string;
  path: string;
  isMember: boolean;
  // The repo's manifest-declared shared/protected branch, so the EDT zone's base-branch
  // suggestions are manifest-aware instead of a hardcoded 'development'.
  sharedBranch: string;
  // The manifest's protectedBranches (empty when it declares none) — with sharedBranch, the
  // service's full FR-7 protected set for every TUI advisory check.
  protectedBranches: string[];
  // null exactly when status !== 'current' — no numeric value is ever fabricated — including
  // when the branch name itself could not be determined (e.g. detached HEAD), which also folds
  // into 'unknown-offline'.
  branch: string | null;
  ahead: number | null;
  behind: number | null;
  status: BranchDivergenceStatus;
  // Present whenever status !== 'current' and a git error was involved — kept as a
  // structured, one-action-away field (UX-DR17) rather than inlined into a message string.
  detail?: { code: string; message: string };
  // The manifest's `healthUrl`, copied as declared (absent when none) — lets the :settings
  // Services tab tell a toggleable health check from a service that has none.
  healthUrl?: string;
}

export interface BranchDivergenceEntryError {
  path: string;
  code: string;
  message: string;
}

export interface ListEdtBranchesDivergenceData {
  services: ServiceBranchDivergence[];
  unreachable: string[];
  errors: BranchDivergenceEntryError[];
}

export interface ListEdtBranchesDivergenceParams {
  registry: RegistryPort;
  manifest: ManifestPort;
  git: GitPort;
  edtRegistry: EdtRegistryPort;
  state: StatePort;
}

export async function listEdtBranchesDivergence(
  params: ListEdtBranchesDivergenceParams,
): Promise<Result<ListEdtBranchesDivergenceData>> {
  const { registry, manifest, git, edtRegistry, state } = params;

  const registered = await registry.list();
  if (!registered.ok) {
    return registered;
  }

  // Resolve the active EDT's member repo paths (if any EDT is active) purely to compute
  // isMember below — a fresh read every call, per the "no cached upstream/membership" rule.
  const activeUlid = await state.readActiveEdt();
  if (!activeUlid.ok) {
    return activeUlid;
  }

  let activeMemberPaths = new Set<string>();
  if (activeUlid.data !== null) {
    const edts = await edtRegistry.list();
    if (!edts.ok) {
      return edts;
    }
    const active = edts.data.find((candidate) => candidate.ulid === activeUlid.data);
    if (active !== undefined) {
      activeMemberPaths = new Set(active.members.map((member) => resolve(member.repoPath)));
    }
  }

  const services: ServiceBranchDivergence[] = [];
  const unreachable: string[] = [];
  const errors: BranchDivergenceEntryError[] = [];

  for (const rawPath of registered.data) {
    const path = resolve(rawPath);

    const exists = await registry.exists(path);
    if (!exists.ok) {
      errors.push({ path, code: exists.error.code, message: exists.error.message });
      continue;
    }
    if (!exists.data) {
      unreachable.push(path);
      continue;
    }

    const loaded = await manifest.load(path);
    if (!loaded.ok) {
      if (loaded.error.code === 'manifest-not-found') {
        // genuinely unmanaged — silently skipped, same as list-repos
        continue;
      }
      errors.push({ path, code: loaded.error.code, message: loaded.error.message });
      continue;
    }

    const isMember = activeMemberPaths.has(path);
    const divergence = await readServiceDivergence(
      git,
      loaded.data.service,
      path,
      isMember,
      loaded.data.sharedBranch,
      loaded.data.protectedBranches ?? [],
    );
    const { healthUrl } = loaded.data;
    services.push(healthUrl === undefined ? divergence : { ...divergence, healthUrl });
  }

  return ok({ services, unreachable, errors });
}

export async function readServiceDivergence(
  git: GitPort,
  service: string,
  path: string,
  isMember: boolean,
  sharedBranch: string,
  protectedBranches: string[],
): Promise<ServiceBranchDivergence> {
  const branchResult = await git.currentBranch(path);
  if (!branchResult.ok) {
    // A branch that can't even be determined (detached HEAD, corrupt repo, ...) folds into
    // "unknown (offline)" too: every git error is treated uniformly here.
    return {
      service,
      path,
      isMember,
      sharedBranch,
      protectedBranches,
      branch: null,
      ahead: null,
      behind: null,
      status: 'unknown-offline',
      detail: { code: branchResult.error.code, message: branchResult.error.message },
    };
  }
  const branch = branchResult.data;

  const divergence = await git.aheadBehind(path);
  if (divergence.ok) {
    return { service, path, isMember, sharedBranch, protectedBranches, branch, ahead: divergence.data.ahead, behind: divergence.data.behind, status: 'current' };
  }

  if (divergence.error.code === 'no-upstream') {
    return { service, path, isMember, sharedBranch, protectedBranches, branch, ahead: null, behind: null, status: 'no-upstream' };
  }

  return {
    service,
    path,
    isMember,
    sharedBranch,
    protectedBranches,
    branch,
    ahead: null,
    behind: null,
    status: 'unknown-offline',
    detail: { code: divergence.error.code, message: divergence.error.message },
  };
}
