// tui/zones/update: story 3.7 — unit tests for the pre-run configuration screen's pure
// logic (draft construction, row toggling, branch editing, confirm gating, keystroke
// reducer). The useInput dispatcher itself is never invoked here (the shared harness's
// fake stdin never emits data — the edts-zone convention) — keystroke behavior is verified
// through resolveUpdateConfigKey directly.
import { describe, expect, it } from 'vitest';
import {
  beginUpdateConfigBranchEdit,
  clampUpdateConfigCursor,
  commitUpdateConfigBranchEdit,
  confirmUpdateConfigDraft,
  createUpdateConfigDraft,
  isCleanRestartRow,
  isMigrateRow,
  resolveUpdateConfigKey,
  stepUpdateConfigBranchEdit,
  toggleUpdateConfigRow,
  updateConfigRowCount,
  type UpdateConfigDraft,
} from './update-config-dialog.logic.js';

const ROWS = [
  { service: 'svc-a', repoPath: '/repo/a', sourceBranch: 'development' },
  { service: 'svc-b', repoPath: '/repo/b', sourceBranch: 'development' },
];

function draft(): UpdateConfigDraft {
  return createUpdateConfigDraft('edt', ROWS);
}

describe('createUpdateConfigDraft', () => {
  it('pre-selects every targeted service with the sharedBranch default, migrate ON, clean restart OFF', () => {
    const created = draft();

    expect(created.scope).toBe('edt');
    expect(created.rows).toEqual([
      { service: 'svc-a', repoPath: '/repo/a', sourceBranch: 'development', selected: true },
      { service: 'svc-b', repoPath: '/repo/b', sourceBranch: 'development', selected: true },
    ]);
    expect(created.runMigrations).toBe(true);
    expect(created.cleanRestart).toBe(false);
    expect(created.error).toBeNull();
  });
});

describe('updateConfigRowCount / isMigrateRow / isCleanRestartRow', () => {
  it('focuses every service row then the two toggle rows in order', () => {
    const created = draft();

    expect(updateConfigRowCount(created)).toBe(4);
    expect(isMigrateRow(created, 2)).toBe(true);
    expect(isCleanRestartRow(created, 3)).toBe(true);
    expect(isMigrateRow(created, 0)).toBe(false);
    expect(isCleanRestartRow(created, 1)).toBe(false);
  });

  it('clamps the cursor into the focusable range', () => {
    const created = draft();

    expect(clampUpdateConfigCursor(created, 0)).toBe(0);
    expect(clampUpdateConfigCursor(created, 9)).toBe(3);
    expect(clampUpdateConfigCursor(created, -2)).toBe(0);
  });
});

describe('toggleUpdateConfigRow', () => {
  it('flips one service row without touching the others', () => {
    const toggled = toggleUpdateConfigRow(draft(), 0);

    expect(toggled.rows[0]?.selected).toBe(false);
    expect(toggled.rows[1]?.selected).toBe(true);
    expect(toggled.error).toBeNull();
  });

  it('flips the migrate and clean-restart toggles uniformly', () => {
    const created = draft();

    expect(toggleUpdateConfigRow(created, 2).runMigrations).toBe(false);
    expect(toggleUpdateConfigRow(created, 3).cleanRestart).toBe(true);
    // Service rows are untouched by toggle-row flips.
    expect(toggleUpdateConfigRow(created, 2).rows.every((row) => row.selected)).toBe(true);
  });

  it('leaves the draft untouched on an out-of-range cursor', () => {
    const created = draft();

    expect(toggleUpdateConfigRow(created, 9)).toBe(created);
  });
});

describe('branch editing', () => {
  it('begins pre-filled with the row caret at the end, steps text, and commits back into the row', () => {
    const created = draft();

    const editing = beginUpdateConfigBranchEdit(created, 0);
    expect(editing).toEqual({ value: 'development', cursor: 'development'.length });

    const stepped = stepUpdateConfigBranchEdit(editing!, 'x', {});
    expect(stepped).toEqual({ value: 'developmentx', cursor: 'development'.length + 1 });

    const committed = commitUpdateConfigBranchEdit(created, 0, stepped.value);
    expect(committed.rows[0]?.sourceBranch).toBe('developmentx');
    expect(committed.rows[1]?.sourceBranch).toBe('development');
    expect(committed.error).toBeNull();
  });

  it('rejects a blank branch inline and keeps the previous branch', () => {
    const created = draft();

    const committed = commitUpdateConfigBranchEdit(created, 1, '   ');

    expect(committed.error).toBe('Branch name must not be empty');
    expect(committed.rows[1]?.sourceBranch).toBe('development');
  });

  it('has no branch editor for toggle rows or out-of-range cursors', () => {
    const created = draft();

    expect(beginUpdateConfigBranchEdit(created, 2)).toBeNull();
    expect(beginUpdateConfigBranchEdit(created, 9)).toBeNull();
    expect(commitUpdateConfigBranchEdit(created, 9, 'x')).toBe(created);
  });
});

describe('confirmUpdateConfigDraft', () => {
  it('confirms exactly the selected services with their branches plus the uniform toggles', () => {
    const deselected = toggleUpdateConfigRow(draft(), 1);

    const confirmed = confirmUpdateConfigDraft(deselected);

    expect(confirmed).toEqual({
      ok: true,
      config: {
        scope: 'edt',
        selection: [{ service: 'svc-a', repoPath: '/repo/a', sourceBranch: 'development' }],
        runMigrations: true,
        cleanRestart: false,
      },
    });
  });

  it('carries a confirmed branch override and flipped toggles through', () => {
    let created = commitUpdateConfigBranchEdit(draft(), 0, 'release/1');
    created = toggleUpdateConfigRow(created, 2);
    created = toggleUpdateConfigRow(created, 3);

    const confirmed = confirmUpdateConfigDraft(created);

    expect(confirmed).toEqual({
      ok: true,
      config: {
        scope: 'edt',
        selection: [
          { service: 'svc-a', repoPath: '/repo/a', sourceBranch: 'release/1' },
          { service: 'svc-b', repoPath: '/repo/b', sourceBranch: 'development' },
        ],
        runMigrations: false,
        cleanRestart: true,
      },
    });
  });

  it('rejects zero selected with an explicit message', () => {
    let created = toggleUpdateConfigRow(draft(), 0);
    created = toggleUpdateConfigRow(created, 1);

    const confirmed = confirmUpdateConfigDraft(created);

    expect(confirmed.ok).toBe(false);
    if (!confirmed.ok) {
      expect(confirmed.error).toContain('No services selected');
    }
  });

  it('rejects a blank branch on any selected row with an explicit message', () => {
    for (const blank of ['', '   ']) {
      const created: UpdateConfigDraft = {
        ...draft(),
        rows: draft().rows.map((row) => (row.service === 'svc-a' ? { ...row, sourceBranch: blank } : row)),
      };

      const confirmed = confirmUpdateConfigDraft(created);

      expect(confirmed.ok).toBe(false);
      if (!confirmed.ok) {
        expect(confirmed.error).toContain('svc-a');
        expect(confirmed.error).toContain('empty source branch');
      }
    }
  });
});

describe('resolveUpdateConfigKey', () => {
  it('moves with arrows/Home/End, clamped at the ends', () => {
    const created = draft();
    const view = { cursor: 1, editing: null };

    expect(resolveUpdateConfigKey('', { downArrow: true }, view, created)).toEqual({ type: 'move', cursor: 2 });
    expect(resolveUpdateConfigKey('', { upArrow: true }, view, created)).toEqual({ type: 'move', cursor: 0 });
    expect(resolveUpdateConfigKey('', { home: true }, view, created)).toEqual({ type: 'move', cursor: 0 });
    expect(resolveUpdateConfigKey('', { end: true }, view, created)).toEqual({ type: 'move', cursor: 3 });
    expect(resolveUpdateConfigKey('', { downArrow: true }, { cursor: 3, editing: null }, created)).toEqual({
      type: 'move',
      cursor: 3,
    });
  });

  it('toggles on Space, begins a branch edit on e/Enter over a service row', () => {
    const created = draft();

    expect(resolveUpdateConfigKey(' ', {}, { cursor: 0, editing: null }, created)).toEqual({ type: 'toggle' });
    expect(resolveUpdateConfigKey('e', {}, { cursor: 0, editing: null }, created)).toEqual({ type: 'begin-edit' });
    expect(resolveUpdateConfigKey('', { return: true }, { cursor: 1, editing: null }, created)).toEqual({
      type: 'begin-edit',
    });
  });

  it('toggles on Enter over a toggle row, ignores e there', () => {
    const created = draft();

    expect(resolveUpdateConfigKey('', { return: true }, { cursor: 2, editing: null }, created)).toEqual({ type: 'toggle' });
    expect(resolveUpdateConfigKey('e', {}, { cursor: 2, editing: null }, created)).toEqual({ type: 'ignore' });
  });

  it('confirms on y, cancels the dialog on Esc, ignores anything else', () => {
    const created = draft();

    expect(resolveUpdateConfigKey('y', {}, { cursor: 0, editing: null }, created)).toEqual({ type: 'confirm' });
    expect(resolveUpdateConfigKey('Y', {}, { cursor: 0, editing: null }, created)).toEqual({ type: 'confirm' });
    expect(resolveUpdateConfigKey('', { escape: true }, { cursor: 0, editing: null }, created)).toEqual({ type: 'cancel' });
    expect(resolveUpdateConfigKey('q', {}, { cursor: 0, editing: null }, created)).toEqual({ type: 'ignore' });
    expect(resolveUpdateConfigKey('a', {}, { cursor: 0, editing: null }, created)).toEqual({ type: 'ignore' });
  });

  it('ignores Ctrl/Meta combinations in browse mode', () => {
    const created = draft();

    expect(resolveUpdateConfigKey(' ', { ctrl: true }, { cursor: 0, editing: null }, created)).toEqual({ type: 'ignore' });
    expect(resolveUpdateConfigKey('y', { meta: true }, { cursor: 0, editing: null }, created)).toEqual({ type: 'ignore' });
  });

  it('routes every keystroke to the branch editor while editing: typing steps, Enter commits, Esc cancels the edit', () => {
    const created = draft();
    const editing = { value: 'developmen', cursor: 10 };

    const stepped = resolveUpdateConfigKey('t', {}, { cursor: 0, editing }, created);
    expect(stepped).toEqual({ type: 'edit', editing: { value: 'development', cursor: 11 } });
    expect(resolveUpdateConfigKey('', { return: true }, { cursor: 0, editing }, created)).toEqual({ type: 'commit-edit' });
    expect(resolveUpdateConfigKey('', { escape: true }, { cursor: 0, editing }, created)).toEqual({ type: 'cancel-edit' });
    // Esc cancels the edit, never the dialog — and Ctrl stays inert inside the editor too.
    expect(resolveUpdateConfigKey('y', { ctrl: true }, { cursor: 0, editing }, created)).toEqual({ type: 'ignore' });
  });
});
