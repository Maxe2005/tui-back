import { describe, expect, it } from 'vitest';
import { normalizeMessage } from './message.js';

describe('normalizeMessage', () => {
  it('collapses newlines and strips ANSI to one line', () => {
    expect(normalizeMessage('\u001b[31mfatal:\u001b[0m bad\n  thing\r\nhappened')).toBe('fatal: bad thing happened');
  });

  it('caps a 5k-char message with an ellipsis', () => {
    const out = normalizeMessage('x'.repeat(5000), 100);
    expect(out).toHaveLength(100);
    expect(out.endsWith('…')).toBe(true);
  });

  it('accepts errors and non-strings', () => {
    expect(normalizeMessage(new Error('boom'))).toBe('boom');
    expect(normalizeMessage(undefined)).toBe('');
  });
});
