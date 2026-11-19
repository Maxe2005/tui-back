// tui/shared/components/json-tree/body-draft: body draft seeding/gating/pruning and the editor status
// line.
import { BodyEditError, MAX_BODY_DRAFTS } from './body-edit-path.js';

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
