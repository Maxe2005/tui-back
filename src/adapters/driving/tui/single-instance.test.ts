import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { acquireTuiLock } from './single-instance.js';

describe('single-instance lock', () => {
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'tui-back-test-'));
    originalEnv = { ...process.env };
    process.env.XDG_STATE_HOME = tempDir;
  });

  afterEach(() => {
    process.env = originalEnv;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('acquires lock exclusively on first call', async () => {
    const lock = await acquireTuiLock();
    expect(lock).not.toBeNull();
    expect(typeof lock?.release).toBe('function');
    await lock?.release();
  });

  it('returns null when lock already held by live process', async () => {
    const lock1 = await acquireTuiLock();
    expect(lock1).not.toBeNull();

    const lock2 = await acquireTuiLock();
    expect(lock2).toBeNull();

    await lock1?.release();
  });

  it('releases lock and allows new acquisition', async () => {
    const lock1 = await acquireTuiLock();
    expect(lock1).not.toBeNull();
    await lock1?.release();

    const lock2 = await acquireTuiLock();
    expect(lock2).not.toBeNull();
    await lock2?.release();
  });

  it('creates lock file with PID and timestamp', async () => {
    const lock = await acquireTuiLock();
    expect(lock).not.toBeNull();

    const { resolveXdgPaths } = await import('../../driven/xdg/index.js');
    const paths = resolveXdgPaths();
    const lockFile = join(paths.stateDir, 'locks', 'tui.lock');
    expect(existsSync(lockFile)).toBe(true);

    const content = JSON.parse(await import('node:fs').then(fs => fs.promises.readFile(lockFile, 'utf8')));
    expect(content.pid).toBe(process.pid);
    expect(new Date(content.timestamp).getTime()).toBeLessThanOrEqual(Date.now());

    await lock?.release();
  });

  it('auto-reclaims stale lock (dead PID) and acquires lock', async () => {
    const { resolveXdgPaths, ensureXdgDir } = await import('../../driven/xdg/index.js');
    const paths = resolveXdgPaths();
    const lockDir = join(paths.stateDir, 'locks');
    const lockFile = join(lockDir, 'tui.lock');

    ensureXdgDir(lockDir);
    await import('node:fs').then(fs => fs.promises.writeFile(lockFile, JSON.stringify({ pid: 999999, timestamp: new Date().toISOString() }), 'utf8'));

    const lock = await acquireTuiLock();
    expect(lock).not.toBeNull();
    expect(typeof lock?.release).toBe('function');
    await lock?.release();
  });
});