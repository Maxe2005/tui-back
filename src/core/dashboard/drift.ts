// core/dashboard/drift: branch drift — whether a repo sits on the branch it should be on (an
// active-EDT member: its EDT branch; any other managed repo: its sharedBranch). Shared by the
// dashboard snapshot and realign; read-only, a failed probe is `unknown`, never a verdict.
import { resolve } from 'node:path';
import type { EdtRegistryPort } from '../ports/edt-registry.js';
import { GIT_DETACHED_HEAD, type GitPort } from '../ports/git.js';
import type { ManifestPort } from '../ports/manifest.js';
import type { RegistryPort } from '../ports/registry.js';
import type { StatePort } from '../ports/state.js';
import { ok, type Result } from '../result.js';

// aligned/drifted compare the current branch with the expected one (a detached HEAD is
// drifted); unknown means the branch could not be read.
export type DriftState = 'aligned' | 'drifted' | 'unknown';

// A registered, managed repo outside the active EDT, judged against its sharedBranch.
export interface DashboardOtherService {
  service: string;
  path: string;
  branch: string | null;
  expectedBranch: string;
  drift: DriftState;
  detail?: { code: string; message: string };
}

export interface DriftCandidate extends DashboardOtherService {
  kind: 'member' | 'other';
}

export interface DriftCandidates {
  // Null when no EDT is active: there is then no drift data at all.
  active: { ulid: string; topic: string } | null;
  members: DriftCandidate[];
  others: DriftCandidate[];
}

export function driftOf(branch: string | null, expectedBranch: string, errorCode: string | null | undefined): DriftState {
  if (branch !== null) {
    return branch === expectedBranch ? 'aligned' : 'drifted';
  }
  return errorCode === GIT_DETACHED_HEAD ? 'drifted' : 'unknown';
}

type OthersDeps = { registry: RegistryPort; manifest: ManifestPort; git: GitPort };

// Registered paths outside the active EDT whose manifest loads; unreachable, unmanaged and
// invalid paths (and a failed registry listing) are left to the registry-health section. A port
// that throws drops only its own row (or every row, for the listing): members never depend on it.
export async function readOthers(params: OthersDeps, memberPaths: Set<string>): Promise<DashboardOtherService[]> {
  const registered = await params.registry.list().catch(() => null);
  if (registered === null || !registered.ok) {
    return [];
  }
  const candidates = [...new Set(registered.data.map((path) => resolve(path)))].filter((path) => !memberPaths.has(path));
  const rows = await Promise.all(candidates.map((path) => readOther(params, path).catch(() => null)));
  return rows.filter((row): row is DashboardOtherService => row !== null);
}

async function readOther(params: OthersDeps, path: string): Promise<DashboardOtherService | null> {
  const exists = await params.registry.exists(path);
  if (!exists.ok || !exists.data) {
    return null;
  }
  const loaded = await params.manifest.load(path);
  if (!loaded.ok) {
    return null;
  }
  const expectedBranch = loaded.data.sharedBranch;
  const branch = await params.git.currentBranch(path);
  if (branch.ok) {
    return { service: loaded.data.service, path, branch: branch.data, expectedBranch, drift: driftOf(branch.data, expectedBranch, null) };
  }
  const detail = { code: branch.error.code, message: branch.error.message };
  return { service: loaded.data.service, path, branch: null, expectedBranch, drift: driftOf(null, expectedBranch, detail.code), detail };
}

async function readMember(git: GitPort, service: string, path: string, expectedBranch: string): Promise<DriftCandidate> {
  let branch: Result<string>;
  try {
    branch = await git.currentBranch(path);
  } catch (error) {
    branch = { ok: false, error: { code: 'git-error', message: error instanceof Error ? error.message : String(error) } };
  }
  if (branch.ok) {
    return { kind: 'member', service, path, branch: branch.data, expectedBranch, drift: driftOf(branch.data, expectedBranch, null) };
  }
  const detail = { code: branch.error.code, message: branch.error.message };
  return { kind: 'member', service, path, branch: null, expectedBranch, drift: driftOf(null, expectedBranch, detail.code), detail };
}

// Every repo realign may act on: the active EDT's members (one current-branch read each, the
// EDT's member name) then the other managed repos, each with its drift.
export async function listDriftCandidates(params: {
  registry: RegistryPort;
  manifest: ManifestPort;
  git: GitPort;
  edtRegistry: EdtRegistryPort;
  state: StatePort;
}): Promise<Result<DriftCandidates>> {
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
    return ok({ active: null, members: [], others: [] });
  }
  const seen = new Set<string>();
  const members = active.members.filter((member) => {
    const path = resolve(member.repoPath);
    if (seen.has(path)) {
      return false;
    }
    seen.add(path);
    return true;
  });
  const [memberRows, others] = await Promise.all([
    Promise.all(members.map((member) => readMember(params.git, member.service, resolve(member.repoPath), member.branch))),
    readOthers(params, seen),
  ]);
  return ok({
    active: { ulid: active.ulid, topic: active.topic },
    members: memberRows,
    others: others.map((other) => ({ ...other, kind: 'other' as const })),
  });
}
