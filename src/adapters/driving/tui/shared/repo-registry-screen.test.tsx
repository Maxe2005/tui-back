// tui/shared/repo-registry-screen: render tests for the registry screen — root input,
// scanning, distinct empty-vs-error scan outcomes, candidate multi-select, registering,
// per-path outcomes, and the "Clean stale entries" flow — plus the pure key-handling functions
// (renderToString's fake stdin never emits keys, so useInput itself is never exercised).
import { describe, it, expect } from 'vitest';
import { FOOTER_CONTEXTS } from '../keybindings/index.js';
import { createAppStore } from '../store/app-store.js';
import { footerContextOf as contextOf } from './test-support/mount-for-test.js';
import { renderToString } from './components/render-to-string.js';
import {
  MANIFEST_GUIDANCE_LINES,
  RepoRegistryScreen,
  backspaceRootInput,
  registryFooterContext,
  resolveRegistryScreenPhase,
  toggleCandidateSelection,
  toggleCleanCandidateExclusion,
  typeRootInputChar,
} from './repo-registry-screen.js';

const footerContextOf = (store: ReturnType<typeof createAppStore>) => contextOf(store, <RepoRegistryScreen useStore={store} />);

describe('registryFooterContext', () => {
  it('advertises its own keys only for the interactive phases', () => {
    expect(registryFooterContext('root-input', false)).toBe('registry-path');
    expect(registryFooterContext('candidates', false)).toBe('registry-candidates');
    expect(registryFooterContext('clean-candidates', true)).toBe('registry-stale');
    expect(registryFooterContext('clean-candidates', false)).toBe('dismiss');
    expect(registryFooterContext('results', false)).toBe('dismiss');
  });
});

describe('resolveRegistryScreenPhase', () => {
  const base = {
    registryScanStatus: 'idle' as const,
    registryScanResult: null,
    registryRegisterStatus: 'idle' as const,
    registryRegisterResults: null,
    registryCleanScanStatus: 'idle' as const,
    registryCleanCandidates: null,
    registryCleanStatus: 'idle' as const,
    registryCleanResults: null,
    registryValidateStatus: 'idle' as const,
    registryValidateResults: null,
  };

  it('starts at root-input before any scan', () => {
    expect(resolveRegistryScreenPhase(base)).toBe('root-input');
  });

  it('is scanning while the scan use-case is in flight', () => {
    expect(resolveRegistryScreenPhase({ ...base, registryScanStatus: 'loading' })).toBe('scanning');
  });

  it('is scan-error on a genuine scan failure', () => {
    expect(resolveRegistryScreenPhase({ ...base, registryScanStatus: 'error' })).toBe('scan-error');
  });

  it('is the distinct empty state when the scan found nothing — never conflated with scan-error', () => {
    expect(
      resolveRegistryScreenPhase({ ...base, registryScanResult: { candidates: [], skipped: [] } }),
    ).toBe('empty');
  });

  it('is candidates once the scan found at least one manifest-carrying directory', () => {
    expect(
      resolveRegistryScreenPhase({ ...base, registryScanResult: { candidates: ['/repos/a'], skipped: [] } }),
    ).toBe('candidates');
  });

  it('is registering while the register use-case is in flight', () => {
    expect(
      resolveRegistryScreenPhase({
        ...base,
        registryScanResult: { candidates: ['/repos/a'], skipped: [] },
        registryRegisterStatus: 'loading',
      }),
    ).toBe('registering');
  });

  it('is results once register outcomes exist, taking precedence over every other field', () => {
    expect(
      resolveRegistryScreenPhase({
        ...base,
        registryScanStatus: 'error',
        registryRegisterResults: [{ path: '/repos/a', outcome: 'registered' }],
      }),
    ).toBe('results');
  });

  it('is clean-candidates while the stale-entry classification is in flight', () => {
    expect(resolveRegistryScreenPhase({ ...base, registryCleanScanStatus: 'loading' })).toBe('clean-candidates');
  });

  it('is clean-candidates on a classification failure too — folded into the same phase, told apart by its own render block', () => {
    expect(resolveRegistryScreenPhase({ ...base, registryCleanScanStatus: 'error' })).toBe('clean-candidates');
  });

  it('is clean-candidates once classification returns, including the zero-candidates case', () => {
    expect(resolveRegistryScreenPhase({ ...base, registryCleanCandidates: [] })).toBe('clean-candidates');
    expect(
      resolveRegistryScreenPhase({
        ...base,
        registryCleanCandidates: [{ path: '/repos/a', reason: 'unreachable', memberOfEdts: [] }],
      }),
    ).toBe('clean-candidates');
  });

  it('is cleaning while the removal use-case is in flight, taking precedence over clean-candidates', () => {
    expect(
      resolveRegistryScreenPhase({
        ...base,
        registryCleanCandidates: [{ path: '/repos/a', reason: 'unreachable', memberOfEdts: [] }],
        registryCleanStatus: 'loading',
      }),
    ).toBe('cleaning');
  });

  it('is clean-results once removal outcomes exist, taking precedence over every other field including register results', () => {
    expect(
      resolveRegistryScreenPhase({
        ...base,
        registryRegisterResults: [{ path: '/repos/a', outcome: 'registered' }],
        registryCleanResults: [{ path: '/repos/a', outcome: 'removed' }],
      }),
    ).toBe('clean-results');
  });

  it('is validating while the validation use-case is in flight', () => {
    expect(resolveRegistryScreenPhase({ ...base, registryValidateStatus: 'loading' })).toBe('validating');
  });

  it('is validate-results once validation outcomes exist, below cleaning but above scan results', () => {
    expect(
      resolveRegistryScreenPhase({
        ...base,
        registryValidateResults: [{ path: '/repos/a', outcome: 'valid' }],
      }),
    ).toBe('validate-results');
    // Cleaning still wins over validate-results (clean priority never moves).
    expect(
      resolveRegistryScreenPhase({
        ...base,
        registryCleanStatus: 'loading',
        registryValidateResults: [{ path: '/repos/a', outcome: 'valid' }],
      }),
    ).toBe('cleaning');
    expect(
      resolveRegistryScreenPhase({
        ...base,
        registryCleanResults: [{ path: '/repos/a', outcome: 'removed' }],
        registryValidateResults: [{ path: '/repos/a', outcome: 'valid' }],
      }),
    ).toBe('clean-results');
    // Validate-results wins over scan results.
    expect(
      resolveRegistryScreenPhase({
        ...base,
        registryRegisterResults: [{ path: '/repos/a', outcome: 'registered' }],
        registryValidateResults: [{ path: '/repos/a', outcome: 'valid' }],
      }),
    ).toBe('validate-results');
  });

  it('is validate-results on a validation failure too — folded into the same phase, told apart by its own render block', () => {
    expect(resolveRegistryScreenPhase({ ...base, registryValidateStatus: 'error' })).toBe('validate-results');
  });
});

describe('typeRootInputChar', () => {
  it('appends a typed character', () => {
    expect(typeRootInputChar('/repos', '/', { ctrl: false, meta: false })).toBe('/repos/');
  });

  it('ignores empty input (arrows/Home/End/Enter, handled via key flags elsewhere)', () => {
    expect(typeRootInputChar('/repos', '', { ctrl: false, meta: false })).toBe('/repos');
  });

  it('ignores a Ctrl/meta combo rather than appending it as a literal character', () => {
    expect(typeRootInputChar('/repos', 'w', { ctrl: true, meta: false })).toBe('/repos');
    expect(typeRootInputChar('/repos', 'w', { ctrl: false, meta: true })).toBe('/repos');
  });
});

describe('backspaceRootInput', () => {
  it('removes the last character', () => {
    expect(backspaceRootInput('/repos')).toBe('/repo');
  });

  it('is a no-op on an empty string', () => {
    expect(backspaceRootInput('')).toBe('');
  });
});

describe('toggleCandidateSelection', () => {
  it('adds an unselected path and removes an already-selected one, without mutating the input set', () => {
    const original = new Set(['/repos/a']);
    const added = toggleCandidateSelection(original, '/repos/b');
    expect(added).toEqual(new Set(['/repos/a', '/repos/b']));
    expect(original).toEqual(new Set(['/repos/a']));

    const removed = toggleCandidateSelection(added, '/repos/a');
    expect(removed).toEqual(new Set(['/repos/b']));
  });
});

describe('toggleCleanCandidateExclusion', () => {
  it('excludes a not-yet-excluded path and re-includes an already-excluded one, without mutating the input set', () => {
    const original = new Set<string>();
    const excluded = toggleCleanCandidateExclusion(original, '/repos/a');
    expect(excluded).toEqual(new Set(['/repos/a']));
    expect(original).toEqual(new Set());

    const reincluded = toggleCleanCandidateExclusion(excluded, '/repos/a');
    expect(reincluded).toEqual(new Set());
  });
});

// Every render test below seeds registry-screen state directly via store.setState (the
// established convention — see edts-zone.test.tsx). resetRegistryScreen is a synchronous
// set(), so unlike EdtsZone's loadEdtsBranches it needs no stub to avoid racing seeded state.
describe('RepoRegistryScreen', () => {
  it('always shows the static manifest-creation guidance, in every phase — never gated to first launch', async () => {
    const store = createAppStore();
    const output = await renderToString(<RepoRegistryScreen useStore={store} />);
    for (const line of MANIFEST_GUIDANCE_LINES) {
      expect(output).toContain(line);
    }
  });

  it('shows a root-path entry prompt before any scan has run', async () => {
    const store = createAppStore();
    const output = await renderToString(<RepoRegistryScreen useStore={store} />);
    expect(output).toContain('Root path:');
    expect(output).toContain('Type a path.');
    expect(await footerContextOf(store)).toBe('registry-path');
  });

  it('shows a scanning indicator while the scan is in flight', async () => {
    const store = createAppStore();
    store.setState({ registryScanStatus: 'loading' });
    const output = await renderToString(<RepoRegistryScreen useStore={store} />);
    expect(output).toContain('Scanning');
  });

  it('shows a distinct scan-failure state with its error detail — never indistinguishable from "nothing found"', async () => {
    const store = createAppStore();
    store.setState({ registryScanStatus: 'error', registryScanError: 'Scan root not found: /nope' });
    const output = await renderToString(<RepoRegistryScreen useStore={store} />);
    expect(output).toContain('Failed to scan');
    expect(output).toContain('Scan root not found: /nope');
    expect(output).not.toContain('No manifest-carrying repos found here');
  });

  it('shows a distinct "nothing found" state when the scan found zero candidates', async () => {
    const store = createAppStore();
    store.setState({ registryScanStatus: 'idle', registryScanResult: { candidates: [], skipped: [] } });
    const output = await renderToString(<RepoRegistryScreen useStore={store} />);
    expect(output).toContain('No manifest-carrying repos found here');
    expect(output).not.toContain('Failed to scan');
  });

  it('lists every scan candidate as a checkbox-list-item, unchecked, first one highlighted (UX-DR9)', async () => {
    const store = createAppStore();
    store.setState({
      registryScanStatus: 'idle',
      registryScanResult: { candidates: ['/repos/api-gateway', '/repos/route-explorer'], skipped: [] },
    });
    const output = await renderToString(<RepoRegistryScreen useStore={store} />);
    expect(output).toContain('/repos/api-gateway');
    expect(output).toContain('/repos/route-explorer');
    expect(output).toContain('[ ]');
    expect(await footerContextOf(store)).toBe('registry-candidates');

    // checkbox-list-item.tsx's own `selected` prop has no visible effect on its own, so the
    // highlighted (arrow-navigable, first) row must carry its own visible distinction —
    // present on that row's line, absent from every other candidate's line.
    const lines = output.split('\n');
    const highlightedLine = lines.find((line) => line.includes('/repos/api-gateway'));
    const otherLine = lines.find((line) => line.includes('/repos/route-explorer'));
    expect(highlightedLine).toContain('›');
    expect(otherLine).not.toContain('›');
  });

  it('shows a registering indicator while the register run is in flight', async () => {
    const store = createAppStore();
    store.setState({
      registryScanResult: { candidates: ['/repos/a'], skipped: [] },
      registryRegisterStatus: 'loading',
    });
    const output = await renderToString(<RepoRegistryScreen useStore={store} />);
    expect(output).toContain('Registering');
  });

  it('reports every selected path\'s outcome — registered / already-registered / failed', async () => {
    const store = createAppStore();
    store.setState({
      registryRegisterResults: [
        { path: '/repos/new', outcome: 'registered' },
        { path: '/repos/already', outcome: 'already-registered' },
        { path: '/repos/bad', outcome: 'failed', detail: 'Action already in progress' },
      ],
    });
    const output = await renderToString(<RepoRegistryScreen useStore={store} />);
    expect(output).toContain('/repos/new');
    expect(output).toContain('registered');
    expect(output).toContain('/repos/already');
    expect(output).toContain('already-registered');
    expect(output).toContain('/repos/bad');
    expect(output).toContain('failed');
    expect(output).toContain('Action already in progress');
    expect(await footerContextOf(store)).toBe('dismiss');
  });

  it('shows the Ctrl+L hint for "Clean stale entries" on the root-input screen', async () => {
    const store = createAppStore();
    const output = await renderToString(<RepoRegistryScreen useStore={store} />);
    expect(output).toContain('Stale registry entries');
    expect(FOOTER_CONTEXTS['registry-path'].hints).toContainEqual(['Ctrl+L', 'clean stale entries']);
  });
});

// "Clean stale entries" — classify (never write), then remove only the confirmed paths: the
// stale-candidate rows (unreachable/manifest-not-found, the EDT-member note), the distinct
// zero-candidates and scan-error states folded into 'clean-candidates', 'cleaning', and the
// per-path removed/failed outcomes.
describe('RepoRegistryScreen — Clean stale entries', () => {
  it('shows a scanning indicator while classification is in flight', async () => {
    const store = createAppStore();
    store.setState({ registryCleanScanStatus: 'loading' });
    const output = await renderToString(<RepoRegistryScreen useStore={store} />);
    expect(output).toContain('Scanning the registry for stale entries');
  });

  it('shows a distinct scan-failure state with its error detail', async () => {
    const store = createAppStore();
    store.setState({ registryCleanScanStatus: 'error', registryCleanScanError: 'bad yaml' });
    const output = await renderToString(<RepoRegistryScreen useStore={store} />);
    expect(output).toContain('Failed to scan');
    expect(output).toContain('bad yaml');
    expect(output).not.toContain('No stale registry entries found');
  });

  it('shows a distinct "no stale entries" state when classification finds zero candidates — never silent', async () => {
    const store = createAppStore();
    store.setState({ registryCleanScanStatus: 'idle', registryCleanCandidates: [] });
    const output = await renderToString(<RepoRegistryScreen useStore={store} />);
    expect(output).toContain('No stale registry entries found');
    expect(output).not.toContain('Failed to scan');
  });

  it('lists every stale candidate pre-checked, with its reason, and an EDT-member note when applicable', async () => {
    const store = createAppStore();
    store.setState({
      registryCleanScanStatus: 'idle',
      registryCleanCandidates: [
        { path: '/repos/gone', reason: 'unreachable', memberOfEdts: [] },
        { path: '/repos/unmanaged', reason: 'manifest-not-found', memberOfEdts: ['my-topic'] },
      ],
    });
    const output = await renderToString(<RepoRegistryScreen useStore={store} />);
    expect(output).toContain('/repos/gone');
    expect(output).toContain('unreachable');
    expect(output).toContain('/repos/unmanaged');
    expect(output).toContain('manifest-not-found');
    expect(output).toContain('[member of EDT: my-topic]');
    // Pre-checked by default — unlike scan/register's own candidates.
    expect(output).toContain('[x]');
    expect(output).not.toContain('[ ]');
    expect(await footerContextOf(store)).toBe('registry-stale');
  });

  it('reports a path that could not even be checked, alongside the candidate list — never silently dropped', async () => {
    const store = createAppStore();
    store.setState({
      registryCleanScanStatus: 'idle',
      registryCleanCandidates: [{ path: '/repos/gone', reason: 'unreachable', memberOfEdts: [] }],
      registryCleanErrors: [{ path: '/repos/unknown', code: 'registry-stat-error', message: 'permission denied' }],
    });
    const output = await renderToString(<RepoRegistryScreen useStore={store} />);
    expect(output).toContain('/repos/gone');
    expect(output).toContain('could not be checked');
    expect(output).toContain('/repos/unknown');
    expect(output).toContain('registry-stat-error');
  });

  it('reports a could-not-be-checked path even when there are zero removable candidates', async () => {
    const store = createAppStore();
    store.setState({
      registryCleanScanStatus: 'idle',
      registryCleanCandidates: [],
      registryCleanErrors: [{ path: '/repos/unknown', code: 'registry-stat-error', message: 'permission denied' }],
    });
    const output = await renderToString(<RepoRegistryScreen useStore={store} />);
    expect(output).toContain('No stale registry entries found');
    expect(output).toContain('could not be checked');
    expect(output).toContain('/repos/unknown');
  });

  it('shows a removing indicator while the removal run is in flight', async () => {
    const store = createAppStore();
    store.setState({
      registryCleanCandidates: [{ path: '/repos/a', reason: 'unreachable', memberOfEdts: [] }],
      registryCleanStatus: 'loading',
    });
    const output = await renderToString(<RepoRegistryScreen useStore={store} />);
    expect(output).toContain('Removing stale entries');
  });

  it('reports every confirmed path\'s outcome — removed / failed', async () => {
    const store = createAppStore();
    store.setState({
      registryCleanResults: [
        { path: '/repos/gone', outcome: 'removed' },
        { path: '/repos/bad', outcome: 'failed', detail: { code: 'registry-write-error', message: 'disk full' } },
      ],
    });
    const output = await renderToString(<RepoRegistryScreen useStore={store} />);
    expect(output).toContain('/repos/gone');
    expect(output).toContain('removed');
    expect(output).toContain('/repos/bad');
    expect(output).toContain('failed');
    expect(output).toContain('disk full');
    expect(await footerContextOf(store)).toBe('dismiss');
  });
});

// "Validate registered repos" — one-shot read-only validation over every
// registered path. Covers the matrix's per-repo outcome rows (valid / invalid + reason /
// unreachable / inconclusive), the distinct empty-registry and failure states folded into
// 'validate-results', the 'validating' in-flight state, and the Ctrl+V hint.
describe('RepoRegistryScreen — Validate registered repos', () => {
  it('shows the Ctrl+V hint for "Validate registered repos" on the root-input screen', async () => {
    const store = createAppStore();
    const output = await renderToString(<RepoRegistryScreen useStore={store} />);
    expect(output).toContain('Ctrl+V to validate registered repos');
  });

  it('shows a validating indicator while validation is in flight', async () => {
    const store = createAppStore();
    store.setState({ registryValidateStatus: 'loading' });
    const output = await renderToString(<RepoRegistryScreen useStore={store} />);
    expect(output).toContain('Validating registered repos');
  });

  it('shows a distinct validation-failure state with its error detail', async () => {
    const store = createAppStore();
    store.setState({ registryValidateStatus: 'error', registryValidateError: 'registry boom' });
    const output = await renderToString(<RepoRegistryScreen useStore={store} />);
    expect(output).toContain('Failed to validate');
    expect(output).toContain('registry boom');
    expect(output).not.toContain('No registered repos');
  });

  it('shows a distinct "no registered repos" state when validation finds zero paths — never silent', async () => {
    const store = createAppStore();
    store.setState({ registryValidateStatus: 'idle', registryValidateResults: [] });
    const output = await renderToString(<RepoRegistryScreen useStore={store} />);
    expect(output).toContain('No registered repos');
    expect(output).not.toContain('Failed to validate');
  });

  it('reports every path with its outcome — valid / invalid + reason / unreachable / inconclusive', async () => {
    const store = createAppStore();
    store.setState({
      registryValidateStatus: 'idle',
      registryValidateResults: [
        { path: '/repos/healthy', outcome: 'valid' },
        {
          path: '/repos/typo',
          outcome: 'invalid',
          detail: { code: 'shared-branch-missing', message: 'sharedBranch "release" not found locally nor on origin' },
        },
        { path: '/repos/gone', outcome: 'unreachable' },
        {
          path: '/repos/unknown',
          outcome: 'inconclusive',
          detail: { code: 'git-branch-check-error', message: 'Cannot verify branch state' },
        },
      ],
    });
    const output = await renderToString(<RepoRegistryScreen useStore={store} />);
    expect(output).toContain('/repos/healthy');
    expect(output).toContain('valid');
    expect(output).toContain('/repos/typo');
    expect(output).toContain('invalid');
    expect(output).toContain('not found locally nor on origin');
    expect(output).toContain('/repos/gone');
    expect(output).toContain('unreachable');
    expect(output).toContain('/repos/unknown');
    expect(output).toContain('inconclusive');
  });
});
