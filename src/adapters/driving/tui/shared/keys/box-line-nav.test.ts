import { describe, expect, it } from 'vitest';
import { nextBoxLine } from './box-line-nav.js';

const LINES = ['a', 'b', 'c'] as const;

describe('nextBoxLine', () => {
  it('clamps arrows and jumps with Home/End', () => {
    expect(nextBoxLine(LINES, 'a', '', { upArrow: true })).toBe('a');
    expect(nextBoxLine(LINES, 'a', '', { downArrow: true })).toBe('b');
    expect(nextBoxLine(LINES, 'a', '', { end: true })).toBe('c');
    expect(nextBoxLine(LINES, 'c', '', { home: true })).toBe('a');
  });

  it('cycles with Tab and Shift+Tab, wrapping', () => {
    expect(nextBoxLine(LINES, 'c', '', { tab: true })).toBe('a');
    expect(nextBoxLine(LINES, 'a', '', { tab: true, shift: true })).toBe('c');
  });

  it('returns null for other keys', () => {
    expect(nextBoxLine(LINES, 'a', ' ', {})).toBeNull();
  });
});
