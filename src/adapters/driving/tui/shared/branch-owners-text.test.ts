import { describe, expect, it } from 'vitest';
import { ownerAnnotationText, ownerAnnotations, ownerRefusalForBranch, ownerRefusalText } from './branch-owners-text.js';

describe('branch-owners-text (story 2.43)', () => {
  it('annotates one or several owners', () => {
    expect(ownerAnnotationText(['a'])).toBe('EDT « a »');
    expect(ownerAnnotationText(['a', 'b'])).toBe('EDT « a », « b »');
  });

  it('words the French refusal, bare and branch-prefixed', () => {
    expect(ownerRefusalText(['a', 'b'])).toBe("utilisée par l'EDT « a », « b » — la reprendre ou la renommer casserait cet EDT");
    expect(ownerRefusalForBranch('x', ['a'])).toBe("Branche « x » utilisée par l'EDT « a » — la reprendre ou la renommer casserait cet EDT");
  });

  it('builds annotations skipping empty owner lists, safe for prototype-named branches', () => {
    const map = ownerAnnotations({ 'feat/x': ['a'], empty: [], constructor: ['c'] });
    expect(map['feat/x']).toBe('EDT « a »');
    expect(Object.hasOwn(map, 'empty')).toBe(false);
    expect(Object.hasOwn(map, 'toString')).toBe(false);
    expect(map['constructor']).toBe('EDT « c »');
    expect(ownerAnnotations(undefined)).toEqual({});
  });
});
