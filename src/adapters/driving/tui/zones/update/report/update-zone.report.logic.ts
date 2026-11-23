// tui/zones/update: fullscreen service report model, windowing and report key handling.
import type { GroupUpdateRepoResult } from '../../../../../../core/scripts/group-update.js';
import { computeLineRowCount, sliceVisibleWindow } from '../../../shared/scrollable-output/index.js';
import type { ServiceIssue } from '../logic/update-zone.status.logic.js';
import type { ServiceStepStates } from '../logic/update-zone.steps.logic.js';
import { PENDING_STEPS, buildServiceStepViews } from '../logic/update-zone.steps.logic.js';

// ---------------------------------------------------------------------------------------------
// The full-screen service report: the same step views and issue log as the inline
// pane, with nothing capped or flattened. Built as a flat line model so windowing, wrap row
// counts and failed-step jumps share one structure.
export type ReportLineKind = 'title' | 'context' | 'step' | 'step-failed' | 'detail' | 'detail-failed' | 'issue' | 'issue-resolved' | 'heading' | 'dim';

export interface ReportLine {
  kind: ReportLineKind;
  text: string;
}

export interface ServiceReport {
  lines: ReportLine[];
  // Indices (into `lines`) of the failed steps' headlines — the `n`/`p` jump targets.
  failedLines: number[];
}

export interface ServiceReportInput {
  service: string;
  mode: 'live' | 'last' | 'never';
  context: string | null;
  steps: ServiceStepStates | undefined;
  result: GroupUpdateRepoResult | undefined;
  issues: readonly ServiceIssue[];
}

// A blank line still takes one row — an empty Ink Text would collapse to none.
function reportText(text: string): string {
  return text === '' ? ' ' : text;
}

// ANSI escape sequences (colourised tool output) and the remaining C0 control characters would
// corrupt the frame; tabs become spaces, and a bare CR or CRLF is a line break.
const ANSI_SEQUENCE = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[@-Z\\-_])/g;

// eslint-disable-next-line no-control-regex
const C0_CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

export function splitReportText(text: string): string[] {
  return text
    .replace(ANSI_SEQUENCE, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '  ')
    .replace(C0_CONTROLS, '')
    .split('\n')
    .map(reportText);
}

export function buildServiceReport(input: ServiceReportInput): ServiceReport {
  const lines: ReportLine[] = [];
  const failedLines: number[] = [];
  const push = (kind: ReportLineKind, text: string): void => {
    lines.push({ kind, text });
  };
  const modeLabel = input.mode === 'live' ? '  · UPDATE IN PROGRESS' : input.mode === 'last' ? '  · last update' : '';
  push('title', `${input.service}${modeLabel}`);
  if (input.mode === 'never' && input.issues.length === 0) {
    push('dim', 'No update has run for this service yet.');
    return { lines, failedLines };
  }
  if (input.context !== null) {
    push('context', input.context);
  }
  // Without a run there are no steps to list — only the issue log.
  const views = input.mode === 'never' ? [] : buildServiceStepViews(input.steps ?? PENDING_STEPS, input.result, { full: true });
  for (const view of views) {
    push('dim', ' ');
    const failed = view.state === 'failed';
    if (failed) {
      failedLines.push(lines.length);
    }
    push(failed ? 'step-failed' : 'step', view.headline);
    for (const detail of view.detail) {
      for (const line of splitReportText(detail)) {
        push(failed ? 'detail-failed' : 'detail', `   ${line}`);
      }
    }
  }
  if (input.issues.length > 0) {
    push('dim', ' ');
    push('heading', `Issues (${String(input.issues.length)})`);
    for (const issue of input.issues) {
      const [first = ' ', ...rest] = splitReportText(issue.detail);
      const kind: ReportLineKind = issue.resolved ? 'issue-resolved' : 'issue';
      push(kind, `${issue.resolved ? '✔' : '⚠'} ${issue.kind} — ${first.trim() === '' ? '(no detail)' : first} (${issue.resolved ? 'resolved' : 'needs your input'})`);
      for (const line of rest) {
        push(kind, `    ${line}`);
      }
    }
  }
  return { lines, failedLines };
}

// The row cost of a report line under the current wrap mode.
export function reportLineRows(line: ReportLine, width: number, wrap: boolean): number {
  return computeLineRowCount(line.text, width, wrap);
}

// The greatest top offset whose window still fills the budget (the tail window's first line).
export function reportMaxOffset(lines: readonly ReportLine[], budget: number, width: number, wrap: boolean): number {
  const tail = sliceVisibleWindow(lines, 0, budget, (line) => reportLineRows(line, width, wrap));
  return Math.max(0, lines.length - tail.length);
}

// The lines drawn for a top-anchored offset: as many as fit the row budget (at least one).
export function reportWindow(lines: readonly ReportLine[], offset: number, budget: number, width: number, wrap: boolean): { start: number; visibleLines: ReportLine[] } {
  const start = Math.min(Math.max(0, offset), reportMaxOffset(lines, budget, width, wrap));
  let used = 0;
  let end = start;
  while (end < lines.length) {
    const rows = reportLineRows(lines[end] as ReportLine, width, wrap);
    if (used + rows > budget && end > start) {
      break;
    }
    used += rows;
    end += 1;
  }
  return { start, visibleLines: lines.slice(start, end) };
}

// "lines 1–12 of 340 (4%)" — the scroll position, 1-based and inclusive.
export function formatReportPosition(start: number, visibleRows: number, total: number): string {
  if (total === 0 || visibleRows === 0) {
    return 'empty';
  }
  const last = start + visibleRows;
  return `lines ${String(start + 1)}–${String(last)} of ${String(total)} (${String(Math.round((last / total) * 100))}%)`;
}

export type ReportKeyAction = 'close' | 'up' | 'down' | 'page-up' | 'page-down' | 'top' | 'bottom' | 'toggle-wrap' | 'next-failed' | 'prev-failed';

export function resolveReportKey(
  input: string,
  key: { ctrl?: boolean; meta?: boolean; escape?: boolean; upArrow?: boolean; downArrow?: boolean; pageUp?: boolean; pageDown?: boolean; home?: boolean; end?: boolean },
): ReportKeyAction | null {
  if (key.ctrl === true || key.meta === true) return null;
  if (key.escape === true) return 'close';
  if (key.upArrow === true) return 'up';
  if (key.downArrow === true) return 'down';
  if (key.pageUp === true) return 'page-up';
  if (key.pageDown === true) return 'page-down';
  if (key.home === true) return 'top';
  if (key.end === true) return 'bottom';
  if (input === 'w' || input === 'W') return 'toggle-wrap';
  if (input === 'n' || input === 'N') return 'next-failed';
  if (input === 'p' || input === 'P') return 'prev-failed';
  return null;
}

// The next top offset for a scroll action, clamped to [0, maxOffset]. `page` is the row budget.
export function applyReportScroll(offset: number, action: 'up' | 'down' | 'page-up' | 'page-down' | 'top' | 'bottom', maxOffset: number, page: number): number {
  const clamp = (value: number): number => Math.min(Math.max(0, value), maxOffset);
  const current = clamp(offset);
  switch (action) {
    case 'up':
      return clamp(current - 1);
    case 'down':
      return clamp(current + 1);
    case 'page-up':
      return clamp(current - Math.max(1, page - 1));
    case 'page-down':
      return clamp(current + Math.max(1, page - 1));
    case 'top':
      return 0;
    case 'bottom':
      return maxOffset;
  }
}

// The offset of the next/previous failed step relative to `offset`, wrapping around; null when
// the report has no failed step.
export function jumpToFailedStep(failedLines: readonly number[], offset: number, direction: 'next' | 'prev'): number | null {
  if (failedLines.length === 0) {
    return null;
  }
  if (direction === 'next') {
    return failedLines.find((index) => index > offset) ?? (failedLines[0] as number);
  }
  return [...failedLines].reverse().find((index) => index < offset) ?? (failedLines.at(-1) as number);
}
