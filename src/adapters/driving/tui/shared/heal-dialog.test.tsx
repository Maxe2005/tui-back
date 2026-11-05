// tui/shared/heal-dialog: pure key/footer decisions (renderToString never delivers a keypress)
// plus render coverage of every view of the overlay.
import { describe, expect, it } from 'vitest';
import type { RestartRow } from '../../../../core/edt/switch-restart.js';
import { createAppStore, type HealRun } from '../store/app-store.js';
import { renderToString } from './components/render-to-string.js';
import { footerContextOf } from './test-support/mount-for-test.js';
import { HealDialog, healListBudget } from './heal-dialog.js';
import { describeHealPlan, healFooterContext, healView, resolveHealKey } from './heal-dialog.logic.js';

const PLAN_ROWS: RestartRow[] = [
  { service: 'svc-a', repoPath: '/repo/a', phase: 'pending' },
  { service: 'svc-b', repoPath: '/repo/b', phase: 'skipped', skipReason: 'up' },
  { service: 'svc-c', repoPath: '/repo/c', phase: 'skipped', skipReason: 'no container' },
];

function healRun(overrides: Partial<HealRun> = {}): HealRun {
  return {
    status: 'confirm',
    plan: { edt: { ulid: 'e1', topic: 'demo-topic' }, rows: PLAN_ROWS },
    mode: 'simple',
    rows: PLAN_ROWS,
    report: null,
    error: null,
    ...overrides,
  };
}

function storeWith(run: HealRun) {
  const store = createAppStore();
  store.setState({ healScreenOpen: true, healRun: run });
  return store;
}

describe('heal dialog logic', () => {
  it('picks the view from the run and the confirm-close sub-state', () => {
    expect(healView(null, false)).toBe('planning');
    expect(healView(healRun({ status: 'planning' }), false)).toBe('planning');
    expect(healView(healRun(), true)).toBe('confirm');
    expect(healView(healRun({ status: 'running' }), false)).toBe('running');
    expect(healView(healRun({ status: 'running' }), true)).toBe('confirm-close');
    expect(healView(healRun({ status: 'done' }), true)).toBe('done');
    expect(healView(healRun({ status: 'error' }), false)).toBe('error');
  });

  it('maps the confirm keys: mode toggle, run, cancel', () => {
    expect(resolveHealKey('', { leftArrow: true }, 'confirm')).toEqual({ type: 'toggle-mode' });
    expect(resolveHealKey('', { rightArrow: true }, 'confirm')).toEqual({ type: 'toggle-mode' });
    expect(resolveHealKey(' ', {}, 'confirm')).toEqual({ type: 'toggle-mode' });
    expect(resolveHealKey('', { return: true }, 'confirm')).toEqual({ type: 'confirm' });
    expect(resolveHealKey('', { escape: true }, 'confirm')).toEqual({ type: 'close' });
    expect(resolveHealKey('q', {}, 'confirm')).toEqual({ type: 'ignore' });
    expect(resolveHealKey('c', { ctrl: true }, 'confirm')).toEqual({ type: 'ignore' });
  });

  it('asks before hiding a running heal, and Enter or Esc close a finished one', () => {
    expect(resolveHealKey('', { return: true }, 'running')).toEqual({ type: 'ignore' });
    expect(resolveHealKey('', { escape: true }, 'running')).toEqual({ type: 'confirm-close' });
    expect(resolveHealKey('', { return: true }, 'confirm-close')).toEqual({ type: 'close' });
    expect(resolveHealKey('', { escape: true }, 'confirm-close')).toEqual({ type: 'keep-open' });
    expect(resolveHealKey('', { return: true }, 'done')).toEqual({ type: 'close' });
    expect(resolveHealKey('', { escape: true }, 'error')).toEqual({ type: 'close' });
  });

  it('names the footer context of each view', () => {
    expect(healFooterContext('confirm')).toBe('heal-confirm');
    expect(healFooterContext('running')).toBe('heal-busy');
    expect(healFooterContext('confirm-close')).toBe('heal-confirm-close');
    expect(healFooterContext('done')).toBe('heal-close');
    expect(healFooterContext('error')).toBe('heal-close');
  });

  it('summarises the plan', () => {
    expect(describeHealPlan(PLAN_ROWS)).toBe('1 service to restart · 2 skipped');
    expect(describeHealPlan([PLAN_ROWS[0]!, { ...PLAN_ROWS[0]!, service: 'svc-d' }])).toBe('2 services to restart');
  });

  it('keeps at least one list row however small the region', () => {
    expect(healListBudget(3, 'confirm')).toBe(1);
    expect(healListBudget(40, 'confirm')).toBe(40 - 16);
    expect(healListBudget(40, 'running')).toBe(40 - 10);
    expect(healListBudget(40, 'confirm-close')).toBe(40 - 13);
  });
});

describe('HealDialog render', () => {
  it('lists the targets then the skipped services with reasons, and the mode selector', async () => {
    const store = storeWith(healRun({ mode: 'clean' }));
    const output = await renderToString(<HealDialog useStore={store} />, { columns: 160, rows: 40 });
    expect(output).toContain('HEAL');
    expect(output).toContain('EDT: demo-topic');
    expect(output).toContain('1 service to restart · 2 skipped');
    expect(output).toContain('(•) Clean restart');
    expect(output).not.toContain('Aucun');
    expect(output.indexOf('svc-a — pending')).toBeLessThan(output.indexOf('svc-b — skipped (up)'));
    expect(output).toContain('svc-c — skipped (no container)');
    expect(await footerContextOf(store, <HealDialog useStore={store} />)).toBe('heal-confirm');
  });

  it('renders the live rows while running', async () => {
    const rows: RestartRow[] = [{ ...PLAN_ROWS[0]!, phase: 'verifying' }, PLAN_ROWS[1]!, PLAN_ROWS[2]!];
    const store = storeWith(healRun({ status: 'running', rows }));
    const output = await renderToString(<HealDialog useStore={store} />, { columns: 160, rows: 40 });
    expect(output).toContain('Restarting services (simple)');
    expect(output).toContain('svc-a — verifying');
    expect(output).not.toContain('Redémarrage simple');
    expect(await footerContextOf(store, <HealDialog useStore={store} />)).toBe('heal-busy');
  });

  it('shows the confirm-close prompt over a running heal', async () => {
    const store = storeWith(healRun({ status: 'running' }));
    const output = await renderToString(<HealDialog useStore={store} initial={{ confirmingClose: true }} />, { columns: 200, rows: 40 });
    expect(output).toContain('lets it finish in the background');
    expect(await footerContextOf(store, <HealDialog useStore={store} initial={{ confirmingClose: true }} />)).toBe('heal-confirm-close');
  });

  it('shows the summary non-green first once done', async () => {
    const rows: RestartRow[] = [
      { service: 'svc-ok', repoPath: '/repo/ok', phase: 'functional' },
      PLAN_ROWS[1]!,
      { service: 'svc-bad', repoPath: '/repo/bad', phase: 'unhealthy', detail: 'HTTP 503' },
    ];
    const store = storeWith(healRun({ status: 'done', rows }));
    const output = await renderToString(<HealDialog useStore={store} />, { columns: 160, rows: 40 });
    expect(output).toContain('Restart simple finished: 1 functional · 1 unhealthy · 1 skipped');
    expect(output.indexOf('svc-bad — unhealthy: HTTP 503')).toBeLessThan(output.indexOf('svc-ok — functional'));
    expect(await footerContextOf(store, <HealDialog useStore={store} />)).toBe('heal-close');
  });

  it('shows a failed run as its error', async () => {
    const store = storeWith(healRun({ status: 'error', error: 'Unknown restart mode' }));
    const output = await renderToString(<HealDialog useStore={store} />, { columns: 160, rows: 40 });
    expect(output).toContain('Heal not run.');
    expect(output).toContain('Unknown restart mode');
  });
});
