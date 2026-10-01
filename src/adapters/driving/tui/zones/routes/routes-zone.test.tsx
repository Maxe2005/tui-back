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

// Story 6.9 migrated the 6.2/6.7/6.8 render coverage from the global fire triple to the
// per-route `responses` map and the pane focus/tab state.
describe('RoutesZone (stories 6.2, 6.9)', () => {
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

  it('hints [enter] request (never fire) next to the route list', async () => {
    const store = createAppStore();
    seedReadyRoutes(store);
    const output = await renderToString(<RoutesZone useStore={store} />);
    expect(output).toContain('[enter] request');
    expect(output).not.toContain('[enter] fire');
  });

  it('previews the cursor route on the Request tab with its empty sections', async () => {
    const store = createAppStore();
    seedReadyRoutes(store);
    const output = await renderToString(<RoutesZone useStore={store} />);
    expect(output).toContain('▸ Request');
    expect(output).toContain('Response');
    expect(output).toContain('PARAMS');
    expect(output).toContain('QUERY');
    expect(output).toContain('HEADERS');
    expect(output).toContain('BODY');
    expect(output).toContain('(no body for this route)');
  });

  it('shows a spinner on the Response tab while the fire is in flight', async () => {
    const store = createAppStore();
    seedReadyRoutes(store);
    store.setState({ responses: { 'GET /users': { status: 'firing' } }, routesPaneTab: 'response' });
    const output = await renderToString(<RoutesZone useStore={store} />);
    expect(output).toContain('⣾');
    expect(output).toContain('Firing');
  });

  it('shows status, duration and size plus a navigable tree instead of the raw dump', async () => {
    const store = createAppStore();
    seedReadyRoutes(store);
    store.setState({
      responses: { 'GET /users': { status: 'fired', result: { status: 200, durationMs: 42, body: '{"id":1}' } } },
      routesPaneFocus: 'detail',
      routesPaneTab: 'response',
    });
    const output = await renderToString(<RoutesZone useStore={store} />);
    expect(output).toContain('200 · 42ms · 8 B');
    expect(output).toContain('id');
    expect(output).toContain('0 hidden · 0 rules');
    expect(output).not.toContain('{"id":1}');
  });

  it('shows a distinct auth error inside the Response tab', async () => {
    const store = createAppStore();
    seedReadyRoutes(store);
    store.setState({
      responses: { 'GET /users': { status: 'error', error: { code: 'auth-forbidden', message: 'Access forbidden for GET /users' } } },
      routesPaneTab: 'response',
    });
    const output = await renderToString(<RoutesZone useStore={store} />);
    expect(output).toContain('Access forbidden — this session lacks permission');
  });

  it('shows a hint when the route has no response yet', async () => {
    const store = createAppStore();
    seedReadyRoutes(store);
    store.setState({ routesPaneTab: 'response' });
    const unfocused = await renderToString(<RoutesZone useStore={store} />);
    expect(unfocused).toContain('No response yet');
    expect(unfocused).not.toContain('[ctrl+r]');
    store.setState({ routesPaneFocus: 'detail' });
    expect(await renderToString(<RoutesZone useStore={store} />)).toContain('[ctrl+r] fires the request');
  });

  it('shows the cursor route’s own response only (per route)', async () => {
    const store = createAppStore();
    seedReadyRoutes(store);
    store.setState({
      responses: { 'POST /users': { status: 'fired', result: { status: 201, durationMs: 5, body: '' } } },
      routesPaneTab: 'response',
    });
    expect(await renderToString(<RoutesZone useStore={store} />)).toContain('No response yet');
    store.getState().setRoutesSelected(1);
    expect(await renderToString(<RoutesZone useStore={store} />)).toContain('201 · 5ms');
  });

  it('marks required params and pre-fills them from the scanner example', async () => {
    const store = createAppStore();
    store.setState({
      routesStatus: 'ready',
      routesRepoPath: '/repos/gateway',
      routes: [
        {
          method: 'GET',
          path: '/users/{id}',
          parameters: [
            { name: 'id', in: 'path', required: true, example: 42 },
            { name: 'page', in: 'query', required: false },
          ],
        },
      ],
      routesError: null,
      loadRoutes: async () => {},
    });
    const output = await renderToString(<RoutesZone useStore={store} />);
    expect(output).toContain('id* = 42');
    expect(output).toContain('page = —');
  });
});

describe('RoutesZone (story 6.8)', () => {
  function seedBodyRoutes(store: ReturnType<typeof createAppStore>) {
    store.setState({
      routesStatus: 'ready',
      routesRepoPath: '/repos/gateway',
      routes: [
        { method: 'POST', path: '/users', summary: 'Create a user', bodyExample: { name: 'ada' }, bodyContentType: 'application/json' },
        { method: 'GET', path: '/users', summary: 'List users' },
      ],
      routesError: null,
      loadRoutes: async () => {},
      fireRoute: async () => {},
    });
  }

  it('hints [e] edit body on an editable route and hides the hint otherwise', async () => {
    const store = createAppStore();
    seedBodyRoutes(store);
    expect(await renderToString(<RoutesZone useStore={store} />)).toContain('[e] edit');
    store.getState().setRoutesSelected(1);
    expect(await renderToString(<RoutesZone useStore={store} />)).not.toContain('[e] edit');
  });

  it('keeps the [enter] request hint next to the edit hint and previews the seeded body', async () => {
    const store = createAppStore();
    seedBodyRoutes(store);
    const output = await renderToString(<RoutesZone useStore={store} />);
    expect(output).toContain('[enter] request');
    expect(output).toContain('[e] edit');
    expect(output).toContain('ada');
  });
});

describe('RoutesZone (story 6.7)', () => {
  function seedFiredJson(store: ReturnType<typeof createAppStore>, body = '{"id":1,"tags":["a"]}') {
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
      responses: { 'GET /users': { status: 'fired', result: { status: 200, durationMs: 42, body } } },
      routesPaneFocus: 'detail',
      routesPaneTab: 'response',
    });
  }

  function setBody(store: ReturnType<typeof createAppStore>, body: string) {
    store.setState({ responses: { 'GET /users': { status: 'fired', result: { status: 200, durationMs: 1, body } } } });
  }

  it('renders nested rows with size hints and a live status line', async () => {
    const store = createAppStore();
    seedFiredJson(store);
    const output = await renderToString(<RoutesZone useStore={store} />);
    expect(output).toContain('RESPONSE');
    expect(output).toContain('{2}');
    expect(output).toContain('tags');
    expect(output).toContain('0 hidden · 0 rules');
  });

  it('re-applies the route’s stored folds and key rules', async () => {
    const store = createAppStore();
    seedFiredJson(store);
    store.getState().updateJsonTreeState('GET /users', (previous) => ({
      ...previous,
      foldedPaths: ['tags'],
      hiddenKeys: ['id'],
    }));
    const output = await renderToString(<RoutesZone useStore={store} />);
    expect(output).toContain('tags');
    expect(output).not.toContain('"a"');
    expect(output).toContain('2 hidden · 1 rule');
  });

  it('shows scrollable raw text with its reason for a non-JSON body, never a partial tree', async () => {
    const store = createAppStore();
    seedFiredJson(store, '<html>hi</html>');
    const output = await renderToString(<RoutesZone useStore={store} />);
    expect(output).toContain('not JSON');
    expect(output).toContain('<html>hi</html>');
    expect(output).not.toContain('0 hidden');
  });

  it('shows the truncation reason at the cap', async () => {
    const store = createAppStore();
    seedFiredJson(store, `{"half": "tree", "pad": "${'x'.repeat(64 * 1024)}"}`);
    const output = await renderToString(<RoutesZone useStore={store} />);
    expect(output).toContain('truncated at 64 KB');
    expect(output).not.toContain('0 hidden');
  });

  it('shows an explicit empty state for empty bodies and empty JSON', async () => {
    const store = createAppStore();
    seedFiredJson(store, '');
    expect(await renderToString(<RoutesZone useStore={store} />)).toContain('Empty response body');
    setBody(store, '{}');
    expect(await renderToString(<RoutesZone useStore={store} />)).toContain('Empty JSON value');
  });

  it('shows right-pane hints at the bottom of the right pane while focused', async () => {
    const store = createAppStore();
    seedFiredJson(store);
    const focused = await renderToString(<RoutesZone useStore={store} />);
    expect(focused).toContain('[←→] fold');
    expect(focused).toContain('[esc] back to the list');
    expect(focused).not.toContain('[home/end] jump');
    store.getState().setRoutesPaneFocus('list');
    const unfocused = await renderToString(<RoutesZone useStore={store} />);
    expect(unfocused).toContain('[enter] request');
    expect(unfocused).not.toContain('[←→] fold');
  });
});
