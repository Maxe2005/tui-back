// core/ports/edt-registry: the EDT registry port. Tracks created EDTs (ulid, topic,
// creation time, status, per-member branches) in their own registry, separate from
// RegistryPort's managed-repo path list (AD-6) — an EDT entry isn't a repo path, so
// overloading registry.yaml's { repos: string[] } shape would be the wrong fit. Story 2.2
// evolves the entry shape in place (AD-7): the 2.1 single `branch` placeholder is replaced
// by `topic` + per-member `members: [{ service, repoPath, branch }]`. Each member records
// the branch that member service is on for this EDT — created branches become the member's
// registered EDT branch, feeding Story 2.6's per-EDT divergence view. Core consumes this
// port without ever importing the driven adapter that persists it (AD-1).
import type { Result } from '../result.js';

export interface EdtMember {
  service: string;
  repoPath: string;
  branch: string;
}

// Story 2.4 (review patch): a bare `string` status let a typo compile and persist silently,
// including breaking switchActiveEdt's own exact-string comparisons (`status === 'interrupted'`).
export type EdtStatus = 'active' | 'inactive' | 'interrupted';

export interface EdtRegistryEntry {
  ulid: string;
  topic: string;
  createdAt: string;
  status: EdtStatus;
  members: EdtMember[];
}

export interface EdtRegistryPort {
  add(entry: EdtRegistryEntry): Promise<Result<void>>;
  list(): Promise<Result<EdtRegistryEntry[]>>;
  // Story 2.4: updates one entry's status field in place (read/find/replace/write). Used by
  // switchActiveEdt to flip the outgoing EDT to 'inactive' (or 'interrupted' under --force
  // past a held lock) and the target EDT to 'active'. Fails with edt-not-found if ulid isn't
  // registered.
  setStatus(ulid: string, status: EdtStatus): Promise<Result<void>>;
}
