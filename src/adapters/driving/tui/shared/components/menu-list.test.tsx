import { describe, expect, it } from 'vitest';
import { MenuList, resolveMenuKey, type MenuItem } from './menu-list.js';
import { renderToString } from './render-to-string.js';

type Value = 'a' | 'b' | 'c' | 'cancel';
const ITEMS: readonly MenuItem<Value>[] = [
  { value: 'a', label: 'First' },
  { value: 'b', label: 'Second', disabled: true, note: 'not yet' },
  { value: 'c', label: 'Third' },
];

describe('resolveMenuKey', () => {
  it('moves clamped with the arrows and jumps with Home/End', () => {
    expect(resolveMenuKey({ downArrow: true }, 0, ITEMS, 'cancel')).toEqual({ type: 'move', cursor: 1 });
    expect(resolveMenuKey({ downArrow: true }, 2, ITEMS, 'cancel')).toEqual({ type: 'move', cursor: 2 });
    expect(resolveMenuKey({ upArrow: true }, 0, ITEMS, 'cancel')).toEqual({ type: 'move', cursor: 0 });
    expect(resolveMenuKey({ home: true }, 2, ITEMS, 'cancel')).toEqual({ type: 'move', cursor: 0 });
    expect(resolveMenuKey({ end: true }, 0, ITEMS, 'cancel')).toEqual({ type: 'move', cursor: 2 });
  });

  it('Enter chooses the highlighted row, never a disabled or missing one', () => {
    expect(resolveMenuKey({ return: true }, 0, ITEMS, 'cancel')).toEqual({ type: 'choose', choice: 'a' });
    expect(resolveMenuKey({ return: true }, 1, ITEMS, 'cancel')).toEqual({ type: 'ignore' });
    expect(resolveMenuKey({ return: true }, 9, ITEMS, 'cancel')).toEqual({ type: 'ignore' });
  });

  it('Esc answers the escape choice, other keys are ignored', () => {
    expect(resolveMenuKey({ escape: true }, 2, ITEMS, 'cancel')).toEqual({ type: 'choose', choice: 'cancel' });
    expect(resolveMenuKey({}, 0, ITEMS, 'cancel')).toEqual({ type: 'ignore' });
  });

  it('moves nowhere on an empty menu', () => {
    expect(resolveMenuKey({ downArrow: true }, 0, [], 'cancel')).toEqual({ type: 'move', cursor: 0 });
  });
});

describe('MenuList', () => {
  it('renders every row with its note and a marker on the cursor row only', async () => {
    const output = await renderToString(<MenuList items={ITEMS} cursor={2} />);
    expect(output).toContain('First');
    expect(output).toContain('Second');
    expect(output).toContain('not yet');
    expect(output.split('\n').filter((line) => line.includes('›')).join('')).toContain('Third');
  });
});
