// tui/shared/components/json-tree/body-edit-path: the body-edit layer's immutable ops over a JSON
// draft (set/add/remove/change-type at a path), scalar validators, concrete-path parsing and
// raw-buffer parsing with line/column.
import { kindOf } from './tree-build.js';

export const MAX_BODY_DRAFTS = 50;

export type JsonScalarKind = 'string' | 'number' | 'boolean' | 'null';

// An invalid draft entry: the display reason plus the scalar kind the value held before
// the error (the draft itself holds the raw text, usually a string).
export type BodyEditError = { reason: string; kind: JsonScalarKind };

export type ScalarValidation = { ok: true; value: unknown } | { ok: false; reason: string };

export type EditResult = { ok: true; value: unknown } | { ok: false; reason: string; value: unknown };

export type RawParseResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: string; line: number; column: number; position: number };

export type JsonPathSegment = { type: 'key'; key: string } | { type: 'index'; index: number };

// Scalar entry validation against its kind (never coerced): strings always valid,
// numbers must JSON-parse to a finite number, booleans must be `true`/`false`, null
// must be the literal `null` (surrounding whitespace tolerated everywhere).
export function validateScalarText(kind: JsonScalarKind, text: string): ScalarValidation {
  switch (kind) {
    case 'string':
      return { ok: true, value: text };
    case 'number': {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return { ok: false, reason: `expected a number, got "${text}"` };
      }
      return typeof parsed === 'number' && Number.isFinite(parsed)
        ? { ok: true, value: parsed }
        : { ok: false, reason: `expected a number, got "${text}"` };
    }
    case 'boolean': {
      const trimmed = text.trim();
      return trimmed === 'true'
        ? { ok: true, value: true }
        : trimmed === 'false'
          ? { ok: true, value: false }
          : { ok: false, reason: `expected true or false, got "${text}"` };
    }
    case 'null':
      return text.trim() === 'null' ? { ok: true, value: null } : { ok: false, reason: `expected null, got "${text}"` };
  }
}

export function scalarKindOf(value: unknown): JsonScalarKind | null {
  switch (kindOf(value)) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'null':
      return 'null';
    default:
      return null;
  }
}

// Reverse of buildNode's escaping: splits a concrete path (`data.items[0].tags`, with
// literal `\`, `.`, `[`, `]` in keys backslash-escaped) into key/index segments.
// Returns null on malformed input (lone trailing backslash, unclosed/non-numeric
// brackets). The empty-string root key collides with the root path itself (`''`) — a
// pre-existing buildNode shape this parser cannot disambiguate; it resolves to the root.
export function parseJsonPath(path: string): JsonPathSegment[] | null {
  if (path === '') {
    return [];
  }
  const segments: JsonPathSegment[] = [];
  let index = 0;
  const length = path.length;
  while (index < length) {
    const char = path[index];
    if (char === '[') {
      let cursor = index + 1;
      let digits = '';
      while (cursor < length && path[cursor] !== ']') {
        digits += path[cursor];
        cursor += 1;
      }
      if (cursor >= length || digits.length === 0 || !/^\d+$/.test(digits)) {
        return null;
      }
      segments.push({ type: 'index', index: Number(digits) });
      index = cursor + 1;
      if (path[index] === '.') {
        index += 1;
        if (index >= length) {
          return null;
        }
      }
      continue;
    }
    if (char === '.') {
      return null;
    }
    let key = '';
    let closed = false;
    while (index < length) {
      const current = path[index];
      if (current === '\\') {
        const next = path[index + 1];
        if (next === undefined) {
          return null;
        }
        key += next;
        index += 2;
        continue;
      }
      if (current === '.' || current === '[') {
        closed = true;
        break;
      }
      if (current === ']') {
        return null;
      }
      key += current;
      index += 1;
    }
    segments.push({ type: 'key', key });
    if (!closed) {
      break;
    }
    if (path[index] === '.') {
      index += 1;
      if (index >= length) {
        return null;
      }
    }
  }
  return segments;
}

function getAtSegments(value: unknown, segments: readonly JsonPathSegment[]): { found: boolean; value: unknown } {
  let current = value;
  for (const segment of segments) {
    if (segment.type === 'key') {
      if (current === null || typeof current !== 'object' || Array.isArray(current)) {
        return { found: false, value: undefined };
      }
      if (!Object.prototype.hasOwnProperty.call(current, segment.key)) {
        return { found: false, value: undefined };
      }
      current = (current as Record<string, unknown>)[segment.key];
    } else {
      if (!Array.isArray(current) || segment.index < 0 || segment.index >= current.length) {
        return { found: false, value: undefined };
      }
      current = current[segment.index];
    }
  }
  return { found: true, value: current };
}

export function getValueAtPath(value: unknown, path: string): { found: boolean; value: unknown } {
  const segments = parseJsonPath(path);
  if (segments === null) {
    return { found: false, value: undefined };
  }
  return getAtSegments(value, segments);
}

function setAtSegments(value: unknown, segments: readonly JsonPathSegment[], next: unknown): { ok: boolean; value: unknown } {
  if (segments.length === 0) {
    return { ok: true, value: next };
  }
  const [head, ...tail] = segments as [JsonPathSegment, ...JsonPathSegment[]];
  if (head.type === 'key') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, value };
    }
    const record = value as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(record, head.key)) {
      return { ok: false, value };
    }
    const child = setAtSegments(record[head.key], tail, next);
    if (!child.ok) {
      return { ok: false, value };
    }
    return { ok: true, value: { ...record, [head.key]: child.value } };
  }
  if (!Array.isArray(value) || head.index < 0 || head.index >= value.length) {
    return { ok: false, value };
  }
  const child = setAtSegments(value[head.index], tail, next);
  if (!child.ok) {
    return { ok: false, value };
  }
  const copy = [...value];
  copy[head.index] = child.value;
  return { ok: true, value: copy };
}

// Immutable scalar/container replacement at a concrete path. The root (`''`) replaces
// the whole draft. Missing paths, type mismatches, and malformed paths fail with the
// original value preserved (never throws, never coerces).
export function setValueAtPath(value: unknown, path: string, next: unknown): EditResult {
  const segments = parseJsonPath(path);
  if (segments === null) {
    return { ok: false, reason: `not a valid path: "${path}"`, value };
  }
  const result = setAtSegments(value, segments, next);
  return result.ok ? { ok: true, value: result.value } : { ok: false, reason: `no editable value at "${path}"`, value };
}

// Structural add under a container path: objects take a caller-provided key (empty and
// duplicate names rejected, prompt stays), arrays append an empty-string item and ignore
// the key. New entries default to `""`. `__proto__`/`constructor`/`prototype` are never
// accepted as key names (prototype-pollution safety), nor are whitespace-only names.
// Scalars, missing paths, and the empty draft fail with the original value preserved.
export function addEntryAtPath(value: unknown, parentPath: string, keyName?: string): EditResult {
  const segments = parseJsonPath(parentPath);
  if (segments === null) {
    return { ok: false, reason: `not a valid path: "${parentPath}"`, value };
  }
  const target = getAtSegments(value, segments);
  if (!target.found) {
    return { ok: false, reason: `no editable value at "${parentPath}"`, value };
  }
  if (Array.isArray(target.value)) {
    const copy = [...(target.value as unknown[]), ''];
    const result = setAtSegments(value, segments, copy);
    return result.ok ? { ok: true, value: result.value } : { ok: false, reason: `no editable value at "${parentPath}"`, value };
  }
  if (target.value !== null && typeof target.value === 'object') {
    const name = keyName ?? '';
    if (name.trim() === '') {
      return { ok: false, reason: 'key name must not be empty', value };
    }
    if (name === '__proto__' || name === 'constructor' || name === 'prototype') {
      return { ok: false, reason: `reserved key name: "${name}"`, value };
    }
    const record = target.value as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(record, name)) {
      return { ok: false, reason: `duplicate key: "${name}"`, value };
    }
    const result = setAtSegments(value, segments, { ...record, [name]: '' });
    return result.ok ? { ok: true, value: result.value } : { ok: false, reason: `no editable value at "${parentPath}"`, value };
  }
  return { ok: false, reason: `can only add to an object or array`, value };
}

const SCALAR_CYCLE: readonly JsonScalarKind[] = ['string', 'number', 'boolean', 'null'];

// Cycle a scalar's kind string → number → boolean → null → string (containers are not
// type-changeable). Conversions: string re-parses as a JSON number — text that does not
// parse falls back to kind string (which always parses), so a type change never leaves
// an error state and the value visibly becomes a string; nonzero numbers become true,
// booleans become null, null becomes `""`. Only missing paths and containers fail, with
// the original value preserved.
export function changeTypeAtPath(value: unknown, path: string): EditResult {
  const segments = parseJsonPath(path);
  if (segments === null) {
    return { ok: false, reason: `not a valid path: "${path}"`, value };
  }
  const target = getAtSegments(value, segments);
  if (!target.found) {
    return { ok: false, reason: `no editable value at "${path}"`, value };
  }
  const kind = scalarKindOf(target.value);
  if (kind === null) {
    return { ok: false, reason: 'only scalar values can change type', value };
  }
  const nextKind = SCALAR_CYCLE[(SCALAR_CYCLE.indexOf(kind) + 1) % SCALAR_CYCLE.length] as JsonScalarKind;
  let next: unknown;
  switch (nextKind) {
    case 'number': {
      const text = target.value as string;
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = undefined;
      }
      next = typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : text;
      break;
    }
    case 'boolean':
      next = (target.value as number) !== 0;
      break;
    case 'null':
      next = null;
      break;
    case 'string':
      next = '';
      break;
  }
  const result = setAtSegments(value, segments, next);
  return result.ok ? { ok: true, value: result.value } : { ok: false, reason: `no editable value at "${path}"`, value };
}

// Resolve the container an `a` keypress adds into: a container selection adds into
// itself, a scalar selection adds into its parent container. Null when there is no
// container (empty draft, scalar root, missing path, scalar parent).
export function resolveAddParentPath(value: unknown, selectedPath: string): string | null {
  if (value === undefined) {
    return null;
  }
  const segments = parseJsonPath(selectedPath);
  if (segments === null) {
    return null;
  }
  const selected = getAtSegments(value, segments);
  if (!selected.found) {
    return null;
  }
  if (selected.value !== null && typeof selected.value === 'object') {
    return selectedPath;
  }
  const parent = parentPathOf(selectedPath);
  if (parent === null) {
    return null;
  }
  const parentSegments = parseJsonPath(parent);
  if (parentSegments === null) {
    return null;
  }
  const resolved = getAtSegments(value, parentSegments);
  if (!resolved.found || resolved.value === null || typeof resolved.value !== 'object') {
    return null;
  }
  return parent;
}

export function parentPathOf(path: string): string | null {
  if (path === '') {
    return null;
  }
  const segments = parseJsonPath(path);
  if (segments === null || segments.length === 0) {
    return null;
  }
  const parentSegments = segments.slice(0, -1);
  if (parentSegments.length === 0) {
    return '';
  }
  return rebuildConcretePath(parentSegments);
}

function escapeRebuild(key: string): string {
  return key.replace(/\\/g, '\\\\').replace(/\./g, '\\.').replace(/\[/g, '\\[').replace(/\]/g, '\\]');
}

export function rebuildConcretePath(segments: readonly JsonPathSegment[]): string {
  let out = '';
  for (const segment of segments) {
    if (segment.type === 'index') {
      out += `[${segment.index}]`;
    } else if (out === '') {
      out = escapeRebuild(segment.key);
    } else {
      out += `.${escapeRebuild(segment.key)}`;
    }
  }
  return out;
}

// Parse a raw-buffer body: valid JSON replaces the draft, anything else keeps the
// developer in raw mode with the parse error plus its 1-based line/column (V8 reports
// the byte offset as `at position N`; messages without one fall back to the buffer end).
export function parseRawJsonBuffer(text: string): RawParseResult {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const match = /position\s+(\d+)/i.exec(message);
    const rawPosition = match?.[1] !== undefined ? Number(match[1]) : text.length;
    const position = Number.isFinite(rawPosition) ? Math.min(Math.max(Math.floor(rawPosition), 0), text.length) : text.length;
    const before = text.slice(0, position);
    const lines = before.split('\n');
    return { ok: false, reason: message, line: lines.length, column: (lines[lines.length - 1] ?? '').length + 1, position };
  }
}
