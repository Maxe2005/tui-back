import { mkdirSync, existsSync, readFileSync, writeFileSync, unlinkSync, openSync, closeSync, constants } from 'node:fs';
import { resolveXdgPaths, ensureXdgDir } from '../../driven/xdg/index.js';

const LOCK_DIR_NAME = 'locks';
const LOCK_FILE_NAME = 'tui.lock';

interface LockContent {
  pid: number;
  timestamp: string;
}

export async function acquireTuiLock(): Promise<{ release: () => Promise<void> } | null> {
  const paths = resolveXdgPaths();
  const lockDir = `${paths.stateDir}/${LOCK_DIR_NAME}`;
  const lockFile = `${lockDir}/${LOCK_FILE_NAME}`;

  ensureXdgDir(lockDir);

  try {
    const fd = openSync(lockFile, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    const content: LockContent = {
      pid: process.pid,
      timestamp: new Date().toISOString(),
    };
    try {
      writeFileSync(fd, JSON.stringify(content), 'utf8');
    } finally {
      closeSync(fd);
    }

    return {
      release: async () => {
        try {
          unlinkSync(lockFile);
        } catch {
          // Ignore release errors
        }
      },
    };
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
      const existingLock = readLockFile(lockFile);
      if (!existingLock) {
        return null;
      }
      if (isPidAlive(existingLock.pid)) {
        return null;
      }
      // AC1: stale lock (dead PID) → auto-reclaim and proceed
      try {
        unlinkSync(lockFile);
      } catch {
        // Ignore: lock file may already be gone
      }
      // Recursively try to acquire the lock (will succeed since we removed the stale lock)
      return await acquireTuiLock();
    }
    throw error;
  }
}

export function readLockFile(lockFile: string): LockContent | null {
  try {
    const content = readFileSync(lockFile, 'utf8');
    return JSON.parse(content) as LockContent;
  } catch {
    return null;
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}