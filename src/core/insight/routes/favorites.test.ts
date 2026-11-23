// core/insight/routes/favorites: unit tests over an in-memory EDT registry.
import { describe, expect, it } from 'vitest';
import { err, ok } from '../../result.js';
import type { EdtRegistryEntry, EdtRegistryPort } from '../../ports/storage/edt-registry.js';
import type { LockPort } from '../../ports/runtime/lock.js';
import type { StatePort } from '../../ports/storage/state.js';
import type { ManifestPort } from '../../ports/vcs/manifest.js';
import type { Route, RouteScannerPort } from '../../ports/modules/route-scanner.js';
import { addFavoriteRoute, listFavoriteRoutes, removeFavoriteRoute, toggleFavoriteRoute } from './favorites.js';

function setup(active: string | null = 'A', routes: Route[] | 'fail' = [{ method: 'GET', path: '/x/{id}' }]) {
  const edts: EdtRegistryEntry[] = ['A', 'B'].map((id) => ({
    ulid: id, topic: `topic-${id}`, createdAt: 't', status: 'inactive' as const, members: [],
  }));
  let writes = 0;
  const edtRegistry = {
    list: async () => ok(edts.map((e) => ({ ...e }))),
    update: async (ulid: string, patch: { favoriteRoutes?: EdtRegistryEntry['favoriteRoutes'] }) => {
      const entry = edts.find((e) => e.ulid === ulid);
      if (!entry) return err('edt-not-found', 'nope');
      writes += 1;
      if (patch.favoriteRoutes) entry.favoriteRoutes = patch.favoriteRoutes;
      return ok(undefined);
    },
  } as unknown as EdtRegistryPort;
  const lock: LockPort = { acquire: async () => ok({ release: async () => ok(undefined) }) } as unknown as LockPort;
  const state = { readActiveEdt: async () => ok(active) } as unknown as StatePort;
  const manifest: ManifestPort = { load: async () => ok({ service: 's', container: 'c', sharedBranch: 'd', modules: { 'route-explorer': {} } }) } as unknown as ManifestPort;
  const scanner: RouteScannerPort = { scan: async () => (routes === 'fail' ? err('route-scan-failed', 'x') : ok(routes)) };
  return { edts, writes: () => writes, deps: { edtRegistry, edtRegistryResourceKey: 'k', lock, state }, listDeps: { edtRegistry, state, manifest, scanner } };
}

const input = { repoPath: '/r', method: 'get', path: '/x/{id}' };

describe('favorite routes', () => {
  it('toggles on (upper-cased) then off', async () => {
    const s = setup();
    expect(await toggleFavoriteRoute(s.deps, input)).toEqual(ok({ favorite: true }));
    expect(s.edts[0]?.favoriteRoutes).toEqual([{ repoPath: '/r', method: 'GET', path: '/x/{id}' }]);
    expect(await toggleFavoriteRoute(s.deps, input)).toEqual(ok({ favorite: false }));
    expect(s.edts[0]?.favoriteRoutes).toEqual([]);
  });

  it('add twice is a no-op; remove of a non-favorite is a no-op', async () => {
    const s = setup();
    await addFavoriteRoute(s.deps, input);
    await addFavoriteRoute(s.deps, input);
    expect(s.edts[0]?.favoriteRoutes).toHaveLength(1);
    expect(s.writes()).toBe(1);
    await removeFavoriteRoute(s.deps, { ...input, path: '/other' });
    expect(s.writes()).toBe(1);
    expect((await removeFavoriteRoute(s.deps, input)).ok).toBe(true);
    expect(s.edts[0]?.favoriteRoutes).toEqual([]);
  });

  it('isolates favorites per EDT and honours --edt topic', async () => {
    const s = setup();
    await addFavoriteRoute(s.deps, input);
    const b = await listFavoriteRoutes(s.listDeps, { edt: 'topic-B' });
    expect(b).toEqual(ok({ favorites: [] }));
    await addFavoriteRoute(s.deps, { ...input, edt: 'topic-B', path: '/y' });
    expect(s.edts[1]?.favoriteRoutes).toEqual([{ repoPath: '/r', method: 'GET', path: '/y' }]);
    expect(s.edts[0]?.favoriteRoutes).toHaveLength(1);
  });

  it('flags a vanished route stale but keeps it; scan failure is not stale', async () => {
    const s = setup('A', []);
    await addFavoriteRoute(s.deps, input);
    const listed = await listFavoriteRoutes(s.listDeps);
    expect(listed.ok && listed.data.favorites).toEqual([{ repoPath: '/r', method: 'GET', path: '/x/{id}', stale: true }]);
    const failing = setup('A', 'fail');
    await addFavoriteRoute(failing.deps, input);
    const failed = await listFavoriteRoutes(failing.listDeps);
    expect(failed.ok && failed.data.favorites[0]?.stale).toBe(false);
    expect((await removeFavoriteRoute(s.deps, input)).ok).toBe(true);
  });

  it('rejects bad input before any write', async () => {
    const s = setup();
    const code = async (p: Promise<{ ok: boolean; error?: { code: string } }>) => (await p).error?.code;
    expect(await code(addFavoriteRoute(s.deps, { ...input, method: 'FOO' }))).toBe('invalid-argument');
    expect(await code(addFavoriteRoute(s.deps, { ...input, repoPath: ' ' }))).toBe('missing-argument');
    expect(await code(addFavoriteRoute(s.deps, { ...input, path: '' }))).toBe('missing-argument');
    expect(await code(addFavoriteRoute(s.deps, { ...input, edt: 'nope' }))).toBe('edt-not-found');
    expect(await code(addFavoriteRoute(setup(null).deps, input))).toBe('edt-not-found');
    expect(s.writes()).toBe(0);
  });

  it('normalizes trailing slash and rejects relative repo or path without a leading slash', async () => {
    const s = setup();
    await addFavoriteRoute(s.deps, { ...input, repoPath: '/r/', path: '/x/{id}/' });
    await addFavoriteRoute(s.deps, input);
    expect(s.edts[0]?.favoriteRoutes).toEqual([{ repoPath: '/r', method: 'GET', path: '/x/{id}' }]);
    expect(s.writes()).toBe(1);
    expect(await addFavoriteRoute(s.deps, { ...input, repoPath: 'rel' })).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
    expect(await addFavoriteRoute(s.deps, { ...input, path: 'x' })).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
    expect(s.writes()).toBe(1);
  });

  it('propagates a readonly registry refusal (system-shared EDT) without swallowing it', async () => {
    const s = setup();
    (s.deps.edtRegistry as { update: unknown }).update = async () => err('system-edt-readonly', 'read-only');
    expect(await addFavoriteRoute(s.deps, input)).toMatchObject({ ok: false, error: { code: 'system-edt-readonly' } });
  });

  it('never flags a favorite stale when its repo no longer activates the module', async () => {
    const s = setup();
    await addFavoriteRoute(s.deps, input);
    const manifest = { load: async () => ok({ service: 's', container: 'c', sharedBranch: 'd', modules: {} }) } as unknown as ManifestPort;
    const listed = await listFavoriteRoutes({ ...s.listDeps, manifest, scanner: { scan: async () => ok([]) } });
    expect(listed).toEqual(ok({ favorites: [{ repoPath: '/r', method: 'GET', path: '/x/{id}', stale: false }] }));
  });
});
