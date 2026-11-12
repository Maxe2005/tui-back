// tui/shared/components/json-tree/body-draft: body draft seeding/gating/pruning, the editor status
// line and error-path remapping after a delete.
import { BodyEditError, JsonPathSegment, MAX_BODY_DRAFTS, parseJsonPath, rebuildConcretePath } from './body-edit-path.js';

export type EditableRoute = { bodyExample?: unknown; bodyContentType?: string };

// The editor opens for a route carrying `bodyExample` or any `bodyContentType` (non-JSON
// bodies start empty); routes with neither stay inert with no hint.
export function canEditRouteBody(route: EditableRoute): boolean {
  if (route.bodyExample !== undefined) {
    return true;
  }
  return typeof route.bodyContentType === 'string' && route.bodyContentType.length > 0;
}

function cloneJsonValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    return value;
  }
}

// Lazy per-route seed: a deep clone of the route's `bodyExample`, or `undefined` (empty — press
// `r`) when the route carries only a content type.
export function seedBodyDraft(route: EditableRoute): unknown {
  return route.bodyExample === undefined ? undefined : cloneJsonValue(route.bodyExample);
}

export function pruneBodyDrafts<T>(states: Record<string, T>, limit: number = MAX_BODY_DRAFTS): Record<string, T> {
  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : MAX_BODY_DRAFTS;
  const keys = Object.keys(states);
  if (keys.length <= safeLimit) {
    return states;
  }
  const pruned: Record<string, T> = {};
  for (const key of keys.slice(keys.length - safeLimit)) {
    pruned[key] = states[key] as T;
  }
  return pruned;
}

// First validation error by sorted path (deterministic for the status line); null when
// the route has no invalid entries.
export function firstEditError(errors: Readonly<Record<string, BodyEditError>>): string | null {
  const keys = Object.keys(errors).sort();
  const first = keys[0];
  return first === undefined ? null : (errors[first] as BodyEditError).reason;
}

// Editor status: the first validation error when present, plus `N lines hidden — still
// sent` whenever hiddenCount > 0 (hiding never removes content from the draft).
export function formatBodyEditStatus(firstError: string | null, hiddenCount: number): string {
  const safeHidden = Number.isFinite(hiddenCount) ? Math.max(0, Math.floor(hiddenCount)) : 0;
  const hiddenPart = safeHidden > 0 ? `${safeHidden} ${safeHidden === 1 ? 'line' : 'lines'} hidden — still sent` : null;
  if (firstError !== null && firstError !== '') {
    return hiddenPart !== null ? `✖ ${firstError} · ${hiddenPart}` : `✖ ${firstError}`;
  }
  return hiddenPart ?? '0 lines hidden — still sent';
}

// True when a concrete path falls under a container prefix (exact match, `.child`, or
// `[i]` continuation); the root prefix matches everything.
export function isPathUnderPrefix(path: string, prefix: string): boolean {
  if (prefix === '') {
    return true;
  }
  return path === prefix || path.startsWith(`${prefix}.`) || path.startsWith(`${prefix}[`);
}

// Re-align a per-path error map after deleting `deletedPath`: the removed subtree's
// errors drop, and when an array item is spliced, errors on later siblings shift down
// by one (`scores[2]` becomes `scores[1]`) so they stay pinned to their values.
// Object deletes only drop the subtree (keys never shift). Unparseable paths pass
// through untouched; a malformed deleted path falls back to a plain subtree drop.
export function remapErrorsForDelete<T>(errors: Readonly<Record<string, T>>, deletedPath: string): Record<string, T> {
  const segments = parseJsonPath(deletedPath);
  if (segments === null || segments.length === 0) {
    const kept: Record<string, T> = {};
    for (const [path, entry] of Object.entries(errors)) {
      if (!isPathUnderPrefix(path, deletedPath)) {
        kept[path] = entry;
      }
    }
    return kept;
  }
  const parentSegments = segments.slice(0, -1);
  const last = segments[segments.length - 1] as JsonPathSegment;
  const removedIndex = last.type === 'index' ? last.index : null;
  const remapped: Record<string, T> = {};
  for (const [path, entry] of Object.entries(errors)) {
    if (isPathUnderPrefix(path, deletedPath)) {
      continue;
    }
    if (removedIndex === null) {
      remapped[path] = entry;
      continue;
    }
    const pathSegments = parseJsonPath(path);
    if (pathSegments === null || pathSegments.length <= parentSegments.length) {
      remapped[path] = entry;
      continue;
    }
    const head = pathSegments.slice(0, parentSegments.length);
    if (JSON.stringify(head) !== JSON.stringify(parentSegments)) {
      remapped[path] = entry;
      continue;
    }
    const sibling = pathSegments[parentSegments.length] as JsonPathSegment;
    if (sibling.type !== 'index' || sibling.index <= removedIndex) {
      remapped[path] = entry;
      continue;
    }
    const shifted: JsonPathSegment[] = [
      ...parentSegments,
      { type: 'index', index: sibling.index - 1 },
      ...pathSegments.slice(parentSegments.length + 1),
    ];
    remapped[rebuildConcretePath(shifted)] = entry;
  }
  return remapped;
}
