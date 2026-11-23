import { describe, expect, it, vi } from 'vitest';
import { ok, err } from '../../../../core/result.js';
import type { SavedRequest } from '../../../../core/ports/storage/saved-request.js';
import { fakeSavedRequests, buildTestSubcommands } from './dispatch.test-support.js';

describe('subcommand registry guards — routes and requests', () => {
  it('list-routes rejects missing/excess arguments and otherwise delegates to the use-case', async () => {
    const subcommands = buildTestSubcommands();
    const listRoutesCmd = subcommands.find((subcommand) => subcommand.name === 'list-routes');
    if (!listRoutesCmd) throw new Error('expected list-routes subcommand');

    expect(listRoutesCmd.usage).toBe('tui-back list-routes <repoPath>');

    const missing = await listRoutesCmd.run([]);
    expect(missing).toMatchObject({ ok: false, error: { code: 'missing-argument' } });

    const excess = await listRoutesCmd.run(['/a', '/b']);
    expect(excess).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });

    // The fixture manifest answers manifest-not-found, which the use-case propagates —
    // proving the wrapper reached the use-case itself rather than rejecting locally.
    const result = await listRoutesCmd.run(['/repos/gateway']);
    expect(result).toMatchObject({ ok: false, error: { code: 'manifest-not-found' } });
  });

  it('fire-request rejects missing/bad-arity/blank arguments and otherwise delegates to the use-case', async () => {
    const subcommands = buildTestSubcommands();
    const fireRequestCmd = subcommands.find((subcommand) => subcommand.name === 'fire-request');
    if (!fireRequestCmd) throw new Error('expected fire-request subcommand');

    expect(fireRequestCmd.usage).toBe(
      "tui-back fire-request <repoPath> <METHOD> <path> [--body <json>] [--query name=value]... [--header 'Name: value']... [--save <name>]",
    );

    const missing = await fireRequestCmd.run([]);
    expect(missing).toMatchObject({ ok: false, error: { code: 'missing-argument' } });

    for (const args of [['/a'], ['/a', 'GET'], ['/a', 'GET', '/x', 'extra'], ['/a', '  ', '/x']]) {
      const rejected = await fireRequestCmd.run(args);
      expect(rejected).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
    }

    // The fixture manifest answers manifest-not-found, which the use-case propagates —
    // proving the wrapper reached the use-case itself rather than rejecting locally.
    const result = await fireRequestCmd.run(['/repos/gateway', 'GET', '/users']);
    expect(result).toMatchObject({ ok: false, error: { code: 'manifest-not-found' } });
  });

  it('fire-request parses --body/--query/--header and rejects malformed flags', async () => {
    const subcommands = buildTestSubcommands();
    const fireRequestCmd = subcommands.find((subcommand) => subcommand.name === 'fire-request');
    if (!fireRequestCmd) throw new Error('expected fire-request subcommand');

    for (const args of [
      ['/a', 'POST', '/x', '--body', '{oops'],
      ['/a', 'POST', '/x', '--body'],
      ['/a', 'POST', '/x', '--body', '{}', '--body', '{}'],
      ['/a', 'GET', '/x', '--query', 'novalue'],
      ['/a', 'GET', '/x', '--query', '=v'],
      ['/a', 'GET', '/x', '--header', 'NoColon'],
      ['/a', 'GET', '/x', '--bogus', 'v'],
      ['/a', '--body', '{}'],
      ['/a', 'GET', '/x', '--header', '--body'],
      ['/a', 'GET', '/x', '--query', 'q=1', '--query', 'q=2'],
      ['/a', 'GET', '/x', '--header', 'X-A: 1', '--header', 'x-a: 2'],
    ]) {
      const rejected = await fireRequestCmd.run(args);
      expect(rejected).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
    }

    // Well-formed flags reach the use-case (manifest-not-found from the fixture).
    const result = await fireRequestCmd.run([
      '/repos/gateway', 'POST', '/users', '--body', '{"a":1}', '--query', 'q=a=b', '--header', 'X-Trace: t1',
    ]);
    expect(result).toMatchObject({ ok: false, error: { code: 'manifest-not-found' } });
  });

  it('fire-request sends the parsed flags as the request body, query and headers', async () => {
    const fetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    try {
      const subcommands = buildTestSubcommands({
        manifest: { load: async () => ok({ service: 'gw', container: 'gw', sharedBranch: 'development', modules: { 'route-explorer': { baseUrl: 'http://localhost:3000' } } }) },
        scanner: { scan: async () => ok([{ method: 'POST', path: '/users/{id}' }]) },
        auth: { getSession: async () => ok({ cookie: 'sid=abc' }) },
      });
      const fireRequestCmd = subcommands.find((subcommand) => subcommand.name === 'fire-request');
      if (!fireRequestCmd) throw new Error('expected fire-request subcommand');

      const result = await fireRequestCmd.run([
        '/repos/gateway', 'POST', '/users/7', '--body', '{"a":1}', '--query', 'q=a=b', '--header', 'X-Trace:  t1 ',
      ]);

      expect(result).toMatchObject({ ok: true, data: { status: 200 } });
      const [url, init] = fetch.mock.calls[0] ?? [];
      expect(url).toBe('http://localhost:3000/users/7?q=a%3Db');
      expect(init?.body).toBe('{"a":1}');
      const headers = new Headers(init?.headers);
      expect(headers.get('x-trace')).toBe('t1');
      expect(headers.get('content-type')).toBe('application/json');
      expect(headers.get('cookie')).toBe('sid=abc');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('fire-request --save persists the fired request and rejects a colliding name with duplicate-request-name', async () => {
    const fetch = vi.fn(async () => new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    try {
      const saved: SavedRequest[] = [];
      const subcommands = buildTestSubcommands({
        manifest: { load: async () => ok({ service: 'gw', container: 'gw', sharedBranch: 'development', modules: { 'route-explorer': { baseUrl: 'http://localhost:3000' } } }) },
        scanner: { scan: async () => ok([{ method: 'POST', path: '/users' }]) },
        auth: { getSession: async () => ok({ cookie: 'sid=abc' }) },
        savedRequests: {
          ...fakeSavedRequests(),
          get: async (name) => {
            const found = saved.find((item) => item.name === name);
            return found === undefined ? err('saved-request-not-found', `No saved request named "${name}"`) : ok({ ...found });
          },
          save: async (request) => {
            if (saved.some((item) => item.name === request.name)) {
              return err('duplicate-request-name', `A request named "${request.name}" already exists`);
            }
            saved.push({ ...request });
            return ok(request);
          },
        },
      });
      const fireRequestCmd = subcommands.find((subcommand) => subcommand.name === 'fire-request');
      if (!fireRequestCmd) throw new Error('expected fire-request subcommand');

      const first = await fireRequestCmd.run([
        '/repos/gateway',
        'POST',
        '/users',
        '--query',
        'q=1',
        '--header',
        'X-Trace: t1',
        '--body',
        '{"a":1}',
        '--save',
        'create-user',
      ]);
      expect(first).toMatchObject({ ok: true, data: { status: 200 } });
      expect(saved).toHaveLength(1);
      expect(saved[0]).toMatchObject({
        name: 'create-user',
        repoPath: '/repos/gateway',
        method: 'POST',
        path: '/users',
        query: { q: '1' },
        headers: { 'X-Trace': 't1' },
        bodyText: '{"a":1}',
        contentType: 'application/json',
      });

      // A colliding name is rejected before anything is fired: no second fetch, same record kept.
      const callsBefore = fetch.mock.calls.length;
      const second = await fireRequestCmd.run(['/repos/gateway', 'POST', '/users', '--save', 'create-user']);
      expect(second).toMatchObject({ ok: false, error: { code: 'duplicate-request-name' } });
      expect(fetch.mock.calls.length).toBe(callsBefore);
      expect(saved).toHaveLength(1);

      expect(await fireRequestCmd.run(['/repos/gateway', 'GET', '/users', '--save'])).toMatchObject({
        ok: false,
        error: { code: 'invalid-argument' },
      });
      expect(await fireRequestCmd.run(['/repos/gateway', 'GET', '/users', '--save', 'a', '--save', 'b'])).toMatchObject({
        ok: false,
        error: { code: 'invalid-argument' },
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('request-list shows stale flags and narrows with --repo', async () => {
    const subcommands = buildTestSubcommands({
      manifest: { load: async () => ok({ service: 'gw', container: 'gw', sharedBranch: 'development', modules: { 'route-explorer': {} } }) },
      scanner: { scan: async () => ok([{ method: 'GET', path: '/users' }]) },
      savedRequests: {
        ...fakeSavedRequests(),
        list: async () =>
          ok([
            { id: 'id-1', name: 'kept', repoPath: '/repos/gateway', method: 'GET', path: '/users', createdAt: '2026-10-06T00:00:00.000Z', updatedAt: '2026-10-06T00:00:00.000Z' },
            { id: 'id-2', name: 'gone', repoPath: '/repos/gateway', method: 'GET', path: '/vanished', createdAt: '2026-10-06T00:00:00.000Z', updatedAt: '2026-10-06T00:00:00.000Z' },
          ]),
      },
    });
    const requestList = subcommands.find((subcommand) => subcommand.name === 'request-list');
    if (!requestList) throw new Error('expected request-list subcommand');

    const listed = await requestList.run([]);
    expect(listed).toMatchObject({
      ok: true,
      data: { requests: [{ name: 'kept', stale: false }, { name: 'gone', stale: true }] },
    });

    const narrowed = await requestList.run(['--repo', '/repos/other']);
    expect(narrowed).toMatchObject({ ok: true, data: { requests: [] } });

    expect(await requestList.run(['--bogus'])).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
    expect(await requestList.run(['--repo'])).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
  });

  it('request-fire re-fires by name with overrides, persistence flags and the stale hard gate', async () => {
    const fetch = vi.fn(async () => new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    try {
      const subcommands = buildTestSubcommands({
        manifest: { load: async () => ok({ service: 'gw', container: 'gw', sharedBranch: 'development', modules: { 'route-explorer': { baseUrl: 'http://localhost:3000' } } }) },
        scanner: { scan: async () => ok([{ method: 'GET', path: '/users' }]) },
        auth: { getSession: async () => ok({ cookie: 'sid=abc' }) },
        savedRequests: {
          ...fakeSavedRequests(),
          get: async (name) =>
            name === 'list-users'
              ? ok({ id: 'id-1', name, repoPath: '/repos/gateway', method: 'GET', path: '/users', createdAt: '2026-10-06T00:00:00.000Z', updatedAt: '2026-10-06T00:00:00.000Z' })
              : name === 'stale-one'
                ? ok({ id: 'id-2', name, repoPath: '/repos/gateway', method: 'GET', path: '/vanished', createdAt: '2026-10-06T00:00:00.000Z', updatedAt: '2026-10-06T00:00:00.000Z' })
                : err('saved-request-not-found', `No saved request named "${name}"`),
        },
      });
      const requestFire = subcommands.find((subcommand) => subcommand.name === 'request-fire');
      if (!requestFire) throw new Error('expected request-fire subcommand');

      expect(await requestFire.run([])).toMatchObject({ ok: false, error: { code: 'missing-argument' } });
      expect(await requestFire.run(['missing'])).toMatchObject({ ok: false, error: { code: 'saved-request-not-found' } });
      expect(fetch).not.toHaveBeenCalled();

      const fired = await requestFire.run(['list-users', '--query', 'q=1']);
      expect(fired).toMatchObject({ ok: true, data: { status: 200 } });

      const stale = await requestFire.run(['stale-one']);
      expect(stale).toMatchObject({ ok: false, error: { code: 'unknown-route' } });

      expect(await requestFire.run(['list-users', '--overwrite', '--save-as', 'other'])).toMatchObject({
        ok: false,
        error: { code: 'invalid-argument' },
      });
      expect(await requestFire.run(['list-users', '--bogus', 'v'])).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('request-fire --overwrite updates the original and --save-as stores a new record', async () => {
    const fetch = vi.fn(async () => new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    try {
      const rows = new Map<string, SavedRequest>([
        ['base', { id: 'id-1', name: 'base', repoPath: '/repos/gateway', method: 'GET', path: '/users', query: { q: '1' }, createdAt: '2026-10-06T00:00:00.000Z', updatedAt: '2026-10-06T00:00:00.000Z' }],
        ['taken', { id: 'id-2', name: 'taken', repoPath: '/repos/gateway', method: 'GET', path: '/users', createdAt: '2026-10-06T00:00:00.000Z', updatedAt: '2026-10-06T00:00:00.000Z' }],
      ]);
      const overwritten: string[] = [];
      const created: string[] = [];
      const subcommands = buildTestSubcommands({
        manifest: { load: async () => ok({ service: 'gw', container: 'gw', sharedBranch: 'development', modules: { 'route-explorer': { baseUrl: 'http://localhost:3000' } } }) },
        scanner: { scan: async () => ok([{ method: 'GET', path: '/users' }]) },
        auth: { getSession: async () => ok({ cookie: 'sid=abc' }) },
        savedRequests: {
          ...fakeSavedRequests(),
          save: async (request) => {
            created.push(request.name);
            const record = { ...request };
            rows.set(request.name, record);
            return ok(record);
          },
          overwrite: async (name, request) => {
            overwritten.push(name);
            const existing = rows.get(name);
            if (existing === undefined) {
              return err('saved-request-not-found', `No saved request named "${name}"`);
            }
            const next = { ...request, id: existing.id, createdAt: existing.createdAt, name };
            rows.set(name, next);
            return ok(next);
          },
          get: async (name) => {
            const found = rows.get(name);
            return found === undefined ? err('saved-request-not-found', `No saved request named "${name}"`) : ok({ ...found });
          },
        },
      });
      const requestFire = subcommands.find((subcommand) => subcommand.name === 'request-fire');
      if (!requestFire) throw new Error('expected request-fire subcommand');

      const updated = await requestFire.run(['base', '--query', 'q=2', '--overwrite']);
      expect(updated).toMatchObject({ ok: true, data: { status: 200 } });
      expect(overwritten).toEqual(['base']);
      expect(rows.get('base')).toMatchObject({ query: { q: '2' } });

      const forked = await requestFire.run(['base', '--query', 'q=3', '--save-as', 'copy']);
      expect(forked).toMatchObject({ ok: true, data: { status: 200 } });
      expect(created).toEqual(['copy']);
      expect(rows.get('copy')).toMatchObject({ name: 'copy', query: { q: '3' } });
      expect(rows.get('base')).toMatchObject({ query: { q: '2' } });

      const callsBefore = fetch.mock.calls.length;
      const collision = await requestFire.run(['base', '--save-as', 'taken']);
      expect(collision).toMatchObject({ ok: false, error: { code: 'duplicate-request-name' } });
      expect(fetch.mock.calls.length).toBe(callsBefore);
      expect(created).toEqual(['copy']);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('request-delete removes by exact name and reports unknown names', async () => {
    const removed: string[] = [];
    const subcommands = buildTestSubcommands({
      savedRequests: {
        ...fakeSavedRequests(),
        remove: async (name) =>
          name === 'list-users' ? (removed.push(name), ok(undefined)) : err('saved-request-not-found', `No saved request named "${name}"`),
      },
    });
    const requestDelete = subcommands.find((subcommand) => subcommand.name === 'request-delete');
    if (!requestDelete) throw new Error('expected request-delete subcommand');

    expect(await requestDelete.run([])).toMatchObject({ ok: false, error: { code: 'missing-argument' } });
    expect(await requestDelete.run(['a', 'b'])).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
    expect(await requestDelete.run(['missing'])).toMatchObject({ ok: false, error: { code: 'saved-request-not-found' } });
    expect(await requestDelete.run(['list-users'])).toEqual({ ok: true, data: { name: 'list-users' } });
    expect(removed).toEqual(['list-users']);
  });

});
