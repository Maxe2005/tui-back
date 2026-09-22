// core/ports/registry: the managed-repo path registry port (AD-6). Core use-cases
// consume a Registry without ever importing the driven registry adapter (AD-1); the
// adapter owns the filesystem — where registry.yaml lives, how it's walked, and the
// existence probe that distinguishes an unreachable path from an unmanaged one.
import type { Result } from '../result.js';

export interface RegistryPort {
  list(): Promise<Result<string[]>>;
  add(path: string): Promise<Result<void>>;
  exists(path: string): Promise<Result<boolean>>;
  scan(root: string): Promise<Result<ScanResult>>;
  reset(path: string): Promise<Result<ResetResult>>;
  // Story 2.33: targeted read-modify-write removal of a single registered path — the
  // counterpart `add` never had. Unlike `reset` (whole-file replace, corrupt-registry
  // recovery only, refuses to touch a healthy file), `remove` never inspects file health and
  // never touches any path but the one given. Removing a path that isn't currently
  // registered is a no-op success, mirroring `add`'s own already-registered no-op (FR-1).
  remove(path: string): Promise<Result<void>>;
}

export interface ScanResult {
  candidates: string[];
  skipped: string[];
}

export interface ResetResult {
  path: string;
  backupPath: string | null;
}
