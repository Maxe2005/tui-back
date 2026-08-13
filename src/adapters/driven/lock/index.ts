// adapters/driven/lock: the driven implementation of core's LockPort (AD-9). A reusable,
// cross-process advisory lock that serializes cooperating tool processes writing the same
// resource, using the atomic mkdir strategy (D-lock-2): mkdir on the lock dir succeeds for
// exactly one process (EEXIST for everyone else) with no filesystem race on networked FS,
// no runtime dependency, and releases by removing the dir. The adapter owns fs/paths (AD-1);
// core only consumes the contract through withActionLock (../locking.ts).
//
// Contention policy (D-lock-3): serialize-with-timeout + reject-on-stale-wait. A waiter busily
// retries (retryDelayMs≈50) up to a deadline (timeoutMs≈5000); if the holder is still alive at
// the deadline it returns an `action-in-progress` Result (never a throw), honouring AC4's
// "serialized or rejected" wording. A holder whose recorded pid is no longer alive is stale and
// is reclaimed so a crashed/killed CLI cannot wedge every future action forever.
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
// milliseconds, so a young orphan must be treated as live (wait) rather than reclaimed.
const ORPHAN_STALE_AGE_MS = 10_000;

export function createLockPort(lockDir: string, options: LockOptions = {}): LockPort {
  const retryDelayMs = options.retryDelayMs ?? 50;
  const timeoutMs = options.timeoutMs ?? 5000;
  const holderPid = process.pid;

  return {
    acquire: (resourceKey) => acquireLock(lockDir, resourceKey, holderPid, { retryDelayMs, timeoutMs }),
  };
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
  if (resourceKey.length === 0) {
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
      await reclaim(lockPath);
      continue;
    }

    if (Date.now() >= deadline) {
      return err(
        'action-in-progress',
        `Action already in progress on resource "${resourceKey}" (lock held by pid ${await ownerPid(lockPath)})`,
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
      const pid = (JSON.parse(raw) as { pid: number }).pid;
      return !isPidAlive(pid);
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

async function reclaim(lockPath: string): Promise<Result<void>> {
  // Verify before removing: between this waiter's staleness check and now, a third process
  // may have reclaimed the dead holder's dir and re-acquired it as a live holder. Removing
  // blindly would delete a live holder's lock and let two writers proceed concurrently —
  // the exact race this lock exists to prevent.
  const currentOwner = await ownerPid(lockPath);
  if (currentOwner !== null && isPidAlive(currentOwner)) {
    return ok(undefined);
  }
  try {
    await rm(lockPath, { recursive: true, force: true });
    return ok(undefined);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return err('lock-acquire-error', `Failed to reclaim stale lock at ${lockPath}: ${detail}`);
  }
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
