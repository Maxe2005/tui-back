import { describe, it, expect } from 'vitest';
import type { EdtRegistryEntry } from '../../../../../../../core/ports/edt-registry.js';
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
  missingSeedMembers,
  pruneToCandidates,
  refreshSeededNames,
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
  // Story 2.42: manifest fixtures — svc-a's manifest lists its protected branches, the others
  // declare none (only their sharedBranch is protected).
  { path: '/repos/a', service: 'svc-a', sharedBranch: 'main', protectedBranches: ['development', 'preprod', 'prod'] },
  { path: '/repos/b', service: 'svc-b', sharedBranch: 'development', protectedBranches: [] },
  { path: '/repos/c', service: 'svc-c', sharedBranch: 'development', protectedBranches: [] },
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
      error: 'svc-a : « prod » est protégée par le manifeste du service',
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
  it('protects the service\'s manifest protectedBranches and its own sharedBranch (FR-7, story 2.42)', () => {
    const protection = { sharedBranch: 'main', protectedBranches: ['preprod'] };
    expect(isProtectedTarget(' preprod ', protection)).toBe(true);
    expect(isProtectedTarget(' main ', protection)).toBe(true);
    expect(isProtectedTarget('feat/q', protection)).toBe(false);
  });

  it('protects nothing implicitly: development/preprod/prod are free unless the manifest lists them (story 2.42)', () => {
    const protection = { sharedBranch: 'main' };
    expect(isProtectedTarget('development', protection)).toBe(false);
    expect(isProtectedTarget('prod', protection)).toBe(false);
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
  // Story 2.42: svc-a's manifest fixture — its protected set is protectedBranches ∪ {main}.
  const PROTECTION = { sharedBranch: 'main', protectedBranches: ['development', 'preprod', 'prod'] };

  it('Default: [Créer (Global)] main -> auth-flow, plan {create, main, auth-flow}', () => {
    const row = buildRowView({ path: '/repos/a', service: 'svc-a' }, global, ready(['main']), PROTECTION);
    expect(row).toMatchObject({ mode: 'global', modeLabel: '[Créer (Global)]', base: 'main', target: 'auth-flow', error: null });
    expect(buildMemberPlans([row])).toEqual({ '/repos/a': { kind: 'create', base: 'main', name: 'auth-flow' } });
  });

  it('Not found: the base column carries the error and no plan is built', () => {
    const row = buildRowView({ path: '/repos/a', service: 'svc-a' }, { base: 'nope', name: 'auth-flow' }, ready(['main']), PROTECTION);
    expect(row).toMatchObject({ baseStatus: 'error', base: 'branche introuvable', error: 'branche introuvable', plan: null });
    expect(buildMemberPlans([row])).toBeNull();
  });

  it('List load fails: the row shows the real load error', () => {
    const row = buildRowView({ path: '/repos/a', service: 'svc-a' }, global, { status: 'error', local: [], remote: [], error: 'not a git repository' }, PROTECTION);
    expect(row).toMatchObject({ baseStatus: 'error', error: 'échec du chargement des branches : not a git repository' });
  });

  it('a global or Perso target that already exists locally is a row error', () => {
    const global = buildRowView({ path: '/repos/a', service: 'svc-a' }, { base: '', name: 'feat/q' }, ready(['main', 'feat/q']), PROTECTION);
    expect(global).toMatchObject({ targetError: 'branche déjà existante', plan: null });
    const perso = buildRowView(
      { path: '/repos/a', service: 'svc-a', override: { kind: 'create', base: 'main', name: 'feat/q' } },
      { base: '', name: 'x' },
      ready(['main', 'feat/q']),
      PROTECTION,
    );
    expect(perso).toMatchObject({ error: 'branche déjà existante', plan: null });
  });

  it('existing overrides are re-checked on the row: local protected even with a rename, shadowed remote, taken or no-op rename', () => {
    const view = (override: RowOverride, lists: BranchListState) => buildRowView({ path: '/repos/a', service: 'svc-a', override }, global, lists, PROTECTION);
    expect(view({ kind: 'existing', branch: 'prod', renameTo: 'p2' }, ready(['prod'])).error).toBe('« prod » est protégée par le manifeste du service');
    expect(view({ kind: 'existing', branch: 'origin/prod', renameTo: 'p2' }, ready([], ['origin/prod'])).error).toBeNull();
    expect(view({ kind: 'existing', branch: 'origin/x' }, ready(['x'], ['origin/x'])).error).toBe('branche locale du même nom déjà existante');
    expect(view({ kind: 'existing', branch: 'feat/z', renameTo: 'main2' }, ready(['feat/z', 'main2'])).error).toBe('branche déjà existante');
    expect(view({ kind: 'existing', branch: 'origin/w', renameTo: 'w' }, ready([], ['origin/w'])).error).toBe('renommage sans effet');
  });

  it('Protected: a global name equal to a shared branch is rejected on the target column', () => {
    const row = buildRowView({ path: '/repos/a', service: 'svc-a' }, { base: '', name: 'development' }, ready(['main']), PROTECTION);
    expect(row).toMatchObject({ targetError: '« development » est protégée par le manifeste du service', plan: null });
  });

  it('Wizard row: a target the service\'s manifest lists is blocked; one it does not list is allowed (story 2.42)', () => {
    const listed = buildRowView({ path: '/repos/a', service: 'svc-a' }, { base: '', name: 'preprod' }, ready(['main']), PROTECTION);
    expect(listed).toMatchObject({ targetError: '« preprod » est protégée par le manifeste du service', plan: null });
    const unlisted = buildRowView({ path: '/repos/b', service: 'svc-b' }, { base: '', name: 'preprod' }, ready(['development']), { sharedBranch: 'development' });
    expect(unlisted).toMatchObject({ targetError: null, plan: { kind: 'create', base: 'development', name: 'preprod' } });
  });

  it('Perso: ignores Panel A entirely', () => {
    const override = { kind: 'create' as const, base: 'origin/dev', name: 'q' };
    const row = buildRowView({ path: '/repos/a', service: 'svc-a', override }, { base: 'nope', name: 'other' }, ready([]), PROTECTION);
    expect(row).toMatchObject({ mode: 'perso', modeLabel: '[Créer (Perso)]', base: 'origin/dev', target: 'q', error: null });
    expect(row.plan).toBe(override);
  });

  it('Existing: [Existante] with its local name, the plan passed through as-is', () => {
    const override = { kind: 'existing' as const, branch: 'origin/feat/z' };
    const row = buildRowView({ path: '/repos/a', service: 'svc-a', override }, global, ready([], ['origin/feat/z']), PROTECTION);
    expect(row).toMatchObject({ mode: 'existing', modeLabel: '[Existante]', base: 'origin/feat/z', target: 'feat/z' });
    expect(buildMemberPlans([row])).toEqual({ '/repos/a': override });
  });

  it('Rename: [Renommer], target "-> <new name>"', () => {
    const override = { kind: 'existing' as const, branch: 'origin/w', renameTo: 'w2' };
    const row = buildRowView({ path: '/repos/a', service: 'svc-a', override }, global, ready([], ['origin/w']), PROTECTION);
    expect(row).toMatchObject({ mode: 'rename', modeLabel: '[Renommer]', target: '-> w2', error: null });
  });

  it('Existing protected without a rename is rejected', () => {
    const row = buildRowView({ path: '/repos/a', service: 'svc-a', override: { kind: 'existing', branch: 'prod' } }, global, ready(['prod']), PROTECTION);
    expect(row).toMatchObject({ targetError: '« prod » est protégée par le manifeste du service', plan: null });
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

describe('edt-create-from seeding (story 2.31)', () => {
  const ROOT: EdtRegistryEntry = {
    ulid: 'root-ulid',
    topic: 'feat-a',
    createdAt: '2026-01-01T00:00:00.000Z',
    status: 'inactive',
    members: [
      { service: 'svc-b', repoPath: '/repos/b', branch: 'feat/a' },
      { service: 'svc-a', repoPath: '/repos/a', branch: 'feat/a-api' },
      { service: 'svc-gone', repoPath: '/repos/gone', branch: 'feat/x' },
    ],
  };

  it('initialCreateDialog(seed) pre-checks the root members in root order, topic empty', () => {
    const dialog = initialCreateDialog(ROOT);
    expect(dialog.selectedMembers).toEqual(['/repos/b', '/repos/a', '/repos/gone']);
    expect(dialog.topic).toBe('');
    expect(dialog.seedFromEdt).toBe(ROOT);
    expect(initialCreateDialog().seedFromEdt).toBeNull();
  });

  it('Inherited row: each selected root member is seeded [Créer (Perso)] on its root branch, named after the slug', () => {
    const entered = enterBranchStep(branches(), 'New Topic', ['/repos/b', '/repos/a', '/repos/c'], ROOT);
    expect(entered.overrides).toEqual({
      '/repos/b': { kind: 'create', base: 'feat/a', name: 'new-topic' },
      '/repos/a': { kind: 'create', base: 'feat/a-api', name: 'new-topic' },
    });
    expect(entered.seededPaths).toEqual(['/repos/b', '/repos/a']);
  });

  it('Added service: a non-root member gets no override (follows the global rule)', () => {
    const entered = enterBranchStep(branches(), 'New Topic', ['/repos/c'], ROOT);
    expect(entered.overrides['/repos/c']).toBeUndefined();
  });

  it('Unchecked root member: not seeded, no row', () => {
    const entered = enterBranchStep(branches(), 'New Topic', ['/repos/a'], ROOT);
    expect(Object.keys(entered.overrides)).toEqual(['/repos/a']);
    expect(entered.seededPaths).toEqual(['/repos/a']);
  });

  it('Topic changed: an untouched seeded row follows the new slug, an edited one is kept', () => {
    const first = enterBranchStep(branches(), 'One', ['/repos/b', '/repos/a'], ROOT);
    const edited = { ...first, overrides: { ...first.overrides, '/repos/a': { kind: 'create' as const, base: 'feat/a-api', name: 'mine' } } };
    const second = enterBranchStep(edited, 'Two', ['/repos/b', '/repos/a'], ROOT);
    expect(second.overrides['/repos/b']).toEqual({ kind: 'create', base: 'feat/a', name: 'two' });
    expect(second.overrides['/repos/a']).toEqual({ kind: 'create', base: 'feat/a-api', name: 'mine' });
  });

  it('A seeded row whose base was edited is not refreshed', () => {
    const first = enterBranchStep(branches(), 'One', ['/repos/b'], ROOT);
    const edited = { ...first, overrides: { '/repos/b': { kind: 'create' as const, base: 'main', name: 'one' } } };
    const second = enterBranchStep(edited, 'Two', ['/repos/b'], ROOT);
    expect(second.overrides['/repos/b']).toEqual({ kind: 'create', base: 'main', name: 'one' });
  });

  it('Reset to global: a seeded path is never reseeded', () => {
    const first = enterBranchStep(branches(), 'One', ['/repos/b', '/repos/a'], ROOT);
    const { ['/repos/b']: _dropped, ...rest } = first.overrides;
    const second = enterBranchStep({ ...first, overrides: rest }, 'One', ['/repos/b', '/repos/a'], ROOT);
    expect(second.overrides['/repos/b']).toBeUndefined();
  });

  it('A root member checked only later is seeded on that later entry', () => {
    const first = enterBranchStep(branches(), 'One', ['/repos/b'], ROOT);
    const second = enterBranchStep(first, 'One', ['/repos/b', '/repos/a'], ROOT);
    expect(second.overrides['/repos/a']).toEqual({ kind: 'create', base: 'feat/a-api', name: 'one' });
  });

  it('A touched global name seeds rows with that name', () => {
    const entered = enterBranchStep(branches({ globalName: { value: 'feat/q', cursor: 6 }, globalNameTouched: true }), 'X', ['/repos/b'], ROOT);
    expect(entered.overrides['/repos/b']).toEqual({ kind: 'create', base: 'feat/a', name: 'feat/q' });
  });

  it('No seed: overrides and seededPaths are untouched', () => {
    const entered = enterBranchStep(branches(), 'One', ['/repos/b'], null);
    expect(entered.overrides).toEqual({});
    expect(entered.seededPaths).toEqual([]);
  });

  it('Inherited rows render [Créer (Perso)] on the root base; added ones [Créer (Global)]', () => {
    const base = initialCreateDialog(ROOT);
    const state: CreateDialogState = {
      ...base,
      topic: 'New',
      selectedMembers: ['/repos/b', '/repos/c'],
      branches: {
        ...enterBranchStep(base.branches, 'New', ['/repos/b', '/repos/c'], ROOT),
        lists: { '/repos/b': ready(['development', 'feat/a']), '/repos/c': ready(['development']) },
      },
    };
    const rows = buildStep3Rows(state, CANDIDATES);
    expect(rows.map((row) => [row.modeLabel, row.base, row.target])).toEqual([
      ['[Créer (Perso)]', 'feat/a', 'new'],
      ['[Créer (Global)]', 'development', 'new'],
    ]);
    expect(buildMemberPlans(rows)).toEqual({
      '/repos/b': { kind: 'create', base: 'feat/a', name: 'new' },
      '/repos/c': { kind: 'create', base: 'development', name: 'new' },
    });
  });

  it('Root member gone: named by missingSeedMembers, pruned by pruneToCandidates (non-empty pool only)', () => {
    expect(missingSeedMembers(ROOT, CANDIDATES)).toEqual(['svc-gone']);
    expect(missingSeedMembers(null, CANDIDATES)).toEqual([]);
    expect(pruneToCandidates(['/repos/b', '/repos/gone', '/repos/a'], CANDIDATES)).toEqual(['/repos/b', '/repos/a']);
    expect(pruneToCandidates(['/repos/gone'], [])).toEqual(['/repos/gone']);
  });

  it('missingSeedMembers lists nothing on an empty pool (same rule as the prune)', () => {
    expect(missingSeedMembers(ROOT, [])).toEqual([]);
  });

  it('All root members gone: Step 2 is blocked with NO_SERVICE_ERROR', () => {
    const state: CreateDialogState = { ...initialCreateDialog(ROOT), selectedMembers: ['/repos/gone'] };
    expect(canAdvance(2, state, EDTS, CANDIDATES)).toEqual({ ok: false, error: NO_SERVICE_ERROR });
    // An empty (not yet loaded) pool prunes nothing.
    expect(canAdvance(2, state, EDTS, [])).toEqual({ ok: true });
  });

  it('Partly gone: Step 2 passes and its breadcrumb counts only the real services', () => {
    const state: CreateDialogState = { ...initialCreateDialog(ROOT), topic: 'x', step: 3 };
    expect(canAdvance(2, state, EDTS, CANDIDATES)).toEqual({ ok: true });
    expect(stepSummary(2, state, CANDIDATES)).toBe('2. Services (2)');
    expect(buildBreadcrumb(state, EDTS, CANDIDATES)[1]?.text).toBe('2. Services (2)');
  });

  it('refreshSeededNames moves only untouched seeded rows, returns the same object when nothing moves', () => {
    const overrides = {
      '/repos/b': { kind: 'create' as const, base: 'feat/a', name: 'old' },
      '/repos/a': { kind: 'create' as const, base: 'other', name: 'old' },
      '/repos/c': { kind: 'create' as const, base: 'x', name: 'old' },
    };
    const next = refreshSeededNames(overrides, ['/repos/b', '/repos/a'], ROOT, 'old', 'new');
    expect(next['/repos/b']).toEqual({ kind: 'create', base: 'feat/a', name: 'new' });
    expect(next['/repos/a']).toEqual({ kind: 'create', base: 'other', name: 'old' });
    expect(next['/repos/c']).toEqual({ kind: 'create', base: 'x', name: 'old' });
    expect(refreshSeededNames(overrides, [], ROOT, 'old', 'new')).toBe(overrides);
    expect(refreshSeededNames(overrides, ['/repos/b'], null, 'old', 'new')).toBe(overrides);
  });

  it('describeCreateForLog names the root EDT', () => {
    expect(describeCreateForLog('x', 2, 'stay', 'root')).toBe('Created EDT "x" from "root" with 2 member(s) — active EDT unchanged');
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
