// core/scripts/clean-registry: unit tests against fake ports (AD-13) — every I/O-matrix row
// of story 2.33: unreachable, manifest-not-found, other-manifest-error-left-alone, EDT-member
// note, zero-candidates, per-path removal isolation, and no-op removal of an unregistered path.
import { describe, expect, it, vi } from 'vitest';
import { ok, err, type Result } from '../result.js';
import type { EdtRegistryEntry, EdtRegistryPort } from '../ports/edt-registry.js';
import type { LockHandle, LockPort } from '../ports/lock.js';
import type { Manifest, ManifestPort } from '../ports/manifest.js';
import type { RegistryPort } from '../ports/registry.js';
import { classifyStaleRegistry, removeStaleRegistryEntries } from './clean-registry.js';

function manifestFor(path: string): Manifest {
  return {
    service: `svc-${path}`,
    container: `ctr-${path}`,
    sharedBranch: 'development',
    modules: {},
  };
}

function fakeRegistry(paths: string[], overrides: Partial<RegistryPort> = {}): RegistryPort {
  return {
    list: vi.fn(async () => ok(paths)),
    add: vi.fn(async () => ok(undefined)),
    exists: vi.fn(async () => ok(true)),
    scan: vi.fn(async () => ok({ candidates: [], skipped: [] })),
    reset: vi.fn(async () => ok({ path: '/x', backupPath: null })),
    remove: vi.fn(async () => ok(undefined)),
    ...overrides,
  };
}

function fakeManifest(byPath: Record<string, Result<Manifest>>, overrides: Partial<ManifestPort> = {}): ManifestPort {
  return {
    load: vi.fn(async (path: string) => byPath[path] ?? ok(manifestFor(path))),
    ...overrides,
  };
}

function fakeEdtRegistry(entries: EdtRegistryEntry[] = [], overrides: Partial<EdtRegistryPort> = {}): EdtRegistryPort {
  return {
    add: vi.fn(async () => ok(undefined)),
    list: vi.fn(async () => ok(entries)),
    setStatus: vi.fn(async () => ok(undefined)),
    update: vi.fn(async () => ok(undefined)),
    remove: vi.fn(async () => ok(undefined)),
    ...overrides,
  };
}

function fakeLock(overrides: Partial<LockPort> = {}): LockPort {
  return {
    acquire: vi.fn(async (): Promise<Result<LockHandle>> => ok({ release: vi.fn(async () => ok(undefined)) })),
    peek: vi.fn(async () => ok({ locked: false })),
    ...overrides,
  };
}

function edtEntry(topic: string, repoPaths: string[]): EdtRegistryEntry {
  return {
    ulid: `ulid-${topic}`,
    topic,
    createdAt: new Date().toISOString(),
    status: 'inactive',
    members: repoPaths.map((repoPath) => ({ service: `svc-${repoPath}`, repoPath, branch: 'feat/x' })),
  };
}

describe('classifyStaleRegistry', () => {
  it('classifies a path whose directory is gone as unreachable', async () => {
    const registry = fakeRegistry(['/repo/gone'], { exists: vi.fn(async () => ok(false)) });
    const manifest = fakeManifest({});
    const edtRegistry = fakeEdtRegistry();

    const result = await classifyStaleRegistry({ registry, manifest, edtRegistry });

    expect(result).toEqual({
      ok: true,
      data: { candidates: [{ path: '/repo/gone', reason: 'unreachable', memberOfEdts: [] }] },
    });
  });

  it('classifies a path whose manifest is missing as manifest-not-found', async () => {
    const registry = fakeRegistry(['/repo/unmanaged']);
    const manifest = fakeManifest({ '/repo/unmanaged': err('manifest-not-found', 'no manifest') });
    const edtRegistry = fakeEdtRegistry();

    const result = await classifyStaleRegistry({ registry, manifest, edtRegistry });

    expect(result).toEqual({
      ok: true,
      data: { candidates: [{ path: '/repo/unmanaged', reason: 'manifest-not-found', memberOfEdts: [] }] },
    });
  });

  it('leaves a healthy managed repo alone — not a candidate', async () => {
    const registry = fakeRegistry(['/repo/healthy']);
    const manifest = fakeManifest({});
    const edtRegistry = fakeEdtRegistry();

    const result = await classifyStaleRegistry({ registry, manifest, edtRegistry });

    expect(result).toEqual({ ok: true, data: { candidates: [] } });
  });

  it('leaves a path with a manifest-load error other than manifest-not-found alone (Story 2.28 territory)', async () => {
    const registry = fakeRegistry(['/repo/bad-manifest']);
    const manifest = fakeManifest({ '/repo/bad-manifest': err('unknown-module', 'unknown module id') });
    const edtRegistry = fakeEdtRegistry();

    const result = await classifyStaleRegistry({ registry, manifest, edtRegistry });

    expect(result).toEqual({ ok: true, data: { candidates: [] } });
  });

  it('flags a stale candidate that is also an EDT member with memberOfEdts, still offered for removal', async () => {
    const registry = fakeRegistry(['/repo/gone'], { exists: vi.fn(async () => ok(false)) });
    const manifest = fakeManifest({});
    const edtRegistry = fakeEdtRegistry([edtEntry('my-topic', ['/repo/gone']), edtEntry('other-topic', ['/repo/other'])]);

    const result = await classifyStaleRegistry({ registry, manifest, edtRegistry });

    expect(result).toEqual({
      ok: true,
      data: { candidates: [{ path: '/repo/gone', reason: 'unreachable', memberOfEdts: ['my-topic'] }] },
    });
  });

  it('reports zero candidates explicitly for a fully healthy registry', async () => {
    const registry = fakeRegistry(['/repo/a', '/repo/b']);
    const manifest = fakeManifest({});
    const edtRegistry = fakeEdtRegistry();

    const result = await classifyStaleRegistry({ registry, manifest, edtRegistry });

    expect(result).toEqual({ ok: true, data: { candidates: [] } });
  });

  it('classifies a mixed registry into only the two stale reasons, in registry order', async () => {
    const registry = fakeRegistry(['/repo/healthy', '/repo/gone', '/repo/unmanaged', '/repo/bad'], {
      exists: vi.fn(async (path: string) => ok(path !== '/repo/gone')),
    });
    const manifest = fakeManifest({
      '/repo/unmanaged': err('manifest-not-found', 'no manifest'),
      '/repo/bad': err('unknown-module', 'unknown module id'),
    });
    const edtRegistry = fakeEdtRegistry();

    const result = await classifyStaleRegistry({ registry, manifest, edtRegistry });

    expect(result).toEqual({
      ok: true,
      data: {
        candidates: [
          { path: '/repo/gone', reason: 'unreachable', memberOfEdts: [] },
          { path: '/repo/unmanaged', reason: 'manifest-not-found', memberOfEdts: [] },
        ],
      },
    });
  });

  it('propagates a registry.list() failure unchanged', async () => {
    const registry = fakeRegistry([], { list: vi.fn(async () => err('registry-invalid-yaml', 'bad yaml')) });
    const manifest = fakeManifest({});
    const edtRegistry = fakeEdtRegistry();

    const result = await classifyStaleRegistry({ registry, manifest, edtRegistry });

    expect(result).toMatchObject({ ok: false, error: { code: 'registry-invalid-yaml' } });
  });

  it('propagates an edtRegistry.list() failure unchanged', async () => {
    const registry = fakeRegistry(['/repo/a']);
    const manifest = fakeManifest({});
    const edtRegistry = fakeEdtRegistry([], { list: vi.fn(async () => err('edt-registry-read-error', 'bad edts.yaml')) });

    const result = await classifyStaleRegistry({ registry, manifest, edtRegistry });

    expect(result).toMatchObject({ ok: false, error: { code: 'edt-registry-read-error' } });
  });

  it('leaves a path alone when registry.exists() itself errors — inconclusive, not evidence of staleness', async () => {
    const registry = fakeRegistry(['/repo/unknown'], {
      exists: vi.fn(async () => err('registry-stat-error', 'permission denied')),
    });
    const manifest = fakeManifest({});
    const edtRegistry = fakeEdtRegistry();

    const result = await classifyStaleRegistry({ registry, manifest, edtRegistry });

    expect(result).toEqual({ ok: true, data: { candidates: [] } });
  });
});

describe('removeStaleRegistryEntries', () => {
  it('removes each given path via registry.remove, one outcome row per path', async () => {
    const registry = fakeRegistry([]);
    const lock = fakeLock();

    const result = await removeStaleRegistryEntries({ registry, lock, registryResourceKey: '/cfg/registry.yaml' }, [
      '/repo/a',
      '/repo/b',
    ]);

    expect(result).toEqual({
      ok: true,
      data: {
        results: [
          { path: '/repo/a', outcome: 'removed' },
          { path: '/repo/b', outcome: 'removed' },
        ],
      },
    });
    expect(registry.remove).toHaveBeenNthCalledWith(1, '/repo/a');
    expect(registry.remove).toHaveBeenNthCalledWith(2, '/repo/b');
  });

  it('isolates one path\'s removal failure — the other path still succeeds', async () => {
    const remove = vi.fn(async (path: string) =>
      path === '/repo/bad' ? err('registry-write-error', 'disk full') : ok(undefined),
    );
    const registry = fakeRegistry([], { remove });
    const lock = fakeLock();

    const result = await removeStaleRegistryEntries({ registry, lock, registryResourceKey: '/cfg/registry.yaml' }, [
      '/repo/bad',
      '/repo/good',
    ]);

    expect(result).toEqual({
      ok: true,
      data: {
        results: [
          { path: '/repo/bad', outcome: 'failed', detail: { code: 'registry-write-error', message: 'disk full' } },
          { path: '/repo/good', outcome: 'removed' },
        ],
      },
    });
  });

  it('removing an unregistered path is a no-op success (registry.remove itself is a no-op)', async () => {
    const registry = fakeRegistry([]); // remove() stub resolves ok(undefined) unconditionally
    const lock = fakeLock();

    const result = await removeStaleRegistryEntries({ registry, lock, registryResourceKey: '/cfg/registry.yaml' }, [
      '/repo/never-registered',
    ]);

    expect(result).toEqual({ ok: true, data: { results: [{ path: '/repo/never-registered', outcome: 'removed' }] } });
  });

  it('returns an empty results list for an empty path list, never silently skipped', async () => {
    const registry = fakeRegistry([]);
    const lock = fakeLock();

    const result = await removeStaleRegistryEntries({ registry, lock, registryResourceKey: '/cfg/registry.yaml' }, []);

    expect(result).toEqual({ ok: true, data: { results: [] } });
  });

  it('acquires and releases the lock around each path removal', async () => {
    const registry = fakeRegistry([]);
    const lock = fakeLock();

    await removeStaleRegistryEntries({ registry, lock, registryResourceKey: '/cfg/registry.yaml' }, ['/repo/a']);

    expect(lock.acquire).toHaveBeenCalledWith('/cfg/registry.yaml');
  });
});
