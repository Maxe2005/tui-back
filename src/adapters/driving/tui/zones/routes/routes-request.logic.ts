// tui/zones/routes/request logic: the Request tab's pure model — path/query/header rows seeded
// from the scanner's parameters, the fire-block rules, and the FireRequestOptions build. The
// body itself stays the route's `bodyDrafts` entry; this file only decides whether and how it
// travels.
import type { Route, RouteParameter } from '../../../../../core/ports/route-scanner.js';
import type { FireRequestOptions } from '../../../../../core/routes/fire-request.js';
import { canEditRouteBody } from '../../shared/components/json-tree/model.js';

export type RequestRow = { name: string; value: string; required: boolean };

export type RequestDraft = { params: RequestRow[]; query: RequestRow[]; headers: RequestRow[] };

export type RequestSection = 'params' | 'query' | 'headers' | 'body';

export type RequestRowSection = Exclude<RequestSection, 'body'>;

export const REQUEST_SECTIONS: readonly RequestSection[] = ['params', 'query', 'headers', 'body'];

export const REQUEST_SECTION_LABELS: Record<RequestSection, string> = {
  params: 'Params',
  query: 'Query',
  headers: 'Headers',
  body: 'Body',
};

export const MAX_REQUEST_DRAFTS = 50;
export const MAX_ROUTE_RESPONSES = 50;

// The body editor's JsonTree state lives under its own key so its folds/selection never
// trample the same route's response tree (both are alive per route).
export function bodyTreeKey(routeKey: string): string {
  return `${routeKey} #body`;
}

// `{name}` segments of a templated path, in path order, deduplicated.
export function extractPathParamNames(path: string): string[] {
  const names: string[] = [];
  for (const match of path.matchAll(/\{([^/{}]+)\}/g)) {
    const name = match[1];
    if (name !== undefined && !names.includes(name)) {
      names.push(name);
    }
  }
  return names;
}

// Scanner examples are plain data: scalars render as their text, anything else as JSON;
// no example is an empty value (never a fabricated one).
export function exampleToText(example: unknown): string {
  if (example === undefined || example === null) {
    return '';
  }
  if (typeof example === 'string') {
    return example;
  }
  if (typeof example === 'number' || typeof example === 'boolean') {
    return String(example);
  }
  try {
    return JSON.stringify(example) ?? '';
  } catch {
    return '';
  }
}

function rowsFor(parameters: readonly RouteParameter[], location: RouteParameter['in']): RequestRow[] {
  return parameters
    .filter((parameter) => parameter.in === location)
    .map((parameter) => ({ name: parameter.name, value: exampleToText(parameter.example), required: parameter.required }));
}

// Path params = the path's own `{name}` segments, in path order, all required (the path
// cannot be built without them), pre-filled from the scanner's matching `in: 'path'`
// example. A scanner path param absent from the template is dropped: it could never be
// substituted, so it must never block a fire. Query/header rows keep the scanner's own
// `required` flag (marked, not enforced).
export function seedRequestDraft(route: Pick<Route, 'path' | 'parameters'>): RequestDraft {
  const parameters = route.parameters ?? [];
  const declared = rowsFor(parameters, 'path');
  const params = extractPathParamNames(route.path).map((name) => ({
    name,
    value: declared.find((row) => row.name === name)?.value ?? '',
    required: true,
  }));
  return { params, query: rowsFor(parameters, 'query'), headers: rowsFor(parameters, 'header') };
}

export function missingRequiredParams(draft: RequestDraft): string[] {
  return draft.params.filter((row) => row.required && row.value.trim() === '').map((row) => row.name);
}

// The reason a fire is blocked (nothing is sent), or null when it may go.
export function resolveFireBlock(draft: RequestDraft, firstBodyError: string | null): string | null {
  const missing = missingRequiredParams(draft);
  if (missing.length > 0) {
    return `Missing required: ${missing.join(', ')} — nothing sent`;
  }
  if (firstBodyError !== null) {
    return `Fix the body first: ${firstBodyError} — nothing sent`;
  }
  return null;
}

// Fills `{name}` segments with URL-encoded values (unknown names stay as-is).
export function substitutePathParams(path: string, params: readonly RequestRow[]): string {
  return path.replace(/\{([^/{}]+)\}/g, (match, name: string) => {
    const row = params.find((candidate) => candidate.name === name);
    return row === undefined || row.value.trim() === '' ? match : encodeURIComponent(row.value.trim());
  });
}

// Same emptiness rule as the path params: a whitespace-only value counts as empty.
function sentRows(rows: readonly RequestRow[]): Record<string, string> | undefined {
  const sent = rows.filter((row) => row.name.trim() !== '' && row.value.trim() !== '');
  if (sent.length === 0) {
    return undefined;
  }
  const record: Record<string, string> = {};
  for (const row of sent) {
    record[row.name] = row.value;
  }
  return record;
}

// What actually travels: empty query/header values are not sent; the body only for a route
// that carries one, with a defined draft, on a method that allows it.
export function buildFireRequest(
  route: Pick<Route, 'method' | 'path' | 'bodyExample' | 'bodyContentType'>,
  draft: RequestDraft,
  bodyDraft: unknown,
): { path: string; options: FireRequestOptions } {
  const options: FireRequestOptions = {};
  const query = sentRows(draft.query);
  if (query !== undefined) {
    options.query = query;
  }
  const headers = sentRows(draft.headers);
  if (headers !== undefined) {
    options.headers = headers;
  }
  const method = route.method.trim().toUpperCase();
  if (canEditRouteBody(route) && bodyDraft !== undefined && method !== 'GET' && method !== 'HEAD') {
    options.body = bodyDraft;
  }
  return { path: substitutePathParams(route.path, draft.params), options };
}

export function addRequestRow(
  rows: readonly RequestRow[],
  name: string,
  caseInsensitive: boolean,
): { ok: true; rows: RequestRow[] } | { ok: false; reason: string } {
  const trimmed = name.trim();
  if (trimmed === '') {
    return { ok: false, reason: 'Name cannot be empty' };
  }
  const same = (candidate: string) =>
    caseInsensitive ? candidate.toLowerCase() === trimmed.toLowerCase() : candidate === trimmed;
  if (rows.some((row) => same(row.name))) {
    return { ok: false, reason: `"${trimmed}" already exists` };
  }
  return { ok: true, rows: [...rows, { name: trimmed, value: '', required: false }] };
}

export function removeRequestRow(rows: readonly RequestRow[], index: number): RequestRow[] {
  return rows.filter((_, candidate) => candidate !== index);
}

export function setRequestRowValue(rows: readonly RequestRow[], index: number, value: string): RequestRow[] {
  return rows.map((row, candidate) => (candidate === index ? { ...row, value } : row));
}

// Index of the route a saved request targets, so the picker can move the list cursor
// onto it before loading its draft — the pane always reflects the cursor's route.
export function resolveRouteIndex(
  routes: readonly Pick<Route, 'method' | 'path'>[],
  method: string,
  path: string,
): number | null {
  const wanted = `${method.trim().toUpperCase()} ${path.trim()}`;
  const found = routes.findIndex(
    (route) => `${route.method.trim().toUpperCase()} ${route.path.trim()}` === wanted,
  );
  return found === -1 ? null : found;
}

// Tab/Shift+Tab cycle the sections (wrapping — unlike the sub-tabs, a section ring).
export function nextRequestSection(current: RequestSection, direction: 'next' | 'back'): RequestSection {
  const index = REQUEST_SECTIONS.indexOf(current);
  const step = direction === 'next' ? 1 : -1;
  const length = REQUEST_SECTIONS.length;
  return REQUEST_SECTIONS[(((index === -1 ? 0 : index) + step) % length + length) % length] as RequestSection;
}

// The section the Request tab opens on: the first one with something to fill, in display
// order; Params when the request has nothing at all.
export function defaultRequestSection(
  route: Pick<Route, 'bodyExample' | 'bodyContentType'>,
  draft: RequestDraft,
): RequestSection {
  if (draft.params.length > 0) {
    return 'params';
  }
  if (draft.query.length > 0) {
    return 'query';
  }
  if (draft.headers.length > 0) {
    return 'headers';
  }
  return canEditRouteBody(route) ? 'body' : 'params';
}

// Response size in bytes (UTF-8), human-sized: `512 B`, `1.5 KB`, `2.0 MB`.
export function formatByteSize(body: string): string {
  const bytes = Buffer.byteLength(body, 'utf8');
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
