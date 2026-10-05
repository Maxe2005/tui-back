import { describe, expect, it } from 'vitest';
import { createUpdateConfigDraft } from './update-config-dialog.logic.js';
import { toggleMergeSource } from './update-config-panels.logic.js';
import {
  applyServiceBox,
  cycleToggle,
  openServiceBox,
  reduceServiceBoxKey,
  type ServiceBoxContext,
} from './update-service-box.logic.js';

const CONTEXT: ServiceBoxContext = {
  service: 'api',
  branches: ['development', 'feat/x'],
  branchesStatus: 'ready',
  migrationDeclared: true,
  recipeDeclared: false,
};
const draft = () =>
  createUpdateConfigDraft('edt', [{ service: 'api', repoPath: '/r/api', sourceBranch: 'development' }], { layout: 'edt-panels' });

describe('service box', () => {
  it('only offers `oui` for declared actions', () => {
    expect(cycleToggle('off', true)).toBe('on');
    expect(cycleToggle('off', false)).toBe('follow');
  });

  it('opens with an empty field for a row that follows the global source', () => {
    expect(openServiceBox(draft(), 0)?.branch.value).toBe('');
  });

  it('Space changes a declared toggle but leaves an undeclared line alone', () => {
    const box = { ...openServiceBox(draft(), 0)!, line: 'migrations' as const };
    const next = reduceServiceBoxKey(box, CONTEXT, ' ', {});
    expect(next).toMatchObject({ type: 'update', box: { migrations: 'off' } });
    const restart = { ...box, line: 'restart' as const };
    expect(reduceServiceBoxKey(restart, CONTEXT, ' ', {})).toMatchObject({ box: { cleanRestart: 'follow' } });
  });

  it('refuses a branch outside the list in the field and in apply', () => {
    const editing = { ...openServiceBox(draft(), 0)!, editing: true, branch: { value: 'nope', cursor: 4, pickCursor: 0, highlighted: false } };
    expect(reduceServiceBoxKey(editing, CONTEXT, '', { return: true })).toMatchObject({ type: 'update', box: { editing: true, error: expect.stringContaining('nope') } });
    expect(applyServiceBox(draft(), editing, CONTEXT)).toMatchObject({ ok: false });
  });

  it('apply with an untouched empty field changes no branch; a typed branch makes the row perso', () => {
    const untouched = openServiceBox(draft(), 0)!;
    const same = applyServiceBox(draft(), untouched, CONTEXT);
    expect(same.ok && same.draft.rows[0]).toMatchObject({ origin: 'shared' });
    const typed = { ...untouched, branch: { value: 'feat/x', cursor: 6, pickCursor: 0, highlighted: false } };
    const applied = applyServiceBox(draft(), typed, CONTEXT);
    expect(applied.ok && applied.draft.rows[0]).toMatchObject({ origin: 'manual', sourceBranch: 'feat/x' });
  });

  it('apply stores the toggle overrides', () => {
    const box = { ...openServiceBox(draft(), 0)!, migrations: 'off' as const };
    const applied = applyServiceBox(draft(), box, CONTEXT);
    expect(applied.ok && applied.draft.rows[0]).toMatchObject({ migrations: 'off' });
  });

  it('clearing a manual branch under From EDT keeps the row perso on sharedBranch', () => {
    const fromEdt = toggleMergeSource(draft());
    const manualRow = { ...fromEdt.rows[0]!, origin: 'manual' as const, sourceBranch: 'feat/x', sourceError: undefined };
    const withManual = { ...fromEdt, rows: [manualRow] };
    const box = { ...openServiceBox(withManual, 0)!, branch: { value: '', cursor: 0, pickCursor: 0, highlighted: false } };
    const applied = applyServiceBox(withManual, box, CONTEXT);
    expect(applied.ok && applied.draft.rows[0]).toMatchObject({ origin: 'manual', sourceBranch: 'development' });
  });

  it('Esc closes and Ctrl+R reverts', () => {
    const box = openServiceBox(draft(), 0)!;
    expect(reduceServiceBoxKey(box, CONTEXT, '', { escape: true })).toEqual({ type: 'close' });
    expect(reduceServiceBoxKey(box, CONTEXT, 'r', { ctrl: true })).toEqual({ type: 'revert' });
  });
});
