// core/ports/lock: the per-resource advisory action-lock contract (AD-9). Core use-cases
// hold a short-lived lock scoped to the resource they write (for register/reset, the
// registry.yaml file) so concurrent tool processes are serialized instead of racing a
// read-modify-write. Core never touches fs (AD-1): it only declares the contract and
// consumes it through withActionLock (../locking.ts); the driven `lock` adapter owns the
// cross-process file mechanics (mkdir). The resourceKey is an opaque caller-derived string
// (e.g. the absolute registry file path for Story 1.7, an EDT id or repo path in later epics).
import type { Result } from '../result.js';

export interface LockHandle {
  release(): Promise<Result<void>>;
}

export interface LockPort {
  acquire(resourceKey: string): Promise<Result<LockHandle>>;
}
