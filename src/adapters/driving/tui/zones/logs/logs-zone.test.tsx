// tui/zones/logs: render-level smoke coverage (AD-13) for story 5.1 — mirrors
// edts-zone.test.tsx/routes-zone.test.tsx's own renderToString convention. `renderToString`'s
// fake stdin never emits data, so every keystroke-driven behavior lives in
// logs-zone.interaction.test.tsx (real keypress round-trips) and logs-zone.logic.test.ts (the
// pure functions themselves) instead — this file only asserts what a given store state
// renders.
import { describe, expect, it } from 'vitest';
import type { EdtRegistryEntry } from '../../../../../core/ports/edt-registry.js';
import type { ServiceBranchDivergence } from '../../../../../core/edt/list.js';
import { createAppStore } from '../../store/app-store.js';
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

describe('LogsZone (story 5.1)', () => {
  it('AC: with no service selected, both lists render and the grid area shows the empty-state message', async () => {
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
        },
      },
    });

    const output = await renderToString(<LogsZone useStore={store} />);

    expect(output).toContain('hello world');
    expect(output).not.toContain('No service selected');
  });

  it('renders a pane\'s streamError as a dim annotation (I/O matrix DOCKER_UNAVAILABLE)', async () => {
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
        },
      },
    });

    const output = await renderToString(<LogsZone useStore={store} />);

    expect(output).toContain('Docker is unavailable for container "ctr-route-explorer"');
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
        },
      },
    });

    const output = await renderToString(<LogsZone useStore={store} />);

    expect(output).toContain('fullscreen line');
    expect(output).toContain('[Esc] back');
    // The grid/list chrome is not shown while fullscreen owns the view.
    expect(output).not.toContain('ACTIVE EDT MEMBERS');
  });
});
