import { describe, expect, it } from 'vitest';
import { CONFIRM_CANCEL_HINTS, formatHint, formatHints } from './hints.js';

describe('formatHints', () => {
  it('renders [Key] verb entries joined by two spaces', () => {
    expect(formatHint(['Esc', 'cancel'])).toBe('[Esc] cancel');
    expect(formatHints([['↑/↓', 'move'], ['Ctrl+W', 'resize']])).toBe('[↑/↓] move  [Ctrl+W] resize');
    expect(formatHints(CONFIRM_CANCEL_HINTS)).toBe('[Enter] confirm  [Esc] cancel');
  });
});
