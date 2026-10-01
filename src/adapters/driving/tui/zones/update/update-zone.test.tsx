// tui/zones/update: tests for the Update zone's pure keystroke/render helpers plus
// renderToString smoke coverage of each visual state (idle prompt, interrupted re-run
// offer, running spinner, done summary, top-level error). The useInput callback itself is
// never invoked here — the shared harness's fake stdin never emits data (the edts-zone
// convention) — so keystroke behavior is verified through the pure functions directly.
import { spawnSync } from 'node:child_process';
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
import { renderToString } from '../../shared/components/render-to-string.js';
import { fakeTtyStdin, FakeTtyStdout } from '../../shared/test-support/fake-tty.js';
import { createAppStore, type AppStoreDeps } from '../../store/app-store.js';
import {
  UPDATE_ALL_CONFIRM_BODY,
  UPDATE_ALL_CONFIRM_TITLE,
  UPDATE_ALL_REPOS_PROMPT,
  UPDATE_ALL_RUNNING_LABEL,
  UPDATE_BLOCKER_MENU_ITEMS,
  UPDATE_BLOCKER_TITLE,
  UPDATE_IDLE_PROMPT,
  UPDATE_INTERRUPTED_OFFER,
  UPDATE_LOADING_MEMBERS,
  UPDATE_QUIT_CONFIRM_BODY,
  UPDATE_QUIT_CONFIRM_BODY_ALL,
  UPDATE_RUNNING_LABEL,
  UPDATE_SELECTION_RUNNING_LABEL,
  formatBlockerBody,
  formatUpdateRow,
  formatUpdateSummary,
  launchEditor,
  resolveAllConfirm,
  resolveBlockerMenuKey,
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
  resolveEditorCommand,
  tokenizeCommandLine,
} from './update-zone.logic.js';
import { toServicePickItems } from './update-service-pick-dialog.js';
import { matchPickItemsBySubstring } from '../../shared/components/filterable-pick-list.js';

vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:child_process')>();
  return { ...original, spawnSync: vi.fn(() => ({ status: 0 })) };
});

const INTERRUPTED_EDTS = [
  {
    ulid: 'edt-1',
    topic: 'demo',
    createdAt: '2026-09-17T00:00:00.000Z',
    status: 'interrupted' as const,
    members: [{ service: 'svc-a', repoPath: '/repo/a', branch: 'feat/a' }],
  },
];

// Story 3.6: the Update zone's own always-visible service-list fixtures.
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

  it('surfaces the story 3.2 migrate phase: a migration-failed row names the command and its error output', () => {
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
    expect(resolveQuitConfirm('y', {})).toBe('confirm');
    expect(resolveQuitConfirm('Y', {})).toBe('confirm');
    expect(resolveQuitConfirm('', { return: true })).toBe('confirm');
    expect(resolveQuitConfirm('n', {})).toBe('cancel');
    expect(resolveQuitConfirm('', { escape: true })).toBe('cancel');
    expect(resolveQuitConfirm('q', {})).toBeNull();
  });
});

describe('shouldOpenAllConfirm / resolveAllConfirm (story 3.3)', () => {
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

describe('resolveUpdateTrigger (story 3.7, menu in 3.9)', () => {
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

describe('shouldOpenEdtConfig / shouldOpenSingleConfig (story 3.11)', () => {
  it('opens the edt-scoped config on g/G while idle/done/error, never mid-run', () => {
    expect(shouldOpenEdtConfig('g', 'idle')).toBe(true);
    expect(shouldOpenEdtConfig('G', 'done')).toBe(true);
    expect(shouldOpenEdtConfig('g', 'error')).toBe(true);
    expect(shouldOpenEdtConfig('g', 'running')).toBe(false);
    expect(shouldOpenEdtConfig('G', 'running')).toBe(false);
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

describe('resolveUpdateTrigger (story 3.11: g/p)', () => {
  it('opens the edt-scoped config on g/G while idle/done/error', () => {
    expect(resolveUpdateTrigger('g', {}, 'idle')).toBe('open-edt-config');
    expect(resolveUpdateTrigger('G', {}, 'done')).toBe('open-edt-config');
    expect(resolveUpdateTrigger('g', {}, 'error')).toBe('open-edt-config');
  });

  it('opens the single-service config on p/P while idle/done/error', () => {
    expect(resolveUpdateTrigger('p', {}, 'idle')).toBe('open-single-config');
    expect(resolveUpdateTrigger('P', {}, 'done')).toBe('open-single-config');
    expect(resolveUpdateTrigger('p', {}, 'error')).toBe('open-single-config');
  });

  it('yields none for g/p mid-run — a second trigger never starts a direct unconfigured run', () => {
    expect(resolveUpdateTrigger('g', {}, 'running')).toBe('none');
    expect(resolveUpdateTrigger('G', {}, 'running')).toBe('none');
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
describe('toServicePickItems (story 3.11)', () => {
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

describe('UPDATE_BLOCKER_MENU_ITEMS / resolveBlockerMenuKey (story 3.4)', () => {
  it('offers exactly the four bounded choices in menu order', () => {
    expect(UPDATE_BLOCKER_MENU_ITEMS.map((item) => item.value)).toEqual(['stash', 'edited', 'cancel-repo', 'cancel-run']);
  });

  it('moves the cursor with arrows, clamped at the ends, and ignores anything else', () => {
    expect(resolveBlockerMenuKey('', {}, 1)).toEqual({ type: 'ignore' });
    expect(resolveBlockerMenuKey('', { downArrow: true }, 0)).toEqual({ type: 'move', cursor: 1 });
    expect(resolveBlockerMenuKey('', { downArrow: true }, 3)).toEqual({ type: 'move', cursor: 3 });
    expect(resolveBlockerMenuKey('', { upArrow: true }, 2)).toEqual({ type: 'move', cursor: 1 });
    expect(resolveBlockerMenuKey('', { upArrow: true }, 0)).toEqual({ type: 'move', cursor: 0 });
    expect(resolveBlockerMenuKey('q', {}, 0)).toEqual({ type: 'ignore' });
  });

  it('jumps with Home/End', () => {
    expect(resolveBlockerMenuKey('', { home: true }, 2)).toEqual({ type: 'move', cursor: 0 });
    expect(resolveBlockerMenuKey('', { end: true }, 0)).toEqual({ type: 'move', cursor: 3 });
  });

  it('chooses the cursor row on Enter and answers cancel-repo on Escape', () => {
    expect(resolveBlockerMenuKey('', { return: true }, 0)).toEqual({ type: 'choose', choice: 'stash' });
    expect(resolveBlockerMenuKey('', { return: true }, 1)).toEqual({ type: 'choose', choice: 'edited' });
    expect(resolveBlockerMenuKey('', { return: true }, 2)).toEqual({ type: 'choose', choice: 'cancel-repo' });
    expect(resolveBlockerMenuKey('', { return: true }, 3)).toEqual({ type: 'choose', choice: 'cancel-run' });
    expect(resolveBlockerMenuKey('', { escape: true }, 0)).toEqual({ type: 'choose', choice: 'cancel-repo' });
  });

  it('ignores Enter on an out-of-range cursor', () => {
    expect(resolveBlockerMenuKey('', { return: true }, 9)).toEqual({ type: 'ignore' });
  });
});

describe('launchEditor (story 3.4)', () => {
  const originalEditor = process.env.EDITOR;

  afterEach(() => {
    if (originalEditor === undefined) {
      delete process.env.EDITOR;
    } else {
      process.env.EDITOR = originalEditor;
    }
    vi.mocked(spawnSync).mockClear();
  });

  it('splits $EDITOR flags: first token is the binary, repo path appended last', () => {
    process.env.EDITOR = 'code --wait';

    launchEditor('/repo/a');

    expect(vi.mocked(spawnSync)).toHaveBeenCalledWith('code', ['--wait', '/repo/a'], { stdio: 'inherit' });
  });

  it('passes a bare $EDITOR binary with only the repo path', () => {
    process.env.EDITOR = 'hx';

    launchEditor('/repo/a');

    expect(vi.mocked(spawnSync)).toHaveBeenCalledWith('hx', ['/repo/a'], { stdio: 'inherit' });
  });

  it('falls back to vi when $EDITOR is unset or blank', () => {
    delete process.env.EDITOR;

    launchEditor('/repo/a');

    expect(vi.mocked(spawnSync)).toHaveBeenCalledWith('vi', ['/repo/a'], { stdio: 'inherit' });

    process.env.EDITOR = '   ';
    vi.mocked(spawnSync).mockClear();

    launchEditor('/repo/b');

    expect(vi.mocked(spawnSync)).toHaveBeenCalledWith('vi', ['/repo/b'], { stdio: 'inherit' });
  });

  it('the configured command wins over $EDITOR, with <repo> replaced by the blocked repo path', () => {
    process.env.EDITOR = 'hx';

    expect(launchEditor('/repo/a', 'code <repo>')).toEqual({ ok: true });

    expect(vi.mocked(spawnSync)).toHaveBeenCalledWith('code', ['/repo/a'], { stdio: 'inherit' });
  });

  it('a blank configured command falls through to $EDITOR', () => {
    process.env.EDITOR = 'hx';

    launchEditor('/repo/a', '   ');

    expect(vi.mocked(spawnSync)).toHaveBeenCalledWith('hx', ['/repo/a'], { stdio: 'inherit' });
  });

  it('reports a command that could not be started instead of failing silently', () => {
    vi.mocked(spawnSync).mockReturnValueOnce({ error: new Error('spawnSync nope ENOENT') } as ReturnType<typeof spawnSync>);

    expect(launchEditor('/repo/a', 'nope <repo>')).toEqual({ ok: false, message: 'Could not launch "nope": spawnSync nope ENOENT' });
  });
});

describe('resolveEditorCommand', () => {
  it('replaces every <repo> occurrence, including inside a larger argument', () => {
    expect(resolveEditorCommand('code --new-window <repo>', undefined, '/repo/a')).toEqual({ binary: 'code', args: ['--new-window', '/repo/a'] });
    expect(resolveEditorCommand('ed --folder-uri=file://<repo> <repo>', undefined, '/repo/a')).toEqual({
      binary: 'ed',
      args: ['--folder-uri=file:///repo/a', '/repo/a'],
    });
  });

  it('appends the repo path when the command carries no placeholder', () => {
    expect(resolveEditorCommand('code --wait', undefined, '/repo/a')).toEqual({ binary: 'code', args: ['--wait', '/repo/a'] });
  });

  it('keeps a repo path containing spaces as one argument', () => {
    expect(resolveEditorCommand('code <repo>', undefined, '/my repos/a')).toEqual({ binary: 'code', args: ['/my repos/a'] });
  });

  it('falls back setting -> $EDITOR -> vi, skipping blank values', () => {
    expect(resolveEditorCommand('', 'hx', '/repo/a')).toEqual({ binary: 'hx', args: ['/repo/a'] });
    expect(resolveEditorCommand('  ', '  ', '/repo/a')).toEqual({ binary: 'vi', args: ['/repo/a'] });
    expect(resolveEditorCommand('', undefined, '/repo/a')).toEqual({ binary: 'vi', args: ['/repo/a'] });
  });
});

describe('tokenizeCommandLine', () => {
  it('splits on runs of whitespace', () => {
    expect(tokenizeCommandLine('  code   --wait\t<repo> ')).toEqual(['code', '--wait', '<repo>']);
    expect(tokenizeCommandLine('   ')).toEqual([]);
  });

  it('keeps quoted segments (single or double) as one token, quotes removed', () => {
    expect(tokenizeCommandLine('"/opt/My Editor/bin/ed" --title \'a b\' <repo>')).toEqual(['/opt/My Editor/bin/ed', '--title', 'a b', '<repo>']);
    expect(tokenizeCommandLine('ed --flag=""')).toEqual(['ed', '--flag=']);
  });
});

describe('formatBlockerBody (story 3.4)', () => {
  it('names the service, path, and kind for every blocker kind', () => {
    expect(formatBlockerBody({ service: 'svc-a', repoPath: '/repo/a', kind: 'dirty-worktree' })).toContain('/repo/a');
    expect(formatBlockerBody({ service: 'svc-a', repoPath: '/repo/a', kind: 'merge-conflict' })).toContain('conflict');
    expect(formatBlockerBody({ service: 'svc-a', repoPath: '/repo/a', kind: 'mid-merge' })).toContain('mid-merge');
    expect(formatBlockerBody({ service: 'svc-a', repoPath: '/repo/a', kind: 'mid-rebase' })).toContain('mid-rebase');
    expect(formatBlockerBody({ service: 'svc-a', repoPath: '/repo/a', kind: 'mid-rebase' })).toContain('never touched');
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
    expect(UPDATE_IDLE_PROMPT).toContain('[G]');
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
    expect(output).toContain('[Enter] confirm  [Esc] cancel');
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
    expect(UPDATE_INTERRUPTED_OFFER).toContain('for service actions');
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
    expect(output).toContain(UPDATE_LOADING_MEMBERS);
  });

  it('an all-repos run shows the all label with the generic loading line, never EDT member rows', async () => {
    const store = createAppStore();
    store.setState({ edts: INTERRUPTED_EDTS, activeEdt: 'edt-1', updateStatus: 'running', updateScope: 'all' });

    const output = await renderToString(createElement(UpdateZone, { useStore: store }));

    expect(output).toContain(UPDATE_ALL_RUNNING_LABEL);
    expect(output).not.toContain(UPDATE_RUNNING_LABEL);
    expect(output).toContain(UPDATE_LOADING_MEMBERS);
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

    expect(output).toContain('✔ svc-a — updated');
    expect(output).toContain('✖ svc-b — failed (merge-conflict): conflict');
    expect(output).toContain('1 updated, 0 skipped, 1 failed');
    // Story 3.9: Enter opens the row-local service menu — the follow-up hint promises
    // the menu, never a direct re-run.
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

    expect(output).toContain('✔ route-explorer — updated');
    expect(output).toContain('✖ route-explorer — failed (merge-conflict): conflict');
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
    // Story 3.9: the retry hint promises the service-actions menu, never a direct retry.
    expect(output).toContain(UPDATE_IDLE_PROMPT);
    expect(output).not.toContain('to try again');
  });

  it('a raised blocker renders the modal title, body, and all four choices', async () => {
    const store = createAppStore();
    store.setState({
      updateStatus: 'running',
      updateBlocker: { service: 'svc-a', repoPath: '/repo/a', kind: 'dirty-worktree' },
    });

    const output = await renderToString(createElement(UpdateZone, { useStore: store }));

    expect(output).toContain(UPDATE_BLOCKER_TITLE);
    expect(output).toContain('svc-a');
    expect(output).toContain('/repo/a');
    for (const item of UPDATE_BLOCKER_MENU_ITEMS) {
      expect(output).toContain(item.label);
    }
  });

  it('no raised blocker renders no blocker modal', async () => {
    const store = createAppStore();

    const output = await renderToString(createElement(UpdateZone, { useStore: store }));

    expect(output).not.toContain(UPDATE_BLOCKER_TITLE);
  });
});

describe('deriveUpdateServiceStatus (story 3.6, restarting in 3.9)', () => {
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

  it('a targeted service in its migrate phase derives migrating — the first producer of the reserved glyph (story 3.10)', () => {
    expect(deriveUpdateServiceStatus('up', undefined, true, false, 'migrating')).toBe('migrating');
    expect(deriveUpdateServiceStatus('down', 'failed', true, false, 'migrating')).toBe('migrating');
  });

  it('a targeted service in any other live phase still derives updating (story 3.10)', () => {
    expect(deriveUpdateServiceStatus('up', undefined, true, false, 'pulling')).toBe('updating');
    expect(deriveUpdateServiceStatus('up', undefined, true, false, 'merging')).toBe('updating');
    expect(deriveUpdateServiceStatus('up', undefined, true, false, 'restarting')).toBe('updating');
    expect(deriveUpdateServiceStatus('up', undefined, true, false, undefined)).toBe('updating');
  });

  it('a live phase never leaks into the status when no run targets the service (story 3.10)', () => {
    expect(deriveUpdateServiceStatus('up', undefined, false, false, 'migrating')).toBe('up');
    expect(deriveUpdateServiceStatus('up', 'failed', false, false, 'migrating')).toBe('error');
  });
});

describe('partitionUpdateServiceRows (story 3.6)', () => {
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

describe('formatServiceOutcomeDetail (story 3.6)', () => {
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

describe('formatLiveServiceDetail (story 3.10)', () => {
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

describe('mergeLastServiceOutcomes (story 3.6)', () => {
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

describe('UpdateZone service-list shell rendering (story 3.6)', () => {
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

    const output = await renderToString(createElement(UpdateZone, { useStore: store }));

    expect(output).toContain('svc-a');
    expect(output).toContain('svc-b');
    // No health poll has resolved yet — the I/O matrix's "glyph falls back to down" —
    // rendered as StatusBadge's down glyph.
    expect(output).toContain('○');
    // The first row (svc-a, the EDT member) is selected by default; no run has ever
    // targeted it, so the detail pane reads "idle".
    expect(output).toContain('idle');
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

    const output = await renderToString(createElement(UpdateZone, { useStore: store }));
    const lines = output.split('\n');

    // Review fix: isolate each service's own *list row* line (identified by its unique
    // meta text "+0/-0", which only the list row — not the running-members spinner line
    // that also mentions the service name — carries) so a bug that marks every row
    // 'updating' regardless of scope (e.g. isTargeted collapsed to bare `updateStatus ===
    // 'running'`) would actually fail this test.
    const svcARow = lines.find((line) => line.includes('svc-a') && line.includes('+0/-0'));
    const svcBRow = lines.find((line) => line.includes('svc-b') && line.includes('+0/-0'));
    expect(svcARow).toBeDefined();
    expect(svcBRow).toBeDefined();

    // svc-a is the active EDT's sole member — targeted by this EDT-scoped run.
    expect(svcARow).toContain('⇄');
    expect(svcARow).not.toContain('○');

    // svc-b is not an EDT member and no run has ever targeted it — no health poll has
    // resolved yet either, so it still shows the raw-health `down` fallback, never
    // 'updating'.
    expect(svcBRow).toContain('○');
    expect(svcBRow).not.toContain('⇄');
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

    const output = await renderToString(createElement(UpdateZone, { useStore: store }));
    const lines = output.split('\n');
    const svcARow = lines.find((line) => line.includes('svc-a') && line.includes('+0/-0'));
    const svcBRow = lines.find((line) => line.includes('svc-b') && line.includes('+0/-0'));

    expect(svcBRow).toContain('⇄');
    expect(svcARow).toContain('○');
    expect(svcARow).not.toContain('⇄');
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

    const output = await renderToString(createElement(UpdateZone, { useStore: store }));
    const lines = output.split('\n');
    const svcARow = lines.find((line) => line.includes('svc-a') && line.includes('+0/-0'));
    const svcBRow = lines.find((line) => line.includes('svc-b') && line.includes('+0/-0'));

    expect(svcBRow).toContain('⇄');
    expect(svcARow).not.toContain('⇄');
    expect(output).toContain(UPDATE_SELECTION_RUNNING_LABEL);
    expect(output).not.toContain(UPDATE_ALL_RUNNING_LABEL);
    expect(output).not.toContain(UPDATE_LOADING_MEMBERS);
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

    const output = await renderToString(createElement(UpdateZone, { useStore: store }));

    expect(output).toContain('✖');
    expect(output).toContain('failed (merge-conflict): Automatic merge failed');
  });
});

// Review fix (story 3.6): every render test above uses `createAppStore()` with no deps, under
// which `pollServiceHealth` early-returns (`if (!deps) return;`) regardless of which
// path/service values the mount effect passed it — so a bug that polled by `row.service`
// instead of `row.path` (a plausible slip, since `updateServiceHealth[row.path]` reads by
// path) would silently render every row stuck on the `down` fallback with zero test
// failures. This block wires real (fake-port) deps into the store — mirroring
// update-slice.test.ts's own story-3.6 health-polling fakeDeps — and mounts UpdateZone with
// a real Ink render loop so the mount effect's fire-and-forget poll chain actually runs.
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
    discardPathsToHead: vi.fn(async () => ok(undefined)),
    isRebaseInProgress: vi.fn(async () => ok(false)),
    hasUnmergedPaths: vi.fn(async () => ok(false)),
    finalizeMerge: vi.fn(async () => ok(undefined)),
    listBranches: vi.fn(async () => ok([])),
    renameBranch: vi.fn(async () => ok(undefined)),
    isBranchMerged: vi.fn(async () => ok(true)),
    hasStash: vi.fn(async () => ok(false)),
    listRemoteBranches: vi.fn(async () => ok([])),
    createTrackingBranch: vi.fn(async () => ok(undefined)),
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

describe('UpdateZone health-poll wiring against real (fake-port) deps (story 3.6)', () => {
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
    const instance = render(createElement(UpdateZone, { useStore: store }), {
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

describe('UpdateZone live per-service detail (story 3.10)', () => {
  it('running with the selected service targeted shows its live step plus the issue log instead of the last outcome', async () => {
    const store = createAppStore();
    store.setState({
      edtsBranches: [SERVICE_A, SERVICE_B],
      edtsBranchesStatus: 'idle',
      edts: [ACTIVE_EDT],
      activeEdt: 'edt-1',
      updateStatus: 'running',
      liveServicePhase: { 'svc-a': 'pulling' },
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

    const output = await renderToString(createElement(UpdateZone, { useStore: store }));

    // The first row (svc-a, the EDT member) is selected and targeted — the live view
    // replaces the last-outcome view that would otherwise read "updated".
    expect(output).toContain('step: pulling');
    expect(output).toContain('○ dirty-worktree — /repo/a (unresolved)');
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

    const output = await renderToString(createElement(UpdateZone, { useStore: store }));

    expect(output).toContain('step: starting');
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
      loadEdtsBranches: noopLoad,
      loadEdts: noopLoad,
    });

    const output = await renderToString(createElement(UpdateZone, { useStore: store }));
    const lines = output.split('\n');
    const svcARow = lines.find((line) => line.includes('svc-a') && line.includes('+0/-0'));

    expect(svcARow).toBeDefined();
    expect(svcARow).toContain('⇒');
    expect(output).toContain('step: migrating');
  });

  it('running with a non-targeted service selected keeps the last-outcome view, never the live step', async () => {
    const store = createAppStore();
    store.setState({
      edtsBranches: [SERVICE_B],
      edtsBranchesStatus: 'idle',
      edts: [ACTIVE_EDT],
      activeEdt: 'edt-1',
      updateStatus: 'running',
      liveServicePhase: { 'svc-a': 'pulling' },
      loadEdtsBranches: noopLoad,
      loadEdts: noopLoad,
    });

    const output = await renderToString(createElement(UpdateZone, { useStore: store }));

    // svc-b is selected but no EDT-scoped run targets it — the idle last-outcome view.
    expect(output).not.toContain('step:');
    expect(output).toContain('idle');
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

    const output = await renderToString(createElement(UpdateZone, { useStore: store }));

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

    const output = await renderToString(createElement(UpdateZone, { useStore: store }));

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

    const output = await renderToString(createElement(UpdateZone, { useStore: store }));

    expect(output).toContain('step: starting');
  });
});
