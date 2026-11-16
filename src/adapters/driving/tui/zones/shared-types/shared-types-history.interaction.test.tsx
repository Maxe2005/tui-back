// History view interactions (real keypresses): availability gating, mode switch, streamed rows,
// Esc cancel, Enter pre-filling the form, inertness under overlays and a bounded result list.
import { createElement } from 'react';
import { Box, render } from 'ink';
import { describe, expect, it, vi } from 'vitest';
import { createAppStore } from '../../store/app-store.js';
import { fakeInteractiveTtyStdin, FakeTtyStdout, KEYS } from '../../shared/test-support/fake-tty.js';
import { footerIdOf } from '../../shared/test-support/mount-for-test.js';
import { SharedTypesZone } from './shared-types-zone.js';

const CONSUMERS = [
  { service: 'api', repoPath: '/r/api', branch: 'feat/x', dependency: '@ianord/shared-types', packageJsonPath: 'package.json' },
];
const SOURCE = { service: 'source', repoPath: '/r/source', branch: 'feat/x', publishCommand: 'npm run v', packageName: '@ianord/shared-types' };
const ENTRY = (version: string) => ({ version, commit: `abcdef${version}`, date: '2026-01-03T10:00:00Z', branch: 'feat/x' });

function seed(extra: Record<string, unknown> = {}) {
  const store = createAppStore();
  const startSharedTypesHistorySearch = vi.fn(async () => {});
  const cancelSharedTypesHistorySearch = vi.fn();
  store.setState({
    sharedTypesConsumersStatus: 'ready',
    sharedTypesConsumers: CONSUMERS,
    loadSharedTypesConsumers: async () => {},
    sharedTypesSourcesStatus: 'ready',
    sharedTypesSources: [SOURCE],
    loadSharedTypesSource: async () => {},
    loadSharedTypesHistoryBranches: async () => {},
    sharedTypesHistoryBranchesStatus: 'ready',
    sharedTypesHistoryBranches: ['development', 'feat/x'],
    startSharedTypesHistorySearch,
    cancelSharedTypesHistorySearch,
    ...extra,
  });
  return { store, startSharedTypesHistorySearch, cancelSharedTypesHistorySearch };
}

function mount(store: ReturnType<typeof createAppStore>, rows = 30) {
  const stdout = new FakeTtyStdout();
  Object.assign(stdout, { columns: 100, rows });
  const stdin = fakeInteractiveTtyStdin();
  const instance = render(createElement(Box, { flexDirection: 'column', height: rows }, createElement(SharedTypesZone, { useStore: store })), {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin,
    interactive: true,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  return { instance, stdout, stdin };
}

async function press(instance: ReturnType<typeof render>, stdin: NodeJS.ReadStream, sequence: string): Promise<void> {
  (stdin as unknown as { write: (chunk: string) => void }).write(sequence);
  await instance.waitUntilRenderFlush();
  await new Promise((resolve) => setTimeout(resolve, sequence === KEYS.escape ? 80 : 10));
}

// Ink repaints the whole zone each render: the text after the last title is the current frame.
function lastFrame(output: string): string {
  return output.slice(output.lastIndexOf('SHARED TYPES'));
}

describe('SharedTypesZone history', () => {
  it('opens on H with the source repo and shows the mode-switch key in the footer context', async () => {
    const { store } = seed();
    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      expect(lastFrame(stdout.output)).toContain('[H] history');
      await press(instance, stdin, 'h');
      expect(lastFrame(stdout.output)).toContain('HISTORY by branch');
      expect(store.getState().zoneInputCaptured).toBe(true);
      await press(instance, stdin, KEYS.tab);
      expect(lastFrame(stdout.output)).toContain('HISTORY by version');
      await press(instance, stdin, KEYS.escape);
      expect(store.getState().zoneInputCaptured).toBe(false);
    } finally {
      instance.unmount();
    }
  });

  it('is unavailable without the source repo and says why', async () => {
    const { store } = seed({ sharedTypesSources: [], sharedTypesSourcesStatus: 'ready' });
    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, 'h');
      expect(lastFrame(stdout.output)).toContain('History is unavailable');
      expect(lastFrame(stdout.output)).not.toContain('HISTORY by branch');
    } finally {
      instance.unmount();
    }
  });

  it('starts a search on the typed branch, cancels with Esc and does not search an invalid version', async () => {
    const { store, startSharedTypesHistorySearch, cancelSharedTypesHistorySearch } = seed();
    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, 'h');
      for (const char of 'feat/x') {
        await press(instance, stdin, char);
      }
      await press(instance, stdin, KEYS.enter);
      expect(startSharedTypesHistorySearch).toHaveBeenCalledWith({ mode: 'branch', query: 'feat/x' });

      store.setState({ sharedTypesHistory: { ...store.getState().sharedTypesHistory, mode: 'branch', status: 'searching' } });
      await press(instance, stdin, KEYS.escape);
      expect(cancelSharedTypesHistorySearch).toHaveBeenCalledTimes(1);

      store.setState({ sharedTypesHistory: { ...store.getState().sharedTypesHistory, status: 'done' } });
      await press(instance, stdin, KEYS.tab);
      for (const char of '0.1') {
        await press(instance, stdin, char);
      }
      await press(instance, stdin, KEYS.enter);
      expect(startSharedTypesHistorySearch).toHaveBeenCalledTimes(1);
      expect(lastFrame(stdout.output)).toContain('MAJOR.MINOR.PATCH');
    } finally {
      instance.unmount();
    }
  });

  it('pre-fills the form with the version of the row Enter is pressed on', async () => {
    const { store } = seed({
      sharedTypesHistory: {
        mode: 'branch', status: 'done', query: 'feat/x', entries: [ENTRY('0.1.3770'), ENTRY('0.1.3769')], hits: [], found: null,
        earliestBranch: null, truncated: false, endedBy: 'depth', scanned: 2, error: null, depth: 2, maxScanned: 1000,
      },
    });
    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, 'h');
      // History resets its state on open, so seed the rows again as a finished search.
      store.setState({
        sharedTypesHistory: {
          mode: 'branch', status: 'done', query: 'feat/x', entries: [ENTRY('0.1.3770'), ENTRY('0.1.3769')], hits: [], found: null,
          earliestBranch: null, truncated: false, endedBy: 'depth', scanned: 2, error: null, depth: 2, maxScanned: 1000,
        },
      });
      await press(instance, stdin, KEYS.escape); // leave the field
      await press(instance, stdin, KEYS.down);
      expect(lastFrame(stdout.output)).toContain('stopped: depth 2');
      await press(instance, stdin, KEYS.enter);
      expect(lastFrame(stdout.output)).toContain('0.1.3769');
      expect(lastFrame(stdout.output)).toContain('Version');
      expect(lastFrame(stdout.output)).not.toContain('HISTORY by branch');
    } finally {
      instance.unmount();
    }
  });

  it('is inert while ? or :settings is open', async () => {
    const { store, startSharedTypesHistorySearch } = seed();
    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      store.setState({ helpOpen: true });
      await press(instance, stdin, 'h');
      expect(lastFrame(stdout.output)).not.toContain('HISTORY by branch');
      store.setState({ helpOpen: false });
      await press(instance, stdin, 'h');
      store.setState({ settingsScreenOpen: true });
      await press(instance, stdin, 'x');
      await press(instance, stdin, KEYS.enter);
      expect(startSharedTypesHistorySearch).not.toHaveBeenCalled();
    } finally {
      instance.unmount();
    }
  });

  it('windows a long result list within the terminal height', async () => {
    const entries = Array.from({ length: 150 }, (_, index) => ENTRY(`0.1.${String(index)}`));
    const { store } = seed();
    const { instance, stdout, stdin } = mount(store, 20);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, 'h');
      store.setState({
        sharedTypesHistory: {
          mode: 'branch', status: 'done', query: 'b', entries, hits: [], found: null, truncated: false, earliestBranch: null, endedBy: 'depth', scanned: 150, error: null, depth: 150, maxScanned: 1000,
        },
      });
      await press(instance, stdin, KEYS.escape);
      await instance.waitUntilRenderFlush();
      const frame = lastFrame(stdout.output);
      expect(frame).toContain('more below');
      expect(frame).not.toContain('0.1.149  ');
    } finally {
      instance.unmount();
    }
  });

  it('by version: Enter on a hit pre-fills the form with the searched version', async () => {
    const { store } = seed();
    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, 'h');
      await press(instance, stdin, KEYS.tab); // by version
      store.setState({
        sharedTypesHistory: {
          mode: 'version', status: 'done', query: '0.1.3770', entries: [], found: true, truncated: false, earliestBranch: 'main',
          hits: [{ commit: 'abcdef0123', date: '2026-01-03T10:00:00Z', branches: ['main', 'origin/main'], earliest: true }],
          endedBy: null, scanned: 0, error: null, depth: 20, maxScanned: 1000,
        },
      });
      await press(instance, stdin, KEYS.escape); // leave the field
      expect(lastFrame(stdout.output)).toContain('abcdef0');
      expect(lastFrame(stdout.output)).toContain('earliest introduced on main');
      await press(instance, stdin, KEYS.enter);
      expect(lastFrame(stdout.output)).toContain('0.1.3770');
      expect(lastFrame(stdout.output)).not.toContain('HISTORY by version');
    } finally {
      instance.unmount();
    }
  });

  it('by version: a truncated miss is not reported as not found', async () => {
    const { store } = seed();
    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, 'h');
      await press(instance, stdin, KEYS.tab);
      store.setState({
        sharedTypesHistory: {
          mode: 'version', status: 'done', query: '9.9.9', entries: [], hits: [], found: false, truncated: true, earliestBranch: null,
          endedBy: null, scanned: 0, error: null, depth: 20, maxScanned: 1000,
        },
      });
      await press(instance, stdin, KEYS.up);
      expect(lastFrame(stdout.output)).toContain('not found so far');
      expect(lastFrame(stdout.output)).not.toContain('nothing is fetched');
    } finally {
      instance.unmount();
    }
  });

  it('shows the not-found wording for a complete by-version miss', async () => {
    const { store } = seed();
    const { instance, stdout, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, 'h');
      await press(instance, stdin, KEYS.tab);
      store.setState({
        sharedTypesHistory: {
          mode: 'version', status: 'done', query: '9.9.9', entries: [], hits: [], found: false, truncated: false, earliestBranch: null,
          endedBy: null, scanned: 0, error: null, depth: 20, maxScanned: 1000,
        },
      });
      await press(instance, stdin, KEYS.up);
      expect(lastFrame(stdout.output)).toContain('not found on any local or already-fetched branch (nothing is fetched)');
    } finally {
      instance.unmount();
    }
  });

  it('does not advertise "new search" while a running search has the result rows focused', async () => {
    const { store } = seed();
    const { instance, stdin } = mount(store);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, 'h');
      store.setState({
        sharedTypesHistory: {
          mode: 'branch', status: 'searching', query: 'b', entries: [ENTRY('0.1.2')], hits: [], found: null, truncated: false, earliestBranch: null,
          endedBy: null, scanned: 0, error: null, depth: 20, maxScanned: 1000,
        },
      });
      await press(instance, stdin, 'x'); // re-render with the searching state, still editing
      expect(footerIdOf(store)).toBe('shared-types-history-running');
      store.setState({ cancelSharedTypesHistorySearch: vi.fn() });
      // Esc while searching cancels (the walk stays "searching" in this fake), so move focus by Up/Down instead.
      await press(instance, stdin, KEYS.down);
      expect(footerIdOf(store)).toBe('shared-types-history-running');
    } finally {
      instance.unmount();
    }
  });
});
