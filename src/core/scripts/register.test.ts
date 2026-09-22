// core/scripts/register: unit tests against a fake RegistryPort and fake LockPort (AD-13).
// The registry adapter's real temp-dir behavior is covered in adapters/driven/registry/index
// .test.ts; the real mkdir lock's cross-process behavior in adapters/driven/lock/index.test.ts.
import { describe, expect, it, vi } from 'vitest';
import { ok, err, type Result } from '../result.js';
import type { RegistryPort } from '../ports/registry.js';
import type { LockPort, LockHandle } from '../ports/lock.js';
import { registerRepo } from './register.js';

const RESOURCE_KEY = '/cfg/registry.yaml';

interface FakeRegistry {
  port: RegistryPort;
  add: ReturnType<typeof vi.fn>;
}

function fakeRegistry(options: { add?: () => Promise<Result<void>> } = {}): FakeRegistry {
  const add = vi.fn<(path: string) => Promise<Result<void>>>();
  add.mockImplementation(options.add ?? (async () => ok(undefined)));
  const port: RegistryPort = {
    list: async () => ok([]),
    add: async (path) => add(path),
    exists: async () => ok(false),
    scan: async () => ok({ candidates: [], skipped: [] }),
    reset: async () => ok({ path: '/x', backupPath: null }),
    remove: async () => ok(undefined),
  };
  return { port, add };
}

interface FakeLock {
  port: LockPort;
  acquire: ReturnType<typeof vi.fn>;
  releases: Array<ReturnType<typeof vi.fn<() => Promise<Result<void>>>>>;
}

function fakeLock(
  acquireResult?: ReturnType<typeof ok<string>> | ReturnType<typeof err>,
  releaseImpl?: () => Promise<Result<void>>,
  acquireThrows?: Error,
): FakeLock {
  const releases: Array<ReturnType<typeof vi.fn<() => Promise<Result<void>>>>> = [];
  const acquire = vi.fn(async (_resourceKey: string) => {
    if (acquireThrows !== undefined) {
      throw acquireThrows;
    }
    if (acquireResult !== undefined) {
      return acquireResult;
    }
    const release = vi.fn(async () => {
      if (releaseImpl !== undefined) {
        return releaseImpl();
      }
      return ok(undefined);
    });
    releases.push(release);
    const handle: LockHandle = { release };
    return ok(handle);
  });
  return { port: { acquire } as unknown as LockPort, acquire, releases };
}

describe('registerRepo', () => {
  it('rejects a missing argument with missing-argument and usage in the message', async () => {
    const registry = fakeRegistry();
    const lock = fakeLock();

    const result = await registerRepo(registry.port, lock.port, RESOURCE_KEY, undefined);

    expect(result).toMatchObject({ ok: false, error: { code: 'missing-argument' } });
    if (!result.ok) {
      expect(result.error.message).toContain('Usage');
    }
    expect(registry.add).not.toHaveBeenCalled();
    expect(lock.acquire).not.toHaveBeenCalled();
  });

  it('rejects a relative path with invalid-argument and never calls add', async () => {
    const registry = fakeRegistry();
    const lock = fakeLock();

    const result = await registerRepo(registry.port, lock.port, RESOURCE_KEY, './relative');

    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
    expect(registry.add).not.toHaveBeenCalled();
    expect(lock.acquire).not.toHaveBeenCalled();
  });

  it('persists an absolute path through registry.add and returns ok with the path', async () => {
    const registry = fakeRegistry();
    const lock = fakeLock();

    const result = await registerRepo(registry.port, lock.port, RESOURCE_KEY, '/abs/repo');

    expect(registry.add).toHaveBeenCalledWith('/abs/repo');
    expect(result).toEqual({ ok: true, data: { path: '/abs/repo' } });
  });

  it('normalizes a trailing-slash path before storing (FR-1 dedupe)', async () => {
    const registry = fakeRegistry();
    const lock = fakeLock();

    const result = await registerRepo(registry.port, lock.port, RESOURCE_KEY, '/abs/repo/');

    expect(registry.add).toHaveBeenCalledWith('/abs/repo');
    expect(result).toEqual({ ok: true, data: { path: '/abs/repo' } });
  });

  it('propagates a registry failure instead of masking it', async () => {
    const registry = fakeRegistry({ add: async () => err('registry-write-error', 'disk full') });
    const lock = fakeLock();

    const result = await registerRepo(registry.port, lock.port, RESOURCE_KEY, '/abs/repo');

    expect(result).toMatchObject({ ok: false, error: { code: 'registry-write-error' } });
  });

  it('acquires the lock on the resource key before add and releases after success', async () => {
    const registry = fakeRegistry();
    const lock = fakeLock();

    const result = await registerRepo(registry.port, lock.port, RESOURCE_KEY, '/abs/repo');

    expect(result).toEqual({ ok: true, data: { path: '/abs/repo' } });
    expect(lock.acquire).toHaveBeenCalledWith(RESOURCE_KEY);
    expect(lock.releases).toHaveLength(1);
    expect(lock.acquire.mock.invocationCallOrder[0]).toBeLessThan(registry.add.mock.invocationCallOrder[0]);
    expect(lock.releases[0].mock.invocationCallOrder[0]).toBeGreaterThan(registry.add.mock.invocationCallOrder[0]);
  });

  it('still releases the lock when add fails, and propagates the add error', async () => {
    const registry = fakeRegistry({ add: async () => err('registry-write-error', 'disk full') });
    const lock = fakeLock();

    const result = await registerRepo(registry.port, lock.port, RESOURCE_KEY, '/abs/repo');

    expect(result).toMatchObject({ ok: false, error: { code: 'registry-write-error' } });
    expect(lock.acquire).toHaveBeenCalledWith(RESOURCE_KEY);
    expect(lock.releases).toHaveLength(1);
  });

  it('returns the lock acquire failure and never calls add', async () => {
    const registry = fakeRegistry();
    const lock = fakeLock(err('action-in-progress', 'already running'));

    const result = await registerRepo(registry.port, lock.port, RESOURCE_KEY, '/abs/repo');

    expect(result).toMatchObject({ ok: false, error: { code: 'action-in-progress' } });
    expect(registry.add).not.toHaveBeenCalled();
    expect(lock.releases).toHaveLength(0);
  });

  it('absorbs a rejecting release without masking the work result', async () => {
    const registry = fakeRegistry();
    const lock = fakeLock(undefined, async () => {
      throw new Error('release blew up');
    });

    const result = await registerRepo(registry.port, lock.port, RESOURCE_KEY, '/abs/repo');

    expect(result).toEqual({ ok: true, data: { path: '/abs/repo' } });
    expect(registry.add).toHaveBeenCalledWith('/abs/repo');
    expect(lock.releases).toHaveLength(1);
  });

  it('maps a rejecting lock.acquire to internal-error and never calls add or release', async () => {
    const registry = fakeRegistry();
    const lock = fakeLock(undefined, undefined, new Error('adapter blew up'));

    const result = await registerRepo(registry.port, lock.port, RESOURCE_KEY, '/abs/repo');

    expect(result).toMatchObject({ ok: false, error: { code: 'internal-error' } });
    expect(registry.add).not.toHaveBeenCalled();
    expect(lock.releases).toHaveLength(0);
  });

  it('maps a throwing work to internal-error and still releases the lock', async () => {
    const registry = fakeRegistry({ add: async () => {
      throw new Error('registry adapter threw');
    } });
    const lock = fakeLock();

    const result = await registerRepo(registry.port, lock.port, RESOURCE_KEY, '/abs/repo');

    expect(result).toMatchObject({ ok: false, error: { code: 'internal-error' } });
    expect(lock.acquire).toHaveBeenCalledWith(RESOURCE_KEY);
    expect(lock.releases).toHaveLength(1);
  });

  it('absorbs a release that resolves with an error Result without masking the work result', async () => {
    const registry = fakeRegistry();
    const lock = fakeLock(undefined, async () => err('lock-release-error', 'rm failed'));

    const result = await registerRepo(registry.port, lock.port, RESOURCE_KEY, '/abs/repo');

    expect(result).toEqual({ ok: true, data: { path: '/abs/repo' } });
    expect(registry.add).toHaveBeenCalledWith('/abs/repo');
    expect(lock.releases).toHaveLength(1);
  });
});
