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
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { err, ok, type Result } from '../../../core/result.js';
import type { LockHandle, LockPort } from '../../../core/ports/lock.js';

import { isPidAlive, lockPathFor, sleep } from './helpers.js';

export interface LockOptions {
  retryDelayMs?: number;
  timeoutMs?: number;
}

const OWNER_FILE = 'owner.json';

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
    await writeFile(join(lockPath, OWNER_FILE), JSON.stringify({ pid: holderPid, timestamp: Date.now() }), 'utf8');
    return ok(undefined);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return err('lock-held', 'lock already held');
    }
    const detail = error instanceof Error ? error.message : String(error);
    return err('lock-acquire-error', `Failed to acquire lock at ${lockPath}: ${detail}`);
  }
}

async function isStale(lockPath: string): Promise<boolean> {
  const raw = await readFile(join(lockPath, OWNER_FILE), 'utf8').catch(() => null);
  if (raw === null) {
    // Owner metadata not written yet — the winner just claimed the dir. Can't prove dead, so
    // treat as live (wait) rather than reclaiming a lock that is about to be finalized.
    return false;
  }
  let pid: number;
  try {
    pid = (JSON.parse(raw) as { pid: number }).pid;
  } catch {
    return false;
  }
  return !isPidAlive(pid);
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

async function reclaim(lockPath: string): Promise<void> {
  await rm(lockPath, { recursive: true, force: true });
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
