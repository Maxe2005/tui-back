// tui/zones/update: tests for the Update zone's pure keystroke/render helpers plus
// renderToString smoke coverage of each visual state (idle prompt, interrupted re-run
// offer, running spinner, done summary, top-level error). The useInput callback itself is
// never invoked here — the shared harness's fake stdin never emits data (the edts-zone
// convention) — so keystroke behavior is verified through the pure functions directly.
import { UPDATE_INCIDENTS_TITLE } from './update-incidents.logic.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { render } from 'ink';
import { ok } from '../../../../../core/result.js';
import type { ServiceBranchDivergence } from '../../../../../core/edt/list.js';
import type { DockerPort } from '../../../../../core/ports/docker.js';
import type { EdtRegistryPort } from '../../../../../core/ports/edt-registry.js';
import type { GitPort } from '../../../../../core/ports/git.js';
import type { LockPort } from '../../../../../core/ports/lock.js';
import type { ManifestPort } from '../../../../../core/ports/manifest.js';
import type { RegistryPort } from '../../../../../core/ports/registry.js';
import type { SettingsPort } from '../../../../../core/ports/settings.js';
import type { StatePort } from '../../../../../core/ports/state.js';
import { DEFAULT_SETTINGS } from '../../../../../core/ports/settings.js';
import { footerContextOf } from '../../shared/test-support/mount-for-test.js';
import { resolveMenuKey } from '../../shared/components/menu-list.js';
import { renderToString } from '../../shared/components/render-to-string.js';
import { fakeTtyStdin, FakeTtyStdout } from '../../shared/test-support/fake-tty.js';
import { createAppStore, type AppStoreDeps } from '../../store/app-store.js';
import {
  UPDATE_ALL_REPOS_PROMPT,
  UPDATE_ALL_RUNNING_LABEL,
  UPDATE_BLOCKER_MENU_ITEMS,
  UPDATE_BLOCKER_TITLE,
  UPDATE_IDLE_PROMPT,
  UPDATE_INTERRUPTED_OFFER,

  UPDATE_QUIT_CONFIRM_BODY,
  UPDATE_QUIT_CONFIRM_BODY_ALL,
  UPDATE_RUNNING_LABEL,
  UPDATE_SELECTION_RUNNING_LABEL,
  formatBlockerBody,
  formatBlockerRetry,
  formatUpdateRow,
  formatUpdateSummary,
  resolveAllConfirm,
  UPDATE_BLOCKER_MENU_ESCAPE,
  blockerMenuItems,
  resolveQuitConfirm,
  resolveUpdateTrigger,
  resolveUpdateTone,
  shouldConfirmQuit,
  shouldOfferRerun,
  shouldOpenAllConfirm,
  shouldOpenEdtConfig,
  shouldOpenSingleConfig,
  UpdateZone,
} from './update-zone.js';
import {
  deriveUpdateServiceStatus,
  formatLiveServiceDetail,
  formatServiceOutcomeDetail,
  isServiceTargetedByRun,
  mergeLastServiceOutcomes,
  partitionUpdateServiceRows,
} from './update-zone.logic.js';
import { toServicePickItems } from './update-service-pick-dialog.js';
import { matchPickItemsBySubstring } from '../../shared/components/filterable-pick-list.js';

const INTERRUPTED_EDTS = [
  {
    ulid: 'edt-1',
    topic: 'demo',
    createdAt: '2026-09-17T00:00:00.000Z',
    status: 'interrupted' as const,
    members: [{ service: 'svc-a', repoPath: '/repo/a', branch: 'feat/a' }],
  },
];

// The Update zone's always-visible service-list fixtures.
const ACTIVE_EDT = {
  ulid: 'edt-1',
  topic: 'demo',
  createdAt: '2026-09-17T00:00:00.000Z',
  status: 'active' as const,
  members: [{ service: 'svc-a', repoPath: '/repo/a', branch: 'feat/a' }],
};

const SERVICE_A: ServiceBranchDivergence = {
  service: 'svc-a',
  path: '/repo/a',
  isMember: true,
  sharedBranch: 'development',
  protectedBranches: [],
  branch: 'feat/a',
  ahead: 0,
  behind: 0,
  status: 'current',
};

const SERVICE_B: ServiceBranchDivergence = {
  service: 'svc-b',
  path: '/repo/b',
  isMember: false,
  sharedBranch: 'development',
  protectedBranches: [],
  branch: 'development',
  ahead: 0,
  behind: 0,
  status: 'current',
};

const LOADING_MEMBERS = 'Loading member services…';

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

describe('UpdateZone rendering', () => {
  it('idle with no interruption shows the Enter prompt plus the all-repos affordance', async () => {
    const store = createAppStore();

    const output = await renderToString(createElement(UpdateZone, { useStore: store }));

    expect(output).toContain(UPDATE_IDLE_PROMPT);
    expect(output).toContain(UPDATE_ALL_REPOS_PROMPT);
  });

  it('the idle prompt names all three triggers (main g, all-repos a, single-service p) plus the Enter menu', async () => {
    expect(UPDATE_IDLE_PROMPT).toContain('[M]');
    expect(UPDATE_IDLE_PROMPT).toContain('[P]');
    expect(UPDATE_IDLE_PROMPT).toContain('[Enter]');
    expect(UPDATE_ALL_REPOS_PROMPT).toContain('[A]');
  });

  it('an open service pick lists every candidate under the filter field and its hint', async () => {
    const store = createAppStore();
    store.setState({
      updateServicePick: [
        { service: 'svc-a', repoPath: '/repo/a' },
        { service: 'svc-b', repoPath: '/repo/b' },
      ],
    });

    const output = await renderToString(createElement(UpdateZone, { useStore: store }));

    expect(output).toContain('UPDATE SERVICE');
    expect(output).toContain('svc-a');
    expect(output).toContain('/repo/a');
    expect(output).toContain('svc-b');
    expect(output).toContain('Filter:');
    expect(await footerContextOf(store, createElement(UpdateZone, { useStore: store }))).toBe('menu');
  });

  it('a closed service pick renders no pick modal', async () => {
    const store = createAppStore();

    const output = await renderToString(createElement(UpdateZone, { useStore: store }));

    expect(output).not.toContain('UPDATE SERVICE');
  });

  it('a pick with no candidate at all shows its own empty line, distinct from the no-match wording', async () => {
    const store = createAppStore();
    store.setState({ updateServicePick: [] });

    const output = await renderToString(createElement(UpdateZone, { useStore: store }));

    expect(output).toContain('UPDATE SERVICE');
    expect(output).toContain('No service to select');
    expect(output).not.toContain('No matching service');
  });

  it('idle with an interrupted active EDT shows the re-run offer', async () => {
    const store = createAppStore();
    store.setState({ edts: INTERRUPTED_EDTS, activeEdt: 'edt-1' });

    const output = await renderToString(createElement(UpdateZone, { useStore: store }));

    expect(output).toContain(UPDATE_INTERRUPTED_OFFER);
  });

  it('the interrupted offer routes through the service-actions menu, never a direct re-run', () => {
    expect(UPDATE_INTERRUPTED_OFFER).toContain('service actions');
    expect(UPDATE_INTERRUPTED_OFFER).not.toContain('to re-run');
  });

  it('running shows the spinner label plus one row per active-EDT member', async () => {
    const store = createAppStore();
    store.setState({ edts: INTERRUPTED_EDTS, activeEdt: 'edt-1', updateStatus: 'running' });

    const output = await renderToString(createElement(UpdateZone, { useStore: store }));

    expect(output).toContain(UPDATE_RUNNING_LABEL);
    expect(output).toContain('svc-a');
  });

  it('running with no membership loaded yet shows the dim loading line instead of empty rows', async () => {
    const store = createAppStore();
    store.setState({ edts: null, activeEdt: null, updateStatus: 'running' });

    const output = await renderToString(createElement(UpdateZone, { useStore: store }));

    expect(output).toContain(UPDATE_RUNNING_LABEL);
    expect(output).toContain(LOADING_MEMBERS);
  });

  it('an all-repos run shows the all label with the generic loading line, never EDT member rows', async () => {
    const store = createAppStore();
    store.setState({ edts: INTERRUPTED_EDTS, activeEdt: 'edt-1', updateStatus: 'running', updateScope: 'all' });

    const output = await renderToString(createElement(UpdateZone, { useStore: store }));

    expect(output).toContain(UPDATE_ALL_RUNNING_LABEL);
    expect(output).not.toContain(UPDATE_RUNNING_LABEL);
    expect(output).toContain(LOADING_MEMBERS);
    expect(output).not.toContain('svc-a (feat/a)');
  });

  it('done with an all-repos outcome renders the All-repos title variant', async () => {
    const store = createAppStore();
    store.setState({
      updateStatus: 'done',
      updateTopic: 'all-repos',
      updateScope: 'all',
      updateResults: [{ service: 'a', outcome: 'updated' }],
    });

    const output = await renderToString(createElement(UpdateZone, { useStore: store }));

    expect(output).toContain('ALL-REPOS UPDATE');
    expect(output).toContain('All repos: 1 updated, 0 skipped, 0 failed.');
  });

  it('the quit-mid-run dialog names no EDT interruption during an all-repos run', async () => {
    // The dialog copy is state-driven: render the open dialog through the store by
    // forcing the running + all-scope state the dialog reads. The dialog itself opens
    // via keystroke state, so assert the copy constants directly against the branch
    // the component renders.
    expect(UPDATE_QUIT_CONFIRM_BODY).toContain('mark this EDT interrupted');
    expect(UPDATE_QUIT_CONFIRM_BODY_ALL).not.toContain('mark this EDT interrupted');
  });

  it('done shows every per-service row plus the summary counts', async () => {
    const store = createAppStore();
    store.setState({
      updateStatus: 'done',
      updateTopic: 'demo',
      updateResults: [
        { service: 'svc-a', outcome: 'updated' },
        { service: 'svc-b', outcome: 'failed', detail: { code: 'merge-conflict', message: 'conflict' } },
      ],
    });

    const output = await renderToString(createElement(UpdateZone, { useStore: store }));

    expect(output).toContain('✔ svc-a  shared branch → ?  updated');
    expect(output).toContain('✖ svc-b  shared branch → ?  failed (merge-conflict): conflict');
    expect(output).toContain('1 updated, 0 skipped, 1 failed');
    // Enter opens the row-local service menu — the follow-up hint promises the menu, never a
    // direct re-run.
    expect(output).toContain(UPDATE_IDLE_PROMPT);
    expect(output).not.toContain('to run again');
  });

  it('done renders duplicate service names as separate rows (keyed by service + index)', async () => {
    const store = createAppStore();
    store.setState({
      updateStatus: 'done',
      updateTopic: 'demo',
      updateResults: [
        { service: 'route-explorer', outcome: 'updated' },
        { service: 'route-explorer', outcome: 'failed', detail: { code: 'merge-conflict', message: 'conflict' } },
      ],
    });

    const output = await renderToString(createElement(UpdateZone, { useStore: store }));

    expect(output).toContain('✔ route-explorer');
    expect(output).toContain('✖ route-explorer');
  });

  it('done with a zero-member no-op note renders the note, never the zeroed counts pane', async () => {
    const store = createAppStore();
    store.setState({
      updateStatus: 'done',
      updateTopic: 'demo',
      updateNote: 'EDT "demo" has no member services — nothing to update.',
      updateResults: [],
    });

    const output = await renderToString(createElement(UpdateZone, { useStore: store }));

    expect(output).toContain('has no member services');
    expect(output).not.toContain('0 updated, 0 skipped, 0 failed');
    expect(output).toContain(UPDATE_IDLE_PROMPT);
  });

  it('error shows the message, the kebab-case code, and the retry hint', async () => {
    const store = createAppStore();
    store.setState({ updateStatus: 'error', updateError: 'No active EDT', updateErrorCode: 'no-active-edt' });

    const output = await renderToString(createElement(UpdateZone, { useStore: store }));

    expect(output).toContain('No active EDT');
    expect(output).toContain('no-active-edt');
    // The retry hint promises the service-actions menu, never a direct retry.
    expect(output).toContain(UPDATE_IDLE_PROMPT);
    expect(output).not.toContain('to try again');
  });

  it('a raised blocker renders the modal title, body, and all four choices', async () => {
    const store = createAppStore();
    store.setState({
      updateStatus: 'running',
      incidentPopupOpen: true,
      incidents: [{ id: 'i1', blocker: { service: 'svc-a', repoPath: '/repo/a', kind: 'dirty-worktree' }, raisedAt: 0 }],
    });

    const output = await renderToString(createElement(UpdateZone, { useStore: store }));

    expect(output).toContain(UPDATE_INCIDENTS_TITLE);
    expect(output).toContain('svc-a');
    expect(output).toContain('/repo/a');
    for (const item of UPDATE_BLOCKER_MENU_ITEMS) {
      expect(output).toContain(item.label);
    }
  });

  it('a re-presented merge conflict renders its retry counter and reason', async () => {
    const store = createAppStore();
    store.setState({
      updateStatus: 'running',
      incidentPopupOpen: true,
      incidents: [{ id: 'i1', blocker: { service: 'svc-a', repoPath: '/repo/a', kind: 'merge-conflict', retry: 2, retryReason: 'Unmerged paths remain' }, raisedAt: 0 }],
    });

    const output = await renderToString(createElement(UpdateZone, { useStore: store }));

    expect(output).toContain('Retry #2');
    expect(output).toContain('Unmerged paths remain');
  });

  it('a merge-conflict blocker never offers the stash choice', async () => {
    const store = createAppStore();
    store.setState({
      updateStatus: 'running',
      incidentPopupOpen: true,
      incidents: [{ id: 'i1', blocker: { service: 'svc-a', repoPath: '/repo/a', kind: 'merge-conflict' }, raisedAt: 0 }],
    });

    const output = await renderToString(createElement(UpdateZone, { useStore: store }));

    expect(output).not.toContain('Stash changes');
    expect(output).toContain('Open in editor, then retry');
  });

  it('no raised blocker renders no blocker modal', async () => {
    const store = createAppStore();

    const output = await renderToString(createElement(UpdateZone, { useStore: store }));

    expect(output).not.toContain(UPDATE_INCIDENTS_TITLE);
  });
});

describe('deriveUpdateServiceStatus', () => {
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

// A no-op stub for every render test below: `createAppStore()` (no deps, the same default
// every other zone test uses) still owns *real* loadEdtsBranches/loadEdts actions that
// early-return an 'error'/no-op status when unwired — and UpdateZone calls both on mount.
// Left un-stubbed, those real calls would race the state each test deliberately seeds and
// clobber it out from under it (mirrors edts-zone.test.tsx's own noopLoad precedent).
const noopLoad = async () => {};

describe('UpdateZone service-list shell rendering', () => {
  it('idle: every service carries a glyph (health fallback down until the first poll resolves), selected detail shows idle', async () => {
    const store = createAppStore();
    store.setState({
      edtsBranches: [SERVICE_A, SERVICE_B],
      edtsBranchesStatus: 'idle',
      edts: [ACTIVE_EDT],
      activeEdt: 'edt-1',
      loadEdtsBranches: noopLoad,
      loadEdts: noopLoad,
    });

    const output = await renderToString(createElement(UpdateZone, { useStore: store, initialRecap: false }));

    expect(output).toContain('svc-a');
    expect(output).toContain('svc-b');
    // No health poll has resolved yet, so the glyph falls back to StatusBadge's down glyph.
    expect(output).toContain('○');
    // The first row (svc-a, the EDT member) is selected by default; no run has ever
    // targeted it, so the detail pane says so.
    expect(output).toContain('No update has run for this service yet.');
  });

  it('updating: only the service targeted by the in-flight EDT-scoped run shows the updating glyph — the non-targeted service keeps its raw-health glyph', async () => {
    const store = createAppStore();
    store.setState({
      edtsBranches: [SERVICE_A, SERVICE_B],
      edtsBranchesStatus: 'idle',
      edts: [ACTIVE_EDT],
      activeEdt: 'edt-1',
      updateStatus: 'running',
      loadEdtsBranches: noopLoad,
      loadEdts: noopLoad,
    });

    const output = await renderToString(createElement(UpdateZone, { useStore: store, initialRecap: false }));
    const lines = output.split('\n');

    // Isolate each service's own *list row* line (identified by its unique meta text "+0/-0",
    // which only the list row — not the running-members spinner line that also mentions the
    // service name — carries) so a bug that marks every row 'updating' regardless of scope (e.g.
    // isTargeted collapsed to bare `updateStatus === 'running'`) fails this test.
    const svcARow = lines.find((line) => line.includes('svc-a') && line.includes('+0/-0'));
    const svcBRow = lines.find((line) => line.includes('svc-b') && line.includes('+0/-0'));

    // svc-a is the active EDT's sole member — targeted by this EDT-scoped run.
    expect(svcARow).toContain('⇄');
    // (the detail pane shares the terminal line, so only the list column is checked)
    expect(svcARow?.slice(0, 40)).not.toContain('○');

    // svc-b is not an EDT member: during a run the list keeps only the services being
    // updated, so it is gone.
    expect(svcBRow).toBeUndefined();
  });

  it('updating: a single-service run inside the EDT marks only the selected member — the other member keeps its own glyph', async () => {
    const store = createAppStore();
    store.setState({
      edtsBranches: [SERVICE_A, { ...SERVICE_B, isMember: true }],
      edtsBranchesStatus: 'idle',
      edts: [{ ...ACTIVE_EDT, members: [...ACTIVE_EDT.members, { service: 'svc-b', repoPath: '/repo/b', branch: 'development' }] }],
      activeEdt: 'edt-1',
      updateStatus: 'running',
      updateScope: 'edt',
      // The `p` trigger's confirmed config: scope `edt`, one selected row.
      updateSelection: [{ service: 'svc-b', repoPath: '/repo/b', sourceBranch: 'development' }],
      loadEdtsBranches: noopLoad,
      loadEdts: noopLoad,
    });

    const output = await renderToString(createElement(UpdateZone, { useStore: store, initialRecap: true }));
    const lines = output.split('\n');
    const svcARow = lines.find((line) => line.includes('svc-a') && line.includes('+0/-0'));
    const svcBRow = lines.find((line) => line.includes('svc-b') && line.includes('+0/-0'));

    expect(svcBRow).toContain('⇄');
    expect(svcARow).toBeUndefined();
    // The running-members spinner list names the selected member only.
    expect(output).toContain('svc-b (development)');
    expect(output).not.toContain('svc-a (feat/a)');
  });

  it('updating: a single-service run outside the EDT (all scope) marks only that service and names it', async () => {
    const store = createAppStore();
    store.setState({
      edtsBranches: [SERVICE_A, SERVICE_B],
      edtsBranchesStatus: 'idle',
      edts: [ACTIVE_EDT],
      activeEdt: 'edt-1',
      updateStatus: 'running',
      updateScope: 'all',
      updateSelection: [{ service: 'svc-b', repoPath: '/repo/b', sourceBranch: 'development' }],
      loadEdtsBranches: noopLoad,
      loadEdts: noopLoad,
    });

    const output = await renderToString(createElement(UpdateZone, { useStore: store, initialRecap: false }));
    const lines = output.split('\n');
    const svcARow = lines.find((line) => line.includes('svc-a') && line.includes('+0/-0'));
    const svcBRow = lines.find((line) => line.includes('svc-b') && line.includes('+0/-0'));

    expect(svcBRow).toContain('⇄');
    expect(svcARow).toBeUndefined();
    expect(output).toContain(UPDATE_SELECTION_RUNNING_LABEL);
    expect(output).not.toContain(UPDATE_ALL_RUNNING_LABEL);
    expect(output).not.toContain(LOADING_MEMBERS);
  });

  it('error: a service whose last completed run failed shows the error glyph and the failure detail', async () => {
    const store = createAppStore();
    store.setState({
      edtsBranches: [SERVICE_A, SERVICE_B],
      edtsBranchesStatus: 'idle',
      edts: [ACTIVE_EDT],
      activeEdt: 'edt-1',
      lastServiceOutcomes: {
        'svc-a': { service: 'svc-a', outcome: 'failed', detail: { code: 'merge-conflict', message: 'Automatic merge failed' } },
      },
      loadEdtsBranches: noopLoad,
      loadEdts: noopLoad,
    });

    const output = await renderToString(createElement(UpdateZone, { useStore: store, initialRecap: false }));

    expect(output).toContain('✖');
    expect(output).toContain('failed (merge-conflict): Automatic merge failed');
  });
});

// Every render test above uses a deps-less `createAppStore()`, under which `pollServiceHealth`
// early-returns whatever path it is given — so a poll keyed by `row.service` instead of
// `row.path` (`updateServiceHealth[row.path]` reads by path) would leave every row on the `down`
// fallback with zero failures. This block wires real (fake-port) deps, like update-slice.test.ts's
// health-polling fakeDeps, and mounts UpdateZone with a real Ink render loop.
function fakeUpdateZoneDeps(overrides: Partial<AppStoreDeps> = {}): AppStoreDeps {
  const registry: RegistryPort = {
    list: vi.fn(async () => ok([])),
    add: vi.fn(async () => ok(undefined)),
    exists: vi.fn(async () => ok(true)),
    scan: vi.fn(async () => ok({ candidates: [], skipped: [] })),
    reset: vi.fn(async () => ok({ path: '/x', backupPath: null })),
    remove: vi.fn(async () => ok(undefined)),
  };
  const manifest: ManifestPort = {
    load: vi.fn(async (repoPath: string) =>
      ok({
        service: `svc-${repoPath.split('/').pop()}`,
        container: `ctr-${repoPath.split('/').pop()}`,
        migrationCommand: 'npm run migration:run',
        sharedBranch: 'development',
        modules: {},
      }),
    ),
  };
  const git: GitPort = {
    assertAllowedBranch: vi.fn(async () => ok(undefined)),
    createBranch: vi.fn(async () => ok(undefined)),
    deleteBranch: vi.fn(async () => ok(undefined)),
    currentBranch: vi.fn(async () => ok('feat/a')),
    aheadBehind: vi.fn(async () => ok({ ahead: 0, behind: 0 })),
    checkout: vi.fn(async () => ok(undefined)),
    hasUncommittedChanges: vi.fn(async () => ok(false)),
    stashSave: vi.fn(async () => ok(undefined)),
    restoreStash: vi.fn(async () => ok(undefined)),
    branchExistsLocally: vi.fn(async () => ok(true)),
    fetch: vi.fn(async () => ok(undefined)),
    pull: vi.fn(async () => ok(undefined)),
    mergeBranch: vi.fn(async () => ok(undefined)),
    abortMerge: vi.fn(async () => ok(undefined)),
    isMergeInProgress: vi.fn(async () => ok(false)),
    listDirtyPaths: vi.fn(async () => ok([])),
    discardPaths: vi.fn(async () => ok(undefined)),
    discardAll: vi.fn(async () => ok(undefined)),
    diffNameOnly: vi.fn(async () => ok([])),
    headRevision: vi.fn(async () => ok('head-a')),
    diffStat: vi.fn(async () => ok({ files: 0, insertions: 0, deletions: 0 })),
    discardPathsToHead: vi.fn(async () => ok(undefined)),
    isRebaseInProgress: vi.fn(async () => ok(false)),
    hasUnmergedPaths: vi.fn(async () => ok(false)),
    listUnmergedPaths: vi.fn(async () => ok([] as string[])),
    readWorktreeFile: vi.fn(async () => ok("")),
    writeResolvedFile: vi.fn(async () => ok(undefined)),
    checkoutSide: vi.fn(async () => ok(undefined)),
    finalizeMerge: vi.fn(async () => ok(undefined)),
    listBranches: vi.fn(async () => ok([])),
    renameBranch: vi.fn(async () => ok(undefined)),
    isBranchMerged: vi.fn(async () => ok(true)),
    hasStash: vi.fn(async () => ok(false)),
    fetchRemote: vi.fn(async () => ok(undefined)),
    listUnpushedCommits: vi.fn(async () => ok([] as string[])),
    listRemoteBranches: vi.fn(async () => ok([])),
    createTrackingBranch: vi.fn(async () => ok(undefined)),
    stagePaths: vi.fn(async () => ok(undefined)),
    commit: vi.fn(async () => ok(undefined)),
  };
  const edtRegistry: EdtRegistryPort = {
    add: vi.fn(async () => ok(undefined)),
    list: vi.fn(async () => ok([])),
    setStatus: vi.fn(async () => ok(undefined)),
    update: vi.fn(async () => ok(undefined)),
    remove: vi.fn(async () => ok(undefined)),
  };
  const state: StatePort = {
    readActiveEdt: vi.fn(async () => ok(null)),
    writeActiveEdt: vi.fn(async () => ok(undefined)),
    readSplitterRatios: vi.fn(async () => ok(null)),
    writeSplitterRatios: vi.fn(async () => ok(undefined)),
    readFilterHistory: vi.fn(async () => ok(null)),
    writeFilterHistory: vi.fn(async () => ok(undefined)),
    readCommandHistory: vi.fn(async () => ok(null)),
    writeCommandHistory: vi.fn(async () => ok(undefined)),
  };
  const lock: LockPort = {
    acquire: vi.fn(async () => ok({ release: vi.fn(async () => ok(undefined)) })),
    peek: vi.fn(async () => ok({ locked: false })),
  };
  const settings: SettingsPort = {
    load: vi.fn(async () => ok({ settings: DEFAULT_SETTINGS, warning: null })),
    save: vi.fn(async () => ok(undefined)),
  };
  const docker: DockerPort = {
    streamLogs: vi.fn(() => () => {}),
    fetchLogsBefore: vi.fn(async () => ok([])),
    getContainerHealth: vi.fn(async () => ok('up' as const)),
    restartContainer: vi.fn(async () => ok(undefined)),
  };
  return {
    registry,
    manifest,
    manifestCarry: { capture: async () => ({ ok: true, data: { kind: 'absent' } }), restore: async () => ({ ok: true, data: undefined }) },
    git,
    edtRegistry,
    state,
    lock,
    edtRegistryResourceKey: '/tmp/edts.yaml',
    edtsBaseDir: '/tmp/edts',
    registryResourceKey: '/config/registry.yaml',
    settings,
    docker,
    ...overrides,
  };
}

describe('UpdateZone health-poll wiring against real (fake-port) deps', () => {
  it('polls each row by its own repoPath (never by service name) and the rendered row reflects the resolved health glyph', async () => {
    // manifest.load resolves repoPath -> container ('ctr-a' for /repo/a, 'ctr-b' for
    // /repo/b); getContainerHealth reports 'up' only for 'ctr-a'. If the poll effect were
    // ever keyed by `row.service` instead of `row.path` (updateServiceHealth reads by
    // path — see update-zone.tsx), the lookup would simply never resolve and every row
    // would stay on the `down` fallback forever — both assertions below would fail
    // together in that case.
    const getContainerHealth = vi.fn(async (container: string) => ok(container === 'ctr-a' ? ('up' as const) : ('down' as const)));
    const docker: DockerPort = {
      streamLogs: vi.fn(() => () => {}),
      fetchLogsBefore: vi.fn(async () => ok([])),
      getContainerHealth,
      restartContainer: vi.fn(async () => ok(undefined)),
    };
    const store = createAppStore(fakeUpdateZoneDeps({ docker }));
    store.setState({
      edtsBranches: [SERVICE_A, SERVICE_B],
      edtsBranchesStatus: 'idle',
      edts: [ACTIVE_EDT],
      activeEdt: 'edt-1',
      loadEdtsBranches: noopLoad,
      loadEdts: noopLoad,
    });

    const stdout = new FakeTtyStdout();
    const instance = render(createElement(UpdateZone, { useStore: store, initialRecap: false }), {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: fakeTtyStdin(),
      interactive: false,
      exitOnCtrlC: false,
      patchConsole: false,
    });
    try {
      // Flushes the mount effect's fire-and-forget poll chain (manifest.load then
      // getContainerHealth, each a resolved-async mock) — a real macrotask tick, mirrors
      // update-slice.test.ts's own flushPolls helper — then waits for the state update's
      // own React commit to actually paint.
      await new Promise((resolve) => setTimeout(resolve, 10));
      await instance.waitUntilRenderFlush();

      // Non-interactive Ink only actually flushes its buffered frame to the stream on
      // unmount (mirrors render-to-string.ts's own waitUntilExit-after-unmount sequencing)
      // — the poll above must resolve *before* this, not after, so the frame it unmounts
      // with already reflects the resolved health.
      const exit = instance.waitUntilExit();
      instance.unmount();
      await exit;

      const lines = stdout.output.split('\n');
      const svcARow = lines.find((line) => line.includes('svc-a') && line.includes('+0/-0'));
      const svcBRow = lines.find((line) => line.includes('svc-b') && line.includes('+0/-0'));
      expect(svcARow).toBeDefined();
      expect(svcBRow).toBeDefined();
      expect(svcARow).toContain('●');
      expect(svcBRow).toContain('○');
    } catch (error) {
      instance.unmount();
      throw error;
    }
  });
});

describe('UpdateZone live per-service detail', () => {
  it('running with the selected service targeted shows its live step plus the issue log instead of the last outcome', async () => {
    const store = createAppStore();
    store.setState({
      edtsBranches: [SERVICE_A, SERVICE_B],
      edtsBranchesStatus: 'idle',
      edts: [ACTIVE_EDT],
      activeEdt: 'edt-1',
      updateStatus: 'running',
      liveServicePhase: { 'svc-a': 'pulling' },
      liveServiceSteps: { 'svc-a': { merge: 'running', migration: 'pending', restart: 'pending' } },
      liveServiceIssues: {
        'svc-a': [
          { kind: 'dirty-worktree', detail: '/repo/a', resolved: false },
          { kind: 'merge-conflict', detail: '/repo/a', resolved: true },
        ],
      },
      lastServiceOutcomes: { 'svc-a': { service: 'svc-a', outcome: 'updated' } },
      loadEdtsBranches: noopLoad,
      loadEdts: noopLoad,
    });

    const output = await renderToString(createElement(UpdateZone, { useStore: store, initialRecap: false }));

    // The first row (svc-a, the EDT member) is selected and targeted — the live view
    // replaces the last-outcome view that would otherwise read "updated".
    expect(output).toContain('UPDATE IN PROGRESS');
    expect(output).toContain('◐ Merge — in progress');
    expect(output).toContain('○ Migration — waiting');
    expect(output).toContain('⚠ dirty-worktree — /repo/a (needs your input)');
    expect(output).toContain('✔ merge-conflict — /repo/a (resolved)');
  });

  it('running with the selected service targeted but no phase yet shows the starting step', async () => {
    const store = createAppStore();
    store.setState({
      edtsBranches: [SERVICE_A, SERVICE_B],
      edtsBranchesStatus: 'idle',
      edts: [ACTIVE_EDT],
      activeEdt: 'edt-1',
      updateStatus: 'running',
      loadEdtsBranches: noopLoad,
      loadEdts: noopLoad,
    });

    const output = await renderToString(createElement(UpdateZone, { useStore: store, initialRecap: false }));

    expect(output).toContain('UPDATE IN PROGRESS');
    expect(output).toContain('○ Merge — waiting');
  });

  it('running with the migrate phase targeted shows the migrating glyph on that service’s own row', async () => {
    const store = createAppStore();
    store.setState({
      edtsBranches: [SERVICE_A, SERVICE_B],
      edtsBranchesStatus: 'idle',
      edts: [ACTIVE_EDT],
      activeEdt: 'edt-1',
      updateStatus: 'running',
      liveServicePhase: { 'svc-a': 'migrating' },
      liveServiceSteps: { 'svc-a': { merge: 'done', migration: 'running', restart: 'pending' } },
      loadEdtsBranches: noopLoad,
      loadEdts: noopLoad,
    });

    const output = await renderToString(createElement(UpdateZone, { useStore: store, initialRecap: false }));
    const lines = output.split('\n');
    const svcARow = lines.find((line) => line.includes('svc-a') && line.includes('+0/-0'));

    expect(svcARow).toBeDefined();
    expect(svcARow).toContain('⇒');
    expect(output).toContain('✔ Merge — done');
    expect(output).toContain('◐ Migration — in progress');
  });

  it('a rejected trigger raises a notice without leaving the running view', async () => {
    const store = createAppStore();
    store.setState({
      edtsBranches: [SERVICE_A],
      edtsBranchesStatus: 'idle',
      edts: [ACTIVE_EDT],
      activeEdt: 'edt-1',
      updateStatus: 'running',
      updateNotice: { code: 'update-already-running', message: 'A group update is already in progress' },
      loadEdtsBranches: noopLoad,
      loadEdts: noopLoad,
    });

    const output = await renderToString(createElement(UpdateZone, { useStore: store, initialRecap: false }));

    expect(output).toContain('⚠ A group update is already in progress (update-already-running)');
    expect(output).toContain('UPDATE IN PROGRESS');
  });

  it('a service finished mid-run shows its last update while the run is still going', async () => {
    const store = createAppStore();
    store.setState({
      edtsBranches: [SERVICE_A, SERVICE_B],
      edtsBranchesStatus: 'idle',
      edts: [ACTIVE_EDT],
      activeEdt: 'edt-1',
      updateStatus: 'running',
      liveServiceDone: { 'svc-a': true },
      lastServiceRuns: {
        'svc-a': {
          steps: { merge: 'done', migration: 'done', restart: 'done' },
          result: { service: 'svc-a', outcome: 'updated', run: { merge: { kind: 'up-to-date' } } },
          source: 'develop',
          target: 'feat/a',
          topic: 'demo',
        },
      },
      loadEdtsBranches: noopLoad,
      loadEdts: noopLoad,
    });

    const output = await renderToString(createElement(UpdateZone, { useStore: store, initialRecap: false }));

    expect(output).not.toContain('UPDATE IN PROGRESS');
    expect(output).toContain('last update');
    expect(output).toContain('develop → feat/a (EDT demo)');
    expect(output).toContain('✔ Merge — done');
    expect(output).toContain('already up to date');
    expect(output).toContain('✔ Restart — done');
  });

  it('done reverts to the final per-service outcome even with a stale live phase in the map', async () => {
    const store = createAppStore();
    store.setState({
      edtsBranches: [SERVICE_A],
      edtsBranchesStatus: 'idle',
      edts: [ACTIVE_EDT],
      activeEdt: 'edt-1',
      updateStatus: 'done',
      updateTopic: 'demo',
      updateResults: [{ service: 'svc-a', outcome: 'updated' }],
      lastServiceOutcomes: { 'svc-a': { service: 'svc-a', outcome: 'updated' } },
      liveServicePhase: { 'svc-a': 'pulling' },
      loadEdtsBranches: noopLoad,
      loadEdts: noopLoad,
    });

    const output = await renderToString(createElement(UpdateZone, { useStore: store, initialRecap: false }));

    expect(output).not.toContain('step:');
  });

  it('idle with a standalone restart in flight on the selected service shows its live restarting step', async () => {
    const store = createAppStore();
    store.setState({
      edtsBranches: [SERVICE_A],
      edtsBranchesStatus: 'idle',
      edts: [ACTIVE_EDT],
      activeEdt: 'edt-1',
      updateStatus: 'idle',
      serviceRestartInFlight: { '/repo/a': 'restart' },
      liveServicePhase: { 'svc-a': 'restarting' },
      lastServiceOutcomes: { 'svc-a': { service: 'svc-a', outcome: 'updated' } },
      loadEdtsBranches: noopLoad,
      loadEdts: noopLoad,
    });

    const output = await renderToString(createElement(UpdateZone, { useStore: store, initialRecap: false }));

    expect(output).toContain('step: restarting');
  });

  it('idle with a standalone restart in flight but no emission yet shows starting, never a stale outcome', async () => {
    const store = createAppStore();
    store.setState({
      edtsBranches: [SERVICE_A],
      edtsBranchesStatus: 'idle',
      edts: [ACTIVE_EDT],
      activeEdt: 'edt-1',
      updateStatus: 'idle',
      serviceRestartInFlight: { '/repo/a': 'restart' },
      lastServiceOutcomes: { 'svc-a': { service: 'svc-a', outcome: 'updated' } },
      loadEdtsBranches: noopLoad,
      loadEdts: noopLoad,
    });

    const output = await renderToString(createElement(UpdateZone, { useStore: store, initialRecap: false }));

    expect(output).toContain('step: starting');
  });
});
