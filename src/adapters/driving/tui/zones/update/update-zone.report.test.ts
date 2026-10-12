// Pure logic of the full-screen service report.
import { describe, expect, it } from 'vitest';
import type { GroupUpdateRepoResult } from '../../../../../core/scripts/group-update.js';
import {
  applyReportScroll,
  buildServiceReport,
  buildServiceStepViews,
  formatReportPosition,
  jumpToFailedStep,
  reportMaxOffset,
  reportWindow,
  resolveReportKey,
  splitReportText,
  type ServiceReportInput,
} from './update-zone.logic.js';

const LONG_ERROR = `merge failed\n${'conflict in file\n'.repeat(40)}end`;
const FAILED: GroupUpdateRepoResult = {
  service: 'svc',
  outcome: 'failed',
  detail: { code: 'migration-failed', message: LONG_ERROR },
  run: { merge: { kind: 'up-to-date' }, migrations: { kind: 'ran', command: 'npm run m', outputExcerpt: 'line1\nline2\nline3' } },
} as never;

const base: ServiceReportInput = {
  service: 'svc',
  mode: 'last',
  context: 'development → feat/a',
  steps: { merge: 'done', migration: 'failed', restart: 'skipped' },
  result: FAILED,
  issues: [],
};

describe('buildServiceStepViews full fidelity', () => {
  it('keeps newlines in the failure message and migration output only when full', () => {
    const flat = buildServiceStepViews(base.steps!, FAILED);
    expect(flat.flatMap((view) => view.detail).some((detail) => detail.includes('\n'))).toBe(false);
    const full = buildServiceStepViews(base.steps!, FAILED, { full: true });
    expect(full[1]?.detail.some((detail) => detail.includes('\n'))).toBe(true);
    const ran = { merge: 'done', migration: 'done', restart: 'done' } as const;
    expect(buildServiceStepViews(ran, FAILED)[1]?.detail.join('|')).toContain('↵');
    expect(buildServiceStepViews(ran, FAILED, { full: true })[1]?.detail.join('|')).toContain('line1\nline2');
  });
});

describe('buildServiceReport', () => {
  it('lists the context, every step with unflattened error output and the failed step index', () => {
    const report = buildServiceReport(base);
    const texts = report.lines.map((line) => line.text);
    expect(texts[0]).toBe('svc  · last update');
    expect(texts).toContain('development → feat/a');
    expect(texts.filter((text) => text.includes('conflict in file')).length).toBe(40);
    expect(report.failedLines).toHaveLength(1);
    expect(report.lines[report.failedLines[0] as number]).toMatchObject({ kind: 'step-failed' });
    expect(report.lines[report.failedLines[0] as number]?.text).toContain('✖');
  });

  it('prints a finished migration output on separate lines', () => {
    const report = buildServiceReport({ ...base, steps: { merge: 'done', migration: 'done', restart: 'done' }, result: { ...FAILED, outcome: 'updated', detail: undefined } as never });
    const texts = report.lines.map((line) => line.text);
    expect(texts).toContain('   line1');
    expect(texts).toContain('   line3');
  });

  it('prints every issue in full, resolved or not, uncapped', () => {
    const issues = Array.from({ length: 300 }, (_, i) => ({ kind: 'merge-conflict' as const, detail: `issue ${i}\nsecond line ${i}`, resolved: i % 2 === 0 }));
    const report = buildServiceReport({ ...base, issues });
    const texts = report.lines.map((line) => line.text);
    expect(texts).toContain('Issues (300)');
    expect(texts.some((text) => text.includes('issue 0 '.trim()) && text.includes('resolved'))).toBe(true);
    expect(texts).toContain('    second line 299');
  });

  it('reads as never-ran with no run and no issues, and has no failed step', () => {
    const report = buildServiceReport({ ...base, mode: 'never', steps: undefined, result: undefined, context: null });
    expect(report.failedLines).toEqual([]);
    expect(report.lines.at(-1)?.text).toBe('No update has run for this service yet.');
  });

  it('shows only the issue log, no pending steps, when there is no run but there are issues', () => {
    const report = buildServiceReport({ ...base, mode: 'never', steps: undefined, result: undefined, context: null, issues: [{ kind: 'merge-conflict', detail: 'boom', resolved: false }] });
    const texts = report.lines.map((line) => line.text);
    expect(texts.some((text) => text.includes('waiting'))).toBe(false);
    expect(texts).toContain('Issues (1)');
    expect(report.failedLines).toEqual([]);
  });

  it('shows live steps as in progress', () => {
    const report = buildServiceReport({ ...base, mode: 'live', steps: { merge: 'running', migration: 'pending', restart: 'pending' }, result: undefined, context: null });
    expect(report.lines[0]?.text).toContain('UPDATE IN PROGRESS');
    expect(report.lines.some((line) => line.text.includes('Merge — in progress'))).toBe(true);
  });
});

describe('report windowing and scrolling', () => {
  const report = buildServiceReport(base);
  const lines = report.lines;

  it('windows by row budget from the top and clamps the offset to the tail', () => {
    const max = reportMaxOffset(lines, 10, 60, true);
    expect(max).toBe(lines.length - 10);
    expect(reportWindow(lines, 0, 10, 60, true).visibleLines).toHaveLength(10);
    expect(reportWindow(lines, 9999, 10, 60, true).start).toBe(max);
  });

  it('spends more of the budget on wrapped lines than truncated ones', () => {
    const long = [{ kind: 'detail' as const, text: 'x'.repeat(100) }, ...lines];
    expect(reportWindow(long, 0, 10, 20, true).visibleLines.length).toBeLessThan(reportWindow(long, 0, 10, 20, false).visibleLines.length);
  });

  it('applies up/down/page/home/end within bounds', () => {
    expect(applyReportScroll(0, 'up', 30, 10)).toBe(0);
    expect(applyReportScroll(0, 'down', 30, 10)).toBe(1);
    expect(applyReportScroll(0, 'page-down', 30, 10)).toBe(9);
    expect(applyReportScroll(25, 'page-down', 30, 10)).toBe(30);
    expect(applyReportScroll(5, 'page-up', 30, 10)).toBe(0);
    expect(applyReportScroll(5, 'bottom', 30, 10)).toBe(30);
    expect(applyReportScroll(5, 'top', 30, 10)).toBe(0);
  });

  it('formats the position indicator', () => {
    expect(formatReportPosition(0, 10, 40)).toBe('lines 1–10 of 40 (25%)');
    expect(formatReportPosition(0, 0, 0)).toBe('empty');
  });
});

describe('jumpToFailedStep', () => {
  it('jumps forward and backward, wrapping around', () => {
    expect(jumpToFailedStep([5, 20], 0, 'next')).toBe(5);
    expect(jumpToFailedStep([5, 20], 5, 'next')).toBe(20);
    expect(jumpToFailedStep([5, 20], 20, 'next')).toBe(5);
    expect(jumpToFailedStep([5, 20], 5, 'prev')).toBe(20);
    expect(jumpToFailedStep([5, 20], 20, 'prev')).toBe(5);
  });
  it('is a no-op without a failed step', () => {
    expect(jumpToFailedStep([], 0, 'next')).toBeNull();
  });
});

describe('resolveReportKey', () => {
  it('maps the report keys', () => {
    expect(resolveReportKey('', { escape: true })).toBe('close');
    expect(resolveReportKey('', { pageDown: true })).toBe('page-down');
    expect(resolveReportKey('', { home: true })).toBe('top');
    expect(resolveReportKey('w', {})).toBe('toggle-wrap');
    expect(resolveReportKey('n', {})).toBe('next-failed');
    expect(resolveReportKey('p', {})).toBe('prev-failed');
    expect(resolveReportKey('x', {})).toBeNull();
    expect(resolveReportKey('N', {})).toBe('next-failed');
    expect(resolveReportKey('P', {})).toBe('prev-failed');
    expect(resolveReportKey('n', { ctrl: true })).toBeNull();
    expect(resolveReportKey('w', { meta: true })).toBeNull();
    expect(resolveReportKey('', { escape: true, ctrl: true })).toBeNull();
  });
});

describe('splitReportText', () => {
  it('strips ANSI and control characters, expands tabs and splits on bare CR', () => {
    expect(splitReportText('\u001b[31mred\u001b[0m\tx\u0007')).toEqual(['red  x']);
    expect(splitReportText('a\rb\r\nc\nd')).toEqual(['a', 'b', 'c', 'd']);
    expect(splitReportText('')).toEqual([' ']);
  });
});
