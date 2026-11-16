import { describe, it, expect } from 'vitest';
import {
  BranchPicker,
  applyBranchPickerRetry,
  createBranchPickerState,
  cycleBranchPickerMode,
  handleBranchPickerKey,
  matchBranchesBySubstring,
  type BranchPickerState,
} from './index.js';
import { branchPickerFooterContext } from './branch-picker.js';
import { renderToString } from './render-to-string.js';

function baseState(overrides: Partial<BranchPickerState> = {}): BranchPickerState {
  return {
    ...createBranchPickerState({
      suggestedName: 'feature-suggested',
      defaultBaseBranch: 'development',
      hasCurrentBranch: true,
      currentBranch: 'main',
    }),
    ...overrides,
  };
}

describe('cycleBranchPickerMode back', () => {
  it('reverses, wrapping', () => {
    expect(cycleBranchPickerMode('pick-existing', true, 'back')).toBe('rename-current');
    expect(cycleBranchPickerMode('create-new', false, 'back')).toBe('pick-existing');
  });
});

describe('cycleBranchPickerMode unknown mode', () => {
  it('lets stepFocus pick the first stop forward and the last going back', () => {
    const unknown = 'nope' as never;
    expect(cycleBranchPickerMode(unknown, true, 'next')).toBe('pick-existing');
    expect(cycleBranchPickerMode(unknown, true, 'back')).toBe('rename-current');
  });
});

describe('cycleBranchPickerMode', () => {
  it('cycles Pick existing -> Create new -> Rename current -> Pick existing when a current branch exists', () => {
    expect(cycleBranchPickerMode('pick-existing', true)).toBe('create-new');
    expect(cycleBranchPickerMode('create-new', true)).toBe('rename-current');
    expect(cycleBranchPickerMode('rename-current', true)).toBe('pick-existing');
  });

  it('skips Rename current entirely when there is no current branch to rename (Add-to-EDT)', () => {
    expect(cycleBranchPickerMode('pick-existing', false)).toBe('create-new');
    expect(cycleBranchPickerMode('create-new', false)).toBe('pick-existing');
  });
});

describe('createBranchPickerState', () => {
  it('defaults to Create new, pre-filled with the suggestion', () => {
    const state = createBranchPickerState({
      suggestedName: 'feature-suggested',
      defaultBaseBranch: 'development',
      hasCurrentBranch: true,
      currentBranch: 'main',
    });
    expect(state.mode).toBe('create-new');
    expect(state.nameValue).toBe('feature-suggested');
    expect(state.baseBranch).toBe('development');
    expect(state.baseFocused).toBe(true);
    // Every field's caret starts at its own seeded value's end.
    expect(state.nameValueCursor).toBe('feature-suggested'.length);
    expect(state.baseBranchCursor).toBe('development'.length);
    expect(state.pickQueryCursor).toBe(0);
  });
});

describe('handleBranchPickerKey — cursor navigation', () => {
  it('Left/Right/Home/End move the name field caret; typing inserts at the caret', () => {
    const state = baseState({ baseFocused: false, nameValue: 'abd', nameValueCursor: 2 });
    const typed = handleBranchPickerKey(state, [], [], 'c', {});
    expect(typed.type).toBe('update');
    if (typed.type === 'update') {
      expect(typed.state.nameValue).toBe('abcd');
      expect(typed.state.nameValueCursor).toBe(3);
    }

    const home = handleBranchPickerKey(state, [], [], '', { home: true });
    expect(home.type).toBe('update');
    if (home.type === 'update') {
      expect(home.state.nameValueCursor).toBe(0);
      expect(home.state.nameValue).toBe('abd');
    }

    const end = handleBranchPickerKey(state, [], [], '', { end: true });
    expect(end.type).toBe('update');
    if (end.type === 'update') {
      expect(end.state.nameValueCursor).toBe(3);
    }

    // Left/Right-at-boundary clamp.
    const left = handleBranchPickerKey(baseState({ baseFocused: false, nameValue: 'ab', nameValueCursor: 0 }), [], [], '', { leftArrow: true });
    expect(left.type).toBe('update');
    if (left.type === 'update') {
      expect(left.state.nameValueCursor).toBe(0);
    }

    // Left/Right both really move the caret — a decrement from a non-zero position (Left) and a
    // mid-string advance (Right), not just the already-at-0 clamp above.
    const leftFromMid = handleBranchPickerKey(baseState({ baseFocused: false, nameValue: 'abcd', nameValueCursor: 3 }), [], [], '', { leftArrow: true });
    expect(leftFromMid.type).toBe('update');
    if (leftFromMid.type === 'update') {
      expect(leftFromMid.state.nameValueCursor).toBe(2);
      expect(leftFromMid.state.nameValue).toBe('abcd');
    }

    const rightFromMid = handleBranchPickerKey(baseState({ baseFocused: false, nameValue: 'abcd', nameValueCursor: 1 }), [], [], '', { rightArrow: true });
    expect(rightFromMid.type).toBe('update');
    if (rightFromMid.type === 'update') {
      expect(rightFromMid.state.nameValueCursor).toBe(2);
      expect(rightFromMid.state.nameValue).toBe('abcd');
    }
  });

  it('Backspace/Delete edit at the caret, not always the end', () => {
    const state = baseState({ baseFocused: false, nameValue: 'abcd', nameValueCursor: 2 });
    const backspaced = handleBranchPickerKey(state, [], [], '', { backspace: true });
    expect(backspaced.type).toBe('update');
    if (backspaced.type === 'update') {
      expect(backspaced.state.nameValue).toBe('acd');
      expect(backspaced.state.nameValueCursor).toBe(1);
    }

    const deleted = handleBranchPickerKey(state, [], [], '', { delete: true });
    expect(deleted.type).toBe('update');
    if (deleted.type === 'update') {
      expect(deleted.state.nameValue).toBe('abd');
      expect(deleted.state.nameValueCursor).toBe(2);
    }
  });
});

describe('handleBranchPickerKey — mode cycling (Tab)', () => {
  it('Tab cycles the mode switch', () => {
    const state = baseState();
    const result = handleBranchPickerKey(state, [], [], '', { tab: true });
    expect(result.type).toBe('update');
    if (result.type === 'update') {
      expect(result.state.mode).toBe('rename-current');
      // Pre-selected onto the current branch, skipping the picking step.
      expect(result.state.renameSub).toEqual({ oldName: 'main', value: 'main', cursor: 4, error: null });
    }
  });

  it('Tab from Rename current wraps back to Pick existing', () => {
    const state = baseState({ mode: 'rename-current', renameSub: { oldName: 'main', value: 'main', cursor: 4, error: null } });
    const result = handleBranchPickerKey(state, [], [], '', { tab: true });
    expect(result.type).toBe('update');
    if (result.type === 'update') {
      expect(result.state.mode).toBe('pick-existing');
      expect(result.state.renameSub).toBeNull();
    }
  });

  it('Tab never offers Rename current when there is no current branch (Add-to-EDT)', () => {
    const state = baseState({ hasCurrentBranch: false, currentBranch: '' });
    const result = handleBranchPickerKey(state, [], [], '', { tab: true });
    expect(result.type).toBe('update');
    if (result.type === 'update') {
      expect(result.state.mode).toBe('pick-existing');
    }
  });
});

describe('handleBranchPickerKey — Shift+Tab', () => {
  it('reverses the mode switch, wrapping Create new -> Pick existing -> Rename current', () => {
    const state = baseState();
    expect(state.mode).toBe('create-new');
    const back = handleBranchPickerKey(state, [], [], '', { tab: true, shift: true });
    expect(back.type === 'update' && back.state.mode).toBe('pick-existing');
    const wrapped = handleBranchPickerKey(back.type === 'update' ? back.state : state, [], [], '', { tab: true, shift: true });
    expect(wrapped.type === 'update' && wrapped.state.mode).toBe('rename-current');
  });

  it('swallows Tab and Shift+Tab while a Pick-existing row-rename sub-view is open', () => {
    const state = baseState({
      mode: 'pick-existing',
      renameSub: { oldName: 'feat', value: 'feat', cursor: 4, error: null },
    });
    for (const key of [{ tab: true }, { tab: true, shift: true }]) {
      const result = handleBranchPickerKey(state, ['feat'], [], '', key);
      expect(result).toEqual({ type: 'update', state });
    }
  });
});

describe('handleBranchPickerKey — Create new', () => {
  it('Enter on the base-branch field advances to the name field without submitting', () => {
    const state = baseState();
    const result = handleBranchPickerKey(state, [], [], '', { return: true });
    expect(result.type).toBe('update');
    if (result.type === 'update') {
      expect(result.state.baseFocused).toBe(false);
    }
  });

  it('the base-branch field is the shared autocomplete: arrows highlight, Enter fills in, a listed branch advances', () => {
    const branches = ['development', 'feat-x', 'feat-y'];
    const typed = handleBranchPickerKey(baseState({ baseBranch: '', baseBranchCursor: 0 }), branches, [], 'f', {});
    expect(typed.type === 'update' && typed.state.baseBranch).toBe('f');
    const moved = handleBranchPickerKey(baseState({ baseBranch: 'feat', baseBranchCursor: 4 }), branches, [], '', { downArrow: true });
    expect(moved.type === 'update' && [moved.state.baseBranch, moved.state.basePickCursor]).toEqual(['feat', 1]);
    const filled = handleBranchPickerKey(baseState({ baseBranch: 'feat', baseBranchCursor: 4, basePickCursor: 1 }), branches, [], '', { return: true });
    expect(filled.type === 'update' && [filled.state.baseBranch, filled.state.baseFocused]).toEqual(['feat-y', true]);
    const advanced = handleBranchPickerKey(baseState({ baseBranch: 'feat-y', baseBranchCursor: 6 }), branches, [], '', { return: true });
    expect(advanced.type === 'update' && advanced.state.baseFocused).toBe(false);
  });

  it('typing edits the currently-focused field only', () => {
    const state = baseState({ baseFocused: true, baseBranch: '' });
    const result = handleBranchPickerKey(state, [], [], 'd', {});
    expect(result.type).toBe('update');
    if (result.type === 'update') {
      expect(result.state.baseBranch).toBe('d');
      expect(result.state.nameValue).toBe('feature-suggested');
    }
  });

  it('Enter on the name field submits a create outcome with the trimmed name and base branch', () => {
    const state = baseState({ baseFocused: false, baseBranch: 'development', nameValue: 'feature-x' });
    const result = handleBranchPickerKey(state, [], [], '', { return: true });
    expect(result).toEqual({ type: 'submit', outcome: { kind: 'create', branchName: 'feature-x', baseBranch: 'development' } });
  });

  it('rejects an empty name inline, never submits', () => {
    const state = baseState({ baseFocused: false, nameValue: '' });
    const result = handleBranchPickerKey(state, [], [], '', { return: true });
    expect(result.type).toBe('update');
    if (result.type === 'update') {
      expect(result.state.error).toBe('Branch name must not be empty');
    }
  });

  it('down-arrow on the name field opens the other-members sub-list; Enter there fills the field without submitting', () => {
    const state = baseState({ baseFocused: false, nameValue: 'feature-x' });
    const opened = handleBranchPickerKey(state, [], ['shared-feature', 'other-feature'], '', { downArrow: true });
    expect(opened.type).toBe('update');
    if (opened.type !== 'update') return;
    expect(opened.state.nameSubListOpen).toBe(true);
    expect(opened.state.nameSubListCursor).toBe(0);

    const picked = handleBranchPickerKey(opened.state, [], ['shared-feature', 'other-feature'], '', { return: true });
    expect(picked.type).toBe('update');
    if (picked.type === 'update') {
      expect(picked.state.nameValue).toBe('shared-feature');
      expect(picked.state.nameSubListOpen).toBe(false);
    }
  });

  it('Escape closes an open sub-list without cancelling the whole picker', () => {
    const state = baseState({ baseFocused: false, nameSubListOpen: true });
    const result = handleBranchPickerKey(state, [], ['a'], '', { escape: true });
    expect(result.type).toBe('update');
    if (result.type === 'update') {
      expect(result.state.nameSubListOpen).toBe(false);
    }
  });
});

describe('handleBranchPickerKey — Pick existing', () => {
  function pickState(overrides: Partial<BranchPickerState> = {}): BranchPickerState {
    return baseState({ mode: 'pick-existing', pickQuery: '', pickCursor: 0, ...overrides });
  }

  it('typing filters the branch list (case-insensitive substring, shared autocomplete)', () => {
    const state = pickState();
    const result = handleBranchPickerKey(state, ['feature-x', 'main'], [], 'f', {});
    expect(result.type).toBe('update');
    if (result.type === 'update') {
      expect(result.state.pickQuery).toBe('f');
      expect(matchBranchesBySubstring(result.state.pickQuery, ['feature-x', 'main'])).toEqual(['feature-x']);
    }
    // Substring (not just prefix): 'eat' still proposes 'feature-x' — pinned at the picker
    // boundary (not just the helper), so a prefix-only regression fails here.
    const sub = handleBranchPickerKey(pickState(), ['feature-x', 'main'], [], 'eat', {});
    expect(sub.type).toBe('update');
    if (sub.type !== 'update') return;
    expect(sub.state.pickQuery).toBe('eat');
    const inserted = handleBranchPickerKey(sub.state, ['feature-x', 'main'], [], '', { return: true });
    expect(inserted.type).toBe('update');
    if (inserted.type !== 'update') return;
    expect(inserted.state.pickQuery).toBe('feature-x');
  });

  it('first Enter inserts the highlighted branch, second Enter submits it — no branch created', () => {
    const state = pickState({ pickCursor: 0 });
    const inserted = handleBranchPickerKey(state, ['feature-x', 'main'], [], '', { return: true });
    expect(inserted.type).toBe('update');
    if (inserted.type !== 'update') return;
    expect(inserted.state.pickQuery).toBe('feature-x');
    expect(inserted.state.pickQueryCursor).toBe('feature-x'.length);
    const submitted = handleBranchPickerKey(inserted.state, ['feature-x', 'main'], [], '', { return: true });
    expect(submitted).toEqual({ type: 'submit', outcome: { kind: 'set', branch: 'feature-x' } });
  });

  it('Enter on an exact filter value submits immediately (insert is a no-op there)', () => {
    const state = pickState({ pickQuery: 'main', pickQueryCursor: 4, pickCursor: 0 });
    const result = handleBranchPickerKey(state, ['feature-x', 'main'], [], '', { return: true });
    expect(result).toEqual({ type: 'submit', outcome: { kind: 'set', branch: 'main' } });
  });

  it('Enter on an exact filter value with a stray highlight elsewhere still submits the exact value (never clobbers it)', () => {
    const state = pickState({ pickQuery: 'main', pickQueryCursor: 4, pickCursor: 1 });
    const result = handleBranchPickerKey(state, ['main', 'main-x'], [], '', { return: true });
    expect(result).toEqual({ type: 'submit', outcome: { kind: 'set', branch: 'main' } });
  });

  it('Enter with zero substring matches keeps the existing `No branch selected` inline error', () => {
    const state = pickState({ pickQuery: 'zzz', pickQueryCursor: 3, pickCursor: 0 });
    const result = handleBranchPickerKey(state, ['feature-x', 'main'], [], '', { return: true });
    expect(result.type).toBe('update');
    if (result.type === 'update') {
      expect(result.state.error).toBe('No branch selected');
    }
  });

  it('Up/Down move the shared highlight without touching the caret; caret moves preserve it', () => {
    const down = handleBranchPickerKey(pickState({ pickQuery: 'f', pickQueryCursor: 1, pickCursor: 0 }), ['feat-x', 'fix-y', 'main'], [], '', {
      downArrow: true,
    });
    expect(down.type).toBe('update');
    if (down.type !== 'update') return;
    expect(down.state.pickCursor).toBe(1);
    expect(down.state.pickQueryCursor).toBe(1);
    const left = handleBranchPickerKey(down.state, ['feat-x', 'fix-y', 'main'], [], '', { leftArrow: true });
    expect(left.type).toBe('update');
    if (left.type !== 'update') return;
    expect(left.state.pickQueryCursor).toBe(0);
    expect(left.state.pickCursor).toBe(1);
  });

  it('Ctrl+T on a row opens its inline rename field, pre-filled with the selected branch', () => {
    const state = pickState({ pickCursor: 1 });
    const result = handleBranchPickerKey(state, ['feature-x', 'shared-feature'], [], 't', { ctrl: true });
    expect(result.type).toBe('update');
    if (result.type === 'update') {
      expect(result.state.renameSub).toEqual({ oldName: 'shared-feature', value: 'shared-feature', cursor: 'shared-feature'.length, error: null });
    }
  });

  it('Ctrl+R no longer opens the rename field (it is back-to-global elsewhere)', () => {
    const result = handleBranchPickerKey(pickState({ pickCursor: 1 }), ['feature-x', 'shared-feature'], [], 'r', { ctrl: true });
    expect(result.type).toBe('update');
    if (result.type === 'update') {
      expect(result.state.renameSub).toBeNull();
    }
  });

  it('confirming the rename field submits a rename outcome in one step', () => {
    const state = pickState({ renameSub: { oldName: 'shared-feature', value: 'shared-feature-v2', cursor: 'shared-feature-v2'.length, error: null } });
    const result = handleBranchPickerKey(state, ['shared-feature'], [], '', { return: true });
    expect(result).toEqual({ type: 'submit', outcome: { kind: 'rename', oldName: 'shared-feature', newName: 'shared-feature-v2' } });
  });

  it('rejects an empty rename value inline', () => {
    const state = pickState({ renameSub: { oldName: 'shared-feature', value: '', cursor: 0, error: null } });
    const result = handleBranchPickerKey(state, ['shared-feature'], [], '', { return: true });
    expect(result.type).toBe('update');
    if (result.type === 'update') {
      expect(result.state.renameSub?.error).toBe('Branch name must not be empty');
    }
  });

  it('Escape from the rename sub-view returns to the list, not a full cancel', () => {
    const state = pickState({ renameSub: { oldName: 'shared-feature', value: 'x', cursor: 1, error: null } });
    const result = handleBranchPickerKey(state, ['shared-feature'], [], '', { escape: true });
    expect(result.type).toBe('update');
    if (result.type === 'update') {
      expect(result.state.renameSub).toBeNull();
    }
  });
});

describe('handleBranchPickerKey — Rename current', () => {
  it('pre-selected onto the current branch, confirming submits a rename outcome', () => {
    const state = baseState({ mode: 'rename-current', renameSub: { oldName: 'main', value: 'feature-renamed', cursor: 'feature-renamed'.length, error: null } });
    const result = handleBranchPickerKey(state, [], [], '', { return: true });
    expect(result).toEqual({ type: 'submit', outcome: { kind: 'rename', oldName: 'main', newName: 'feature-renamed' } });
  });

  it('rejects an emptied value inline, never submits', () => {
    const state = baseState({ mode: 'rename-current', renameSub: { oldName: 'main', value: '', cursor: 0, error: null } });
    const result = handleBranchPickerKey(state, [], [], '', { return: true });
    expect(result.type).toBe('update');
    if (result.type === 'update') {
      expect(result.state.renameSub?.error).toBe('Branch name must not be empty');
    }
  });
});

describe('handleBranchPickerKey — cancel', () => {
  it('Escape from the top level (no sub-view open) cancels the whole picker', () => {
    const state = baseState();
    expect(handleBranchPickerKey(state, [], [], '', { escape: true })).toEqual({ type: 'cancel' });
  });
});

describe('applyBranchPickerRetry', () => {
  it('a "try a different name" retry reopens Create new\'s name field pre-filled with the collided value', () => {
    const state = baseState({ mode: 'pick-existing' });
    const retried = applyBranchPickerRetry(state, { field: 'create-name', value: 'feature-collided' });
    expect(retried.mode).toBe('create-new');
    expect(retried.baseFocused).toBe(false);
    expect(retried.nameValue).toBe('feature-collided');
    // A programmatic overwrite resets the caret to the reopened value's end.
    expect(retried.nameValueCursor).toBe('feature-collided'.length);
  });

  it('a "try a different branch" retry reopens the rename field pre-filled with the collided value', () => {
    const state = baseState({ mode: 'pick-existing' });
    const retried = applyBranchPickerRetry(state, { field: 'rename', value: 'feature-collided', oldName: 'main' });
    expect(retried.mode).toBe('rename-current');
    expect(retried.renameSub).toEqual({ oldName: 'main', value: 'feature-collided', cursor: 'feature-collided'.length, error: null });
  });
});

describe('BranchPicker rendering', () => {
  it('shows the 3-way mode switch defaulting to Create new, with the suggestion pre-filled', async () => {
    const state = createBranchPickerState({
      suggestedName: 'feature-suggested',
      defaultBaseBranch: 'development',
      hasCurrentBranch: true,
      currentBranch: 'main',
    });
    const output = await renderToString(
      <BranchPicker state={state} branches={['development']} branchesStatus="ready" otherMemberBranches={[]} maxRows={5} />,
    );
    expect(output).toContain('[Create new]');
    expect(output).toContain('Pick existing');
    expect(output).toContain('Rename current');
    expect(output).toContain('Base branch: development');
    expect(output).toContain('Name: feature-suggested');
  });

  it('never offers Rename current when there is no current branch (Add-to-EDT)', async () => {
    const state = createBranchPickerState({
      suggestedName: 'feature-suggested',
      defaultBaseBranch: 'development',
      hasCurrentBranch: false,
      currentBranch: '',
    });
    const output = await renderToString(
      <BranchPicker state={state} branches={[]} branchesStatus="ready" otherMemberBranches={[]} maxRows={5} />,
    );
    expect(output).not.toContain('Rename current');
  });

  it('renders the shared substring dropdown with validity in Pick existing mode', async () => {
    const state = baseState({ mode: 'pick-existing', pickQuery: 'feat', pickQueryCursor: 4, pickCursor: 0 });
    const output = await renderToString(
      <BranchPicker state={state} branches={['feature-x', 'main']} branchesStatus="ready" otherMemberBranches={[]} maxRows={5} />,
    );
    expect(output).toContain('feature-x');
    expect(output).not.toContain('main');
    // Shared validity signal (advisory, never color alone).
    expect(output).toContain('✖');
  });

  it('renders ✔ when the pick-existing filter exactly matches a listed branch', async () => {
    const state = baseState({ mode: 'pick-existing', pickQuery: 'main', pickQueryCursor: 4, pickCursor: 0 });
    const output = await renderToString(
      <BranchPicker state={state} branches={['feature-x', 'main']} branchesStatus="ready" otherMemberBranches={[]} maxRows={5} />,
    );
    expect(output).toContain('✔');
    expect(output).not.toContain('✖');
  });

  it('caps the pick-existing dropdown at its line budget with a more-below indicator', async () => {
    const state = baseState({ mode: 'pick-existing', pickQuery: '', pickQueryCursor: 0, pickCursor: 0 });
    const output = await renderToString(
      <BranchPicker state={state} branches={['b-one', 'b-two', 'b-three', 'b-four']} branchesStatus="ready" otherMemberBranches={[]} maxRows={3} />,
    );
    expect(output).toContain('b-one');
    expect(output).not.toContain('b-two');
    expect(output).toContain('↓ 3 more');
  });

  it('keeps the `Failed to load branches.` line with a usable field on branchesStatus=error', async () => {
    const state = baseState({ mode: 'pick-existing', pickQuery: 'f', pickQueryCursor: 1, pickCursor: 0 });
    const output = await renderToString(
      <BranchPicker state={state} branches={[]} branchesStatus="error" otherMemberBranches={[]} maxRows={5} />,
    );
    expect(output).toContain('Failed to load branches.');
    expect(output).toContain('Filter');
  });

  it('create-new mode marks the base branch valid and keeps the name field plain', async () => {
    const state = baseState({ baseFocused: false, nameValue: 'feature-x', nameValueCursor: 9 });
    const output = await renderToString(
      <BranchPicker state={state} branches={['development']} branchesStatus="ready" otherMemberBranches={[]} maxRows={5} />,
    );
    expect(output).toContain('Base branch: development ✔');
    expect(output).toContain('Name: feature-x');
    expect(output).not.toContain('✖');
  });
});

describe('branchPickerFooterContext', () => {
  const sub = { oldName: 'a', value: 'a', cursor: 1, error: null };

  it('follows the mode and the focused field', () => {
    expect(branchPickerFooterContext(baseState({ mode: 'pick-existing' }), false)).toBe('branch-picker-pick');
    expect(branchPickerFooterContext(baseState({ mode: 'pick-existing', renameSub: sub }), false)).toBe('confirm');
    expect(branchPickerFooterContext(baseState({ mode: 'rename-current' }), false)).toBe('branch-picker-rename');
    expect(branchPickerFooterContext(baseState({ baseFocused: true }), false)).toBe('branch-picker-base');
    expect(branchPickerFooterContext(baseState({ baseFocused: false }), false)).toBe('branch-picker-name');
    expect(branchPickerFooterContext(baseState({ baseFocused: false }), true)).toBe('branch-picker-name-members');
    expect(branchPickerFooterContext(baseState({ baseFocused: false, nameSubListOpen: true }), true)).toBe('branch-picker-members');
  });
});

describe('create-new base field edge cases', () => {
  const BRANCHES = ['development', 'feat-x'];

  it('an empty base keeps the default and advances instead of filling in the first branch', () => {
    const result = handleBranchPickerKey(baseState({ baseBranch: '', baseBranchCursor: 0 }), BRANCHES, [], '', { return: true });
    expect(result.type === 'update' && [result.state.baseFocused, result.state.baseBranch]).toEqual([false, '']);
  });

  it('never accepts free text while the branch list is loading or failed', () => {
    for (const status of ['loading', 'error'] as const) {
      const state = baseState({ baseBranch: 'typed-ref', baseBranchCursor: 9 });
      const result = handleBranchPickerKey(state, [], [], '', { return: true }, status);
      expect(result).toEqual({ type: 'update', state });
    }
    const ready = handleBranchPickerKey(baseState({ baseBranch: 'typed-ref', baseBranchCursor: 9 }), BRANCHES, [], '', { return: true }, 'ready');
    expect(ready.type === 'update' && ready.state.baseFocused).toBe(false);
  });

  it('resets the base highlight when the value is edited or the mode changes', () => {
    const edited = handleBranchPickerKey(baseState({ baseBranch: 'fe', baseBranchCursor: 2, basePickCursor: 1 }), BRANCHES, [], 'a', {});
    expect(edited.type === 'update' && edited.state.basePickCursor).toBe(0);
    const switched = handleBranchPickerKey(baseState({ basePickCursor: 1 }), BRANCHES, [], '', { tab: true });
    expect(switched.type === 'update' && switched.state.basePickCursor).toBe(0);
  });

  it('keeps the loading and error line visible when the base field is not focused', async () => {
    for (const [status, text] of [['loading', 'Loading branches…'], ['error', 'Failed to load branches.']] as const) {
      const output = await renderToString(
        <BranchPicker state={baseState({ baseFocused: false })} branches={[]} branchesStatus={status} otherMemberBranches={[]} maxRows={5} />,
      );
      expect(output.split(text)).toHaveLength(2);
    }
  });
});

describe('cross-EDT branch usage', () => {
  const owners = { 'feat/owned': ['alpha'] };

  it('Pick existing refuses setting a branch another EDT owns, inline, no submit', () => {
    const state = baseState({ mode: 'pick-existing', pickQuery: 'feat/owned' });
    const result = handleBranchPickerKey(state, ['feat/owned', 'feat/free'], [], '', { return: true }, 'ready', owners);
    expect(result.type).toBe('update');
    if (result.type === 'update') {
      expect(result.state.error).toContain("utilisée par l'EDT « alpha » — la reprendre ou la renommer casserait cet EDT");
    }
  });

  it('Pick existing still submits an unowned branch (and any branch without owners)', () => {
    const free = baseState({ mode: 'pick-existing', pickQuery: 'feat/free' });
    expect(handleBranchPickerKey(free, ['feat/owned', 'feat/free'], [], '', { return: true }, 'ready', owners)).toEqual({
      type: 'submit',
      outcome: { kind: 'set', branch: 'feat/free' },
    });
    const owned = baseState({ mode: 'pick-existing', pickQuery: 'feat/owned' });
    expect(handleBranchPickerKey(owned, ['feat/owned'], [], '', { return: true }).type).toBe('submit');
  });

  it('Pick existing row-rename of an owned branch is refused in the rename sub-view', () => {
    const state = baseState({
      mode: 'pick-existing',
      renameSub: { oldName: 'feat/owned', value: 'feat/new', cursor: 8, error: null },
    });
    const result = handleBranchPickerKey(state, ['feat/owned'], [], '', { return: true }, 'ready', owners);
    expect(result.type).toBe('update');
    if (result.type === 'update') {
      expect(result.state.renameSub?.error).toContain('« alpha »');
    }
  });

  it('Rename current refuses an owned member branch and an owned new name', () => {
    const owned = baseState({ mode: 'rename-current', renameSub: { oldName: 'feat/owned', value: 'feat/new', cursor: 8, error: null } });
    const a = handleBranchPickerKey(owned, [], [], '', { return: true }, 'ready', owners);
    expect(a.type === 'update' && a.state.renameSub?.error).toContain('« alpha »');
    const taking = baseState({ mode: 'rename-current', renameSub: { oldName: 'main', value: 'feat/owned', cursor: 10, error: null } });
    const b = handleBranchPickerKey(taking, [], [], '', { return: true }, 'ready', owners);
    expect(b.type === 'update' && b.state.renameSub?.error).toContain('« alpha »');
  });

  it('Create new from an owned base is allowed', () => {
    const state = baseState({ mode: 'create-new', baseBranch: 'feat/owned', baseFocused: false, nameValue: 'feat/mine' });
    expect(handleBranchPickerKey(state, ['feat/owned'], [], '', { return: true }, 'ready', owners).type).toBe('submit');
  });

  it('annotates owned candidates in the pick-existing and base-branch lists', async () => {
    const pick = baseState({ mode: 'pick-existing' });
    const out = await renderToString(
      <BranchPicker state={pick} branches={['feat/owned', 'feat/free']} branchesStatus="ready" otherMemberBranches={[]} maxRows={5} owners={owners} />,
    );
    expect(out).toContain('⚠ EDT « alpha »');
    expect(out.match(/⚠/g)).toHaveLength(1);
    const create = baseState({ mode: 'create-new', baseBranch: 'feat', baseFocused: true });
    const out2 = await renderToString(
      <BranchPicker state={create} branches={['feat/owned', 'feat/free']} branchesStatus="ready" otherMemberBranches={[]} maxRows={5} owners={owners} />,
    );
    expect(out2).toContain('⚠ EDT « alpha »');
  });
});

describe('cross-EDT prototype-key safety', () => {
  it('a branch named constructor is not refused when owners has no such own key', () => {
    const state = baseState({ mode: 'pick-existing', pickQuery: 'constructor' });
    expect(handleBranchPickerKey(state, ['constructor'], [], '', { return: true }, 'ready', {}).type).toBe('submit');
  });
});
