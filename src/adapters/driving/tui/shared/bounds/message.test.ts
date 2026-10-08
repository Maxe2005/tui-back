import { describe, expect, it } from 'vitest';
import { normalizeMessage, stripControl } from './message.js';

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

  it('falls back to the default limit for NaN and never splits a surrogate pair', () => {
    expect(normalizeMessage('abc', Number.NaN)).toBe('abc');
    const out = normalizeMessage('😀'.repeat(10), 4);
    expect(Array.from(out)).toHaveLength(4);
    expect(out.endsWith('…')).toBe(true);
    expect(out).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
  });

  it('strips C1 controls and joins arrays', () => {
    expect(normalizeMessage('a\u0085b\u009fc')).toBe('a b c');
    expect(normalizeMessage(['a', 'b'])).toBe('ab');
  });
});

describe('stripControl', () => {
  it('keeps spaces and newlines, drops ANSI and controls', () => {
    expect(stripControl('a  b\r\n\u001b[31mc\u001b[0m\u0085d')).toBe('a  b\ncd');
  });
});
