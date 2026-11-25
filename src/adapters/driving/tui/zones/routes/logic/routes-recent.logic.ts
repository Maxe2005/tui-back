// tui/zones/routes/logic: the Recent section's pure logic — repo filtering, MRU upsert, row label,
// cursor movement, the Tab focus cycle and the never-fired test. Kept out of the zone so every
// keystroke outcome is unit-testable without Ink.
import { resolve } from 'node:path';
import type { RecentRoute } from '../../../store/slices/workspace/routes-slice.js';
import { moveRoutesSelection, type RoutesSelectionDirection } from './routes-zone.logic.js';
import { clampFavoriteCursor } from './routes-favorites.logic.js';

export const MAX_RECENT_ROUTES = 10;

function normalizePath(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

function sameIdentity(a: RecentRoute, b: RecentRoute): boolean {
  return resolve(a.repoPath) === resolve(b.repoPath) && a.method === b.method && normalizePath(a.path) === normalizePath(b.path);
}

// Only the recents of the displayed repo are listed; null repo lists nothing.
export function visibleRecents(recents: readonly RecentRoute[] | null | undefined, repoPath: string | null): RecentRoute[] {
  if (recents === null || recents === undefined || repoPath === null) {
    return [];
  }
  return recents.filter((recent) => resolve(recent.repoPath) === resolve(repoPath));
}

// Most recent first, one row per identity, capped.
export function upsertRecentRoute(recents: readonly RecentRoute[], entry: RecentRoute): RecentRoute[] {
  return [entry, ...recents.filter((recent) => !sameIdentity(recent, entry))].slice(0, MAX_RECENT_ROUTES);
}

// `METHOD path` + dim meta `200 · 42ms`, or the error code when no response came back.
export function formatRecentRow(recent: RecentRoute): { method: string; label: string; meta: string } {
  const meta =
    recent.outcome.kind === 'status' ? `${recent.outcome.status} · ${recent.outcome.durationMs}ms` : recent.outcome.code;
  return { method: recent.method, label: recent.path, meta };
}

export const clampRecentCursor = clampFavoriteCursor;

export function moveRecentCursor(current: number, direction: RoutesSelectionDirection, length: number): number {
  return moveRoutesSelection(clampRecentCursor(current, length), direction, length);
}

// "Never fired" = in neither the responses nor the recents of the displayed repo.
export function hasBeenFired(
  routeKey: string,
  responses: Readonly<Record<string, unknown>>,
  recents: readonly RecentRoute[],
  repoPath: string | null,
): boolean {
  if (Object.prototype.hasOwnProperty.call(responses, routeKey)) {
    return true;
  }
  return visibleRecents(recents, repoPath).some((recent) => `${recent.method} ${recent.path}` === routeKey);
}

// Tab / Shift+Tab over list -> favorites -> recent -> list, skipping a pane that is not rendered.
export function nextListFocus(
  current: 'list' | 'favorites' | 'recent',
  direction: 'next' | 'back',
  available: { favorites: boolean; recent: boolean },
): 'list' | 'favorites' | 'recent' {
  const order: Array<'list' | 'favorites' | 'recent'> = ['list'];
  if (available.favorites) {
    order.push('favorites');
  }
  if (available.recent) {
    order.push('recent');
  }
  const index = order.indexOf(current);
  if (index === -1) {
    return 'list';
  }
  const step = direction === 'next' ? 1 : -1;
  return order[(index + step + order.length) % order.length] ?? 'list';
}
