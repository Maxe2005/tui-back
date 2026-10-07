import { describe, expect, it } from 'vitest';
import { focusNavHint, resolveFocusMove, resolveFocusStep, stepFocus } from './focus-navigation.js';

describe('resolveFocusStep', () => {
  it('tab mode maps Tab to next and Shift+Tab to back', () => {
    expect(resolveFocusStep('', { tab: true }, 'tab')).toBe('next');
    expect(resolveFocusStep('', { tab: true, shift: true }, 'tab')).toBe('back');
  });
  it('tab mode ignores Ctrl+Tab and Meta+Tab', () => {
    expect(resolveFocusStep('', { tab: true, ctrl: true }, 'tab')).toBeNull();
    expect(resolveFocusStep('', { tab: true, meta: true }, 'tab')).toBeNull();
    expect(resolveFocusStep('', { tab: true, shift: true, ctrl: true }, 'tab')).toBeNull();
  });
  it('returns null for keys outside the declared mode', () => {
    expect(resolveFocusStep('', { rightArrow: true }, 'tab')).toBeNull();
    expect(resolveFocusStep('', { tab: true }, 'horizontal')).toBeNull();
    expect(resolveFocusStep('x', {}, 'ctrl-np')).toBeNull();
  });
  it('horizontal and vertical modes use arrows', () => {
    expect(resolveFocusStep('', { rightArrow: true }, 'horizontal')).toBe('next');
    expect(resolveFocusStep('', { leftArrow: true }, 'horizontal')).toBe('back');
    expect(resolveFocusStep('', { downArrow: true }, 'vertical')).toBe('next');
    expect(resolveFocusStep('', { upArrow: true }, 'vertical')).toBe('back');
    expect(resolveFocusStep('', { upArrow: true }, 'horizontal')).toBeNull();
  });
  it('ctrl-np mode delegates to Ctrl+N / Ctrl+P and Ctrl+arrows', () => {
    expect(resolveFocusStep('n', { ctrl: true }, 'ctrl-np')).toBe('next');
    expect(resolveFocusStep('', { ctrl: true, leftArrow: true }, 'ctrl-np')).toBe('back');
    expect(resolveFocusStep('n', {}, 'ctrl-np')).toBeNull();
  });
});

describe('stepFocus', () => {
  const stops = ['edts', 'edt-services', 'other-services'];
  it('wraps in both directions', () => {
    expect(stepFocus(stops, 'other-services', 'next')).toBe('edts');
    expect(stepFocus(stops, 'edts', 'back')).toBe('other-services');
    expect(stepFocus(stops, 'edts', 'next')).toBe('edt-services');
  });
  it('falls back to first/last for an unknown current', () => {
    expect(stepFocus(stops, 'nope', 'next')).toBe('edts');
    expect(stepFocus(stops, 'nope', 'back')).toBe('other-services');
  });
  it('stays on a single stop and survives an empty list', () => {
    expect(stepFocus(['a'], 'a', 'next')).toBe('a');
    expect(stepFocus(['a'], 'a', 'back')).toBe('a');
    expect(stepFocus([], 'a', 'next')).toBe('a');
  });
});

describe('resolveFocusMove / hints', () => {
  it('returns null for foreign keys and the next stop otherwise', () => {
    const decl = { mode: 'tab' as const, stops: ['a', 'b'] as const };
    expect(resolveFocusMove('', { tab: true, shift: true }, decl, 'a')).toBe('b');
    expect(resolveFocusMove('', { upArrow: true }, decl, 'a')).toBeNull();
  });
  it('labels each mode', () => {
    expect(focusNavHint('tab', 'Switch pane').keys).toBe('Tab / Shift+Tab');
  });
});
