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

  it('types into the version field, letters like q included', () => {
    let state = initialFormState();
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
    const base = { ...initialFormState(), row: 1 };
    expect(reduceForm(base, '', { return: true }, PATHS).run).toBe(true);
    expect(reduceForm({ ...base, unchecked: new Set(PATHS) }, '', { return: true }, PATHS).run).toBe(false);
    expect(canRun({ ...base, version: { value: ' ', cursor: 1 } }, PATHS)).toBe(false);
  });

  it('Enter on the version field moves down instead of running', () => {
    const step = reduceForm(initialFormState(), '', { return: true }, PATHS);
    expect(step.run).toBe(false);
    expect(step.state.row).toBe(1);
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
