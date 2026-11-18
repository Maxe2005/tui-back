// tui/zones/routes: bounded list + route filter (real keypresses via the fake-tty technique
// shared with logs-zone.interaction.test.tsx).
import { render } from 'ink';
import { describe, it, expect, vi } from 'vitest';
import { createAppStore } from '../../store/app-store.js';
import type { AppStoreDeps } from '../../store/app-store.js';
import { err, ok } from '../../../../../core/result.js';
import type { SavedRequest, SavedRequestPort } from '../../../../../core/ports/saved-request.js';
import { KEYS } from '../../shared/test-support/fake-tty.js';
import { RoutesZone } from './routes-zone.js';
import { footerIdOf } from '../../shared/test-support/mount-for-test.js';
import { seed, mount, press, lastFrame } from './routes-zone.test-support.js';

describe('RoutesZone request step & sub-tabs', () => {
  function seedWorkbench(fireRoute: (...args: unknown[]) => Promise<void> = async () => {}) {
    const store = createAppStore();
    store.setState({
      routesStatus: 'ready',
      routesRepoPath: '/repos/gateway',
      routes: [
        { method: 'GET', path: '/health', summary: 'Health' },
        {
          method: 'GET',
          path: '/users/{id}',
          summary: 'One user',
          parameters: [{ name: 'verbose', in: 'query', required: false }],
        },
        { method: 'POST', path: '/users', summary: 'Create', bodyExample: { name: 'ada' }, bodyContentType: 'application/json' },
      ],
      routesError: null,
      loadRoutes: async () => {},
      fireRoute: fireRoute as unknown as () => Promise<void>,
    });
    return store;
  }

  async function pressEscape(instance: ReturnType<typeof render>, stdin: NodeJS.ReadStream): Promise<void> {
    await press(instance, stdin, KEYS.escape);
    await new Promise((resolve) => setTimeout(resolve, 30));
    await instance.waitUntilRenderFlush();
  }

  async function type(instance: ReturnType<typeof render>, stdin: NodeJS.ReadStream, text: string): Promise<void> {
    for (const char of text) {
      await press(instance, stdin, char);
    }
  }

  it('Enter opens the Request tab with captured input, never fires; Esc returns to the list', async () => {
    const fireRoute = vi.fn(async () => {});
    const store = seedWorkbench(fireRoute);
    const { instance, stdout, stdin } = mount(store, 30);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.enter);
      expect(fireRoute).not.toHaveBeenCalled();
      expect(store.getState().routesPaneFocus).toBe('detail');
      expect(store.getState().routesPaneTab).toBe('request');
      expect(store.getState().zoneInputCaptured).toBe(true);
      expect(footerIdOf(store)).toMatch(/^routes-(section|rows)/);
      await pressEscape(instance, stdin);
      expect(store.getState().routesPaneFocus).toBe('list');
      expect(store.getState().zoneInputCaptured).toBe(false);
    } finally {
      instance.unmount();
    }
  });

  it('fires a plain GET in two keypresses (Enter, Ctrl+R)', async () => {
    const fireRoute = vi.fn(async () => {});
    const store = seedWorkbench(fireRoute);
    const { instance, stdin } = mount(store, 30);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.enter);
      await press(instance, stdin, KEYS.ctrlR);
      expect(fireRoute).toHaveBeenCalledWith('GET /health', 'GET', '/health', undefined);
    } finally {
      instance.unmount();
    }
  });

  it('blocks a fire with missing required params, then fires the substituted path with query', async () => {
    const fireRoute = vi.fn(async () => {});
    const store = seedWorkbench(fireRoute);
    const { instance, stdout, stdin } = mount(store, 30);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.enter);
      expect(lastFrame(stdout)).toContain('id* = —');
      await press(instance, stdin, KEYS.ctrlR);
      expect(fireRoute).not.toHaveBeenCalled();
      expect(lastFrame(stdout)).toContain('Missing required: id — nothing sent');

      // Fill `id` inline, then the optional `verbose` query row (Tab → Query).
      await press(instance, stdin, KEYS.enter);
      await type(instance, stdin, '4 2');
      await press(instance, stdin, KEYS.enter);
      await press(instance, stdin, KEYS.tab);
      expect(lastFrame(stdout)).toContain('▸ QUERY');
      await press(instance, stdin, KEYS.enter);
      await type(instance, stdin, 'yes');
      await press(instance, stdin, KEYS.enter);
      await press(instance, stdin, KEYS.ctrlR);
      expect(fireRoute).toHaveBeenCalledWith('GET /users/{id}', 'GET', '/users/4%202', { query: { verbose: 'yes' } });
      expect(lastFrame(stdout)).not.toContain('Missing required');
    } finally {
      instance.unmount();
    }
  });

  it('adds, edits and deletes header rows; duplicates are rejected', async () => {
    const fireRoute = vi.fn(async () => {});
    const store = seedWorkbench(fireRoute);
    const { instance, stdout, stdin } = mount(store, 30);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.enter);
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, KEYS.tab);
      expect(lastFrame(stdout)).toContain('▸ HEADERS');
      await press(instance, stdin, 'a');
      await type(instance, stdin, 'X-T');
      await press(instance, stdin, KEYS.enter);
      await press(instance, stdin, KEYS.enter);
      await type(instance, stdin, '1');
      await press(instance, stdin, KEYS.enter);
      expect(store.getState().requestDrafts['GET /health']?.headers).toEqual([{ name: 'X-T', value: '1', required: false }]);
      await press(instance, stdin, 'a');
      await type(instance, stdin, 'x-t');
      await press(instance, stdin, KEYS.enter);
      expect(lastFrame(stdout)).toContain('already exists');
      await pressEscape(instance, stdin);
      await press(instance, stdin, KEYS.ctrlR);
      expect(fireRoute).toHaveBeenLastCalledWith('GET /health', 'GET', '/health', { headers: { 'X-T': '1' } });
      await press(instance, stdin, 'd');
      expect(store.getState().requestDrafts['GET /health']?.headers).toEqual([]);
    } finally {
      instance.unmount();
    }
  });

  it('blocks a fire while the body has validation errors', async () => {
    const fireRoute = vi.fn(async () => {});
    const store = seedWorkbench(fireRoute);
    store.getState().ensureBodyDraft('POST /users', { name: 'x' });
    store.getState().setBodyEditError('POST /users', 'name', { reason: 'expected a number, got "x"', kind: 'number' });
    const { instance, stdout, stdin } = mount(store, 30);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.end);
      await press(instance, stdin, KEYS.enter);
      await press(instance, stdin, KEYS.ctrlR);
      expect(fireRoute).not.toHaveBeenCalled();
      expect(lastFrame(stdout)).toContain('Fix the body first');
    } finally {
      instance.unmount();
    }
  });

  it('switches sub-tabs with Ctrl+→/← and Ctrl+N/P without wrapping', async () => {
    const store = seedWorkbench();
    const { instance, stdin } = mount(store, 30);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.enter);
      expect(store.getState().routesPaneTab).toBe('request');
      await press(instance, stdin, KEYS.ctrlLeft);
      expect(store.getState().routesPaneTab).toBe('saved');
      await press(instance, stdin, KEYS.ctrlLeft);
      expect(store.getState().routesPaneTab).toBe('saved');
      await press(instance, stdin, KEYS.ctrlRight);
      expect(store.getState().routesPaneTab).toBe('request');
      await press(instance, stdin, KEYS.ctrlRight);
      expect(store.getState().routesPaneTab).toBe('response');
      await press(instance, stdin, KEYS.ctrlN);
      expect(store.getState().routesPaneTab).toBe('response');
      await press(instance, stdin, KEYS.ctrlP);
      expect(store.getState().routesPaneTab).toBe('request');
      await press(instance, stdin, KEYS.ctrlP);
      expect(store.getState().routesPaneTab).toBe('saved');
      await press(instance, stdin, KEYS.ctrlN);
      expect(store.getState().routesPaneTab).toBe('request');
      // Number keys and [ ] never switch tabs.
      await press(instance, stdin, '1');
      await press(instance, stdin, '[');
      expect(store.getState().routesPaneTab).toBe('request');
    } finally {
      instance.unmount();
    }
  });

  it('keeps each route’s draft and last response, and returns to an intact draft after a fire', async () => {
    const store = seedWorkbench();
    store.setState({
      fireRoute: async (routeKey: string) => {
        store.setState({
          routesPaneTab: 'response',
          responses: { ...store.getState().responses, [routeKey]: { status: 'fired', result: { status: 204, durationMs: 3, body: '' } } },
        });
      },
    });
    const { instance, stdout, stdin } = mount(store, 30);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.enter);
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, KEYS.tab);
      await press(instance, stdin, 'a');
      await type(instance, stdin, 'X-A');
      await press(instance, stdin, KEYS.enter);
      await press(instance, stdin, KEYS.ctrlR);
      expect(store.getState().routesPaneTab).toBe('response');
      expect(lastFrame(stdout)).toContain('204 · 3ms · 0 B');
      // Esc on Response → Request: the draft is intact and can be re-fired in place.
      await pressEscape(instance, stdin);
      expect(store.getState().routesPaneTab).toBe('request');
      expect(lastFrame(stdout)).toContain('X-A = —');
      // Leave, visit another route, come back: draft and response both survive.
      await pressEscape(instance, stdin);
      await press(instance, stdin, KEYS.down);
      expect(lastFrame(stdout)).not.toContain('X-A');
      await press(instance, stdin, KEYS.up);
      expect(lastFrame(stdout)).toContain('X-A = —');
      store.getState().setRoutesPaneTab('response');
      await instance.waitUntilRenderFlush();
      expect(lastFrame(stdout)).toContain('204 · 3ms');
    } finally {
      instance.unmount();
    }
  });
});

describe('RoutesZone saved requests', () => {
  // Ctrl+O travels as its control byte, the same codepoint-1..26 encoding KEYS documents.
  const CTRL_O = '\x0f';

  function fakeSavedPort(seed: SavedRequest[] = []): SavedRequestPort & { rows: Map<string, SavedRequest> } {
    const rows = new Map(seed.map((item) => [item.name, { ...item }]));
    return {
      rows,
      save: async (request) => {
        if (rows.has(request.name)) {
          return err('duplicate-request-name', `A request named "${request.name}" already exists`);
        }
        rows.set(request.name, { ...request });
        return ok({ ...request });
      },
      overwrite: async (name, request) => {
        const existing = rows.get(name);
        if (existing === undefined) {
          return err('saved-request-not-found', `No saved request named "${name}"`);
        }
        const next = { ...request, id: existing.id, createdAt: existing.createdAt, name };
        rows.set(name, next);
        return ok({ ...next });
      },
      get: async (name) => {
        const found = rows.get(name);
        return found === undefined ? err('saved-request-not-found', `No saved request named "${name}"`) : ok({ ...found });
      },
      list: async () => ok([...rows.values()].map((item) => ({ ...item }))),
      remove: async (name) => (rows.delete(name) ? ok(undefined) : err('saved-request-not-found', `No saved request named "${name}"`)),
    };
  }

  function record(name: string, overrides: Partial<SavedRequest> = {}): SavedRequest {
    return {
      id: `id-${name}`,
      name,
      repoPath: '/repos/gateway',
      method: 'GET',
      path: '/users',
      createdAt: '2026-10-06T00:00:00.000Z',
      updatedAt: '2026-10-06T00:00:00.000Z',
      ...overrides,
    };
  }

  function seedSaved(port: SavedRequestPort, cached: Array<SavedRequest & { stale: boolean }>) {
    const store = createAppStore({ savedRequests: port } as unknown as AppStoreDeps);
    store.setState({
      routesStatus: 'ready',
      routesRepoPath: '/repos/gateway',
      routes: [
        { method: 'GET', path: '/health', summary: 'Health' },
        { method: 'GET', path: '/users', summary: 'List users' },
      ],
      routesError: null,
      loadRoutes: async () => {},
      fireRoute: async () => {},
      refreshSavedRequests: async () => {},
      savedRequests: cached,
      savedRequestsError: null,
    });
    return store;
  }

  async function settle(instance: ReturnType<typeof render>): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 30));
    await instance.waitUntilRenderFlush();
  }

  async function type(instance: ReturnType<typeof render>, stdin: NodeJS.ReadStream, text: string): Promise<void> {
    for (const char of text) {
      await press(instance, stdin, char);
    }
  }

  it('s on the list opens the picker with fresh and stale rows; Esc closes it', async () => {
    const store = seedSaved(
      fakeSavedPort(),
      [
        { ...record('fresh-one', { query: { q: '1' } }), stale: false },
        { ...record('stale-one', { path: '/vanished' }), stale: true },
      ],
    );
    const { instance, stdout, stdin } = mount(store, 30);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, 's');
      const frame = lastFrame(stdout);
      expect(frame).toContain('Saved requests');
      expect(frame).toContain('fresh-one');
      expect(frame).toContain('stale-one');
      expect(frame).toContain('stale');
      await press(instance, stdin, KEYS.escape);
      await settle(instance);
      expect(lastFrame(stdout)).not.toContain('Saved requests');
      expect(store.getState().routesPaneFocus).toBe('list');
    } finally {
      instance.unmount();
    }
  });

  it('s in the Request tab saves under a fresh name and confirms in the hint', async () => {
    const port = fakeSavedPort();
    const store = seedSaved(port, []);
    const { instance, stdout, stdin } = mount(store, 30);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.enter);
      expect(store.getState().routesPaneFocus).toBe('detail');
      await press(instance, stdin, 's');
      expect(lastFrame(stdout)).toContain('Name:');
      await type(instance, stdin, 'my-req');
      await press(instance, stdin, KEYS.enter);
      await settle(instance);
      expect(lastFrame(stdout)).toContain('Saved "my-req"');
      expect(port.rows.has('my-req')).toBe(true);
      expect(store.getState().draftOrigins['GET /health']).toBeDefined();
    } finally {
      instance.unmount();
    }
  });

  it('a colliding name stays in the prompt with an inline error until Ctrl+O overwrites', async () => {
    const port = fakeSavedPort([record('taken')]);
    const store = seedSaved(port, []);
    const { instance, stdout, stdin } = mount(store, 30);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.enter);
      await press(instance, stdin, 's');
      await type(instance, stdin, 'taken');
      await press(instance, stdin, KEYS.enter);
      await settle(instance);
      expect(lastFrame(stdout)).toContain('is already used');
      expect(port.rows.get('taken')?.id).toBe('id-taken');
      await press(instance, stdin, CTRL_O);
      await settle(instance);
      expect(lastFrame(stdout)).toContain('Overwrite "taken"?');
      await press(instance, stdin, KEYS.enter);
      await settle(instance);
      expect(lastFrame(stdout)).toContain('Saved "taken"');
    } finally {
      instance.unmount();
    }
  });

  it('Enter on a fresh picker row loads its draft and focuses the Request tab', async () => {
    const port = fakeSavedPort([record('fresh-one', { query: { q: 'saved' } })]);
    const store = seedSaved(port, [{ ...record('fresh-one', { query: { q: 'saved' } }), stale: false }]);
    const { instance, stdout, stdin } = mount(store, 30);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, 's');
      expect(lastFrame(stdout)).toContain('fresh-one');
      await press(instance, stdin, KEYS.enter);
      await settle(instance);
      expect(store.getState().routesPaneFocus).toBe('detail');
      expect(store.getState().routesPaneTab).toBe('request');
      expect(store.getState().requestDrafts['GET /users']?.query).toEqual([{ name: 'q', value: 'saved', required: false }]);
      expect(store.getState().draftOrigins['GET /users']).toBe('id-fresh-one');
    } finally {
      instance.unmount();
    }
  });

  it('selecting a saved request for another route moves the cursor onto it', async () => {
    const port = fakeSavedPort([record('for-users', { query: { q: 'saved' } })]);
    const store = seedSaved(port, [{ ...record('for-users', { query: { q: 'saved' } }), stale: false }]);
    const { instance, stdout, stdin } = mount(store, 30);
    try {
      await instance.waitUntilRenderFlush();
      expect(store.getState().routesSelected).toBe(0);
      await press(instance, stdin, 's');
      expect(lastFrame(stdout)).toContain('for-users');
      await press(instance, stdin, KEYS.enter);
      await settle(instance);
      expect(store.getState().routesSelected).toBe(1);
      expect(store.getState().routesPaneFocus).toBe('detail');
      expect(store.getState().routesPaneTab).toBe('request');
      expect(lastFrame(stdout)).toContain('saved');
    } finally {
      instance.unmount();
    }
  });

  it('a saved request from another repo stays in the picker with an error line', async () => {
    const port = fakeSavedPort([record('other-repo', { repoPath: '/repos/other', path: '/elsewhere' })]);
    const store = seedSaved(port, [{ ...record('other-repo', { repoPath: '/repos/other', path: '/elsewhere' }), stale: false }]);
    const { instance, stdout, stdin } = mount(store, 30);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, 's');
      await press(instance, stdin, KEYS.enter);
      await settle(instance);
      expect(lastFrame(stdout)).toContain('Saved requests');
      expect(lastFrame(stdout)).toContain('not this repo');
      expect(store.getState().routesPaneFocus).toBe('list');
      expect(store.getState().routesSelected).toBe(0);
    } finally {
      instance.unmount();
    }
  });

  it('a stale row never loads, and d deletes it through a confirm', async () => {
    const port = fakeSavedPort([record('stale-one', { path: '/vanished' })]);
    const cached = [{ ...record('stale-one', { path: '/vanished' }), stale: true }];
    const store = seedSaved(port, cached);
    const { instance, stdout, stdin } = mount(store, 30);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, 's');
      await press(instance, stdin, KEYS.enter);
      await settle(instance);
      expect(lastFrame(stdout)).toContain('Saved requests');
      expect(store.getState().routesPaneFocus).toBe('list');
      await press(instance, stdin, 'd');
      await settle(instance);
      expect(lastFrame(stdout)).toContain('Delete "stale-one"?');
      await press(instance, stdin, KEYS.enter);
      await settle(instance);
      expect(port.rows.has('stale-one')).toBe(false);
      expect(lastFrame(stdout)).not.toContain('stale-one');
    } finally {
      instance.unmount();
    }
  });

  it('Saved sub-tab lists only the pane route and Enter loads into Request', async () => {
    const port = fakeSavedPort([
      record('for-health', { method: 'GET', path: '/health', query: { q: 'saved' } }),
      record('for-users', { method: 'GET', path: '/users' }),
    ]);
    const store = seedSaved(port, [
      { ...record('for-health', { method: 'GET', path: '/health', query: { q: 'saved' } }), stale: false },
      { ...record('for-users', { method: 'GET', path: '/users' }), stale: false },
    ]);
    const { instance, stdout, stdin } = mount(store, 30);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.enter);
      expect(store.getState().routesPaneTab).toBe('request');
      await press(instance, stdin, KEYS.ctrlLeft);
      expect(store.getState().routesPaneTab).toBe('saved');
      let frame = lastFrame(stdout);
      expect(frame).toContain('for-health');
      expect(frame).not.toContain('for-users');
      await press(instance, stdin, KEYS.enter);
      await settle(instance);
      expect(store.getState().routesPaneTab).toBe('request');
      expect(store.getState().routesPaneFocus).toBe('detail');
      expect(store.getState().requestDrafts['GET /health']?.query).toEqual([{ name: 'q', value: 'saved', required: false }]);
    } finally {
      instance.unmount();
    }
  });

  it('Enter on the list still lands on Request, never on Saved', async () => {
    const store = seedSaved(fakeSavedPort(), []);
    const { instance, stdin } = mount(store, 30);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.enter);
      expect(store.getState().routesPaneTab).toBe('request');
      expect(store.getState().routesPaneTab).not.toBe('saved');
    } finally {
      instance.unmount();
    }
  });

  it('Saved sub-tab shows the teaching empty state and Esc returns to the list', async () => {
    const store = seedSaved(fakeSavedPort(), []);
    const { instance, stdout, stdin } = mount(store, 30);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.enter);
      await press(instance, stdin, KEYS.ctrlLeft);
      expect(store.getState().routesPaneTab).toBe('saved');
      expect(lastFrame(stdout)).toContain('No saved requests for this route');
      await press(instance, stdin, KEYS.escape);
      await settle(instance);
      expect(store.getState().routesPaneFocus).toBe('list');
    } finally {
      instance.unmount();
    }
  });

  it('Saved sub-tab d deletes the route-scoped row through a confirm', async () => {
    const port = fakeSavedPort([record('gone', { method: 'GET', path: '/health' })]);
    const store = seedSaved(port, [{ ...record('gone', { method: 'GET', path: '/health' }), stale: false }]);
    const { instance, stdout, stdin } = mount(store, 30);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.enter);
      await press(instance, stdin, KEYS.ctrlLeft);
      expect(lastFrame(stdout)).toContain('gone');
      await press(instance, stdin, 'd');
      await settle(instance);
      expect(lastFrame(stdout)).toContain('Delete "gone"?');
      await press(instance, stdin, KEYS.enter);
      await settle(instance);
      expect(port.rows.has('gone')).toBe(false);
      expect(lastFrame(stdout)).toContain('No saved requests for this route');
    } finally {
      instance.unmount();
    }
  });

  it('Saved sub-tab filter narrows rows and Esc clears it before leaving', async () => {
    const port = fakeSavedPort([
      record('alpha', { method: 'GET', path: '/health' }),
      record('beta', { method: 'GET', path: '/health' }),
    ]);
    const store = seedSaved(port, [
      { ...record('alpha', { method: 'GET', path: '/health' }), stale: false },
      { ...record('beta', { method: 'GET', path: '/health' }), stale: false },
    ]);
    const { instance, stdout, stdin } = mount(store, 30);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.enter);
      await press(instance, stdin, KEYS.ctrlLeft);
      expect(store.getState().routesPaneTab).toBe('saved');
      await type(instance, stdin, 'alp');
      await settle(instance);
      expect(lastFrame(stdout)).toContain('alpha');
      expect(lastFrame(stdout)).not.toContain('beta');
      await press(instance, stdin, KEYS.escape);
      await settle(instance);
      expect(lastFrame(stdout)).toContain('beta');
      expect(store.getState().routesPaneTab).toBe('saved');
      await press(instance, stdin, KEYS.escape);
      await settle(instance);
      expect(store.getState().routesPaneFocus).toBe('list');
    } finally {
      instance.unmount();
    }
  });

  it('Saved sub-tab resets its filter when the route changes', async () => {
    const port = fakeSavedPort([
      record('h-one', { method: 'GET', path: '/health' }),
      record('u-one', { method: 'GET', path: '/users' }),
    ]);
    const store = seedSaved(port, [
      { ...record('h-one', { method: 'GET', path: '/health' }), stale: false },
      { ...record('u-one', { method: 'GET', path: '/users' }), stale: false },
    ]);
    const { instance, stdout, stdin } = mount(store, 30);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.enter);
      await press(instance, stdin, KEYS.ctrlLeft);
      await type(instance, stdin, 'h-one');
      await settle(instance);
      expect(lastFrame(stdout)).toContain('h-one');
      await press(instance, stdin, KEYS.escape);
      await settle(instance);
      await press(instance, stdin, KEYS.escape);
      await settle(instance);
      expect(store.getState().routesPaneFocus).toBe('list');
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, KEYS.enter);
      await press(instance, stdin, KEYS.ctrlLeft);
      await settle(instance);
      expect(store.getState().routesPaneTab).toBe('saved');
      expect(lastFrame(stdout)).toContain('u-one');
      expect(lastFrame(stdout)).not.toContain('h-one');
    } finally {
      instance.unmount();
    }
  });

  it('Saved sub-tab r re-runs the library refresh', async () => {
    const store = seedSaved(fakeSavedPort(), [
      { ...record('one', { method: 'GET', path: '/health' }), stale: false },
    ]);
    const refresh = vi.fn(async () => {});
    store.setState({ refreshSavedRequests: refresh });
    const { instance, stdin } = mount(store, 30);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.enter);
      await press(instance, stdin, KEYS.ctrlLeft);
      expect(store.getState().routesPaneTab).toBe('saved');
      await press(instance, stdin, 'r');
      await settle(instance);
      expect(refresh).toHaveBeenCalled();
      expect(store.getState().routesPaneTab).toBe('saved');
    } finally {
      instance.unmount();
    }
  });

  it('Saved sub-tab treats a whitespace-only filter as filtering: d types instead of deleting', async () => {
    const port = fakeSavedPort([record('one', { method: 'GET', path: '/health' })]);
    const store = seedSaved(port, [{ ...record('one', { method: 'GET', path: '/health' }), stale: false }]);
    const { instance, stdout, stdin } = mount(store, 30);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.enter);
      await press(instance, stdin, KEYS.ctrlLeft);
      await press(instance, stdin, ' ');
      await settle(instance);
      await press(instance, stdin, 'd');
      await settle(instance);
      expect(lastFrame(stdout)).not.toContain('Delete "one"?');
      expect(port.rows.has('one')).toBe(true);
    } finally {
      instance.unmount();
    }
  });

  it('Saved sub-tab delete of the last row keeps a valid cursor: Enter loads the remainder', async () => {
    const port = fakeSavedPort([
      record('alpha', { method: 'GET', path: '/health', query: { q: 'a' } }),
      record('beta', { method: 'GET', path: '/health', query: { q: 'b' } }),
    ]);
    const store = seedSaved(port, [
      { ...record('alpha', { method: 'GET', path: '/health', query: { q: 'a' } }), stale: false },
      { ...record('beta', { method: 'GET', path: '/health', query: { q: 'b' } }), stale: false },
    ]);
    const { instance, stdout, stdin } = mount(store, 30);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.enter);
      await press(instance, stdin, KEYS.ctrlLeft);
      await press(instance, stdin, KEYS.down);
      await press(instance, stdin, 'd');
      await settle(instance);
      expect(lastFrame(stdout)).toContain('Delete "beta"?');
      await press(instance, stdin, KEYS.enter);
      await settle(instance);
      expect(port.rows.has('beta')).toBe(false);
      await press(instance, stdin, KEYS.enter);
      await settle(instance);
      expect(store.getState().routesPaneTab).toBe('request');
      expect(store.getState().requestDrafts['GET /health']?.query).toEqual([{ name: 'q', value: 'a', required: false }]);
    } finally {
      instance.unmount();
    }
  });

  it('Saved sub-tab Esc cancels the delete confirm and keeps the row', async () => {
    const port = fakeSavedPort([record('keep', { method: 'GET', path: '/health' })]);
    const store = seedSaved(port, [{ ...record('keep', { method: 'GET', path: '/health' }), stale: false }]);
    const { instance, stdout, stdin } = mount(store, 30);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.enter);
      await press(instance, stdin, KEYS.ctrlLeft);
      await press(instance, stdin, 'd');
      await settle(instance);
      expect(lastFrame(stdout)).toContain('Delete "keep"?');
      await press(instance, stdin, KEYS.escape);
      await settle(instance);
      expect(lastFrame(stdout)).not.toContain('Delete "keep"?');
      expect(lastFrame(stdout)).toContain('keep');
      expect(port.rows.has('keep')).toBe(true);
      expect(store.getState().routesPaneTab).toBe('saved');
    } finally {
      instance.unmount();
    }
  });

  it('Saved sub-tab first visit auto-loads an unloaded cache', async () => {
    const store = seedSaved(fakeSavedPort(), []);
    store.setState({ savedRequests: null, savedRequestsError: null });
    const cached = [{ ...record('auto', { method: 'GET', path: '/health' }), stale: false }];
    const refresh = vi.fn(async () => {
      store.setState({ savedRequests: cached, savedRequestsError: null });
    });
    store.setState({ refreshSavedRequests: refresh });
    const { instance, stdout, stdin } = mount(store, 30);
    try {
      await instance.waitUntilRenderFlush();
      expect(refresh).not.toHaveBeenCalled();
      await press(instance, stdin, KEYS.enter);
      await press(instance, stdin, KEYS.ctrlLeft);
      await settle(instance);
      expect(refresh).toHaveBeenCalled();
      expect(lastFrame(stdout)).toContain('auto');
    } finally {
      instance.unmount();
    }
  });

  it('Saved sub-tab Enter with a failing load stays on Saved with the inline error', async () => {
    const port = fakeSavedPort([record('broken', { method: 'GET', path: '/health' })]);
    port.get = async () => err('saved-request-not-found', 'No saved request named "broken"');
    const store = seedSaved(port, [{ ...record('broken', { method: 'GET', path: '/health' }), stale: false }]);
    const { instance, stdout, stdin } = mount(store, 30);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.enter);
      await press(instance, stdin, KEYS.ctrlLeft);
      await press(instance, stdin, KEYS.enter);
      await settle(instance);
      expect(store.getState().routesPaneTab).toBe('saved');
      expect(store.getState().routesPaneFocus).toBe('detail');
      expect(lastFrame(stdout)).toContain('No saved request named');
    } finally {
      instance.unmount();
    }
  });

  it('Saved sub-tab delete confirm surfaces a failing remove as the inline error', async () => {
    const port = fakeSavedPort([record('stuck', { method: 'GET', path: '/health' })]);
    port.remove = async () => err('saved-requests-failed', 'remove blew up');
    const store = seedSaved(port, [{ ...record('stuck', { method: 'GET', path: '/health' }), stale: false }]);
    const { instance, stdout, stdin } = mount(store, 30);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.enter);
      await press(instance, stdin, KEYS.ctrlLeft);
      await press(instance, stdin, 'd');
      await settle(instance);
      expect(lastFrame(stdout)).toContain('Delete "stuck"?');
      await press(instance, stdin, KEYS.enter);
      await settle(instance);
      expect(lastFrame(stdout)).toContain('remove blew up');
      expect(port.rows.has('stuck')).toBe(true);
      expect(store.getState().routesPaneTab).toBe('saved');
    } finally {
      instance.unmount();
    }
  });
});

describe('RoutesZone saved prompt guards', () => {
  // Same control-byte encoding as above.
  const CTRL_O = '\x0f';

  function fakeSavedPort(): SavedRequestPort & { rows: Map<string, SavedRequest> } {
    const rows = new Map<string, SavedRequest>();
    return {
      rows,
      save: async (request) => {
        if (rows.has(request.name)) {
          return err('duplicate-request-name', `A request named "${request.name}" already exists`);
        }
        rows.set(request.name, { ...request });
        return ok({ ...request });
      },
      overwrite: async (name, request) => {
        const existing = rows.get(name);
        if (existing === undefined) {
          return err('saved-request-not-found', `No saved request named "${name}"`);
        }
        const next = { ...request, id: existing.id, createdAt: existing.createdAt, name };
        rows.set(name, next);
        return ok({ ...next });
      },
      get: async (name) => {
        const found = rows.get(name);
        return found === undefined ? err('saved-request-not-found', `No saved request named "${name}"`) : ok({ ...found });
      },
      list: async () => ok([...rows.values()].map((item) => ({ ...item }))),
      remove: async (name) => (rows.delete(name) ? ok(undefined) : err('saved-request-not-found', `No saved request named "${name}"`)),
    };
  }

  function seedGuard(port: SavedRequestPort) {
    const store = createAppStore({ savedRequests: port } as unknown as AppStoreDeps);
    store.setState({
      routesStatus: 'ready',
      routesRepoPath: '/repos/gateway',
      routes: [{ method: 'GET', path: '/health', summary: 'Health' }],
      routesError: null,
      loadRoutes: async () => {},
      fireRoute: async () => {},
      refreshSavedRequests: async () => {},
      savedRequests: [],
      savedRequestsError: null,
    });
    return store;
  }

  async function settle(instance: ReturnType<typeof render>): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 30));
    await instance.waitUntilRenderFlush();
  }

  it('Ctrl+O on a non-duplicate prompt error never opens the overwrite confirm', async () => {
    const store = seedGuard(fakeSavedPort());
    const { instance, stdout, stdin } = mount(store, 30);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, KEYS.enter);
      await press(instance, stdin, 's');
      // Empty name: Enter fails with missing-argument, which is not a duplicate.
      await press(instance, stdin, KEYS.enter);
      await settle(instance);
      expect(lastFrame(stdout)).toContain('A request name is required');
      await press(instance, stdin, CTRL_O);
      await settle(instance);
      expect(lastFrame(stdout)).not.toContain('Overwrite');
    } finally {
      instance.unmount();
    }
  });

  it('Enter on a stale picker row shows an error line instead of loading silently', async () => {
    const stale = {
      id: 'id-stale',
      name: 'stale-one',
      repoPath: '/repos/gateway',
      method: 'GET',
      path: '/vanished',
      createdAt: '2026-10-06T00:00:00.000Z',
      updatedAt: '2026-10-06T00:00:00.000Z',
      stale: true,
    };
    const port = fakeSavedPort();
    const store = seedGuard(port);
    store.setState({ savedRequests: [stale] });
    const { instance, stdout, stdin } = mount(store, 30);
    try {
      await instance.waitUntilRenderFlush();
      await press(instance, stdin, 's');
      expect(lastFrame(stdout)).toContain('stale-one');
      await press(instance, stdin, KEYS.enter);
      await settle(instance);
      expect(lastFrame(stdout)).toContain('Saved requests');
      expect(lastFrame(stdout)).toContain('is stale');
      expect(store.getState().routesPaneFocus).toBe('list');
    } finally {
      instance.unmount();
    }
  });
});
