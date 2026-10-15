import { describe, expect, it } from 'vitest';
import { nextCursorForKey } from './list-cursor.js';

const none = { upArrow: false, downArrow: false, home: false, end: false };

describe('nextCursorForKey', () => {
  it('clamps Up/Down at the ends', () => {
    expect(nextCursorForKey({ ...none, upArrow: true }, 0, 3)).toBe(0);
    expect(nextCursorForKey({ ...none, downArrow: true }, 2, 3)).toBe(2);
    expect(nextCursorForKey({ ...none, downArrow: true }, 0, 3)).toBe(1);
  });

  it('jumps with Home/End', () => {
    expect(nextCursorForKey({ ...none, home: true }, 2, 3)).toBe(0);
    expect(nextCursorForKey({ ...none, end: true }, 0, 3)).toBe(2);
  });

  it('returns null for non-cursor keys and 0 for empty lists', () => {
    expect(nextCursorForKey(none, 1, 3)).toBeNull();
    expect(nextCursorForKey({ ...none, end: true }, 0, 0)).toBe(0);
  });
});
