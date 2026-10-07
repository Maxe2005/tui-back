// tui/zones/update: panels logic — effective values, strategy re-resolution, row exceptions,
// confirm gating, key routing and the height budget.
import { describe, expect, it } from 'vitest';
import {
  applyMergeStrategy,
  confirmUpdateConfigDraft,
  createUpdateConfigDraft,
  type MergeStrategy,
  type UpdateConfigDraft,
} from './update-config-dialog.logic.js';
import {
  CONFIG_MIN_ROWS,
  checkEdtChoice,
  commitEmptyBranch,
  computeConfigBudget,
  effectiveMigrations,
  effectiveRestart,
  globalLines,
  resetRowToGlobal,
  resolvePanelsKey,
  rowMode,
  setRow,
  toggleGlobalLine,
  toggleMergeSource,
  toggleRowSelection,
  type PanelsViewState,
} from './update-config-panels.logic.js';
import { createSuggestFieldState } from '../../shared/components/suggest-field.logic.js';

const ROWS = [
  { service: 'api', repoPath: '/r/api', sourceBranch: 'development' },
  { service: 'web', repoPath: '/r/web', sourceBranch: 'main', migrationDeclared: false, recipeDeclared: false },
];

const FROM_EDT: MergeStrategy = {
  kind: 'edt',
  ulid: 'U1',
  topic: 'sibling',
  resolved: [
    { service: 'api', repoPath: '/r/api', source: 'feat/x', origin: 'edt' },
    { service: 'web', repoPath: '/r/web', source: '', origin: 'edt', error: 'not-in-edt' },
  ],
};

const edtDraft = (): UpdateConfigDraft => createUpdateConfigDraft('edt', ROWS, { layout: 'edt-panels' });
const VIEW: PanelsViewState = { focus: 'panel', panelCursor: 0, tableCursor: 0, edtField: null };

describe('effective values', () => {
  it('never reports an undeclared action as enabled', () => {
    const draft = { ...edtDraft(), cleanRestart: true };
    const web = draft.rows[1]!;
    expect(effectiveMigrations(draft, web)).toBe('none');
    expect(effectiveRestart(draft, web)).toBe('no-recipe');
  });

  it('follows the global toggles for declared actions and honors overrides', () => {
    const draft = { ...edtDraft(), runMigrations: true, cleanRestart: false };
    const api = draft.rows[0]!;
    expect(effectiveMigrations(draft, api)).toBe('migrate');
    expect(effectiveRestart(draft, api)).toBe('basic');
    expect(effectiveMigrations(draft, { ...api, migrations: 'off' })).toBe('off');
    expect(effectiveRestart(draft, { ...api, cleanRestart: 'on' })).toBe('clean');
  });

  it('is perso as soon as the row departs from the global parameters', () => {
    const api = edtDraft().rows[0]!;
    expect(rowMode(api)).toBe('global');
    expect(rowMode({ ...api, migrations: 'off' })).toBe('custom');
    expect(rowMode({ ...api, origin: 'manual' })).toBe('custom');
  });
});

describe('global lines', () => {
  it('shows the EDT line only under From EDT, and no source lines for all-repos', () => {
    expect(globalLines(edtDraft())).toEqual(['source', 'migrations', 'cleanRestart', 'start']);
    expect(globalLines(toggleMergeSource(edtDraft()))).toEqual(['source', 'edt', 'migrations', 'cleanRestart', 'start']);
    expect(globalLines(createUpdateConfigDraft('all', ROWS, { layout: 'all-panels' }))).toEqual(['migrations', 'cleanRestart', 'start']);
    expect(globalLines(createUpdateConfigDraft('edt', ROWS.slice(0, 1)))).toEqual(['migrations', 'cleanRestart', 'start']);
  });
});

describe('merge source', () => {
  it('From EDT with nothing chosen blocks every row with an explicit reason', () => {
    const pending = toggleMergeSource(edtDraft());
    expect(pending.rows.map((row) => row.sourceError)).toEqual(['no-edt-chosen', 'no-edt-chosen']);
    expect(confirmUpdateConfigDraft(pending)).toMatchObject({ ok: false });
  });

  it('resolves rows from the chosen EDT and returns to shared branches clearing errors', () => {
    const resolved = applyMergeStrategy(edtDraft(), FROM_EDT);
    expect(resolved.rows[0]).toMatchObject({ sourceBranch: 'feat/x', origin: 'edt' });
    expect(resolved.rows[1]).toMatchObject({ sourceError: 'not-in-edt' });
    const back = toggleMergeSource(resolved);
    expect(back.rows.map((row) => [row.sourceBranch, row.sourceError])).toEqual([
      ['development', undefined],
      ['main', undefined],
    ]);
  });

  it('only selected unresolved rows block the run', () => {
    const resolved = applyMergeStrategy(edtDraft(), FROM_EDT);
    expect(confirmUpdateConfigDraft(resolved)).toMatchObject({ ok: false });
    expect(confirmUpdateConfigDraft(toggleRowSelection(resolved, 1))).toMatchObject({ ok: true });
  });
});

describe('row exceptions', () => {
  it('an empty branch rejoins global under Shared, and becomes perso on sharedBranch under From EDT', () => {
    const shared = edtDraft();
    const manual = { ...shared.rows[0]!, origin: 'manual' as const, sourceBranch: 'x' };
    expect(commitEmptyBranch(shared, manual)).toMatchObject({ origin: 'shared', sourceBranch: 'development' });
    const fromEdt = applyMergeStrategy(edtDraft(), FROM_EDT);
    expect(commitEmptyBranch(fromEdt, fromEdt.rows[1]!)).toMatchObject({ origin: 'manual', sourceBranch: 'main' });
    expect(commitEmptyBranch(fromEdt, fromEdt.rows[1]!).sourceError).toBeUndefined();
  });

  it('keeps a manual branch across a strategy change and Ctrl+R forgets every exception', () => {
    const start = edtDraft();
    const manual = setRow(start, 0, { ...start.rows[0]!, sourceBranch: 'release/2', origin: 'manual' });
    const withToggles = setRow(manual, 0, { ...manual.rows[0]!, migrations: 'off', cleanRestart: 'on' });
    const changed = toggleMergeSource(withToggles);
    expect(changed.rows[0]).toMatchObject({ sourceBranch: 'release/2', origin: 'manual' });
    expect(resetRowToGlobal(changed, 0).rows[0]).toMatchObject({ origin: 'edt', migrations: 'follow', cleanRestart: 'follow' });
  });

  it('puts per-row toggles in the confirmed selection only when they differ from follow', () => {
    const draft = setRow(edtDraft(), 0, { ...edtDraft().rows[0]!, migrations: 'off' });
    const confirmed = confirmUpdateConfigDraft(draft);
    expect(confirmed.ok && confirmed.config.selection).toEqual([
      { service: 'api', repoPath: '/r/api', sourceBranch: 'development', runMigrations: false },
      { service: 'web', repoPath: '/r/web', sourceBranch: 'main' },
    ]);
  });

  it('toggles global lines', () => {
    expect(toggleGlobalLine(edtDraft(), 'migrations').runMigrations).toBe(false);
    expect(toggleGlobalLine(edtDraft(), 'cleanRestart').cleanRestart).toBe(true);
  });
});

describe('resolvePanelsKey', () => {
  it('Tab switches focus and only Enter on the Start run line confirms (y, Ctrl+N and Enter elsewhere do not)', () => {
    expect(resolvePanelsKey('', { tab: true }, VIEW, edtDraft(), [])).toEqual({ type: 'switch-focus' });
    expect(resolvePanelsKey('', { return: true }, { ...VIEW, panelCursor: 3 }, edtDraft(), [])).toEqual({ type: 'confirm' });
    expect(resolvePanelsKey('n', { ctrl: true }, { ...VIEW, panelCursor: 3 }, edtDraft(), [])).toEqual({ type: 'ignore' });
    expect(resolvePanelsKey('n', { ctrl: true }, { ...VIEW, focus: 'table' }, edtDraft(), [])).toEqual({ type: 'ignore' });
    expect(resolvePanelsKey(' ', {}, { ...VIEW, panelCursor: 3 }, edtDraft(), [])).toEqual({ type: 'ignore' });
    expect(resolvePanelsKey('', { return: true }, { ...VIEW, panelCursor: 1 }, edtDraft(), [])).toEqual({ type: 'ignore' });
    expect(resolvePanelsKey('y', {}, VIEW, edtDraft(), [])).toEqual({ type: 'ignore' });
  });

  it('Home/End jump to the first and last line of the focused panel or table', () => {
    expect(resolvePanelsKey('', { end: true }, VIEW, edtDraft(), [])).toMatchObject({ type: 'move-panel', cursor: 3 });
    expect(resolvePanelsKey('', { home: true }, { ...VIEW, panelCursor: 3 }, edtDraft(), [])).toEqual({ type: 'move-panel', cursor: 0 });
    expect(resolvePanelsKey('', { end: true }, { ...VIEW, focus: 'table' }, edtDraft(), [])).toMatchObject({ type: 'move-table' });
  });

  it('Shift+Tab switches focus too, Ctrl+Tab does not', () => {
    expect(resolvePanelsKey('', { tab: true, shift: true }, VIEW, edtDraft(), [])).toEqual({ type: 'switch-focus' });
    expect(resolvePanelsKey('', { tab: true, ctrl: true }, VIEW, edtDraft(), [])).not.toEqual({ type: 'switch-focus' });
  });

  it('routes panel keys by line: source toggles, toggles flip, EDT line edits', () => {
    const fromEdt = toggleMergeSource(edtDraft());
    expect(resolvePanelsKey(' ', {}, VIEW, edtDraft(), [])).toEqual({ type: 'toggle-source' });
    expect(resolvePanelsKey('', { return: true }, { ...VIEW, panelCursor: 1 }, fromEdt, [])).toEqual({ type: 'edit-edt', initial: '' });
    expect(resolvePanelsKey('s', {}, { ...VIEW, panelCursor: 1 }, fromEdt, [])).toEqual({ type: 'edit-edt', initial: 's' });
    expect(resolvePanelsKey(' ', {}, { ...VIEW, panelCursor: 1 }, edtDraft(), [])).toEqual({ type: 'toggle-global', line: 'migrations' });
  });

  it('a `y` typed on the EDT line starts the filter instead of starting the run', () => {
    const fromEdt = toggleMergeSource(edtDraft());
    expect(resolvePanelsKey('y', {}, { ...VIEW, panelCursor: 1 }, fromEdt, [])).toEqual({ type: 'edit-edt', initial: 'y' });
  });

  it('routes table keys: space toggles, Enter opens the box, Ctrl+R resets only in the table', () => {
    const table = { ...VIEW, focus: 'table' as const };
    expect(resolvePanelsKey(' ', {}, table, edtDraft(), [])).toEqual({ type: 'toggle-row' });
    expect(resolvePanelsKey('', { return: true }, table, edtDraft(), [])).toEqual({ type: 'open-box' });
    expect(resolvePanelsKey('r', { ctrl: true }, table, edtDraft(), [])).toEqual({ type: 'reset-row' });
    expect(resolvePanelsKey('r', { ctrl: true }, VIEW, edtDraft(), [])).toEqual({ type: 'ignore' });
  });

  it('while the EDT field is open it owns the keys, y included', () => {
    const view = { ...VIEW, edtField: createSuggestFieldState('') };
    expect(resolvePanelsKey('y', {}, view, edtDraft(), ['sibling'])).toMatchObject({ type: 'edt-edit' });
    expect(resolvePanelsKey('', { escape: true }, view, edtDraft(), ['sibling'])).toEqual({ type: 'edt-cancel' });
  });
});

describe('checkEdtChoice', () => {
  const edts = [{ ulid: 'U1', topic: 'sibling' }];
  it('maps empty, known and unknown topics', () => {
    expect(checkEdtChoice('', edts)).toEqual({ type: 'none' });
    expect(checkEdtChoice('sibling', edts)).toEqual({ type: 'chosen', ulid: 'U1' });
    expect(checkEdtChoice('nope', edts)).toMatchObject({ type: 'invalid' });
  });
});

describe('computeConfigBudget', () => {
  it('flags terminals below the minimum and keeps the table within the remaining rows', () => {
    const draft = edtDraft();
    expect(computeConfigBudget(CONFIG_MIN_ROWS - 1, draft, false, 5).tooSmall).toBe(true);
    const roomy = computeConfigBudget(40, draft, false, 5);
    expect(roomy.tooSmall).toBe(false);
    expect(roomy.tableRows).toBeGreaterThan(10);
  });

  it('lets a one-service screen use a 20-row terminal and flags 19', () => {
    const draft = createUpdateConfigDraft('edt', ROWS.slice(0, 1), { layout: 'service-panels' });
    const fits = computeConfigBudget(20, draft, false, 5);
    expect(fits.tooSmall).toBe(false);
    expect(fits.tableRows).toBe(1);
    expect(computeConfigBudget(19, draft, false, 5).tooSmall).toBe(true);
  });

  it('gives the open EDT list lines taken from the table, never more than the setting', () => {
    const draft = toggleMergeSource(edtDraft());
    const closed = computeConfigBudget(30, draft, false, 5);
    const open = computeConfigBudget(30, draft, true, 5);
    expect(open.dropdownLines).toBeLessThanOrEqual(5);
    expect(open.tableRows + open.dropdownLines).toBe(closed.tableRows);
  });
});
