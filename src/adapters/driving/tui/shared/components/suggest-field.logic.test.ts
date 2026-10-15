import { describe, expect, it } from 'vitest';
import {
  createSuggestFieldState,
  stepSuggestField,
  validateSuggestValue,
} from './suggest-field.logic.js';

const SUGGESTIONS = ['development', 'feat/x', 'feat/y', 'main'];
const NO_KEY = {};

function type(state = createSuggestFieldState(), text = '') {
  let current = state;
  for (const char of text) {
    const step = stepSuggestField(current, SUGGESTIONS, char, NO_KEY);
    if (step.type !== 'update') throw new Error('unexpected step');
    current = step.state;
  }
  return current;
}

describe('stepSuggestField', () => {
  it('Enter on an untouched empty field commits the default (empty value)', () => {
    expect(stepSuggestField(createSuggestFieldState(), SUGGESTIONS, '', { return: true })).toEqual({ type: 'commit', value: '' });
  });

  it('arrows highlight without touching the text', () => {
    const first = stepSuggestField(createSuggestFieldState(), SUGGESTIONS, '', { downArrow: true });
    expect(first).toMatchObject({ type: 'update', state: { value: '', pickCursor: 0, highlighted: true } });
    if (first.type !== 'update') throw new Error('expected update');
    const second = stepSuggestField(first.state, SUGGESTIONS, '', { downArrow: true });
    expect(second).toMatchObject({ type: 'update', state: { value: '', pickCursor: 1 } });
  });

  it('Enter after a highlight inserts the suggestion, the next Enter commits it', () => {
    const arrowed = stepSuggestField(createSuggestFieldState(), SUGGESTIONS, '', { downArrow: true });
    if (arrowed.type !== 'update') throw new Error('expected update');
    const inserted = stepSuggestField(arrowed.state, SUGGESTIONS, '', { return: true });
    expect(inserted).toMatchObject({ type: 'update', state: { value: 'development', highlighted: false } });
    if (inserted.type !== 'update') throw new Error('expected update');
    expect(stepSuggestField(inserted.state, SUGGESTIONS, '', { return: true })).toEqual({ type: 'commit', value: 'development' });
  });

  it('typing filters and clears the highlight flag', () => {
    const state = type(createSuggestFieldState(), 'fe');
    expect(state).toMatchObject({ value: 'fe', highlighted: false });
  });

  it('Enter with no match commits the raw text for the host to validate', () => {
    const state = type(createSuggestFieldState(), 'zzz');
    expect(stepSuggestField(state, SUGGESTIONS, '', { return: true })).toEqual({ type: 'commit', value: 'zzz' });
  });

  it('an arrow on an empty list does not arm the highlight', () => {
    const step = stepSuggestField(createSuggestFieldState(), [], '', { downArrow: true });
    expect(step).toMatchObject({ type: 'update', state: { highlighted: false } });
  });

  it('Escape cancels', () => {
    expect(stepSuggestField(createSuggestFieldState('x'), SUGGESTIONS, '', { escape: true })).toEqual({ type: 'cancel' });
  });
});

describe('validateSuggestValue', () => {
  it('accepts empty and listed values, refuses the rest', () => {
    expect(validateSuggestValue('', SUGGESTIONS, 'a branch')).toBeNull();
    expect(validateSuggestValue('main', SUGGESTIONS, 'a branch')).toBeNull();
    expect(validateSuggestValue('nope', SUGGESTIONS, 'a branch')).toContain('nope');
  });
});
