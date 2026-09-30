import { describe, it, expect } from 'vitest';
import { initialCreateDialog, type BranchListState, type BranchStepState, type CreateDialogState, type RowOverride } from '../../edts-zone.logic.js';
import {
  buildBreadcrumb,
  buildMemberPlans,
  buildRowView,
  buildStep3Rows,
  canAdvance,
  activateLaterHint,
  activationErrorResults,
  checkNameAvailability,
  describeCreateForLog,
  EMPTY_NAME_ERROR,
  enterBranchStep,
  isActivationAcknowledge,
  isProtectedTarget,
  localNameOf,
  nonMemberReturns,
  NO_SERVICE_ERROR,
  reachableSteps,
  resolveGlobalBase,
  resolveWizardNavKey,
  stepSummary,
  summarizeActivationResults,
  TAKEN_NAME_ERROR,
} from './wizard.logic.js';

const EDTS = [{ topic: 'demo' }];
const CANDIDATES = [
  { path: '/repos/a', service: 'svc-a', sharedBranch: 'main' },
  { path: '/repos/b', service: 'svc-b', sharedBranch: 'development' },
  { path: '/repos/c', service: 'svc-c', sharedBranch: 'development' },
];

function ready(local: string[], remote: string[] = []): BranchListState {
  return { status: 'ready', local, remote };
}

function branches(overrides: Partial<BranchStepState> = {}): BranchStepState {
  return { ...initialCreateDialog().branches, ...overrides };
}

function state(overrides: Partial<CreateDialogState> = {}): CreateDialogState {
  return { ...initialCreateDialog(), ...overrides };
}

// A state whose Steps 1-3 are all valid (one member, lists loaded, global name set).
function validThroughStep3(overrides: Partial<CreateDialogState> = {}, branchOverrides: Partial<BranchStepState> = {}): CreateDialogState {
  const selectedMembers = overrides.selectedMembers ?? ['/repos/a'];
  return state({
    topic: 'auth-flow',
    selectedMembers,
    branches: branches({
      globalName: { value: 'auth-flow', cursor: 9 },
      lists: Object.fromEntries(selectedMembers.map((path) => [path, ready(['main', 'development'])])),
      ...branchOverrides,
    }),
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
    expect(canAdvance(1, state({ topic: 'auth-flow' }), EDTS, CANDIDATES)).toEqual({ ok: true });
    expect(canAdvance(1, state({ topic: ' demo ' }), EDTS, CANDIDATES)).toEqual({ ok: false, error: TAKEN_NAME_ERROR });
    expect(canAdvance(1, state({ topic: '   ' }), EDTS, CANDIDATES)).toEqual({ ok: false, error: EMPTY_NAME_ERROR });
  });

  it('Step 2: zero checked services blocks, one is enough', () => {
    expect(canAdvance(2, state(), EDTS, CANDIDATES)).toEqual({ ok: false, error: NO_SERVICE_ERROR });
    expect(canAdvance(2, state({ selectedMembers: ['/repos/a'] }), EDTS, CANDIDATES)).toEqual({ ok: true });
  });

  it('Step 3 (story 2.37): every row must resolve — an emptied name, a missing base or a loading list blocks, named by service', () => {
    expect(canAdvance(3, validThroughStep3(), EDTS, CANDIDATES)).toEqual({ ok: true });
    expect(canAdvance(3, validThroughStep3({}, { globalName: { value: ' ', cursor: 1 } }), EDTS, CANDIDATES)).toEqual({
      ok: false,
      error: 'svc-a : nom de branche vide',
    });
    expect(canAdvance(3, validThroughStep3({}, { globalBase: { value: 'nope', cursor: 4 } }), EDTS, CANDIDATES)).toEqual({
      ok: false,
      error: 'svc-a : branche introuvable',
    });
    expect(canAdvance(3, validThroughStep3({}, { lists: {} }), EDTS, CANDIDATES)).toEqual({
      ok: false,
      error: 'svc-a : chargement des branches en cours',
    });
    expect(canAdvance(3, validThroughStep3({}, { globalName: { value: 'prod', cursor: 4 } }), EDTS, CANDIDATES)).toEqual({
      ok: false,
      error: 'svc-a : branche protégée (FR-7)',
    });
  });
});

describe('reachableSteps (story 2.36)', () => {
  it('stops at the first blocked step, inclusive', () => {
    expect(reachableSteps(state(), EDTS, CANDIDATES)).toEqual([1]);
    expect(reachableSteps(state({ topic: 'auth-flow' }), EDTS, CANDIDATES)).toEqual([1, 2]);
    expect(reachableSteps(validThroughStep3({}, { globalName: { value: '', cursor: 0 } }), EDTS, CANDIDATES)).toEqual([1, 2, 3]);
    expect(reachableSteps(validThroughStep3(), EDTS, CANDIDATES)).toEqual([1, 2, 3, 4]);
  });
});

describe('stepSummary / buildBreadcrumb (story 2.36)', () => {
  it('summarizes each completed step', () => {
    const current = validThroughStep3({ selectedMembers: ['/repos/a', '/repos/b', '/repos/c'] });
    expect(stepSummary(1, current)).toBe('1. Nom: auth-flow');
    expect(stepSummary(2, current)).toBe('2. Services (3)');
    expect(stepSummary(3, current)).toBe('3. Branches: auth-flow');
    const withException = { ...current, branches: { ...current.branches, overrides: { '/repos/b': { kind: 'existing' as const, branch: 'x' } } } };
    expect(stepSummary(3, withException)).toBe('3. Branches: auth-flow (+1 exception)');
  });

  it('marks the current step, summarizes earlier ones and dims unreachable ones', () => {
    const breadcrumb = buildBreadcrumb(state({ step: 2, topic: 'auth-flow' }), EDTS, CANDIDATES);
    expect(breadcrumb).toEqual([
      { step: 1, text: '1. Nom: auth-flow', tone: 'done' },
      { step: 2, text: '▶ 2. Services ◀', tone: 'current' },
      { step: 3, text: '3. Branches', tone: 'unreachable' },
      { step: 4, text: '4. Activation', tone: 'unreachable' },
    ]);
  });

  it('a reachable step after the current one is pending, not dim', () => {
    const breadcrumb = buildBreadcrumb(state({ topic: 'auth-flow' }), EDTS, CANDIDATES);
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

describe('isProtectedTarget / localNameOf (story 2.37)', () => {
  it('protects the fixed shared set and the service\'s own manifest sharedBranch (FR-7)', () => {
    expect(isProtectedTarget('development', 'main')).toBe(true);
    expect(isProtectedTarget(' main ', 'main')).toBe(true);
    expect(isProtectedTarget('feat/q', 'main')).toBe(false);
  });

  it('strips the remote segment of a remote-only ref, as core does', () => {
    const lists = ready(['x'], ['origin/x', 'origin/feat/q']);
    expect(localNameOf('origin/feat/q', lists)).toBe('feat/q');
    expect(localNameOf('x', lists)).toBe('x');
  });
});

describe('resolveGlobalBase (story 2.37)', () => {
  it('Default: an empty base uses the service\'s manifest sharedBranch, resolved like a typed base', () => {
    expect(resolveGlobalBase('', ready(['main']), 'main')).toEqual({ kind: 'resolved', base: 'main' });
    expect(resolveGlobalBase('', ready([], ['origin/main']), 'main')).toEqual({ kind: 'resolved', base: 'origin/main' });
  });

  it('a manifest sharedBranch missing from the repo is not found, never passed through', () => {
    expect(resolveGlobalBase('', ready(['development']), 'main')).toEqual({ kind: 'not-found' });
    expect(resolveGlobalBase('', ready(['main']), '')).toEqual({ kind: 'not-found' });
  });

  it('Local preferred: an exact local match wins over origin/<x>', () => {
    expect(resolveGlobalBase('rel', ready(['rel'], ['origin/rel']), 'main')).toEqual({ kind: 'resolved', base: 'rel' });
  });

  it('Remote only: falls back to origin/<x>', () => {
    expect(resolveGlobalBase(' rel ', ready([], ['origin/rel']), 'main')).toEqual({ kind: 'resolved', base: 'origin/rel' });
  });

  it('Not found: no match anywhere', () => {
    expect(resolveGlobalBase('nope', ready(['main'], ['origin/main']), 'main')).toEqual({ kind: 'not-found' });
  });

  it('a list not loaded yet, or failed, never resolves', () => {
    expect(resolveGlobalBase('', undefined, 'main')).toEqual({ kind: 'loading' });
    expect(resolveGlobalBase('', { status: 'pending', local: [], remote: [] }, 'main')).toEqual({ kind: 'loading' });
    expect(resolveGlobalBase('', { status: 'error', local: [], remote: [], error: 'boom' }, 'main')).toEqual({ kind: 'load-error', message: 'boom' });
  });
});

describe('buildRowView / buildMemberPlans (story 2.37)', () => {
  const global = { base: '', name: 'auth-flow' };

  it('Default: [Créer (Global)] main -> auth-flow, plan {create, main, auth-flow}', () => {
    const row = buildRowView({ path: '/repos/a', service: 'svc-a' }, global, ready(['main']), 'main');
    expect(row).toMatchObject({ mode: 'global', modeLabel: '[Créer (Global)]', base: 'main', target: 'auth-flow', error: null });
    expect(buildMemberPlans([row])).toEqual({ '/repos/a': { kind: 'create', base: 'main', name: 'auth-flow' } });
  });

  it('Not found: the base column carries the error and no plan is built', () => {
    const row = buildRowView({ path: '/repos/a', service: 'svc-a' }, { base: 'nope', name: 'auth-flow' }, ready(['main']), 'main');
    expect(row).toMatchObject({ baseStatus: 'error', base: 'branche introuvable', error: 'branche introuvable', plan: null });
    expect(buildMemberPlans([row])).toBeNull();
  });

  it('List load fails: the row shows the real load error', () => {
    const row = buildRowView({ path: '/repos/a', service: 'svc-a' }, global, { status: 'error', local: [], remote: [], error: 'not a git repository' }, 'main');
    expect(row).toMatchObject({ baseStatus: 'error', error: 'échec du chargement des branches : not a git repository' });
  });

  it('a global or Perso target that already exists locally is a row error', () => {
    const global = buildRowView({ path: '/repos/a', service: 'svc-a' }, { base: '', name: 'feat/q' }, ready(['main', 'feat/q']), 'main');
    expect(global).toMatchObject({ targetError: 'branche déjà existante', plan: null });
    const perso = buildRowView(
      { path: '/repos/a', service: 'svc-a', override: { kind: 'create', base: 'main', name: 'feat/q' } },
      { base: '', name: 'x' },
      ready(['main', 'feat/q']),
      'main',
    );
    expect(perso).toMatchObject({ error: 'branche déjà existante', plan: null });
  });

  it('existing overrides are re-checked on the row: local protected even with a rename, shadowed remote, taken or no-op rename', () => {
    const view = (override: RowOverride, lists: BranchListState) => buildRowView({ path: '/repos/a', service: 'svc-a', override }, global, lists, 'main');
    expect(view({ kind: 'existing', branch: 'prod', renameTo: 'p2' }, ready(['prod'])).error).toBe('branche protégée (FR-7)');
    expect(view({ kind: 'existing', branch: 'origin/prod', renameTo: 'p2' }, ready([], ['origin/prod'])).error).toBeNull();
    expect(view({ kind: 'existing', branch: 'origin/x' }, ready(['x'], ['origin/x'])).error).toBe('branche locale du même nom déjà existante');
    expect(view({ kind: 'existing', branch: 'feat/z', renameTo: 'main2' }, ready(['feat/z', 'main2'])).error).toBe('branche déjà existante');
    expect(view({ kind: 'existing', branch: 'origin/w', renameTo: 'w' }, ready([], ['origin/w'])).error).toBe('renommage sans effet');
  });

  it('Protected: a global name equal to a shared branch is rejected on the target column', () => {
    const row = buildRowView({ path: '/repos/a', service: 'svc-a' }, { base: '', name: 'development' }, ready(['main']), 'main');
    expect(row).toMatchObject({ targetError: 'branche protégée (FR-7)', plan: null });
  });

  it('Perso: ignores Panel A entirely', () => {
    const override = { kind: 'create' as const, base: 'origin/dev', name: 'q' };
    const row = buildRowView({ path: '/repos/a', service: 'svc-a', override }, { base: 'nope', name: 'other' }, ready([]), 'main');
    expect(row).toMatchObject({ mode: 'perso', modeLabel: '[Créer (Perso)]', base: 'origin/dev', target: 'q', error: null });
    expect(row.plan).toBe(override);
  });

  it('Existing: [Existante] with its local name, the plan passed through as-is', () => {
    const override = { kind: 'existing' as const, branch: 'origin/feat/z' };
    const row = buildRowView({ path: '/repos/a', service: 'svc-a', override }, global, ready([], ['origin/feat/z']), 'main');
    expect(row).toMatchObject({ mode: 'existing', modeLabel: '[Existante]', base: 'origin/feat/z', target: 'feat/z' });
    expect(buildMemberPlans([row])).toEqual({ '/repos/a': override });
  });

  it('Rename: [Renommer], target "-> <new name>"', () => {
    const override = { kind: 'existing' as const, branch: 'origin/w', renameTo: 'w2' };
    const row = buildRowView({ path: '/repos/a', service: 'svc-a', override }, global, ready([], ['origin/w']), 'main');
    expect(row).toMatchObject({ mode: 'rename', modeLabel: '[Renommer]', target: '-> w2', error: null });
  });

  it('Existing protected without a rename is rejected', () => {
    const row = buildRowView({ path: '/repos/a', service: 'svc-a', override: { kind: 'existing', branch: 'prod' } }, global, ready(['prod']), 'main');
    expect(row).toMatchObject({ targetError: 'branche protégée (FR-7)', plan: null });
  });

  it('buildStep3Rows follows selection order and each service\'s own sharedBranch', () => {
    const current = validThroughStep3({ selectedMembers: ['/repos/b', '/repos/a'] });
    expect(buildStep3Rows(current, CANDIDATES).map((row) => `${row.service}:${row.base}`)).toEqual(['svc-b:development', 'svc-a:main']);
  });
});

describe('enterBranchStep (story 2.37)', () => {
  it('Name tracking: an untouched name follows the Step 1 slug on every entry', () => {
    const entered = enterBranchStep(branches({ globalName: { value: 'old', cursor: 3 } }), 'X Y', ['/repos/a']);
    expect(entered.globalName).toEqual({ value: 'x-y', cursor: 3 });
  });

  it('Name touched: an edited name is kept', () => {
    const entered = enterBranchStep(branches({ globalName: { value: 'feat/q', cursor: 6 }, globalNameTouched: true }), 'X Y', ['/repos/a']);
    expect(entered.globalName.value).toBe('feat/q');
  });

  it('queues unloaded and failed lists once, keeps loaded ones, resets focus to Panel A', () => {
    const entered = enterBranchStep(
      branches({
        panel: 'rows',
        editing: true,
        rowCursor: 5,
        lists: { '/repos/a': ready(['main']), '/repos/b': { status: 'error', local: [], remote: [] } },
      }),
      'demo',
      ['/repos/a', '/repos/b', '/repos/c'],
    );
    expect(entered.lists['/repos/a']).toEqual(ready(['main']));
    expect(entered.lists['/repos/b']?.status).toBe('pending');
    expect(entered.lists['/repos/c']?.status).toBe('pending');
    expect(entered).toMatchObject({ panel: 'global', globalLine: 'base', editing: false, rowCursor: 2, box: null });
  });
});

describe('Step 4 helpers (story 2.38)', () => {
  it('nonMemberReturns lists every non-member service with its own shared branch', () => {
    expect(nonMemberReturns(CANDIDATES, ['/repos/b'])).toEqual([
      { service: 'svc-a', sharedBranch: 'main' },
      { service: 'svc-c', sharedBranch: 'development' },
    ]);
    expect(nonMemberReturns(CANDIDATES, ['/repos/a', '/repos/b', '/repos/c'])).toEqual([]);
  });

  it('isActivationAcknowledge: a terminal outcome or failure rows on Step 4', () => {
    const base: CreateDialogState = { ...initialCreateDialog(), step: 4 };
    expect(isActivationAcknowledge(base)).toBe(false);
    expect(isActivationAcknowledge({ ...base, activation: { ...base.activation, outcome: 'stopped' } })).toBe(true);
    expect(isActivationAcknowledge({ ...base, failedRows: [{ service: 's', message: 'm' }] })).toBe(true);
    expect(isActivationAcknowledge({ ...base, step: 3, failedRows: [{ service: 's', message: 'm' }] })).toBe(false);
  });

  it('describeCreateForLog says how the activation ended', () => {
    expect(describeCreateForLog('feat', 2, 'activated')).toBe('Created EDT "feat" with 2 member(s) and activated it');
    expect(describeCreateForLog('feat', 1, 'stopped')).toContain('not activated (stopped');
    expect(describeCreateForLog('feat', 1, 'stay')).toContain('active EDT unchanged');
    expect(describeCreateForLog('feat', 1, 'switch')).toBe('Created EDT "feat" with 1 member(s) (switch requested)');
  });

  it('activateLaterHint names the :edt-switch command with the topic', () => {
    expect(activateLaterHint(' feat ')).toBe('Activez-le plus tard via :edt-switch feat');
  });

  it('activationErrorResults reads the per-repo rows from an error details, else null', () => {
    const results = [{ service: 's', outcome: 'switched' as const }];
    expect(activationErrorResults({ results })).toEqual(results);
    expect(activationErrorResults(undefined)).toBeNull();
    expect(activationErrorResults({ results: 'nope' })).toBeNull();
  });

  it('summarizeActivationResults keeps failures, discarded files and checkouts', () => {
    expect(
      summarizeActivationResults([
        { service: 'a', outcome: 'failed', detail: { code: 'x', message: 'boom' } },
        { service: 'b', outcome: 'discarded', detail: { code: 'discarded', message: '', discardedPaths: ['f.ts'] } },
        { service: 'c', outcome: 'switched' },
      ]),
    ).toEqual([
      { service: 'a', message: 'boom' },
      { service: 'b', message: 'fichiers écrasés (1) : f.ts — puis basculé sur sa branche cible' },
      { service: 'c', message: 'basculé sur sa branche cible' },
    ]);
  });
});
