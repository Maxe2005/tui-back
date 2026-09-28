import { describe, expect, it } from 'vitest';
import type { SwitchDirtyRepo } from '../../../../../../../core/edt/switch.js';
import type { TextEditKey } from '../../../../shared/components/text-edit.js';
import {
  buildResolutions,
  buildRows,
  describeSwitchForLog,
  globalOf,
  initialSwitchResolution,
  modeLabel,
  needsResultsView,
  reduceSwitchResolutionKey,
  RESOLUTION_ERRORS,
  SWITCH_RESOLUTION_FOOTER,
  validateRow,
  type SwitchResolutionState,
} from './switch-resolution.logic.js';

function repo(overrides: Partial<SwitchDirtyRepo> & Pick<SwitchDirtyRepo, 'service' | 'repoPath'>): SwitchDirtyRepo {
  return {
    scope: 'non-member',
    currentBranch: 'development',
    currentBranchShared: true,
    sharedBranch: 'development',
    owningEdtTopics: [],
    dirtyPaths: ['a.txt'],
    ...overrides,
  };
}

const SHARED = repo({ service: 'svc-a', repoPath: '/repo/a' });
const PERSONAL = repo({ service: 'svc-b', repoPath: '/repo/b', currentBranch: 'feat/x', currentBranchShared: false, scope: 'member-of-other-edt', owningEdtTopics: ['Other'] });
const STATE_ONE = repo({ service: 'svc-c', repoPath: '/repo/c', scope: 'outgoing-member', resolution: 'auto-stash' });
const DIRTY = [SHARED, PERSONAL, STATE_ONE];

function ready(state: SwitchResolutionState, lists: Record<string, string[]> = {}): SwitchResolutionState {
  const next = { ...state.lists };
  for (const path of Object.keys(next)) {
    next[path] = { status: 'ready', branches: lists[path] ?? [] };
  }
  return { ...state, lists: next };
}

function press(state: SwitchResolutionState, ...keys: Array<[string, TextEditKey]>): SwitchResolutionState {
  return keys.reduce((current, [input, key]) => reduceSwitchResolutionKey(current, DIRTY, input, key), state);
}

const TAB: [string, TextEditKey] = ['', { tab: true }];
const ENTER: [string, TextEditKey] = ['\r', { return: true }];
const ESC: [string, TextEditKey] = ['', { escape: true }];
const DOWN: [string, TextEditKey] = ['', { downArrow: true }];
const SPACE: [string, TextEditKey] = [' ', {}];
const CTRL_N: [string, TextEditKey] = ['n', { ctrl: true }];
const CTRL_R: [string, TextEditKey] = ['r', { ctrl: true }];
const CTRL_E: [string, TextEditKey] = ['e', { ctrl: true }];
const BACKSPACE: [string, TextEditKey] = ['', { backspace: true }];

function type(text: string): Array<[string, TextEditKey]> {
  return [...text].map((char) => [char, {}]);
}

describe('switch-resolution rows (story 2.41)', () => {
  it('pins the AC footer verbatim', () => {
    expect(SWITCH_RESOLUTION_FOOTER).toBe('[Tab] Changer de zone • [Entrée] Configurer la ligne • [Ctrl+N] Confirmer • [Esc] Annuler le switch');
  });

  it('global adopt: a shared-branch repo targets the outgoing slug, a non-shared one keeps its branch; state-1 rows are left out', () => {
    const state = initialSwitchResolution('Mon Topic', DIRTY);
    const rows = buildRows(DIRTY, globalOf(state));
    expect(rows.map((row) => row.plan)).toEqual([
      { kind: 'adopt', branch: 'mon-topic', source: 'global' },
      { kind: 'adopt', branch: 'feat/x', source: 'global' },
    ]);
    expect(rows.map((row) => modeLabel(row.plan))).toEqual(['[Adopter (Global)]', '[Adopter (Global)]']);
    expect(buildResolutions(rows)).toEqual({
      '/repo/a': { kind: 'adopt', branch: 'mon-topic' },
      '/repo/b': { kind: 'adopt', branch: 'feat/x' },
    });
  });

  it('no outgoing EDT: every row defaults to Écraser and Panel A cannot toggle to Adopter', () => {
    const state = initialSwitchResolution(null, DIRTY);
    expect(state.globalAction).toBe('discard');
    expect(buildRows(DIRTY, globalOf(state)).every((row) => row.plan.kind === 'discard')).toBe(true);
    expect(press(state, SPACE).globalAction).toBe('discard');
  });

  it('validateRow: empty, protected, existing-locally (≠ current) and detached HEAD are rejected', () => {
    const lists = { '/repo/a': { status: 'ready' as const, branches: ['taken', 'development'] } };
    const row = (branch: string, base = SHARED) => ({ repo: base, hasOutgoing: true, plan: { kind: 'adopt' as const, branch, source: 'perso' as const } });
    expect(validateRow(row(''), lists)).toBe('Nom de branche requis');
    expect(validateRow(row('prod'), lists)).toContain('protégée');
    expect(validateRow(row('taken'), lists)).toContain('existe déjà');
    expect(validateRow(row('fresh'), lists)).toBeNull();
    // The current branch itself may exist (adopting in place).
    expect(validateRow(row('feat/x', PERSONAL), { '/repo/b': { status: 'ready', branches: ['feat/x'] } })).toBeNull();
    // While the list is loading, the "exists" check is skipped.
    expect(validateRow(row('taken'), { '/repo/a': { status: 'loading', branches: [] } })).toBeNull();
    const detached = repo({ service: 'svc-d', repoPath: '/repo/d', currentBranch: 'HEAD', currentBranchShared: false });
    expect(validateRow(row('HEAD', detached), {})).toBe(RESOLUTION_ERRORS.detachedHead);
    expect(validateRow({ repo: detached, hasOutgoing: true, plan: { kind: 'discard', source: 'perso' } }, {})).toBeNull();
  });
});

describe('reduceSwitchResolutionKey (story 2.41)', () => {
  it('Ctrl+N with every row valid and none Écraser proceeds with exactly buildResolutions(rows)', () => {
    const state = ready(initialSwitchResolution('Mon Topic', DIRTY));
    const next = press(state, CTRL_N);
    expect(next.decision).toEqual({ kind: 'proceed', resolutions: buildResolutions(buildRows(DIRTY, globalOf(state))) });
  });

  it('editing the global name retargets shared rows live and marks it touched', () => {
    const state = ready(initialSwitchResolution('Mon Topic', DIRTY));
    const cleared = [...Array(9)].map(() => BACKSPACE);
    const next = press(state, DOWN, ENTER, ['', { end: true }], ...cleared, ...type('wip'), ENTER);
    expect(next.globalName.value).toBe('wip');
    expect(next.globalNameTouched).toBe(true);
    expect(buildRows(DIRTY, globalOf(next)).map((row) => row.plan.kind === 'adopt' && row.plan.branch)).toEqual(['wip', 'feat/x']);
  });

  it('a Perso override stops following Panel A; Ctrl+R in the box returns the row to Global', () => {
    const state = ready(initialSwitchResolution('Mon Topic', DIRTY));
    // Panel B, row 2 (svc-b), open the box, edit the branch to feat/y, apply.
    const opened = press(state, TAB, DOWN, ENTER);
    expect(opened.box).toMatchObject({ repoPath: '/repo/b', action: 'adopt', branch: { value: 'feat/x' } });
    const applied = press(opened, DOWN, ENTER, BACKSPACE, ...type('y'), ENTER, ENTER);
    expect(applied.box).toBeNull();
    expect(applied.overrides['/repo/b']).toEqual({ kind: 'adopt', branch: 'feat/y' });
    const rows = buildRows(DIRTY, globalOf(applied));
    expect(modeLabel(rows[1]!.plan)).toBe('[Adopter (Perso)]');
    // Switching Panel A to Écraser leaves the Perso row alone.
    const globalDiscard = press(applied, TAB, SPACE);
    expect(buildRows(DIRTY, globalOf(globalDiscard)).map((row) => row.plan.kind)).toEqual(['discard', 'adopt']);
    const reverted = press(applied, ENTER, CTRL_R);
    expect(reverted.overrides).toEqual({});
  });

  it('an invalid name is refused at Apply and blocks Ctrl+N', () => {
    const state = ready(initialSwitchResolution('Mon Topic', DIRTY));
    const opened = press(state, TAB, ENTER); // svc-a box, pre-filled mon-topic
    const typed = press(opened, DOWN, ENTER, ...[...Array(9)].map(() => BACKSPACE), ...type('prod'), ENTER, ENTER);
    expect(typed.box?.error).toContain('protégée');
    expect(typed.overrides).toEqual({});

    const emptyGlobal = press(state, DOWN, ENTER, ...[...Array(9)].map(() => BACKSPACE), ENTER, CTRL_N);
    expect(emptyGlobal.decision).toBeNull();
    expect(emptyGlobal.error).toBe(RESOLUTION_ERRORS.blocked);
  });

  it('any Écraser row opens the discard confirmation: Enter/Esc go back, only Ctrl+E proceeds', () => {
    const state = ready(initialSwitchResolution('Mon Topic', DIRTY));
    const confirming = press(state, SPACE, CTRL_N);
    expect(confirming.confirm).toEqual({ scroll: 0 });
    expect(confirming.decision).toBeNull();
    expect(press(confirming, ENTER).confirm).toBeNull();
    expect(press(confirming, ESC).confirm).toBeNull();
    expect(press(confirming, ['y', {}]).decision).toBeNull();
    expect(press(confirming, CTRL_E).decision).toEqual({
      kind: 'proceed',
      resolutions: { '/repo/a': { kind: 'discard' }, '/repo/b': { kind: 'discard' } },
    });
  });

  it('Esc closes the innermost element first, then cancels the switch', () => {
    const state = ready(initialSwitchResolution('Mon Topic', DIRTY));
    const editing = press(state, DOWN, ENTER);
    expect(editing.editing).toBe(true);
    const left = press(editing, ESC);
    expect(left.editing).toBe(false);
    expect(left.decision).toBeNull();
    expect(press(left, ESC).decision).toEqual({ kind: 'cancel' });
    const boxOpen = press(state, TAB, ENTER);
    expect(press(boxOpen, ESC).box).toBeNull();
    expect(press(boxOpen, ESC).decision).toBeNull();
    expect(press(boxOpen, ESC, ESC).decision).toEqual({ kind: 'cancel' });
  });

  it('a detached-HEAD row must be Écraser: adopt blocks Ctrl+N', () => {
    const detached = repo({ service: 'svc-d', repoPath: '/repo/d', currentBranch: 'HEAD', currentBranchShared: false });
    const dirty = [detached];
    const state = ready(initialSwitchResolution('Mon Topic', dirty));
    expect(reduceSwitchResolutionKey(state, dirty, 'n', { ctrl: true }).error).toBe(RESOLUTION_ERRORS.blocked);
  });
});

describe('results & log detail (story 2.41)', () => {
  it('keeps the dialog open on anything beyond a plain switch and records adopted branches and discarded paths', () => {
    expect(needsResultsView([{ service: 'a', outcome: 'switched' }])).toBe(false);
    const results = [
      { service: 'a', outcome: 'adopted', detail: { code: 'adopted', message: 'm', adoptedBranch: 'mon-topic' } },
      { service: 'b', outcome: 'discarded', detail: { code: 'discarded', message: 'm', discardedPaths: ['x.txt', 'y/z.txt'] } },
    ];
    expect(needsResultsView(results)).toBe(true);
    const detail = describeSwitchForLog('Target', false, results);
    expect(detail).toContain('a → mon-topic');
    expect(detail).toContain('b (x.txt, y/z.txt)');
  });
});
