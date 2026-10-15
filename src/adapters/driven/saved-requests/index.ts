// adapters/driven/saved-requests: the driven SavedRequestPort over the global sqlite store
// at `<dataDir>/global.db`. The schema ships as hand-rolled numbered SQL (`schema-001.sql`,
// applied with `CREATE TABLE IF NOT EXISTS` on every open plus a `schema_version` row); the
// file carries only `saved_requests` — later columns arrive with their own numbered file.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { err, ok, type Result } from '../../../core/result.js';
import type { SavedRequest, SavedRequestPort } from '../../../core/ports/saved-request.js';
import type { XdgPaths } from '../xdg/index.js';
import { ensureXdgDir } from '../xdg/index.js';

export function resolveGlobalDbFile(xdg: XdgPaths): string {
  return join(xdg.dataDir, 'global.db');
}

const SCHEMA_SQL: string = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'schema-001.sql'), 'utf8');

type SavedRow = {
  id: string;
  name: string;
  repo_path: string;
  method: string;
  path: string;
  query: string | null;
  headers: string | null;
  body_text: string | null;
  content_type: string | null;
  tree_state: string | null;
  created_at: string;
  updated_at: string;
};

function parseJsonColumn(raw: string | null, column: string, name: string): Record<string, string> | undefined {
  if (raw === null) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Saved request "${name}" has corrupt ${column}: ${reason}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Saved request "${name}" has corrupt ${column}: expected a JSON object`);
  }
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== 'string') {
      throw new Error(`Saved request "${name}" has corrupt ${column}: value for "${key}" is not a string`);
    }
  }
  return parsed as Record<string, string>;
}

function parseTreeState(raw: string | null): unknown {
  if (raw === null) {
    return undefined;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function toSavedRequest(row: SavedRow): SavedRequest {
  const request: SavedRequest = {
    id: row.id,
    name: row.name,
    repoPath: row.repo_path,
    method: row.method,
    path: row.path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  const query = parseJsonColumn(row.query, 'query', row.name);
  if (query !== undefined) {
    request.query = query;
  }
  const headers = parseJsonColumn(row.headers, 'headers', row.name);
  if (headers !== undefined) {
    request.headers = headers;
  }
  if (row.body_text !== null) {
    request.bodyText = row.body_text;
  }
  if (row.content_type !== null) {
    request.contentType = row.content_type;
  }
  const treeState = parseTreeState(row.tree_state);
  if (treeState !== undefined) {
    request.treeState = treeState;
  }
  return request;
}

function stringifyColumn(value: Record<string, string> | undefined): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

function stringifyTreeState(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

function storeError(action: string, dbPath: string, error: unknown): Result<never> {
  const detail = error instanceof Error ? error.message : String(error);
  return err('saved-request-store-error', `Failed to ${action} saved request in ${dbPath}: ${detail}`);
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error as { code?: unknown }).code === 'SQLITE_CONSTRAINT_UNIQUE';
}

function openDb(dbPath: string): Database.Database {
  ensureXdgDir(dirname(dbPath));
  const db = new Database(dbPath);
  db.exec(SCHEMA_SQL);
  return db;
}

export function createSavedRequestPort(dbPath: string): SavedRequestPort {
  return {
    save: (request) => saveRequest(dbPath, request),
    overwrite: (name, request) => overwriteRequest(dbPath, name, request),
    get: (name) => getRequest(dbPath, name),
    list: () => listRequests(dbPath),
    remove: (name) => removeRequest(dbPath, name),
  };
}

function saveRequest(dbPath: string, request: SavedRequest): Promise<Result<SavedRequest>> {
  let db: Database.Database | null = null;
  try {
    db = openDb(dbPath);
    db.prepare(
      'INSERT INTO saved_requests (id, name, repo_path, method, path, query, headers, body_text, content_type, tree_state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      request.id,
      request.name,
      request.repoPath,
      request.method,
      request.path,
      stringifyColumn(request.query),
      stringifyColumn(request.headers),
      request.bodyText ?? null,
      request.contentType ?? null,
      stringifyTreeState(request.treeState),
      request.createdAt,
      request.updatedAt,
    );
    return Promise.resolve(ok({ ...request }));
  } catch (error) {
    if (isUniqueViolation(error)) {
      return Promise.resolve(err('duplicate-request-name', `A request named "${request.name}" already exists: choose a different name`));
    }
    return Promise.resolve(storeError('save', dbPath, error));
  } finally {
    try {
      db?.close();
    } catch {
      // Best-effort close on the way out — the Result above already carries the outcome.
    }
  }
}

function overwriteRequest(dbPath: string, name: string, request: SavedRequest): Promise<Result<SavedRequest>> {
  let db: Database.Database | null = null;
  try {
    db = openDb(dbPath);
    // Identity columns (id, name, created_at) are never written: the name stays the lookup
    // key, so a mismatched caller payload cannot rewrite them.
    const result = db
      .prepare(
        'UPDATE saved_requests SET repo_path = ?, method = ?, path = ?, query = ?, headers = ?, body_text = ?, content_type = ?, tree_state = ?, updated_at = ? WHERE name = ?',
      )
      .run(
        request.repoPath,
        request.method,
        request.path,
        stringifyColumn(request.query),
        stringifyColumn(request.headers),
        request.bodyText ?? null,
        request.contentType ?? null,
        stringifyTreeState(request.treeState),
        request.updatedAt,
        name,
      );
    if (result.changes === 0) {
      return Promise.resolve(err('saved-request-not-found', `No saved request named "${name}"`));
    }
    const row = db.prepare('SELECT * FROM saved_requests WHERE name = ?').get(name) as SavedRow | undefined;
    if (row === undefined) {
      return Promise.resolve(err('saved-request-not-found', `No saved request named "${name}"`));
    }
    return Promise.resolve(ok(toSavedRequest(row)));
  } catch (error) {
    return Promise.resolve(storeError('overwrite', dbPath, error));
  } finally {
    try {
      db?.close();
    } catch {
      // Best-effort close on the way out — the Result above already carries the outcome.
    }
  }
}

function getRequest(dbPath: string, name: string): Promise<Result<SavedRequest>> {
  let db: Database.Database | null = null;
  try {
    db = openDb(dbPath);
    const row = db.prepare('SELECT * FROM saved_requests WHERE name = ?').get(name) as SavedRow | undefined;
    if (row === undefined) {
      return Promise.resolve(err('saved-request-not-found', `No saved request named "${name}"`));
    }
    return Promise.resolve(ok(toSavedRequest(row)));
  } catch (error) {
    return Promise.resolve(storeError('read', dbPath, error));
  } finally {
    try {
      db?.close();
    } catch {
      // Best-effort close on the way out — the Result above already carries the outcome.
    }
  }
}

function listRequests(dbPath: string): Promise<Result<SavedRequest[]>> {
  let db: Database.Database | null = null;
  try {
    db = openDb(dbPath);
    const rows = db.prepare('SELECT * FROM saved_requests ORDER BY name ASC').all() as SavedRow[];
    return Promise.resolve(ok(rows.map(toSavedRequest)));
  } catch (error) {
    return Promise.resolve(storeError('list', dbPath, error));
  } finally {
    try {
      db?.close();
    } catch {
      // Best-effort close on the way out — the Result above already carries the outcome.
    }
  }
}

function removeRequest(dbPath: string, name: string): Promise<Result<void>> {
  let db: Database.Database | null = null;
  try {
    db = openDb(dbPath);
    const result = db.prepare('DELETE FROM saved_requests WHERE name = ?').run(name);
    if (result.changes === 0) {
      return Promise.resolve(err('saved-request-not-found', `No saved request named "${name}"`));
    }
    return Promise.resolve(ok(undefined));
  } catch (error) {
    return Promise.resolve(storeError('delete', dbPath, error));
  } finally {
    try {
      db?.close();
    } catch {
      // Best-effort close on the way out — the Result above already carries the outcome.
    }
  }
}
