// tui/shared/realign-dialog: pure key/footer/row decisions (renderToString never delivers a
// keypress) plus render coverage of every view of the overlay.
import { describe, expect, it } from 'vitest';
import type { DriftCandidate } from '../../../../core/dashboard/drift.js';
import { createAppStore } from '../store/app-store.js';
import { renderToString } from './components/render-to-string.js';
import { RealignDialog } from './realign-dialog.js';
import {
  describeRealignRow,
  describeRealignSummary,
  nextRealignPreset,
  orderRealignRows,
  realignCells,
  realignFooterContext,
  realignView,
  resolveRealignKey,
} from './realign-dialog.logic.js';

const ROWS: DriftCandidate[] = [
  { kind: 'member', service: 'svc-a', path: '/repo/a', branch: 'development', expectedBranch: 'feat/a', drift: 'drifted' },
  { kind: 'member', service: 'svc-b', path: '/repo/b', branch: null, expectedBranch: 'feat/b', drift: 'drifted' },
  { kind: 'other', service: 'svc-c', path: '/repo/c', branch: 'feat/x', expectedBranch: 'development', drift: 'drifted' },
];

const SELECT = { view: 'select' as const, runStatus: null, cursor: 0, rowCount: 3, selectedCount: 2 };

describe('realign dialog logic', () => {
  it('picks the view from the candidates and the run', () => {
    expect(realignView(null, null)).toBe('loading');
    expect(realignView({ status: 'error', rows: [], error: 'x' }, null)).toBe('error');
    expect(realignView({ status: 'ready', rows: [], error: null }, null)).toBe('empty');
    expect(realignView({ status: 'ready', rows: ROWS, error: null }, null)).toBe('select');
    expect(
      realignView({ status: 'ready', rows: ROWS, error: null }, { status: 'running', restartMode: 'none', rows: [], restartRows: [], restartError: null, error: null }),
    ).toBe('run');
  });

  it('maps the selection keys', () => {
    expect(resolveRealignKey('', { downArrow: true }, SELECT)).toEqual({ type: 'move', cursor: 1 });
    expect(resolveRealignKey(' ', {}, SELECT)).toEqual({ type: 'toggle' });
    expect(resolveRealignKey('p', {}, SELECT)).toEqual({ type: 'preset' });
    expect(resolveRealignKey('', { leftArrow: true }, SELECT)).toEqual({ type: 'restart', direction: -1 });
    expect(resolveRealignKey('', { rightArrow: true }, SELECT)).toEqual({ type: 'restart', direction: 1 });
    expect(resolveRealignKey('', { return: true }, SELECT)).toEqual({ type: 'confirm' });
    expect(resolveRealignKey('', { escape: true }, SELECT)).toEqual({ type: 'close' });
  });

  it('disables the confirmation on an empty selection', () => {
    expect(resolveRealignKey('', { return: true }, { ...SELECT, selectedCount: 0 })).toEqual({ type: 'ignore' });
    expect(realignFooterContext('select', null, 0)).toBe('realign-select-empty');
    expect(realignFooterContext('select', null, 2)).toBe('realign-select');
  });

  it('ignores every key while a run is in flight, then closes on Enter or Esc', () => {
    const running = { ...SELECT, view: 'run' as const, runStatus: 'running' as const };
    expect(resolveRealignKey('', { escape: true }, running)).toEqual({ type: 'ignore' });
    expect(resolveRealignKey(' ', {}, running)).toEqual({ type: 'ignore' });
    expect(realignFooterContext('run', 'running', 2)).toBe('busy');
    const done = { ...running, runStatus: 'done' as const };
    expect(resolveRealignKey('', { return: true }, done)).toEqual({ type: 'close' });
    expect(realignFooterContext('run', 'done', 2)).toBe('close');
  });

  it('closes the aligned and error views', () => {
    expect(resolveRealignKey('', { return: true }, { ...SELECT, view: 'empty' })).toEqual({ type: 'close' });
    expect(resolveRealignKey('', { escape: true }, { ...SELECT, view: 'error' })).toEqual({ type: 'close' });
    expect(resolveRealignKey('', { return: true }, { ...SELECT, view: 'error' })).toEqual({ type: 'ignore' });
  });

  it('cycles presets from the matching one', () => {
    expect(nextRealignPreset(null)).toBe('none');
    expect(nextRealignPreset('none')).toBe('edt');
    expect(nextRealignPreset('edt')).toBe('all');
    expect(nextRealignPreset('all')).toBe('none');
  });

  it('renders the table cells as text, detached for a detached HEAD', () => {
    expect(realignCells(ROWS[1]!, true).map((cell) => cell.text)).toEqual(['[x] svc-b', 'detached', 'feat/b', 'member']);
    expect(realignCells(ROWS[2]!, false).map((cell) => cell.text)).toEqual(['[ ] svc-c', 'feat/x', 'development', 'other']);
  });

  it('orders the summary non-green first and counts each outcome', () => {
    const rows = [
      { service: 'a', path: '/a', status: 'realigned' as const },
      { service: 'b', path: '/b', status: 'skipped' as const, detail: { code: 'realign-dirty-work', message: 'dirty' } },
      { service: 'c', path: '/c', status: 'failed' as const, detail: { code: 'git', message: 'boom' } },
    ];
    expect(orderRealignRows(rows).map((row) => row.service)).toEqual(['c', 'b', 'a']);
    expect(describeRealignSummary(rows)).toBe('1 realigned · 1 skipped · 1 failed');
    expect(describeRealignRow(rows[1]!)).toBe('⚠ b — skipped: dirty');
  });
});

describe('RealignDialog', () => {
  it('lists the drifted services with presets and the restart selector', async () => {
    const store = createAppStore();
    store.setState({
      realignScreenOpen: true,
      realignCandidates: { status: 'ready', rows: ROWS, error: null },
      realignDraft: { cursor: 0, selected: ['/repo/a', '/repo/b'], restartMode: 'clean' },
    });
    const output = await renderToString(<RealignDialog useStore={store} />, { columns: 160, rows: 40 });
    expect(output).toContain('REALIGN');
    expect(output).toContain("(•) Services de l'EDT");
    expect(output).toContain('[x] svc-a');
    expect(output).toContain('[ ] svc-c');
    expect(output).toContain('detached');
    expect(output).toContain('other');
    expect(output).toContain('Redémarrer les services après le realign');
    expect(output).toContain('(•) Clean restart');
  });

  it('says why the confirmation is disabled on an empty selection', async () => {
    const store = createAppStore();
    store.setState({ realignScreenOpen: true, realignCandidates: { status: 'ready', rows: ROWS, error: null } });
    const output = await renderToString(<RealignDialog useStore={store} />, { columns: 160, rows: 40 });
    expect(output).toContain('No service selected');
    expect(output).toContain('(•) Aucun');
  });

  it('shows a single aligned line when nothing drifted', async () => {
    const store = createAppStore();
    store.setState({ realignScreenOpen: true, realignCandidates: { status: 'ready', rows: [], error: null } });
    const output = await renderToString(<RealignDialog useStore={store} />, { columns: 160, rows: 40 });
    expect(output).toContain('All services are aligned');
    expect(output).not.toContain('Préréglage');
  });

  it('shows the run summary non-green first with the restart report', async () => {
    const store = createAppStore();
    store.setState({
      realignScreenOpen: true,
      realignCandidates: { status: 'ready', rows: ROWS, error: null },
      realignRun: {
        status: 'done',
        restartMode: 'clean',
        rows: [
          { service: 'svc-a', path: '/repo/a', status: 'realigned' },
          { service: 'svc-c', path: '/repo/c', status: 'failed', detail: { code: 'git', message: 'checkout refused' } },
        ],
        restartRows: [
          { service: 'svc-a', repoPath: '/repo/a', phase: 'functional' },
          { service: 'svc-c', repoPath: '/repo/c', phase: 'skipped', skipReason: 'unchanged' },
        ],
        restartError: null,
        error: null,
      },
    });
    const output = await renderToString(<RealignDialog useStore={store} />, { columns: 160, rows: 40 });
    expect(output).toContain('Realign finished: 1 realigned · 1 failed');
    expect(output.indexOf('svc-c — failed: checkout refused')).toBeLessThan(output.indexOf('svc-a — realigned'));
    expect(output).toContain('Restart clean finished');
    expect(output).toContain('svc-a — functional');
  });

  it('shows a refused run as its error', async () => {
    const store = createAppStore();
    store.setState({
      realignScreenOpen: true,
      realignCandidates: { status: 'ready', rows: ROWS, error: null },
      realignRun: { status: 'error', restartMode: 'none', rows: [], restartRows: [], restartError: null, error: 'Cannot realign: an update is in progress.' },
    });
    const output = await renderToString(<RealignDialog useStore={store} />, { columns: 160, rows: 40 });
    expect(output).toContain('Realign not run.');
    expect(output).toContain('Cannot realign: an update is in progress.');
  });
});
