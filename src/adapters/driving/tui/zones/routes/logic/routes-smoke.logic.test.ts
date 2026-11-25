import { describe, it, expect } from 'vitest';
import {
  formatSmokeRow,
  formatSmokeSummary,
  mutatingFavoriteLabels,
  formatSmokeSummaryLines,
  resolveSmokeBodyRows,
  smokeWantedBodyRows,
  smokeBadge,
  smokeHeader,
  smokeRowRouteKey,
  summarizeSmokeRows,
  type SmokeTableRow,
} from './routes-smoke.logic.js';

const base = { repoPath: '/r', method: 'GET', path: '/a' };
const done = (outcome: SmokeTableRow['row'] & object): SmokeTableRow => ({ ...base, phase: 'done', row: outcome });

describe('routes-smoke.logic', () => {
  it('lists only non-stale mutating favorites', () => {
    expect(
      mutatingFavoriteLabels([
        { method: 'GET', path: '/a', stale: false },
        { method: 'POST', path: '/x', stale: false },
        { method: 'DELETE', path: '/gone', stale: true },
        { method: 'PATCH', path: '/p', stale: false },
      ]),
    ).toEqual(['POST /x', 'PATCH /p']);
  });

  it('gives every outcome and phase a distinct glyph', () => {
    const outcomes = ['ok', 'client-error', 'server-error', 'auth-error', 'network-error', 'skipped'] as const;
    const glyphs = outcomes.map((outcome) => smokeBadge(done({ ...base, outcome })).glyph);
    glyphs.push(smokeBadge({ ...base, phase: 'pending' }).glyph, smokeBadge({ ...base, phase: 'firing' }).glyph);
    expect(new Set(glyphs).size).toBe(8);
    expect(smokeBadge(done({ ...base, outcome: 'ok' })).color).not.toBe(smokeBadge(done({ ...base, outcome: 'server-error' })).color);
  });

  it('formats labels and metas', () => {
    expect(formatSmokeRow({ ...base, phase: 'pending' })).toEqual({ method: 'GET', label: '/a', meta: 'pending' });
    expect(formatSmokeRow({ ...base, phase: 'firing' }).meta).toBe('firing…');
    expect(formatSmokeRow(done({ ...base, outcome: 'ok', status: 200, durationMs: 12 })).meta).toBe('200 · 12ms');
    expect(formatSmokeRow(done({ ...base, outcome: 'skipped', reason: 'cancelled' })).meta).toBe('skipped (cancelled)');
    expect(formatSmokeRow(done({ ...base, outcome: 'skipped', reason: 'skipped (mutating)' })).meta).toBe('skipped (mutating)');
    expect(formatSmokeRow(done({ ...base, outcome: 'network-error', reason: 'boom' })).meta).toBe('network-error: boom');
  });

  it('counts all six outcomes, ignoring unfinished rows', () => {
    const rows: SmokeTableRow[] = [
      done({ ...base, outcome: 'ok' }),
      done({ ...base, outcome: 'ok' }),
      done({ ...base, outcome: 'skipped' }),
      { ...base, phase: 'firing' },
    ];
    const summary = summarizeSmokeRows(rows);
    expect(summary.ok).toBe(2);
    expect(formatSmokeSummary(summary)).toBe('ok 2 · client-error 0 · server-error 0 · auth-error 0 · network-error 0 · skipped 1');
    expect(smokeHeader(rows, true, null)).toBe('SMOKE RUN 3/4 — running');
    expect(smokeHeader(rows, false, null)).toContain('done');
    expect(smokeHeader([], false, 'x')).toContain('failed: x');
  });

  it('budgets the summary first and the table after', () => {
    expect(resolveSmokeBodyRows(5)).toEqual({ summary: 3, table: 2 });
    expect(resolveSmokeBodyRows(3)).toEqual({ summary: 1, table: 2 });
    expect(resolveSmokeBodyRows(9)).toEqual({ summary: 3, table: 6 });
    expect(smokeWantedBodyRows(1, 9)).toBe(4);
    expect(smokeWantedBodyRows(20, 9)).toBe(9);
    const sample = summarizeSmokeRows([]);
    expect(formatSmokeSummaryLines(sample, 3)).toEqual(['ok 0 · client-error 0', 'server-error 0 · auth-error 0', 'network-error 0 · skipped 0']);
    expect(formatSmokeSummaryLines(sample, 1)).toHaveLength(1);
    expect(resolveSmokeBodyRows(1)).toEqual({ summary: 1, table: 0 });
    expect(resolveSmokeBodyRows(0)).toEqual({ summary: 0, table: 0 });
    expect(smokeRowRouteKey({ method: 'get', path: '/a/{id}' })).toBe('GET /a/{id}');
  });
});
