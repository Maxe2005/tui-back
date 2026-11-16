import { describe, expect, it } from 'vitest';
import type { RestartRow } from '../../../../../../core/edt/switch-restart.js';
import { renderToString } from '../../../shared/components/render-to-string.js';
import { describeRestartRow, describeRestartSummary, RESTART_PHASE_BADGES, SwitchRestartReport } from './switch-restart-report.js';

const row = (phase: RestartRow['phase'], extra: Partial<RestartRow> = {}): RestartRow => ({ service: `s-${phase}`, repoPath: `/r/${phase}`, phase, ...extra });

describe('switch restart report', () => {
  it('pairs every phase with a distinct glyph (never colour alone) and a label', () => {
    const glyphs = Object.entries(RESTART_PHASE_BADGES).map(([, badge]) => badge.glyph);
    // `down` and `restarting` reuse the Update zone's glyphs; no two phases share a glyph.
    expect(new Set(glyphs).size).toBe(glyphs.length);
    expect(Object.values(RESTART_PHASE_BADGES).every((badge) => badge.label !== '')).toBe(true);
  });

  it('describes rows with reason and detail', () => {
    expect(describeRestartRow(row('unhealthy', { detail: 'HTTP 503' }))).toBe('⚠ s-unhealthy — unhealthy: HTTP 503');
    expect(describeRestartRow(row('skipped', { skipReason: 'no container' }))).toBe('– s-skipped — skipped (no container)');
    expect(describeRestartRow(row('functional'))).toBe('✔ s-functional — functional');
  });

  it('summarises counts without zero entries', () => {
    expect(describeRestartSummary([row('functional'), row('functional', { repoPath: '/x' }), row('down'), row('skipped')])).toBe(
      '2 functional · 1 down · 1 skipped',
    );
    expect(describeRestartSummary([])).toBe('nothing to restart');
  });

  it('renders live rows in run order while running', async () => {
    const output = await renderToString(
      <SwitchRestartReport
        chromeRows={10}
        state={{ topic: 't', mode: 'simple', status: 'running', error: null, report: null, rows: [row('restarting'), row('pending'), row('verifying')] }}
      />,
    );
    expect(output).toContain('Restarting services (simple)');
    expect(output.indexOf('s-restarting')).toBeLessThan(output.indexOf('s-pending'));
    expect(output).toContain('↻');
  });

  it('lists non-green services first once done, with the summary', async () => {
    const output = await renderToString(
      <SwitchRestartReport
        chromeRows={10}
        state={{
          topic: 't',
          mode: 'clean',
          status: 'done',
          error: null,
          report: null,
          rows: [row('functional'), row('skipped', { skipReason: 'unchanged' }), row('failed', { detail: 'boom' }), row('unhealthy', { detail: 'HTTP 503' })],
        }}
      />,
    );
    expect(output).toContain('Restart clean finished: 1 functional · 1 unhealthy · 1 failed · 1 skipped');
    expect(output.indexOf('s-failed')).toBeLessThan(output.indexOf('s-unhealthy'));
    expect(output.indexOf('s-unhealthy')).toBeLessThan(output.indexOf('s-functional'));
    expect(output.indexOf('s-functional')).toBeLessThan(output.indexOf('s-skipped'));
    expect(output).toContain('boom');
  });

  it('bounds a long report by the row budget', async () => {
    const rows = Array.from({ length: 40 }, (_, i) => row('functional', { service: `svc-${i}`, repoPath: `/r/${i}` }));
    const output = await renderToString(
      <SwitchRestartReport chromeRows={30} state={{ topic: 't', mode: 'simple', status: 'done', error: null, report: null, rows }} />,
    );
    expect(output).not.toContain('svc-39');
  });
});
