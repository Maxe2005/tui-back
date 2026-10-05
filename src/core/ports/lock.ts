// core/ports/lock: the per-resource advisory action-lock contract (AD-9). Core use-cases hold
// a short-lived lock scoped to the resource they write so concurrent tool processes serialize
// instead of racing a read-modify-write; the driven adapter owns the cross-process mechanics.
// resourceKey is an opaque caller-derived string (a file path, or `edt:<ulid>` for an EDT's
// action lock, which switch peeks without acquiring).
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
