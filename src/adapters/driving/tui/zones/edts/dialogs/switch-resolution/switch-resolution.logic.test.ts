import { describe, expect, it } from 'vitest';
import type { SwitchDirtyRepo, SwitchEdtRepoResult } from '../../../../../../../core/edt/switch.js';
import type { TextEditKey } from '../../../../shared/components/text-edit.js';
import {
  buildResolutions,
  buildRows,
  describeSwitchForLog,
  globalOf,
  initialSwitchResolution,
  modeLabel,
  needsResultsView,
  otherEdtBranches,
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
    // Story 2.42: manifest fixture — this repo's manifest lists preprod/prod as protected.
    protectedBranches: ['preprod', 'prod'],
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

  it('buildResolutions pins each discard to its row\'s dirtyPaths (confirmedPaths)', () => {
    const state = { ...initialSwitchResolution('Mon Topic', DIRTY), globalAction: 'discard' as const };
    expect(buildResolutions(buildRows(DIRTY, globalOf(state)))).toEqual({
      '/repo/a': { kind: 'discard', confirmedPaths: ['a.txt'] },
      '/repo/b': { kind: 'discard', confirmedPaths: ['a.txt'] },
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
    const row = (branch: string, base = SHARED) => ({ repo: base, hasOutgoing: true, claims: [], plan: { kind: 'adopt' as const, branch, source: 'perso' as const } });
    expect(validateRow(row(''), lists)).toBe('Nom de branche requis');
    expect(validateRow(row('prod'), lists)).toBe('« prod » est protégée par le manifeste de svc-a');
    // Story 2.42: a branch the repo's manifest does not list is not protected.
    expect(validateRow(row('prod', { ...SHARED, protectedBranches: [] }), lists)).toBeNull();
    expect(validateRow(row('taken'), lists)).toContain('existe déjà');
    expect(validateRow(row('fresh'), lists)).toBeNull();
    // The current branch itself may exist (adopting in place).
    expect(validateRow(row('feat/x', PERSONAL), { '/repo/b': { status: 'ready', branches: ['feat/x'] } })).toBeNull();
    // While the list is loading, the "exists" check is skipped.
    expect(validateRow(row('taken'), { '/repo/a': { status: 'loading', branches: [] } })).toBeNull();
    const detached = repo({ service: 'svc-d', repoPath: '/repo/d', currentBranch: 'HEAD', currentBranchShared: false });
    expect(validateRow(row('HEAD', detached), {})).toBe(RESOLUTION_ERRORS.detachedHead);
    expect(RESOLUTION_ERRORS.detachedHead).toBe('HEAD détachée ou branche illisible — seul Écraser est possible');
    const noManifest = repo({ service: 'svc-m', repoPath: '/repo/m', sharedBranch: null });
    expect(validateRow(row('fresh', noManifest), {})).toBe('manifeste illisible — impossible de valider la branche ; choisissez Écraser ou annulez');
    expect(validateRow({ repo: detached, hasOutgoing: true, claims: [], plan: { kind: 'discard', source: 'perso' } }, {})).toBeNull();
  });

  it('a row on a branch another EDT registers for that repo targets the global name; that branch is rejected inline', () => {
    const edts = [
      { ulid: 'out', topic: 'Mon Topic', createdAt: '', status: 'active' as const, members: [{ service: 'svc-b', repoPath: '/repo/b/', branch: 'feat/mine' }] },
      { ulid: 'third', topic: 'Other', createdAt: '', status: 'inactive' as const, members: [{ service: 'svc-b', repoPath: '/repo/b/', branch: 'feat/x' }] },
    ];
    const claims = otherEdtBranches(edts, 'out');
    // The outgoing EDT's own registrations are not claims; paths are resolved.
    expect(claims).toEqual({ '/repo/b': [{ branch: 'feat/x', topic: 'Other' }] });

    const state = initialSwitchResolution('Mon Topic', DIRTY, claims);
    const rows = buildRows(DIRTY, globalOf(state));
    expect(rows[1]!.plan).toEqual({ kind: 'adopt', branch: 'mon-topic', source: 'global' });
    expect(validateRow(rows[1]!, {})).toBeNull();

    const kept = { ...rows[1]!, plan: { kind: 'adopt' as const, branch: 'feat/x', source: 'perso' as const } };
    expect(validateRow(kept, {})).toBe("utilisée par l'EDT « Other » — la reprendre casserait cet EDT");
    // The box pre-fills the global name for such a row, and rejects the claimed branch too.
    const opened = press(ready(state), TAB, DOWN, ENTER);
    expect(opened.box?.branch.value).toBe('mon-topic');
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
    expect(confirming.confirm).toEqual({ scroll: 0, error: null });
    expect(confirming.decision).toBeNull();
    expect(press(confirming, ENTER).confirm).toBeNull();
    expect(press(confirming, ESC).confirm).toBeNull();
    expect(press(confirming, ['y', {}]).decision).toBeNull();
    expect(press(confirming, CTRL_E).decision).toEqual({
      kind: 'proceed',
      resolutions: { '/repo/a': { kind: 'discard', confirmedPaths: ['a.txt'] }, '/repo/b': { kind: 'discard', confirmedPaths: ['a.txt'] } },
    });
  });

  it('Ctrl+E is blocked inline when a discard row has no file list (pre-flight read failed)', () => {
    const unlisted = repo({ service: 'svc-u', repoPath: '/repo/u', dirtyPaths: undefined });
    const dirty = [unlisted];
    const state = ready(initialSwitchResolution(null, dirty));
    const confirming = reduceSwitchResolutionKey(state, dirty, 'n', { ctrl: true });
    expect(confirming.confirm).not.toBeNull();
    const refused = reduceSwitchResolutionKey(confirming, dirty, 'e', { ctrl: true });
    expect(refused.decision).toBeNull();
    expect(refused.confirm?.error).toBe('liste des fichiers indisponible pour svc-u — annulez et relancez la bascule');
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
    const results: SwitchEdtRepoResult[] = [
      { service: 'a', outcome: 'adopted', detail: { code: 'adopted', message: 'm', adoptedBranch: 'mon-topic' } },
      { service: 'b', outcome: 'discarded', detail: { code: 'discarded', message: 'm', discardedPaths: ['x.txt', 'y/z.txt'] } },
    ];
    expect(needsResultsView(results)).toBe(true);
    const detail = describeSwitchForLog('Target', false, results);
    expect(detail).toContain('a → mon-topic');
    expect(detail).toContain('b (x.txt, y/z.txt)');
  });

  it('lists discarded rows by outcome (a failed row with discardedPaths is not "discarded") and caps paths per service', () => {
    const many = Array.from({ length: 25 }, (_, index) => `f${index}.txt`);
    const detail = describeSwitchForLog('Target', false, [
      { service: 'big', outcome: 'discarded', detail: { code: 'discarded', message: 'm', discardedPaths: many } },
      { service: 'half', outcome: 'failed', detail: { code: 'git-clean-error', message: 'boom', discardedPaths: ['p.txt'] } },
    ]);
    expect(detail).toContain('f19.txt (+5 more)');
    expect(detail).not.toContain('f20.txt');
    expect(detail).not.toContain('half (p.txt)');
    expect(detail).toContain('failed: half: boom');
  });
});
