// tui/zones/update: tests for the Update zone's pure keystroke/render helpers plus
// renderToString smoke coverage of each visual state (idle prompt, interrupted re-run
// offer, running spinner, done summary, top-level error). The useInput callback itself is
// never invoked here — the shared harness's fake stdin never emits data (the edts-zone
// convention) — so keystroke behavior is verified through the pure functions directly.
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToString } from '../../shared/components/render-to-string.js';
import { createAppStore } from '../../store/app-store.js';
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
  formatBlockerBody,
  formatUpdateRow,
  formatUpdateSummary,
  launchEditor,
  resolveAllConfirm,
  resolveBlockerMenuKey,
  resolveQuitConfirm,
  resolveUpdateTone,
  shouldConfirmQuit,
  shouldOfferRerun,
  shouldOpenAllConfirm,
  UpdateZone,
} from './update-zone.js';

vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:child_process')>();
  return { ...original, spawnSync: vi.fn() };
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

  it('idle with an interrupted active EDT shows the re-run offer', async () => {
    const store = createAppStore();
    store.setState({ edts: INTERRUPTED_EDTS, activeEdt: 'edt-1' });

    const output = await renderToString(createElement(UpdateZone, { useStore: store }));

    expect(output).toContain(UPDATE_INTERRUPTED_OFFER);
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
  });

  it('error shows the message, the kebab-case code, and the retry hint', async () => {
    const store = createAppStore();
    store.setState({ updateStatus: 'error', updateError: 'No active EDT', updateErrorCode: 'no-active-edt' });

    const output = await renderToString(createElement(UpdateZone, { useStore: store }));

    expect(output).toContain('No active EDT');
    expect(output).toContain('no-active-edt');
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
