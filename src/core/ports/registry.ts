// core/ports/registry: the managed-repo path registry port (AD-6). Core use-cases
// consume a Registry without ever importing the driven registry adapter (AD-1); the
// adapter owns the filesystem — where registry.yaml lives, how it's walked, and the
// existence probe that distinguishes an unreachable path from an unmanaged one.
import type { Result } from '../result.js';

export interface RegistryPort {
  list(): Promise<Result<string[]>>;
  add(path: string): Promise<Result<void>>;
  exists(path: string): Promise<Result<boolean>>;
  scan(root: string): Promise<Result<string[]>>;
}
