// core/ports/edt-registry: the EDT registry port (Story 2.1 Task 2). Tracks created EDTs
// (ulid, registered branch, creation time, status) in their own registry, separate from
// RegistryPort's managed-repo path list (AD-6) — an EDT entry isn't a repo path, so
// overloading registry.yaml's { repos: string[] } shape would be the wrong fit. Core
// consumes this port without ever importing the driven adapter that persists it (AD-1).
import type { Result } from '../result.js';

export interface EdtRegistryEntry {
  ulid: string;
  branch: string;
  createdAt: string;
  status: string;
}

export interface EdtRegistryPort {
  add(entry: EdtRegistryEntry): Promise<Result<void>>;
}
