// tui/zones/update: per-service status, outcome and live-detail helpers.
import { describe, expect, it } from 'vitest';
import { formatBlockerBody } from './update-zone.js';
import { deriveUpdateServiceStatus, updateStatusText, formatLiveServiceDetail, formatServiceOutcomeDetail, isServiceTargetedByRun, mergeLastServiceOutcomes, partitionUpdateServiceRows } from './update-zone.logic.js';
import { ACTIVE_EDT, SERVICE_A, SERVICE_B } from './update-zone.test-support.js';

describe('deriveUpdateServiceStatus', () => {
  it('passes the health-first states through, with their own text', () => {
    expect(deriveUpdateServiceStatus('unhealthy', undefined, false)).toBe('unhealthy');
    expect(deriveUpdateServiceStatus('inconsistent', undefined, false)).toBe('inconsistent');
    expect(deriveUpdateServiceStatus('unhealthy', undefined, true)).toBe('updating');
    expect(updateStatusText('unhealthy')).toBe('unhealthy');
    expect(updateStatusText('inconsistent')).toBe('inconsistent');
    expect(updateStatusText('no-container')).toBe('no container');
    expect(updateStatusText('up')).toBeNull();
  });

  it('a service paused on an incident is awaiting, outranking updating', () => {
    expect(deriveUpdateServiceStatus('up', undefined, true, false, 'merging', true)).toBe('awaiting');
    expect(deriveUpdateServiceStatus('down', 'failed', false, false, undefined, true)).toBe('awaiting');
  });

  it('a run currently targeting the service always wins, regardless of health or a stale failed outcome', () => {
    expect(deriveUpdateServiceStatus('down', 'failed', true)).toBe('updating');
    expect(deriveUpdateServiceStatus('up', undefined, true)).toBe('updating');
  });

  it('a standalone restart in flight derives restarting, outranked only by a group-run target', () => {
    expect(deriveUpdateServiceStatus('up', undefined, false, true)).toBe('restarting');
    expect(deriveUpdateServiceStatus('down', 'failed', false, true)).toBe('restarting');
    expect(deriveUpdateServiceStatus('down', 'failed', true, true)).toBe('updating');
  });

  it('a failed last outcome outranks raw health when no run currently targets the service', () => {
    expect(deriveUpdateServiceStatus('up', 'failed', false)).toBe('error');
    expect(deriveUpdateServiceStatus('down', 'failed', false)).toBe('error');
  });

  it('raw health passes through unchanged with no run targeting the service and no failed outcome', () => {
    expect(deriveUpdateServiceStatus('up', undefined, false)).toBe('up');
    expect(deriveUpdateServiceStatus('down', undefined, false)).toBe('down');
    expect(deriveUpdateServiceStatus('restarting', undefined, false)).toBe('restarting');
    expect(deriveUpdateServiceStatus('up', 'updated', false)).toBe('up');
    expect(deriveUpdateServiceStatus('up', 'skipped', false)).toBe('up');
  });

  it('a targeted service in its migrate phase derives migrating', () => {
    expect(deriveUpdateServiceStatus('up', undefined, true, false, 'migrating')).toBe('migrating');
    expect(deriveUpdateServiceStatus('down', 'failed', true, false, 'migrating')).toBe('migrating');
  });

  it('a targeted service in any other live phase still derives updating', () => {
    expect(deriveUpdateServiceStatus('up', undefined, true, false, 'pulling')).toBe('updating');
    expect(deriveUpdateServiceStatus('up', undefined, true, false, 'merging')).toBe('updating');
    expect(deriveUpdateServiceStatus('up', undefined, true, false, 'restarting')).toBe('updating');
    expect(deriveUpdateServiceStatus('up', undefined, true, false, undefined)).toBe('updating');
  });

  it('a live phase never leaks into the status when no run targets the service', () => {
    expect(deriveUpdateServiceStatus('up', undefined, false, false, 'migrating')).toBe('up');
    expect(deriveUpdateServiceStatus('up', 'failed', false, false, 'migrating')).toBe('error');
  });

  it('a service without a declared container reads no-container, never down', () => {
    expect(deriveUpdateServiceStatus('no-container', undefined, false)).toBe('no-container');
    expect(deriveUpdateServiceStatus('no-container', 'updated', false)).toBe('no-container');
    expect(deriveUpdateServiceStatus('no-container', 'skipped', false)).toBe('no-container');
  });

  it('a live run or a failed outcome still outranks the no-container state', () => {
    expect(deriveUpdateServiceStatus('no-container', undefined, true)).toBe('updating');
    expect(deriveUpdateServiceStatus('no-container', undefined, false, true)).toBe('restarting');
    expect(deriveUpdateServiceStatus('no-container', 'failed', false)).toBe('error');
  });
});

describe('partitionUpdateServiceRows', () => {
  it('orders active-EDT members first, then the rest, tagging isMember on each row', () => {
    const rows = partitionUpdateServiceRows([SERVICE_B, SERVICE_A], ACTIVE_EDT);

    expect(rows.map((row) => row.service)).toEqual(['svc-a', 'svc-b']);
    expect(rows[0]).toMatchObject({ service: 'svc-a', isMember: true });
    expect(rows[1]).toMatchObject({ service: 'svc-b', isMember: false });
  });

  it('marks every row isMember: false when no EDT is focused (mirrors logs-zone.tsx)', () => {
    const rows = partitionUpdateServiceRows([SERVICE_A, SERVICE_B], undefined);

    expect(rows.every((row) => row.isMember === false)).toBe(true);
    expect(rows.map((row) => row.service)).toEqual(['svc-a', 'svc-b']);
  });
});

describe('formatServiceOutcomeDetail', () => {
  it('renders "idle" when no outcome has ever targeted this service', () => {
    expect(formatServiceOutcomeDetail(undefined)).toBe('idle');
  });

  it('renders the outcome word plus code/message detail for a non-updated outcome', () => {
    expect(formatServiceOutcomeDetail({ service: 'svc-a', outcome: 'updated' })).toBe('updated');
    expect(
      formatServiceOutcomeDetail({
        service: 'svc-a',
        outcome: 'failed',
        detail: { code: 'merge-conflict', message: 'Automatic merge failed' },
      }),
    ).toBe('failed (merge-conflict): Automatic merge failed');
    expect(formatServiceOutcomeDetail({ service: 'svc-a', outcome: 'skipped' })).toBe('skipped (skipped)');
  });
});

describe('conflict auto-resolution display', () => {
  it('shows the resolver issue note in the merge-conflict body', () => {
    const body = formatBlockerBody({ service: 'svc-a', repoPath: '/repo/a', kind: 'merge-conflict', autoResolveNote: 'the line is in a mixed block' });

    expect(body).toContain('merge conflict');
    expect(body).toContain('Issue: the line is in a mixed block');
    expect(formatBlockerBody({ service: 'svc-a', repoPath: '/repo/a', kind: 'merge-conflict' })).not.toContain('Issue');
  });

  it('shows the per-service conflict outcome in the run detail', () => {
    const detail = (conflict: 'auto-resolved' | 'partial' | 'left-to-user') =>
      formatServiceOutcomeDetail({ service: 'svc-a', outcome: 'updated', run: { merge: { kind: 'up-to-date' }, conflict } });

    expect(detail('auto-resolved')).toContain('conflict: auto-resolved');
    expect(detail('partial')).toContain('conflict: partial');
    expect(detail('left-to-user')).toContain('conflict: left to you');
  });
});

describe('formatServiceOutcomeDetail — run detail', () => {
  it('renders already up to date and no migrations', () => {
    expect(
      formatServiceOutcomeDetail({
        service: 'svc-a',
        outcome: 'updated',
        run: { merge: { kind: 'up-to-date' }, migrations: { kind: 'none' } },
      }),
    ).toBe('updated\nmerge: already up to date\nmigrations: none');
  });

  it('renders the diffstat for an advancing merge and the collapsed migration excerpt', () => {
    expect(
      formatServiceOutcomeDetail({
        service: 'svc-a',
        outcome: 'updated',
        run: {
          merge: { kind: 'advanced', files: 3, insertions: 10, deletions: 4 },
          migrations: { kind: 'ran', command: 'npm run m', outputExcerpt: 'a\nb' },
        },
      }),
    ).toBe('updated\nmerge: +10/\u22124 lines, 3 files\nmigrations: ran (npm run m) \u2014 a \u21b5 b');
  });

  it('singularizes one file and omits the dash for an empty excerpt', () => {
    expect(
      formatServiceOutcomeDetail({
        service: 'svc-a',
        outcome: 'updated',
        run: {
          merge: { kind: 'advanced', files: 1, insertions: 1, deletions: 0 },
          migrations: { kind: 'ran', command: 'm', outputExcerpt: '' },
        },
      }),
    ).toBe('updated\nmerge: +1/\u22120 lines, 1 file\nmigrations: ran (m)');
  });

  it('flags an unavailable diff and keeps run detail on a container-less skipped row', () => {
    expect(
      formatServiceOutcomeDetail({
        service: 'svc-a',
        outcome: 'skipped',
        detail: { code: 'no-container', message: 'no container' },
        run: { merge: { kind: 'advanced' } },
      }),
    ).toBe('skipped (no-container): no container\nmerge: updated (diff unavailable)');
  });
});

describe('formatLiveServiceDetail — shared-types phase', () => {
  it('shows the phase on the source service instead of the core step', () => {
    expect(formatLiveServiceDetail(undefined, [], 'publishing')).toBe('step: publishing shared-types');
    expect(formatLiveServiceDetail('pulling', [], 'propagating')).toBe('step: propagating shared-types');
  });
});

describe('formatLiveServiceDetail', () => {
  it('renders the current step with no issues', () => {
    expect(formatLiveServiceDetail('pulling', [])).toBe('step: pulling');
    expect(formatLiveServiceDetail('migrating', [])).toBe('step: migrating');
  });

  it('renders starting when the targeted service has emitted no phase yet', () => {
    expect(formatLiveServiceDetail(undefined, [])).toBe('step: starting');
  });

  it('marks each issue resolved/unresolved beside its kind and detail', () => {
    expect(
      formatLiveServiceDetail('merging', [
        { kind: 'dirty-worktree', detail: '/repo/a', resolved: false },
        { kind: 'merge-conflict', detail: '/repo/a', resolved: true },
      ]),
    ).toBe('step: merging\n○ dirty-worktree — /repo/a (unresolved)\n✔ merge-conflict — /repo/a (resolved)');
  });

  it('renders a migration failure as an unresolved entry', () => {
    expect(
      formatLiveServiceDetail('migrating', [
        { kind: 'migration-failed', detail: 'Repo /repo/a migration "npm run migration:run" failed: boom', resolved: false },
      ]),
    ).toContain('○ migration-failed — Repo /repo/a migration "npm run migration:run" failed: boom (unresolved)');
  });

  it('collapses embedded newlines in issue detail so one issue stays one row', () => {
    expect(
      formatLiveServiceDetail('migrating', [
        { kind: 'migration-failed', detail: 'line one\nline two\nline three', resolved: false },
      ]),
    ).toBe('step: migrating\n○ migration-failed — line one line two line three (unresolved)');
  });
});

describe('mergeLastServiceOutcomes', () => {
  it('merges new results in without dropping an existing service outside this run\'s scope', () => {
    const current = { 'svc-b': { service: 'svc-b', outcome: 'updated' as const } };

    const next = mergeLastServiceOutcomes(current, [{ service: 'svc-a', outcome: 'failed', detail: { code: 'merge-conflict', message: 'm' } }]);

    expect(next['svc-b']).toEqual({ service: 'svc-b', outcome: 'updated' });
    expect(next['svc-a']).toEqual({ service: 'svc-a', outcome: 'failed', detail: { code: 'merge-conflict', message: 'm' } });
  });

  it('overwrites a service\'s previous outcome with its newest result', () => {
    const current = { 'svc-a': { service: 'svc-a', outcome: 'failed' as const, detail: { code: 'merge-conflict', message: 'm' } } };

    const next = mergeLastServiceOutcomes(current, [{ service: 'svc-a', outcome: 'updated' }]);

    expect(next['svc-a']).toEqual({ service: 'svc-a', outcome: 'updated' });
  });
});

describe('isServiceTargetedByRun', () => {
  const members = new Set(['/repo/a', '/repo/b']);

  it('an unfiltered run targets every row in scope: EDT members for edt, every row for all', () => {
    expect(isServiceTargetedByRun({ service: 'svc-a', path: '/repo/a' }, { scope: 'edt', memberPaths: members, selection: null })).toBe(true);
    expect(isServiceTargetedByRun({ service: 'svc-c', path: '/repo/c' }, { scope: 'edt', memberPaths: members, selection: null })).toBe(false);
    expect(isServiceTargetedByRun({ service: 'svc-c', path: '/repo/c' }, { scope: 'all', memberPaths: members, selection: null })).toBe(true);
  });

  it('a narrowed selection targets only the selected rows inside the scope', () => {
    const selection = [{ service: 'svc-a', repoPath: '/repo/a' }];
    expect(isServiceTargetedByRun({ service: 'svc-a', path: '/repo/a' }, { scope: 'edt', memberPaths: members, selection })).toBe(true);
    expect(isServiceTargetedByRun({ service: 'svc-b', path: '/repo/b' }, { scope: 'edt', memberPaths: members, selection })).toBe(false);
    expect(isServiceTargetedByRun({ service: 'svc-b', path: '/repo/b' }, { scope: 'all', memberPaths: members, selection })).toBe(false);
  });

  it('matches a selected repoPath by resolved path, and by service name when the item carries no path', () => {
    expect(
      isServiceTargetedByRun(
        { service: 'svc-a', path: '/repo/a' },
        { scope: 'all', memberPaths: members, selection: [{ service: 'renamed', repoPath: '/repo/x/../a' }] },
      ),
    ).toBe(true);
    expect(
      isServiceTargetedByRun({ service: 'svc-a', path: '/repo/a' }, { scope: 'all', memberPaths: members, selection: [{ service: 'svc-a' }] }),
    ).toBe(true);
  });

  it('a selected row outside an edt-scoped run is never targeted', () => {
    expect(
      isServiceTargetedByRun(
        { service: 'svc-c', path: '/repo/c' },
        { scope: 'edt', memberPaths: members, selection: [{ service: 'svc-c', repoPath: '/repo/c' }] },
      ),
    ).toBe(false);
  });
});
