// tui/zones/update: pure keystroke, trigger, quit/confirm and blocker-menu helpers.
import { describe, expect, it } from 'vitest';
import { resolveMenuKey } from '../../../shared/components/lists/menu-list.js';
import { UPDATE_BLOCKER_MENU_ITEMS, formatBlockerBody, formatBlockerRetry, formatUpdateRow, formatUpdateSummary, resolveAllConfirm, UPDATE_BLOCKER_MENU_ESCAPE, blockerMenuItems, resolveQuitConfirm, resolveUpdateTrigger, resolveUpdateTone, shouldConfirmQuit, shouldOfferRerun, shouldOpenAllConfirm, shouldOpenEdtConfig, shouldOpenSingleConfig } from '../update-zone.js';
import { toServicePickItems } from '../update-service-pick-dialog.js';
import { matchPickItemsBySubstring } from '../../../shared/components/pickers/filterable-pick-list.js';
import { INTERRUPTED_EDTS } from '../update-zone.test-support.js';

describe('formatUpdateRow', () => {
  it('renders each outcome with a glyph paired to the outcome word, code, and message', () => {
    expect(formatUpdateRow({ service: 'svc-a', outcome: 'updated' })).toBe('✔ svc-a — updated');
    expect(formatUpdateRow({ service: 'svc-a', outcome: 'skipped', detail: { code: 'dirty-worktree', message: 'Repo /repo/a has uncommitted changes' } })).toBe(
      '○ svc-a — skipped (dirty-worktree): Repo /repo/a has uncommitted changes',
    );
    expect(formatUpdateRow({ service: 'svc-a', outcome: 'failed', detail: { code: 'merge-conflict', message: 'Automatic merge failed' } })).toBe(
      '✖ svc-a — failed (merge-conflict): Automatic merge failed',
    );
  });

  it('collapses a multi-line detail message to one line', () => {
    expect(
      formatUpdateRow({ service: 'svc-a', outcome: 'failed', detail: { code: 'git-pull-error', message: 'line one\nline two\n  line three' } }),
    ).toBe('✖ svc-a — failed (git-pull-error): line one line two line three');
  });

  it('surfaces the migrate phase: a migration-failed row names the command and its error output', () => {
    expect(
      formatUpdateRow({
        service: 'svc-a',
        outcome: 'failed',
        detail: {
          code: 'migration-failed',
          message: 'Repo /repo/a migration "npm run migration:run" failed: relation "users" does not exist',
        },
      }),
    ).toBe(
      '✖ svc-a — failed (migration-failed): Repo /repo/a migration "npm run migration:run" failed: relation "users" does not exist',
    );
  });

  it('degrades gracefully when a row carries no detail', () => {
    expect(formatUpdateRow({ service: 'svc-a', outcome: 'skipped' })).toBe('○ svc-a — skipped (skipped)');
    expect(formatUpdateRow({ service: 'svc-a', outcome: 'failed' })).toBe('✖ svc-a — failed (failed)');
  });
});

describe('formatUpdateSummary: shared-branches EDT', () => {
  it('says "all shared branches"', () => {
    expect(formatUpdateSummary('Shared branches', [{ service: 'a', outcome: 'updated' }])).toBe(
      'Shared branches (all shared branches): 1 updated, 0 skipped, 0 failed.',
    );
  });
});

describe('resolveUpdateTone / formatUpdateSummary', () => {
  it('is error when any service failed, warning on skips, success otherwise', () => {
    expect(resolveUpdateTone([{ service: 'a', outcome: 'updated' }])).toBe('success');
    expect(
      resolveUpdateTone([
        { service: 'a', outcome: 'updated' },
        { service: 'b', outcome: 'skipped', detail: { code: 'dirty-worktree', message: 'm' } },
      ]),
    ).toBe('warning');
    expect(
      resolveUpdateTone([
        { service: 'a', outcome: 'skipped', detail: { code: 'dirty-worktree', message: 'm' } },
        { service: 'b', outcome: 'failed', detail: { code: 'merge-conflict', message: 'm' } },
      ]),
    ).toBe('error');
  });

  it('names every targeted service by count in the closed outcome vocabulary', () => {
    expect(
      formatUpdateSummary('demo', [
        { service: 'a', outcome: 'updated' },
        { service: 'b', outcome: 'skipped', detail: { code: 'dirty-worktree', message: 'm' } },
        { service: 'c', outcome: 'failed', detail: { code: 'merge-conflict', message: 'm' } },
      ]),
    ).toBe('EDT "demo": 1 updated, 1 skipped, 1 failed.');
  });

  it('renders the all-repos title variant with no EDT topic to name', () => {
    expect(
      formatUpdateSummary('all-repos', [
        { service: 'a', outcome: 'updated' },
        { service: 'b', outcome: 'skipped', detail: { code: 'dirty-worktree', message: 'm' } },
        { service: 'c', outcome: 'failed', detail: { code: 'merge-conflict', message: 'm' } },
      ]),
    ).toBe('All repos: 1 updated, 1 skipped, 1 failed.');
  });
});

describe('shouldOfferRerun', () => {
  it('offers a re-run only when the active EDT entry carries interrupted', () => {
    expect(shouldOfferRerun(INTERRUPTED_EDTS, 'edt-1')).toBe(true);
    expect(shouldOfferRerun([{ ...INTERRUPTED_EDTS[0], status: 'active' as const }], 'edt-1')).toBe(false);
    expect(shouldOfferRerun(INTERRUPTED_EDTS, 'edt-other')).toBe(false);
    expect(shouldOfferRerun(INTERRUPTED_EDTS, null)).toBe(false);
    expect(shouldOfferRerun(null, 'edt-1')).toBe(false);
  });
});

describe('shouldConfirmQuit / resolveQuitConfirm', () => {
  it('requires confirmation only for q pressed mid-run', () => {
    expect(shouldConfirmQuit('q', 'running')).toBe(true);
    expect(shouldConfirmQuit('q', 'done')).toBe(false);
    expect(shouldConfirmQuit('x', 'running')).toBe(false);
  });

  it('confirms on y/Enter, cancels on n/Escape, ignores everything else', () => {
    expect(resolveQuitConfirm('y', {})).toBeNull();
    expect(resolveQuitConfirm('n', {})).toBeNull();
    expect(resolveQuitConfirm('', { return: true })).toBe('confirm');
    expect(resolveQuitConfirm('', { escape: true })).toBe('cancel');
    expect(resolveQuitConfirm('q', {})).toBeNull();
  });
});

describe('shouldOpenAllConfirm / resolveAllConfirm', () => {
  it('opens the confirm gate on a/A while idle/done/error, never mid-run', () => {
    expect(shouldOpenAllConfirm('a', 'idle')).toBe(true);
    expect(shouldOpenAllConfirm('A', 'done')).toBe(true);
    expect(shouldOpenAllConfirm('a', 'error')).toBe(true);
    expect(shouldOpenAllConfirm('a', 'running')).toBe(false);
    expect(shouldOpenAllConfirm('A', 'running')).toBe(false);
    expect(shouldOpenAllConfirm('x', 'idle')).toBe(false);
  });

  it('confirms only on Enter, cancels only on Escape — a stray keystroke never launches the run', () => {
    expect(resolveAllConfirm('', { return: true })).toBe('confirm');
    expect(resolveAllConfirm('', { escape: true })).toBe('cancel');
    expect(resolveAllConfirm('a', {})).toBeNull();
    expect(resolveAllConfirm('y', {})).toBeNull();
    expect(resolveAllConfirm('', {})).toBeNull();
  });
});

describe('resolveUpdateTrigger (a / Enter)', () => {
  it('opens the all-repos config on a/A while idle/done/error', () => {
    expect(resolveUpdateTrigger('a', {}, 'idle')).toBe('open-all-config');
    expect(resolveUpdateTrigger('A', {}, 'done')).toBe('open-all-config');
    expect(resolveUpdateTrigger('a', {}, 'error')).toBe('open-all-config');
  });

  it('opens the row-local service menu on Enter while idle/done/error', () => {
    expect(resolveUpdateTrigger('', { return: true }, 'idle')).toBe('open-service-menu');
    expect(resolveUpdateTrigger('', { return: true }, 'done')).toBe('open-service-menu');
    expect(resolveUpdateTrigger('', { return: true }, 'error')).toBe('open-service-menu');
  });

  it('yields none mid-run — a second trigger never starts a direct unconfigured run', () => {
    expect(resolveUpdateTrigger('a', {}, 'running')).toBe('none');
    expect(resolveUpdateTrigger('A', {}, 'running')).toBe('none');
    expect(resolveUpdateTrigger('', { return: true }, 'running')).toBe('none');
  });

  it('yields none for every other key while idle', () => {
    expect(resolveUpdateTrigger('q', {}, 'idle')).toBe('none');
    expect(resolveUpdateTrigger('y', {}, 'idle')).toBe('none');
    expect(resolveUpdateTrigger('', {}, 'idle')).toBe('none');
    expect(resolveUpdateTrigger('', { return: false }, 'idle')).toBe('none');
  });

  it('every mapping resolves to a config-screen/menu action or none — no path starts a run directly', () => {
    const actions = [
      resolveUpdateTrigger('a', {}, 'idle'),
      resolveUpdateTrigger('A', {}, 'done'),
      resolveUpdateTrigger('', { return: true }, 'idle'),
      resolveUpdateTrigger('', { return: true }, 'error'),
      resolveUpdateTrigger('a', {}, 'running'),
      resolveUpdateTrigger('', { return: true }, 'running'),
      resolveUpdateTrigger('q', {}, 'idle'),
    ];
    for (const action of actions) {
      expect(['open-edt-config', 'open-all-config', 'open-service-menu', 'open-single-config', 'none']).toContain(action);
    }
    expect(actions).toContain('open-all-config');
    expect(actions).toContain('open-service-menu');
  });
});

describe('shouldOpenEdtConfig / shouldOpenSingleConfig', () => {
  it('opens the edt-scoped config on m/M while idle/done/error, never mid-run', () => {
    expect(shouldOpenEdtConfig('m', 'idle')).toBe(true);
    expect(shouldOpenEdtConfig('M', 'done')).toBe(true);
    expect(shouldOpenEdtConfig('m', 'error')).toBe(true);
    expect(shouldOpenEdtConfig('m', 'running')).toBe(false);
    expect(shouldOpenEdtConfig('M', 'running')).toBe(false);
    expect(shouldOpenEdtConfig('x', 'idle')).toBe(false);
    expect(shouldOpenEdtConfig('a', 'idle')).toBe(false);
  });

  it('opens the single-service config on p/P while idle/done/error, never mid-run', () => {
    expect(shouldOpenSingleConfig('p', 'idle')).toBe(true);
    expect(shouldOpenSingleConfig('P', 'done')).toBe(true);
    expect(shouldOpenSingleConfig('p', 'error')).toBe(true);
    expect(shouldOpenSingleConfig('p', 'running')).toBe(false);
    expect(shouldOpenSingleConfig('P', 'running')).toBe(false);
    expect(shouldOpenSingleConfig('x', 'idle')).toBe(false);
    expect(shouldOpenSingleConfig('a', 'idle')).toBe(false);
  });
});

describe('resolveUpdateTrigger (m / p)', () => {
  it('opens the edt-scoped config on m/M while idle/done/error', () => {
    expect(resolveUpdateTrigger('m', {}, 'idle')).toBe('open-edt-config');
    expect(resolveUpdateTrigger('M', {}, 'done')).toBe('open-edt-config');
    expect(resolveUpdateTrigger('m', {}, 'error')).toBe('open-edt-config');
  });

  it('opens the single-service config on p/P while idle/done/error', () => {
    expect(resolveUpdateTrigger('p', {}, 'idle')).toBe('open-single-config');
    expect(resolveUpdateTrigger('P', {}, 'done')).toBe('open-single-config');
    expect(resolveUpdateTrigger('p', {}, 'error')).toBe('open-single-config');
  });

  it('yields none for g/p mid-run — a second trigger never starts a direct unconfigured run', () => {
    expect(resolveUpdateTrigger('m', {}, 'running')).toBe('none');
    expect(resolveUpdateTrigger('M', {}, 'running')).toBe('none');
    expect(resolveUpdateTrigger('p', {}, 'running')).toBe('none');
    expect(resolveUpdateTrigger('P', {}, 'running')).toBe('none');
  });

  it('still yields none for every other key while idle', () => {
    expect(resolveUpdateTrigger('q', {}, 'idle')).toBe('none');
    expect(resolveUpdateTrigger('y', {}, 'idle')).toBe('none');
    expect(resolveUpdateTrigger('x', {}, 'idle')).toBe('none');
  });
});

// Filtering itself is shared/components/filterable-pick-list.tsx's (covered by its own test
// file) — what stays service-specific is how a candidate becomes a pick item.
describe('toServicePickItems', () => {
  it('labels each item by service name, with the repo path as searchable secondary text and key', () => {
    const dupes = [
      { service: 'svc', repoPath: '/repo/a' },
      { service: 'svc', repoPath: '/repo/b' },
    ];
    expect(toServicePickItems(dupes)).toEqual([
      { key: '/repo/a', label: 'svc', meta: '/repo/a', value: dupes[0] },
      { key: '/repo/b', label: 'svc', meta: '/repo/b', value: dupes[1] },
    ]);
  });

  it('keeps path-distinguished duplicate service names narrowable through the shared filter', () => {
    const items = toServicePickItems([
      { service: 'svc', repoPath: '/repo/a' },
      { service: 'svc', repoPath: '/repo/b' },
    ]);
    expect(matchPickItemsBySubstring('repo/b', items).map((item) => item.value.repoPath)).toEqual(['/repo/b']);
    expect(matchPickItemsBySubstring('/REPO/A', items).map((item) => item.value.repoPath)).toEqual(['/repo/a']);
  });
});

describe('UPDATE_BLOCKER_MENU_ITEMS with the shared menu reducer', () => {
  it('offers exactly the four bounded choices in menu order', () => {
    expect(UPDATE_BLOCKER_MENU_ITEMS.map((item) => item.value)).toEqual(['stash', 'edited', 'cancel-repo', 'cancel-run']);
  });

  it('moves the cursor with arrows, clamped at the ends, and ignores anything else', () => {
    expect(resolveMenuKey({}, 1, UPDATE_BLOCKER_MENU_ITEMS, UPDATE_BLOCKER_MENU_ESCAPE)).toEqual({ type: 'ignore' });
    expect(resolveMenuKey({ downArrow: true }, 0, UPDATE_BLOCKER_MENU_ITEMS, UPDATE_BLOCKER_MENU_ESCAPE)).toEqual({ type: 'move', cursor: 1 });
    expect(resolveMenuKey({ downArrow: true }, 3, UPDATE_BLOCKER_MENU_ITEMS, UPDATE_BLOCKER_MENU_ESCAPE)).toEqual({ type: 'move', cursor: 3 });
    expect(resolveMenuKey({ upArrow: true }, 2, UPDATE_BLOCKER_MENU_ITEMS, UPDATE_BLOCKER_MENU_ESCAPE)).toEqual({ type: 'move', cursor: 1 });
    expect(resolveMenuKey({ upArrow: true }, 0, UPDATE_BLOCKER_MENU_ITEMS, UPDATE_BLOCKER_MENU_ESCAPE)).toEqual({ type: 'move', cursor: 0 });
    expect(resolveMenuKey({}, 0, UPDATE_BLOCKER_MENU_ITEMS, UPDATE_BLOCKER_MENU_ESCAPE)).toEqual({ type: 'ignore' });
  });

  it('jumps with Home/End', () => {
    expect(resolveMenuKey({ home: true }, 2, UPDATE_BLOCKER_MENU_ITEMS, UPDATE_BLOCKER_MENU_ESCAPE)).toEqual({ type: 'move', cursor: 0 });
    expect(resolveMenuKey({ end: true }, 0, UPDATE_BLOCKER_MENU_ITEMS, UPDATE_BLOCKER_MENU_ESCAPE)).toEqual({ type: 'move', cursor: 3 });
  });

  it('chooses the cursor row on Enter and answers cancel-repo on Escape', () => {
    expect(resolveMenuKey({ return: true }, 0, UPDATE_BLOCKER_MENU_ITEMS, UPDATE_BLOCKER_MENU_ESCAPE)).toEqual({ type: 'choose', choice: 'stash' });
    expect(resolveMenuKey({ return: true }, 1, UPDATE_BLOCKER_MENU_ITEMS, UPDATE_BLOCKER_MENU_ESCAPE)).toEqual({ type: 'choose', choice: 'edited' });
    expect(resolveMenuKey({ return: true }, 2, UPDATE_BLOCKER_MENU_ITEMS, UPDATE_BLOCKER_MENU_ESCAPE)).toEqual({ type: 'choose', choice: 'cancel-repo' });
    expect(resolveMenuKey({ return: true }, 3, UPDATE_BLOCKER_MENU_ITEMS, UPDATE_BLOCKER_MENU_ESCAPE)).toEqual({ type: 'choose', choice: 'cancel-run' });
    expect(resolveMenuKey({ escape: true }, 0, UPDATE_BLOCKER_MENU_ITEMS, UPDATE_BLOCKER_MENU_ESCAPE)).toEqual({ type: 'choose', choice: 'cancel-repo' });
  });

  it('ignores Enter on an out-of-range cursor', () => {
    expect(resolveMenuKey({ return: true }, 9, UPDATE_BLOCKER_MENU_ITEMS, UPDATE_BLOCKER_MENU_ESCAPE)).toEqual({ type: 'ignore' });
  });
});

describe('formatBlockerBody', () => {
  it('names the service, path, and kind for every blocker kind', () => {
    expect(formatBlockerBody({ service: 'svc-a', repoPath: '/repo/a', kind: 'dirty-worktree' })).toContain('/repo/a');
    expect(formatBlockerBody({ service: 'svc-a', repoPath: '/repo/a', kind: 'merge-conflict' })).toContain('conflict');
    expect(formatBlockerBody({ service: 'svc-a', repoPath: '/repo/a', kind: 'mid-merge' })).toContain('mid-merge');
    expect(formatBlockerBody({ service: 'svc-a', repoPath: '/repo/a', kind: 'mid-rebase' })).toContain('mid-rebase');
    expect(formatBlockerBody({ service: 'svc-a', repoPath: '/repo/a', kind: 'mid-rebase' })).toContain('never touched');
  });
});

describe('blockerMenuItems', () => {
  it('drops stash for a merge conflict and keeps all four choices otherwise', () => {
    expect(blockerMenuItems('merge-conflict').map((item) => item.value)).toEqual(['edited', 'cancel-repo', 'cancel-run']);
    for (const kind of ['dirty-worktree', 'mid-merge', 'mid-rebase'] as const) {
      expect(blockerMenuItems(kind).map((item) => item.value)).toEqual(['stash', 'edited', 'cancel-repo', 'cancel-run']);
    }
  });

  it('navigates the merge-conflict menu over its three rows', () => {
    const items = blockerMenuItems('merge-conflict');
    expect(resolveMenuKey({ return: true }, 0, items, UPDATE_BLOCKER_MENU_ESCAPE)).toEqual({ type: 'choose', choice: 'edited' });
    expect(resolveMenuKey({ end: true }, 0, items, UPDATE_BLOCKER_MENU_ESCAPE)).toEqual({ type: 'move', cursor: 2 });
    expect(resolveMenuKey({ return: true }, 2, items, UPDATE_BLOCKER_MENU_ESCAPE)).toEqual({ type: 'choose', choice: 'cancel-run' });
  });
});

describe('formatBlockerRetry', () => {
  it('is null on a first prompt', () => {
    expect(formatBlockerRetry({ service: 'svc-a', repoPath: '/repo/a', kind: 'merge-conflict' })).toBeNull();
  });

  it('shows the retry counter and the last failed attempt reason', () => {
    const line = formatBlockerRetry({ service: 'svc-a', repoPath: '/repo/a', kind: 'merge-conflict', retry: 3, retryReason: 'Unmerged paths remain' });
    expect(line).toContain('Retry #3');
    expect(line).toContain('Unmerged paths remain');
  });
});
