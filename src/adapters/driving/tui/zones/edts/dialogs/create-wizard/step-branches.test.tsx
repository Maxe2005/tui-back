import { describe, expect, it } from 'vitest';
import { renderToString } from '../../../../shared/components/render-to-string.js';
import { BRANCH_MAX_WIDTH, initialCreateDialog, type BranchStepState, type CreateDialogState } from '../../edts-zone.logic.js';
import type { EdtDialogState } from '../../edts-zone.logic.js';
import { BranchStepView, createBranchStepHandlers, reduceBranchStepKey } from './step-branches.js';

const LONG_SERVICE = 'a-very-long-service-name-that-never-ends';
const LONG_BRANCH = 'feature/an-extremely-long-branch-name-for-testing';
const CANDIDATES = [{ path: '/repos/a', service: LONG_SERVICE, sharedBranch: 'main', protectedBranches: [] }];

function dialog(branches: Partial<BranchStepState> = {}): CreateDialogState {
  const base = initialCreateDialog();
  return {
    ...base,
    step: 3,
    topic: 'demo',
    selectedMembers: ['/repos/a'],
    branches: {
      ...base.branches,
      globalName: { value: 'demo', cursor: 4 },
      lists: { '/repos/a': { status: 'ready', local: ['main', LONG_BRANCH], remote: [] } },
      ...branches,
    },
  };
}

describe('BranchStepView — Panel B cells (story 2.37 review)', () => {
  it('truncates long service names and branch refs to BRANCH_MAX_WIDTH', async () => {
    const output = await renderToString(
      <BranchStepView
        dialog={dialog({ overrides: { '/repos/a': { kind: 'existing', branch: LONG_BRANCH } } })}
        candidates={CANDIDATES}
        maxRows={5}
        maxVisibleRows={5}
      />,
    );
    expect(output).not.toContain(LONG_SERVICE);
    expect(output).not.toContain(LONG_BRANCH);
    expect(output).toContain(`${LONG_SERVICE.slice(0, BRANCH_MAX_WIDTH - 1)}…`);
    expect(output).toContain(`${LONG_BRANCH.slice(0, BRANCH_MAX_WIDTH - 1)}…`);
  });

  it('spells out a blocked row\'s full error on the detail line under the table', async () => {
    const output = await renderToString(
      <BranchStepView
        dialog={dialog({ lists: { '/repos/a': { status: 'error', local: [], remote: [], error: 'fatal: not a git repository' } } })}
        candidates={CANDIDATES}
        maxRows={5}
        maxVisibleRows={5}
      />,
    );
    expect(output).toContain('échec du chargement des branches : fatal: not a git repository');
  });
});

describe('reduceBranchStepKey (story 2.37 review)', () => {
  const CANDS = [{ path: '/repos/a', service: 'svc-a', sharedBranch: 'main', protectedBranches: [] }];
  const editingName = (): CreateDialogState => dialog({ globalLine: 'name', editing: true, globalName: { value: 'demo', cursor: 4 } });

  it('a pure caret move while editing the global name leaves it untouched', () => {
    for (const key of [{ leftArrow: true }, { home: true }, { end: true }, { rightArrow: true }]) {
      const { state } = reduceBranchStepKey(editingName(), CANDS, '', key);
      expect(state.branches.globalName.value).toBe('demo');
      expect(state.branches.globalNameTouched).toBe(false);
    }
    const moved = reduceBranchStepKey(editingName(), CANDS, '', { home: true }).state;
    expect(moved.branches.globalName.cursor).toBe(0);
  });

  it('a value change marks the global name touched', () => {
    const { state } = reduceBranchStepKey(editingName(), CANDS, 'x', {});
    expect(state.branches.globalName.value).toBe('demox');
    expect(state.branches.globalNameTouched).toBe(true);
  });

  it('fixing the base or the name clears a stale "cannot leave Step 3" error', () => {
    const blocked = { ...dialog({ editing: true, globalBase: { value: 'nope', cursor: 4 } }), error: 'svc-a : branche introuvable' };
    expect(reduceBranchStepKey(blocked, CANDS, '', { backspace: true }).state.error).toBeNull();
    const blockedName = { ...editingName(), error: 'svc-a : nom de branche vide' };
    expect(reduceBranchStepKey(blockedName, CANDS, 'q', {}).state.error).toBeNull();
    // A pure focus/caret move is not a fix: the message stays.
    expect(reduceBranchStepKey(blockedName, CANDS, '', { leftArrow: true }).state.error).toBe('svc-a : nom de branche vide');
  });

  it('Space never starts editing the base line; other printable keys do, with the key typed', () => {
    const idle = dialog();
    const space = reduceBranchStepKey(idle, CANDS, ' ', {});
    expect(space.state.branches.editing).toBe(false);
    expect(space.state.branches.globalBase.value).toBe('');
    const typed = reduceBranchStepKey(idle, CANDS, 'r', {});
    expect(typed.state.branches.editing).toBe(true);
    expect(typed.state.branches.globalBase.value).toBe('r');
  });

  it('Esc closes the innermost element first and only reports cancel when nothing is open', () => {
    const editing = dialog({ editing: true });
    const left = reduceBranchStepKey(editing, CANDS, '', { escape: true });
    expect(left.cancel).toBe(false);
    expect(left.state.branches.editing).toBe(false);
    expect(reduceBranchStepKey(left.state, CANDS, '', { escape: true }).cancel).toBe(true);
  });
});

describe('createBranchStepHandlers — decisions against the latest state (story 2.37 review)', () => {
  it('Enter then Esc queued in one batch enter and leave edit mode — the Esc never cancels', () => {
    // React applies queued updaters lazily and in order; both keys are handled before either
    // updater runs (keys arriving in one input chunk), so nothing may be decided up front.
    const queue: Array<(prev: EdtDialogState) => EdtDialogState> = [];
    const handlers = createBranchStepHandlers({
      setDialog: (updater) => {
        queue.push(typeof updater === 'function' ? updater : () => updater);
      },
      candidates: [{ path: '/repos/a', service: 'svc-a', sharedBranch: 'main', protectedBranches: [] }],
    });
    handlers.handleBranchStepInput('\r', { return: true } as never);
    handlers.handleBranchStepInput('', { escape: true } as never);
    const final = queue.reduce<EdtDialogState>((state, updater) => updater(state), dialog());
    expect(final.kind).toBe('create');
    if (final.kind === 'create') {
      expect(final.cancelRequested).toBe(false);
      expect(final.branches.editing).toBe(false);
    }
  });

  it('a lone Esc with nothing open raises cancelRequested for the zone', () => {
    let state: EdtDialogState = dialog();
    const handlers = createBranchStepHandlers({
      setDialog: (updater) => {
        state = typeof updater === 'function' ? updater(state) : updater;
      },
      candidates: [],
    });
    handlers.handleBranchStepInput('', { escape: true } as never);
    expect(state.kind === 'create' && state.cancelRequested).toBe(true);
  });
});
