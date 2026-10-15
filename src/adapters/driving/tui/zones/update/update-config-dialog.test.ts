// tui/zones/update: unit tests for the pre-run configuration screen's pure logic (draft
// construction, confirm gating).
import { describe, expect, it } from 'vitest';
import {
  confirmUpdateConfigDraft,
  createUpdateConfigDraft,
  type UpdateConfigDraft,
} from './update-config-dialog.logic.js';
import { setRow, toggleRowSelection } from './update-config-panels.logic.js';

const ROWS = [
  { service: 'svc-a', repoPath: '/repo/a', sourceBranch: 'development' },
  { service: 'svc-b', repoPath: '/repo/b', sourceBranch: 'development' },
];

function draft(): UpdateConfigDraft {
  return createUpdateConfigDraft('edt', ROWS);
}

describe('createUpdateConfigDraft', () => {
  it('pre-selects every targeted service with the sharedBranch default, migrate ON, clean restart OFF', () => {
    const created = draft();

    expect(created.scope).toBe('edt');
    expect(created.rows).toEqual([
      { service: 'svc-a', repoPath: '/repo/a', sourceBranch: 'development', sharedBranch: 'development', origin: 'shared', selected: true, migrationDeclared: true, recipeDeclared: true, migrations: 'follow', cleanRestart: 'follow' },
      { service: 'svc-b', repoPath: '/repo/b', sourceBranch: 'development', sharedBranch: 'development', origin: 'shared', selected: true, migrationDeclared: true, recipeDeclared: true, migrations: 'follow', cleanRestart: 'follow' },
    ]);
    expect(created.runMigrations).toBe(true);
    expect(created.cleanRestart).toBe(false);
    expect(created.error).toBeNull();
  });
});

describe('createUpdateConfigDraft with settings defaults', () => {
  it('seeds the run-wide globals from the defaults while rows keep following them', () => {
    const created = createUpdateConfigDraft('edt', ROWS, {
      defaults: { runMigrations: false, cleanRestart: true, mergeSource: 'shared' },
    });

    expect(created.runMigrations).toBe(false);
    expect(created.cleanRestart).toBe(true);
    expect(created.strategy).toEqual({ kind: 'shared' });
    expect(created.rows.every((row) => row.migrations === 'follow' && row.cleanRestart === 'follow')).toBe(true);
  });

  it('leaves a per-service exception untouched when the defaults change', () => {
    const seeded = createUpdateConfigDraft('edt', ROWS, { defaults: { runMigrations: false, cleanRestart: true, mergeSource: 'shared' } });
    const withException = setRow(seeded, 0, { ...seeded.rows[0]!, migrations: 'on' });
    expect(withException.rows[0]?.migrations).toBe('on');
    expect(withException.rows[1]?.migrations).toBe('follow');
  });

  it('opens a persisted edt-pending merge source only in the EDT layout', () => {
    const defaults = { runMigrations: true, cleanRestart: false, mergeSource: 'edt-pending' as const };
    const edt = createUpdateConfigDraft('edt', ROWS, { layout: 'edt-panels', defaults });
    expect(edt.strategy).toEqual({ kind: 'edt-pending' });
    expect(edt.rows.every((row) => row.sourceError === 'no-edt-chosen')).toBe(true);

    expect(createUpdateConfigDraft('all', ROWS, { layout: 'all-panels', defaults }).strategy).toEqual({ kind: 'shared' });
    expect(createUpdateConfigDraft('edt', ROWS, { defaults }).strategy).toEqual({ kind: 'shared' });
  });
});

describe('confirmUpdateConfigDraft', () => {
  it('confirms exactly the selected services with their branches plus the uniform toggles', () => {
    const deselected = toggleRowSelection(draft(), 1);

    const confirmed = confirmUpdateConfigDraft(deselected);

    expect(confirmed).toEqual({
      ok: true,
      config: {
        scope: 'edt',
        selection: [{ service: 'svc-a', repoPath: '/repo/a', sourceBranch: 'development' }],
        runMigrations: true,
        cleanRestart: false,
      },
    });
  });

  it('carries a confirmed branch override and flipped toggles through', () => {
    const base = draft();
    const created = {
      ...setRow(base, 0, { ...base.rows[0]!, sourceBranch: 'release/1', origin: 'manual' }),
      runMigrations: !base.runMigrations,
      cleanRestart: !base.cleanRestart,
    };

    const confirmed = confirmUpdateConfigDraft(created);

    expect(confirmed).toEqual({
      ok: true,
      config: {
        scope: 'edt',
        selection: [
          { service: 'svc-a', repoPath: '/repo/a', sourceBranch: 'release/1' },
          { service: 'svc-b', repoPath: '/repo/b', sourceBranch: 'development' },
        ],
        runMigrations: false,
        cleanRestart: true,
      },
    });
  });

  it('rejects zero selected with an explicit message', () => {
    const created = toggleRowSelection(toggleRowSelection(draft(), 0), 1);

    const confirmed = confirmUpdateConfigDraft(created);

    expect(confirmed.ok).toBe(false);
    if (!confirmed.ok) {
      expect(confirmed.error).toContain('No services selected');
    }
  });

  it('rejects a blank branch on any selected row with an explicit message', () => {
    for (const blank of ['', '   ']) {
      const created: UpdateConfigDraft = {
        ...draft(),
        rows: draft().rows.map((row) => (row.service === 'svc-a' ? { ...row, sourceBranch: blank } : row)),
      };

      const confirmed = confirmUpdateConfigDraft(created);

      expect(confirmed.ok).toBe(false);
      if (!confirmed.ok) {
        expect(confirmed.error).toContain('svc-a');
        expect(confirmed.error).toContain('empty source branch');
      }
    }
  });
});
