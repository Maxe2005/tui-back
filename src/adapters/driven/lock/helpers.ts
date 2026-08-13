// adapters/driven/lock/helpers: small shared helpers for the mkdir-based lock adapter.
// sanitizeResourceKey derives a safe, readable filesystem name from an opaque resource key
// (e.g. an absolute registry path) so the lock dir path cannot escape the lockDir; isPidAlive
// probes a recorded holder's liveness for stale-lock reclaim; sleep is a bare promise delay.
import { join } from 'node:path';

export function sanitizeResourceKey(resourceKey: string): string {
  return resourceKey.replace(/[^A-Za-z0-9._-]/g, '_');
}

export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  if (pid === process.pid) {
    return true;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Re-exported for callers that derive a lock path from a resource key (composition root).
export function lockPathFor(lockDir: string, resourceKey: string): string {
  return join(lockDir, `${sanitizeResourceKey(resourceKey)}.lock`);
}
