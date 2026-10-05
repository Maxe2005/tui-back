// core/scripts/list-repos: unit tests against fake RegistryPort + ManifestPort (AD-13).
// Real-filesystem behavior (missing file, corrupt YAML, stat probe) is covered in
// adapters/driven/registry/index.test.ts.
import { describe, expect, it, vi } from 'vitest';
import { ok, err } from '../result.js';
import type { RegistryPort } from '../ports/registry.js';
import type { Manifest, ManifestPort } from '../ports/manifest.js';
import { listRepos } from './list-repos.js';

function fakeRegistry(overrides: Partial<RegistryPort> = {}): RegistryPort {
  return {
    list: async () => ok([]),
    add: async () => ok(undefined),
    exists: vi.fn(async () => ok(true)),
    scan: async () => ok({ candidates: [], skipped: [] }),
    reset: async () => ok({ path: '/x', backupPath: null }),
    remove: async () => ok(undefined),
    ...overrides,
  };
}

function manifestFor(repoPath: string): Manifest {
  return {
    service: `svc-${repoPath}`,
    container: `ctr-${repoPath}`,
    migrationCommand: 'npm run migration:run',
    sharedBranch: 'development',
    modules: {},
  };
}

function fakeManifest(overrides: Partial<ManifestPort> = {}): ManifestPort {
  return {
    load: vi.fn(async (path: string) => ok(manifestFor(path))),
    ...overrides,
  };
}

describe('listRepos', () => {
  it('returns empty repos/unreachable/errors for an empty registry', async () => {
    const registry = fakeRegistry({ list: async () => ok([]) });
    const manifest = fakeManifest();

    await expect(listRepos(registry, manifest)).resolves.toEqual({
      ok: true,
      data: { repos: [], unreachable: [], errors: [] },
    });
  });

  it('lists managed repos with identity, silently skips unmanaged, reports unreachable', async () => {
    const managed = '/m/a';
    const unmanaged = '/m/b';
    const gone = '/m/c';
    const registry = fakeRegistry({
      list: async () => ok([managed, unmanaged, gone]),
      exists: vi.fn(async (path: string) => ok(path !== gone)),
    });
    const manifest = fakeManifest({
      load: vi.fn(async (path: string) =>
        path === unmanaged ? err('manifest-not-found', 'no manifest') : ok(manifestFor(path)),
      ),
    });

    const result = await listRepos(registry, manifest);

    expect(result).toEqual({
      ok: true,
      data: {
        repos: [
          {
            path: managed,
            service: `svc-${managed}`,
            container: `ctr-${managed}`,
            sharedBranch: 'development',
            moduleIds: [],
          },
        ],
        unreachable: [gone],
        errors: [],
      },
    });
  });

  it('preserves registry-file order in the output (FR-1 determinism)', async () => {
    const paths = ['/m/z', '/m/a', '/m/m'];
    const registry = fakeRegistry({
      list: async () => ok(paths),
      exists: async () => ok(true),
    });
    const manifest = fakeManifest();

    const result = await listRepos(registry, manifest);

    if (!result.ok) throw new Error('expected ok');
    expect(result.data.repos.map((r) => r.path)).toEqual(paths);
  });

  it('fills moduleIds in sorted ascending order from the manifest modules keys', async () => {
    const path = '/m/mod';
    const registry = fakeRegistry({ list: async () => ok([path]) });
    const manifest = fakeManifest({
      load: async () =>
        ok({
          service: 'svc',
          container: 'ctr',
          migrationCommand: 'migrate',
          sharedBranch: 'development',
          modules: { zebra: {}, alpha: {} },
        }),
    });

    const result = await listRepos(registry, manifest);

    expect(result).toEqual({
      ok: true,
      data: {
        repos: [{ path, service: 'svc', container: 'ctr', sharedBranch: 'development', moduleIds: ['alpha', 'zebra'] }],
        unreachable: [],
        errors: [],
      },
    });
  });

  it('sets moduleIds to the empty array for a module-free repo', async () => {
    const path = '/m/plain';
    const registry = fakeRegistry({ list: async () => ok([path]) });
    const manifest = fakeManifest({
      load: async () =>
        ok({
          service: 'svc',
          container: 'ctr',
          migrationCommand: 'migrate',
          sharedBranch: 'development',
          modules: {},
        }),
    });

    const result = await listRepos(registry, manifest);

    if (!result.ok) throw new Error('expected ok');
    expect(result.data.repos[0].moduleIds).toEqual([]);
  });


  it('exposes a missing container as null in the JSON data', async () => {
    const path = '/m/lib';
    const registry = fakeRegistry({ list: async () => ok([path]) });
    const manifest = fakeManifest({
      load: async () =>
        ok({
          service: 'shared-types',
          sharedBranch: 'development',
          modules: {},
        }),
    });

    const result = await listRepos(registry, manifest);

    expect(result).toEqual({
      ok: true,
      data: {
        repos: [{ path, service: 'shared-types', container: null, sharedBranch: 'development', moduleIds: [] }],
        unreachable: [],
        errors: [],
      },
    });
  });

  it('exposes a blank container as null, like a missing one', async () => {
    const path = '/m/blank';
    const registry = fakeRegistry({ list: async () => ok([path]) });
    const manifest = fakeManifest({
      load: async () =>
        ok({
          service: 'svc',
          container: '   ',
          sharedBranch: 'development',
          modules: {},
        }),
    });

    const result = await listRepos(registry, manifest);

    if (!result.ok) throw new Error('expected ok');
    expect(result.data.repos[0].container).toBeNull();
  });

  it('surfaces a failing manifest as an errors entry, not a crash and not a silent skip', async () => {
    const bad = '/m/bad';
    const registry = fakeRegistry({
      list: async () => ok([bad]),
      exists: async () => ok(true),
    });
    const manifest = fakeManifest({
      load: async () => err('manifest-validation-failed', 'Invalid .tui-back.yaml'),
    });

    const result = await listRepos(registry, manifest);

    expect(result).toEqual({
      ok: true,
      data: {
        repos: [],
        unreachable: [],
        errors: [{ path: bad, code: 'manifest-validation-failed', message: 'Invalid .tui-back.yaml' }],
      },
    });
  });

  it('surfaces a registry.exists failure as an errors entry', async () => {
    const path = '/m/stat';
    const registry = fakeRegistry({
      list: async () => ok([path]),
      exists: async () => err('registry-stat-error', 'permission denied'),
    });

    const result = await listRepos(registry, fakeManifest());

    expect(result).toEqual({
      ok: true,
      data: {
        repos: [],
        unreachable: [],
        errors: [{ path, code: 'registry-stat-error', message: 'permission denied' }],
      },
    });
  });

  it('propagates a registry.list failure (e.g. corrupt registry.yaml) instead of masking it', async () => {
    const registry = fakeRegistry({ list: async () => err('registry-invalid-yaml', 'bad yaml') });

    await expect(listRepos(registry, fakeManifest())).resolves.toMatchObject({
      ok: false,
      error: { code: 'registry-invalid-yaml' },
    });
  });
});
