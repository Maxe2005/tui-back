// adapters/driven/saved-requests: integration tests against a real sqlite file in a temp
// dir — never the real user data. Covers the UNIQUE(name) gate, the in-place overwrite, the
// exact-match get/remove misses and the schema_version row.
import { describe, expect, it, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { createSavedRequestPort, resolveGlobalDbFile } from './index.js';
import type { SavedRequest } from '../../../core/ports/saved-request.js';

const tmpDirs: string[] = [];

afterEach(async () => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

async function makeDbFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tui-back-saved-requests-'));
  tmpDirs.push(dir);
  return join(dir, 'global.db');
}

function record(name: string, overrides: Partial<SavedRequest> = {}): SavedRequest {
  return {
    id: `id-${name}`,
    name,
    repoPath: '/repos/gateway',
    method: 'GET',
    path: '/users',
    createdAt: '2026-10-06T00:00:00.000Z',
    updatedAt: '2026-10-06T00:00:00.000Z',
    ...overrides,
  };
}

describe('saved-requests store', () => {
  it('resolveGlobalDbFile lands at <dataDir>/global.db', () => {
    expect(resolveGlobalDbFile({ configDir: '/c', dataDir: '/d/tui-back', stateDir: '/s', cacheDir: '/h' })).toBe(
      '/d/tui-back/global.db',
    );
  });

  it('round-trips a record with query, headers, body and tree state', async () => {
    const port = createSavedRequestPort(await makeDbFile());
    const saved = record('list-users', {
      query: { q: 'x' },
      headers: { 'X-Trace': 't1' },
      bodyText: '{"a":1}',
      contentType: 'application/json',
      treeState: { selected: 2 },
    });

    expect(await port.save(saved)).toEqual({ ok: true, data: saved });
    expect(await port.get('list-users')).toEqual({ ok: true, data: saved });
  });

  it('rejects a second save of the same name with duplicate-request-name, keeping the first', async () => {
    const port = createSavedRequestPort(await makeDbFile());
    await port.save(record('list-users', { method: 'GET' }));

    const second = await port.save(record('list-users', { method: 'POST' }));

    expect(second).toMatchObject({ ok: false, error: { code: 'duplicate-request-name' } });
    expect(await port.get('list-users')).toMatchObject({ ok: true, data: { method: 'GET' } });
  });

  it('matches names exactly: a different case is a different record', async () => {
    const port = createSavedRequestPort(await makeDbFile());
    await port.save(record('List-Users'));

    expect(await port.get('list-users')).toMatchObject({ ok: false, error: { code: 'saved-request-not-found' } });
    expect(await port.save(record('list-users'))).toMatchObject({ ok: true });
  });

  it('overwrites one name in place, leaving siblings untouched', async () => {
    const port = createSavedRequestPort(await makeDbFile());
    await port.save(record('a', { query: { q: '1' } }));
    await port.save(record('b', { query: { q: '1' } }));

    const next = { ...record('a', { query: { q: '2' } }), updatedAt: '2026-10-07T00:00:00.000Z' };
    expect(await port.overwrite('a', next)).toEqual({ ok: true, data: next });
    expect(await port.get('a')).toMatchObject({ ok: true, data: { query: { q: '2' } } });
    expect(await port.get('b')).toMatchObject({ ok: true, data: { query: { q: '1' } } });
  });

  it('overwrite of an unknown name fails with saved-request-not-found', async () => {
    const port = createSavedRequestPort(await makeDbFile());

    expect(await port.overwrite('missing', record('missing'))).toMatchObject({
      ok: false,
      error: { code: 'saved-request-not-found' },
    });
  });

  it('lists records ordered by name and removes exactly one entry', async () => {
    const port = createSavedRequestPort(await makeDbFile());
    await port.save(record('b'));
    await port.save(record('a'));

    const listed = await port.list();
    expect(listed.ok).toBe(true);
    if (listed.ok) {
      expect(listed.data.map((item: SavedRequest) => item.name)).toEqual(['a', 'b']);
    }
    expect(await port.remove('a')).toEqual({ ok: true, data: undefined });
    const remaining = await port.list();
    expect(remaining.ok).toBe(true);
    if (remaining.ok) {
      expect(remaining.data.map((item: SavedRequest) => item.name)).toEqual(['b']);
    }
    expect(await port.remove('a')).toMatchObject({ ok: false, error: { code: 'saved-request-not-found' } });
  });

  it('creates the schema_version row on open, exactly once', async () => {
    const dbFile = await makeDbFile();
    const port = createSavedRequestPort(dbFile);
    await port.save(record('a'));
    await port.save(record('b'));

    const db = new Database(dbFile);
    try {
      const versions = db.prepare('SELECT version FROM schema_version').all() as Array<{ version: number }>;
      expect(versions).toEqual([{ version: 1 }]);
    } finally {
      db.close();
    }
  });
});

describe('saved-requests store defenses', () => {
  function seedRawRow(dbFile: string, name: string, query: string | null): void {
    // The schema is created on port open, so touch the port once before writing raw rows.
    const db = new Database(dbFile);
    try {
      db.exec('CREATE TABLE IF NOT EXISTS saved_requests (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, repo_path TEXT NOT NULL, method TEXT NOT NULL, path TEXT NOT NULL, query TEXT, headers TEXT, body_text TEXT, content_type TEXT, tree_state TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)');
      db.prepare(
        'INSERT INTO saved_requests (id, name, repo_path, method, path, query, headers, body_text, content_type, tree_state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(`id-${name}`, name, '/repos/gateway', 'GET', '/users', query, null, null, null, null, '2026-10-06T00:00:00.000Z', '2026-10-06T00:00:00.000Z');
    } finally {
      db.close();
    }
  }

  it('reports corrupt query JSON as a named saved-request-store-error, never a silent drop', async () => {
    const dbFile = await makeDbFile();
    seedRawRow(dbFile, 'corrupt', '{ not json');
    const port = createSavedRequestPort(dbFile);

    const got = await port.get('corrupt');
    expect(got.ok).toBe(false);
    if (!got.ok) {
      expect(got.error.code).toBe('saved-request-store-error');
      expect(got.error.message).toContain('corrupt');
    }
    const listed = await port.list();
    expect(listed).toMatchObject({ ok: false, error: { code: 'saved-request-store-error' } });
  });

  it('rejects a JSON array or non-string values in a map column the same way', async () => {
    const dbFile = await makeDbFile();
    seedRawRow(dbFile, 'array-shape', '["q"]');
    seedRawRow(dbFile, 'scalar-value', '{"q":42}');
    const port = createSavedRequestPort(dbFile);

    expect(await port.get('array-shape')).toMatchObject({ ok: false, error: { code: 'saved-request-store-error' } });
    expect(await port.get('scalar-value')).toMatchObject({ ok: false, error: { code: 'saved-request-store-error' } });
  });

  it('overwrite preserves the stored id, name and createdAt even with a mismatched payload', async () => {
    const port = createSavedRequestPort(await makeDbFile());
    await port.save(record('original'));

    const patched = {
      ...record('renamed-away', { query: { q: '2' } }),
      id: 'id-forged',
      createdAt: '2000-01-01T00:00:00.000Z',
    };
    const result = await port.overwrite('original', patched);

    expect(result.ok).toBe(true);
    expect(await port.get('original')).toMatchObject({
      ok: true,
      data: { id: 'id-original', name: 'original', createdAt: '2026-10-06T00:00:00.000Z', query: { q: '2' } },
    });
    expect(await port.get('renamed-away')).toMatchObject({ ok: false, error: { code: 'saved-request-not-found' } });
  });

  it('indexes repo_path for the per-repo stale scans', async () => {
    const dbFile = await makeDbFile();
    const port = createSavedRequestPort(dbFile);
    await port.save(record('a'));

    const db = new Database(dbFile);
    try {
      const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_saved_requests_repo_path'").all() as Array<{ name: string }>;
      expect(indexes).toEqual([{ name: 'idx_saved_requests_repo_path' }]);
    } finally {
      db.close();
    }
  });
});
