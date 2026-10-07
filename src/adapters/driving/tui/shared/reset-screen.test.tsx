// tui/shared/reset-screen: render-level smoke coverage of every step and the result view,
// plus the pure summary/result line builders. Key handling itself is covered in
// reset-screen.logic.test.ts (renderToString never delivers a keypress).
import { describe, expect, it } from 'vitest';
import { createAppStore } from '../store/app-store.js';
import { footerIdOf, mountForTest } from './test-support/mount-for-test.js';
import { renderToString } from './components/render-to-string.js';
import { ResetScreen } from './reset-screen.js';
import {
  buildResetResultLines,
  buildResetSummaryLines,
  createResetScreenState,
  toggleResetCategory,
  type ResetSummaryPreview,
} from './reset-screen.logic.js';

const PREVIEW: ResetSummaryPreview = {
  status: 'ready',
  edtTopics: ['feature-a', 'feature-b'],
  serviceCount: 4,
  error: null,
  edtRegistryFile: '/cfg/edts.yaml',
  registryFile: '/cfg/registry.yaml',
  edtsBaseDir: '/data/edts',
};

describe('buildResetSummaryLines', () => {
  it('lists EDT topics, service count and files for every selected category', () => {
    const text = buildResetSummaryLines(['services', 'histories'], PREVIEW).map((l) => l.text).join('\n');
    expect(text).toContain('EDTs — 2 EDTs: feature-a, feature-b');
    expect(text).toContain('/cfg/edts.yaml — every entry removed');
    expect(text).toContain('/data/edts/*');
    expect(text).toContain('activeEdt set to null');
    expect(text).toContain('filterHistory emptied');
    expect(text).toContain('Registered services — 4 services');
    expect(text).toContain('/cfg/registry.yaml — every entry removed');
  });

  it('shows only histories when only histories is selected', () => {
    const text = buildResetSummaryLines(['histories'], PREVIEW).map((l) => l.text).join('\n');
    expect(text).toContain('filterHistory emptied');
    expect(text).not.toContain('edts.yaml');
    expect(text).not.toContain('registry.yaml');
  });

  it('shows a loading line until the preview resolves', () => {
    expect(buildResetSummaryLines(['edts'], null)[0]?.text).toMatch(/Loading/);
  });
});

describe('buildResetResultLines', () => {
  it('reports per-category outcome and every left-behind branch with its repo', () => {
    const lines = buildResetResultLines(
      {
        outcomes: { edts: { outcome: 'ok' }, services: { outcome: 'failed', error: { message: 'lock held' } } },
        leftBranches: [
          { topic: 'feature-a', service: 'api', repoPath: '/repos/api', branch: 'feat/a' },
          { topic: 'feature-a', service: 'web', repoPath: '/repos/web', branch: 'feat/a' },
        ],
      },
      null,
    ).map((l) => l.text);
    expect(lines).toContain('✓ EDTs reset');
    expect(lines).toContain('✗ Registered services failed: lock held');
    expect(lines.some((l) => l.includes('api / /repos/api / feat/a'))).toBe(true);
    expect(lines.some((l) => l.includes('web / /repos/web / feat/a'))).toBe(true);
  });

  it('reports a whole-run error', () => {
    expect(buildResetResultLines(null, 'boom')[0]?.text).toContain('boom');
  });

  it('shows a post-reset error alongside the outcomes, never instead of them', () => {
    const lines = buildResetResultLines({ outcomes: { histories: { outcome: 'ok' } }, leftBranches: [] }, 'reload failed').map((l) => l.text);
    expect(lines).toContain('✗ reload failed');
    expect(lines).toContain('✓ Histories reset');
  });
});

describe('ResetScreen render', () => {
  it('step 1: all categories unchecked', async () => {
    const output = await renderToString(<ResetScreen useStore={createAppStore()} />);
    expect(output).toContain('RESET TOOL DATA');
    expect(output).toContain('[ ] EDTs');
    expect(output).toContain('[ ] Histories');
    expect(output).toContain('[ ] Registered services');
  });

  it('step 1: EDTs shown as required when Services is checked', async () => {
    const state = toggleResetCategory(createResetScreenState(), 'services');
    const output = await renderToString(<ResetScreen useStore={createAppStore()} initialState={state} />);
    expect(output).toContain('[x] EDTs');
    expect(output).toContain('required by Registered services');
  });

  it('step 2: summary from the store preview', async () => {
    const store = createAppStore();
    store.setState({ resetPreview: PREVIEW });
    const state = { ...toggleResetCategory(createResetScreenState(), 'edts'), step: 'summary' as const };
    const output = await renderToString(<ResetScreen useStore={store} initialState={state} />);
    expect(output).toContain('permanently deleted');
    expect(output).toContain('feature-a, feature-b');
  });

  it('step 2: a failed preview shows the error and only offers Esc', async () => {
    const store = createAppStore();
    store.setState({ resetPreview: { ...PREVIEW, status: 'error', edtTopics: [], serviceCount: 0, error: 'registry exploded' } });
    const state = { ...toggleResetCategory(createResetScreenState(), 'edts'), step: 'summary' as const };
    const output = await renderToString(<ResetScreen useStore={store} initialState={state} />);
    expect(output).toContain('registry exploded');
    expect(output).toContain('Failed to load the summary.');
  });

  async function footerContextFor(step: 'select' | 'summary' | 'confirm', preview?: ResetSummaryPreview) {
    const store = createAppStore();
    if (preview !== undefined) {
      store.setState({ resetPreview: preview });
    }
    const state = { ...toggleResetCategory(createResetScreenState(), 'edts'), step };
    const mounted = await mountForTest(<ResetScreen useStore={store} initialState={state} />);
    const id = footerIdOf(store);
    mounted.unmount();
    return { id, after: store.getState().footerContexts.length };
  }

  it('registers the footer context of each step and clears it on close', async () => {
    expect(await footerContextFor('select')).toEqual({ id: 'reset-select', after: 0 });
    expect((await footerContextFor('summary', PREVIEW)).id).toBe('reset-summary');
    expect((await footerContextFor('summary', { ...PREVIEW, status: 'error' })).id).toBe('reset-wait');
    expect((await footerContextFor('confirm')).id).toBe('reset-confirm');
  });

  it('running: shows progress and no key hints but waiting', async () => {
    const store = createAppStore();
    store.setState({ resetStatus: 'running' });
    const state = { ...toggleResetCategory(createResetScreenState(), 'edts'), step: 'confirm' as const };
    const output = await renderToString(<ResetScreen useStore={store} initialState={state} />);
    expect(output).toContain('Resetting…');
    expect(output).toContain('Please wait.');
    expect(output).not.toContain('Esc');
  });

  it('step 3: confirmation input', async () => {
    const state = { ...toggleResetCategory(createResetScreenState(), 'edts'), step: 'confirm' as const };
    const output = await renderToString(<ResetScreen useStore={createAppStore()} initialState={state} />);
    expect(output).toContain('Type reset and press Enter');
    expect(output).toContain('Confirm:');
  });

  it('result view: outcomes and left-behind branches', async () => {
    const store = createAppStore();
    store.setState({
      resetStatus: 'done',
      resetResult: {
        outcomes: { edts: { outcome: 'ok' } },
        leftBranches: [{ topic: 't', service: 'api', repoPath: '/repos/api', branch: 'feat/a' }],
      },
    });
    const output = await renderToString(<ResetScreen useStore={store} />);
    expect(output).toContain('✓ EDTs reset');
    expect(output).toContain('api / /repos/api / feat/a');
  });
});
