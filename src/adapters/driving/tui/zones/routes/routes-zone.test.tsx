// tui/zones/routes: render tests (AD-13 — Ink smoke coverage) for story 2.13's `disabled`
// explanatory message plus story 6.1's real list/detail content: spinner while loading,
// the three visibly distinct failure/empty/not-activated states, and the route list itself
// seeded straight into the store (renderToString performs one synchronous render pass, so
// the mount-time loadRoutes effect is seeded around, not through).
import { describe, it, expect } from 'vitest';
import { createAppStore } from '../../store/app-store.js';
import { renderToString } from '../../shared/components/render-to-string.js';
import { RoutesZone, formatRoutesDisabledMessage } from './routes-zone.js';

describe('formatRoutesDisabledMessage', () => {
  it('names every carrying service', () => {
    const message = formatRoutesDisabledMessage(['api-gateway', 'orders-api']);
    expect(message).toContain('api-gateway');
    expect(message).toContain('orders-api');
  });
});

describe('RoutesZone (story 2.13)', () => {
  it('shows the explanatory message naming the carrying services when disabled', async () => {
    const store = createAppStore();
    store.setState({
      tabVisibility: {
        routes: { status: 'disabled', carryingServices: ['api-gateway', 'orders-api'] },
        sharedTypes: { status: 'omitted', carryingServices: [] },
      },
    });
    const output = await renderToString(<RoutesZone useStore={store} />);
    expect(output).toContain('api-gateway');
    expect(output).toContain('orders-api');
    expect(output).not.toContain('ROUTES');
  });
});

describe('RoutesZone (story 6.1)', () => {
  it('shows a spinner while routes are loading', async () => {
    const store = createAppStore();
    // One-shot render idiom (mirrors logs-zone.test.tsx): stub the mount-time loader so
    // the seeded pre-load state survives to capture.
    store.setState({ loadRoutes: async () => {} });
    const output = await renderToString(<RoutesZone useStore={store} />);
    expect(output).toContain('⣾');
    expect(output).toContain('Loading routes');
  });

  it('lists every discovered METHOD + path row with the focused route in the detail pane', async () => {
    const store = createAppStore();
    store.setState({
      routesStatus: 'ready',
      routesRepoPath: '/repos/gateway',
      routes: [
        { method: 'GET', path: '/users', summary: 'List users' },
        { method: 'POST', path: '/users', summary: 'Create a user' },
      ],
      routesError: null,
      loadRoutes: async () => {},
    });
    const output = await renderToString(<RoutesZone useStore={store} />);
    expect(output).toContain('GET /users');
    expect(output).toContain('POST /users');
    expect(output).toContain('List users');
    expect(output).not.toContain('Loading routes');
  });

  it('shows a distinct scan-failure state carrying the reason, never an empty list', async () => {
    const store = createAppStore();
    store.setState({
      routesStatus: 'error',
      routes: null,
      routesError: { code: 'route-scan-failed', message: 'Route scan failed for /repos/gateway: bad spec' },
      loadRoutes: async () => {},
    });
    const output = await renderToString(<RoutesZone useStore={store} />);
    expect(output).toContain('Route scan failed');
    expect(output).toContain('bad spec');
    expect(output).not.toContain('No routes discovered');
  });

  it('shows a distinct genuinely-empty state, visibly different from a failure', async () => {
    const store = createAppStore();
    store.setState({
      routesStatus: 'ready',
      routesRepoPath: '/repos/empty',
      routes: [],
      routesError: null,
      loadRoutes: async () => {},
    });
    const output = await renderToString(<RoutesZone useStore={store} />);
    expect(output).toContain('No routes discovered for this repo.');
    expect(output).not.toContain('Route scan failed');
    expect(output).not.toContain('Loading routes');
  });

  it('shows no route list (named, not empty) when route exploration is not activated', async () => {
    const store = createAppStore();
    store.setState({
      routesStatus: 'error',
      routes: null,
      routesError: { code: 'route-exploration-not-activated', message: 'No route list for this repo' },
      loadRoutes: async () => {},
    });
    const output = await renderToString(<RoutesZone useStore={store} />);
    expect(output).toContain('No route list for this repo.');
    expect(output).not.toContain('No routes discovered');
    expect(output).not.toContain('Route scan failed');
  });
});

describe('RoutesZone (story 6.2)', () => {
  function seedReadyRoutes(store: ReturnType<typeof createAppStore>) {
    store.setState({
      routesStatus: 'ready',
      routesRepoPath: '/repos/gateway',
      routes: [
        { method: 'GET', path: '/users', summary: 'List users' },
        { method: 'POST', path: '/users', summary: 'Create a user' },
      ],
      routesError: null,
      loadRoutes: async () => {},
      fireRoute: async () => {},
    });
  }

  it('hints [enter] fire next to the route list', async () => {
    const store = createAppStore();
    seedReadyRoutes(store);
    const output = await renderToString(<RoutesZone useStore={store} />);
    expect(output).toContain('[enter] fire');
  });

  it('shows a spinner while the fire is in flight', async () => {
    const store = createAppStore();
    seedReadyRoutes(store);
    store.setState({ fireStatus: 'firing', fireResult: null, fireError: null });
    const output = await renderToString(<RoutesZone useStore={store} />);
    expect(output).toContain('⣾');
    expect(output).toContain('Firing');
  });

  it('shows the fired status + duration + body in the detail pane', async () => {
    const store = createAppStore();
    seedReadyRoutes(store);
    store.setState({ fireStatus: 'fired', fireResult: { status: 200, durationMs: 42, body: '{"id":1}' }, fireError: null });
    const output = await renderToString(<RoutesZone useStore={store} />);
    expect(output).toContain('200');
    expect(output).toContain('42ms');
    expect(output).toContain('{"id":1}');
  });

  it('shows a distinct auth error instead of a generic failure', async () => {
    const store = createAppStore();
    seedReadyRoutes(store);
    store.setState({
      fireStatus: 'error',
      fireResult: null,
      fireError: { code: 'auth-forbidden', message: 'Access forbidden for POST /users' },
    });
    const output = await renderToString(<RoutesZone useStore={store} />);
    expect(output).toContain('Access forbidden');
  });
});
