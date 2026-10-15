import { describe, expect, it } from 'vitest';
import {
  pushHistoryEntry,
  resolveHistoryBrowseDown,
  resolveHistoryBrowseUp,
  resolveSnapBackBase,
} from './input-history.logic.js';

describe('pushHistoryEntry', () => {
  it('front-pushes and trims to maxSize', () => {
    expect(pushHistoryEntry(['a', 'b', 'c'], 'd', 3)).toEqual(['d', 'a', 'b']);
  });
  it('dedups only the top entry when dedupEverywhere is off', () => {
    expect(pushHistoryEntry(['a', 'b'], 'a', 5)).toEqual(['a', 'b']);
    expect(pushHistoryEntry(['b', 'a'], 'a', 5)).toEqual(['a', 'b', 'a']);
  });
  it('moves to front everywhere when dedupEverywhere is on', () => {
    expect(pushHistoryEntry(['x', 'a', 'y'], 'a', 5, true)).toEqual(['a', 'x', 'y']);
  });
  it('yields an empty list for a zero size', () => {
    expect(pushHistoryEntry(['a'], 'b', 0)).toEqual([]);
  });
});

describe('browse state machine', () => {
  const history = ['a', 'b'];
  it('walks up, no-ops at the oldest, and walks back restoring the draft', () => {
    const first = resolveHistoryBrowseUp('draft', null, history);
    expect(first).toEqual({ query: 'a', browsing: { index: 0, savedDraft: 'draft' } });
    const second = resolveHistoryBrowseUp(first.query, first.browsing, history);
    expect(second.query).toBe('b');
    expect(resolveHistoryBrowseUp(second.query, second.browsing, history)).toEqual(second);
    const back = resolveHistoryBrowseDown(second.browsing!, history);
    expect(back.query).toBe('a');
    expect(resolveHistoryBrowseDown(back.browsing!, history)).toEqual({ query: 'draft', browsing: null });
  });
  it('skips entries equal to the draft in both directions', () => {
    const h = ['x', 'up', 'y'];
    const first = resolveHistoryBrowseUp('up', null, h);
    expect(first.query).toBe('x');
    const second = resolveHistoryBrowseUp(first.query, first.browsing, h);
    expect(second.query).toBe('y');
    expect(resolveHistoryBrowseDown(second.browsing!, h).query).toBe('x');
  });
  it('ends browsing and restores the draft when the list shrank under an active browse', () => {
    const stale = { index: 5, savedDraft: 'draft' };
    expect(resolveHistoryBrowseUp('x', stale, ['a'])).toEqual({ query: 'draft', browsing: null });
    expect(resolveHistoryBrowseDown(stale, [])).toEqual({ query: 'draft', browsing: null });
  });
  it('is a no-op on an empty history', () => {
    expect(resolveHistoryBrowseUp('d', null, [])).toEqual({ query: 'd', browsing: null });
  });
});

describe('resolveSnapBackBase', () => {
  it('returns the live text and cursor when not browsing', () => {
    expect(resolveSnapBackBase('abc', 1, null)).toEqual({ base: 'abc', cursor: 1 });
  });
  it('returns the saved draft with the cursor at its end while browsing', () => {
    expect(resolveSnapBackBase('recalled', 3, { index: 0, savedDraft: 'dr' })).toEqual({ base: 'dr', cursor: 2 });
  });
});
