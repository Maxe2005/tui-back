// adapters/driven/lock: integration tests against real temp dirs (AD-13). Drive the
// mkdir-based cross-process lock directly (acquireLock with short timeouts) so contention,
// stale-holder reclaim, and release semantics are deterministic without hitting real
// 5s waits.
import { afterEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { acquireLock, createLockPort, releaseLock } from './index.js';
import { lockPathFor } from './helpers.js';

const tmpDirs: string[] = [];

async function makeLockDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tui-back-lock-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

const SHORT: { retryDelayMs: number; timeoutMs: number } = { retryDelayMs: 5, timeoutMs: 100 };

describe('createLockPort / acquireLock (mkdir advisory lock)', () => {
  it('acquire/release round-trips and removes the lock dir', async () => {
    const lockDir = await makeLockDir();
    const key = '/abs/registry.yaml';
    const lockPath = lockPathFor(lockDir, key);

    const handle = await acquireLock(lockDir, key, process.pid, SHORT);
    expect(handle.ok).toBe(true);
    if (handle.ok) {
      const owner = JSON.parse(await readFile(join(lockPath, 'owner.json'), 'utf8')) as { pid: number };
      expect(owner.pid).toBe(process.pid);
      await expect(handle.data.release()).resolves.toEqual({ ok: true, data: undefined });
    }
    await expect(readFile(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('two sequential actions do not interfere (first releases before second)', async () => {
    const lockDir = await makeLockDir();
    const key = '/abs/registry.yaml';

    const first = await acquireLock(lockDir, key, process.pid, SHORT);
    expect(first.ok).toBe(true);
    if (first.ok) {
      await first.data.release();
    }

    const second = await acquireLock(lockDir, key, process.pid, SHORT);
    expect(second.ok).toBe(true);
    if (second.ok) {
      await second.data.release();
    }
  });

  it('a second acquire while the lock is held by a live process is rejected with action-in-progress', async () => {
    const lockDir = await makeLockDir();
    const key = '/abs/registry.yaml';

    const holder = await acquireLock(lockDir, key, process.pid, SHORT);
    expect(holder.ok).toBe(true);
    if (!holder.ok) return;

    const contended = await acquireLock(lockDir, key, process.pid, SHORT);
    expect(contended).toMatchObject({ ok: false, error: { code: 'action-in-progress' } });

    await holder.data.release();
  });

  it('different resource keys do not contend', async () => {
    const lockDir = await makeLockDir();

    const a = await acquireLock(lockDir, '/a', process.pid, SHORT);
    const b = await acquireLock(lockDir, '/b', process.pid, SHORT);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (a.ok) await a.data.release();
    if (b.ok) await b.data.release();
  });

  it('sanitizes the resource key into a filename and isolates per-resource lock dirs', async () => {
    const lockDir = await makeLockDir();
    const key = '/abs/path with spaces/registry.yaml';
    const lockPath = lockPathFor(lockDir, key);
    const safe = key.replace(/[^A-Za-z0-9._-]/g, '_');
    const hash = createHash('sha256').update(key).digest('hex').slice(0, 8);
    expect(lockPath).toBe(join(lockDir, `${safe}-${hash}.lock`));
  });

  it('distinct keys that sanitize identically still map to distinct lock dirs (no false contention)', async () => {
    const lockDir = await makeLockDir();
    const a = lockPathFor(lockDir, '/cfg/registry.yaml');
    const b = lockPathFor(lockDir, '/cfg_registry.yaml');
    expect(a).not.toBe(b);
  });

  it('rejects an empty resource key instead of locking the shared .lock', async () => {
    const lockDir = await makeLockDir();
    const result = await acquireLock(lockDir, '', process.pid, SHORT);
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
  });

  it('reclaims a stale lock whose recorded pid is no longer alive', async () => {
    const lockDir = await makeLockDir();
    const key = '/abs/registry.yaml';
    const lockPath = lockPathFor(lockDir, key);
    await mkdir(lockPath);
    await writeFile(join(lockPath, 'owner.json'), JSON.stringify({ pid: 99999999, timestamp: Date.now() }), 'utf8');

    const handle = await acquireLock(lockDir, key, process.pid, SHORT);
    expect(handle.ok).toBe(true);
    if (handle.ok) {
      await handle.data.release();
    }
  });

  it('a stale lock does not permanently wedge a later acquire after reclaim', async () => {
    const lockDir = await makeLockDir();
    const key = '/abs/registry.yaml';
    const lockPath = lockPathFor(lockDir, key);
    await mkdir(lockPath);
    await writeFile(join(lockPath, 'owner.json'), JSON.stringify({ pid: 99999999, timestamp: Date.now() }), 'utf8');

    const firstReclaim = await acquireLock(lockDir, key, process.pid, SHORT);
    expect(firstReclaim.ok).toBe(true);
    if (firstReclaim.ok) await firstReclaim.data.release();

    const second = await acquireLock(lockDir, key, process.pid, SHORT);
    expect(second.ok).toBe(true);
    if (second.ok) await second.data.release();
  });

  it('a lock dir without owner metadata (winner still finalizing) is not reclaimed', async () => {
    const lockDir = await makeLockDir();
    const key = '/abs/registry.yaml';
    const lockPath = lockPathFor(lockDir, key);
    await mkdir(lockPath);

    // No owner.json yet — must wait, not reclaim; with a short timeout it is a contention
    // rejection, proving the dir was not treated as stale.
    const contended = await acquireLock(lockDir, key, process.pid, SHORT);
    expect(contended).toMatchObject({ ok: false, error: { code: 'action-in-progress' } });
  });

  it('reclaims an orphan lock dir with no owner metadata once it is old (crashed winner)', async () => {
    const lockDir = await makeLockDir();
    const key = '/abs/registry.yaml';
    const lockPath = lockPathFor(lockDir, key);
    await mkdir(lockPath);
    const old = new Date(Date.now() - 60_000);
    await utimes(lockPath, old, old);

    const handle = await acquireLock(lockDir, key, process.pid, SHORT);
    expect(handle.ok).toBe(true);
    if (handle.ok) {
      await handle.data.release();
    }
  });

  it('reclaims an orphan lock dir with corrupt owner metadata once it is old', async () => {
    const lockDir = await makeLockDir();
    const key = '/abs/registry.yaml';
    const lockPath = lockPathFor(lockDir, key);
    await mkdir(lockPath);
    await writeFile(join(lockPath, 'owner.json'), 'not-json{{{', 'utf8');
    const old = new Date(Date.now() - 60_000);
    await utimes(lockPath, old, old);

    const handle = await acquireLock(lockDir, key, process.pid, SHORT);
    expect(handle.ok).toBe(true);
    if (handle.ok) {
      await handle.data.release();
    }
  });

  it('does not reclaim a lock whose recorded holder is a live process in another pid', async () => {
    const lockDir = await makeLockDir();
    const key = '/abs/registry.yaml';
    const lockPath = lockPathFor(lockDir, key);
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
    await once(child, 'spawn');
    try {
      await mkdir(lockPath);
      await writeFile(join(lockPath, 'owner.json'), JSON.stringify({ pid: child.pid, timestamp: Date.now() }), 'utf8');

      const contended = await acquireLock(lockDir, key, process.pid, SHORT);
      expect(contended).toMatchObject({ ok: false, error: { code: 'action-in-progress' } });
    } finally {
      child.kill('SIGKILL');
      await once(child, 'close');
    }
  });

  it(
    'deterministically serializes a lock held by a real second process',
    async () => {
      const lockDir = await makeLockDir();
      const key = '/abs/registry.yaml';
      const adapterFile = pathToFileURL(fileURLToPath(new URL('./index.ts', import.meta.url))).href;
      const projectRoot = fileURLToPath(new URL('../../../../', import.meta.url));
      const childScript = join(
        await mkdtemp(join(tmpdir(), 'tui-back-lock-child-')),
        'child.mjs',
      );
      tmpDirs.push(childScript);
      await writeFile(
        childScript,
        [
          `const { acquireLock } = await import(${JSON.stringify(adapterFile)});`,
          'const [lockDir, key] = process.argv.slice(2);',
          'const handle = await acquireLock(lockDir, key, process.pid);',
          'if (!handle.ok) { console.error("child acquire failed: " + JSON.stringify(handle)); process.exit(2); }',
          "console.log('LOCKED');",
          'setTimeout(() => {}, 60000);',
        ].join('\n'),
        'utf8',
      );

      const child = spawn(process.execPath, ['--import', 'tsx', childScript, lockDir, key], {
        cwd: projectRoot,
        env: { ...process.env, NODE_OPTIONS: '' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let childOut = '';
      let childErr = '';
      child.stdout.on('data', (chunk) => (childOut += chunk));
      child.stderr.on('data', (chunk) => (childErr += chunk));
      const childClosed = once(child, 'close');
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error(`child never acquired the lock\n--- stdout ---\n${childOut}\n--- stderr ---\n${childErr}`)),
            10_000,
          );
          child.stdout.on('data', () => {
            if (childOut.includes('LOCKED')) {
              clearTimeout(timer);
              resolve();
            }
          });
          child.once('error', reject);
          child.once('close', () => {
            clearTimeout(timer);
            reject(new Error(`child exited before acquiring the lock\n--- stdout ---\n${childOut}\n--- stderr ---\n${childErr}`));
          });
        });

        const contended = await acquireLock(lockDir, key, process.pid, SHORT);
        expect(contended).toMatchObject({ ok: false, error: { code: 'action-in-progress' } });

        child.kill('SIGKILL');
        await childClosed;
        expect(childOut).toContain('LOCKED');

        const reclaimed = await acquireLock(lockDir, key, process.pid, SHORT);
        expect(reclaimed.ok).toBe(true);
        if (reclaimed.ok) {
          await reclaimed.data.release();
        }
      } finally {
        child.kill('SIGKILL');
        await childClosed.catch(() => undefined);
      }
    },
    20_000,
  );

  it('releaseLock on a nonexistent lock is a benign success (idempotent release)', async () => {
    const lockDir = await makeLockDir();
    const result = await releaseLock(lockPathFor(lockDir, '/abs/nothing'));
    expect(result).toEqual({ ok: true, data: undefined });
  });

  it('createLockPort returns a working LockPort abstraction', async () => {
    const lockDir = await makeLockDir();
    const port = createLockPort(lockDir, SHORT);

    const handle = await port.acquire('/abs/registry.yaml');
    expect(handle.ok).toBe(true);
    if (handle.ok) {
      await handle.data.release();
    }
  });
});
