import type { Result } from './result.js';
import type { LockPort } from './ports/lock.js';

/**
 * Runs `work` while holding a short-lived per-resource advisory lock (AD-9). Useful for
 * any state-mutating core use-case: acquire the lock scoped to the resource being written,
 * run the write, and always release in a finally so a leaked lock can never wedge future
 * actions. Pure and fs-free (AD-1) — it only coordinates through the LockPort contract.
 *
 * Failure semantics:
 * - acquire failure surfaces as-is (the lock adapter's error, e.g. the action-in-progress
 *   or lock-acquire-error code) and `work` is never invoked.
 * - a `work` failure propagates unchanged; release is still attempted.
 * - a release failure is a non-fatal diagnostic and is absorbed — it never masks the work
 *   result, whether the work succeeded or failed.
 */
export async function withActionLock<R>(
  lock: LockPort,
  resourceKey: string,
  work: () => Promise<Result<R>>,
): Promise<Result<R>> {
  const acquired = await lock.acquire(resourceKey);
  if (!acquired.ok) {
    return acquired;
  }

  let result: Result<R>;
  try {
    result = await work();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    result = { ok: false, error: { code: 'internal-error', message: detail } };
  } finally {
    await acquired.data.release();
  }

  return result;
}
