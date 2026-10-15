// tui/zones/dashboard: the pure helpers — body precedence, the "updated Ns ago" wording and the
// field-level error labels.
import { describe, expect, it } from 'vitest';
import type { DashboardService } from '../../../../../core/dashboard/snapshot.js';
import { MIN_TERMINAL_ROWS, SHELL_CHROME_ROWS } from '../../shared/bounds/bounds.js';
import { BANNER_LINES } from './launch-banner.js';
import { buildAttentionItems, formatAttentionLine, moveAttentionCursor, registryAllClear, branchLabel, containerLabel, formatRegistrySummary, formatUpdatedAgo, resolveDashboardBody, workingTreeLabel } from './dashboard.logic.js';

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

function svc(over: Partial<DashboardService>): DashboardService {
  return {
    service: 's',
    path: '/s',
    manifest: { ok: true, value: { sharedBranch: 'development', protectedBranches: [] } },
    container: { ok: true, value: 'up' },
    branch: 'feat/x',
    divergence: { status: 'current', ahead: 0, behind: 0 },
    workingTree: { ok: true, value: { uncommitted: false, mergeInProgress: false, rebaseInProgress: false } },
    protectedBranch: false,
    usedByEdts: [],
    ...over,
  };
}

describe('buildAttentionItems', () => {
  it('orders by severity across services and names service and reason', () => {
    const items = buildAttentionItems([
      svc({ service: 'a', usedByEdts: ['x'] }),
      svc({ service: 'b', divergence: { status: 'current', ahead: 0, behind: 2 } }),
      svc({ service: 'c', protectedBranch: true, branch: 'development' }),
    ]);
    expect(items.map(formatAttentionLine)).toEqual([
      'c · on protected branch development',
      'b · behind by 2',
      'a · branch also used by EDT x',
    ]);
  });
  it('gives one line per reason for the same service', () => {
    const items = buildAttentionItems([
      svc({ protectedBranch: true, workingTree: { ok: true, value: { uncommitted: true, mergeInProgress: false, rebaseInProgress: false } } }),
    ]);
    expect(items.map((item) => item.reason)).toEqual(['protected-branch', 'uncommitted']);
  });
  it('flags no-upstream and offline divergence before the working tree', () => {
    const items = buildAttentionItems([
      svc({ service: 'a', workingTree: { ok: true, value: { uncommitted: true, mergeInProgress: false, rebaseInProgress: false } } }),
      svc({ service: 'b', divergence: { status: 'no-upstream', ahead: null, behind: null } }),
      svc({ service: 'c', divergence: { status: 'unknown-offline', ahead: null, behind: null } }),
    ]);
    expect(items.map((item) => item.reason)).toEqual(['no-upstream', 'unknown-offline', 'uncommitted']);
  });
  it('lists behind only when above zero and never turns a probe error into an item', () => {
    expect(buildAttentionItems([svc({ divergence: { status: 'current', ahead: 0, behind: 0 } }), svc({ divergence: { status: 'current', ahead: null, behind: null } })])).toEqual([]);
    expect(
      buildAttentionItems([svc({ workingTree: FIELD_ERROR, divergence: { status: 'current', ahead: null, behind: null, detail: { code: 'x', message: 'y' } } })]),
    ).toEqual([]);
  });
});

describe('registry and cursor helpers', () => {
  it('detects an all-clear registry', () => {
    expect(registryAllClear({ repoCount: 4, invalidManifests: 0, unreachable: 0, listingIssues: 0 })).toBe(true);
    expect(registryAllClear({ repoCount: 4, invalidManifests: 0, unreachable: 1, listingIssues: 0 })).toBe(false);
  });
  it('clamps the attention cursor', () => {
    expect(moveAttentionCursor(0, -1, 3)).toBe(0);
    expect(moveAttentionCursor(2, 1, 3)).toBe(2);
    expect(moveAttentionCursor(0, 1, 0)).toBe(0);
  });
});
