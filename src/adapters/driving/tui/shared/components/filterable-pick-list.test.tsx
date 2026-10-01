// shared/components/filterable-pick-list: pure-reducer tests (handleFilterablePickListKey
// covers every keystroke, since renderToString's fake stdin never emits keys) plus render
// coverage of the row style, the scrolling indicators and the two distinct empty lines.
import { describe, it, expect } from 'vitest';
import {
  FILTERABLE_PICK_LIST_MAX_ROWS,
  FilterablePickList,
  clampPickListCursor,
  createFilterablePickListState,
  handleFilterablePickListKey,
  matchPickItemsBySubstring,
  type FilterablePickItem,
  type FilterablePickListState,
} from './filterable-pick-list.js';
import { renderToString } from './render-to-string.js';

function item(label: string, meta?: string): FilterablePickItem<string> {
  return { key: meta ?? label, label, meta, value: label };
}

const ITEMS = [item('alpha-api'), item('beta-api'), item('gateway', '/repos/edge/gateway')];

function stateWith(overrides: Partial<FilterablePickListState> = {}): FilterablePickListState {
  return { ...createFilterablePickListState(), ...overrides };
}

function labels(items: readonly FilterablePickItem<string>[]): string[] {
  return items.map((entry) => entry.label);
}

describe('createFilterablePickListState', () => {
  it('starts unfiltered on the first row', () => {
    expect(createFilterablePickListState()).toEqual({ query: '', queryCursor: 0, cursor: 0 });
  });
});

describe('matchPickItemsBySubstring (matrix: "Filter as you type", "Secondary text match")', () => {
  it('matches by substring, not prefix, case-insensitively', () => {
    expect(labels(matchPickItemsBySubstring('api', ITEMS))).toEqual(['alpha-api', 'beta-api']);
    expect(labels(matchPickItemsBySubstring('API', ITEMS))).toEqual(['alpha-api', 'beta-api']);
  });

  it('matches on the secondary text too, so items sharing a label stay narrowable', () => {
    expect(labels(matchPickItemsBySubstring('edge', ITEMS))).toEqual(['gateway']);
  });

  it('an empty query matches every item', () => {
    expect(matchPickItemsBySubstring('', ITEMS)).toEqual(ITEMS);
  });

  it('trims a stray leading/trailing space', () => {
    expect(labels(matchPickItemsBySubstring(' beta ', ITEMS))).toEqual(['beta-api']);
  });

  it('matches nothing when no item contains the query', () => {
    expect(matchPickItemsBySubstring('zzz', ITEMS)).toEqual([]);
  });
});

describe('clampPickListCursor', () => {
  it('clamps into [0, length - 1] and pins an empty list to 0', () => {
    expect(clampPickListCursor(-1, 3)).toBe(0);
    expect(clampPickListCursor(9, 3)).toBe(2);
    expect(clampPickListCursor(4, 0)).toBe(0);
  });
});

describe('handleFilterablePickListKey — filter as you type (matrix: "Filter as you type")', () => {
  it('typing narrows the list and resets the highlight to the first row', () => {
    const result = handleFilterablePickListKey(stateWith({ cursor: 2 }), ITEMS, 'a', {});
    expect(result).toEqual({ type: 'update', state: { query: 'a', queryCursor: 1, cursor: 0 } });
  });

  it('Enter on a filter matching nothing is a no-op', () => {
    const state = stateWith({ query: 'zzz', queryCursor: 3 });
    expect(handleFilterablePickListKey(state, ITEMS, '', { return: true })).toEqual({ type: 'update', state });
  });
});

describe('handleFilterablePickListKey — navigate (matrix: "Navigate")', () => {
  it('Down/Up move the highlight, clamped at both ends', () => {
    const down = handleFilterablePickListKey(stateWith(), ITEMS, '', { downArrow: true });
    expect(down).toEqual({ type: 'update', state: stateWith({ cursor: 1 }) });

    const atEnd = handleFilterablePickListKey(stateWith({ cursor: 2 }), ITEMS, '', { downArrow: true });
    expect(atEnd).toEqual({ type: 'update', state: stateWith({ cursor: 2 }) });

    const atStart = handleFilterablePickListKey(stateWith(), ITEMS, '', { upArrow: true });
    expect(atStart).toEqual({ type: 'update', state: stateWith({ cursor: 0 }) });
  });

  it('clamps against the filtered list, not the whole pool', () => {
    const state = stateWith({ query: 'api', queryCursor: 3, cursor: 1 });
    const result = handleFilterablePickListKey(state, ITEMS, '', { downArrow: true });
    expect(result).toEqual({ type: 'update', state });
  });

  it('keeps the highlight at 0 on an empty list', () => {
    const result = handleFilterablePickListKey(stateWith({ cursor: 3 }), [], '', { downArrow: true });
    expect(result).toEqual({ type: 'update', state: stateWith({ cursor: 0 }) });
  });

  it('steps from the last row when the highlight was left beyond a shrunken list', () => {
    const result = handleFilterablePickListKey(stateWith({ cursor: 9 }), ITEMS, '', { upArrow: true });
    expect(result).toEqual({ type: 'update', state: stateWith({ cursor: 1 }) });
  });

  it('Up/Down never move the caret', () => {
    const state = stateWith({ query: 'api', queryCursor: 1 });
    const result = handleFilterablePickListKey(state, ITEMS, '', { downArrow: true });
    expect(result).toMatchObject({ type: 'update', state: { query: 'api', queryCursor: 1 } });
  });
});

describe('handleFilterablePickListKey — caret editing (matrix: "Caret editing")', () => {
  const state = stateWith({ query: 'api', queryCursor: 3, cursor: 1 });

  it('Left/Right/Home/End move the caret inside the filter text and keep the highlight', () => {
    expect(handleFilterablePickListKey(state, ITEMS, '', { leftArrow: true })).toEqual({
      type: 'update',
      state: { query: 'api', queryCursor: 2, cursor: 1 },
    });
    expect(handleFilterablePickListKey(state, ITEMS, '', { home: true })).toEqual({
      type: 'update',
      state: { query: 'api', queryCursor: 0, cursor: 1 },
    });
    const atStart = { ...state, queryCursor: 0 };
    expect(handleFilterablePickListKey(atStart, ITEMS, '', { rightArrow: true })).toEqual({
      type: 'update',
      state: { query: 'api', queryCursor: 1, cursor: 1 },
    });
    expect(handleFilterablePickListKey(atStart, ITEMS, '', { end: true })).toEqual({
      type: 'update',
      state: { query: 'api', queryCursor: 3, cursor: 1 },
    });
  });

  it('typing inserts at the caret, not at the end, and resets the highlight', () => {
    const midText = { ...state, queryCursor: 1 };
    expect(handleFilterablePickListKey(midText, ITEMS, '-', {})).toEqual({
      type: 'update',
      state: { query: 'a-pi', queryCursor: 2, cursor: 0 },
    });
  });

  it('Backspace/Delete edit at the caret and reset the highlight', () => {
    const midText = { ...state, queryCursor: 1 };
    expect(handleFilterablePickListKey(midText, ITEMS, '', { backspace: true })).toEqual({
      type: 'update',
      state: { query: 'pi', queryCursor: 0, cursor: 0 },
    });
    expect(handleFilterablePickListKey(midText, ITEMS, '', { delete: true })).toEqual({
      type: 'update',
      state: { query: 'ai', queryCursor: 1, cursor: 0 },
    });
  });

  it('an edit that leaves the matched text unchanged (a stray space) keeps the highlight', () => {
    const atEnd = { ...state, queryCursor: 3 };
    expect(handleFilterablePickListKey(atEnd, ITEMS, ' ', {})).toEqual({
      type: 'update',
      state: { query: 'api ', queryCursor: 4, cursor: 1 },
    });
  });

  it('returns only its own three fields, even when the host hands in a wider state object', () => {
    const wider = { kind: 'quick-pick', mode: 'switch', ...state };
    for (const key of [{ downArrow: true }, { leftArrow: true }, { ctrl: true }, {}]) {
      const result = handleFilterablePickListKey(wider, ITEMS, key.ctrl ? 'w' : '', key);
      expect(result.type).toBe('update');
      if (result.type === 'update') {
        expect(Object.keys(result.state).sort()).toEqual(['cursor', 'query', 'queryCursor']);
      }
    }
    const noMatch = handleFilterablePickListKey({ ...wider, query: 'zzz' }, ITEMS, '', { return: true });
    expect(noMatch).toEqual({ type: 'update', state: { query: 'zzz', queryCursor: 3, cursor: 1 } });
  });

  it('Ctrl/Meta combos stay inert', () => {
    expect(handleFilterablePickListKey(state, ITEMS, 'w', { ctrl: true })).toEqual({ type: 'update', state });
    expect(handleFilterablePickListKey(state, ITEMS, 'x', { meta: true })).toEqual({ type: 'update', state });
    expect(handleFilterablePickListKey(state, ITEMS, '', { ctrl: true, downArrow: true })).toEqual({ type: 'update', state });
    expect(handleFilterablePickListKey(state, ITEMS, '', { ctrl: true, return: true })).toEqual({ type: 'update', state });
  });
});

describe('handleFilterablePickListKey — select and cancel (matrix: "Select", "Cancel")', () => {
  it('Enter hands the highlighted item of the filtered list back to the host', () => {
    const state = stateWith({ query: 'api', queryCursor: 3, cursor: 1 });
    expect(handleFilterablePickListKey(state, ITEMS, '', { return: true })).toEqual({ type: 'select', item: ITEMS[1] });
  });

  it('Enter clamps a highlight left beyond the list by a shrunken pool', () => {
    const state = stateWith({ cursor: 9 });
    expect(handleFilterablePickListKey(state, ITEMS, '', { return: true })).toEqual({ type: 'select', item: ITEMS[2] });
  });

  it('Esc cancels, whatever the filter or modifier state', () => {
    expect(handleFilterablePickListKey(stateWith(), ITEMS, '', { escape: true })).toEqual({ type: 'cancel' });
    expect(handleFilterablePickListKey(stateWith({ query: 'zzz' }), ITEMS, '', { escape: true })).toEqual({ type: 'cancel' });
    expect(handleFilterablePickListKey(stateWith(), ITEMS, '', { escape: true, meta: true })).toEqual({ type: 'cancel' });
  });
});

describe('handleFilterablePickListKey — genuinely empty pool (matrix: "Genuinely empty pool")', () => {
  it('Enter is a no-op and Esc still closes', () => {
    const state = stateWith();
    expect(handleFilterablePickListKey(state, [], '', { return: true })).toEqual({ type: 'update', state });
    expect(handleFilterablePickListKey(state, [], '', { escape: true })).toEqual({ type: 'cancel' });
  });
});

describe('FilterablePickList render', () => {
  const copy = { label: 'Filter', emptyText: 'Nothing to select', noMatchText: 'No match' };

  it('renders the filter field, its hint line, and one row per match with the secondary text', async () => {
    const output = await renderToString(<FilterablePickList {...copy} state={stateWith()} items={ITEMS} />);
    expect(output).toContain('Filter:');
    expect(output).toContain('[Enter] confirm  [Esc] cancel');
    expect(output).toContain('alpha-api');
    expect(output).toContain('beta-api');
    expect(output).toContain('gateway');
    expect(output).toContain('/repos/edge/gateway');
    expect(output).not.toContain('No match');
    expect(output).not.toContain('Nothing to select');
  });

  it('marks the highlighted row with the selection glyphs, never color alone', async () => {
    const output = await renderToString(<FilterablePickList {...copy} state={stateWith({ cursor: 1 })} items={ITEMS} />);
    const highlighted = output.split('\n').filter((line) => line.includes('▌›'));
    expect(highlighted).toHaveLength(1);
    expect(highlighted[0]).toContain('beta-api');
  });

  it('shows the no-match line when the filter matches nothing in a non-empty pool', async () => {
    const output = await renderToString(
      <FilterablePickList {...copy} state={stateWith({ query: 'zzz', queryCursor: 3 })} items={ITEMS} />,
    );
    expect(output).toContain('No match');
    expect(output).not.toContain('Nothing to select');
  });

  it('shows a distinct line when the pool itself is empty (matrix: "Genuinely empty pool")', async () => {
    const output = await renderToString(<FilterablePickList {...copy} state={stateWith()} items={[]} />);
    expect(output).toContain('Nothing to select');
    expect(output).not.toContain('No match');
  });

  it('bounds a long list with scrolling indicators and keeps the highlight visible (matrix: "Long list")', async () => {
    const many = Array.from({ length: 20 }, (_, index) => item(`svc-${String(index).padStart(2, '0')}`));

    const top = await renderToString(<FilterablePickList {...copy} state={stateWith()} items={many} />);
    expect(top).toContain('svc-00');
    expect(top).toContain('▼ more below');
    expect(top).not.toContain('▲ more above');
    expect(top).not.toContain('svc-19');

    const middle = await renderToString(<FilterablePickList {...copy} state={stateWith({ cursor: 10 })} items={many} />);
    expect(middle).toContain('▲ more above');
    expect(middle).toContain('▼ more below');
    expect(middle.split('\n').find((line) => line.includes('▌›'))).toContain('svc-10');
    // The whole budget is used, indicators included — never more, never a collapsed window.
    const rows = middle.split('\n').filter((line) => line.includes('svc-') || line.includes('more above') || line.includes('more below'));
    expect(rows).toHaveLength(FILTERABLE_PICK_LIST_MAX_ROWS);

    const bottom = await renderToString(<FilterablePickList {...copy} state={stateWith({ cursor: 19 })} items={many} />);
    expect(bottom).toContain('svc-19');
    expect(bottom).toContain('▲ more above');
    expect(bottom).not.toContain('▼ more below');
  });
});
