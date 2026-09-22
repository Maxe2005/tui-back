// tui/store/slices/routes-slice: unit tests for story 6.1's Routes slice — store-level
// coverage of repo-target resolution and the failure-vs-empty distinction, against fake
// ports (AD-13). The zone's own render tests (routes-zone.test.tsx) cover the visible
// states; core's list-routes.test.ts covers the gate itself.
import { describe, expect, it, vi } from 'vitest';
import { err, ok } from '../../../../../core/result.js';
import type { EdtRegistryEntry, EdtRegistryPort } from '../../../../../core/ports/edt-registry.js';
import type { LockPort } from '../../../../../core/ports/lock.js';
import type { Manifest, ManifestPort } from '../../../../../core/ports/manifest.js';
import type { RegistryPort } from '../../../../../core/ports/registry.js';
import type { Route, RouteScannerPort } from '../../../../../core/ports/route-scanner.js';
import type { StatePort } from '../../../../../core/ports/state.js';
import { createAppStore, type AppStoreDeps } from '../app-store.js';

function manifestFor(service: string, modules: Manifest['modules']): Manifest {
  return { service, container: service, sharedBranch: 'development', modules };
}

function fakeDeps(overrides: Partial<AppStoreDeps> = {}): AppStoreDeps {
  const registry: RegistryPort = {
    list: vi.fn(async () => ok(['/repos/gateway'])),
    add: vi.fn(async () => ok(undefined)),
    exists: vi.fn(async () => ok(true)),
    scan: vi.fn(async () => ok({ candidates: [], skipped: [] })),
    reset: vi.fn(async () => ok({ path: '/x', backupPath: null })),
  };
  const manifest: ManifestPort = {
    load: vi.fn(async () => ok(manifestFor('gateway', { 'route-explorer': {} }))),
  };
  const edtRegistry: EdtRegistryPort = {
    add: vi.fn(async () => ok(undefined)),
    list: vi.fn(async () => ok([] as EdtRegistryEntry[])),
    setStatus: vi.fn(async () => ok(undefined)),
    update: vi.fn(async () => ok(undefined)),
    remove: vi.fn(async () => ok(undefined)),
  };
  const state: StatePort = {
    readActiveEdt: vi.fn(async () => ok(null)),
    writeActiveEdt: vi.fn(async () => ok(undefined)),
    readSplitterRatios: vi.fn(async () => ok(null)),
    writeSplitterRatios: vi.fn(async () => ok(undefined)),
    readFilterHistory: vi.fn(async () => ok(null)),
    writeFilterHistory: vi.fn(async () => ok(undefined)),
  };
  const lock: LockPort = {
    acquire: vi.fn(async () => ok({ release: vi.fn(async () => ok(undefined)) })),
    peek: vi.fn(async () => ok({ locked: false })),
  };
  const scanner: RouteScannerPort = {
    scan: vi.fn(async () => ok([{ method: 'GET', path: '/users' }] as Route[])),
  };
  return {
    registry,
    manifest,
    git: {} as AppStoreDeps['git'],
    edtRegistry,
    state,
    lock,
    registryResourceKey: '/config/registry.yaml',
    edtRegistryResourceKey: '/tmp/edts.yaml',
    edtsBaseDir: '/tmp/edts',
    settings: {} as AppStoreDeps['settings'],
    docker: {} as AppStoreDeps['docker'],
    scanner,
    ...overrides,
  };
}

describe('routes slice (story 6.1)', () => {
  it('loads routes for the carrying repo into ready state', async () => {
    const store = createAppStore(fakeDeps());

    await store.getState().loadRoutes();

    const state = store.getState();
    expect(state.routesStatus).toBe('ready');
    expect(state.routesRepoPath).toBe('/repos/gateway');
    expect(state.routes).toEqual([{ method: 'GET', path: '/users' }]);
    expect(state.routesError).toBeNull();
  });

  it('degrades to an explicit error on an unwired store, never throwing', async () => {
    const store = createAppStore();

    await store.getState().loadRoutes();

    expect(store.getState().routesStatus).toBe('error');
    expect(store.getState().routesError).toMatchObject({ code: 'store-not-wired' });
  });

  it('reports route-exploration-not-activated (never an empty list) when no repo carries the module', async () => {
    const manifest: ManifestPort = {
      load: vi.fn(async () => ok(manifestFor('plain', {}))),
    };
    const store = createAppStore(fakeDeps({ manifest }));

    await store.getState().loadRoutes();

    const state = store.getState();
    expect(state.routesStatus).toBe('error');
    expect(state.routesError).toMatchObject({ code: 'route-exploration-not-activated' });
    expect(state.routes).toBeNull();
  });

  it('surfaces a scanner failure as route-scan-failed with its reason', async () => {
    const scanner: RouteScannerPort = {
      scan: vi.fn(async () => err('route-scan-failed', 'no spec', { reason: 'no spec' })),
    };
    const store = createAppStore(fakeDeps({ scanner }));

    await store.getState().loadRoutes();

    const state = store.getState();
    expect(state.routesStatus).toBe('error');
    expect(state.routesError).toMatchObject({ code: 'route-scan-failed' });
    expect(state.routes).toBeNull();
  });

  it('keeps a genuinely-empty scan as ready with [], distinct from any error', async () => {
    const scanner: RouteScannerPort = { scan: vi.fn(async () => ok([])) };
    const store = createAppStore(fakeDeps({ scanner }));

    await store.getState().loadRoutes();

    const state = store.getState();
    expect(state.routesStatus).toBe('ready');
    expect(state.routes).toEqual([]);
    expect(state.routesError).toBeNull();
  });

  it('surfaces a registry failure as error with routes cleared, never stuck in loading', async () => {
    const registry: RegistryPort = {
      list: vi.fn(async () => err('registry-invalid-yaml', 'bad registry')),
      add: vi.fn(async () => ok(undefined)),
      exists: vi.fn(async () => ok(true)),
      scan: vi.fn(async () => ok({ candidates: [], skipped: [] })),
      reset: vi.fn(async () => ok({ path: '/x', backupPath: null })),
    };
    const store = createAppStore(fakeDeps({ registry }));

    await store.getState().loadRoutes();

    const state = store.getState();
    expect(state.routesStatus).toBe('error');
    expect(state.routesError).toMatchObject({ code: 'registry-invalid-yaml' });
    expect(state.routes).toBeNull();
  });

  it('prefers the active EDT member carrying route-explorer over the first carrying repo', async () => {    const registry: RegistryPort = {
      list: vi.fn(async () => ok(['/repos/first', '/repos/member'])),
      add: vi.fn(async () => ok(undefined)),
      exists: vi.fn(async () => ok(true)),
      scan: vi.fn(async () => ok({ candidates: [], skipped: [] })),
      reset: vi.fn(async () => ok({ path: '/x', backupPath: null })),
    };
    const manifest: ManifestPort = {
      load: vi.fn(async (path: string) =>
        ok(manifestFor(path.split('/').pop() ?? path, { 'route-explorer': {} })),
      ),
    };
    const edtRegistry: EdtRegistryPort = {
      add: vi.fn(async () => ok(undefined)),
      list: vi.fn(async () => ok([
        {
          ulid: '01J00000000000000000000000',
          topic: 'demo',
          createdAt: '2026-09-22T00:00:00.000Z',
          status: 'active',
          members: [{ service: 'member', repoPath: '/repos/member', branch: 'feat/x' }],
        },
      ] as EdtRegistryEntry[])),
      setStatus: vi.fn(async () => ok(undefined)),
      update: vi.fn(async () => ok(undefined)),
      remove: vi.fn(async () => ok(undefined)),
    };
    const state: StatePort = {
      readActiveEdt: vi.fn(async () => ok('01J00000000000000000000000')),
      writeActiveEdt: vi.fn(async () => ok(undefined)),
      readSplitterRatios: vi.fn(async () => ok(null)),
      writeSplitterRatios: vi.fn(async () => ok(undefined)),
      readFilterHistory: vi.fn(async () => ok(null)),
      writeFilterHistory: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeDeps({ registry, manifest, edtRegistry, state }));

    await store.getState().loadRoutes();

    expect(store.getState().routesRepoPath).toBe('/repos/member');
    expect(store.getState().routesStatus).toBe('ready');
  });
});
