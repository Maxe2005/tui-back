import { describe, expect, it } from 'vitest';
import { describeFastForwardRow, describeFastForwardSummary } from './fast-forward-dialog.js';

const row = (outcome: 'fast-forwarded' | 'up-to-date' | 'skipped' | 'failed', extra = {}) => ({
  service: 'api',
  repoPath: '/r/api',
  branch: 'development',
  outcome,
  ...extra,
});

describe('fast-forward dialog text', () => {
  it('pairs a glyph with a text label for every outcome', () => {
    expect(describeFastForwardRow(row('fast-forwarded'))).toBe('✔ api — fast-forwarded (development)');
    expect(describeFastForwardRow(row('up-to-date'))).toBe('= api — up to date (development)');
    expect(describeFastForwardRow(row('skipped', { reason: 'diverged' }))).toBe('– api — skipped (diverged)');
    expect(describeFastForwardRow(row('failed', { detail: 'offline\nmore' }))).toBe('✖ api — failed: offline');
  });

  it('summarises non-zero counts only', () => {
    expect(describeFastForwardSummary([row('fast-forwarded'), row('fast-forwarded'), row('failed')])).toBe('2 fast-forwarded · 1 failed');
    expect(describeFastForwardSummary([])).toBe('no shared branch to fast-forward');
  });
});
