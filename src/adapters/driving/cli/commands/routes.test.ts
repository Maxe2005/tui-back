// cli/commands/routes: flag parsing, dispatch and repo resolution of `routes favorites`.
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { err, ok } from '../../../../core/result.js';
import { routesSubcommand } from './routes.js';
import type { SubcommandDeps } from './deps.js';

function setup() {
  const updates: Array<{ ulid: string; favoriteRoutes?: unknown }> = [];
  const entry = { ulid: 'A', topic: 'topic-A', createdAt: 't', status: 'active', members: [] as unknown[], favoriteRoutes: undefined as unknown };
  const deps = {
    edtRegistry: {
      list: async () => ok([{ ...entry }]),
      update: async (ulid: string, patch: { favoriteRoutes?: unknown }) => {
        updates.push({ ulid, ...patch });
        entry.favoriteRoutes = patch.favoriteRoutes;
        return ok(undefined);
      },
    },
    edtRegistryResourceKey: 'k',
    lock: { acquire: async () => ok({ release: async () => ok(undefined) }) },
    state: { readActiveEdt: async () => ok('A') },
    manifest: { load: async () => err('manifest-not-found', 'x') },
    scanner: { scan: async () => ok([]) },
  } as unknown as SubcommandDeps;
  return { cmd: routesSubcommand(deps), updates };
}

const add = ['favorites', 'add', '--repo', '/r', '--method', 'get', '--path', '/x'];

describe('routes favorites CLI', () => {
  it('adds, lists and removes through the use-cases, defaulting to the active EDT', async () => {
    const { cmd, updates } = setup();
    expect(await cmd.run(add)).toEqual(ok({ favorite: true }));
    expect(updates[0]).toEqual({ ulid: 'A', favoriteRoutes: [{ repoPath: '/r', method: 'GET', path: '/x' }] });
    expect(await cmd.run(['favorites', 'list'])).toMatchObject({ ok: true, data: { favorites: [{ method: 'GET', stale: false }] } });
    expect(await cmd.run(['favorites', 'remove', ...add.slice(2)])).toEqual(ok({ favorite: false }));
    expect(updates[1]?.favoriteRoutes).toEqual([]);
  });

  it('resolves a relative --repo to an absolute path', async () => {
    const { cmd, updates } = setup();
    await cmd.run(['favorites', 'add', '--repo', 'rel', '--method', 'GET', '--path', '/x']);
    expect(updates[0]?.favoriteRoutes).toEqual([{ repoPath: resolve('rel'), method: 'GET', path: '/x' }]);
  });

  it('forwards --edt and rejects an unknown topic before writing', async () => {
    const { cmd, updates } = setup();
    expect(await cmd.run([...add, '--edt', 'nope'])).toMatchObject({ ok: false, error: { code: 'edt-not-found' } });
    expect(updates).toHaveLength(0);
  });

  it.each([
    [['favorites', 'add', '--repo', '/r', '--method', 'GET'], 'missing-argument'],
    [['favorites', 'add', '--repo', ' ', '--method', 'GET', '--path', '/x'], 'missing-argument'],
    [[...add, '--method', 'POST'], 'invalid-argument'],
    [[...add, '--bogus', 'v'], 'invalid-argument'],
    [['favorites', 'add', '--repo'], 'invalid-argument'],
    [['favorites', 'add', '--repo', '/r', '--method', 'FOO', '--path', '/x'], 'invalid-argument'],
    [['favorites', 'nope'], 'invalid-argument'],
    [['other'], 'invalid-argument'],
    [[], 'invalid-argument'],
  ])('rejects %j with %s and writes nothing', async (args, code) => {
    const { cmd, updates } = setup();
    expect(await cmd.run(args as string[])).toMatchObject({ ok: false, error: { code } });
    expect(updates).toHaveLength(0);
  });
});
