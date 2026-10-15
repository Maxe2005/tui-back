import { describe, expect, it } from 'vitest';
import type { UpdateIncident } from '../../store/slices/update-slice.js';
import {
  formatIncidentAge,
  formatIncidentKind,
  formatIncidentRow,
  formatQuitRunCounts,
  reduceIncidentListKey,
} from './update-incidents.logic.js';

const incident = (over: Partial<UpdateIncident> = {}): UpdateIncident => ({
  id: 'i1',
  blocker: { service: 'svc-a', repoPath: '/repo/a', kind: 'dirty-worktree' },
  raisedAt: 0,
  ...over,
});

describe('update incident queue logic', () => {
  it('formats ages coarsely', () => {
    expect(formatIncidentAge(5_000, 0)).toBe('5s');
    expect(formatIncidentAge(125_000, 0)).toBe('2m');
    expect(formatIncidentAge(7_300_000, 0)).toBe('2h');
    expect(formatIncidentAge(0, 5_000)).toBe('0s');
  });

  it('formats a row with service, kind and age, plus the still-blocked marker', () => {
    expect(formatIncidentRow(incident(), 12_000)).toBe('svc-a · dirty worktree · 12s');
    expect(formatIncidentRow(incident({ stillBlocked: { reason: 'x' } }), 12_000)).toContain('still blocked');
  });

  it('list keys: arrows clamp, Enter opens the menu, Esc closes without resolving', () => {
    expect(reduceIncidentListKey({ downArrow: true }, 0, 3)).toEqual({ type: 'move', index: 1 });
    expect(reduceIncidentListKey({ downArrow: true }, 2, 3)).toEqual({ type: 'move', index: 2 });
    expect(reduceIncidentListKey({ upArrow: true }, 0, 3)).toEqual({ type: 'move', index: 0 });
    expect(reduceIncidentListKey({ return: true }, 1, 3)).toEqual({ type: 'open-menu' });
    expect(reduceIncidentListKey({ return: true }, 0, 0)).toEqual({ type: 'ignore' });
    expect(reduceIncidentListKey({ escape: true }, 1, 3)).toEqual({ type: 'close' });
    expect(reduceIncidentListKey({}, 1, 3)).toEqual({ type: 'ignore' });
  });

  it('quit counts name pending and in-flight, null when nothing runs', () => {
    expect(formatQuitRunCounts(0, 0)).toBeNull();
    expect(formatQuitRunCounts(1, 2)).toBe('1 incident pending, 2 services in flight.');
    expect(formatQuitRunCounts(2, 1)).toBe('2 incidents pending, 1 service in flight.');
  });
});

describe('shared-types phase incident', () => {
  it('has its own kind label and row', () => {
    expect(formatIncidentKind('shared-types-phase-failed')).toBe('shared-types phase failed');
    const row = formatIncidentRow(
      incident({ blocker: { service: 'svc-a', repoPath: '/repo/a', kind: 'shared-types-phase-failed', message: 'boom' } }),
      5_000,
    );
    expect(row).toBe('svc-a · shared-types phase failed · 5s');
  });
});

