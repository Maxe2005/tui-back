// tui/zones/update: pure helpers of the incident queue popup — row formatting, age
// and the list-mode key reducer. Rendering lives in update-incidents-dialog.tsx.
import type { UpdateIncident } from '../../store/slices/update-slice.js';

export const UPDATE_INCIDENTS_TITLE = 'UPDATE INCIDENTS';

const KIND_LABELS: Record<UpdateIncident['blocker']['kind'], string> = {
  'dirty-worktree': 'dirty worktree',
  'merge-conflict': 'merge conflict',
  'mid-merge': 'mid-merge',
  'mid-rebase': 'mid-rebase',
  'shared-types-phase-failed': 'shared-types phase failed',
};

export function formatIncidentKind(kind: UpdateIncident['blocker']['kind']): string {
  return KIND_LABELS[kind];
}

// "12s", "3m", "1h" — coarse on purpose, the queue re-renders on a slow tick.
export function formatIncidentAge(now: number, raisedAt: number): string {
  const seconds = Math.max(0, Math.floor((now - raisedAt) / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h`;
}

// One list row: service, kind, age — plus a `still blocked` marker once a re-verification failed.
export function formatIncidentRow(incident: UpdateIncident, now: number): string {
  const marker = incident.stillBlocked !== undefined ? ' · still blocked' : '';
  return `${incident.blocker.service} · ${formatIncidentKind(incident.blocker.kind)} · ${formatIncidentAge(now, incident.raisedAt)}${marker}`;
}

export type IncidentListKey = { upArrow?: boolean; downArrow?: boolean; return?: boolean; escape?: boolean };

export type IncidentListStep =
  | { type: 'move'; index: number }
  | { type: 'open-menu' }
  | { type: 'close' }
  | { type: 'ignore' };

export function reduceIncidentListKey(key: IncidentListKey, index: number, count: number): IncidentListStep {
  if (key.escape === true) {
    return { type: 'close' };
  }
  if (key.return === true) {
    return count > 0 ? { type: 'open-menu' } : { type: 'ignore' };
  }
  if (key.upArrow === true) {
    return { type: 'move', index: Math.max(0, index - 1) };
  }
  if (key.downArrow === true) {
    return { type: 'move', index: Math.min(Math.max(count - 1, 0), index + 1) };
  }
  return { type: 'ignore' };
}

// The quit confirmation's extra sentence: how many services wait on the developer and how many
// are still in flight. Null when nothing is pending and nothing runs.
export function formatQuitRunCounts(pending: number, inFlight: number): string | null {
  if (pending === 0 && inFlight === 0) {
    return null;
  }
  return `${pending} incident${pending === 1 ? '' : 's'} pending, ${inFlight} service${inFlight === 1 ? '' : 's'} in flight.`;
}
