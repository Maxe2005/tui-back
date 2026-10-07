import { describe, expect, it } from 'vitest';
import {
  formatLastUpdateRecap,
  resolveUpdatePaneRows,
  splitUpdateServiceRows,
  type UpdateServiceRow,
} from './update-zone.logic.js';

function row(service: string, isMember: boolean): UpdateServiceRow {
  return { service, path: `/r/${service}`, branch: 'main', isMember } as unknown as UpdateServiceRow;
}

describe('splitUpdateServiceRows', () => {
  it('splits members from others, keeping order', () => {
    const { members, others } = splitUpdateServiceRows([row('a', true), row('b', true), row('c', false)]);
    expect(members.map((r) => r.service)).toEqual(['a', 'b']);
    expect(others.map((r) => r.service)).toEqual(['c']);
  });

  it('an empty side is an empty list', () => {
    expect(splitUpdateServiceRows([row('c', false)]).members).toEqual([]);
    expect(splitUpdateServiceRows([])).toEqual({ members: [], others: [] });
  });
});

describe('resolveUpdatePaneRows', () => {
  it('shares the budget by ratio, reserving a header line per pane', () => {
    expect(resolveUpdatePaneRows(12, 0.4)).toEqual({ members: 4, others: 6 });
  });

  it('never gives a pane less than one row', () => {
    const tiny = resolveUpdatePaneRows(1, 0.4);
    expect(tiny.members).toBeGreaterThanOrEqual(1);
    expect(tiny.others).toBeGreaterThanOrEqual(1);
  });
});

describe('formatLastUpdateRecap', () => {
  it('is null before any run finished', () => {
    expect(formatLastUpdateRecap(null, [], null, {})).toBeNull();
  });

  it('names the context and renders source → target per service', () => {
    const recap = formatLastUpdateRecap(
      'feat-x',
      [
        { service: 'api', outcome: 'updated' },
        { service: 'web', outcome: 'failed', detail: { code: 'migration-failed', message: 'boom' } },
      ],
      [{ service: 'api', sourceBranch: 'develop' }],
      { api: 'feat-x', web: null },
    );
    expect(recap?.title).toBe('Last update — EDT "feat-x"');
    expect(recap?.resultLines).toEqual([
      '✔ api  develop → feat-x  updated',
      '✖ web  shared branch → ?  failed (migration-failed): boom',
    ]);
  });

  it('titles an all-repos run', () => {
    expect(formatLastUpdateRecap('all-repos', [], null, {})?.title).toBe('Last update — all repos');
  });
});

import { resolveRecapToggle } from './update-zone.logic.js';

describe('resolveRecapToggle', () => {
  it('Esc enters the recap view', () => {
    expect(resolveRecapToggle(false, { escape: true })).toEqual({ recapActive: true, handled: true });
  });

  it('an arrow leaves the recap view and is consumed', () => {
    expect(resolveRecapToggle(true, { downArrow: true })).toEqual({ recapActive: false, handled: true });
    expect(resolveRecapToggle(true, { upArrow: true })).toEqual({ recapActive: false, handled: true });
  });

  it('arrows in the service view are not consumed', () => {
    expect(resolveRecapToggle(false, { downArrow: true })).toEqual({ recapActive: false, handled: false });
  });
});

import {
  advanceServiceSteps,
  buildServiceStepViews,
  finalizeServiceSteps,
  formatServiceUpdateContext,
  PENDING_STEPS,
} from './update-zone.logic.js';

describe('service step tracking', () => {
  it('advances merge → migration → restart, completing the previous step', () => {
    let steps = advanceServiceSteps(undefined, 'pulling');
    expect(steps).toEqual({ merge: 'running', migration: 'pending', restart: 'pending' });
    steps = advanceServiceSteps(steps, 'merging');
    expect(steps.merge).toBe('running');
    steps = advanceServiceSteps(steps, 'migrating');
    expect(steps).toEqual({ merge: 'done', migration: 'running', restart: 'pending' });
    steps = advanceServiceSteps(steps, 'restarting');
    expect(steps).toEqual({ merge: 'done', migration: 'done', restart: 'running' });
  });

  it('skips a step that never emitted (migrations off) when a later one starts', () => {
    const steps = advanceServiceSteps(advanceServiceSteps(undefined, 'merging'), 'restarting');
    expect(steps).toEqual({ merge: 'done', migration: 'skipped', restart: 'running' });
  });

  it('finalizes by outcome', () => {
    const running = { merge: 'done', migration: 'running', restart: 'pending' } as const;
    expect(finalizeServiceSteps(running, { service: 's', outcome: 'failed' })).toEqual({
      merge: 'done',
      migration: 'failed',
      restart: 'skipped',
    });
    expect(finalizeServiceSteps({ merge: 'done', migration: 'done', restart: 'running' }, { service: 's', outcome: 'updated' })).toEqual({
      merge: 'done',
      migration: 'done',
      restart: 'done',
    });
    expect(finalizeServiceSteps(undefined, { service: 's', outcome: 'skipped' })).toEqual({
      merge: 'skipped',
      migration: 'skipped',
      restart: 'skipped',
    });
  });

  it('builds glyph-prefixed step views with the run detail', () => {
    const views = buildServiceStepViews(
      { merge: 'done', migration: 'failed', restart: 'skipped' },
      {
        service: 's',
        outcome: 'failed',
        detail: { code: 'migration-failed', message: 'boom\nline' },
        run: { merge: { kind: 'advanced', files: 2, insertions: 5, deletions: 1 } },
      },
    );
    expect(views.map((view) => view.headline)).toEqual(['✔ Merge — done', '✖ Migration — failed', '– Restart — not run']);
    expect(views[0]?.detail).toEqual(['+5 / −1 lines in 2 files']);
    expect(views[1]?.detail).toEqual(['migration-failed: boom line']);
  });

  it('starts every step pending', () => {
    expect(buildServiceStepViews(PENDING_STEPS, undefined).every((view) => view.state === 'pending')).toBe(true);
  });

  it('formats the from → to context', () => {
    expect(formatServiceUpdateContext('develop', 'feat-x', 'demo')).toBe('develop → feat-x (EDT demo)');
    expect(formatServiceUpdateContext(undefined, null, 'all-repos')).toBe('shared branch → ?');
  });
});
