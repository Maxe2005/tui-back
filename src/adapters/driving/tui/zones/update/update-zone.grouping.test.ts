import { describe, expect, it } from 'vitest';
import {
  buildUpdateListEntries,
  entryIndexOfRow,
  formatLastUpdateRecap,
  UPDATE_MEMBERS_HEADER,
  UPDATE_OTHERS_HEADER,
  type UpdateServiceRow,
} from './update-zone.logic.js';

function row(service: string, isMember: boolean): UpdateServiceRow {
  return { service, path: `/r/${service}`, branch: 'main', isMember } as unknown as UpdateServiceRow;
}

describe('buildUpdateListEntries', () => {
  it('emits a header per non-empty group with members first', () => {
    const entries = buildUpdateListEntries([row('a', true), row('b', true), row('c', false)]);
    expect(entries.map((e) => (e.kind === 'header' ? e.label : e.row.service))).toEqual([
      UPDATE_MEMBERS_HEADER,
      'a',
      'b',
      UPDATE_OTHERS_HEADER,
      'c',
    ]);
  });

  it('omits the header of an empty group', () => {
    expect(buildUpdateListEntries([row('c', false)]).map((e) => e.kind)).toEqual(['header', 'row']);
    expect(buildUpdateListEntries([])).toEqual([]);
  });

  it('maps a row index to its entry index past the headers', () => {
    const entries = buildUpdateListEntries([row('a', true), row('c', false)]);
    expect(entryIndexOfRow(entries, 0)).toBe(1);
    expect(entryIndexOfRow(entries, 1)).toBe(3);
    expect(entryIndexOfRow(entries, 5)).toBeUndefined();
  });
});

describe('formatLastUpdateRecap', () => {
  it('is null before any run finished', () => {
    expect(formatLastUpdateRecap(null, [], null, {})).toBeNull();
  });

  it('names the context and renders source → target per service', () => {
    const recap = formatLastUpdateRecap(
      'feat-x',
      [
        { service: 'api', outcome: 'updated' },
        { service: 'web', outcome: 'failed', detail: { code: 'migration-failed', message: 'boom' } },
      ],
      [{ service: 'api', sourceBranch: 'develop' }],
      { api: 'feat-x', web: null },
    );
    expect(recap?.title).toBe('Last update — EDT "feat-x"');
    expect(recap?.resultLines).toEqual([
      '✔ api  develop → feat-x  updated',
      '✖ web  shared branch → ?  failed (migration-failed)',
    ]);
  });

  it('titles an all-repos run', () => {
    expect(formatLastUpdateRecap('all-repos', [], null, {})?.title).toBe('Last update — all repos');
  });
});
