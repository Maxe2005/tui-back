import { describe, expect, it } from 'vitest';
import type { SharedTypesHistory } from '../../store/slices/shared-types-slice.js';
import {
  HISTORY_VERSION_INPUT_ERROR,
  branchStatusLine,
  initialHistoryView,
  reduceHistoryKey,
  versionStatusLine,
  type HistoryContext,
} from './shared-types-history.logic.js';

const BRANCHES = ['development', 'feat/x', 'origin/feat/x'];
const ctx = (over: Partial<HistoryContext> = {}): HistoryContext => ({ mode: 'branch', searching: false, branches: BRANCHES, rowVersions: [], ...over });
const type = (view: ReturnType<typeof initialHistoryView>, text: string, context = ctx()) => {
  let current = view;
  for (const char of text) {
    current = reduceHistoryKey(current, context, char, {}).view;
  }
  return current;
};

describe('reduceHistoryKey', () => {
  it('fills the proposal on the first Enter and searches on the second', () => {
    let view = type(initialHistoryView(), 'feat');
    const first = reduceHistoryKey(view, ctx(), '', { return: true });
    expect(first.action).toEqual({ type: 'none' });
    expect(first.view.branch.value).toBe('feat/x');
    view = first.view;
    expect(reduceHistoryKey(view, ctx(), '', { return: true }).action).toEqual({ type: 'search', query: 'feat/x' });
  });

  it('searches an arbitrary ref when no branch matches, but never an empty one', () => {
    const view = type(initialHistoryView(), 'zzz');
    expect(reduceHistoryKey(view, ctx(), '', { return: true }).action).toEqual({ type: 'search', query: 'zzz' });
    expect(reduceHistoryKey(initialHistoryView(), ctx({ branches: [] }), '', { return: true }).action).toEqual({ type: 'none' });
  });

  it('validates the version before any search is requested', () => {
    const versionCtx = ctx({ mode: 'version' });
    for (const bad of ['0.1', 'a.b.c', '']) {
      const view = type(initialHistoryView(), bad, versionCtx);
      const step = reduceHistoryKey(view, versionCtx, '', { return: true });
      expect(step.action).toEqual({ type: 'none' });
      expect(step.view.inputError).toBe(HISTORY_VERSION_INPUT_ERROR);
    }
    const good = type(initialHistoryView(), '0.1.3770', versionCtx);
    expect(reduceHistoryKey(good, versionCtx, '', { return: true }).action).toEqual({ type: 'search', query: '0.1.3770' });
  });

  it('Esc cancels a running search, then leaves the field, then closes', () => {
    expect(reduceHistoryKey(initialHistoryView(), ctx({ searching: true }), '', { escape: true }).action).toEqual({ type: 'cancel' });
    const withRows = ctx({ rowVersions: ['0.1.2'] });
    const blurred = reduceHistoryKey(initialHistoryView(), withRows, '', { escape: true });
    expect(blurred.action).toEqual({ type: 'none' });
    expect(blurred.view.editing).toBe(false);
    expect(reduceHistoryKey(blurred.view, withRows, '', { escape: true }).action).toEqual({ type: 'close' });
    expect(reduceHistoryKey(initialHistoryView(), ctx(), '', { escape: true }).action).toEqual({ type: 'close' });
  });

  it('Tab asks for a mode switch', () => {
    expect(reduceHistoryKey(initialHistoryView(), ctx(), '', { tab: true }).action).toEqual({ type: 'switch-mode' });
  });

  it('moves over the rows, selects with Enter and returns to the field with Up on the first row', () => {
    const rows = ctx({ rowVersions: ['0.1.3', '0.1.2'] });
    let view = { ...initialHistoryView(), editing: false };
    view = reduceHistoryKey(view, rows, '', { downArrow: true }).view;
    expect(view.row).toBe(1);
    view = reduceHistoryKey(view, rows, '', { downArrow: true }).view;
    expect(view.row).toBe(1);
    expect(reduceHistoryKey(view, rows, '', { return: true }).action).toEqual({ type: 'select', version: '0.1.2' });
    view = reduceHistoryKey(reduceHistoryKey(view, rows, '', { upArrow: true }).view, rows, '', { upArrow: true }).view;
    expect(view.editing).toBe(true);
  });
});

const BASE: SharedTypesHistory = {
  mode: 'branch', status: 'done', query: 'b', entries: [], hits: [], found: null, truncated: false, earliestBranch: null, endedBy: 'depth', scanned: 0, error: null, depth: 20, maxScanned: 1000,
};

describe('status lines', () => {
  it('names the reason a by-branch walk ended', () => {
    expect(branchStatusLine({ ...BASE, endedBy: 'depth' })).toBe('stopped: depth 20');
    expect(branchStatusLine({ ...BASE, endedBy: 'scanned' })).toBe('stopped: 1000 commits scanned');
    expect(branchStatusLine({ ...BASE, endedBy: 'exhausted' })).toContain('branch exhausted');
    expect(branchStatusLine({ ...BASE, endedBy: 'aborted' })).toBe('cancelled');
    expect(branchStatusLine({ ...BASE, status: 'idle' })).toBeNull();
  });

  it('does not call a truncated miss "not found"', () => {
    expect(versionStatusLine({ ...BASE, mode: 'version', query: '9.9.9', found: false, truncated: true, endedBy: null })).toContain('not found so far');
  });

  it('clamps the row to the result length', () => {
    const view = { ...initialHistoryView(), editing: false, row: 5 };
    const step = reduceHistoryKey(view, ctx({ rowVersions: ['0.1.1', '0.1.0'] }), '', { return: true });
    expect(step.action).toEqual({ type: 'select', version: '0.1.0' });
  });

  it('answers a by-version search explicitly', () => {
    expect(versionStatusLine({ ...BASE, mode: 'version', query: '9.9.9', found: false, endedBy: null })).toBe('9.9.9 was not found on any local or already-fetched branch (nothing is fetched)');
    expect(versionStatusLine({ ...BASE, mode: 'version', found: true, earliestBranch: 'main', endedBy: null })).toContain('main');
  });
});
