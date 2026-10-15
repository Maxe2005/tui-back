// tui/zones/dashboard: the pure helpers — body precedence, the "updated Ns ago" wording and the
// field-level error labels.
import { describe, expect, it } from 'vitest';
import type { DashboardService } from '../../../../../core/dashboard/snapshot.js';
import { MIN_TERMINAL_ROWS, SHELL_CHROME_ROWS } from '../../shared/bounds/bounds.js';
import { BANNER_LINES } from './launch-banner.js';
import { branchLabel, containerLabel, formatRegistrySummary, formatUpdatedAgo, resolveDashboardBody, workingTreeLabel } from './dashboard.logic.js';

const FIELD_ERROR = { ok: false as const, error: { code: 'x', message: 'y' } };

describe('resolveDashboardBody', () => {
  it('gives the registry check error precedence over a stale empty flag', () => {
    expect(resolveDashboardBody(true, 'error')).toBe('registry-error');
  });
  it('shows the empty-registry prompt before any snapshot section', () => {
    expect(resolveDashboardBody(true, 'idle')).toBe('empty-registry');
  });
  it('never assumes empty before the check resolves', () => {
    expect(resolveDashboardBody(null, 'loading')).toBe('sections');
    expect(resolveDashboardBody(false, 'idle')).toBe('sections');
  });
});

describe('formatUpdatedAgo', () => {
  it('counts seconds, then minutes, then hours', () => {
    expect(formatUpdatedAgo(5_400, 1_000)).toBe('updated 4s ago');
    expect(formatUpdatedAgo(130_000, 0)).toBe('updated 2m ago');
    expect(formatUpdatedAgo(7_300_000, 0)).toBe('updated 2h ago');
  });
  it('never goes negative on a clock skew', () => {
    expect(formatUpdatedAgo(0, 5_000)).toBe('updated 0s ago');
  });
});

describe('field labels', () => {
  it('marks a failed container probe and keeps no-container distinct from down', () => {
    expect(containerLabel(FIELD_ERROR)).toEqual({ text: 'container error', badge: 'error' });
    expect(containerLabel({ ok: true, value: 'no-container' }).badge).toBe('no-container');
    expect(containerLabel({ ok: true, value: 'down' }).badge).toBe('down');
  });
  it('marks a failed working-tree probe and lists the active flags', () => {
    expect(workingTreeLabel(FIELD_ERROR)).toBe('git error');
    expect(workingTreeLabel({ ok: true, value: { uncommitted: true, mergeInProgress: false, rebaseInProgress: true } })).toBe('uncommitted, rebasing');
    expect(workingTreeLabel({ ok: true, value: { uncommitted: false, mergeInProgress: false, rebaseInProgress: false } })).toBeNull();
  });
  it('labels an unreadable branch', () => {
    const service = { branch: null, divergence: { detail: { code: 'x', message: 'y' } } } as unknown as DashboardService;
    expect(branchLabel(service)).toBe('branch error');
  });
  it('prints every registry count', () => {
    expect(formatRegistrySummary({ repoCount: 5, invalidManifests: 1, unreachable: 2, listingIssues: 0 })).toBe(
      '5 repos · 1 invalid manifests · 2 unreachable · 0 listing issues',
    );
  });
});

describe('fixed banner', () => {
  it('always fits in the content rows left at the minimum terminal height', () => {
    expect(MIN_TERMINAL_ROWS - SHELL_CHROME_ROWS).toBeGreaterThan(BANNER_LINES.length);
  });
});
