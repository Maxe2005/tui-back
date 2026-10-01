import { describe, expect, it } from 'vitest';
import { resolveTabNavKey, stepTab } from './tab-navigation.js';

describe('resolveTabNavKey (story 6.9)', () => {
  it('maps Ctrl+→ / Ctrl+N to next and Ctrl+← / Ctrl+P to back', () => {
    expect(resolveTabNavKey('', { ctrl: true, rightArrow: true })).toBe('next');
    expect(resolveTabNavKey('n', { ctrl: true })).toBe('next');
    expect(resolveTabNavKey('', { ctrl: true, leftArrow: true })).toBe('back');
    expect(resolveTabNavKey('p', { ctrl: true })).toBe('back');
  });

  it('is inert without ctrl or on other letters', () => {
    expect(resolveTabNavKey('', { rightArrow: true })).toBeNull();
    expect(resolveTabNavKey('n', {})).toBeNull();
    expect(resolveTabNavKey('r', { ctrl: true })).toBeNull();
  });
});

describe('stepTab (story 6.9)', () => {
  const tabs = ['request', 'response'] as const;

  it('moves to the adjacent tab', () => {
    expect(stepTab(tabs, 'request', 'next')).toBe('response');
    expect(stepTab(tabs, 'response', 'back')).toBe('request');
  });

  it('never wraps past either end', () => {
    expect(stepTab(tabs, 'request', 'back')).toBe('request');
    expect(stepTab(tabs, 'response', 'next')).toBe('response');
  });

  it('falls back to the first tab when the current one is not listed', () => {
    expect(stepTab<string>(['a', 'b'], 'logs', 'next')).toBe('a');
  });
});
