// core/routes/saved-requests: save/list/delete/fire over the global saved-request library.
// Saving captures method, path (template form), query, headers and body; firing a saved
// request delegates to `fireRequest` so auth, template-match and cap semantics cannot drift.
// Stale is advisory at list time (a fresh scan per repo); the hard gate stays at fire time,
// where `fireRequest`'s route-exists check rejects a vanished route with `unknown-route`.
import { ulid as generateUlid } from 'ulid';
import type { DevAuthPort } from '../ports/dev-auth.js';
import type { ManifestPort } from '../ports/manifest.js';
import type { Route, RouteScannerPort } from '../ports/route-scanner.js';
import type { SavedRequest, SavedRequestInput, SavedRequestPort } from '../ports/saved-request.js';
import { err, ok, type Result } from '../result.js';
import { fireRequest, type FireRequestOptions, type FireResult } from './fire-request.js';

export type SavedWithStale = SavedRequest & { stale: boolean };

export interface FireSavedOverrides {
  body?: unknown;
  query?: Record<string, string>;
  headers?: Record<string, string>;
}

export interface FireSavedSaveOptions {
  overwrite?: boolean;
  saveAs?: string;
}

function stripSingleTrailingSlash(value: string): string {
  return value.length > 1 && value.endsWith('/') ? value.slice(0, -1) : value;
}

const TEMPLATE_PARAM = /\{[^/{}]+\}/g;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchTemplate(template: string, concrete: string): number | null {
  const templateSegments = template.split('/');
  const concreteSegments = concrete.split('/');
  if (templateSegments.length !== concreteSegments.length) {
    return null;
  }
  let params = 0;
  for (const [index, segment] of templateSegments.entries()) {
    const candidate = concreteSegments[index] ?? '';
    if (!segment.includes('{')) {
      if (segment !== candidate) {
        return null;
      }
      continue;
    }
    if (candidate === '' || candidate === '.' || candidate === '..') {
      return null;
    }
    const pattern = segment
      .split(TEMPLATE_PARAM)
      .map(escapeRegExp)
      .join('[^/]+');
    if (!new RegExp(`^${pattern}$`).test(candidate)) {
      return null;
    }
    params += 1;
  }
  return params;
}

function isRoutePresent(routes: readonly Route[], method: string, path: string): boolean {
  const normalizedMethod = method.trim().toUpperCase();
  const normalizedPath = stripSingleTrailingSlash(path.trim());
  const sameMethod = routes.filter((route) => route.method.toUpperCase() === normalizedMethod);
  if (sameMethod.some((route) => stripSingleTrailingSlash(route.path) === normalizedPath)) {
    return true;
  }
  return sameMethod.some((route) => matchTemplate(stripSingleTrailingSlash(route.path), normalizedPath) !== null);
}

function sanitizeMap(entries: Record<string, string> | undefined): Record<string, string> | undefined {
  if (entries === undefined) {
    return undefined;
  }
  const cleaned: Record<string, string> = {};
  for (const [name, value] of Object.entries(entries)) {
    if (typeof name !== 'string' || typeof value !== 'string') {
      continue;
    }
    if (name.trim() === '' || value.trim() === '') {
      continue;
    }
    const lower = name.toLowerCase();
    if (lower === 'cookie' || lower === 'set-cookie') {
      continue;
    }
    cleaned[name] = value;
  }
  return Object.keys(cleaned).length === 0 ? undefined : cleaned;
}

function checkName(name: string): Result<never> | null {
  if (typeof name !== 'string' || name === '') {
    return err('missing-argument', 'A request name is required');
  }
  if (name.trim() === '') {
    return err('invalid-argument', 'The request name must not be blank');
  }
  return null;
}

function checkMethodPath(method: string, path: string): Result<never> | null {
  if (typeof method !== 'string' || method.trim() === '' || typeof path !== 'string' || path.trim() === '') {
    return err('invalid-argument', 'The saved request needs a non-blank method and path');
  }
  if (/[?#]/.test(path.trim())) {
    return err('invalid-argument', 'The saved path must not carry a query or fragment: pass the query separately');
  }
  return null;
}

function toRecord(input: SavedRequestInput, id: string, createdAt: string, updatedAt: string): SavedRequest {
  const record: SavedRequest = {
    id,
    name: input.name.trim(),
    repoPath: input.repoPath.trim(),
    method: input.method.trim().toUpperCase(),
    path: input.path.trim(),
    createdAt,
    updatedAt,
  };
  const query = sanitizeMap(input.query);
  if (query !== undefined) {
    record.query = query;
  }
  const headers = sanitizeMap(input.headers);
  if (headers !== undefined) {
    record.headers = headers;
  }
  if (input.bodyText !== undefined) {
    record.bodyText = input.bodyText;
  }
  if (input.contentType !== undefined) {
    record.contentType = input.contentType;
  }
  if (input.treeState !== undefined) {
    record.treeState = input.treeState;
  }
  return record;
}

export async function saveRequest(
  deps: { store: SavedRequestPort },
  input: SavedRequestInput,
): Promise<Result<SavedRequest>> {
  const nameError = checkName(input.name);
  if (nameError !== null) {
    return nameError;
  }
  if (typeof input.repoPath !== 'string' || input.repoPath.trim() === '') {
    return err('missing-argument', 'The saved request needs a repoPath');
  }
  const methodPathError = checkMethodPath(input.method, input.path);
  if (methodPathError !== null) {
    return methodPathError;
  }
  const now = new Date().toISOString();
  return deps.store.save(toRecord(input, generateUlid(), now, now));
}

export async function overwriteSavedRequest(
  deps: { store: SavedRequestPort },
  name: string,
  input: SavedRequestInput,
): Promise<Result<SavedRequest>> {
  const nameError = checkName(name);
  if (nameError !== null) {
    return nameError;
  }
  if (typeof input.repoPath !== 'string' || input.repoPath.trim() === '') {
    return err('missing-argument', 'The saved request needs a repoPath');
  }
  const methodPathError = checkMethodPath(input.method, input.path);
  if (methodPathError !== null) {
    return methodPathError;
  }
  const existing = await deps.store.get(name.trim());
  if (!existing.ok) {
    return existing;
  }
  const now = new Date().toISOString();
  const next = toRecord({ ...input, name: name.trim() }, existing.data.id, existing.data.createdAt, now);
  return deps.store.overwrite(name.trim(), next);
}

export async function deleteSavedRequest(
  deps: { store: SavedRequestPort },
  name: string,
): Promise<Result<void>> {
  const nameError = checkName(name);
  if (nameError !== null) {
    return nameError;
  }
  return deps.store.remove(name.trim());
}

export async function listSavedRequests(
  deps: { store: SavedRequestPort; manifest?: ManifestPort; scanner?: RouteScannerPort },
  opts: { repoPath?: string } = {},
): Promise<Result<{ requests: SavedWithStale[] }>> {
  const listed = await deps.store.list();
  if (!listed.ok) {
    return listed;
  }
  if (opts.repoPath !== undefined && typeof opts.repoPath !== 'string') {
    return err('invalid-argument', 'The repoPath filter must be a string');
  }
  const wanted = typeof opts.repoPath === 'string' ? opts.repoPath.trim() : undefined;
  const filtered =
    wanted === undefined || wanted === '' ? [...listed.data] : listed.data.filter((item) => item.repoPath === wanted);
  if (deps.manifest === undefined || deps.scanner === undefined) {
    return ok({ requests: filtered.map((request) => ({ ...request, stale: false })) });
  }
  const byRepo = new Map<string, SavedRequest[]>();
  for (const item of filtered) {
    const group = byRepo.get(item.repoPath);
    if (group === undefined) {
      byRepo.set(item.repoPath, [item]);
    } else {
      group.push(item);
    }
  }
  const presence = new Map<string, Set<string>>();
  for (const [repoPath, items] of byRepo) {
    const live = new Set<string>();
    try {
      const loaded = await deps.manifest.load(repoPath);
      if (loaded.ok) {
        const scanned = await deps.scanner.scan(repoPath, loaded.data.modules['route-explorer'] ?? {});
        if (scanned.ok) {
          for (const item of items) {
            if (isRoutePresent(scanned.data, item.method, item.path)) {
              live.add(item.id);
            }
          }
        } else {
          for (const item of items) {
            live.add(item.id);
          }
        }
      } else {
        for (const item of items) {
          live.add(item.id);
        }
      }
    } catch {
      for (const item of items) {
        live.add(item.id);
      }
    }
    presence.set(repoPath, live);
  }
  return ok({
    requests: filtered.map((request) => ({
      ...request,
      stale: !(presence.get(request.repoPath)?.has(request.id) ?? true),
    })),
  });
}

function parseStoredBody(bodyText: string | undefined): Result<unknown> {
  if (bodyText === undefined) {
    return ok(undefined);
  }
  try {
    return ok(JSON.parse(bodyText) as unknown);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return err('invalid-argument', `The saved request body is not valid JSON: ${reason}`);
  }
}

function mergeMaps(
  saved: Record<string, string> | undefined,
  overrides: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (saved === undefined) {
    return sanitizeMap(overrides);
  }
  if (overrides === undefined) {
    return sanitizeMap(saved);
  }
  // Overrides win case-insensitively: a saved entry shadowed by an override in any case is
  // dropped first, so the merged map never carries the same header twice.
  const overrideKeys = new Set(Object.keys(overrides).map((key) => key.toLowerCase()));
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries(saved)) {
    if (!overrideKeys.has(key.toLowerCase())) {
      merged[key] = value;
    }
  }
  for (const [key, value] of Object.entries(overrides)) {
    merged[key] = value;
  }
  return sanitizeMap(merged);
}

function persistError(code: string, message: string, details: unknown, status: number): Result<never> {
  const base = typeof details === 'object' && details !== null && !Array.isArray(details) ? (details as Record<string, unknown>) : {};
  return err(code, message, { ...base, fired: true, status });
}

export async function fireSavedRequest(
  deps: { store: SavedRequestPort; manifest: ManifestPort; scanner: RouteScannerPort; auth: DevAuthPort; fetchFn?: typeof fetch },
  name: string,
  overrides: FireSavedOverrides = {},
  saveOpts: FireSavedSaveOptions = {},
): Promise<Result<FireResult>> {
  const nameError = checkName(name);
  if (nameError !== null) {
    return nameError;
  }
  if (saveOpts.overwrite === true && saveOpts.saveAs !== undefined) {
    return err('invalid-argument', 'Choose either --overwrite or --save-as <name>, not both');
  }
  if (saveOpts.saveAs !== undefined) {
    const collisionError = checkName(saveOpts.saveAs);
    if (collisionError !== null) {
      return collisionError;
    }
    const collision = await deps.store.get(saveOpts.saveAs.trim());
    if (collision.ok) {
      return err('duplicate-request-name', `A request named "${saveOpts.saveAs.trim()}" already exists: choose a different name`);
    }
    if (!collision.ok && collision.error.code !== 'saved-request-not-found') {
      return collision;
    }
  }
  const loaded = await deps.store.get(name.trim());
  if (!loaded.ok) {
    return loaded;
  }
  const saved = loaded.data;
  const parsedBody = parseStoredBody(saved.bodyText);
  if (!parsedBody.ok) {
    return parsedBody;
  }
  const body = overrides.body !== undefined ? overrides.body : parsedBody.data;
  const options: FireRequestOptions = {};
  const query = mergeMaps(saved.query, overrides.query);
  if (query !== undefined) {
    options.query = query;
  }
  const headers = mergeMaps(saved.headers, overrides.headers);
  if (headers !== undefined) {
    options.headers = headers;
  }
  if (body !== undefined) {
    options.body = body;
  }
  const fired = await fireRequest(
    { manifest: deps.manifest, scanner: deps.scanner, auth: deps.auth, ...(deps.fetchFn === undefined ? {} : { fetchFn: deps.fetchFn }) },
    saved.repoPath,
    saved.method,
    saved.path,
    options,
  );
  if (!fired.ok) {
    return fired;
  }
  if (saveOpts.overwrite === true) {
    const now = new Date().toISOString();
    const next: SavedRequest = { ...saved, updatedAt: now };
    if (query === undefined) {
      delete next.query;
    } else {
      next.query = query;
    }
    if (headers === undefined) {
      delete next.headers;
    } else {
      next.headers = headers;
    }
    // Bodies are JSON-only: an overridden body is stored as JSON, a cleared body drops the
    // content type with it, and an untouched body keeps what the record already had.
    if (body === undefined) {
      delete next.bodyText;
      delete next.contentType;
    } else {
      next.bodyText = JSON.stringify(body);
      next.contentType = overrides.body !== undefined ? 'application/json' : saved.contentType;
      if (next.contentType === undefined) {
        delete next.contentType;
      }
    }
    const persisted = await deps.store.overwrite(name.trim(), next);
    if (!persisted.ok) {
      return persistError(persisted.error.code, persisted.error.message, persisted.error.details, fired.data.status);
    }
  } else if (saveOpts.saveAs !== undefined) {
    const now = new Date().toISOString();
    const record: SavedRequest = {
      id: generateUlid(),
      name: saveOpts.saveAs.trim(),
      repoPath: saved.repoPath,
      method: saved.method,
      path: saved.path,
      createdAt: now,
      updatedAt: now,
    };
    if (query !== undefined) {
      record.query = query;
    }
    if (headers !== undefined) {
      record.headers = headers;
    }
    if (body !== undefined) {
      record.bodyText = JSON.stringify(body);
      const contentType = overrides.body !== undefined ? 'application/json' : saved.contentType;
      if (contentType !== undefined) {
        record.contentType = contentType;
      }
    }
    if (saved.treeState !== undefined) {
      record.treeState = saved.treeState;
    }
    const persisted = await deps.store.save(record);
    if (!persisted.ok) {
      return persistError(persisted.error.code, persisted.error.message, persisted.error.details, fired.data.status);
    }
  }
  return fired;
}
