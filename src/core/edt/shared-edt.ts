// core/edt/shared-edt: the pure model of the preconfigured "Shared branches" EDT (FR-53, AD-27).
// It is a system entry synthesized in memory from the managed repos and their manifests — never
// persisted to edts.yaml — whose members are every managed repo on its manifest `sharedBranch`.
// It is recognized by `kind` (and, defensively, its constant ulid), never by topic alone.
import type { EdtMember, EdtRegistryEntry } from '../ports/edt-registry.js';
import type { Manifest } from '../ports/manifest.js';

// A valid 26-char Crockford ULID shape (no I, L, O, U), constant so the active-EDT pointer and
// the per-EDT action log can name the system EDT across runs.
export const SHARED_EDT_ULID = '01SHAREDBRANCHES0000000000';
export const SHARED_EDT_TOPIC = 'Shared branches';
export const SHARED_EDT_KIND = 'system-shared' as const;

export interface SharedEdtRepo {
  repoPath: string;
  manifest: Pick<Manifest, 'service' | 'sharedBranch'>;
}

// The system EDT is never "created" by a developer, so its creation time is a fixed epoch.
const SHARED_EDT_CREATED_AT = '1970-01-01T00:00:00.000Z';

// Builds the entry from already-loaded repos (registry order preserved). A repo whose manifest
// could not be loaded is simply not passed in by the caller.
export function buildSharedBranchesEdt(repos: readonly SharedEdtRepo[]): EdtRegistryEntry {
  const members: EdtMember[] = repos.map((repo) => ({
    service: repo.manifest.service,
    repoPath: repo.repoPath,
    branch: repo.manifest.sharedBranch,
  }));
  return {
    ulid: SHARED_EDT_ULID,
    topic: SHARED_EDT_TOPIC,
    createdAt: SHARED_EDT_CREATED_AT,
    status: 'inactive',
    members,
    kind: SHARED_EDT_KIND,
  };
}

// True for the synthesized entry (by kind, or by its constant ulid for a bare ulid string).
export function isSystemEdt(edt: { kind?: string; ulid?: string } | string | null | undefined): boolean {
  if (edt === null || edt === undefined) {
    return false;
  }
  if (typeof edt === 'string') {
    return edt === SHARED_EDT_ULID;
  }
  return edt.kind === SHARED_EDT_KIND || edt.ulid === SHARED_EDT_ULID;
}

// True when `topic` names the system EDT (trimmed, case-insensitive) — the creation guard.
export function isSharedEdtTopic(topic: string): boolean {
  return topic.trim().toLowerCase() === SHARED_EDT_TOPIC.toLowerCase();
}
