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

export interface EdtRegistryEntry {
  ulid: string;
  topic: string;
  createdAt: string;
  status: string;
  members: EdtMember[];
}

export interface EdtRegistryPort {
  add(entry: EdtRegistryEntry): Promise<Result<void>>;
  list(): Promise<Result<EdtRegistryEntry[]>>;
}
