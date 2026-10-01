// core/scripts/reset: unit tests against a fake RegistryPort and fake LockPort (AD-13).
// The adapter's real backup/re-init behavior is covered in adapters/driven/registry/index
// .test.ts; the real mkdir lock's cross-process behavior in adapters/driven/lock/index.test.ts.
import { describe, expect, it, vi } from 'vitest';
import { ok, err, type Result } from '../result.js';
import type { ResetResult, RegistryPort } from '../ports/registry.js';
import type { LockPort, LockHandle } from '../ports/lock.js';
import { resetRepo } from './reset.js';

const RESOURCE_KEY = '/cfg/registry.yaml';

interface FakeRegistry {
  port: RegistryPort;
  reset: ReturnType<typeof vi.fn>;
}

function fakeRegistry(options: { reset?: () => Promise<Result<ResetResult>> } = {}): FakeRegistry {
  const reset = vi.fn<(path: string) => Promise<Result<ResetResult>>>();
  reset.mockImplementation(options.reset ?? (async () => ok({ path: '/abs/repo', backupPath: null })));
  const port: RegistryPort = {
    list: async () => ok([]),
    add: async () => ok(undefined),
    exists: async () => ok(false),
    scan: async () => ok({ candidates: [], skipped: [] }),
    reset: async (path) => reset(path),
    remove: async () => ok(undefined),
  };
  return { port, reset };
}

interface FakeLock {
  port: LockPort;
  acquire: ReturnType<typeof vi.fn>;
  releases: Array<ReturnType<typeof vi.fn<() => Promise<Result<void>>>>>;
}

function fakeLock(acquireResult?: ReturnType<typeof ok<string>> | ReturnType<typeof err>): FakeLock {
  const releases: Array<ReturnType<typeof vi.fn<() => Promise<Result<void>>>>> = [];
  const acquire = vi.fn(async (_resourceKey: string) => {
    if (acquireResult !== undefined) {
      return acquireResult;
    }
    const release = vi.fn(async () => ok(undefined));
    releases.push(release);
    const handle: LockHandle = { release };
    return ok(handle);
  });
  return { port: { acquire } as unknown as LockPort, acquire, releases };
}

describe('resetRepo', () => {
  it('rejects a missing argument with missing-argument and usage in the message', async () => {
    const registry = fakeRegistry();
    const lock = fakeLock();

    const result = await resetRepo(registry.port, lock.port, RESOURCE_KEY, undefined);

    expect(result).toMatchObject({ ok: false, error: { code: 'missing-argument' } });
    if (!result.ok) {
      expect(result.error.message).toContain('Usage');
    }
    expect(registry.reset).not.toHaveBeenCalled();
    expect(lock.acquire).not.toHaveBeenCalled();
  });

  it('rejects a relative path with invalid-argument and never calls reset', async () => {
    const registry = fakeRegistry();
    const lock = fakeLock();

    const result = await resetRepo(registry.port, lock.port, RESOURCE_KEY, './relative');

    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
    expect(registry.reset).not.toHaveBeenCalled();
    expect(lock.acquire).not.toHaveBeenCalled();
  });

  it('delegates an absolute path to registry.reset and returns its data', async () => {
    const registry = fakeRegistry({
      reset: async () => ok({ path: '/abs/repo', backupPath: '/cfg/registry.yaml.bak-1' }),
    });
    const lock = fakeLock();

    const result = await resetRepo(registry.port, lock.port, RESOURCE_KEY, '/abs/repo/');

    expect(registry.reset).toHaveBeenCalledWith('/abs/repo');
    expect(result).toEqual({
      ok: true,
      data: { path: '/abs/repo', backupPath: '/cfg/registry.yaml.bak-1' },
    });
  });

  it('propagates a registry-not-corrupt refusal without masking it', async () => {
    const registry = fakeRegistry({ reset: async () => err('registry-not-corrupt', 'nothing to reset') });
    const lock = fakeLock();

    const result = await resetRepo(registry.port, lock.port, RESOURCE_KEY, '/abs/repo');

    expect(result).toMatchObject({ ok: false, error: { code: 'registry-not-corrupt' } });
  });

  it('acquires the lock on the resource key before reset and releases after success', async () => {
    const registry = fakeRegistry();
    const lock = fakeLock();

    const result = await resetRepo(registry.port, lock.port, RESOURCE_KEY, '/abs/repo');

    expect(result).toEqual({ ok: true, data: { path: '/abs/repo', backupPath: null } });
    expect(lock.acquire).toHaveBeenCalledWith(RESOURCE_KEY);
    expect(lock.releases).toHaveLength(1);
    expect(lock.acquire.mock.invocationCallOrder[0]).toBeLessThan(registry.reset.mock.invocationCallOrder[0]);
    expect(lock.releases[0].mock.invocationCallOrder[0]).toBeGreaterThan(registry.reset.mock.invocationCallOrder[0]);
  });

  it('still releases the lock when reset fails, and propagates the reset error', async () => {
    const registry = fakeRegistry({ reset: async () => err('registry-write-error', 'disk full') });
    const lock = fakeLock();

    const result = await resetRepo(registry.port, lock.port, RESOURCE_KEY, '/abs/repo');

    expect(result).toMatchObject({ ok: false, error: { code: 'registry-write-error' } });
    expect(lock.acquire).toHaveBeenCalledWith(RESOURCE_KEY);
    expect(lock.releases).toHaveLength(1);
  });

  it('returns the lock acquire failure and never calls reset', async () => {
    const registry = fakeRegistry();
    const lock = fakeLock(err('action-in-progress', 'already running'));

    const result = await resetRepo(registry.port, lock.port, RESOURCE_KEY, '/abs/repo');

    expect(result).toMatchObject({ ok: false, error: { code: 'action-in-progress' } });
    expect(registry.reset).not.toHaveBeenCalled();
    expect(lock.releases).toHaveLength(0);
  });
});
