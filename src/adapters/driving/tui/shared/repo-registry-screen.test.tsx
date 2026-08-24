// tui/shared/repo-registry-screen: render tests (AD-13 — Ink smoke coverage) for story
// 2.11's registry screen, covering every I/O-matrix row: root-input, scanning, distinct
// empty-vs-error scan outcomes, candidate multi-select, registering, and per-path register
// outcomes (registered/already-registered/failed) — plus the pure key-handling functions
// driving root-text entry and candidate navigation/selection (the shared renderToString
// harness's fake stdin never emits data, so useInput itself is never exercised by a test —
// see render-to-string.ts and edts-zone.test.tsx for the established convention).
import { describe, it, expect } from 'vitest';
import { createAppStore } from '../store/app-store.js';
import { renderToString } from './components/render-to-string.js';
import {
  MANIFEST_GUIDANCE_LINES,
  RepoRegistryScreen,
  backspaceRootInput,
  moveCandidateCursor,
  resolveRegistryScreenPhase,
  toggleCandidateSelection,
  typeRootInputChar,
} from './repo-registry-screen.js';

describe('resolveRegistryScreenPhase', () => {
  const base = {
    registryScanStatus: 'idle' as const,
    registryScanResult: null,
    registryRegisterStatus: 'idle' as const,
    registryRegisterResults: null,
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

describe('moveCandidateCursor', () => {
  it('moves down and up by one', () => {
    expect(moveCandidateCursor(0, 'down', 3)).toBe(1);
    expect(moveCandidateCursor(1, 'up', 3)).toBe(0);
  });

  it('clamps at both bounds', () => {
    expect(moveCandidateCursor(2, 'down', 3)).toBe(2);
    expect(moveCandidateCursor(0, 'up', 3)).toBe(0);
  });

  it('always returns 0 for an empty list', () => {
    expect(moveCandidateCursor(0, 'down', 0)).toBe(0);
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

// Every render test below seeds registry-screen state directly via store.setState (the
// established convention — see edts-zone.test.tsx). resetRegistryScreen is a synchronous
// set(), so unlike EdtsZone's loadEdtsBranches it needs no stub to avoid racing seeded state.
describe('RepoRegistryScreen (story 2.11)', () => {
  it('always shows the static manifest-creation guidance, in every phase — never gated to first launch (AC1)', async () => {
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
    expect(output).toContain('Type a path, then Enter to scan.');
  });

  it('shows a scanning indicator while the scan is in flight', async () => {
    const store = createAppStore();
    store.setState({ registryScanStatus: 'loading' });
    const output = await renderToString(<RepoRegistryScreen useStore={store} />);
    expect(output).toContain('Scanning');
  });

  it('shows a distinct scan-failure state with its error detail — never indistinguishable from "nothing found" (matrix)', async () => {
    const store = createAppStore();
    store.setState({ registryScanStatus: 'error', registryScanError: 'Scan root not found: /nope' });
    const output = await renderToString(<RepoRegistryScreen useStore={store} />);
    expect(output).toContain('Scan failed');
    expect(output).toContain('Scan root not found: /nope');
    expect(output).not.toContain('No manifest-carrying repos found here');
  });

  it('shows a distinct "nothing found" state when the scan found zero candidates', async () => {
    const store = createAppStore();
    store.setState({ registryScanStatus: 'idle', registryScanResult: { candidates: [], skipped: [] } });
    const output = await renderToString(<RepoRegistryScreen useStore={store} />);
    expect(output).toContain('No manifest-carrying repos found here');
    expect(output).not.toContain('Scan failed');
  });

  it('lists every scan candidate as a checkbox-list-item, unchecked, first one highlighted (AC3, UX-DR9)', async () => {
    const store = createAppStore();
    store.setState({
      registryScanStatus: 'idle',
      registryScanResult: { candidates: ['/repos/api-gateway', '/repos/route-explorer'], skipped: [] },
    });
    const output = await renderToString(<RepoRegistryScreen useStore={store} />);
    expect(output).toContain('/repos/api-gateway');
    expect(output).toContain('/repos/route-explorer');
    expect(output).toContain('[ ]');
    expect(output).toContain('Space to toggle, Enter to register the selection.');

    // review patch: checkbox-list-item.tsx's own `selected` prop has no visible effect on
    // its own, so the highlighted (arrow-navigable, first) row must carry its own visible
    // distinction — present on that row's line, absent from every other candidate's line.
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

  it('reports every selected path\'s outcome — registered / already-registered / failed (AC4)', async () => {
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
    expect(output).toContain('Esc to close.');
  });
});
