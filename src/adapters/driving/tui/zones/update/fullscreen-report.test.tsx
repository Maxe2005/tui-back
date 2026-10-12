// Ink smoke + real-keypress interaction coverage of the full-screen service report, and its
// bounded-rendering dynamic test (300 issues, 5000-line error, 60x25).
import { createElement } from 'react';
import { render } from 'ink';
import { describe, expect, it } from 'vitest';
import { BoundsProvider } from '../../shared/bounds/bounds-context.js';
import { renderToString } from '../../shared/components/render-to-string.js';
import { FakeTtyStdout, KEYS, fakeInteractiveTtyStdin } from '../../shared/test-support/fake-tty.js';
import { frameLines } from '../../shared/test-support/matrix.js';
import { createAppStore } from '../../store/app-store.js';
import { FullscreenReport } from './fullscreen-report.js';
import { activeFooterContext, footerContextHints } from '../../keybindings/index.js';
import { buildServiceReport } from './update-zone.logic.js';
import { UpdateZone } from './update-zone.js';

const HUGE_ERROR = Array.from({ length: 5000 }, (_, i) => `error line ${i} ${'x'.repeat(120)}`).join('\n');
const ISSUES = Array.from({ length: 300 }, (_, i) => ({ kind: 'merge-conflict' as const, detail: `issue ${i}\n${'long '.repeat(100)}`, resolved: i % 2 === 0 }));

describe('FullscreenReport bounded rendering', () => {
  it('keeps a 300-issue, 5000-line-error report within 60x25 in wrap and truncate modes', async () => {
    const report = buildServiceReport({
      service: 'svc',
      mode: 'last',
      context: 'development → feat/a',
      steps: { merge: 'done', migration: 'failed', restart: 'skipped' },
      result: { service: 'svc', outcome: 'failed', detail: { code: 'migration-failed', message: HUGE_ERROR } } as never,
      issues: ISSUES,
    });
    for (const wrapLines of [true, false]) {
      const output = await renderToString(
        createElement(BoundsProvider, { columns: 60, rows: 25, children: null }, createElement(FullscreenReport, { lines: report.lines, offset: 10, wrapLines, visibleLines: 24, contentWidth: 56 })),
        { columns: 60, rows: 25 },
      );
      expect(frameLines(output).length).toBeLessThanOrEqual(25);
      for (const line of frameLines(output)) {
        expect(Array.from(line).length).toBeLessThanOrEqual(60);
      }
      expect(output).toContain('of ');
    }
  });
});

const ROW = { service: 'svc-a', path: '/repo/a', isMember: true, sharedBranch: 'development', protectedBranches: [], branch: 'feat/a', ahead: 0, behind: 0, status: 'current' as const };
const FAILED_RESULT = {
  service: 'svc-a',
  outcome: 'failed' as const,
  detail: { code: 'migration-failed', message: `boom first\n${Array.from({ length: 60 }, (_, i) => `trace ${i}`).join('\n')}\nboom last` },
  run: { merge: { kind: 'up-to-date' as const }, migrations: { kind: 'ran' as const, command: 'npm run m', outputExcerpt: 'out' } },
};

function storeWithRun() {
  const store = createAppStore();
  store.setState({
    edtsBranches: [ROW],
    edtsBranchesStatus: 'idle',
    edts: [{ ulid: 'edt-1', topic: 'demo', createdAt: '2026-09-17T00:00:00.000Z', status: 'active' as const, members: [{ service: 'svc-a', repoPath: '/repo/a', branch: 'feat/a' }] }],
    activeEdt: 'edt-1',
    loadEdts: async () => {},
    loadEdtsBranches: async () => {},
    lastServiceOutcomes: { 'svc-a': FAILED_RESULT },
    lastServiceRuns: {
      'svc-a': { steps: { merge: 'done', migration: 'failed', restart: 'skipped' }, result: FAILED_RESULT, source: undefined, target: 'feat/a', topic: 'demo' },
    },
  } as never);
  return store;
}

function mount(store: ReturnType<typeof createAppStore>, initialRecap = false) {
  const stdout = new FakeTtyStdout();
  stdout.columns = 80;
  stdout.rows = 24;
  const stdin = fakeInteractiveTtyStdin();
  const instance = render(createElement(UpdateZone, { useStore: store, initialRecap }), {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin,
    interactive: true,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  let mark = 0;
  const last = () => stdout.output.slice(mark);
  const press = async (chunk: string, wait = 0) => {
    mark = stdout.output.length;
    (stdin as unknown as { write: (c: string) => void }).write(chunk);
    await instance.waitUntilRenderFlush();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    await instance.waitUntilRenderFlush();
    await instance.waitUntilRenderFlush();
  };
  const settle = async () => {
    mark = stdout.output.length;
    await instance.waitUntilRenderFlush();
    await instance.waitUntilRenderFlush();
  };
  return { instance, last, press, settle };
}

// The first line number of the last "lines a–b of n" indicator in a chunk of output.
function position(output: string): string | undefined {
  return [...output.matchAll(/lines (\d+)–/g)].at(-1)?.[1];
}

describe('Update zone full report interaction', () => {
  it('opens with f, scrolls, toggles wrap, jumps to the failed step and closes with Esc', async () => {
    const { instance, last, press, settle } = mount(storeWithRun());
    try {
      await settle();
      await press('f');
      expect(last()).toContain('FULL REPORT');
      expect(last()).toContain('lines 1–');
      expect(last()).toContain('wrap');
      expect(last()).toContain('boom first'.slice(0, 4));
      await press(KEYS.end);
      expect(last()).toContain('boom last');
      expect(last()).toContain('%)');
      await press(KEYS.home);
      expect(last()).toContain('lines 1–');
      await press('w');
      expect(last()).toContain('truncate');
      await press(KEYS.pageDown);
      expect(last()).not.toContain('lines 1–');
      const before = position(last());
      await press('n');
      expect(last()).toContain('✖ Migration');
      expect(position(last())).not.toBe(before);
      await press(KEYS.escape, 30);
      expect(last()).not.toContain('FULL REPORT');
      expect(last()).toContain('SERVICES');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('updates in place when the run finishes', async () => {
    const store = storeWithRun();
    store.setState({
      lastServiceRuns: {},
      lastServiceOutcomes: {},
      liveServiceSteps: { 'svc-a': { merge: 'running', migration: 'pending', restart: 'pending' } },
      liveServiceDone: {},
      updateStatus: 'running',
      updateScope: 'edt',
    } as never);
    const { instance, last, press, settle } = mount(store);
    try {
      await settle();
      await press('f');
      expect(last()).toContain('UPDATE IN PROGRESS');
      store.setState({
        updateStatus: 'done',
        liveServiceDone: { 'svc-a': true },
        liveServiceSteps: {},
        lastServiceOutcomes: { 'svc-a': FAILED_RESULT },
        lastServiceRuns: { 'svc-a': { steps: { merge: 'done', migration: 'failed', restart: 'skipped' }, result: FAILED_RESULT, source: undefined, target: 'feat/a', topic: 'demo' } },
      } as never);
      await settle();
      expect(last()).toContain('FULL REPORT');
      expect(last()).toContain('last update');
      expect(last()).not.toContain('UPDATE IN PROGRESS');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('is a no-op on a service with no run and no issues', async () => {
    const store = storeWithRun();
    store.setState({ lastServiceRuns: {}, lastServiceOutcomes: {} } as never);
    const { instance, last, press, settle } = mount(store);
    try {
      await settle();
      await press('f');
      expect(last()).not.toContain('FULL REPORT');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('opens from the recap on Enter over a failed row only', async () => {
    const store = storeWithRun();
    store.setState({ updateStatus: 'done', updateTopic: 'demo', updateResults: [{ service: 'ok', outcome: 'updated' }, FAILED_RESULT] } as never);
    const { instance, last, press, settle } = mount(store, true);
    try {
      await settle();
      await press(KEYS.enter);
      expect(last()).not.toContain('FULL REPORT');
      await press(KEYS.pageDown);
      await press(KEYS.enter);
      expect(last()).toContain('FULL REPORT');
      expect(last()).toContain('svc-a');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('opens from a failed recap row even when the per-service maps hold nothing', async () => {
    const store = storeWithRun();
    store.setState({ lastServiceRuns: {}, lastServiceOutcomes: {}, updateStatus: 'done', updateTopic: 'demo', updateResults: [FAILED_RESULT] } as never);
    const { instance, last, press, settle } = mount(store, true);
    try {
      await settle();
      await press(KEYS.enter);
      expect(last()).toContain('FULL REPORT');
      expect(last()).toContain('boom first');
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

  it('owns the keyboard while open: no config opens, p jumps back, input is captured and the footer shows the report hints', async () => {
    const store = storeWithRun();
    const failedTwice = { merge: 'failed', migration: 'failed', restart: 'skipped' };
    store.setState({
      lastServiceRuns: { 'svc-a': { steps: failedTwice, result: FAILED_RESULT, source: undefined, target: 'feat/a', topic: 'demo' } },
    } as never);
    const { instance, last, press, settle } = mount(store);
    try {
      await settle();
      expect(store.getState().zoneInputCaptured).toBe(false);
      await press('f');
      expect(store.getState().zoneInputCaptured).toBe(true);
      const id = activeFooterContext(store.getState().footerContexts);
      expect(id).toBe('update-report');
      expect(footerContextHints('update-report').map(([key]) => key)).toContain('n/p');
      await press('n');
      await press('n');
      const second = position(last());
      for (const key of ['m', 'a']) {
        await press(key);
        expect(store.getState().updateConfig).toBeNull();
      }
      await press('p');
      expect(store.getState().updateConfig).toBeNull();
      expect(last()).toContain('FULL REPORT');
      expect(position(last())).not.toBe(second);
      await press(KEYS.escape, 30);
      expect(store.getState().zoneInputCaptured).toBe(false);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });
});
