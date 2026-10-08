import { describe, expect, it } from 'vitest';
import { canRun, initialFormState, reduceForm, resolveQuitDecision, rowTarget, shouldConfirmQuit, summarizeResult } from './shared-types-zone.logic.js';

const PATHS = ['/r/a', '/r/b'];
const none = {};

describe('reduceForm', () => {
  it('starts on the version field pre-filled 0.1. with every consumer checked', () => {
    const state = initialFormState();
    expect(state.version).toEqual({ value: '0.1.', cursor: 4 });
    expect(state.row).toBe(0);
    expect(state.unchecked.size).toBe(0);
  });

  it('a pre-focused version field ignores keystrokes until Enter starts editing', () => {
    let state = initialFormState();
    expect(state.editing).toBe(false);
    for (const char of '3q') {
      state = reduceForm(state, char, none, PATHS).state;
    }
    expect(state.version.value).toBe('0.1.');
    state = reduceForm(state, '', { return: true }, PATHS).state;
    expect(state.editing).toBe(true);
    expect(state.row).toBe(0);
  });

  it('Enter, Esc and arrows leave the editing mode', () => {
    const editing = { ...initialFormState(), editing: true };
    expect(reduceForm(editing, '', { return: true }, PATHS).state.editing).toBe(false);
    expect(reduceForm(editing, '', { escape: true }, PATHS).state.editing).toBe(false);
    const down = reduceForm(editing, '', { downArrow: true }, PATHS).state;
    expect(down.editing).toBe(false);
    expect(down.row).toBe(1);
  });

  it('types into the version field, letters like q included', () => {
    let state = { ...initialFormState(), editing: true };
    for (const char of '3674q') {
      state = reduceForm(state, char, none, PATHS).state;
    }
    expect(state.version.value).toBe('0.1.3674q');
  });

  it('moves with arrows and toggles a consumer and an option with Space', () => {
    let state = reduceForm(initialFormState(), '', { downArrow: true }, PATHS).state;
    expect(rowTarget(state.row, PATHS.length)).toEqual({ kind: 'consumer', index: 0 });
    state = reduceForm(state, ' ', none, PATHS).state;
    expect([...state.unchecked]).toEqual(['/r/a']);
    state = { ...state, row: 3 };
    const before = state.options.install;
    state = reduceForm(state, ' ', none, PATHS).state;
    expect(state.options.install).toBe(!before);
  });

  it('runs on Enter outside the version field only when a version and a service are chosen', () => {
    const base = { ...initialFormState(), version: { value: '0.1.5', cursor: 5 }, row: 1 };
    expect(reduceForm(base, '', { return: true }, PATHS).run).toBe(true);
    expect(reduceForm({ ...base, unchecked: new Set(PATHS) }, '', { return: true }, PATHS).run).toBe(false);
    expect(canRun({ ...base, version: { value: ' ', cursor: 1 } }, PATHS)).toBe(false);
  });

  it('cannot run with only the 0.1. prefix or an invalid version', () => {
    const base = { ...initialFormState(), row: 1 };
    expect(canRun(base, PATHS)).toBe(false);
    expect(canRun({ ...base, version: { value: '0.1.abc', cursor: 7 } }, PATHS)).toBe(false);
    expect(canRun({ ...base, version: { value: '0.1.3674', cursor: 8 } }, PATHS)).toBe(true);
    expect(reduceForm(base, '', { return: true }, PATHS).run).toBe(false);
  });

  it('Enter on the version field edits it instead of running', () => {
    const step = reduceForm(initialFormState(), '', { return: true }, PATHS);
    expect(step.run).toBe(false);
    expect(step.state.editing).toBe(true);
  });
});

describe('quit handling', () => {
  it('asks for confirmation only for q mid-run', () => {
    expect(shouldConfirmQuit('q', 'running')).toBe(true);
    expect(shouldConfirmQuit('q', 'idle')).toBe(false);
    expect(resolveQuitDecision('', { return: true })).toBe('confirm');
    expect(resolveQuitDecision('', { escape: true })).toBe('cancel');
    expect(resolveQuitDecision('y', {})).toBeNull();
  });
});

describe('summarizeResult', () => {
  it('names the failing step and code', () => {
    const text = summarizeResult({
      service: 'b', repoPath: '/r/b', outcome: 'failed', steps: [], failedStep: 'install', error: { code: 'restart-failed', message: 'npm ERR' },
    });
    expect(text).toContain('install');
    expect(text).toContain('restart-failed');
  });

  it('gives the skip reason', () => {
    expect(summarizeResult({ service: 'a', repoPath: '/r/a', outcome: 'skipped', steps: [], reason: 'package.json dirty' })).toContain('package.json dirty');
  });
});
