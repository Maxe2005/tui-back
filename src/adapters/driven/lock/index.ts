// adapters/driven/lock: the driven implementation of core's LockPort (AD-9) — a cross-process
// advisory lock via atomic mkdir (exactly one process wins, EEXIST for the rest; no runtime
// dependency). A waiter retries until a deadline, then returns `action-in-progress` (never a
// throw). A holder whose recorded pid is dead is stale and reclaimed, so a crashed CLI cannot
// wedge every future action.
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { err, ok, type Result } from '../../../core/result.js';
import type { LockHandle, LockPort } from '../../../core/ports/lock.js';

import { isPidAlive, lockPathFor, sleep } from './helpers.js';

export interface LockOptions {
  retryDelayMs?: number;
  timeoutMs?: number;
}

const OWNER_FILE = 'owner.json';

// An orphan lock dir (no valid owner metadata) is only reclaimable once it is older than
// this threshold: a winner that just claimed the dir is finalizing its owner write within
// milliseconds, so a young orphan must be treated as live (wait) rather than reclaimed. Kept
// below the default acquire timeout (5000ms) so a freshly-crashed holder's orphan is
// reclaimable within a single acquire, while still ≫ the sub-ms owner write.
const ORPHAN_STALE_AGE_MS = 2_000;

// Reclaims among concurrent waiters are serialized through an atomic mkdir "break" marker
// (same strategy as the advisory-lock `.break` pattern): only the waiter that wins the marker
// removes the stale lock dir, and it re-verifies the owner is still dead immediately before
// removing, so a live re-acquired lock is never deleted. The marker records its owning pid so
// a waiter that crashed mid-reclaim can't wedge every future reclaim forever (self-healing).
const RECLAIM_BREAK_SUFFIX = '.break';

export function createLockPort(lockDir: string, options: LockOptions = {}): LockPort {
  const retryDelayMs = options.retryDelayMs ?? 50;
  const timeoutMs = options.timeoutMs ?? 5000;
  const holderPid = process.pid;

  return {
    acquire: (resourceKey) => acquireLock(lockDir, resourceKey, holderPid, { retryDelayMs, timeoutMs }),
    peek: (resourceKey) => peekLock(lockDir, resourceKey),
  };
}

/**
 * Non-blocking, stat-only liveness check: no mkdir, no retry/wait, no reclaim — a pure read.
 * Reuses isStale()'s exact staleness rule (dead recorded pid, or a missing/corrupt owner file
 * old enough that a finalizing winner is out of the question) so peek() and acquire() agree on
 * what counts as "still held". Exported separately (like acquireLock) so tests can drive it.
 */
export async function peekLock(lockDir: string, resourceKey: string): Promise<Result<{ locked: boolean }>> {
  if (resourceKey.trim().length === 0) {
    return err('invalid-argument', 'Resource key must not be empty');
  }

  const lockPath = lockPathFor(lockDir, resourceKey);
  const dirStat = await stat(lockPath).catch(() => null);
  if (dirStat === null) {
    return ok({ locked: false });
  }

  const stale = await isStale(lockPath);
  return ok({ locked: !stale });
}

/**
 * Acquires the lock scoped to a resource key, retrying until the holder is done or the
 * deadline passes. Returns a LockHandle owning release(), or a contention/acquire Result
 * error. Exported separately from createLockPort so tests can drive acquire() directly.
 */
export async function acquireLock(
  lockDir: string,
  resourceKey: string,
  holderPid: number = process.pid,
  options: Required<LockOptions> = { retryDelayMs: 50, timeoutMs: 5000 },
): Promise<Result<LockHandle>> {
  if (resourceKey.trim().length === 0) {
    return err('invalid-argument', 'Resource key must not be empty');
  }

  // The lock dir is created lazily here (adapter owns fs, AD-1) so read-only CLI commands
  // never touch state, and an unwritable state dir surfaces as a Result error, not a throw.
  try {
    await mkdir(lockDir, { recursive: true });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return err('lock-acquire-error', `Failed to create lock directory at ${lockDir}: ${detail}`);
  }

  const lockPath = lockPathFor(lockDir, resourceKey);
  const deadline = Date.now() + options.timeoutMs;

  for (;;) {
    const claimed = await tryClaim(lockPath, holderPid);
    if (claimed.ok) {
      return ok({ release: () => releaseLock(lockPath) });
    }
    if (claimed.error.code !== 'lock-held') {
      return claimed;
    }

    if (await isStale(lockPath)) {
      const reclaimed = await reclaim(lockPath, holderPid);
      if (!reclaimed.ok) {
        return reclaimed;
      }
      continue;
    }

    if (Date.now() >= deadline) {
      return err(
        'action-in-progress',
        `Action already in progress on resource "${resourceKey}" (lock held by pid ${(await ownerPid(lockPath)) ?? 'unknown'})`,
      );
    }

    await sleep(options.retryDelayMs);
  }
}

async function tryClaim(lockPath: string, holderPid: number): Promise<Result<void>> {
  try {
    await mkdir(lockPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return err('lock-held', 'lock already held');
    }
    const detail = error instanceof Error ? error.message : String(error);
    return err('lock-acquire-error', `Failed to acquire lock at ${lockPath}: ${detail}`);
  }

  try {
    await writeFile(join(lockPath, OWNER_FILE), JSON.stringify({ pid: holderPid, timestamp: Date.now() }), 'utf8');
    return ok(undefined);
  } catch (error) {
    // A dir claimed but never finalized (owner write failed) would otherwise wedge the
    // resource forever — isStale treats a missing owner as live. Remove it so a retry can
    // reclaim cleanly.
    await rm(lockPath, { recursive: true, force: true }).catch(() => undefined);
    const detail = error instanceof Error ? error.message : String(error);
    return err('lock-acquire-error', `Failed to acquire lock at ${lockPath}: ${detail}`);
  }
}

async function isStale(lockPath: string): Promise<boolean> {
  const raw = await readFile(join(lockPath, OWNER_FILE), 'utf8').catch(() => null);
  if (raw !== null) {
    try {
      const pid = (JSON.parse(raw) as { pid?: unknown }).pid;
      if (typeof pid === 'number' && Number.isInteger(pid)) {
        return !isPidAlive(pid);
      }
      // Owner metadata that parses but carries no usable pid (e.g. `{}` or
      // `{"timestamp":...}`) is not proof of a dead holder — fall through to the age check.
    } catch {
      // corrupt owner metadata — fall through to the age check
    }
  }

  // Owner metadata missing (a winner still finalizing, or a holder that crashed between
  // mkdir and the owner write) or unparsable. Can't prove dead from the pid, so reclaim
  // only once the dir is old enough that a slow finalizer is out of the question.
  const dirStat = await stat(lockPath).catch(() => null);
  if (dirStat === null) {
    return false;
  }
  return Date.now() - dirStat.mtimeMs > ORPHAN_STALE_AGE_MS;
}

async function ownerPid(lockPath: string): Promise<number | null> {
  const raw = await readFile(join(lockPath, OWNER_FILE), 'utf8').catch(() => null);
  if (raw === null) {
    return null;
  }
  try {
    return (JSON.parse(raw) as { pid: number }).pid;
  } catch {
    return null;
  }
}

function breakPathOf(lockPath: string): string {
  return `${lockPath}${RECLAIM_BREAK_SUFFIX}`;
}

/**
 * Serialized reclaim of a stale lock dir. A caller enters only after `isStale` returned true.
 * The reclaim itself is serialized through an atomic mkdir break marker (see RECLAIM_BREAK_SUFFIX)
 * so that among concurrent waiters exactly one removes the stale dir, and it re-verifies the
 * owner is still dead immediately before removing — closing the check-then-act window where a
 * blindly-removing waiter could delete a live re-acquired lock and let two writers proceed.
 * Exported for deterministic tests of the live-owner guard branch.
 */
export async function reclaim(lockPath: string, holderPid: number): Promise<Result<void>> {
  const breakPath = breakPathOf(lockPath);

  try {
    await mkdir(breakPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') {
      if (await breakIsStale(breakPath)) {
        // The previous reclaim's owner is gone (crashed mid-reclaim); clear the marker and
        // retry once so a dead breaker can't wedge every future reclaim forever.
        await rm(breakPath, { recursive: true, force: true }).catch(() => undefined);
        try {
          await mkdir(breakPath);
        } catch (retryError) {
          if ((retryError as NodeJS.ErrnoException).code === 'EEXIST') {
            return ok(undefined);
          }
          const detail = retryError instanceof Error ? retryError.message : String(retryError);
          return err('lock-acquire-error', `Failed to start reclaim at ${breakPath}: ${detail}`);
        }
      } else {
        // Another waiter is actively reclaiming; their rm + release is imminent, so just wait.
        return ok(undefined);
      }
    } else {
      const detail = error instanceof Error ? error.message : String(error);
      return err('lock-acquire-error', `Failed to start reclaim at ${breakPath}: ${detail}`);
    }
  }

  try {
    await writeFile(join(breakPath, OWNER_FILE), JSON.stringify({ pid: holderPid, timestamp: Date.now() }), 'utf8');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return err('lock-acquire-error', `Failed to record reclaim at ${breakPath}: ${detail}`);
  }

  try {
    // Re-verify after winning the marker: between this waiter's staleness read and the marker
    // acquire, a fresh holder may have reclaimed and re-acquired the lock. Removing a live
    // holder's dir would let two writers proceed — the race this serialized reclaim prevents.
    const currentOwner = await ownerPid(lockPath);
    if (currentOwner !== null && isPidAlive(currentOwner)) {
      return ok(undefined);
    }
    await rm(lockPath, { recursive: true, force: true });
    return ok(undefined);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return err('lock-acquire-error', `Failed to reclaim stale lock at ${lockPath}: ${detail}`);
  } finally {
    await rm(breakPath, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function breakIsStale(breakPath: string): Promise<boolean> {
  const raw = await readFile(join(breakPath, OWNER_FILE), 'utf8').catch(() => null);
  if (raw !== null) {
    try {
      const pid = (JSON.parse(raw) as { pid?: unknown }).pid;
      if (typeof pid === 'number' && Number.isInteger(pid)) {
        return !isPidAlive(pid);
      }
    } catch {
      // fall through to the age check
    }
  }
  const dirStat = await stat(breakPath).catch(() => null);
  if (dirStat === null) {
    return true;
  }
  return Date.now() - dirStat.mtimeMs > ORPHAN_STALE_AGE_MS;
}

export async function releaseLock(lockPath: string): Promise<Result<void>> {
  try {
    await rm(lockPath, { recursive: true, force: true });
    return ok(undefined);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return err('lock-release-error', `Failed to release lock at ${lockPath}: ${detail}`);
  }
}
