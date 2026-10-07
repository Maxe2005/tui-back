// tui/zones/logs: render-level smoke coverage — asserts only what a given store state renders.
// renderToString's fake stdin never emits keys, so keystroke behavior lives in
// logs-zone.interaction.test.tsx and logs-zone.logic.test.ts.
import { describe, expect, it } from 'vitest';
import type { EdtRegistryEntry } from '../../../../../core/ports/edt-registry.js';
import type { ServiceBranchDivergence } from '../../../../../core/edt/list.js';
import { createAppStore } from '../../store/app-store.js';
import { footerContextOf } from '../../shared/components/mount-for-test.js';
import { renderToString } from '../../shared/components/render-to-string.js';
import { LogsZone } from './logs-zone.js';

function service(overrides: Partial<ServiceBranchDivergence> = {}): ServiceBranchDivergence {
  return {
    service: 'route-explorer',
    path: '/repos/route-explorer',
    isMember: false,
    branch: 'main',
    ahead: 0,
    behind: 0,
    status: 'current',
    sharedBranch: 'development',
    protectedBranches: [],
    ...overrides,
  };
}

function edt(overrides: Partial<EdtRegistryEntry> = {}): EdtRegistryEntry {
  return {
    ulid: 'active-ulid',
    topic: 'active-edt',
    createdAt: '2026-01-01T00:00:00.000Z',
    status: 'active',
    members: [],
    ...overrides,
  };
}

describe('LogsZone', () => {
  it('with no service selected, both lists render and the grid area shows the empty-state message', async () => {
    const store = createAppStore();
    store.setState({
      edts: [edt({ members: [{ service: 'api-gateway', repoPath: '/repos/api-gateway', branch: 'main' }] })],
      edtsStatus: 'idle',
      activeEdt: 'active-ulid',
      edtsBranches: [
        service({ service: 'api-gateway', path: '/repos/api-gateway', isMember: true }),
        service({ service: 'route-explorer', path: '/repos/route-explorer', isMember: false }),
      ],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
    });

    const output = await renderToString(<LogsZone useStore={store} />);

    expect(output).toContain('LOGS');
    expect(output).toContain('ACTIVE EDT MEMBERS');
    expect(output).toContain('api-gateway');
    expect(output).toContain('OTHER SERVICES');
    expect(output).toContain('route-explorer');
    expect(output).toContain('No service selected');
  });

  it('advertises W (not Ctrl+W) for wrapping every pane in the hint list', async () => {
    const store = createAppStore();
    store.setState({ edts: [], edtsStatus: 'idle', activeEdt: null, edtsBranches: [], edtsBranchesStatus: 'idle', loadEdts: async () => {}, loadEdtsBranches: async () => {} });

    const output = await renderToString(<LogsZone useStore={store} />);

    expect(output).toContain('[W] wrap/truncate all');
    expect(output).not.toContain('[Ctrl+W]');
  });

  it('shows "No active EDT." in the EDT-members list, with every service falling to OTHER SERVICES, when no EDT is active', async () => {
    const store = createAppStore();
    store.setState({
      edts: [],
      edtsStatus: 'idle',
      activeEdt: null,
      edtsBranches: [service({ service: 'route-explorer', path: '/repos/route-explorer' })],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
    });

    const output = await renderToString(<LogsZone useStore={store} />);

    expect(output).toContain('No active EDT.');
    expect(output).toContain('route-explorer');
  });

  it('shows a loading indicator while the services fetch is in flight (first load, no rows yet)', async () => {
    const store = createAppStore();
    store.setState({
      edts: null,
      edtsStatus: 'idle',
      activeEdt: null,
      edtsBranches: null,
      edtsBranchesStatus: 'loading',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
    });

    const output = await renderToString(<LogsZone useStore={store} />);

    expect(output).toContain('Loading services…');
  });

  it('shows a failure banner and no stale rows when the services fetch errors', async () => {
    const store = createAppStore();
    store.setState({
      edts: [],
      edtsStatus: 'idle',
      activeEdt: null,
      edtsBranches: [service({ service: 'route-explorer', path: '/repos/route-explorer' })],
      edtsBranchesStatus: 'error',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
    });

    const output = await renderToString(<LogsZone useStore={store} />);

    expect(output).toContain('Failed to load services');
    expect(output).not.toContain('route-explorer');
  });

  it('renders a selected service into a grid pane, showing its buffered lines', async () => {
    const store = createAppStore();
    store.setState({
      edts: [],
      edtsStatus: 'idle',
      activeEdt: null,
      edtsBranches: [service({ service: 'route-explorer', path: '/repos/route-explorer' })],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      logsOtherSelected: ['/repos/route-explorer'],
      logsPanes: {
        '/repos/route-explorer': {
          repoPath: '/repos/route-explorer',
          service: 'route-explorer',
          lines: [{ timestamp: '2026-01-01T00:00:00.000Z', stream: 'stdout', text: 'hello world' }],
          streamError: null,
          noMoreHistory: false,
          scrollOffset: 0,
          health: 'up',
          restarting: false,
        },
      },
    });

    const output = await renderToString(<LogsZone useStore={store} />);

    expect(output).toContain('hello world');
    expect(output).not.toContain('No service selected');
  });

  it('renders a pane\'s streamError as a dim annotation', async () => {
    const store = createAppStore();
    store.setState({
      edts: [],
      edtsStatus: 'idle',
      activeEdt: null,
      edtsBranches: [service({ service: 'route-explorer', path: '/repos/route-explorer' })],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      logsOtherSelected: ['/repos/route-explorer'],
      logsPanes: {
        '/repos/route-explorer': {
          repoPath: '/repos/route-explorer',
          service: 'route-explorer',
          lines: [],
          streamError: { code: 'docker-unavailable', message: 'Docker is unavailable for container "ctr-route-explorer"' },
          noMoreHistory: false,
          scrollOffset: 0,
          health: 'down',
          restarting: false,
        },
      },
    });

    const output = await renderToString(<LogsZone useStore={store} />);

    expect(output).toContain('Docker is unavailable for container "ctr-route-explorer"');
  });

  it('renders a container-less pane with the no-container badge, no restart hint, and the no-logs empty state', async () => {
    const store = createAppStore();
    store.setState({
      edts: [],
      edtsStatus: 'idle',
      activeEdt: null,
      edtsBranches: [service({ service: 'shared-types', path: '/repos/shared-types' })],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      logsOtherSelected: ['/repos/shared-types'],
      logsPanes: {
        '/repos/shared-types': {
          repoPath: '/repos/shared-types',
          service: 'shared-types',
          lines: [],
          streamError: null,
          noMoreHistory: false,
          scrollOffset: 0,
          health: 'no-container',
          restarting: false,
        },
      },
    });

    const output = await renderToString(<LogsZone useStore={store} />);

    expect(output).toContain('No container — no logs');
    expect(output).toContain('no container');
    // The pane header carries no restart control (the global hints list still
    // advertises the key; the per-pane press is guarded).
    expect(output).not.toMatch(/no container\s*\[R\]/);
    expect(output).not.toContain('[R] restarting');
    expect(output).not.toContain('Waiting for logs');
  });

  it('renders the fullscreen preview view in place of the grid when logsFullscreenTarget is set', async () => {
    const store = createAppStore();
    store.setState({
      edts: [],
      edtsStatus: 'idle',
      activeEdt: null,
      edtsBranches: [service({ service: 'route-explorer', path: '/repos/route-explorer' })],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      logsFullscreenTarget: '/repos/route-explorer',
      logsPanes: {
        '/repos/route-explorer': {
          repoPath: '/repos/route-explorer',
          service: 'route-explorer',
          lines: [{ timestamp: '2026-01-01T00:00:00.000Z', stream: 'stdout', text: 'fullscreen line' }],
          streamError: null,
          noMoreHistory: false,
          scrollOffset: 0,
          health: 'up',
          restarting: false,
        },
      },
    });

    const output = await renderToString(<LogsZone useStore={store} />);

    expect(output).toContain('fullscreen line');
    expect(await footerContextOf(store, <LogsZone useStore={store} />)).toBe('logs-fullscreen');
    // The grid/list chrome is not shown while fullscreen owns the view.
    expect(output).not.toContain('ACTIVE EDT MEMBERS');
  });

  it('renders a restarting fullscreen pane with the explicit label, never the bare state', async () => {
    const store = createAppStore();
    store.setState({
      edts: [],
      edtsStatus: 'idle',
      activeEdt: null,
      edtsBranches: [service({ service: 'route-explorer', path: '/repos/route-explorer' })],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      logsFullscreenTarget: '/repos/route-explorer',
      logsPanes: {
        '/repos/route-explorer': {
          repoPath: '/repos/route-explorer',
          service: 'route-explorer',
          lines: [],
          streamError: null,
          noMoreHistory: false,
          scrollOffset: 0,
          health: 'up',
          restarting: true,
        },
      },
    });

    const output = await renderToString(<LogsZone useStore={store} />);

    expect(output).toContain('re-verifying');
  });

  it('renders one inline health badge glyph per pane state: up → ●, down → ○, restarting → ⣾', async () => {
    function pane(path: string, name: string, health: 'up' | 'down' | 'restarting') {
      return {
        repoPath: path,
        service: name,
        lines: [],
        streamError: null,
        noMoreHistory: false,
        scrollOffset: 0,
        health,
        restarting: false,
      };
    }
    const store = createAppStore();
    store.setState({
      edts: [],
      edtsStatus: 'idle',
      activeEdt: null,
      edtsBranches: [
        service({ service: 'svc-up', path: '/repos/svc-up' }),
        service({ service: 'svc-down', path: '/repos/svc-down' }),
        service({ service: 'svc-restarting', path: '/repos/svc-restarting' }),
      ],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      logsOtherSelected: ['/repos/svc-up', '/repos/svc-down', '/repos/svc-restarting'],
      logsPanes: {
        '/repos/svc-up': pane('/repos/svc-up', 'svc-up', 'up'),
        '/repos/svc-down': pane('/repos/svc-down', 'svc-down', 'down'),
        '/repos/svc-restarting': pane('/repos/svc-restarting', 'svc-restarting', 'restarting'),
      },
    });

    const output = await renderToString(<LogsZone useStore={store} />);

    // Glyphs come from StatusBadge via healthBadgeState — the text labels and the
    // `[R] restarting…` hint are driven independently, so only these assert the mapping.
    expect(output).toContain('●');
    expect(output).toContain('○');
    expect(output).toContain('⣾');
  });

  // Bounds the OTHER SERVICES list (and the hints panel below it) to the terminal's actual row
  // count instead of rendering every row — an overflow corrupts Ink's diff-render.
  it('a very long OTHER SERVICES list is bounded with a "more below" indicator, never rendering past the terminal', async () => {
    const store = createAppStore();
    store.setState({
      edts: [],
      edtsStatus: 'idle',
      activeEdt: null,
      edtsBranches: Array.from({ length: 60 }, (_, i) => service({ service: `svc-${i}`, path: `/repos/svc-${i}` })),
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
    });

    const output = await renderToString(<LogsZone useStore={store} />);

    expect(output).toContain('svc-0');
    expect(output).not.toContain('svc-59');
    expect(output).toContain('more below');
  });

  // A handful of services never triggers the indicator.
  it('NO_OVERFLOW: a short services list renders with no scroll indicator', async () => {
    const store = createAppStore();
    store.setState({
      edts: [],
      edtsStatus: 'idle',
      activeEdt: null,
      edtsBranches: [service({ service: 'route-explorer', path: '/repos/route-explorer' })],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
    });

    const output = await renderToString(<LogsZone useStore={store} />);

    expect(output).not.toContain('more above');
    expect(output).not.toContain('more below');
  });

  // An empty ACTIVE EDT MEMBERS list still renders a 1-row "No active EDT." placeholder, which the
  // OTHER SERVICES budget must subtract. 30 services is the exact boundary at the default 120x40
  // test terminal (listsContentBudget 30, minus the 1 placeholder row = 29): it overflows by
  // exactly one.
  it('the empty ACTIVE EDT MEMBERS placeholder counts toward the budget OTHER SERVICES is handed', async () => {
    const store = createAppStore();
    store.setState({
      edts: [],
      edtsStatus: 'idle',
      activeEdt: null,
      edtsBranches: Array.from({ length: 30 }, (_, i) => service({ service: `svc-${i}`, path: `/repos/svc-${i}` })),
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
    });

    const output = await renderToString(<LogsZone useStore={store} />);

    expect(output).toContain('No active EDT.');
    expect(output).toContain('more below');
  });

  it('container-less rows render only in the info-only without-container section, once each, never as selectable rows', async () => {
    const store = createAppStore();
    store.setState({
      edts: [edt({ members: [{ service: 'lib-a', repoPath: '/repos/lib-a', branch: 'main' }] })],
      edtsStatus: 'idle',
      activeEdt: 'active-ulid',
      edtsBranches: [
        service({ service: 'lib-a', path: '/repos/lib-a', isMember: true }),
        service({ service: 'lib-b', path: '/repos/lib-b', isMember: false }),
        service({ service: 'api-gateway', path: '/repos/api-gateway', isMember: false }),
      ],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      logsNoContainer: { '/repos/lib-a': true, '/repos/lib-b': true },
    });

    const output = await renderToString(<LogsZone useStore={store} />);

    expect(output).toContain('SERVICES WITHOUT CONTAINER');
    // The narrow list column word-wraps long lines — normalize before matching text.
    const flat = output.replace(/\s+/g, ' ');
    expect(flat).toContain('Info only — not selectable.');
    expect(flat).toContain('no container');
    // Each container-less service renders exactly once (the info-only row), never additionally
    // in its old membership list; the member's departure empties the EDT-members list.
    expect(output.split('lib-a').length - 1).toBe(1);
    expect(output.split('lib-b').length - 1).toBe(1);
    expect(flat).toContain('No services in the active EDT.');
    expect(output).toContain('api-gateway');
  });

  it('rows with unresolved presence stay in their membership list and no third section renders', async () => {
    const store = createAppStore();
    store.setState({
      edts: [],
      edtsStatus: 'idle',
      activeEdt: null,
      edtsBranches: [service({ service: 'route-explorer', path: '/repos/route-explorer' })],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
    });

    const output = await renderToString(<LogsZone useStore={store} />);

    expect(output).not.toContain('SERVICES WITHOUT CONTAINER');
    expect(output).toContain('route-explorer');
  });

  it('every listed row carries a badge without any subscription, defaulting to down', async () => {
    const store = createAppStore();
    store.setState({
      edts: [],
      edtsStatus: 'idle',
      activeEdt: null,
      edtsBranches: [service({ service: 'route-explorer', path: '/repos/route-explorer' })],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
    });

    const output = await renderToString(<LogsZone useStore={store} />);

    expect(output).toContain('○');
    expect(output).toContain('down');
  });

  it('listed-row health fills the badge without a subscription', async () => {
    const store = createAppStore();
    store.setState({
      edts: [],
      edtsStatus: 'idle',
      activeEdt: null,
      edtsBranches: [service({ service: 'route-explorer', path: '/repos/route-explorer' })],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      logsListedHealth: { '/repos/route-explorer': 'up' },
    });

    const output = await renderToString(<LogsZone useStore={store} />);

    expect(output).toContain('●');
    expect(output).toContain('up');
  });

  it('a restarting row names the request and the re-verification, from the health or the in-flight flag', async () => {
    const store = createAppStore();
    store.setState({
      edts: [],
      edtsStatus: 'idle',
      activeEdt: null,
      edtsBranches: [
        service({ service: 'svc-health', path: '/repos/svc-health' }),
        service({ service: 'svc-flag', path: '/repos/svc-flag' }),
      ],
      edtsBranchesStatus: 'idle',
      loadEdts: async () => {},
      loadEdtsBranches: async () => {},
      logsPanes: {
        '/repos/svc-health': {
          repoPath: '/repos/svc-health',
          service: 'svc-health',
          lines: [],
          streamError: null,
          noMoreHistory: false,
          scrollOffset: 0,
          health: 'restarting',
          restarting: false,
        },
        '/repos/svc-flag': {
          repoPath: '/repos/svc-flag',
          service: 'svc-flag',
          lines: [],
          streamError: null,
          noMoreHistory: false,
          scrollOffset: 0,
          health: 'up',
          restarting: true,
        },
      },
    });

    const output = await renderToString(<LogsZone useStore={store} />);

    // The exact wording is locked in the logic unit tests; the narrow list column word-wraps
    // (and the grid interleaves columns), so here assert the distinctive new token reaches the
    // screen while the bare state reads nowhere.
    const flat = output.replace(/\s+/g, ' ');
    expect(flat).toContain('re-verifying');
    expect(flat).not.toContain('restarting');
    expect(output).toContain('⣾');
  });
});
