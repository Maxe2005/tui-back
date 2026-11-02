// tui/zones/dashboard: the pure helpers — body precedence, the "updated Ns ago" wording, the
// field-level error labels, the Attention items (severity order, drift lines for members and
// other services) and the attention cycling that skips lines without a row.
import { describe, expect, it } from 'vitest';
import type { DashboardOtherService, DashboardService } from '../../../../../core/dashboard/snapshot.js';
import { MIN_TERMINAL_ROWS, SHELL_CHROME_ROWS } from '../../shared/bounds/bounds.js';
import { BANNER_LINES } from './launch-banner.js';
import { edtKeyEffect, edtSectionActions, formatEdtAction, formatEdtLine, resolveEdtSection, actionForKey, aheadBehindLabel, disableWhileRunning, issueMarker, reasonLine, branchLabel, containerLabel, formatRegistrySummary, formatUpdatedAgo, resolveDashboardBody, workingTreeLabel, attentionHeader, buildAttentionItems, formatAttentionLine, nextAttentionIndex, registryAllClear, type AttentionItem, rowIndexForAttention } from './dashboard.logic.js';

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

function row(overrides: Partial<DashboardService> = {}): DashboardService {
  return {
    service: 'api',
    path: '/r/api',
    manifest: { ok: true, value: { sharedBranch: 'development', protectedBranches: [] } },
    container: { ok: true, value: 'up' },
    branch: 'feat/x',
    divergence: { status: 'current', ahead: 1, behind: 2 },
    workingTree: { ok: true, value: { uncommitted: false, mergeInProgress: false, rebaseInProgress: false } },
    protectedBranch: false,
    usedByEdts: [],
    expectedBranch: 'feat/x',
    drift: 'aligned',
    ...overrides,
  };
}

describe('row anomalies', () => {
  it('prints no marker and no reason for a healthy row', () => {
    expect(issueMarker(row())).toBe(' ');
    expect(reasonLine(row())).toBeNull();
  });
  it('names every anomaly on the reason line and marks the row', () => {
    const dirty = row({ workingTree: { ok: true, value: { uncommitted: true, mergeInProgress: true, rebaseInProgress: true } } });
    expect(issueMarker(dirty)).toBe('!');
    expect(reasonLine(dirty)).toBe('uncommitted changes · merge in progress · rebase in progress');
  });
  it('surfaces a probe error message, no-upstream and offline', () => {
    expect(reasonLine(row({ workingTree: { ok: false, error: { code: 'g', message: 'not a repo' } } }))).toBe('git error: not a repo');
    expect(reasonLine(row({ divergence: { status: 'no-upstream', ahead: null, behind: null } }))).toBe('no upstream branch');
    expect(reasonLine(row({ divergence: { status: 'unknown-offline', ahead: null, behind: null } }))).toBe('offline: divergence unknown');
  });
});

describe('reasonParts details', () => {
  it('keeps the offline detail message and the manifest error message', () => {
    expect(reasonLine(row({ divergence: { status: 'unknown-offline', ahead: null, behind: null, detail: { code: 'git', message: 'no route to host' } } }))).toBe(
      'offline: no route to host',
    );
    expect(reasonLine(row({ manifest: { ok: false, error: { code: 'manifest-invalid', message: 'bad yaml' } } }))).toBe('manifest error: bad yaml');
    expect(reasonLine(row({ container: { ok: false, error: { code: 'd', message: 'docker down' } } }))).toBe('container error: docker down');
  });
});

describe('aheadBehindLabel', () => {
  it('reads unknown when a current divergence has no counts', () => {
    expect(aheadBehindLabel({ status: 'current', ahead: null, behind: null })).toBe('unknown');
    expect(aheadBehindLabel({ status: 'current', ahead: 0, behind: null })).toBe('unknown');
  });
  it('prints counts, or the explicit no-upstream / offline state', () => {
    expect(aheadBehindLabel({ status: 'current', ahead: 1, behind: 2 })).toBe('↑1 ↓2');
    expect(aheadBehindLabel({ status: 'no-upstream', ahead: null, behind: null })).toBe('no upstream');
    expect(aheadBehindLabel({ status: 'unknown-offline', ahead: null, behind: null })).toBe('offline');
  });
});

describe('action helpers', () => {
  const actions = [
    { id: 'open-in-ide', label: 'Open in IDE', key: 'Ctrl+O', availability: { available: true as const } },
    { id: 'restart-simple', label: 'Restart', key: 'Ctrl+R', availability: { available: true as const } },
  ];
  it('disables every action with "operation in progress" while one runs', () => {
    expect(disableWhileRunning(actions, true).map((a) => a.availability)).toEqual([
      { available: false, reason: 'operation in progress' },
      { available: false, reason: 'operation in progress' },
    ]);
    expect(disableWhileRunning(actions, false)).toEqual(actions);
  });
  it('matches an action by its displayed Ctrl key', () => {
    expect(actionForKey(actions, 'r')?.id).toBe('restart-simple');
    expect(actionForKey(actions, 'x')).toBeUndefined();
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
    expectedBranch: 'feat/x',
    drift: 'aligned',
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
  const other = (over: Partial<DashboardOtherService>): DashboardOtherService => ({
    service: 'o',
    path: '/o',
    branch: 'hotfix',
    expectedBranch: 'develop',
    drift: 'drifted',
    ...over,
  });
  it('ranks drift right after protected branch, members then others, counted as items', () => {
    const items = buildAttentionItems(
      [
        svc({ service: 'a', divergence: { status: 'current', ahead: 0, behind: 3 } }),
        svc({ service: 'b', branch: 'main', drift: 'drifted' }),
        svc({ service: 'c', protectedBranch: true, branch: 'development', drift: 'drifted' }),
      ],
      [other({}), other({ service: 'p', path: '/p', drift: 'aligned', branch: 'develop' })],
    );
    expect(items.map(formatAttentionLine)).toEqual([
      'c · on protected branch development',
      'b · on main, expected feat/x (EDT member)',
      'c · on development, expected feat/x (EDT member)',
      'o · on hotfix, expected develop (other service)',
      'a · behind by 3',
    ]);
    expect(items.map((item) => item.focusable)).toEqual([true, true, true, false, true]);
  });
  it('shows a detached HEAD as drift without an unknown-divergence line, and never an unknown drift', () => {
    const detached = svc({
      branch: null,
      drift: 'drifted',
      divergence: { status: 'unknown-offline', ahead: null, behind: null, detail: { code: 'git-detached-head', message: 'detached' } },
    });
    const items = buildAttentionItems([detached], [other({ branch: null }), other({ service: 'u', path: '/u', branch: null, drift: 'unknown' })]);
    expect(items.map(formatAttentionLine)).toEqual([
      's · on detached HEAD, expected feat/x (EDT member)',
      'o · on detached HEAD, expected develop (other service)',
    ]);
    const failed = svc({ branch: null, drift: 'unknown', divergence: { status: 'unknown-offline', ahead: null, behind: null } });
    expect(buildAttentionItems([failed]).map((item) => item.reason)).toEqual(['unknown-offline']);
  });
  it('points each item at its row by path, so equal service names stay apart', () => {
    const rows = [svc({ service: 'a', path: '/1' }), svc({ service: 'a', path: '/2', usedByEdts: ['x'] })];
    const [item] = buildAttentionItems(rows);
    expect(rowIndexForAttention(rows, item!)).toBe(1);
  });
});

describe('registry and attention cursor helpers', () => {
  it('detects an all-clear registry', () => {
    expect(registryAllClear({ repoCount: 4, invalidManifests: 0, unreachable: 0, listingIssues: 0 })).toBe(true);
    expect(registryAllClear({ repoCount: 4, invalidManifests: 0, unreachable: 1, listingIssues: 0 })).toBe(false);
    expect(registryAllClear({ repoCount: 0, invalidManifests: 0, unreachable: 0, listingIssues: 0 })).toBe(false);
  });
  const line = (focusable: boolean): AttentionItem => ({ service: 's', path: '/s', reason: 'drift', text: 't', focusable });
  it('cycles through the attention lines, starting at the first', () => {
    const three = [line(true), line(true), line(true)];
    expect(nextAttentionIndex(null, three)).toBe(0);
    expect(nextAttentionIndex(0, three)).toBe(1);
    expect(nextAttentionIndex(2, three)).toBe(0);
    expect(nextAttentionIndex(null, [])).toBeNull();
  });
  it('skips lines with no services-table row', () => {
    const items = [line(false), line(true), line(false), line(true)];
    expect(nextAttentionIndex(null, items)).toBe(1);
    expect(nextAttentionIndex(1, items)).toBe(3);
    expect(nextAttentionIndex(3, items)).toBe(1);
    expect(nextAttentionIndex(null, [line(false)])).toBeNull();
  });
});

describe('EDT section', () => {
  const active = { status: 'active' as const, edt: { topic: 'feat-x' } };
  const none = { status: 'no-active-edt' as const, edt: null };

  it('resolves the state from the snapshot and the EDT count', () => {
    expect(resolveEdtSection(active, 3)).toBe('active');
    expect(resolveEdtSection(none, 3)).toBe('no-active');
    expect(resolveEdtSection(none, null)).toBe('no-active');
    expect(resolveEdtSection(none, 0)).toBe('none');
  });

  it('labels the actions per state', () => {
    expect(edtSectionActions('active', 'feat-x').map(formatEdtAction)).toEqual(['[E] ▸ Enter feat-x', '[e] ▸ Choose another EDT / create one']);
    expect(edtSectionActions('no-active', null).map(formatEdtAction)).toEqual(['[e] ▸ Choose or create an EDT']);
    expect(edtSectionActions('none', null).map(formatEdtAction)).toEqual(['[e] ▸ Create a first EDT']);
  });

  it('merges the updated time and the refresh hint into the EDT line', () => {
    expect(formatEdtLine('t', 2, 'updated 3s ago')).toBe('EDT t · 2 services · updated 3s ago · [R] refresh');
    expect(formatEdtLine('t', 2, null)).toBe('EDT t · 2 services');
  });

  it('maps E and e to their effects', () => {
    expect(edtKeyEffect('E', 'active')).toEqual({ openDialog: null, zone: 'edts' });
    expect(edtKeyEffect('E', 'no-active')).toBeNull();
    expect(edtKeyEffect('e', 'active')).toEqual({ openDialog: 'switch', zone: 'edts' });
    expect(edtKeyEffect('e', 'none')).toEqual({ openDialog: 'create', zone: 'edts' });
    expect(edtKeyEffect('x', 'active')).toBeNull();
  });
});
