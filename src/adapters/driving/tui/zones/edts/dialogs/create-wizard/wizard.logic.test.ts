import { describe, it, expect } from 'vitest';
import { initialCreateDialog, type CreateDialogState } from '../../edts-zone.logic.js';
import {
  buildBreadcrumb,
  canAdvance,
  checkNameAvailability,
  EMPTY_NAME_ERROR,
  NO_SERVICE_ERROR,
  reachableSteps,
  resolveWizardNavKey,
  stepSummary,
  TAKEN_NAME_ERROR,
  withPrefillCursors,
} from './wizard.logic.js';

const EDTS = [{ topic: 'demo' }];

function state(overrides: Partial<CreateDialogState> = {}): CreateDialogState {
  return { ...initialCreateDialog(), ...overrides };
}

// A state whose Steps 1-3 are all valid (one member, grouped name + base filled).
function validThroughStep3(overrides: Partial<CreateDialogState> = {}): CreateDialogState {
  return state({
    topic: 'auth-flow',
    selectedMembers: ['/repos/a'],
    baseBranches: { '/repos/a': 'development' },
    branchName: 'auth-flow',
    ...overrides,
  });
}

describe('checkNameAvailability (story 2.36)', () => {
  it('a free name is available', () => {
    expect(checkNameAvailability('auth-flow', EDTS)).toBe('available');
  });

  it('a taken name is detected after trimming', () => {
    expect(checkNameAvailability(' demo ', EDTS)).toBe('taken');
  });

  it('is case-sensitive: "Demo" does not collide with "demo"', () => {
    expect(checkNameAvailability('Demo', EDTS)).toBe('available');
  });

  it('empty and blank names are "empty"', () => {
    expect(checkNameAvailability('', EDTS)).toBe('empty');
    expect(checkNameAvailability('   ', EDTS)).toBe('empty');
  });
});

describe('canAdvance (story 2.36)', () => {
  it('Step 1: free name passes, taken or empty name blocks with its own message', () => {
    expect(canAdvance(1, state({ topic: 'auth-flow' }), EDTS)).toEqual({ ok: true });
    expect(canAdvance(1, state({ topic: ' demo ' }), EDTS)).toEqual({ ok: false, error: TAKEN_NAME_ERROR });
    expect(canAdvance(1, state({ topic: '   ' }), EDTS)).toEqual({ ok: false, error: EMPTY_NAME_ERROR });
  });

  it('Step 2: zero checked services blocks, one is enough', () => {
    expect(canAdvance(2, state(), EDTS)).toEqual({ ok: false, error: NO_SERVICE_ERROR });
    expect(canAdvance(2, state({ selectedMembers: ['/repos/a'] }), EDTS)).toEqual({ ok: true });
  });

  it('Step 3: reuses validateCreateBranchFields — an emptied branch name blocks', () => {
    expect(canAdvance(3, validThroughStep3(), EDTS)).toEqual({ ok: true });
    expect(canAdvance(3, validThroughStep3({ branchName: '' }), EDTS)).toEqual({ ok: false, error: 'Branch name must not be empty' });
  });
});

describe('reachableSteps (story 2.36)', () => {
  it('stops at the first blocked step, inclusive', () => {
    expect(reachableSteps(state(), EDTS)).toEqual([1]);
    expect(reachableSteps(state({ topic: 'auth-flow' }), EDTS)).toEqual([1, 2]);
    expect(reachableSteps(validThroughStep3({ branchName: '' }), EDTS)).toEqual([1, 2, 3]);
    expect(reachableSteps(validThroughStep3(), EDTS)).toEqual([1, 2, 3, 4]);
  });
});

describe('stepSummary / buildBreadcrumb (story 2.36)', () => {
  it('summarizes each completed step', () => {
    const current = validThroughStep3({ selectedMembers: ['/repos/a', '/repos/b', '/repos/c'] });
    expect(stepSummary(1, current)).toBe('1. Nom: auth-flow');
    expect(stepSummary(2, current)).toBe('2. Services (3)');
    expect(stepSummary(3, current)).toBe('3. Branches: auth-flow');
    expect(stepSummary(3, { ...current, namingMode: 'individual' })).toBe('3. Branches (individuelles)');
  });

  it('marks the current step, summarizes earlier ones and dims unreachable ones', () => {
    const breadcrumb = buildBreadcrumb(state({ step: 2, topic: 'auth-flow' }), EDTS);
    expect(breadcrumb).toEqual([
      { step: 1, text: '1. Nom: auth-flow', tone: 'done' },
      { step: 2, text: '▶ 2. Services ◀', tone: 'current' },
      { step: 3, text: '3. Branches', tone: 'unreachable' },
      { step: 4, text: '4. Activation', tone: 'unreachable' },
    ]);
  });

  it('a reachable step after the current one is pending, not dim', () => {
    const breadcrumb = buildBreadcrumb(state({ topic: 'auth-flow' }), EDTS);
    expect(breadcrumb[1]).toEqual({ step: 2, text: '2. Services', tone: 'pending' });
  });
});

describe('resolveWizardNavKey (story 2.36)', () => {
  it('Ctrl+→ and Ctrl+N go forward', () => {
    expect(resolveWizardNavKey('', { ctrl: true, rightArrow: true })).toBe('next');
    expect(resolveWizardNavKey('n', { ctrl: true })).toBe('next');
  });

  it('Ctrl+← and Ctrl+P go back', () => {
    expect(resolveWizardNavKey('', { ctrl: true, leftArrow: true })).toBe('back');
    expect(resolveWizardNavKey('p', { ctrl: true })).toBe('back');
  });

  it('plain arrows and plain letters are never step navigation', () => {
    expect(resolveWizardNavKey('', { rightArrow: true })).toBeNull();
    expect(resolveWizardNavKey('n', {})).toBeNull();
    expect(resolveWizardNavKey('x', { ctrl: true })).toBeNull();
  });
});

describe('withPrefillCursors (story 2.36, moved from create-dialog.tsx)', () => {
  it('resets untouched cursors to the new value length and keeps touched ones', () => {
    const prev = state({
      branchNameTouched: false,
      branchNamesTouched: { '/repos/a': true },
      branchNameCursors: { '/repos/a': 1 },
    });
    expect(withPrefillCursors(prev, { branchName: 'demo', branchNames: { '/repos/a': 'abc', '/repos/b': 'demo' } })).toEqual({
      branchNameCursor: 4,
      branchNameCursors: { '/repos/a': 1, '/repos/b': 4 },
    });
  });
});
