// tui/zones/edts/dialogs/create-wizard: Story 2.38 — Step 4's pure key reducer (radio, pause
// panel, overwrite confirmation) and its helpers.
import { describe, expect, it } from 'vitest';
import { initialActivationState, type ActivationState } from '../../edts-zone.logic.js';
import { overwriteConfirmLines, overwriteFrom, reduceActivationKey } from './activation.logic.js';

const BLOCKED = [
  { service: 'svc-a', repoPath: '/repos/a', paths: ['a.ts', 'b.ts'] },
  { service: 'svc-b', repoPath: '/repos/b', paths: ['c.ts'] },
];

function paused(overrides: Partial<ActivationState> = {}): ActivationState {
  return { ...initialActivationState(true), created: { ulid: 'u', topic: 't' }, blocked: BLOCKED, ...overrides };
}

describe('reduceActivationKey — the radio (before the create)', () => {
  it('Space toggles, ↑ selects switch, ↓ selects stay; default is switch', () => {
    const start = initialActivationState(false);
    expect(start.choice).toBe('switch');
    const toggled = reduceActivationKey(start, ' ', {});
    expect(toggled.choice).toBe('stay');
    expect(reduceActivationKey(toggled, ' ', {}).choice).toBe('switch');
    expect(reduceActivationKey(toggled, '', { upArrow: true }).choice).toBe('switch');
    expect(reduceActivationKey(start, '', { downArrow: true }).choice).toBe('stay');
  });

  it('is locked on a first EDT', () => {
    const first = initialActivationState(true);
    expect(reduceActivationKey(first, ' ', {})).toBe(first);
    expect(reduceActivationKey(first, '', { downArrow: true })).toBe(first);
  });
});

describe('reduceActivationKey — the pause panel', () => {
  it('R (either case) raises retry, E opens the confirmation, Esc raises stop', () => {
    expect(reduceActivationKey(paused(), 'r', {}).decision).toEqual({ kind: 'retry' });
    expect(reduceActivationKey(paused(), 'R', {}).decision).toEqual({ kind: 'retry' });
    expect(reduceActivationKey(paused(), 'e', {}).confirm).toEqual({ scroll: 0 });
    expect(reduceActivationKey(paused(), '', { escape: true }).decision).toEqual({ kind: 'stop' });
  });

  it('ignores Ctrl+E and other keys on the panel itself', () => {
    const state = paused();
    expect(reduceActivationKey(state, 'e', { ctrl: true })).toBe(state);
    expect(reduceActivationKey(state, 'x', {})).toBe(state);
    expect(reduceActivationKey(state, '', { return: true })).toBe(state);
  });

  it('ignores every key once a decision is pending or the outcome is terminal', () => {
    const pending = paused({ decision: { kind: 'retry' } });
    expect(reduceActivationKey(pending, 'e', {})).toBe(pending);
    const stopped = paused({ blocked: null, outcome: 'stopped' });
    expect(reduceActivationKey(stopped, 'r', {})).toBe(stopped);
  });
});

describe('reduceActivationKey — the overwrite confirmation', () => {
  it('Ctrl+E raises overwrite; Enter and Esc mean Retour', () => {
    const confirming = paused({ confirm: { scroll: 0 } });
    expect(reduceActivationKey(confirming, 'e', { ctrl: true }).decision).toEqual({ kind: 'overwrite' });
    expect(reduceActivationKey(confirming, '', { return: true }).confirm).toBeNull();
    expect(reduceActivationKey(confirming, '', { escape: true }).confirm).toBeNull();
    expect(reduceActivationKey(confirming, 'e', {}).decision).toBeNull();
  });

  it('↑/↓ scroll within the file list (heads + files)', () => {
    let state = paused({ confirm: { scroll: 0 } });
    state = reduceActivationKey(state, '', { upArrow: true });
    expect(state.confirm).toEqual({ scroll: 0 });
    for (let index = 0; index < 10; index += 1) {
      state = reduceActivationKey(state, '', { downArrow: true });
    }
    // 2 heads + 3 files = 5 lines -> last index 4.
    expect(state.confirm).toEqual({ scroll: 4 });
  });
});

describe('overwrite helpers', () => {
  it('lists one head per service then its files', () => {
    expect(overwriteConfirmLines(BLOCKED).map((line) => line.text)).toEqual([
      'svc-a (2 fichier(s))',
      '    a.ts',
      '    b.ts',
      'svc-b (1 fichier(s))',
      '    c.ts',
    ]);
  });

  it('builds the overwrite map from exactly the listed paths', () => {
    expect(overwriteFrom(BLOCKED)).toEqual({ '/repos/a': ['a.ts', 'b.ts'], '/repos/b': ['c.ts'] });
  });
});
