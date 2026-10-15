// shared/components/branch-autocomplete-input: pure-reducer-first tests (branch-picker.test.tsx
// precedent) plus render-to-string smoke coverage. The shared renderToString harness's fake
// stdin never emits data, so no component-owned useInput exists to exercise — every keystroke
// behavior is covered as a pure function instead (handleBranchAutocompleteKey), with render
// tests asserting the dropdown cap, the overflow line, and the glyph-paired validity signal.
import { describe, it, expect } from 'vitest';
import { colors } from '../theme/theme.js';
import {
  BranchAutocompleteInput,
  createBranchAutocompleteState,
  handleBranchAutocompleteKey,
  isBranchAutocompleteExactMatch,
  matchBranchesBySubstring,
  resolveBranchAutocompleteDropdown,
  resolveBranchAutocompleteValidity,
  type BranchAutocompleteState,
} from './branch-autocomplete-input.js';
import { renderToString } from './render-to-string.js';

const BRANCHES = ['development', 'feat-x', 'fix-y'];

function stateWith(overrides: Partial<BranchAutocompleteState> = {}): BranchAutocompleteState {
  return { ...createBranchAutocompleteState({ value: 'f' }), ...overrides };
}

describe('matchBranchesBySubstring', () => {
  it('filters case-insensitively by substring (I/O matrix "Filter as you type")', () => {
    expect(matchBranchesBySubstring('f', BRANCHES)).toEqual(['feat-x', 'fix-y']);
    expect(matchBranchesBySubstring('F', BRANCHES)).toEqual(['feat-x', 'fix-y']);
    expect(matchBranchesBySubstring('eat', BRANCHES)).toEqual(['feat-x']);
  });

  it('an empty query matches every branch', () => {
    expect(matchBranchesBySubstring('', BRANCHES)).toEqual(BRANCHES);
  });

  it('matches nothing when no branch contains the query', () => {
    expect(matchBranchesBySubstring('zzz', BRANCHES)).toEqual([]);
  });

  it('trims a stray leading/trailing space so proposals survive it like validity does', () => {
    expect(matchBranchesBySubstring('feat ', BRANCHES)).toEqual(['feat-x']);
    expect(matchBranchesBySubstring('  fix', BRANCHES)).toEqual(['fix-y']);
  });
});

describe('createBranchAutocompleteState', () => {
  it('defaults to an empty value with both cursors at zero', () => {
    expect(createBranchAutocompleteState()).toEqual({ value: '', cursor: 0, pickCursor: 0 });
  });

  it('seeds the caret at the seeded value\'s end', () => {
    expect(createBranchAutocompleteState({ value: 'feat' })).toEqual({ value: 'feat', cursor: 4, pickCursor: 0 });
  });

  it('clamps an explicit cursor into [0, value.length]', () => {
    expect(createBranchAutocompleteState({ value: 'ab', cursor: 99 }).cursor).toBe(2);
    expect(createBranchAutocompleteState({ value: 'ab', cursor: -1 }).cursor).toBe(0);
  });
});

describe('isBranchAutocompleteExactMatch / resolveBranchAutocompleteValidity', () => {
  it('matches the trimmed text case-sensitively', () => {
    expect(isBranchAutocompleteExactMatch('feat-x', BRANCHES)).toBe(true);
    expect(isBranchAutocompleteExactMatch('  feat-x  ', BRANCHES)).toBe(true);
    expect(isBranchAutocompleteExactMatch('FEAT-X', BRANCHES)).toBe(false);
    expect(isBranchAutocompleteExactMatch('feat', BRANCHES)).toBe(false);
    expect(isBranchAutocompleteExactMatch('', BRANCHES)).toBe(false);
  });

  it('pairs ✔ with success on an exact match, ✖ with error otherwise (never color alone)', () => {
    expect(resolveBranchAutocompleteValidity('feat-x', BRANCHES)).toEqual({
      exact: true,
      glyph: '✔',
      glyphColor: colors.success,
    });
    expect(resolveBranchAutocompleteValidity('feat', BRANCHES)).toEqual({
      exact: false,
      glyph: '✖',
      glyphColor: colors.error,
    });
  });
});

describe('resolveBranchAutocompleteDropdown', () => {
  it('caps the visible slice at maxRows with the overflow count for the … N more line', () => {
    expect(resolveBranchAutocompleteDropdown(['a', 'b', 'c'], 2)).toEqual({ visible: ['a', 'b'], overflow: 1 });
  });

  it('reports zero overflow when everything fits', () => {
    expect(resolveBranchAutocompleteDropdown(['a', 'b'], 5)).toEqual({ visible: ['a', 'b'], overflow: 0 });
  });

  it('never goes negative on a non-positive maxRows', () => {
    expect(resolveBranchAutocompleteDropdown(['a'], 0)).toEqual({ visible: [], overflow: 1 });
  });
});

describe('handleBranchAutocompleteKey — text caret (I/O matrix "Text caret")', () => {
  it('typing inserts at the caret via nextTextInputValue and resets pickCursor to 0', () => {
    const result = handleBranchAutocompleteKey(
      { value: 'fet-x', cursor: 2, pickCursor: 1 },
      ['feat-x', 'fix-y'],
      'a',
      {},
    );
    expect(result).toEqual({ type: 'update', state: { value: 'feat-x', cursor: 3, pickCursor: 0 } });
  });

  it('Left/Right/Home/End move the caret and preserve the highlight', () => {
    // 'f' matches both feat-x and fix-y, so pickCursor 1 is a valid highlight to preserve.
    const left = handleBranchAutocompleteKey(stateWith({ value: 'f', cursor: 1, pickCursor: 1 }), BRANCHES, '', {
      leftArrow: true,
    });
    expect(left).toEqual({ type: 'update', state: { value: 'f', cursor: 0, pickCursor: 1 } });
    const home = handleBranchAutocompleteKey(stateWith({ value: 'f', cursor: 1, pickCursor: 1 }), BRANCHES, '', {
      home: true,
    });
    expect(home).toEqual({ type: 'update', state: { value: 'f', cursor: 0, pickCursor: 1 } });
  });

  it('Backspace/Delete edit at the caret and reset pickCursor', () => {
    const backspace = handleBranchAutocompleteKey(
      { value: 'feat', cursor: 4, pickCursor: 1 },
      BRANCHES,
      '',
      { backspace: true },
    );
    expect(backspace).toEqual({ type: 'update', state: { value: 'fea', cursor: 3, pickCursor: 0 } });
  });

  it('Ctrl/Meta combos stay inert', () => {
    const before = stateWith({ value: 'feat', cursor: 2, pickCursor: 1 });
    expect(handleBranchAutocompleteKey(before, BRANCHES, 'c', { ctrl: true })).toEqual({ type: 'update', state: before });
    expect(handleBranchAutocompleteKey(before, BRANCHES, '', { leftArrow: true, meta: true })).toEqual({
      type: 'update',
      state: before,
    });
  });
});

describe('handleBranchAutocompleteKey — navigate + insert (I/O matrix "Navigate + insert")', () => {
  it('Down/Up move pickCursor clamped to the match list, never touching the caret', () => {
    const down = handleBranchAutocompleteKey(stateWith({ value: 'f', cursor: 1, pickCursor: 0 }), BRANCHES, '', {
      downArrow: true,
    });
    expect(down).toEqual({ type: 'update', state: { value: 'f', cursor: 1, pickCursor: 1 } });
    const clamped = handleBranchAutocompleteKey(stateWith({ value: 'f', cursor: 1, pickCursor: 1 }), BRANCHES, '', {
      downArrow: true,
    });
    expect(clamped).toEqual({ type: 'update', state: { value: 'f', cursor: 1, pickCursor: 1 } });
    const up = handleBranchAutocompleteKey(stateWith({ value: 'f', cursor: 1, pickCursor: 1 }), BRANCHES, '', {
      upArrow: true,
    });
    expect(up).toEqual({ type: 'update', state: { value: 'f', cursor: 1, pickCursor: 0 } });
  });

  it('Up/Down on an empty match list stays an update with pickCursor 0', () => {
    const result = handleBranchAutocompleteKey(stateWith({ value: 'zzz', cursor: 3, pickCursor: 0 }), BRANCHES, '', {
      downArrow: true,
    });
    expect(result).toEqual({ type: 'update', state: { value: 'zzz', cursor: 3, pickCursor: 0 } });
  });

  it('Enter on a non-empty list emits insert with the highlighted branch and keeps editing', () => {
    const result = handleBranchAutocompleteKey(stateWith({ value: 'f', cursor: 1, pickCursor: 1 }), BRANCHES, '', {
      return: true,
    });
    expect(result).toEqual({
      type: 'insert',
      state: { value: 'fix-y', cursor: 5, pickCursor: 0 },
      branch: 'fix-y',
    });
  });

  it('Enter with zero matches emits commit-through to the parent', () => {
    expect(
      handleBranchAutocompleteKey(stateWith({ value: 'zzz', cursor: 3, pickCursor: 0 }), BRANCHES, '', { return: true }),
    ).toEqual({ type: 'commit-through' });
  });
});

describe('BranchAutocompleteInput render', () => {
  it('lists at most maxRows substring matches with a … N more overflow line', async () => {
    const output = await renderToString(
      <BranchAutocompleteInput
        label="Branch"
        state={{ value: '', cursor: 0, pickCursor: 0 }}
        branches={['b-one', 'b-two', 'b-three']}
        branchesStatus="ready"
        maxRows={2}
      />,
    );
    expect(output).toContain('b-one');
    expect(output).toContain('b-two');
    expect(output).not.toContain('b-three');
    expect(output).toContain('… 1 more');
  });

  it('renders zero dropdown rows for zero matches while the text stays editable', async () => {
    const output = await renderToString(
      <BranchAutocompleteInput
        label="Branch"
        state={{ value: 'zzz', cursor: 3, pickCursor: 0 }}
        branches={BRANCHES}
        branchesStatus="ready"
        maxRows={5}
      />,
    );
    expect(output).toContain('zzz');
    expect(output).not.toContain('feat-x');
    expect(output).not.toContain('more');
  });

  it('shows ✔ for an exact match and ✖ for no match when unfocused', async () => {
    const exact = await renderToString(
      <BranchAutocompleteInput
        label="Branch"
        state={{ value: 'feat-x', cursor: 6, pickCursor: 0 }}
        branches={BRANCHES}
        branchesStatus="ready"
        maxRows={5}
      />,
    );
    expect(exact).toContain('✔');
    expect(exact).not.toContain('✖');
    const missing = await renderToString(
      <BranchAutocompleteInput
        label="Branch"
        state={{ value: 'feat', cursor: 4, pickCursor: 0 }}
        branches={BRANCHES}
        branchesStatus="ready"
        maxRows={5}
      />,
    );
    expect(missing).toContain('✖');
    expect(missing).not.toContain('✔');
  });

  it('keeps the accent treatment with the same glyph appended when focused', async () => {
    const output = await renderToString(
      <BranchAutocompleteInput
        label="Branch"
        state={{ value: 'feat-x', cursor: 6, pickCursor: 0 }}
        branches={BRANCHES}
        branchesStatus="ready"
        maxRows={5}
        focused
      />,
    );
    expect(output).toContain('Branch');
    expect(output).toContain('✔');
  });

  it('renders a loading line with no dropdown and no validity coloring while loading', async () => {
    const output = await renderToString(
      <BranchAutocompleteInput
        label="Branch"
        state={{ value: 'feat-x', cursor: 6, pickCursor: 0 }}
        branches={BRANCHES}
        branchesStatus="loading"
        maxRows={5}
      />,
    );
    expect(output).toContain('Loading branches…');
    expect(output).not.toContain('✔');
    expect(output).not.toContain('✖');
  });

  it('renders an error line with no dropdown and no validity coloring on error', async () => {
    const output = await renderToString(
      <BranchAutocompleteInput
        label="Branch"
        state={{ value: 'feat', cursor: 4, pickCursor: 0 }}
        branches={BRANCHES}
        branchesStatus="error"
        maxRows={5}
      />,
    );
    expect(output).toContain('Failed to load branches.');
    expect(output).not.toContain('✔');
    expect(output).not.toContain('✖');
  });

  it('renders an annotation suffix with a warning glyph only for annotated branches (story 2.43)', async () => {
    const output = await renderToString(
      <BranchAutocompleteInput
        label="Branch"
        state={{ value: 'f', cursor: 1, pickCursor: 0 }}
        branches={BRANCHES}
        branchesStatus="ready"
        maxRows={5}
        annotations={{ 'feat-x': 'EDT « alpha »' }}
      />,
    );
    expect(output).toContain('feat-x  ⚠ EDT « alpha »');
    expect(output).not.toContain('fix-y  ⚠');
  });
});
