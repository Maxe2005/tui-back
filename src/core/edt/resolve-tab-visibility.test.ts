// core/edt/resolve-tab-visibility: unit tests against fake ports (AD-13 core layer) —
// every I/O-matrix row of story 2.13: registry-wide omission, active-EDT-scoped disable,
// enablement, either shared-types module id counting, and error propagation from the two
// reused resolution paths (listRepos, active-EDT-member resolution).
import { describe, expect, it, vi } from 'vitest';
import { ok, err } from '../result.js';
import type { EdtRegistryEntry, EdtRegistryPort } from '../ports/edt-registry.js';
import type { Manifest, ManifestPort } from '../ports/manifest.js';
import type { RegistryPort } from '../ports/registry.js';
import type { StatePort } from '../ports/state.js';
import {
  resolveTabVisibility,
  ROUTES_MODULE_ID,
  SHARED_TYPES_MODULE_IDS,
} from './resolve-tab-visibility.js';

function manifestFor(repoPath: string, moduleIds: string[] = []): Manifest {
  const name = repoPath.split('/').pop();
  return {
    service: `svc-${name}`,
    container: `ctr-${name}`,
    sharedBranch: 'development',
    modules: Object.fromEntries(moduleIds.map((id) => [id, {}])),
  };
}

function fakeRegistry(paths: string[], overrides: Partial<RegistryPort> = {}): RegistryPort {
  return {
    list: vi.fn(async () => ok(paths)),
    add: vi.fn(async () => ok(undefined)),
    exists: vi.fn(async () => ok(true)),
    scan: vi.fn(async () => ok({ candidates: [], skipped: [] })),
    reset: vi.fn(async () => ok({ path: '/x', backupPath: null })),
    ...overrides,
  };
}

function fakeManifest(byPath: Record<string, string[]>, overrides: Partial<ManifestPort> = {}): ManifestPort {
  return {
    load: vi.fn(async (path: string) => ok(manifestFor(path, byPath[path] ?? []))),
    ...overrides,
  };
}

function fakeEdtRegistry(entries: EdtRegistryEntry[] = [], overrides: Partial<EdtRegistryPort> = {}): EdtRegistryPort {
  return {
    add: vi.fn(async () => ok(undefined)),
    list: vi.fn(async () => ok(entries)),
    setStatus: vi.fn(async () => ok(undefined)),
    update: vi.fn(async () => ok(undefined)),
    ...overrides,
  };
}

function fakeState(overrides: Partial<StatePort> = {}): StatePort {
  return {
    readActiveEdt: vi.fn(async () => ok(null)),
    writeActiveEdt: vi.fn(async () => ok(undefined)),
    ...overrides,
  };
}

function edtEntry(ulid: string, topic: string, members: EdtRegistryEntry['members']): EdtRegistryEntry {
  return { ulid, topic, createdAt: '2026-08-19T00:00:00.000Z', status: 'active', members };
}

describe('resolveTabVisibility', () => {
  it('module ids: gates Routes on route-explorer, shared-types on either source or consumer', () => {
    expect(ROUTES_MODULE_ID).toBe('route-explorer');
    expect(SHARED_TYPES_MODULE_IDS).toEqual(['shared-types-source', 'shared-types-consumer']);
  });

  it('omits both tabs when zero registered repos activate either module', async () => {
    const registry = fakeRegistry(['/repo/a']);
    const manifest = fakeManifest({ '/repo/a': [] });

    const result = await resolveTabVisibility({
      registry,
      manifest,
      edtRegistry: fakeEdtRegistry(),
      state: fakeState(),
    });

    expect(result).toEqual({
      ok: true,
      data: {
        routes: { status: 'omitted', carryingServices: [] },
        sharedTypes: { status: 'omitted', carryingServices: [] },
      },
    });
  });

  it('shows Routes disabled when a repo activates route-explorer but is not an active-EDT member', async () => {
    const registry = fakeRegistry(['/repo/api-gateway']);
    const manifest = fakeManifest({ '/repo/api-gateway': [ROUTES_MODULE_ID] });

    const result = await resolveTabVisibility({
      registry,
      manifest,
      edtRegistry: fakeEdtRegistry(),
      state: fakeState(),
    });

    if (!result.ok) throw new Error('expected ok');
    expect(result.data.routes).toEqual({ status: 'disabled', carryingServices: ['svc-api-gateway'] });
  });

  it('shows Routes enabled when a carrying repo is a member of the active EDT', async () => {
    const registry = fakeRegistry(['/repo/api-gateway']);
    const manifest = fakeManifest({ '/repo/api-gateway': [ROUTES_MODULE_ID] });
    const edtRegistry = fakeEdtRegistry([
      edtEntry('edt-1', 'topic-1', [{ service: 'svc-api-gateway', repoPath: '/repo/api-gateway', branch: 'feat/x' }]),
    ]);

    const result = await resolveTabVisibility({
      registry,
      manifest,
      edtRegistry,
      state: fakeState({ readActiveEdt: vi.fn(async () => ok('edt-1')) }),
    });

    if (!result.ok) throw new Error('expected ok');
    expect(result.data.routes).toEqual({ status: 'enabled', carryingServices: ['svc-api-gateway'] });
  });

  it('counts either shared-types-source or shared-types-consumer for omission and disabled', async () => {
    const registry = fakeRegistry(['/repo/shared-types', '/repo/consumer-app']);
    const manifest = fakeManifest({
      '/repo/shared-types': ['shared-types-source'],
      '/repo/consumer-app': ['shared-types-consumer'],
    });

    const result = await resolveTabVisibility({
      registry,
      manifest,
      edtRegistry: fakeEdtRegistry(),
      state: fakeState(),
    });

    if (!result.ok) throw new Error('expected ok');
    expect(result.data.sharedTypes.status).toBe('disabled');
    expect(result.data.sharedTypes.carryingServices).toEqual(['svc-shared-types', 'svc-consumer-app']);
  });

  it('shows shared-types enabled when a shared-types-consumer carrier is an active-EDT member (source itself absent from the EDT)', async () => {
    const registry = fakeRegistry(['/repo/shared-types', '/repo/consumer-app']);
    const manifest = fakeManifest({
      '/repo/shared-types': ['shared-types-source'],
      '/repo/consumer-app': ['shared-types-consumer'],
    });
    const edtRegistry = fakeEdtRegistry([
      edtEntry('edt-1', 'topic-1', [{ service: 'svc-consumer-app', repoPath: '/repo/consumer-app', branch: 'feat/x' }]),
    ]);

    const result = await resolveTabVisibility({
      registry,
      manifest,
      edtRegistry,
      state: fakeState({ readActiveEdt: vi.fn(async () => ok('edt-1')) }),
    });

    if (!result.ok) throw new Error('expected ok');
    expect(result.data.sharedTypes).toEqual({
      status: 'enabled',
      carryingServices: ['svc-shared-types', 'svc-consumer-app'],
    });
  });

  it('leaves both tabs unaffected by no active EDT (disabled, never enabled) when a carrying repo exists', async () => {
    const registry = fakeRegistry(['/repo/api-gateway']);
    const manifest = fakeManifest({ '/repo/api-gateway': [ROUTES_MODULE_ID] });

    const result = await resolveTabVisibility({
      registry,
      manifest,
      edtRegistry: fakeEdtRegistry(),
      state: fakeState({ readActiveEdt: vi.fn(async () => ok(null)) }),
    });

    if (!result.ok) throw new Error('expected ok');
    expect(result.data.routes.status).toBe('disabled');
  });

  it('treats routes and shared-types independently (one enabled, the other omitted)', async () => {
    const registry = fakeRegistry(['/repo/api-gateway']);
    const manifest = fakeManifest({ '/repo/api-gateway': [ROUTES_MODULE_ID] });
    const edtRegistry = fakeEdtRegistry([
      edtEntry('edt-1', 'topic-1', [{ service: 'svc-api-gateway', repoPath: '/repo/api-gateway', branch: 'feat/x' }]),
    ]);

    const result = await resolveTabVisibility({
      registry,
      manifest,
      edtRegistry,
      state: fakeState({ readActiveEdt: vi.fn(async () => ok('edt-1')) }),
    });

    if (!result.ok) throw new Error('expected ok');
    expect(result.data.routes.status).toBe('enabled');
    expect(result.data.sharedTypes).toEqual({ status: 'omitted', carryingServices: [] });
  });

  it('propagates a listRepos (registry.list) failure instead of masking it', async () => {
    const registry = fakeRegistry([], { list: vi.fn(async () => err('registry-invalid-yaml', 'bad yaml')) });

    const result = await resolveTabVisibility({
      registry,
      manifest: fakeManifest({}),
      edtRegistry: fakeEdtRegistry(),
      state: fakeState(),
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'registry-invalid-yaml' } });
  });

  it('propagates a state.readActiveEdt() failure', async () => {
    const registry = fakeRegistry(['/repo/a']);

    const result = await resolveTabVisibility({
      registry,
      manifest: fakeManifest({ '/repo/a': [] }),
      edtRegistry: fakeEdtRegistry(),
      state: fakeState({ readActiveEdt: vi.fn(async () => err('state-read-error', 'cannot read state.json')) }),
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'state-read-error' } });
  });

  it('propagates an edtRegistry.list() failure once an active EDT is set', async () => {
    const registry = fakeRegistry(['/repo/a']);

    const result = await resolveTabVisibility({
      registry,
      manifest: fakeManifest({ '/repo/a': [] }),
      edtRegistry: fakeEdtRegistry([], { list: vi.fn(async () => err('edt-registry-invalid-format', 'bad shape')) }),
      state: fakeState({ readActiveEdt: vi.fn(async () => ok('edt-1')) }),
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'edt-registry-invalid-format' } });
  });
});
