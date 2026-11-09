// shared/components/branch-autocomplete-input: pure-reducer tests (handleBranchAutocompleteKey
// covers every keystroke, since renderToString's fake stdin never emits keys) plus render
// smoke coverage of the dropdown cap, the overflow line, and the glyph-paired validity signal.
import { describe, it, expect } from 'vitest';
import { colors } from '../theme/theme.js';
import {
  BranchAutocompleteInput,
  createBranchAutocompleteState,
  handleBranchAutocompleteKey,
  isBranchAutocompleteExactMatch,
  matchBranchesBySubstring,
  resolveSuggestWindow,
  resolveBranchAutocompleteValidity,
  type BranchAutocompleteState,
} from './branch-autocomplete-input.js';
import { renderToString } from './render-to-string.js';

const BRANCHES = ['development', 'feat-x', 'fix-y'];

function stateWith(overrides: Partial<BranchAutocompleteState> = {}): BranchAutocompleteState {
  return { ...createBranchAutocompleteState({ value: 'f' }), ...overrides };
}

describe('matchBranchesBySubstring', () => {
  it('filters case-insensitively by substring', () => {
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

describe('resolveSuggestWindow', () => {
  it('follows the highlight inside the line budget, indicators included', () => {
    const many = Array.from({ length: 20 }, (_, index) => `b-${index}`);
    for (const cursor of [0, 7, 19]) {
      const window = resolveSuggestWindow(many, cursor, true, 6);
      expect(window.items.length + (window.hiddenAbove > 0 ? 1 : 0) + (window.hiddenBelow > 0 ? 1 : 0)).toBeLessThanOrEqual(6);
      expect(window.items[window.highlight]).toBe(`b-${cursor}`);
    }
  });

  it('shows everything that fits, with no indicator', () => {
    expect(resolveSuggestWindow(['a', 'b'], 0, true, 5)).toMatchObject({ items: ['a', 'b'], hiddenBelow: 0 });
  });

  it('renders nothing on a zero budget and highlights nothing on request', () => {
    expect(resolveSuggestWindow(['a'], 0, true, 0).items).toEqual([]);
    expect(resolveSuggestWindow(['a', 'b'], 0, false, 5).highlight).toBe(-1);
  });
});

describe('handleBranchAutocompleteKey — text caret', () => {
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

describe('handleBranchAutocompleteKey — navigate + insert', () => {
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
  it('lists the matches within the line budget with a ↓ N more indicator', async () => {
    const output = await renderToString(
      <BranchAutocompleteInput
        label="Branch"
        state={{ value: '', cursor: 0, pickCursor: 0 }}
        branches={['b-one', 'b-two', 'b-three', 'b-four', 'b-five']}
        branchesStatus="ready"
        maxLines={4}
      />,
    );
    expect(output).toContain('b-one');
    expect(output).toContain('b-two');
    expect(output).not.toContain('b-three');
    expect(output).toContain('↓ 3 more');
  });

  it('stays within its line budget', async () => {
    const many = Array.from({ length: 30 }, (_, index) => `branch-${index}`);
    const output = await renderToString(
      <BranchAutocompleteInput label="Branch" state={createBranchAutocompleteState()} branches={many} branchesStatus="ready" maxLines={5} />,
    );
    expect(output.split('\n').filter((line) => line.trim() !== '').length).toBeLessThanOrEqual(6);
  });

  it('shows the placeholder while empty, hides the empty validity mark, and drops it once text is typed', async () => {
    const empty = await renderToString(
      <BranchAutocompleteInput label="Source branch" state={createBranchAutocompleteState()} branches={BRANCHES} branchesStatus="ready" maxLines={4} placeholder="<shared-branch>" />,
    );
    expect(empty).toContain('<shared-branch>');
    expect(empty).toContain('development');
    expect(empty).not.toContain('✖');
    const typed = await renderToString(
      <BranchAutocompleteInput label="Source branch" state={createBranchAutocompleteState({ value: 'fix' })} branches={BRANCHES} branchesStatus="ready" maxLines={4} placeholder="<shared-branch>" />,
    );
    expect(typed).not.toContain('<shared-branch>');
    expect(typed).toContain('fix-y');
    expect(typed).not.toContain('development');
  });

  it('shows the placeholder, with no list or caret, when the field is not being edited', async () => {
    const idle = await renderToString(
      <BranchAutocompleteInput label="Source branch" state={createBranchAutocompleteState()} branches={BRANCHES} branchesStatus="ready" maxLines={4} placeholder="<shared-branch>" editing={false} />,
    );
    expect(idle).toContain('<shared-branch>');
    expect(idle).not.toContain('development');
  });

  it('names what failed to load and offers a retry only where the host binds one', async () => {
    const withRetry = await renderToString(
      <BranchAutocompleteInput label="" subject="EDT topics" state={createBranchAutocompleteState()} branches={[]} branchesStatus="error" maxLines={4} retry />,
    );
    expect(withRetry).toContain('Failed to load EDT topics. [R] retry');
  });

  it('renders zero dropdown rows for zero matches while the text stays editable', async () => {
    const output = await renderToString(
      <BranchAutocompleteInput
        label="Branch"
        state={{ value: 'zzz', cursor: 3, pickCursor: 0 }}
        branches={BRANCHES}
        branchesStatus="ready"
        maxLines={5}
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
        maxLines={5}
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
        maxLines={5}
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
        maxLines={5}
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
        maxLines={5}
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
        maxLines={5}
      />,
    );
    expect(output).toContain('Failed to load branches.');
    expect(output).not.toContain('✔');
    expect(output).not.toContain('✖');
  });

  it('renders an annotation suffix with a warning glyph only for annotated branches', async () => {
    const output = await renderToString(
      <BranchAutocompleteInput
        label="Branch"
        state={{ value: 'f', cursor: 1, pickCursor: 0 }}
        branches={BRANCHES}
        branchesStatus="ready"
        maxLines={5}
        annotations={{ 'feat-x': 'EDT « alpha »' }}
      />,
    );
    expect(output).toContain('feat-x  ⚠ EDT « alpha »');
    expect(output).not.toContain('fix-y  ⚠');
  });
});

describe('BranchAutocompleteInput annotations — prototype keys', () => {
  it('a branch named toString/constructor is never read as an inherited annotation', async () => {
    const output = await renderToString(
      <BranchAutocompleteInput
        label="Branch"
        state={{ value: '', cursor: 0, pickCursor: 0 }}
        branches={['toString', 'constructor']}
        branchesStatus="ready"
        maxLines={5}
        annotations={{}}
      />,
    );
    expect(output).not.toContain('⚠');
  });
});

describe('resolveSuggestWindow with a non-finite budget', () => {
  it('shows everything for an unbounded budget and nothing for NaN', () => {
    expect(resolveSuggestWindow(['a', 'b', 'c'], 0, true, Infinity).items).toEqual(['a', 'b', 'c']);
    expect(resolveSuggestWindow(['a', 'b'], 0, true, Number.NaN).items).toEqual([]);
  });
});
