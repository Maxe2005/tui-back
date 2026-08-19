// core/ports/lock: the per-resource advisory action-lock contract (AD-9). Core use-cases
// hold a short-lived lock scoped to the resource they write (for register/reset, the
// registry.yaml file) so concurrent tool processes are serialized instead of racing a
// read-modify-write. Core never touches fs (AD-1): it only declares the contract and
// consumes it through withActionLock (../locking.ts); the driven `lock` adapter owns the
// cross-process file mechanics (mkdir). The resourceKey is an opaque caller-derived string
// (e.g. the absolute registry file path for Story 1.7, an EDT id or repo path in later epics).
//
// Story 2.4: `peek` is a non-blocking, stat-only liveness check (no retry/wait, never
// acquires) — the EDT-switch use-case's "is an action in progress on the outgoing EDT"
// gate. `edt:<ulid>` is the resource-key convention this story sets for that purpose;
// nothing acquires it yet (Epic 3+ group updates are expected to).
import type { Result } from '../result.js';

export interface LockHandle {
  release(): Promise<Result<void>>;
}

export interface LockPort {
  acquire(resourceKey: string): Promise<Result<LockHandle>>;
  // Non-blocking peek: reports whether resourceKey is currently held by a live process,
  // without acquiring it and without the retry/wait/reclaim machinery acquire() uses. A
  // stale holder (recorded pid no longer alive, or an orphaned/aged lock dir) reads as
  // not-locked, mirroring acquire()'s own staleness rule.
  peek(resourceKey: string): Promise<Result<{ locked: boolean }>>;
}
