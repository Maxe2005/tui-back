// tui/zones/update: pure logic of the merge-source strategy — re-resolution, manual rows,
// reset, confirm gating and the panel's keystroke routing.
import { describe, expect, it } from 'vitest';
import {
  applyMergeStrategy,
  beginUpdateConfigBranchEdit,
  commitUpdateConfigBranchEdit,
  confirmUpdateConfigDraft,
  createUpdateConfigDraft,
  resetUpdateConfigRow,
  resolveUpdateConfigKey,
  toggleUpdateConfigRow,
  type MergeStrategy,
} from './update-config-dialog.logic.js';

const ROWS = [
  { service: 'api', repoPath: '/r/api', sourceBranch: 'development' },
  { service: 'web', repoPath: '/r/web', sourceBranch: 'main' },
];

const FROM_EDT: MergeStrategy = {
  kind: 'edt',
  ulid: 'U1',
  topic: 'sibling',
  resolved: [
    { service: 'api', repoPath: '/r/api', source: 'feat/x', origin: 'edt' },
    { service: 'web', repoPath: '/r/web', source: '', origin: 'edt', error: 'not-in-edt' },
  ],
};

const draft = () => createUpdateConfigDraft('edt', ROWS, { mergePanel: true });

describe('applyMergeStrategy', () => {
  it('resolves rows from the chosen EDT and records the reason for unresolved ones', () => {
    const next = applyMergeStrategy(draft(), FROM_EDT);
    expect(next.rows[0]).toMatchObject({ sourceBranch: 'feat/x', origin: 'edt' });
    expect(next.rows[1]).toMatchObject({ sourceBranch: '', sourceError: 'not-in-edt' });
  });

  it('returns every non-manual row to its sharedBranch and clears the errors', () => {
    const back = applyMergeStrategy(applyMergeStrategy(draft(), FROM_EDT), { kind: 'shared' });
    expect(back.rows.map((row) => [row.sourceBranch, row.origin, row.sourceError])).toEqual([
      ['development', 'shared', undefined],
      ['main', 'shared', undefined],
    ]);
  });
});

describe('manual rows', () => {
  const unresolved = () => applyMergeStrategy(draft(), FROM_EDT);

  it('seeds the editor with the sharedBranch of an unresolved row', () => {
    expect(beginUpdateConfigBranchEdit(unresolved(), 1)?.value).toBe('main');
  });

  it('commit marks the row manual and clears its error', () => {
    const next = commitUpdateConfigBranchEdit(unresolved(), 1, 'release/2');
    expect(next.rows[1]).toMatchObject({ sourceBranch: 'release/2', origin: 'manual' });
    expect(next.rows[1]?.sourceError).toBeUndefined();
  });

  it('keeps the manual branch when the strategy changes', () => {
    const manual = commitUpdateConfigBranchEdit(unresolved(), 1, 'release/2');
    expect(applyMergeStrategy(manual, { kind: 'shared' }).rows[1]).toMatchObject({ sourceBranch: 'release/2', origin: 'manual' });
  });

  it('reset follows the current strategy again', () => {
    const manual = commitUpdateConfigBranchEdit(unresolved(), 1, 'release/2');
    expect(resetUpdateConfigRow(manual, 1).rows[1]).toMatchObject({ origin: 'edt', sourceError: 'not-in-edt' });
  });
});

describe('confirmUpdateConfigDraft', () => {
  it('rejects a selected unresolved row and names the service', () => {
    const result = confirmUpdateConfigDraft(applyMergeStrategy(draft(), FROM_EDT));
    expect(result).toMatchObject({ ok: false });
    expect(result.ok ? '' : result.error).toContain('web');
  });

  it('lets a deselected unresolved row through', () => {
    const next = toggleUpdateConfigRow(applyMergeStrategy(draft(), FROM_EDT), 1);
    expect(confirmUpdateConfigDraft(next)).toMatchObject({ ok: true });
  });
});

describe('resolveUpdateConfigKey with the merge panel', () => {
  const view = { cursor: 0, editing: null };

  it('Tab switches focus', () => {
    expect(resolveUpdateConfigKey('', { tab: true }, view, draft())).toEqual({ type: 'switch-focus' });
  });

  it('Tab is inert without the panel', () => {
    const plain = createUpdateConfigDraft('edt', ROWS);
    expect(resolveUpdateConfigKey('', { tab: true }, view, plain)).toEqual({ type: 'ignore' });
  });

  it('Enter in the panel activates the option under the cursor', () => {
    expect(resolveUpdateConfigKey('', { return: true }, { ...view, focus: 'panel', panelCursor: 1 }, draft())).toEqual({
      type: 'panel-activate',
      panelCursor: 1,
    });
  });

  it('Ctrl+R resets only a manual row', () => {
    const manual = commitUpdateConfigBranchEdit(draft(), 0, 'x');
    expect(resolveUpdateConfigKey('r', { ctrl: true }, view, manual)).toEqual({ type: 'reset-row' });
    expect(resolveUpdateConfigKey('r', { ctrl: true }, view, draft())).toEqual({ type: 'ignore' });
  });
});
